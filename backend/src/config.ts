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
