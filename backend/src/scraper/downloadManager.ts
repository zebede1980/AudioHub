import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { extractAudioUrl, type SoundgasmPost } from "./soundgasm.js";
import { startScan } from "../scanner/scanManager.js";

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
  items: DownloadItem[];
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, DownloadJobState>();

export function getDownloadJob(jobId: string): DownloadJobState | undefined {
  return jobs.get(jobId);
}

export function sanitizeForFilesystem(name: string, maxLength: number): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength).trim() || "untitled";
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
  const folderRelativePath = ["Soundgasm", sanitizeForFilesystem(username, 100)].join("/");
  const destDir = path.join(containerPath, folderRelativePath);
  const job: DownloadJobState = {
    id: randomUUID(),
    status: "running",
    libraryRootId,
    containerPath,
    destDir,
    folderRelativePath,
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
      const filename = `${sanitizeForFilesystem(item.title, 150)}${extensionFromUrl(audioUrl)}`;
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

async function runDownloadJob(job: DownloadJobState): Promise<void> {
  fs.mkdirSync(job.destDir, { recursive: true });
  await processItems(job, job.items);
  job.status = "ok";
  job.finishedAt = Date.now();
  startScan(job.libraryRootId, job.containerPath);
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
      startScan(job.libraryRootId, job.containerPath);
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
