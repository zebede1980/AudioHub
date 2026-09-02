import fs from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import cron from "node-cron";
import { config } from "./config.js";
import authPlugin from "./plugins/auth.js";
import securityPlugin from "./plugins/security.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import authRoutes from "./routes/auth.js";
import libraryRootsRoutes from "./routes/libraryRoots.js";
import foldersRoutes from "./routes/folders.js";
import filesRoutes from "./routes/files.js";
import searchRoutes from "./routes/search.js";
import ratingsRoutes from "./routes/ratings.js";
import playbackRoutes from "./routes/playback.js";
import scrapeRoutes from "./routes/scrape.js";
import historyRoutes from "./routes/history.js";
import convertRoutes from "./routes/convert.js";
import transcribeRoutes from "./routes/transcribe.js";
import tagsRoutes from "./routes/tags.js";
import syncRoutes from "./routes/sync.js";
import trashRoutes from "./routes/trash.js";
import { scanAllEnabledRoots } from "./scanner/scanManager.js";
import { purgeExpiredTrash } from "./trash/trashManager.js";
import { cleanTranscriptionTempDir } from "./transcription/transcriptionManager.js";

const fastify = Fastify({
  logger: true,
  trustProxy: config.trustProxy,
  // Default is 1MiB, far too small for a synced audiobook file (/sync/upload).
  bodyLimit: 5 * 1024 * 1024 * 1024,
});

await fastify.register(cookie);
await fastify.register(rateLimitPlugin);
await fastify.register(securityPlugin);
await fastify.register(authPlugin);

fastify.get("/api/health", async () => ({ status: "ok" }));

await fastify.register(authRoutes, { prefix: "/api" });
await fastify.register(libraryRootsRoutes, { prefix: "/api" });
await fastify.register(foldersRoutes, { prefix: "/api" });
await fastify.register(filesRoutes, { prefix: "/api" });
await fastify.register(searchRoutes, { prefix: "/api" });
await fastify.register(ratingsRoutes, { prefix: "/api" });
await fastify.register(playbackRoutes, { prefix: "/api" });
await fastify.register(scrapeRoutes, { prefix: "/api" });
await fastify.register(historyRoutes, { prefix: "/api" });
await fastify.register(convertRoutes, { prefix: "/api" });
await fastify.register(transcribeRoutes, { prefix: "/api" });
await fastify.register(tagsRoutes, { prefix: "/api" });
await fastify.register(syncRoutes, { prefix: "/api" });
await fastify.register(trashRoutes, { prefix: "/api" });

// Serves the built frontend (frontend/dist copied here at Docker build time) with SPA fallback.
if (fs.existsSync(config.publicDir)) {
  await fastify.register(staticPlugin, { root: config.publicDir });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html");
  });
} else {
  fastify.log.warn(`Public dir "${config.publicDir}" not found — frontend will not be served (API-only mode).`);
}

// Nightly incremental rescan of every enabled library root, in addition to manual + startup scans.
cron.schedule("0 3 * * *", () => {
  scanAllEnabledRoots().catch((err) => fastify.log.error(err));
  // Deleted folders sit in the trash for the retention window; this (plus the startup sweep) is
  // what eventually erases them, so the promise is "gone within a day or so of 30 days".
  try {
    const { purgedCount } = purgeExpiredTrash();
    if (purgedCount > 0) fastify.log.info({ purgedCount }, "purged expired trash entries");
  } catch (err) {
    fastify.log.error(err);
  }
});

try {
  await fastify.listen({ port: config.port, host: config.host });
  scanAllEnabledRoots().catch((err) => fastify.log.error(err));
  try {
    const { purgedCount } = purgeExpiredTrash();
    if (purgedCount > 0) fastify.log.info({ purgedCount }, "purged expired trash entries at startup");
  } catch (err) {
    fastify.log.error(err);
  }
  try {
    // A restart mid-transcription leaves the extraction WAV behind; nothing is in flight here.
    const { removedFiles, freedBytes } = cleanTranscriptionTempDir();
    if (removedFiles > 0) fastify.log.info({ removedFiles, freedBytes }, "cleared leftover transcription temp files");
  } catch (err) {
    fastify.log.error(err);
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
