import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { syncConfig, syncReceipts, libraryRoots } from "../db/schema.js";
import { sanitizeForFilesystem } from "../scraper/downloadManager.js";
import { startScan } from "../scanner/scanManager.js";
import { pruneEmptyAncestorDirs } from "../scanner/pruneEmptyDirs.js";

export interface SyncUploadMeta {
  contentHash: string;
  filename: string;
  folderPath?: string;
}

export function getSyncConfig() {
  return db.select().from(syncConfig).where(eq(syncConfig.id, 1)).get();
}

/** The library root + on-disk location this instance writes accepted pushes into, if configured. */
function getIngestTarget(): { rootId: number; containerPath: string } {
  const cfg = getSyncConfig();
  if (!cfg?.ingestApiKey || !cfg.ingestLibraryRootId) {
    throw new Error("Sync ingest is not configured on this server — set it up in Settings first.");
  }
  const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, cfg.ingestLibraryRootId)).get();
  if (!root) {
    throw new Error("The configured ingest library root no longer exists.");
  }
  return { rootId: root.id, containerPath: root.containerPath };
}

export function listManifest(): string[] {
  return db
    .select({ contentHash: syncReceipts.contentHash })
    .from(syncReceipts)
    .all()
    .map((r) => r.contentHash);
}

/**
 * Writes an incoming push to disk under <root>/Synced/<folderPath>/<filename> and records a
 * receipt keyed by contentHash, so a repeat push of identical content (or a manifest check) is a
 * cheap no-op instead of a redundant transfer/write.
 */
export async function ingestUpload(meta: SyncUploadMeta, body: Readable): Promise<void> {
  const { rootId, containerPath } = getIngestTarget();

  const existing = db.select().from(syncReceipts).where(eq(syncReceipts.contentHash, meta.contentHash)).get();
  const folderSegments = (meta.folderPath ?? "")
    .split("/")
    .filter(Boolean)
    .map((seg) => sanitizeForFilesystem(seg, 100));
  const safeFilename = sanitizeForFilesystem(meta.filename, 200);
  const relativePath = ["Synced", ...folderSegments, safeFilename].join("/");
  const destPath = path.join(containerPath, ...relativePath.split("/"));

  if (existing && fs.existsSync(destPath)) {
    return; // already present — idempotent no-op
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.part`;
  try {
    await pipeline(body, fs.createWriteStream(tempPath));
    fs.renameSync(tempPath, destPath);
  } catch (err) {
    fs.rm(tempPath, { force: true }, () => {});
    throw err;
  }

  if (existing) {
    db.update(syncReceipts)
      .set({ relativePath, receivedAt: Date.now(), libraryRootId: rootId })
      .where(eq(syncReceipts.contentHash, meta.contentHash))
      .run();
  } else {
    db.insert(syncReceipts)
      .values({ contentHash: meta.contentHash, libraryRootId: rootId, relativePath, receivedAt: Date.now() })
      .run();
  }

  startScan(rootId, containerPath);
}

/** Idempotent: a contentHash with no matching receipt is treated as already-deleted, not an error. */
export function ingestDelete(contentHash: string): void {
  const receipt = db.select().from(syncReceipts).where(eq(syncReceipts.contentHash, contentHash)).get();
  if (!receipt) return;

  const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, receipt.libraryRootId)).get();
  if (root) {
    const absPath = path.join(root.containerPath, ...receipt.relativePath.split("/"));
    fs.rmSync(absPath, { force: true });
    pruneEmptyAncestorDirs(path.dirname(absPath), root.containerPath);
    startScan(root.id, root.containerPath);
  }

  db.delete(syncReceipts).where(eq(syncReceipts.contentHash, contentHash)).run();
}
