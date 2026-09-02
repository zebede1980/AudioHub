import fs from "node:fs";
import { spawn } from "node:child_process";
import { config } from "../config.js";

export interface WhisperResult {
  text: string;
  language: string | null;
}

/** Runs whisper.cpp on a 16kHz mono WAV file and returns the plain-text transcript. */
export function runWhisper(wavPath: string, modelPath: string, outputBasePath: string): Promise<WhisperResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.transcription.whisperCliPath, [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-otxt",
      "-of",
      outputBasePath,
      "-nt", // suppress per-line timestamps in the console log (the .txt output is already plain text)
      "-l",
      "auto", // whisper-cli defaults to forced English otherwise, skipping language detection entirely
    ]);

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(-2000)}`));
        return;
      }

      const txtPath = `${outputBasePath}.txt`;
      let text: string;
      try {
        text = fs.readFileSync(txtPath, "utf8").trim();
      } catch {
        reject(new Error("whisper-cli reported success but produced no output file"));
        return;
      } finally {
        fs.rmSync(txtPath, { force: true });
      }

      const languageMatch = stderr.match(/auto-detected language:\s*([a-z]{2,3})/i);
      resolve({ text, language: languageMatch ? languageMatch[1].toLowerCase() : null });
    });
  });
}
