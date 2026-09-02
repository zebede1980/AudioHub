import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, folders, folderRatings, libraryRoots, playHistory, ratings, transcripts } from "../db/schema.js";

/**
 * Matches a folder and everything nested under it, by relative-path prefix. Used instead of
 * walking parent_folder_id because it applies unchanged to both `folders` and `files` rows, and
 * because the review/delete paths care about what is on disk under a directory, not about how the
 * folder tree happens to be linked.
 *
 * LIKE wildcards in the stored path (% and _ are both legal in folder names) are escaped so
 * "Vol_1" can't also match "Vol 1".
 */
export function descendantPathFilter(relativePath: string): SQL {
  const escaped = relativePath.replace(/[\\%_]/g, (c) => `\\${c}`);
  // `column` is supplied by the caller's table via a correlated reference — both tables name the
  // column relative_path, so a raw fragment keeps this usable from either query.
  return or(
    sql`relative_path = ${relativePath}`,
    sql`relative_path LIKE ${`${escaped}/%`} ESCAPE '\\'`
  ) as SQL;
}

export interface FolderReviewRow {
  id: number;
  name: string;
  relativePath: string;
  libraryRootId: number;
  libraryRootName: string;
  coverImagePath: string | null;
  rating: number;
  ratedAt: number;
  /** Recursive: every file under the folder, including in subfolders. */
  fileCount: number;
  sizeBytes: number;
  durationSec: number;
  subfolderCount: number;
  /** Highest star rating on any file inside — the strongest "are you sure?" signal there is. */
  maxFileRating: number | null;
  highlyRatedFileCount: number;
  transcriptCount: number;
  lastPlayedAt: number | null;
}

/** Every folder at a given star rating, with the recursive totals the review screen needs to show
 * what a delete would actually take. */
export function foldersForReview(rating: number): FolderReviewRow[] {
  const rows = db
    .select({
      id: folders.id,
      name: folders.name,
      relativePath: folders.relativePath,
      libraryRootId: folders.libraryRootId,
      libraryRootName: libraryRoots.name,
      coverImagePath: folders.coverImagePath,
      rating: folderRatings.rating,
      ratedAt: folderRatings.ratedAt,
    })
    .from(folderRatings)
    .innerJoin(folders, eq(folders.id, folderRatings.folderId))
    .innerJoin(libraryRoots, eq(libraryRoots.id, folders.libraryRootId))
    .where(eq(folderRatings.rating, rating))
    .all();

  return rows
    .filter((row) => row.relativePath !== "")
    .map((row) => ({ ...row, ...folderStats(row.libraryRootId, row.relativePath) }))
    .sort((a, b) => b.fileCount - a.fileCount || a.relativePath.localeCompare(b.relativePath));
}

function folderStats(libraryRootId: number, relativePath: string) {
  const within = and(eq(files.libraryRootId, libraryRootId), isNull(files.deletedAt), descendantPathFilter(relativePath));

  const aggregate = db
    .select({
      fileCount: sql<number>`COUNT(*)`,
      sizeBytes: sql<number>`COALESCE(SUM(${files.sizeBytes}), 0)`,
      durationSec: sql<number>`COALESCE(SUM(${files.durationSec}), 0)`,
    })
    .from(files)
    .where(within)
    .get() ?? { fileCount: 0, sizeBytes: 0, durationSec: 0 };

  const ratingAggregate = db
    .select({
      maxFileRating: sql<number | null>`MAX(${ratings.rating})`,
      highlyRatedFileCount: sql<number>`COALESCE(SUM(CASE WHEN ${ratings.rating} >= 3 THEN 1 ELSE 0 END), 0)`,
    })
    .from(files)
    .innerJoin(ratings, eq(ratings.fileId, files.id))
    .where(within)
    .get() ?? { maxFileRating: null, highlyRatedFileCount: 0 };

  const transcriptAggregate = db
    .select({ transcriptCount: sql<number>`COUNT(*)` })
    .from(files)
    .innerJoin(transcripts, eq(transcripts.fileId, files.id))
    .where(within)
    .get() ?? { transcriptCount: 0 };

  const playAggregate = db
    .select({ lastPlayedAt: sql<number | null>`MAX(${playHistory.playedAt})` })
    .from(files)
    .innerJoin(playHistory, eq(playHistory.fileId, files.id))
    .where(within)
    .get() ?? { lastPlayedAt: null };

  const subfolderAggregate = db
    .select({ subfolderCount: sql<number>`COUNT(*)` })
    .from(folders)
    .where(and(eq(folders.libraryRootId, libraryRootId), descendantPathFilter(relativePath)))
    .get() ?? { subfolderCount: 1 };

  return {
    fileCount: Number(aggregate.fileCount),
    sizeBytes: Number(aggregate.sizeBytes),
    durationSec: Number(aggregate.durationSec),
    // The folder itself is included by the prefix match; only what's nested is a "subfolder".
    subfolderCount: Math.max(0, Number(subfolderAggregate.subfolderCount) - 1),
    maxFileRating: ratingAggregate.maxFileRating === null ? null : Number(ratingAggregate.maxFileRating),
    highlyRatedFileCount: Number(ratingAggregate.highlyRatedFileCount),
    transcriptCount: Number(transcriptAggregate.transcriptCount),
    lastPlayedAt: playAggregate.lastPlayedAt === null ? null : Number(playAggregate.lastPlayedAt),
  };
}

export interface FolderContentsFile {
  id: number;
  filename: string;
  title: string | null;
  /** Path of the file relative to the folder being reviewed, so nesting is visible in the list. */
  subPath: string;
  durationSec: number | null;
  sizeBytes: number;
  rating: number | null;
  hasTranscript: boolean;
  lastPlayedAt: number | null;
}

/** Flat, recursive listing of a folder's audio — what the review screen expands to show, and what
 * the user can play straight from that list. */
export function folderContents(folderId: number, limit = 500): { files: FolderContentsFile[]; truncated: boolean } {
  const folder = db
    .select({ libraryRootId: folders.libraryRootId, relativePath: folders.relativePath })
    .from(folders)
    .where(eq(folders.id, folderId))
    .get();
  if (!folder) return { files: [], truncated: false };

  const rows = db
    .select({
      id: files.id,
      filename: files.filename,
      title: files.title,
      relativePath: files.relativePath,
      durationSec: files.durationSec,
      sizeBytes: files.sizeBytes,
      rating: ratings.rating,
      hasTranscript: transcripts.id,
      lastPlayedAt: sql<number | null>`(SELECT MAX(played_at) FROM play_history WHERE play_history.file_id = ${files.id})`,
    })
    .from(files)
    .leftJoin(ratings, eq(ratings.fileId, files.id))
    .leftJoin(transcripts, eq(transcripts.fileId, files.id))
    .where(
      and(eq(files.libraryRootId, folder.libraryRootId), isNull(files.deletedAt), descendantPathFilter(folder.relativePath))
    )
    .limit(limit + 1)
    .all();

  const prefix = folder.relativePath ? `${folder.relativePath}/` : "";
  const mapped = rows.slice(0, limit).map((row) => ({
    id: row.id,
    filename: row.filename,
    title: row.title,
    subPath: row.relativePath.startsWith(prefix) ? row.relativePath.slice(prefix.length) : row.relativePath,
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    rating: row.rating ?? null,
    hasTranscript: row.hasTranscript !== null,
    lastPlayedAt: row.lastPlayedAt === null ? null : Number(row.lastPlayedAt),
  }));
  // Files sitting directly in the folder first, then each subfolder's contents together — the
  // shape of what's about to be deleted reads far more clearly than one flat alphabetical list.
  const dirOf = (subPath: string) => subPath.slice(0, Math.max(0, subPath.lastIndexOf("/")));
  const collate = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  mapped.sort((a, b) => collate(dirOf(a.subPath), dirOf(b.subPath)) || collate(a.subPath, b.subPath));

  return { files: mapped, truncated: rows.length > limit };
}
