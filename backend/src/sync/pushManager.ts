import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, ratings, libraryRoots, syncConfig, syncedFiles } from "../db/schema.js";

export interface SyncPushEntry {
  fileId: number;
  relativePath: string;
  action: "upload" | "delete";
  status: "queued" | "in-progress" | "done" | "skipped" | "error";
  error?: string;
}

export interface SyncJobState {
  status: "running" | "done" | "error";
  entries: SyncPushEntry[];
  startedAt: number;
  finishedAt?: number;
}

let currentJob: SyncJobState | null = null;

export function getSyncJob(): SyncJobState | null {
  return currentJob;
}

export function getSyncConfigRow() {
  return db.select().from(syncConfig).where(eq(syncConfig.id, 1)).get();
}

/** Only one push run at a time; calling this while one is in flight just returns it. */
export function startSyncPush(): SyncJobState {
  if (currentJob && currentJob.status === "running") return currentJob;

  const cfg = getSyncConfigRow();
  if (!cfg?.remoteBaseUrl || !cfg.remoteApiKey) {
    throw new Error("Cloud sync target is not configured — set the remote URL and API key in Settings first.");
  }

  const job: SyncJobState = { status: "running", entries: [], startedAt: Date.now() };
  currentJob = job;

  runPush(job, cfg).catch((err) => {
    job.status = "error";
    job.finishedAt = Date.now();
    console.error("sync push job crashed", err);
  });

  return job;
}

interface EligibleFile {
  id: number;
  relativePath: string;
  filename: string;
  title: string | null;
  trackNumber: number | null;
  durationSec: number | null;
  fingerprint: string;
  containerPath: string;
}

async function runPush(job: SyncJobState, cfg: NonNullable<ReturnType<typeof getSyncConfigRow>>): Promise<void> {
  const minRating = cfg.minRating;

  const eligible = db
    .select({
      id: files.id,
      relativePath: files.relativePath,
      filename: files.filename,
      title: files.title,
      trackNumber: files.trackNumber,
      durationSec: files.durationSec,
      fingerprint: files.fingerprint,
      containerPath: libraryRoots.containerPath,
    })
    .from(files)
    .innerJoin(ratings, eq(ratings.fileId, files.id))
    .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
    .where(and(gte(ratings.rating, minRating), isNull(files.deletedAt), isNotNull(files.fingerprint)))
    .all() as EligibleFile[];

  const eligibleIds = new Set(eligible.map((f) => f.id));
  const syncedRows = db.select().from(syncedFiles).all();
  const syncedByFileId = new Map(syncedRows.filter((r) => r.fileId !== null).map((r) => [r.fileId as number, r]));

  const toUpload = eligible.filter((f) => {
    const existing = syncedByFileId.get(f.id);
    return !existing || existing.status === "error" || existing.contentHash !== f.fingerprint;
  });
  // Anything previously synced whose source file either no longer qualifies (de-rated, deleted,
  // moved off the library) or whose content changed needs the stale remote copy cleaned up —
  // a changed fingerprint re-uploads under the new hash, so the old hash is now orphaned too.
  const toDelete = syncedRows.filter(
    (r) => r.status === "synced" && (r.fileId === null || !eligibleIds.has(r.fileId) || (() => {
      const f = eligible.find((e) => e.id === r.fileId);
      return f !== undefined && f.fingerprint !== r.contentHash;
    })())
  );

  job.entries = [
    ...toUpload.map((f) => ({ fileId: f.id, relativePath: f.relativePath, action: "upload" as const, status: "queued" as const })),
    ...toDelete.map((r) => ({ fileId: r.fileId ?? -1, relativePath: r.relativePath, action: "delete" as const, status: "queued" as const })),
  ];

  let manifest = new Set<string>();
  try {
    const res = await fetch(new URL("/api/sync/manifest", cfg.remoteBaseUrl!), {
      headers: { Authorization: `Bearer ${cfg.remoteApiKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { contentHashes: string[] };
      manifest = new Set(data.contentHashes);
    }
  } catch {
    // Fall through without the dedupe optimization — uploads still proceed, the remote is
    // idempotent on contentHash so a redundant push just costs bandwidth, not correctness.
  }

  for (const entry of job.entries.filter((e) => e.action === "upload")) {
    const f = toUpload.find((x) => x.id === entry.fileId)!;
    entry.status = "in-progress";
    try {
      if (!manifest.has(f.fingerprint)) {
        await uploadFile(cfg, f);
      }
      upsertSyncedFile(f.id, f.fingerprint, f.relativePath, "synced");
      entry.status = "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = message;
      upsertSyncedFile(f.id, f.fingerprint, f.relativePath, "error", message);
    }
  }

  for (const entry of job.entries.filter((e) => e.action === "delete")) {
    const r = toDelete.find((x) => (x.fileId ?? -1) === entry.fileId && x.relativePath === entry.relativePath)!;
    entry.status = "in-progress";
    try {
      await deleteRemote(cfg, r.contentHash);
      db.delete(syncedFiles).where(eq(syncedFiles.id, r.id)).run();
      entry.status = "done";
    } catch (err) {
      // Leave the synced_files row in place so this is retried on the next run rather than
      // silently forgotten.
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
    }
  }

  job.status = "done";
  job.finishedAt = Date.now();
}

function upsertSyncedFile(fileId: number, contentHash: string, relativePath: string, status: "synced" | "error", lastError?: string) {
  const existing = db.select().from(syncedFiles).where(eq(syncedFiles.contentHash, contentHash)).get();
  if (existing) {
    db.update(syncedFiles)
      .set({ fileId, relativePath, status, lastError: lastError ?? null, syncedAt: Date.now() })
      .where(eq(syncedFiles.id, existing.id))
      .run();
  } else {
    db.insert(syncedFiles)
      .values({ fileId, contentHash, relativePath, status, lastError: lastError ?? null, syncedAt: Date.now() })
      .run();
  }
}

async function uploadFile(cfg: { remoteBaseUrl: string | null; remoteApiKey: string | null }, f: EligibleFile): Promise<void> {
  const absPath = path.join(f.containerPath, ...f.relativePath.split("/"));
  const stat = fs.statSync(absPath);
  const meta = {
    contentHash: f.fingerprint,
    filename: f.filename,
    folderPath: path.posix.dirname(f.relativePath),
  };

  const res = await fetch(new URL("/api/sync/upload", cfg.remoteBaseUrl!), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.remoteApiKey}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "X-Sync-Meta": Buffer.from(JSON.stringify(meta), "utf8").toString("base64"),
    },
    duplex: "half",
    body: fs.createReadStream(absPath),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function deleteRemote(cfg: { remoteBaseUrl: string | null; remoteApiKey: string | null }, contentHash: string): Promise<void> {
  const res = await fetch(new URL(`/api/sync/files/${encodeURIComponent(contentHash)}`, cfg.remoteBaseUrl!), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cfg.remoteApiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`remote delete failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
