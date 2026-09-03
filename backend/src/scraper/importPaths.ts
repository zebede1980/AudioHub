/**
 * Where a soundgasm import lands in the library.
 *
 * The downloader writes these paths and the "already in your library" check reads them back, so
 * the two must derive names identically — a drift between them would silently mark everything as
 * new (or as already imported). That contract is the reason this lives apart from either.
 */

const USERNAME_MAX_LENGTH = 100;
const TITLE_MAX_LENGTH = 150;

export function sanitizeForFilesystem(name: string, maxLength: number): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength).trim() || "untitled";
}

/** The library-relative folder every import from `username` is written into. */
export function importFolderRelativePath(username: string): string {
  return `Soundgasm/${sanitizeForFilesystem(username, USERNAME_MAX_LENGTH)}`;
}

/**
 * The filename a post is saved as, minus its extension. The extension isn't knowable without
 * fetching the post page for its audio URL, so anything matching a post against files already on
 * disk has to compare stems and ignore the extension.
 */
export function importFilenameStem(title: string): string {
  return sanitizeForFilesystem(title, TITLE_MAX_LENGTH);
}
