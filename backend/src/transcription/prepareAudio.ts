import { spawn } from "node:child_process";
import { config } from "../config.js";

/** Extracts a 16kHz mono WAV from any ffmpeg-decodable source file — the format whisper.cpp expects. */
export function extractWhisperWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outputPath,
    ]);

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
