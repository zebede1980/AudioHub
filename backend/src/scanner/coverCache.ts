import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

export const CACHE_COVER_PREFIX = "__cache__/";

const EXT_BY_FORMAT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function coverCacheKey(libraryRootId: number, relativePath: string): string {
  return crypto.createHash("sha1").update(`${libraryRootId}:${relativePath}`).digest("hex");
}

/** Writes an embedded tag picture to the on-disk cover cache and returns a sentinel path for the DB. */
export function writeCoverCache(
  libraryRootId: number,
  relativePath: string,
  picture: { data: Buffer; format: string }
): string {
  fs.mkdirSync(config.coverCacheDir, { recursive: true });
  const ext = EXT_BY_FORMAT[picture.format] ?? "jpg";
  const filename = `${coverCacheKey(libraryRootId, relativePath)}.${ext}`;
  fs.writeFileSync(path.join(config.coverCacheDir, filename), picture.data);
  return `${CACHE_COVER_PREFIX}${filename}`;
}

/** Resolves a stored cover_image_path (either a cache sentinel or a library-relative path) to an absolute file path. */
export function resolveCoverAbsolutePath(coverImagePath: string, libraryRootContainerPath: string): string {
  if (coverImagePath.startsWith(CACHE_COVER_PREFIX)) {
    return path.join(config.coverCacheDir, coverImagePath.slice(CACHE_COVER_PREFIX.length));
  }
  return path.join(libraryRootContainerPath, coverImagePath);
}
