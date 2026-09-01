import fs from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".wma": "audio/x-ms-wma",
};

export function mimeTypeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function imageMimeTypeForExtension(extension: string): string {
  return IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Streams a file with full HTTP Range support (206 Partial Content), required for iOS Safari
 * seeking/scrubbing and for Media Session position tracking to work correctly.
 */
export async function streamFileWithRangeSupport(
  request: FastifyRequest,
  reply: FastifyReply,
  absolutePath: string,
  mimeType: string
): Promise<void> {
  const stat = await fs.promises.stat(absolutePath);
  const etag = `"${stat.size}-${Math.round(stat.mtimeMs)}"`;

  reply.header("Accept-Ranges", "bytes");
  reply.header("ETag", etag);
  reply.header("Last-Modified", stat.mtime.toUTCString());
  reply.header("Cache-Control", "private, max-age=3600");

  if (request.headers["if-none-match"] === etag) {
    reply.code(304);
    return reply.send();
  }

  const rangeHeader = request.headers.range;
  if (!rangeHeader) {
    reply.header("Content-Length", stat.size);
    reply.header("Content-Type", mimeType);
    reply.code(200);
    return reply.send(fs.createReadStream(absolutePath));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : undefined;
  let end = match[2] ? Number.parseInt(match[2], 10) : undefined;

  if (start === undefined && end !== undefined) {
    // suffix range: last `end` bytes
    start = Math.max(0, stat.size - end);
    end = stat.size - 1;
  } else if (start !== undefined && end === undefined) {
    end = stat.size - 1;
  }

  if (start === undefined || end === undefined || start > end || start >= stat.size) {
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }
  end = Math.min(end, stat.size - 1);

  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  reply.header("Content-Length", end - start + 1);
  reply.header("Content-Type", mimeType);
  return reply.send(fs.createReadStream(absolutePath, { start, end }));
}
