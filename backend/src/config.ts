import path from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8420),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",

  databasePath: process.env.DATABASE_PATH ?? path.resolve("data/audiohub.db"),
  coverCacheDir: process.env.COVER_CACHE_DIR ?? path.resolve("data/cache/covers"),
  publicDir: process.env.PUBLIC_DIR ?? path.resolve("public"),

  sessionSecret: required("SESSION_SECRET", process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret"),
  sessionCookieName: "audiohub_session",
  sessionSlidingDays: 30,
  sessionAbsoluteMaxDays: 90,
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",

  adminUsername: process.env.ADMIN_USERNAME,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,

  trustProxy: process.env.TRUST_PROXY === "true",

  audioExtensions: [".mp3", ".m4a", ".m4b", ".aac", ".flac", ".ogg", ".opus", ".wav", ".wma"],
  imageExtensions: [".jpg", ".jpeg", ".png", ".webp"],
  coverFilenamePriority: ["cover", "folder", "art"],

  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",

  transcription: {
    whisperCliPath: process.env.WHISPER_CLI_PATH ?? "whisper-cli",
    modelDir: process.env.WHISPER_MODEL_DIR ?? path.resolve("data/whisper-models"),
    // large-v3-turbo: near-large-v3 accuracy (handles background music/SFX well) at a fraction of
    // the compute cost. q5_0 quantization trims size/RAM/CPU time with negligible quality loss.
    modelName: process.env.WHISPER_MODEL_NAME ?? "ggml-large-v3-turbo-q5_0.bin",
    modelUrl:
      process.env.WHISPER_MODEL_URL ??
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    defaultConcurrency: 1,
    maxConcurrency: 2,

    // Anti-repetition settings. whisper feeds the text it just produced into the next 30s window
    // as context; on audio with long non-speech stretches it emits a filler ("Mm-hmm."), which
    // then becomes the context that makes it emit the same filler again, and again. Carrying no
    // text context between windows breaks that loop at the cost of some long-range coherence.
    maxContext: Number(process.env.WHISPER_MAX_CONTEXT ?? 0),
    // Stops breaths/ambience being narrated as filler tokens in the first place.
    suppressNonSpeech: process.env.WHISPER_SUPPRESS_NON_SPEECH !== "false",
    // Voice activity detection: skip non-speech regions entirely, so the decoder never sees the
    // silence that starts a spiral. Off by default — silero scores breathy, whispered and moaned
    // delivery as non-speech, so on that kind of audio it discards most of the file and the
    // transcript stops partway through while still looking like a clean result. Measured on a
    // 6-minute file: 92% of the audio dropped at the default threshold, and still 75% at 0.05,
    // so no threshold rescues it. maxContext and suppressNonSpeech already break the repetition
    // spirals VAD was added for, and longestRepeatedRun flags whatever gets past them.
    // Set WHISPER_VAD=true for a library of plain dialogue, where it is a large speed win.
    vadEnabled: process.env.WHISPER_VAD === "true",
    vadModelName: process.env.WHISPER_VAD_MODEL_NAME ?? "ggml-silero-v5.1.2.bin",
    vadModelUrl:
      process.env.WHISPER_VAD_MODEL_URL ??
      "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
    /** A transcript with this many identical sentences back to back is flagged as degraded. Real
     * audio in this library does repeat short interjections, so the bar sits well above that. */
    repetitionRunWarning: 10,
  },

  trash: {
    // Folders deleted from the library are moved into <library root>/.audiohub-trash and erased
    // for real only once they are older than this, by the sweep that runs at startup and nightly.
    retentionDays: Number(process.env.TRASH_RETENTION_DAYS ?? 30),
  },

  audioConversion: {
    // Lossless formats eligible for the Settings "convert to MP3" batch job.
    sourceExtensions: [".wav", ".flac"],
    defaultBitrateKbps: 128,
    allowedBitrates: [96, 128, 192],
    defaultConcurrency: 2,
    maxConcurrency: 4,
  },
};

export type Config = typeof config;
