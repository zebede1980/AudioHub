import path from "node:path";

/** Directory, inside every library root, that holds folders deleted from the library. Kept inside
 * the root (rather than a shared location) so a delete is a same-filesystem rename, not a copy of
 * potentially many gigabytes — and so the trash lives on the same drive whose space it occupies. */
export const TRASH_DIR_NAME = ".audiohub-trash";

/** True for any path at or under a library root's trash directory. The scanner skips these, so a
 * trashed folder disappears from the library instead of being re-indexed (or, worse, matched as a
 * "move" by the scanner's fingerprint reconciliation and kept in place). */
export function isTrashRelativePath(relativePath: string): boolean {
  return relativePath === TRASH_DIR_NAME || relativePath.startsWith(`${TRASH_DIR_NAME}/`);
}

export function trashDirFor(containerPath: string): string {
  return path.join(containerPath, TRASH_DIR_NAME);
}

/** Filesystem-safe entry name that still reads as the original location, so a folder can be
 * recovered by hand from the trash directory even without the database. */
export function trashEntryName(originalRelativePath: string, deletedAt: number): string {
  const slug = originalRelativePath
    .replace(/[\/]+/g, "__")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .slice(0, 120)
    .trim();
  return `${new Date(deletedAt).toISOString().replace(/[:.]/g, "-")}__${slug || "folder"}`;
}
