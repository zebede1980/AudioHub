import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, libraryRoots, transcripts } from "../db/schema.js";
import { config } from "../config.js";
import { ensureModel, ensureVadModel } from "./modelManager.js";
import { longestRepeatedRun } from "./quality.js";
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

/** Lets appendToJob nudge the running drain loop for that job. Without it the pool is only
 * re-evaluated when a worker exits — which doesn't happen until the whole queue is empty, so
 * files added mid-batch would never get a second worker. */
const queueWakeups = new WeakMap<TranscriptionJobState, () => void>();

export function getTranscriptionStatus(): TranscriptionJobState | null {
  return currentJob;
}

/**
 * Clears leftover extraction WAVs. Each file's temp WAV is removed in a finally block, but a
 * container restart mid-transcription kills the process outright — leaving a multi-hundred-MB
 * file in the /data volume for good. Only ever called at startup, where nothing is in flight.
 */
export function cleanTranscriptionTempDir(): { removedFiles: number; freedBytes: number } {
  let removedFiles = 0;
  let freedBytes = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpDir);
  } catch {
    return { removedFiles, freedBytes }; // never created yet
  }

  for (const name of entries) {
    const filePath = path.join(tmpDir, name);
    try {
      freedBytes += fs.statSync(filePath).size;
      fs.rmSync(filePath, { force: true, recursive: true });
      removedFiles++;
    } catch {
      // Best-effort: a file we can't remove shouldn't stop startup.
    }
  }
  return { removedFiles, freedBytes };
}

export function cancelTranscription(): void {
  if (currentJob && (currentJob.status === "running" || currentJob.status === "downloading-model")) {
    currentJob.status = "cancelling";
  }
}

export type StartTranscriptionResult =
  /** A new batch was created for these files. */
  | { outcome: "started"; job: TranscriptionJobState; addedCount: number; alreadyPendingCount: number }
  /** A batch was already running and these files joined its queue. */
  | { outcome: "queued"; job: TranscriptionJobState; addedCount: number; alreadyPendingCount: number }
  /** The running batch is winding down from a cancel — appending to it would be a lie. */
  | { outcome: "cancelling"; job: TranscriptionJobState };

/**
 * Only one transcription batch runs at a time (whisper is CPU-hungry), but asking for more files
 * while one is running appends them to that batch's queue rather than being rejected — clicking
 * "transcribe" on several files in a row queues all of them, which is what it looks like it does.
 */
export function startTranscription(fileIds: number[]): StartTranscriptionResult {
  const job = currentJob;

  if (job && (job.status === "running" || job.status === "downloading-model")) {
    const { addedCount, alreadyPendingCount } = appendToJob(job, fileIds);
    return { outcome: "queued", job, addedCount, alreadyPendingCount };
  }
  if (job && job.status === "cancelling") {
    return { outcome: "cancelling", job };
  }

  const newJob: TranscriptionJobState = {
    status: "downloading-model",
    files: fileIds.map((fileId) => ({ fileId, relativePath: "", status: "queued" })),
    startedAt: Date.now(),
  };
  currentJob = newJob;

  runJob(newJob).catch((err) => {
    newJob.status = "error";
    newJob.error = err instanceof Error ? err.message : String(err);
    newJob.finishedAt = Date.now();
    console.error("transcription job crashed", err);
  });

  return { outcome: "started", job: newJob, addedCount: fileIds.length, alreadyPendingCount: 0 };
}

/** Adds files to a running batch. A file already waiting its turn is left alone (a double-click
 * shouldn't transcribe it twice); one that already finished or failed in this batch is reset to
 * queued, which is how "retry" works without piling up duplicate rows in the status list. */
export function appendToJob(job: TranscriptionJobState, fileIds: number[]): { addedCount: number; alreadyPendingCount: number } {
  let addedCount = 0;
  let alreadyPendingCount = 0;

  for (const fileId of fileIds) {
    const existing = job.files.find((entry) => entry.fileId === fileId);
    if (existing && (existing.status === "queued" || existing.status === "transcribing")) {
      alreadyPendingCount++;
      continue;
    }
    if (existing) {
      existing.status = "queued";
      existing.error = undefined;
      existing.wordCount = undefined;
    } else {
      job.files.push({ fileId, relativePath: "", status: "queued" });
    }
    addedCount++;
  }

  if (addedCount > 0) queueWakeups.get(job)?.();

  return { addedCount, alreadyPendingCount };
}

async function runJob(job: TranscriptionJobState): Promise<void> {
  const modelPath = await ensureModel();
  // Optional accuracy aid, fetched once alongside the main model; null if unavailable.
  const vadModelPath = await ensureVadModel();
  if (job.status === "cancelling") {
    for (const entry of job.files) entry.status = "skipped";
    job.status = "cancelled";
    job.finishedAt = Date.now();
    return;
  }

  job.status = "running";
  fs.mkdirSync(tmpDir, { recursive: true });

  await drainQueue(job, config.transcription.maxConcurrency, (entry) =>
    transcribeOneFile(modelPath, vadModelPath, entry)
  );

  for (const entry of job.files) {
    if (entry.status === "queued") entry.status = "skipped";
  }

  job.status = readStatus(job) === "cancelling" ? "cancelled" : "done";
  job.finishedAt = Date.now();
}

/**
 * Works through a job's queue with at most `maxConcurrency` files in flight, and keeps going for
 * anything appended while it runs. Exported for tests: this is the part that has to be right for
 * "click transcribe on five files in a row" to actually transcribe five files.
 */
export async function drainQueue(
  job: TranscriptionJobState,
  maxConcurrency: number,
  processOne: (entry: FileTranscriptionState) => Promise<void>
): Promise<void> {
  // Claim by scanning for the next queued entry rather than walking a monotonic index, so files
  // appended (or reset for a retry) mid-run are picked up by a worker that's already going.
  // Nothing awaits between the find and the status write, so no two workers can claim the same one.
  function claimNext(): FileTranscriptionState | null {
    const entry = job.files.find((e) => e.status === "queued");
    if (!entry) return null;
    entry.status = "transcribing";
    return entry;
  }

  async function worker() {
    while (true) {
      if (readStatus(job) === "cancelling") return;
      const entry = claimNext();
      if (!entry) return;

      try {
        await processOne(entry);
        entry.status = "done";
      } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Workers are topped up as the queue grows rather than fixed when the batch starts: clicking
  // transcribe on five files one at a time starts with a queue of one, and without this the whole
  // batch would then run single-file while a second worker sat unused.
  const workers = new Set<Promise<void>>();
  function topUpWorkers() {
    if (readStatus(job) === "cancelling") return;
    const queuedCount = job.files.filter((e) => e.status === "queued").length;
    const wanted = Math.min(maxConcurrency, workers.size + queuedCount);
    while (workers.size < wanted) {
      const promise = worker().finally(() => workers.delete(promise));
      workers.add(promise);
    }
  }

  // Re-evaluated whenever a worker exits *or* appendToJob signals new work. Once this returns the
  // caller finalises the job in the same microtask, so a later append can only land on a finished
  // job — and startTranscription opens a fresh one for it.
  // The signal is sticky rather than a bare promise resolve: an append can land before the loop
  // is waiting (a worker's first synchronous stretch runs during topUpWorkers), and a signal
  // dropped in that window is exactly the case this exists to handle.
  let signalled = false;
  let wake: (() => void) | null = null;
  queueWakeups.set(job, () => {
    signalled = true;
    wake?.();
  });

  try {
    topUpWorkers();
    while (workers.size > 0) {
      if (!signalled) {
        await Promise.race([...workers, new Promise<void>((resolve) => (wake = resolve))]);
      }
      signalled = false;
      wake = null;
      topUpWorkers();
    }
  } finally {
    queueWakeups.delete(job);
  }
}

async function transcribeOneFile(
  modelPath: string,
  vadModelPath: string | null,
  entry: FileTranscriptionState
): Promise<void> {
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
    const { text, language } = await runWhisper(tempWavPath, modelPath, tempOutBase, vadModelPath);
    if (!text) throw new Error("whisper produced no transcript text (silent or unsupported audio?)");

    const repeatRun = longestRepeatedRun(text);
    db.insert(transcripts)
      .values({
        fileId: row.id,
        text,
        language,
        model: config.transcription.modelName,
        createdAt: Date.now(),
        repeatRun,
      })
      .onConflictDoUpdate({
        target: transcripts.fileId,
        set: { text, language, model: config.transcription.modelName, createdAt: Date.now(), repeatRun },
      })
      .run();

    entry.wordCount = text.split(/\s+/).filter(Boolean).length;
  } finally {
    fs.rmSync(tempWavPath, { force: true });
  }
}
