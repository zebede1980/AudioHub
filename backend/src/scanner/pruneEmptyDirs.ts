import fs from "node:fs";
import path from "node:path";

// Walks upward from startDir, removing directories that are now empty, stopping at (and never
// removing) rootDir. Lets deleting the last file in a leaf directory also clean up the now-empty
// parent chain on disk, instead of leaving empty folders behind.
export function pruneEmptyAncestorDirs(startDir: string, rootDir: string): void {
  const root = path.resolve(rootDir);
  let dir = path.resolve(startDir);

  while (dir !== root && dir.startsWith(root + path.sep)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return; // already gone, or unreadable — nothing more to prune
    }
    if (entries.length > 0) return;
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}
