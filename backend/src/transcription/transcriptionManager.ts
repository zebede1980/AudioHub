import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, libraryRoots, transcripts } from "../db/schema.js";
import { config } from "../config.js";
import { ensureModel } from "./modelManager.js";
import { extractWhisperWav } from "./prepareAudio.js";
import { runWhisper } from "./whisper.js";

export type FileTranscriptionStatus = "queued" | "transcribing" | "done" | "error" | "skipped";

export interface FileTranscriptionState {
  fileId: number;
  relativePath: string;
  status: FileTranscriptionStatus;
  wordCount?: number;
  error?: string;
}

export interface TranscriptionJobState {
  status: "downloading-model" | "running" | "cancelling" | "done" | "cancelled" | "error";
  files: FileTranscriptionState[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

const tmpDir = path.join(path.dirname(config.databasePath), "tmp");

// Reads job.status through a function boundary so TS doesn't over-narrow it to whatever literal
// was last assigned in the calling scope — the field is mutated concurrently by cancelTranscription().
function readStatus(job: TranscriptionJobState): TranscriptionJobState["status"] {
  return job.status;
}

let currentJob: TranscriptionJobState | null = null;

export function getTranscriptionStatus(): TranscriptionJobState | null {
  return currentJob;
}

export function cancelTranscription(): void {
  if (currentJob && (currentJob.status === "running" || currentJob.status === "downloading-model")) {
    currentJob.status = "cancelling";
  }
}

/** Only one transcription batch runs at a time, whether triggered per-file or per-folder. */
export function startTranscription(fileIds: number[], concurrency: number): TranscriptionJobState {
  if (currentJob && (currentJob.status === "running" || currentJob.status === "downloading-model" || currentJob.status === "cancelling")) {
    return currentJob;
  }

  const job: TranscriptionJobState = {
    status: "downloading-model",
    files: fileIds.map((fileId) => ({ fileId, relativePath: "", status: "queued" })),
    startedAt: Date.now(),
  };
  currentJob = job;

  runJob(job).catch((err) => {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
    console.error("transcription job crashed", err);
  });

  return job;
}

async function runJob(job: TranscriptionJobState): Promise<void> {
  const modelPath = await ensureModel();
  if (job.status === "cancelling") {
    for (const entry of job.files) entry.status = "skipped";
    job.status = "cancelled";
    job.finishedAt = Date.now();
    return;
  }

  job.status = "running";
  fs.mkdirSync(tmpDir, { recursive: true });

  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (readStatus(job) === "cancelling") return;
      const index = nextIndex;
      if (index >= job.files.length) return;
      nextIndex++;

      const entry = job.files[index];
      entry.status = "transcribing";
      try {
        await transcribeOneFile(modelPath, entry);
        entry.status = "done";
      } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(job.files.length, config.transcription.maxConcurrency));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const entry of job.files) {
    if (entry.status === "queued") entry.status = "skipped";
  }

  job.status = readStatus(job) === "cancelling" ? "cancelled" : "done";
  job.finishedAt = Date.now();
}

async function transcribeOneFile(modelPath: string, entry: FileTranscriptionState): Promise<void> {
  const row = db
    .select({
      id: files.id,
      relativePath: files.relativePath,
      containerPath: libraryRoots.containerPath,
    })
    .from(files)
    .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
    .where(eq(files.id, entry.fileId))
    .get();

  if (!row) throw new Error("file no longer exists in the library index");
  entry.relativePath = row.relativePath;

  const absSourcePath = path.join(row.containerPath, row.relativePath);
  const token = crypto.randomBytes(6).toString("hex");
  const tempWavPath = path.join(tmpDir, `transcribe-${row.id}-${token}.wav`);
  const tempOutBase = path.join(tmpDir, `transcribe-${row.id}-${token}`);

  try {
    await extractWhisperWav(absSourcePath, tempWavPath);
    const { text, language } = await runWhisper(tempWavPath, modelPath, tempOutBase);
    if (!text) throw new Error("whisper produced no transcript text (silent or unsupported audio?)");

    db.insert(transcripts)
      .values({ fileId: row.id, text, language, model: config.transcription.modelName, createdAt: Date.now() })
      .onConflictDoUpdate({
        target: transcripts.fileId,
        set: { text, language, model: config.transcription.modelName, createdAt: Date.now() },
      })
      .run();

    entry.wordCount = text.split(/\s+/).filter(Boolean).length;
  } finally {
    fs.rmSync(tempWavPath, { force: true });
  }
}
