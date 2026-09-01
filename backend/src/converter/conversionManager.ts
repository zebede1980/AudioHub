import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import { files, libraryRoots } from "../db/schema.js";
import { readAudioTags } from "../scanner/metadata.js";
import { computeFingerprint } from "../scanner/fingerprint.js";
import { convertWavToMp3 } from "./ffmpeg.js";

export type FileConversionStatus = "queued" | "converting" | "done" | "error" | "skipped";

export interface FileConversionState {
  fileId: number;
  relativePath: string;
  sizeBytesBefore: number;
  sizeBytesAfter?: number;
  status: FileConversionStatus;
  error?: string;
}

export interface ConversionJobState {
  status: "running" | "cancelling" | "done" | "cancelled";
  bitrateKbps: number;
  concurrency: number;
  files: FileConversionState[];
  startedAt: number;
  finishedAt?: number;
}

const updateFolderAggregate = rawDb.prepare(`
  UPDATE folders SET total_duration_sec = (
    SELECT COALESCE(SUM(duration_sec), 0) FROM files WHERE folder_id = ? AND deleted_at IS NULL
  ) WHERE id = ?
`);

let currentJob: ConversionJobState | null = null;

export function getConversionStatus(): ConversionJobState | null {
  return currentJob;
}

export function cancelConversion(): void {
  if (currentJob && currentJob.status === "running") {
    currentJob.status = "cancelling";
  }
}

/** Only one conversion batch runs at a time; calling this while one is in flight just returns it. */
export function startConversion(fileIds: number[], bitrateKbps: number, concurrency: number): ConversionJobState {
  if (currentJob && (currentJob.status === "running" || currentJob.status === "cancelling")) {
    return currentJob;
  }

  const job: ConversionJobState = {
    status: "running",
    bitrateKbps,
    concurrency,
    files: fileIds.map((fileId) => ({ fileId, relativePath: "", sizeBytesBefore: 0, status: "queued" })),
    startedAt: Date.now(),
  };
  currentJob = job;

  runQueue(job).catch((err) => {
    job.status = "cancelled";
    job.finishedAt = Date.now();
    console.error("conversion queue crashed", err);
  });

  return job;
}

async function runQueue(job: ConversionJobState): Promise<void> {
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (job.status === "cancelling") return;
      const index = nextIndex;
      if (index >= job.files.length) return;
      nextIndex++;

      const entry = job.files[index];
      entry.status = "converting";
      try {
        await convertOneFile(job, entry);
        entry.status = "done";
      } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(job.concurrency, job.files.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const entry of job.files) {
    if (entry.status === "queued") entry.status = "skipped";
  }

  job.status = job.status === "cancelling" ? "cancelled" : "done";
  job.finishedAt = Date.now();
}

/**
 * Converts one WAV file to MP3 and swaps the existing `files` row in place (same id) so ratings,
 * play history, and playback position — all keyed on file id — survive the swap untouched. This
 * deliberately bypasses the scanner's fingerprint-based move detection: transcoding changes every
 * byte of the file, so the scanner would see "old file gone, new file appeared" and orphan them.
 */
async function convertOneFile(job: ConversionJobState, entry: FileConversionState): Promise<void> {
  const row = db
    .select({
      id: files.id,
      relativePath: files.relativePath,
      extension: files.extension,
      durationSec: files.durationSec,
      folderId: files.folderId,
      containerPath: libraryRoots.containerPath,
    })
    .from(files)
    .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
    .where(eq(files.id, entry.fileId))
    .get();

  if (!row) throw new Error("file no longer exists in the library index");
  if (row.extension !== ".wav") throw new Error("file is no longer a WAV (already converted or changed on disk)");

  const absWavPath = path.join(row.containerPath, row.relativePath);
  entry.relativePath = row.relativePath;

  const wavStat = fs.statSync(absWavPath);
  entry.sizeBytesBefore = wavStat.size;

  const dir = path.dirname(absWavPath);
  const base = path.basename(absWavPath, path.extname(absWavPath));
  const finalAbsPath = path.join(dir, `${base}.mp3`);
  const tempAbsPath = path.join(dir, `${base}.mp3.converting`);

  if (fs.existsSync(finalAbsPath)) {
    throw new Error(`an .mp3 with the same name already exists alongside it: ${base}.mp3`);
  }

  await convertWavToMp3(absWavPath, tempAbsPath, job.bitrateKbps);

  try {
    const tempStat = fs.statSync(tempAbsPath);
    if (tempStat.size === 0) throw new Error("ffmpeg produced an empty output file");

    const newTags = await readAudioTags(tempAbsPath);
    if (row.durationSec != null && newTags.durationSec != null) {
      const tolerance = Math.max(2, row.durationSec * 0.02);
      if (Math.abs(newTags.durationSec - row.durationSec) > tolerance) {
        throw new Error(
          `converted duration (${newTags.durationSec.toFixed(1)}s) doesn't match original (${row.durationSec.toFixed(1)}s) — original left untouched`
        );
      }
    }

    fs.renameSync(tempAbsPath, finalAbsPath);
    fs.rmSync(absWavPath, { force: true });

    const relativeDir = path.dirname(row.relativePath);
    const newRelativePath = relativeDir === "." ? `${base}.mp3` : `${relativeDir}/${base}.mp3`;
    const finalStat = fs.statSync(finalAbsPath);
    const fingerprint = computeFingerprint(finalAbsPath, finalStat.size);

    db.update(files)
      .set({
        relativePath: newRelativePath,
        filename: `${base}.mp3`,
        extension: ".mp3",
        sizeBytes: finalStat.size,
        mtimeMs: Math.round(finalStat.mtimeMs),
        fingerprint,
        durationSec: newTags.durationSec ?? row.durationSec,
        tagTitle: newTags.tagTitle,
        tagArtist: newTags.tagArtist,
        tagAlbum: newTags.tagAlbum,
        tagTrack: newTags.tagTrack,
        tagGenre: newTags.tagGenre,
      })
      .where(eq(files.id, row.id))
      .run();

    updateFolderAggregate.run(row.folderId, row.folderId);

    entry.sizeBytesAfter = finalStat.size;
  } catch (err) {
    fs.rmSync(tempAbsPath, { force: true });
    throw err;
  }
}
