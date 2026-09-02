import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const inFlight = new Map<string, Promise<string>>();

/**
 * Downloads a ggml model into the /data volume on first use (not baked into the Docker image —
 * keeps rebuilds fast and avoids re-downloading a multi-hundred-MB file on every deploy).
 * Concurrent callers share the same in-flight download instead of racing.
 */
function ensureModelFile(fileName: string, url: string): Promise<string> {
  const modelPath = path.join(config.transcription.modelDir, fileName);
  if (fs.existsSync(modelPath)) return Promise.resolve(modelPath);

  const existing = inFlight.get(modelPath);
  if (existing) return existing;

  const download = downloadModel(modelPath, url).catch((err) => {
    inFlight.delete(modelPath);
    throw err;
  });
  inFlight.set(modelPath, download);
  return download;
}

/** The speech-to-text model itself. A failure here fails the batch — there's nothing to run without it. */
export function ensureModel(): Promise<string> {
  return ensureModelFile(config.transcription.modelName, config.transcription.modelUrl);
}

/**
 * The voice-activity model used to skip non-speech regions. Best-effort: if it's disabled or the
 * download fails, transcription still runs (just without VAD) rather than the whole batch dying
 * over an optional accuracy aid.
 */
export async function ensureVadModel(): Promise<string | null> {
  if (!config.transcription.vadEnabled) return null;
  try {
    return await ensureModelFile(config.transcription.vadModelName, config.transcription.vadModelUrl);
  } catch (err) {
    console.warn("VAD model unavailable — transcribing without voice activity detection", err);
    return null;
  }
}

async function downloadModel(modelPath: string, url: string): Promise<string> {
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  const tempPath = `${modelPath}.downloading`;

  const res = await fetch(url);
  const body = res.body;
  if (!res.ok || !body) {
    throw new Error(`failed to download model ${path.basename(modelPath)}: HTTP ${res.status}`);
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
