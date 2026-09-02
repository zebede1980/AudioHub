import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import { files, ratings, libraryRoots, syncConfig, syncedFiles } from "../db/schema.js";
import { tagsByFileId } from "../db/tagLookup.js";
import type { SyncMetadataPayload } from "./ingestManager.js";

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

interface TranscriptRow {
  fileId: number;
  text: string;
  language: string | null;
  model: string;
}

interface EligibleFile {
  id: number;
  relativePath: string;
  filename: string;
  fingerprint: string;
  containerPath: string;
  rating: number;
  tags: string[];
  transcript: { text: string; language: string | null; model: string } | null;
  metadataHash: string;
}

/** Rating + tags + transcript text, hashed — lets a re-sync tell "nothing changed" from "the
 * audio is fine but you edited a tag/rating/transcript since the last push" without re-sending
 * everything unconditionally on every run. */
function computeMetadataHash(rating: number, tagNames: string[], transcript: { text: string } | null): string {
  const h = crypto.createHash("sha1");
  h.update(JSON.stringify({ rating, tags: [...tagNames].sort() }));
  if (transcript) h.update(transcript.text);
  return h.digest("hex");
}

async function runPush(job: SyncJobState, cfg: NonNullable<ReturnType<typeof getSyncConfigRow>>): Promise<void> {
  const minRating = cfg.minRating;

  const baseRows = db
    .select({
      id: files.id,
      relativePath: files.relativePath,
      filename: files.filename,
      fingerprint: files.fingerprint,
      containerPath: libraryRoots.containerPath,
      rating: ratings.rating,
    })
    .from(files)
    .innerJoin(ratings, eq(ratings.fileId, files.id))
    .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
    .where(and(gte(ratings.rating, minRating), isNull(files.deletedAt), isNotNull(files.fingerprint)))
    .all() as (Omit<EligibleFile, "tags" | "transcript" | "metadataHash"> & { rating: number })[];

  const fileIds = baseRows.map((r) => r.id);
  const tagsByFile = tagsByFileId(fileIds);
  const transcriptRows = fileIds.length
    ? (rawDb
        .prepare(`SELECT file_id as fileId, text, language, model FROM transcripts WHERE file_id IN (${fileIds.map(() => "?").join(",")})`)
        .all(...fileIds) as TranscriptRow[])
    : [];
  const transcriptByFile = new Map(transcriptRows.map((r) => [r.fileId, { text: r.text, language: r.language, model: r.model }]));

  const eligible: EligibleFile[] = baseRows.map((r) => {
    const tagNames = (tagsByFile.get(r.id) ?? []).map((t) => t.name);
    const transcript = transcriptByFile.get(r.id) ?? null;
    return { ...r, tags: tagNames, transcript, metadataHash: computeMetadataHash(r.rating, tagNames, transcript) };
  });

  const eligibleIds = new Set(eligible.map((f) => f.id));
  const syncedRows = db.select().from(syncedFiles).all();
  const syncedByFileId = new Map(syncedRows.filter((r) => r.fileId !== null).map((r) => [r.fileId as number, r]));

  // Anything new, previously errored, or whose audio content OR rating/tags/transcript changed
  // since the last successful push needs a sync pass (the pass itself decides below whether that
  // means re-transferring the audio bytes or just pushing fresh metadata).
  const toSync = eligible.filter((f) => {
    const existing = syncedByFileId.get(f.id);
    return (
      !existing ||
      existing.status === "error" ||
      existing.contentHash !== f.fingerprint ||
      existing.metadataHash !== f.metadataHash
    );
  });
  // Anything previously synced whose source file either no longer qualifies (de-rated, deleted,
  // moved off the library) or whose content changed needs the stale remote copy cleaned up —
  // a changed fingerprint re-uploads under the new hash, so the old hash is now orphaned too.
  const toDelete = syncedRows.filter(
    (r) =>
      r.status === "synced" &&
      (r.fileId === null ||
        !eligibleIds.has(r.fileId) ||
        (() => {
          const f = eligible.find((e) => e.id === r.fileId);
          return f !== undefined && f.fingerprint !== r.contentHash;
        })())
  );

  job.entries = [
    ...toSync.map((f) => ({ fileId: f.id, relativePath: f.relativePath, action: "upload" as const, status: "queued" as const })),
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
    const f = toSync.find((x) => x.id === entry.fileId)!;
    entry.status = "in-progress";
    try {
      if (!manifest.has(f.fingerprint)) {
        await uploadFile(cfg, f);
      }
      await pushMetadata(cfg, f.fingerprint, { rating: f.rating, tags: f.tags, transcript: f.transcript });
      upsertSyncedFile(f.id, f.fingerprint, f.relativePath, f.metadataHash, "synced");
      entry.status = "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = message;
      upsertSyncedFile(f.id, f.fingerprint, f.relativePath, f.metadataHash, "error", message);
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

function upsertSyncedFile(
  fileId: number,
  contentHash: string,
  relativePath: string,
  metadataHash: string,
  status: "synced" | "error",
  lastError?: string
) {
  const existing = db.select().from(syncedFiles).where(eq(syncedFiles.contentHash, contentHash)).get();
  if (existing) {
    db.update(syncedFiles)
      .set({ fileId, relativePath, metadataHash, status, lastError: lastError ?? null, syncedAt: Date.now() })
      .where(eq(syncedFiles.id, existing.id))
      .run();
  } else {
    db.insert(syncedFiles)
      .values({ fileId, contentHash, relativePath, metadataHash, status, lastError: lastError ?? null, syncedAt: Date.now() })
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

const METADATA_RETRY_ATTEMPTS = 15;
const METADATA_RETRY_DELAY_MS = 1500;

/**
 * Applies rating/tags/transcript on the remote, retrying while the remote reports the file as
 * "uploaded but not scanned yet" (425) — the library rescan the upload triggers runs async on the
 * remote, so there's necessarily a short window right after a fresh upload where this would
 * otherwise 404/425 if sent without retrying.
 */
async function pushMetadata(
  cfg: { remoteBaseUrl: string | null; remoteApiKey: string | null },
  contentHash: string,
  payload: SyncMetadataPayload
): Promise<void> {
  const url = new URL(`/api/sync/metadata/${encodeURIComponent(contentHash)}`, cfg.remoteBaseUrl!);
  for (let attempt = 1; attempt <= METADATA_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${cfg.remoteApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 425 && attempt < METADATA_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, METADATA_RETRY_DELAY_MS));
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`metadata push failed: ${res.status} ${text.slice(0, 200)}`);
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
