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
  wavConversion: {
    defaultBitrateKbps: 128,
    allowedBitrates: [96, 128, 192],
    defaultConcurrency: 2,
    maxConcurrency: 4,
  },
};

export type Config = typeof config;
