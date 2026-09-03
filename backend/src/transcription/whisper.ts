import fs from "node:fs";
import { spawn } from "node:child_process";
import { config } from "../config.js";

export interface WhisperResult {
  text: string;
  language: string | null;
}

/** Runs whisper.cpp on a 16kHz mono WAV file and returns the plain-text transcript. */
export function runWhisper(
  wavPath: string,
  modelPath: string,
  outputBasePath: string,
  vadModelPath: string | null
): Promise<WhisperResult> {
  return new Promise((resolve, reject) => {
    const args = [
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
      // Carry no (or little) text context between 30s windows — see config.transcription.maxContext
      // for why this matters on audio with long non-speech stretches.
      "-mc",
      String(config.transcription.maxContext),
    ];
    if (config.transcription.suppressNonSpeech) args.push("-sns");
    if (vadModelPath) args.push("--vad", "-vm", vadModelPath);

    const proc = spawn(config.transcription.whisperCliPath, args);

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

      // whisper's stderr is otherwise discarded on success, which is how a VAD pass that threw
      // away most of the audio went unnoticed: the transcript just looked terse rather than
      // truncated. Surface the reduction so a bad filter is visible in the container log.
      const vadReduction = stderr.match(/Reduced audio from \d+ to \d+ samples \(([\d.]+)% reduction\)/);
      if (vadReduction) {
        const speechMatch = stderr.match(/total duration of speech segments:\s*([\d.]+)/);
        const speech = speechMatch ? `${speechMatch[1]}s kept, ` : "";
        console.log(`whisper vad: ${speech}${vadReduction[1]}% of audio skipped for ${wavPath}`);
      }

      resolve({ text, language: languageMatch ? languageMatch[1].toLowerCase() : null });
    });
  });
}
