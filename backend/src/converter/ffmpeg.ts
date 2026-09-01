import { spawn } from "node:child_process";
import { config } from "../config.js";

/** Transcodes a WAV file to MP3 via the system `ffmpeg` binary, at a fixed CBR bitrate. */
export function convertWavToMp3(inputPath: string, outputPath: string, bitrateKbps: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-map_metadata",
      "0",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      `${bitrateKbps}k`,
      "-f",
      "mp3",
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
