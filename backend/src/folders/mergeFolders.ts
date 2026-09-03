import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import { folders, files, libraryRoots } from "../db/schema.js";
import { config } from "../config.js";
import { pickCoverImage } from "../scanner/scan.js";
import { CACHE_COVER_PREFIX } from "../scanner/coverCache.js";

/** A merge rejected for a reason the user can act on, carrying the status the route should send. */
export class MergeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export interface MergeResult {
  targetFolderId: number;
  /** Audio files whose library row was moved across, ratings and transcripts intact. */
  movedFiles: number;
  /** Subfolders re-parented under the target, with their whole subtree's paths rewritten. */
  movedSubfolders: number;
  /** Cover art and other non-audio files carried over so the source directory could be removed. */
  movedOtherFiles: number;
  /** Names that already existed in the target and were given a numeric suffix instead of overwriting. */
  renamed: { from: string; to: string }[];
  /** Rows whose audio wasn't on disk to move; carried over as soft-deleted rather than erased. */
  strandedFiles: number;
}

function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function segmentCount(relativePath: string): number {
  return relativePath ? relativePath.split("/").length : 0;
}

/** Walks `folderId`'s parent chain looking for `ancestorId`. */
function isAncestorOf(ancestorId: number, folderId: number): boolean {
  let currentId: number | null = folderId;
  while (currentId !== null) {
    if (currentId === ancestorId) return true;
    const row: { parentFolderId: number | null } | undefined = db
      .select({ parentFolderId: folders.parentFolderId })
      .from(folders)
      .where(eq(folders.id, currentId))
      .get();
    if (!row) return false;
    currentId = row.parentFolderId;
  }
  return false;
}

/**
 * Picks a name that doesn't already exist in `destDir`, suffixing " (2)", " (3)" and so on.
 * A merge must never overwrite: two uploaders can easily have a "cover.jpg" or the same track
 * title, and silently replacing one with the other would destroy a file with no way back.
 */
function nonCollidingName(destDir: string, name: string, isDirectory: boolean): string {
  if (!fs.existsSync(path.join(destDir, name))) return name;
  const ext = isDirectory ? "" : path.extname(name);
  const stem = isDirectory ? name : path.basename(name, ext);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!fs.existsSync(path.join(destDir, candidate))) return candidate;
  }
}

/**
 * Moves everything out of `sourceFolderId` into `targetFolderId` and removes the emptied source.
 *
 * File rows are updated in place rather than deleted and re-scanned, so ratings, play history,
 * tags and transcripts — all keyed on files.id — follow the audio across. That in-place rule is
 * the whole point of doing this here instead of moving the files on disk and letting a scan sort
 * it out, which would insert new rows and drop everything attached to the old ones.
 */
export function mergeFolders(targetFolderId: number, sourceFolderId: number): MergeResult {
  const target = db.select().from(folders).where(eq(folders.id, targetFolderId)).get();
  const source = db.select().from(folders).where(eq(folders.id, sourceFolderId)).get();

  if (!target) throw new MergeError("the folder you're merging into no longer exists", 404);
  if (!source) throw new MergeError("the folder you picked no longer exists", 404);
  if (target.id === source.id) throw new MergeError("a folder can't be merged into itself", 400);
  if (source.relativePath === "") throw new MergeError("the library root itself can't be merged away", 400);
  if (target.libraryRootId !== source.libraryRootId) {
    throw new MergeError("both folders have to be in the same library root", 400);
  }
  if (isAncestorOf(source.id, target.id)) {
    throw new MergeError("a folder can't be merged into one of its own subfolders", 400);
  }

  const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, target.libraryRootId)).get();
  if (!root) throw new MergeError("the library root for these folders no longer exists", 404);

  const sourceAbs = path.join(root.containerPath, ...source.relativePath.split("/"));
  const targetAbs = target.relativePath
    ? path.join(root.containerPath, ...target.relativePath.split("/"))
    : root.containerPath;

  if (!fs.existsSync(sourceAbs)) {
    throw new MergeError("the folder you picked is no longer on disk — run a library scan", 409);
  }
  fs.mkdirSync(targetAbs, { recursive: true });

  const result: MergeResult = {
    targetFolderId: target.id,
    movedFiles: 0,
    movedSubfolders: 0,
    movedOtherFiles: 0,
    renamed: [],
    strandedFiles: 0,
  };

  // Disk first, then the database, recording exactly what landed where. If the process dies
  // between the two, a full scan repairs the index by fingerprint — whereas a database updated
  // to point at files that were never moved would be wrong with nothing to detect it.
  const movedAudio: { oldRelativePath: string; newRelativePath: string; newFilename: string }[] = [];
  const movedSubtrees: { folderId: number; oldPrefix: string; newPrefix: string }[] = [];

  const dirents = fs.readdirSync(sourceAbs, { withFileTypes: true });
  for (const dirent of dirents) {
    const isDirectory = dirent.isDirectory();
    if (!isDirectory && !dirent.isFile()) continue; // symlinks and other oddities stay put

    const newName = nonCollidingName(targetAbs, dirent.name, isDirectory);
    if (newName !== dirent.name) result.renamed.push({ from: dirent.name, to: newName });

    fs.renameSync(path.join(sourceAbs, dirent.name), path.join(targetAbs, newName));

    const oldRelativePath = joinRel(source.relativePath, dirent.name);
    const newRelativePath = joinRel(target.relativePath, newName);

    if (isDirectory) {
      const childRow = db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.libraryRootId, target.libraryRootId), eq(folders.relativePath, oldRelativePath)))
        .get();
      if (childRow) {
        movedSubtrees.push({ folderId: childRow.id, oldPrefix: oldRelativePath, newPrefix: newRelativePath });
      }
      result.movedSubfolders++;
    } else if (config.audioExtensions.includes(path.extname(dirent.name).toLowerCase())) {
      movedAudio.push({ oldRelativePath, newRelativePath, newFilename: newName });
      result.movedFiles++;
    } else {
      result.movedOtherFiles++;
    }
  }

  // The target's cover may have just changed — the source's artwork could be the only image there
  // now — so re-apply the scanner's rule to whatever the directory holds after the move.
  const targetCover = coverForDirectory(targetAbs, target.relativePath);

  rawDb.transaction(() => {
    for (const moved of movedAudio) {
      const row = db
        .select({ id: files.id, coverImagePath: files.coverImagePath })
        .from(files)
        .where(and(eq(files.libraryRootId, target.libraryRootId), eq(files.relativePath, moved.oldRelativePath)))
        .get();
      if (!row) continue; // on disk but never indexed — a later scan will pick it up in place

      db.update(files)
        .set({
          folderId: target.id,
          relativePath: moved.newRelativePath,
          filename: moved.newFilename,
          // A cover extracted from the file's own tags lives in the cache and is unaffected by the
          // move; one that pointed at the source folder's artwork has to follow the file.
          coverImagePath: row.coverImagePath?.startsWith(CACHE_COVER_PREFIX) ? row.coverImagePath : targetCover,
          lastSeenAt: Date.now(),
        })
        .where(eq(files.id, row.id))
        .run();
    }

    for (const subtree of movedSubtrees) {
      rewriteSubtreePaths(target.libraryRootId, subtree.folderId, target.id, subtree.oldPrefix, subtree.newPrefix);
    }

    // Whatever still points at the source folder is a row whose audio wasn't there to move —
    // already soft-deleted, or deleted on disk since the last scan. files.folder_id cascades, so
    // deleting the folder row would erase those outright and take their ratings and play history
    // with them. Carry them over as soft-deleted instead: the rows survive, and a later scan
    // reconciles them like any other missing file.
    const stranded = db
      .select({ id: files.id, deletedAt: files.deletedAt })
      .from(files)
      .where(eq(files.folderId, source.id))
      .all();
    for (const row of stranded) {
      db.update(files)
        .set({ folderId: target.id, deletedAt: row.deletedAt ?? Date.now() })
        .where(eq(files.id, row.id))
        .run();
    }
    result.strandedFiles = stranded.length;

    // Merging two folders for the same uploader is the common case, so a source link shouldn't be
    // lost with the folder that carried it. Only fills a gap — the target's own link always wins.
    if (!target.sourceUrl && source.sourceUrl) {
      db.update(folders).set({ sourceUrl: source.sourceUrl }).where(eq(folders.id, target.id)).run();
    }

    db.delete(folders).where(eq(folders.id, source.id)).run();

    recomputeFolderAggregate(target.id, targetCover);
  })();

  // Only now that nothing references it: the directory should be empty, but if the move left
  // something behind (a symlink, a file that appeared mid-merge) keep it rather than forcing.
  try {
    fs.rmdirSync(sourceAbs);
  } catch {
    // Non-fatal: the library index is already correct, there is just a stray directory on disk.
  }

  return result;
}

function coverForDirectory(absDir: string, relativeDir: string): string | null {
  let names: string[];
  try {
    names = fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && config.imageExtensions.includes(path.extname(d.name).toLowerCase()))
      .map((d) => d.name);
  } catch {
    return null;
  }
  const picked = pickCoverImage(names);
  return picked ? joinRel(relativeDir, picked) : null;
}

/**
 * Re-points a moved subfolder at its new parent and rewrites every path beneath it.
 *
 * Rows are read and rewritten in JS rather than with a SQL prefix UPDATE because folder names in
 * this library really do contain `%` and `_`, which are LIKE wildcards — one unescaped match
 * would rewrite unrelated folders' paths.
 */
function rewriteSubtreePaths(
  libraryRootId: number,
  movedFolderId: number,
  newParentFolderId: number,
  oldPrefix: string,
  newPrefix: string
) {
  const depthDelta = segmentCount(newPrefix) - segmentCount(oldPrefix);

  const subtree = db
    .select()
    .from(folders)
    .where(eq(folders.libraryRootId, libraryRootId))
    .all()
    .filter((row) => row.relativePath === oldPrefix || row.relativePath.startsWith(`${oldPrefix}/`));

  for (const row of subtree) {
    const relativePath = `${newPrefix}${row.relativePath.slice(oldPrefix.length)}`;
    db.update(folders)
      .set({
        relativePath,
        depth: row.depth + depthDelta,
        coverImagePath: rewriteCoverPath(row.coverImagePath, oldPrefix, newPrefix),
        ...(row.id === movedFolderId ? { parentFolderId: newParentFolderId } : {}),
      })
      .where(eq(folders.id, row.id))
      .run();
  }

  // Addressed by folder_id, so no path matching is involved and soft-deleted rows come along too.
  for (const folderRow of subtree) {
    const fileRows = db.select().from(files).where(eq(files.folderId, folderRow.id)).all();
    for (const fileRow of fileRows) {
      db.update(files)
        .set({
          relativePath: `${newPrefix}${fileRow.relativePath.slice(oldPrefix.length)}`,
          coverImagePath: rewriteCoverPath(fileRow.coverImagePath, oldPrefix, newPrefix),
        })
        .where(eq(files.id, fileRow.id))
        .run();
    }
  }
}

/** Cache sentinels are keyed by file, not location, so only real library-relative paths move. */
function rewriteCoverPath(coverImagePath: string | null, oldPrefix: string, newPrefix: string): string | null {
  if (!coverImagePath || coverImagePath.startsWith(CACHE_COVER_PREFIX)) return coverImagePath;
  if (coverImagePath !== oldPrefix && !coverImagePath.startsWith(`${oldPrefix}/`)) return coverImagePath;
  return `${newPrefix}${coverImagePath.slice(oldPrefix.length)}`;
}

function recomputeFolderAggregate(folderId: number, coverImagePath: string | null) {
  const aggregate = rawDb
    .prepare(
      `SELECT COUNT(*) AS fileCount, COALESCE(SUM(duration_sec), 0) AS totalDurationSec
       FROM files WHERE folder_id = ? AND deleted_at IS NULL`
    )
    .get(folderId) as { fileCount: number; totalDurationSec: number };
  rawDb
    .prepare(`UPDATE folders SET file_count = ?, total_duration_sec = ?, cover_image_path = ? WHERE id = ?`)
    .run(aggregate.fileCount, aggregate.totalDurationSec, coverImagePath, folderId);
}
