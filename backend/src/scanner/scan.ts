import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { parseFilename, deriveFolderContext } from "./parseFilename.js";
import { readAudioTags } from "./metadata.js";
import { computeFingerprint } from "./fingerprint.js";
import { writeCoverCache } from "./coverCache.js";

export interface ScanProgress {
  foldersScanned: number;
  filesScanned: number;
  filesChanged: number;
}

export interface ScanResult extends ScanProgress {
  movedFiles: number;
  deletedFiles: number;
}

interface StackEntry {
  absPath: string;
  relativePath: string;
  folderId: number;
  parentFolderId: number | null;
  /** Folder names from just-under-root down to and including this folder ("" at the root). */
  folderNameChain: string[];
}

function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function pickCoverImage(imageFiles: string[]): string | null {
  if (imageFiles.length === 0) return null;
  for (const priority of config.coverFilenamePriority) {
    const match = imageFiles.find((f) => path.parse(f).name.toLowerCase() === priority);
    if (match) return match;
  }
  return [...imageFiles].sort((a, b) => a.localeCompare(b))[0];
}

export async function scanLibraryRoot(
  sqlite: Database.Database,
  libraryRootId: number,
  containerPath: string,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  const scanStartedAt = Date.now();
  const progress: ScanProgress = { foldersScanned: 0, filesScanned: 0, filesChanged: 0 };

  const insertOrGetFolder = sqlite.prepare(`
    INSERT INTO folders (library_root_id, parent_folder_id, relative_path, name, depth, last_seen_at)
    VALUES (@libraryRootId, @parentFolderId, @relativePath, @name, @depth, @lastSeenAt)
    ON CONFLICT(library_root_id, relative_path) DO UPDATE SET
      parent_folder_id = excluded.parent_folder_id,
      name = excluded.name,
      depth = excluded.depth,
      last_seen_at = excluded.last_seen_at
    RETURNING id
  `);

  const updateFolderCoverAndAggregate = sqlite.prepare(`
    UPDATE folders SET cover_image_path = ?, file_count = ?, total_duration_sec = ? WHERE id = ?
  `);

  const folderAggregate = sqlite.prepare(`
    SELECT COUNT(*) AS fileCount, COALESCE(SUM(duration_sec), 0) AS totalDurationSec
    FROM files WHERE folder_id = ? AND deleted_at IS NULL
  `);

  const findFileByPath = sqlite.prepare(
    `SELECT id, mtime_ms, size_bytes FROM files WHERE library_root_id = ? AND relative_path = ?`
  );
  const touchFile = sqlite.prepare(`UPDATE files SET last_seen_at = ? WHERE id = ?`);

  const insertFile = sqlite.prepare(`
    INSERT INTO files (
      library_root_id, folder_id, relative_path, filename, extension, size_bytes, mtime_ms, fingerprint,
      duration_sec, title, track_number, parsed_author, parsed_series_or_book,
      tag_title, tag_artist, tag_album, tag_track, tag_genre, cover_image_path,
      first_seen_at, last_seen_at, deleted_at
    ) VALUES (
      @libraryRootId, @folderId, @relativePath, @filename, @extension, @sizeBytes, @mtimeMs, @fingerprint,
      @durationSec, @title, @trackNumber, @parsedAuthor, @parsedSeriesOrBook,
      @tagTitle, @tagArtist, @tagAlbum, @tagTrack, @tagGenre, @coverImagePath,
      @firstSeenAt, @lastSeenAt, NULL
    )
  `);

  const updateFile = sqlite.prepare(`
    UPDATE files SET
      folder_id = @folderId, filename = @filename, extension = @extension, size_bytes = @sizeBytes,
      mtime_ms = @mtimeMs, fingerprint = @fingerprint, duration_sec = @durationSec, title = @title,
      track_number = @trackNumber, parsed_author = @parsedAuthor, parsed_series_or_book = @parsedSeriesOrBook,
      tag_title = @tagTitle, tag_artist = @tagArtist, tag_album = @tagAlbum, tag_track = @tagTrack,
      tag_genre = @tagGenre, cover_image_path = @coverImagePath, last_seen_at = @lastSeenAt, deleted_at = NULL
    WHERE id = @id
  `);

  const rootRow = insertOrGetFolder.get({
    libraryRootId,
    parentFolderId: null,
    relativePath: "",
    name: "",
    depth: 0,
    lastSeenAt: scanStartedAt,
  }) as { id: number };

  const stack: StackEntry[] = [
    { absPath: containerPath, relativePath: "", folderId: rootRow.id, parentFolderId: null, folderNameChain: [] },
  ];

  while (stack.length > 0) {
    const entry = stack.pop()!;
    progress.foldersScanned++;

    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(entry.absPath, { withFileTypes: true });
    } catch {
      continue; // unreadable/transiently-missing directory — skip rather than fail the whole scan
    }

    const subdirs = dirents.filter((d) => d.isDirectory());
    const audioFiles = dirents.filter(
      (d) => d.isFile() && config.audioExtensions.includes(path.extname(d.name).toLowerCase())
    );
    const imageFiles = dirents.filter(
      (d) => d.isFile() && config.imageExtensions.includes(path.extname(d.name).toLowerCase())
    );

    const coverImageName = pickCoverImage(imageFiles.map((d) => d.name));
    const coverImagePath = coverImageName ? joinRel(entry.relativePath, coverImageName) : null;

    for (const dirent of audioFiles) {
      progress.filesScanned++;
      const absFilePath = path.join(entry.absPath, dirent.name);
      const relativePath = joinRel(entry.relativePath, dirent.name);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(absFilePath);
      } catch {
        continue;
      }
      const mtimeMs = Math.round(stat.mtimeMs);

      const existing = findFileByPath.get(libraryRootId, relativePath) as
        | { id: number; mtime_ms: number; size_bytes: number }
        | undefined;

      if (existing && existing.mtime_ms === mtimeMs && existing.size_bytes === stat.size) {
        touchFile.run(scanStartedAt, existing.id);
        onProgress?.(progress);
        continue;
      }

      progress.filesChanged++;
      const tags = await readAudioTags(absFilePath);
      const extension = path.extname(dirent.name).toLowerCase();
      const filenameNoExt = path.basename(dirent.name, path.extname(dirent.name));
      const parsedName = parseFilename(filenameNoExt);
      const folderContext = deriveFolderContext(entry.folderNameChain);
      const fingerprint = computeFingerprint(absFilePath, stat.size);

      let coverForFile: string | null = coverImagePath;
      if (!coverForFile && tags.picture) {
        coverForFile = writeCoverCache(libraryRootId, relativePath, tags.picture);
      }

      const row = {
        libraryRootId,
        folderId: entry.folderId,
        relativePath,
        filename: dirent.name,
        extension,
        sizeBytes: stat.size,
        mtimeMs,
        fingerprint,
        durationSec: tags.durationSec,
        title: tags.tagTitle ?? parsedName.title,
        trackNumber: tags.tagTrack ?? parsedName.trackNumber,
        parsedAuthor: folderContext.parsedAuthor,
        parsedSeriesOrBook: folderContext.parsedSeriesOrBook,
        tagTitle: tags.tagTitle,
        tagArtist: tags.tagArtist,
        tagAlbum: tags.tagAlbum,
        tagTrack: tags.tagTrack,
        tagGenre: tags.tagGenre,
        coverImagePath: coverForFile,
        firstSeenAt: scanStartedAt,
        lastSeenAt: scanStartedAt,
      };

      if (existing) {
        updateFile.run({ ...row, id: existing.id });
      } else {
        insertFile.run(row);
      }

      onProgress?.(progress);
    }

    // Recompute aggregates from the DB rather than accumulating locally, so an incremental scan
    // (where most files hit the unchanged fast path above and are never re-parsed) still reflects
    // the true current totals instead of only the files touched this pass.
    const aggregate = folderAggregate.get(entry.folderId) as { fileCount: number; totalDurationSec: number };
    updateFolderCoverAndAggregate.run(
      coverImagePath,
      aggregate.fileCount,
      aggregate.totalDurationSec,
      entry.folderId
    );

    for (const subdir of subdirs) {
      const childRelativePath = joinRel(entry.relativePath, subdir.name);
      const childFolderNameChain = [...entry.folderNameChain, subdir.name];
      const childRow = insertOrGetFolder.get({
        libraryRootId,
        parentFolderId: entry.folderId,
        relativePath: childRelativePath,
        name: subdir.name,
        depth: childFolderNameChain.length,
        lastSeenAt: scanStartedAt,
      }) as { id: number };

      stack.push({
        absPath: path.join(entry.absPath, subdir.name),
        relativePath: childRelativePath,
        folderId: childRow.id,
        parentFolderId: entry.folderId,
        folderNameChain: childFolderNameChain,
      });
    }
  }

  const { movedFiles, deletedFiles } = reconcileMovesAndDeletions(sqlite, libraryRootId, scanStartedAt);
  reconcileDeletedFolders(sqlite, libraryRootId, scanStartedAt);

  return { ...progress, movedFiles, deletedFiles };
}

// Folders whose directory no longer exists on disk (removed directly, or emptied out and pruned
// after their last file was deleted) are never visited by the walk above, so their last_seen_at
// goes stale exactly like a missing file's. Remove them so they stop showing up in the library.
// Deepest-first so a folder never briefly outlives its already-deleted children in the parent
// chain; files.folder_id cascades, cleaning up any file rows the walk didn't already soft-delete.
function reconcileDeletedFolders(sqlite: Database.Database, libraryRootId: number, scanStartedAt: number) {
  const stale = sqlite
    .prepare(
      `SELECT id FROM folders WHERE library_root_id = ? AND relative_path != '' AND last_seen_at < ?
       ORDER BY depth DESC`
    )
    .all(libraryRootId, scanStartedAt) as { id: number }[];

  const deleteFolder = sqlite.prepare(`DELETE FROM folders WHERE id = ?`);
  for (const row of stale) {
    deleteFolder.run(row.id);
  }
}

function reconcileMovesAndDeletions(sqlite: Database.Database, libraryRootId: number, scanStartedAt: number) {
  const missing = sqlite
    .prepare(
      `SELECT id, folder_id, size_bytes, fingerprint FROM files
       WHERE library_root_id = ? AND deleted_at IS NULL AND last_seen_at < ?`
    )
    .all(libraryRootId, scanStartedAt) as {
    id: number;
    folder_id: number;
    size_bytes: number;
    fingerprint: string | null;
  }[];

  const newlyInserted = sqlite
    .prepare(
      `SELECT id, folder_id, relative_path, filename, extension, size_bytes, mtime_ms, fingerprint,
              duration_sec, title, track_number, parsed_author, parsed_series_or_book,
              tag_title, tag_artist, tag_album, tag_track, tag_genre, cover_image_path
       FROM files WHERE library_root_id = ? AND first_seen_at = ?`
    )
    .all(libraryRootId, scanStartedAt) as Record<string, unknown>[];

  const missingByFingerprint = new Map<string, number>();
  for (const row of missing) {
    if (!row.fingerprint) continue;
    missingByFingerprint.set(`${row.size_bytes}:${row.fingerprint}`, row.id);
  }

  const applyMove = sqlite.prepare(`
    UPDATE files SET
      folder_id = @folder_id, relative_path = @relative_path, filename = @filename, extension = @extension,
      size_bytes = @size_bytes, mtime_ms = @mtime_ms, fingerprint = @fingerprint, duration_sec = @duration_sec,
      title = @title, track_number = @track_number, parsed_author = @parsed_author,
      parsed_series_or_book = @parsed_series_or_book, tag_title = @tag_title, tag_artist = @tag_artist,
      tag_album = @tag_album, tag_track = @tag_track, tag_genre = @tag_genre, cover_image_path = @cover_image_path,
      last_seen_at = @last_seen_at, deleted_at = NULL
    WHERE id = @targetId
  `);
  const deleteDuplicate = sqlite.prepare(`DELETE FROM files WHERE id = ?`);
  const softDelete = sqlite.prepare(`UPDATE files SET deleted_at = ? WHERE id = ?`);
  const folderAggregate = sqlite.prepare(`
    SELECT COUNT(*) AS fileCount, COALESCE(SUM(duration_sec), 0) AS totalDurationSec
    FROM files WHERE folder_id = ? AND deleted_at IS NULL
  `);
  const updateFolderAggregateOnly = sqlite.prepare(
    `UPDATE folders SET file_count = ?, total_duration_sec = ? WHERE id = ?`
  );

  let movedFiles = 0;
  const matchedMissingIds = new Set<number>();
  const foldersNeedingRecount = new Set<number>();

  for (const newRow of newlyInserted) {
    const key = `${newRow.size_bytes}:${newRow.fingerprint}`;
    const targetId = newRow.fingerprint ? missingByFingerprint.get(key as string) : undefined;
    if (targetId === undefined || matchedMissingIds.has(targetId)) continue;

    matchedMissingIds.add(targetId);
    const oldFolderId = missing.find((row) => row.id === targetId)?.folder_id;
    if (oldFolderId !== undefined) foldersNeedingRecount.add(oldFolderId);
    // Delete the duplicate row first — it currently occupies the (library_root_id, relative_path)
    // the old row is about to take over, so updating before deleting would violate the unique index.
    deleteDuplicate.run(newRow.id as number);
    applyMove.run({ ...newRow, last_seen_at: scanStartedAt, targetId });
    movedFiles++;
  }

  let deletedFiles = 0;
  for (const row of missing) {
    if (matchedMissingIds.has(row.id)) continue;
    softDelete.run(scanStartedAt, row.id);
    foldersNeedingRecount.add(row.folder_id);
    deletedFiles++;
  }

  // The walk only recomputes aggregates for folders it actually visits on disk. A folder whose
  // files just moved away or were deleted — and which no longer exists (fully renamed/removed) —
  // is never visited this pass, so its stale file_count/total_duration_sec must be fixed up here.
  for (const folderId of foldersNeedingRecount) {
    const aggregate = folderAggregate.get(folderId) as { fileCount: number; totalDurationSec: number };
    updateFolderAggregateOnly.run(aggregate.fileCount, aggregate.totalDurationSec, folderId);
  }

  return { movedFiles, deletedFiles };
}
