import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import {
  fileTags,
  files,
  folderRatings,
  folders,
  libraryRoots,
  ratings,
  tags,
  transcripts,
  trashEntries,
} from "../db/schema.js";
import { config } from "../config.js";
import { startScan } from "../scanner/scanManager.js";
import { pruneEmptyAncestorDirs } from "../scanner/pruneEmptyDirs.js";
import { TRASH_DIR_NAME, trashDirFor, trashEntryName } from "./trashPaths.js";
import { descendantPathFilter } from "./folderContents.js";

export interface TrashMetadataSnapshot {
  version: 1;
  /** Paths are relative to the library root, as they were before the move. */
  files: {
    relativePath: string;
    rating: number | null;
    tags: string[];
    transcript: { text: string; language: string | null; model: string } | null;
  }[];
  /** Ratings of folders *inside* the deleted one. The deleted folder's own rating is deliberately
   * left out — it is the 1 star that put it here, and restoring it would re-arm the deletion. */
  folderRatings: { relativePath: string; rating: number }[];
}

function sidecarPathFor(containerPath: string, trashRelativePath: string): string {
  return path.join(containerPath, `${trashRelativePath}.json`);
}

/** Captures ratings/tags/transcripts of everything under a folder before it leaves the library.
 * The scanner drops those rows once the audio is gone (folder rows cascade to files, and files
 * cascade to ratings/tags/transcripts), so without this a restore would bring back bare audio. */
export function snapshotFolderMetadata(libraryRootId: number, relativePath: string): TrashMetadataSnapshot {
  const fileRows = db
    .select({ id: files.id, relativePath: files.relativePath, rating: ratings.rating })
    .from(files)
    .leftJoin(ratings, eq(ratings.fileId, files.id))
    .where(and(eq(files.libraryRootId, libraryRootId), isNull(files.deletedAt), descendantPathFilter(relativePath)))
    .all();

  const fileIds = fileRows.map((f) => f.id);
  const tagRows = fileIds.length
    ? db
        .select({ fileId: fileTags.fileId, name: tags.name })
        .from(fileTags)
        .innerJoin(tags, eq(tags.id, fileTags.tagId))
        .where(inArray(fileTags.fileId, fileIds))
        .all()
    : [];
  const tagsByFile = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = tagsByFile.get(row.fileId) ?? [];
    list.push(row.name);
    tagsByFile.set(row.fileId, list);
  }

  const transcriptRows = fileIds.length
    ? db
        .select({
          fileId: transcripts.fileId,
          text: transcripts.text,
          language: transcripts.language,
          model: transcripts.model,
        })
        .from(transcripts)
        .where(inArray(transcripts.fileId, fileIds))
        .all()
    : [];
  const transcriptByFile = new Map(
    transcriptRows.map((r) => [r.fileId, { text: r.text, language: r.language, model: r.model }])
  );

  const snapshotFiles = fileRows
    .map((f) => ({
      relativePath: f.relativePath,
      rating: f.rating ?? null,
      tags: tagsByFile.get(f.id) ?? [],
      transcript: transcriptByFile.get(f.id) ?? null,
    }))
    .filter((f) => f.rating !== null || f.tags.length > 0 || f.transcript !== null);

  const subfolderRatings = db
    .select({ relativePath: folders.relativePath, rating: folderRatings.rating })
    .from(folderRatings)
    .innerJoin(folders, eq(folders.id, folderRatings.folderId))
    .where(and(eq(folders.libraryRootId, libraryRootId), descendantPathFilter(relativePath)))
    .all()
    .filter((r) => r.relativePath !== relativePath);

  return { version: 1, files: snapshotFiles, folderRatings: subfolderRatings };
}

export interface MoveToTrashResult {
  trashEntryId: number;
  folderId: number;
  name: string;
  originalRelativePath: string;
  libraryRootId: number;
  containerPath: string;
  fileCount: number;
  sizeBytes: number;
}

/**
 * Moves one library folder into its root's trash directory (a same-filesystem rename), recording
 * everything needed to put it back. Library bookkeeping is left to the scan the caller triggers
 * afterwards — the same machinery that already handles a folder vanishing from disk.
 */
export function moveFolderToTrash(folderId: number): MoveToTrashResult {
  const folder = db
    .select({
      id: folders.id,
      name: folders.name,
      relativePath: folders.relativePath,
      libraryRootId: folders.libraryRootId,
      containerPath: libraryRoots.containerPath,
    })
    .from(folders)
    .innerJoin(libraryRoots, eq(libraryRoots.id, folders.libraryRootId))
    .where(eq(folders.id, folderId))
    .get();

  if (!folder) throw new Error(`folder ${folderId} not found`);
  if (!folder.relativePath) throw new Error("refusing to delete a library root itself");

  const containerPath = path.resolve(folder.containerPath);
  const absPath = path.resolve(containerPath, folder.relativePath);
  // Defence in depth against a relative_path that escapes its root (a crafted row, a future bug in
  // path handling): never move anything that isn't genuinely inside the library root.
  if (!absPath.startsWith(containerPath + path.sep)) {
    throw new Error("folder path resolves outside its library root");
  }

  const stats = db
    .select({
      fileCount: sql<number>`COUNT(*)`,
      sizeBytes: sql<number>`COALESCE(SUM(${files.sizeBytes}), 0)`,
    })
    .from(files)
    .where(
      and(
        eq(files.libraryRootId, folder.libraryRootId),
        isNull(files.deletedAt),
        descendantPathFilter(folder.relativePath)
      )
    )
    .get() ?? { fileCount: 0, sizeBytes: 0 };

  const snapshot = snapshotFolderMetadata(folder.libraryRootId, folder.relativePath);

  const deletedAt = Date.now();
  const trashDir = trashDirFor(containerPath);
  fs.mkdirSync(trashDir, { recursive: true });

  const baseName = trashEntryName(folder.relativePath, deletedAt);
  let entryName = baseName;
  for (let suffix = 2; fs.existsSync(path.join(trashDir, entryName)); suffix++) {
    entryName = `${baseName}-${suffix}`;
  }
  const destination = path.join(trashDir, entryName);

  moveDirectory(absPath, destination);
  pruneEmptyAncestorDirs(path.dirname(absPath), containerPath);

  const trashRelativePath = `${TRASH_DIR_NAME}/${entryName}`;
  const inserted = db
    .insert(trashEntries)
    .values({
      libraryRootId: folder.libraryRootId,
      originalRelativePath: folder.relativePath,
      trashRelativePath,
      name: folder.name,
      fileCount: Number(stats.fileCount),
      sizeBytes: Number(stats.sizeBytes),
      deletedAt,
      metadataSnapshot: JSON.stringify(snapshot),
    })
    .returning({ id: trashEntries.id })
    .get();

  writeSidecar(containerPath, trashRelativePath, {
    originalRelativePath: folder.relativePath,
    name: folder.name,
    deletedAt,
    fileCount: Number(stats.fileCount),
    sizeBytes: Number(stats.sizeBytes),
    metadataSnapshot: snapshot,
  });

  return {
    trashEntryId: inserted.id,
    folderId: folder.id,
    name: folder.name,
    originalRelativePath: folder.relativePath,
    libraryRootId: folder.libraryRootId,
    containerPath,
    fileCount: Number(stats.fileCount),
    sizeBytes: Number(stats.sizeBytes),
  };
}

interface Sidecar {
  originalRelativePath: string;
  name: string;
  deletedAt: number;
  fileCount: number;
  sizeBytes: number;
  metadataSnapshot: TrashMetadataSnapshot;
}

/** Written next to (not inside) the trashed folder, so restoring by hand stays a plain move — and
 * so a lost database can be re-seeded from what's on disk. See adoptOrphanTrashDirs. */
function writeSidecar(containerPath: string, trashRelativePath: string, sidecar: Sidecar): void {
  try {
    fs.writeFileSync(sidecarPathFor(containerPath, trashRelativePath), JSON.stringify(sidecar, null, 2));
  } catch {
    // A missing sidecar only costs manual recoverability — the DB row is the source of truth.
  }
}

/** rename() first (instant, same filesystem); a cross-device root falls back to copy-then-remove. */
function moveDirectory(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

export interface TrashEntryView {
  id: number;
  name: string;
  originalRelativePath: string;
  libraryRootId: number;
  libraryRootName: string;
  fileCount: number;
  sizeBytes: number;
  deletedAt: number;
  /** When the retention sweep will purge it for real. */
  expiresAt: number;
  /** False when the directory is gone from disk (removed by hand) — restore is impossible. */
  presentOnDisk: boolean;
}

export function listTrash(): TrashEntryView[] {
  adoptOrphanTrashDirs();

  const retentionMs = config.trash.retentionDays * 24 * 60 * 60 * 1000;
  return db
    .select({
      id: trashEntries.id,
      name: trashEntries.name,
      originalRelativePath: trashEntries.originalRelativePath,
      trashRelativePath: trashEntries.trashRelativePath,
      libraryRootId: trashEntries.libraryRootId,
      libraryRootName: libraryRoots.name,
      containerPath: libraryRoots.containerPath,
      fileCount: trashEntries.fileCount,
      sizeBytes: trashEntries.sizeBytes,
      deletedAt: trashEntries.deletedAt,
    })
    .from(trashEntries)
    .innerJoin(libraryRoots, eq(libraryRoots.id, trashEntries.libraryRootId))
    .orderBy(desc(trashEntries.deletedAt))
    .all()
    .map(({ containerPath, trashRelativePath, ...row }) => ({
      ...row,
      expiresAt: row.deletedAt + retentionMs,
      presentOnDisk: fs.existsSync(path.join(containerPath, trashRelativePath)),
    }));
}

/** A trash directory with no database row — the database was reset or restored from an older
 * backup while the files stayed put. Re-registering it from its sidecar keeps that space visible
 * and recoverable instead of silently stranded. */
function adoptOrphanTrashDirs(): void {
  const roots = db.select().from(libraryRoots).all();
  for (const root of roots) {
    const trashDir = trashDirFor(root.containerPath);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(trashDir, { withFileTypes: true });
    } catch {
      continue; // no trash directory for this root yet
    }

    const known = new Set(
      db
        .select({ trashRelativePath: trashEntries.trashRelativePath })
        .from(trashEntries)
        .where(eq(trashEntries.libraryRootId, root.id))
        .all()
        .map((r) => r.trashRelativePath)
    );

    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const trashRelativePath = `${TRASH_DIR_NAME}/${dirent.name}`;
      if (known.has(trashRelativePath)) continue;

      let sidecar: Partial<Sidecar> = {};
      try {
        sidecar = JSON.parse(fs.readFileSync(sidecarPathFor(root.containerPath, trashRelativePath), "utf8")) as Sidecar;
      } catch {
        // No sidecar (hand-made directory, or an interrupted delete) — adopt it with what we know.
      }
      const stat = fs.statSync(path.join(root.containerPath, trashRelativePath), { throwIfNoEntry: false });

      db.insert(trashEntries)
        .values({
          libraryRootId: root.id,
          originalRelativePath: sidecar.originalRelativePath ?? dirent.name,
          trashRelativePath,
          name: sidecar.name ?? dirent.name,
          fileCount: sidecar.fileCount ?? 0,
          sizeBytes: sidecar.sizeBytes ?? 0,
          deletedAt: sidecar.deletedAt ?? Math.round(stat?.mtimeMs ?? Date.now()),
          metadataSnapshot: sidecar.metadataSnapshot ? JSON.stringify(sidecar.metadataSnapshot) : null,
        })
        .onConflictDoNothing()
        .run();
    }
  }
}

function loadEntry(id: number) {
  return db
    .select({
      id: trashEntries.id,
      libraryRootId: trashEntries.libraryRootId,
      originalRelativePath: trashEntries.originalRelativePath,
      trashRelativePath: trashEntries.trashRelativePath,
      name: trashEntries.name,
      deletedAt: trashEntries.deletedAt,
      metadataSnapshot: trashEntries.metadataSnapshot,
      containerPath: libraryRoots.containerPath,
    })
    .from(trashEntries)
    .innerJoin(libraryRoots, eq(libraryRoots.id, trashEntries.libraryRootId))
    .where(eq(trashEntries.id, id))
    .get();
}

export interface RestoreResult {
  restoredRelativePath: string;
  /** True when the original location was occupied and the folder came back beside it. */
  renamed: boolean;
}

/** Moves a trashed folder back into the library and re-applies its ratings/tags/transcripts once
 * the follow-up scan has re-indexed the audio. */
export function restoreTrashEntry(id: number): RestoreResult {
  const entry = loadEntry(id);
  if (!entry) throw new Error("trash entry not found");

  const containerPath = path.resolve(entry.containerPath);
  const source = path.join(containerPath, entry.trashRelativePath);
  if (!fs.existsSync(source)) throw new Error("this folder is no longer in the trash directory on disk");

  let restoredRelativePath = entry.originalRelativePath;
  let destination = path.resolve(containerPath, restoredRelativePath);
  if (!destination.startsWith(containerPath + path.sep)) {
    throw new Error("stored original path resolves outside its library root");
  }
  // Something already lives where this came from (re-downloaded, re-imported): restore beside it
  // rather than merging into or overwriting whatever is there now.
  let renamed = false;
  for (let suffix = 2; fs.existsSync(destination); suffix++) {
    restoredRelativePath = `${entry.originalRelativePath} (restored${suffix > 2 ? ` ${suffix - 1}` : ""})`;
    destination = path.resolve(containerPath, restoredRelativePath);
    renamed = true;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  moveDirectory(source, destination);
  try {
    fs.rmSync(sidecarPathFor(containerPath, entry.trashRelativePath), { force: true });
  } catch {
    // Sidecar removal is cosmetic.
  }
  db.delete(trashEntries).where(eq(trashEntries.id, id)).run();

  const snapshot = parseSnapshot(entry.metadataSnapshot);
  startScan(entry.libraryRootId, containerPath, () => {
    applyRestoredMetadata(entry.libraryRootId, entry.originalRelativePath, restoredRelativePath, snapshot);
  });

  return { restoredRelativePath, renamed };
}

function parseSnapshot(raw: string | null): TrashMetadataSnapshot {
  if (!raw) return { version: 1, files: [], folderRatings: [] };
  try {
    const parsed = JSON.parse(raw) as TrashMetadataSnapshot;
    return { version: 1, files: parsed.files ?? [], folderRatings: parsed.folderRatings ?? [] };
  } catch {
    return { version: 1, files: [], folderRatings: [] };
  }
}

/** Re-applies a snapshot after the restore scan has re-indexed the files. Paths are remapped when
 * the folder had to come back under a different name. */
function applyRestoredMetadata(
  libraryRootId: number,
  originalRelativePath: string,
  restoredRelativePath: string,
  snapshot: TrashMetadataSnapshot
): void {
  const remap = (p: string) =>
    originalRelativePath === restoredRelativePath || !p.startsWith(originalRelativePath)
      ? p
      : restoredRelativePath + p.slice(originalRelativePath.length);

  const now = Date.now();
  for (const entry of snapshot.files) {
    const file = db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.libraryRootId, libraryRootId),
          eq(files.relativePath, remap(entry.relativePath)),
          isNull(files.deletedAt)
        )
      )
      .get();
    if (!file) continue;

    if (entry.rating !== null) {
      db.insert(ratings)
        .values({ fileId: file.id, rating: entry.rating, ratedAt: now })
        .onConflictDoUpdate({ target: ratings.fileId, set: { rating: entry.rating, ratedAt: now } })
        .run();
    }

    if (entry.tags.length > 0) {
      const tagIds: number[] = [];
      for (const name of entry.tags) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        db.insert(tags).values({ name: trimmed, createdAt: now }).onConflictDoNothing().run();
        const tag = db.select({ id: tags.id }).from(tags).where(eq(tags.name, trimmed)).get();
        if (tag) tagIds.push(tag.id);
      }
      rawDb.transaction(() => {
        for (const tagId of tagIds) {
          db.insert(fileTags).values({ fileId: file.id, tagId }).onConflictDoNothing().run();
        }
      })();
    }

    if (entry.transcript) {
      db.insert(transcripts)
        .values({
          fileId: file.id,
          text: entry.transcript.text,
          language: entry.transcript.language,
          model: entry.transcript.model,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: transcripts.fileId,
          set: { text: entry.transcript.text, language: entry.transcript.language, model: entry.transcript.model },
        })
        .run();
    }
  }

  for (const entry of snapshot.folderRatings) {
    const folder = db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.libraryRootId, libraryRootId), eq(folders.relativePath, remap(entry.relativePath))))
      .get();
    if (!folder) continue;
    db.insert(folderRatings)
      .values({ folderId: folder.id, rating: entry.rating, ratedAt: now })
      .onConflictDoUpdate({ target: folderRatings.folderId, set: { rating: entry.rating, ratedAt: now } })
      .run();
  }
}

/** Erases one trash entry for real. */
export function purgeTrashEntry(id: number): void {
  const entry = loadEntry(id);
  if (!entry) return;

  const containerPath = path.resolve(entry.containerPath);
  const target = path.resolve(containerPath, entry.trashRelativePath);
  const trashRoot = trashDirFor(containerPath);
  // Only ever recursively remove something that is genuinely inside this root's trash directory.
  if (target.startsWith(trashRoot + path.sep)) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(sidecarPathFor(containerPath, entry.trashRelativePath), { force: true });
  }
  db.delete(trashEntries).where(eq(trashEntries.id, id)).run();
}

export function emptyTrash(): { purgedCount: number } {
  const ids = db.select({ id: trashEntries.id }).from(trashEntries).orderBy(asc(trashEntries.id)).all();
  for (const row of ids) purgeTrashEntry(row.id);
  return { purgedCount: ids.length };
}

/**
 * Deletes trash older than the retention window for real. Runs at startup and on the nightly
 * schedule rather than on a precise timer — "gone within a day or so of 30 days" is the promise.
 */
export function purgeExpiredTrash(): { purgedCount: number } {
  adoptOrphanTrashDirs();
  const cutoff = Date.now() - config.trash.retentionDays * 24 * 60 * 60 * 1000;
  const expired = db.select({ id: trashEntries.id }).from(trashEntries).where(lt(trashEntries.deletedAt, cutoff)).all();
  for (const row of expired) purgeTrashEntry(row.id);
  return { purgedCount: expired.length };
}
