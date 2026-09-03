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
  /** True when this job only indexed an explicit list of paths rather than walking the whole root. */
  targeted?: boolean;
}

const jobs = new Map<number, ScanJobState>();

/** Callbacks waiting for the current scan of a root to finish — used by trash restore, which can
 * only re-apply a folder's ratings/tags/transcripts once the scan has re-indexed its files. */
const completionWaiters = new Map<number, (() => void)[]>();

/**
 * Work for roots that changed while a scan was already in flight. That scan may have walked past
 * the affected folder before the change landed (an import writing a file, a delete moving a folder
 * to the trash), so its result can't be trusted to include it — the follow-up is queued and run as
 * soon as the current one finishes. Without this, an import that lands mid-scan stays invisible in
 * the library until the next manual or nightly scan.
 */
interface PendingWork {
  containerPath: string;
  /** A full walk was asked for. It subsumes any targeted paths queued alongside it. */
  full: boolean;
  relativePaths: Set<string>;
}
const pendingWork = new Map<number, PendingWork>();

function queueWork(libraryRootId: number, containerPath: string, relativePaths?: string[]) {
  const work = pendingWork.get(libraryRootId) ?? { containerPath, full: false, relativePaths: new Set<string>() };
  work.containerPath = containerPath;
  if (relativePaths) for (const relativePath of relativePaths) work.relativePaths.add(relativePath);
  else work.full = true;
  pendingWork.set(libraryRootId, work);
}

function drainWaiters(libraryRootId: number) {
  const waiters = completionWaiters.get(libraryRootId);
  completionWaiters.delete(libraryRootId);
  for (const waiter of waiters ?? []) {
    try {
      waiter();
    } catch {
      // A failed post-scan step must never take down the scan bookkeeping.
    }
  }
}

export function getScanStatus(libraryRootId: number): ScanJobState | undefined {
  return jobs.get(libraryRootId);
}

/** Walks the entire library root: the only mode that can notice files that were moved or removed. */
export function startScan(libraryRootId: number, containerPath: string, onComplete?: () => void): ScanJobState {
  return startWorker(libraryRootId, containerPath, undefined, onComplete);
}

/**
 * Indexes just `relativePaths` (library-root-relative, forward-slash). For a caller that knows
 * exactly which files it wrote — an import, a conversion — this replaces a walk of the whole
 * library with work proportional to what actually changed.
 *
 * Cannot detect moves or deletions: use startScan for anything that removes or relocates files.
 */
export function startIndexPaths(
  libraryRootId: number,
  containerPath: string,
  relativePaths: string[],
  onComplete?: () => void
): ScanJobState | undefined {
  if (relativePaths.length === 0) {
    onComplete?.();
    return jobs.get(libraryRootId);
  }
  return startWorker(libraryRootId, containerPath, relativePaths, onComplete);
}

function startWorker(
  libraryRootId: number,
  containerPath: string,
  relativePaths: string[] | undefined,
  onComplete?: () => void
): ScanJobState {
  if (onComplete) {
    completionWaiters.set(libraryRootId, [...(completionWaiters.get(libraryRootId) ?? []), onComplete]);
  }

  const existing = jobs.get(libraryRootId);
  if (existing?.status === "running") {
    // Don't just join it — see pendingWork. Any waiter stays registered and fires after the
    // follow-up run instead, which is the one guaranteed to have seen the caller's change.
    queueWork(libraryRootId, containerPath, relativePaths);
    return existing;
  }

  const targeted = relativePaths !== undefined;
  const job: ScanJobState = {
    status: "running",
    progress: { foldersScanned: 0, filesScanned: 0, filesChanged: 0 },
    startedAt: Date.now(),
    targeted,
  };
  jobs.set(libraryRootId, job);

  db.update(libraryRoots)
    .set({ lastScanStatus: "running", lastScanError: null })
    .where(eq(libraryRoots.id, libraryRootId))
    .run();

  const worker = new Worker(resolveWorkerUrl(), {
    workerData: { libraryRootId, containerPath, databasePath: config.databasePath, relativePaths },
  });

  worker.on("message", (msg: { type: string; progress?: ScanProgress; result?: ScanResult; message?: string }) => {
    if (msg.type === "progress" && msg.progress) {
      job.progress = msg.progress;
    } else if (msg.type === "done") {
      job.status = "ok";
      job.result = msg.result;
      job.finishedAt = Date.now();
      // lastScannedAt means "the whole root was verified at this time", which a targeted index
      // hasn't done — leave the previous full scan's timestamp standing rather than overstating it.
      db.update(libraryRoots)
        .set(
          targeted
            ? { lastScanStatus: "ok", lastScanError: null }
            : { lastScanStatus: "ok", lastScannedAt: job.finishedAt, lastScanError: null }
        )
        .where(eq(libraryRoots.id, libraryRootId))
        .run();
      settleOrRescan(libraryRootId);
    } else if (msg.type === "error") {
      job.status = "error";
      job.error = msg.message;
      job.finishedAt = Date.now();
      db.update(libraryRoots)
        .set({ lastScanStatus: "error", lastScanError: msg.message ?? "unknown error" })
        .where(eq(libraryRoots.id, libraryRootId))
        .run();
      settleOrRescan(libraryRootId);
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
    settleOrRescan(libraryRootId);
  });

  return job;
}

/** Either runs the follow-up work queued while this run was in flight, or, if there is none, lets
 * everything waiting on the scan proceed. */
function settleOrRescan(libraryRootId: number) {
  const work = pendingWork.get(libraryRootId);
  if (work === undefined) {
    drainWaiters(libraryRootId);
    return;
  }
  pendingWork.delete(libraryRootId);
  if (work.full) startScan(libraryRootId, work.containerPath);
  else startIndexPaths(libraryRootId, work.containerPath, [...work.relativePaths]);
}

export async function scanAllEnabledRoots(): Promise<void> {
  const roots = db.select().from(libraryRoots).where(eq(libraryRoots.enabled, 1)).all();
  for (const root of roots) {
    startScan(root.id, root.containerPath);
  }
}
