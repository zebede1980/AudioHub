import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { extractAudioUrl, profileUrlFor, type SoundgasmPost } from "./soundgasm.js";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { folders } from "../db/schema.js";
import { startIndexPaths } from "../scanner/scanManager.js";
import { importFolderRelativePath, importFilenameStem } from "./importPaths.js";

const USER_AGENT = "Mozilla/5.0 (compatible; AudioHub/1.0; personal library import)";
// Soundgasm is a small, ad-hoc community site, not a CDN built for bulk access — space requests
// out so an import of a whole profile doesn't look like abuse.
const DELAY_BETWEEN_DOWNLOADS_MS = 500;

export type DownloadItemStatus = "pending" | "downloading" | "done" | "skipped" | "error";

export interface DownloadItem {
  title: string;
  postUrl: string;
  status: DownloadItemStatus;
  error?: string;
  /** Set once "done"/"skipped" — the file's path relative to the library root, for looking it up after scan. */
  relativePath?: string;
}

export interface DownloadJobState {
  id: string;
  status: "running" | "ok" | "error";
  libraryRootId: number;
  containerPath: string;
  destDir: string;
  /** destDir relative to containerPath — matches how the scanner records folder paths. */
  folderRelativePath: string;
  /** The uploader profile this job pulled from, stamped onto the folder once it is indexed. */
  sourceUrl: string;
  items: DownloadItem[];
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, DownloadJobState>();

export function getDownloadJob(jobId: string): DownloadJobState | undefined {
  return jobs.get(jobId);
}

function extensionFromUrl(url: string): string {
  const ext = path.extname(new URL(url).pathname);
  return ext || ".m4a";
}

export function startSoundgasmDownload(
  libraryRootId: number,
  containerPath: string,
  username: string,
  posts: SoundgasmPost[]
): DownloadJobState {
  // Always forward-slash, matching the scanner's relativePath convention (scan.ts joinRel) — using
  // the native path.join here would emit backslashes on Windows and permanently break the
  // relativePath-based DB lookups (download/:jobId/file and /folder) on a non-Docker/Windows host.
  const folderRelativePath = importFolderRelativePath(username);
  const destDir = path.join(containerPath, folderRelativePath);
  const job: DownloadJobState = {
    id: randomUUID(),
    status: "running",
    libraryRootId,
    containerPath,
    destDir,
    folderRelativePath,
    sourceUrl: profileUrlFor(username),
    items: posts.map((p) => ({ title: p.title, postUrl: p.postUrl, status: "pending" })),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  runDownloadJob(job).catch((err) => {
    job.status = "error";
    job.finishedAt = Date.now();
    console.error("soundgasm download job failed", err);
  });

  return job;
}

async function processItems(job: DownloadJobState, items: DownloadItem[]): Promise<void> {
  for (const item of items) {
    item.status = "downloading";
    try {
      const audioUrl = await extractAudioUrl(item.postUrl);
      const filename = `${importFilenameStem(item.title)}${extensionFromUrl(audioUrl)}`;
      const destPath = path.join(job.destDir, filename);
      item.relativePath = [job.folderRelativePath, filename].join("/");

      if (fs.existsSync(destPath)) {
        item.status = "skipped";
      } else {
        await downloadToFile(audioUrl, destPath);
        item.status = "done";
      }
    } catch (err) {
      item.status = "error";
      item.error = err instanceof Error ? err.message : "download failed";
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_DOWNLOADS_MS));
  }
}

/**
 * An import knows exactly which files it wrote, so it indexes just those rather than triggering a
 * walk of the whole library — which costs the same minute whether one track landed or a hundred.
 * "skipped" items are included too: the file is on disk, and if a previous run wrote it without
 * ever being indexed this is what finally picks it up (an already-indexed one costs a stat).
 */
function indexDownloadedFiles(job: DownloadJobState): void {
  const relativePaths = job.items
    .filter((item) => item.status === "done" || item.status === "skipped")
    .map((item) => item.relativePath)
    .filter((relativePath): relativePath is string => Boolean(relativePath));
  // Stamped after indexing, not before: for a first import from an uploader the folder row does
  // not exist until the index creates it.
  startIndexPaths(job.libraryRootId, job.containerPath, relativePaths, () => recordSourceUrl(job));
}

/**
 * Records the uploader's profile page against the destination folder — only when it has none yet,
 * so a link someone pointed somewhere else by hand isn't silently rewritten by a later import.
 */
function recordSourceUrl(job: DownloadJobState): void {
  db.update(folders)
    .set({ sourceUrl: job.sourceUrl })
    .where(
      and(
        eq(folders.libraryRootId, job.libraryRootId),
        eq(folders.relativePath, job.folderRelativePath),
        isNull(folders.sourceUrl)
      )
    )
    .run();
}

async function runDownloadJob(job: DownloadJobState): Promise<void> {
  fs.mkdirSync(job.destDir, { recursive: true });
  await processItems(job, job.items);
  job.status = "ok";
  job.finishedAt = Date.now();
  indexDownloadedFiles(job);
}

/**
 * Re-runs only the errored items of a finished job in place, so a batch of 100+ doesn't
 * have to be re-listed and re-selected just to pick up the handful that failed.
 */
export function retrySoundgasmDownload(jobId: string, postUrls?: string[]): DownloadJobState | undefined {
  const job = jobs.get(jobId);
  if (!job || job.status === "running") return job;

  const targets = job.items.filter((item) => item.status === "error" && (!postUrls || postUrls.includes(item.postUrl)));
  if (targets.length === 0) return job;

  targets.forEach((item) => {
    item.status = "pending";
    item.error = undefined;
  });
  job.status = "running";
  job.finishedAt = undefined;

  processItems(job, targets)
    .then(() => {
      job.status = "ok";
      job.finishedAt = Date.now();
      indexDownloadedFiles(job);
    })
    .catch((err) => {
      job.status = "error";
      job.finishedAt = Date.now();
      console.error("soundgasm retry job failed", err);
    });

  return job;
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const tmpPath = `${destPath}.part`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`audio download returned ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    fs.rm(tmpPath, { force: true }, () => {});
    throw err;
  }
}
