import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let ensurePromise: Promise<string> | null = null;

/**
 * Downloads the whisper.cpp ggml model into the /data volume on first use (not baked into the
 * Docker image — keeps rebuilds fast and avoids re-downloading a multi-hundred-MB file on every
 * deploy). Concurrent callers share the same in-flight download instead of racing.
 */
export function ensureModel(): Promise<string> {
  const modelPath = path.join(config.transcription.modelDir, config.transcription.modelName);
  if (fs.existsSync(modelPath)) return Promise.resolve(modelPath);

  if (!ensurePromise) {
    ensurePromise = downloadModel(modelPath).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function downloadModel(modelPath: string): Promise<string> {
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  const tempPath = `${modelPath}.downloading`;

  const res = await fetch(config.transcription.modelUrl);
  const body = res.body;
  if (!res.ok || !body) {
    throw new Error(`failed to download whisper model: HTTP ${res.status}`);
  }

  const fileStream = fs.createWriteStream(tempPath);
  try {
    const { Readable } = await import("node:stream");
    await new Promise<void>((resolve, reject) => {
      const nodeStream = Readable.fromWeb(body);
      nodeStream.pipe(fileStream);
      nodeStream.on("error", reject);
      fileStream.on("error", reject);
      fileStream.on("finish", resolve);
    });
  } catch (err) {
    fileStream.close();
    fs.rmSync(tempPath, { force: true });
    throw err;
  }

  fs.renameSync(tempPath, modelPath);
  return modelPath;
}
