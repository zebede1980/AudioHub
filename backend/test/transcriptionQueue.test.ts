import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Isolated DB/paths: importing the manager pulls in the db client, which opens a database on load.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-queue-test-"));
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { drainQueue, appendToJob } = await import("../src/transcription/transcriptionManager.js");
type Job = Parameters<typeof appendToJob>[0];
type Entry = Job["files"][number];

function jobWith(fileIds: number[]): Job {
  return {
    status: "running",
    files: fileIds.map((fileId) => ({ fileId, relativePath: "", status: "queued" as const })),
    startedAt: Date.now(),
  };
}

/** Resolves on the next macrotask, so a test can act "while" the queue is mid-flight. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("every queued file is processed exactly once", async () => {
  const job = jobWith([1, 2, 3, 4, 5]);
  const processed: number[] = [];

  await drainQueue(job, 2, async (entry) => {
    processed.push(entry.fileId);
    await tick();
  });

  assert.deepEqual(processed.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(processed.length, new Set(processed).size, "no file is transcribed twice");
  assert.ok(job.files.every((f) => f.status === "done"));
});

test("concurrency never exceeds the cap", async () => {
  const job = jobWith([1, 2, 3, 4, 5, 6]);
  let inFlight = 0;
  let peak = 0;

  await drainQueue(job, 2, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
  });

  assert.equal(peak, 2);
});

test("files appended mid-run are picked up by the same batch", async () => {
  const job = jobWith([1]);
  const processed: number[] = [];

  const drain = drainQueue(job, 1, async (entry) => {
    processed.push(entry.fileId);
    // Clicking "transcribe" on more files while the first one is still going.
    if (entry.fileId === 1) appendToJob(job, [2, 3]);
    await tick();
  });
  await drain;

  assert.deepEqual(processed, [1, 2, 3], "the batch kept going instead of finishing after file 1");
  assert.ok(job.files.every((f) => f.status === "done"));
});

test("appending mid-run brings the second worker into play", async () => {
  // The real shape of "click transcribe on several files in a row": the batch starts with one
  // file queued, so it must grow its worker pool as the rest arrive rather than staying at one.
  const job = jobWith([1]);
  let inFlight = 0;
  let peak = 0;

  await drainQueue(job, 2, async (entry) => {
    if (entry.fileId === 1) appendToJob(job, [2, 3, 4]);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick();
    await tick();
    inFlight--;
  });

  assert.equal(peak, 2, "the batch ran single-file even though more work had arrived");
  assert.ok(job.files.every((f) => f.status === "done"));
  assert.equal(job.files.length, 4);
});

test("a file already waiting is not queued twice, and a finished one can be retried", async () => {
  const job = jobWith([1, 2]);
  job.files[0].status = "done";
  job.files[0].wordCount = 42;
  job.files[1].status = "error";
  job.files[1].error = "whisper fell over";

  // 1 and 2 are finished/failed → both re-queued; 3 is new.
  const first = appendToJob(job, [1, 2, 3]);
  assert.deepEqual(first, { addedCount: 3, alreadyPendingCount: 0 });
  assert.equal(job.files[1].error, undefined, "a retry clears the previous error");
  assert.equal(job.files[0].wordCount, undefined, "a retry clears the previous result");

  // Asking again while they sit queued is a no-op rather than a duplicate.
  const second = appendToJob(job, [1, 2, 3]);
  assert.deepEqual(second, { addedCount: 0, alreadyPendingCount: 3 });
  assert.equal(job.files.length, 3, "no duplicate rows in the status list");
});

test("cancelling stops the queue and leaves the rest untouched", async () => {
  const job = jobWith([1, 2, 3, 4]);
  const processed: number[] = [];

  await drainQueue(job, 1, async (entry) => {
    processed.push(entry.fileId);
    if (entry.fileId === 2) job.status = "cancelling";
    await tick();
  });

  assert.deepEqual(processed, [1, 2], "no further files start after the cancel");
  assert.deepEqual(
    job.files.map((f) => f.status),
    ["done", "done", "queued", "queued"]
  );
});

test("a file that fails does not stop the rest of the batch", async () => {
  const job = jobWith([1, 2, 3]);

  await drainQueue(job, 1, async (entry: Entry) => {
    if (entry.fileId === 2) throw new Error("no audio stream");
    await tick();
  });

  assert.deepEqual(
    job.files.map((f) => f.status),
    ["done", "error", "done"]
  );
  assert.equal(job.files[1].error, "no audio stream");
});

test.after(async () => {
  const { rawDb } = await import("../src/db/client.js");
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
