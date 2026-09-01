import fs from "node:fs";
import crypto from "node:crypto";

const CHUNK_SIZE = 64 * 1024;

/**
 * Cheap identity fingerprint: sha1(first 64KB + last 64KB + size). Used to detect a renamed/moved
 * file without hashing the whole (potentially huge) audio file on every scan.
 */
export function computeFingerprint(absolutePath: string, sizeBytes: number): string {
  const fd = fs.openSync(absolutePath, "r");
  try {
    const hash = crypto.createHash("sha1");
    hash.update(String(sizeBytes));

    const head = Buffer.alloc(Math.min(CHUNK_SIZE, sizeBytes));
    fs.readSync(fd, head, 0, head.length, 0);
    hash.update(head);

    if (sizeBytes > CHUNK_SIZE) {
      const tailSize = Math.min(CHUNK_SIZE, sizeBytes);
      const tail = Buffer.alloc(tailSize);
      fs.readSync(fd, tail, 0, tailSize, sizeBytes - tailSize);
      hash.update(tail);
    }

    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}
