import path from "node:path";
import { rawDb } from "../db/client.js";
import { importFolderRelativePath, importFilenameStem } from "./importPaths.js";
import type { SoundgasmPost } from "./soundgasm.js";

export interface SoundgasmPostWithState extends SoundgasmPost {
  /** True when a file this post would be saved as is already indexed in the library. */
  alreadyInLibrary: boolean;
}

/**
 * Marks each post that already has a file in the library, so a repeat visit to a profile shows
 * what is genuinely new instead of offering all 200 posts as equally fresh.
 *
 * Matched on the filename stem the downloader would produce, not on the post URL: nothing records
 * where a given file came from, so the name is the only link between a post and a file on disk.
 * Extensions are ignored — knowing one means fetching the post page for its audio URL, which is a
 * request per post and far too expensive just to render a list.
 *
 * Checks every library root, not just the one selected for the download: the useful question is
 * "do I already have this?", and the answer shouldn't change with the destination dropdown.
 */
export function markAlreadyImported(username: string, posts: SoundgasmPost[]): SoundgasmPostWithState[] {
  const folderRelativePath = importFolderRelativePath(username);

  const rows = rawDb
    .prepare(
      `SELECT f.filename FROM files f
       JOIN folders fo ON fo.id = f.folder_id
       WHERE fo.relative_path = ? AND f.deleted_at IS NULL`
    )
    .all(folderRelativePath) as { filename: string }[];

  // Compared case-insensitively: the folder is written with whatever casing soundgasm reported at
  // the time, and both Windows hosts and the mounted volumes treat names case-insensitively
  // anyway, so a casing change upstream must not read as "this is a new post".
  const existingStems = new Set(
    rows.map((row) => path.basename(row.filename, path.extname(row.filename)).toLowerCase())
  );

  return posts.map((post) => ({
    ...post,
    alreadyInLibrary: existingStems.has(importFilenameStem(post.title).toLowerCase()),
  }));
}
