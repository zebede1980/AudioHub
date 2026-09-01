import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { libraryRoots } from "../db/schema.js";
import { config } from "../config.js";
import type { ScanProgress, ScanResult } from "./scan.js";

/**
 * In a compiled build "worker.js" sits alongside this file and can be loaded directly. Under
 * `tsx watch` dev, only "worker.ts" exists, so we point at a plain-JS bootstrap that registers
 * tsx's loader in the new thread first (worker_threads doesn't inherit it automatically).
 */
function resolveWorkerUrl(): URL {
  const compiled = new URL("./worker.js", import.meta.url);
  if (fs.existsSync(fileURLToPath(compiled))) return compiled;
  return new URL("./worker-entry.mjs", import.meta.url);
}

export interface ScanJobState {
  status: "running" | "ok" | "error";
  progress: ScanProgress;
  result?: ScanResult;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<number, ScanJobState>();

export function getScanStatus(libraryRootId: number): ScanJobState | undefined {
  return jobs.get(libraryRootId);
}

export function startScan(libraryRootId: number, containerPath: string): ScanJobState {
  const existing = jobs.get(libraryRootId);
  if (existing?.status === "running") return existing;

  const job: ScanJobState = {
    status: "running",
    progress: { foldersScanned: 0, filesScanned: 0, filesChanged: 0 },
    startedAt: Date.now(),
  };
  jobs.set(libraryRootId, job);

  db.update(libraryRoots)
    .set({ lastScanStatus: "running", lastScanError: null })
    .where(eq(libraryRoots.id, libraryRootId))
    .run();

  const worker = new Worker(resolveWorkerUrl(), {
    workerData: { libraryRootId, containerPath, databasePath: config.databasePath },
  });

  worker.on("message", (msg: { type: string; progress?: ScanProgress; result?: ScanResult; message?: string }) => {
    if (msg.type === "progress" && msg.progress) {
      job.progress = msg.progress;
    } else if (msg.type === "done") {
      job.status = "ok";
      job.result = msg.result;
      job.finishedAt = Date.now();
      db.update(libraryRoots)
        .set({ lastScanStatus: "ok", lastScannedAt: job.finishedAt, lastScanError: null })
        .where(eq(libraryRoots.id, libraryRootId))
        .run();
    } else if (msg.type === "error") {
      job.status = "error";
      job.error = msg.message;
      job.finishedAt = Date.now();
      db.update(libraryRoots)
        .set({ lastScanStatus: "error", lastScanError: msg.message ?? "unknown error" })
        .where(eq(libraryRoots.id, libraryRootId))
        .run();
    }
  });

  worker.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
    job.finishedAt = Date.now();
    db.update(libraryRoots)
      .set({ lastScanStatus: "error", lastScanError: err.message })
      .where(eq(libraryRoots.id, libraryRootId))
      .run();
  });

  return job;
}

export async function scanAllEnabledRoots(): Promise<void> {
  const roots = db.select().from(libraryRoots).where(eq(libraryRoots.enabled, 1)).all();
  for (const root of roots) {
    startScan(root.id, root.containerPath);
  }
}
