import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { folders, files, libraryRoots } from "../db/schema.js";
import { config } from "../config.js";
import { sanitizeForFilesystem } from "../scraper/importPaths.js";
import { startIndexPaths } from "../scanner/scanManager.js";

export class UploadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export interface UploadResult {
  filename: string;
  relativePath: string;
  /** Null if the file landed but the index hadn't caught up before the response — a refresh shows it. */
  fileId: number | null;
  /** True when the requested name was taken and a numeric suffix was added. */
  renamed: boolean;
}

/** How long to wait for the new file to be indexed before answering anyway. A targeted index is
 * milliseconds, but it queues behind a full scan if one happens to be running. */
const INDEX_WAIT_MS = 20_000;

function nonCollidingName(destDir: string, name: string): string {
  if (!fs.existsSync(path.join(destDir, name))) return name;
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!fs.existsSync(path.join(destDir, candidate))) return candidate;
  }
}

/**
 * Writes an uploaded audio file into a folder and indexes just that file, returning its id so the
 * caller can link straight to it.
 *
 * Never overwrites: an upload whose name is already taken gets a numeric suffix. Silently
 * replacing a library file — along with its ratings and transcript — is not something an "add a
 * file" button should ever be able to do by accident.
 */
export async function uploadToFolder(folderId: number, rawFilename: string, body: Readable): Promise<UploadResult> {
  const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
  if (!folder) throw new UploadError("folder not found", 404);

  const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, folder.libraryRootId)).get();
  if (!root) throw new UploadError("the library root for this folder no longer exists", 404);

  const extension = path.extname(rawFilename).toLowerCase();
  if (!config.audioExtensions.includes(extension)) {
    throw new UploadError(
      `"${extension || rawFilename}" isn't an audio type this library indexes (${config.audioExtensions.join(", ")})`,
      415
    );
  }
  // path.basename first: a filename is attacker-controlled here, and sanitizeForFilesystem alone
  // would turn "../x.mp3" into ".. x.mp3" rather than rejecting the traversal outright.
  const safeStem = sanitizeForFilesystem(path.basename(rawFilename, extension), 180);

  const destDir = folder.relativePath
    ? path.join(root.containerPath, ...folder.relativePath.split("/"))
    : root.containerPath;
  if (!fs.existsSync(destDir)) {
    throw new UploadError("this folder is no longer on disk — run a library scan", 409);
  }

  const requestedName = `${safeStem}${extension}`;
  const filename = nonCollidingName(destDir, requestedName);
  const relativePath = folder.relativePath ? `${folder.relativePath}/${filename}` : filename;
  const destPath = path.join(destDir, filename);
  const tempPath = `${destPath}.part`;

  try {
    await pipeline(body, fs.createWriteStream(tempPath));
    fs.renameSync(tempPath, destPath);
  } catch (err) {
    fs.rm(tempPath, { force: true }, () => {});
    throw new UploadError(err instanceof Error ? err.message : "upload failed", 500);
  }

  await indexed(folder.libraryRootId, root.containerPath, relativePath);

  const row = db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.libraryRootId, folder.libraryRootId), eq(files.relativePath, relativePath)))
    .get();

  return { filename, relativePath, fileId: row?.id ?? null, renamed: filename !== requestedName };
}

/** Resolves when the targeted index finishes, or when the wait runs out — never hangs the request. */
function indexed(libraryRootId: number, containerPath: string, relativePath: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, INDEX_WAIT_MS);
    startIndexPaths(libraryRootId, containerPath, [relativePath], () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
