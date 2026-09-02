import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import { syncConfig } from "../db/schema.js";
import { startSyncPush, getSyncJob, getSyncConfigRow } from "../sync/pushManager.js";
import { getSyncConfig, listManifest, ingestUpload, ingestDelete, type SyncUploadMeta } from "../sync/ingestManager.js";

function ensureConfigRow(): void {
  rawDb.prepare("INSERT OR IGNORE INTO sync_config (id, min_rating, updated_at) VALUES (1, 4, ?)").run(Date.now());
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function requireSyncApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cfg = getSyncConfig();
  const header = request.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!cfg?.ingestApiKey || !provided || !safeEqual(provided, cfg.ingestApiKey)) {
    reply.code(401).send({ error: "unauthorized" });
  }
}

export default async function syncRoutes(fastify: FastifyInstance) {
  // Ingest routes accept a raw audio stream, not JSON — bypass the default body parsers for this
  // one content type. Scoped to this plugin instance only, so it doesn't affect any other route.
  fastify.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
    done(null, payload);
  });

  // --- Admin config/control, browser session auth (this instance's owner configuring it) ---

  fastify.get("/sync/config", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    const cfg = getSyncConfigRow();
    reply.send({
      remoteBaseUrl: cfg?.remoteBaseUrl ?? null,
      remoteApiKeySet: !!cfg?.remoteApiKey,
      minRating: cfg?.minRating ?? 4,
      ingestApiKey: cfg?.ingestApiKey ?? null,
      ingestLibraryRootId: cfg?.ingestLibraryRootId ?? null,
    });
  });

  fastify.put<{ Body: { remoteBaseUrl?: string; remoteApiKey?: string; minRating?: number } }>(
    "/sync/config",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { remoteBaseUrl, remoteApiKey, minRating } = request.body ?? {};
      if (minRating !== undefined && (!Number.isInteger(minRating) || minRating < 1 || minRating > 5)) {
        reply.code(400).send({ error: "minRating must be an integer 1-5" });
        return;
      }
      ensureConfigRow();
      db.update(syncConfig)
        .set({
          ...(remoteBaseUrl !== undefined ? { remoteBaseUrl: remoteBaseUrl.trim() || null } : {}),
          // Only overwrite the stored key when a new non-empty one is actually submitted — the
          // browser never gets the old value back, so an empty submit here means "leave it".
          ...(remoteApiKey ? { remoteApiKey } : {}),
          ...(minRating !== undefined ? { minRating } : {}),
          updatedAt: Date.now(),
        })
        .where(eq(syncConfig.id, 1))
        .run();
      reply.send({ ok: true });
    }
  );

  fastify.put<{ Body: { ingestLibraryRootId?: number | null } }>(
    "/sync/ingest-config",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      ensureConfigRow();
      db.update(syncConfig)
        .set({ ingestLibraryRootId: request.body?.ingestLibraryRootId ?? null, updatedAt: Date.now() })
        .where(eq(syncConfig.id, 1))
        .run();
      reply.send({ ok: true });
    }
  );

  fastify.post("/sync/ingest-key/regenerate", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    ensureConfigRow();
    const key = crypto.randomBytes(32).toString("hex");
    db.update(syncConfig).set({ ingestApiKey: key, updatedAt: Date.now() }).where(eq(syncConfig.id, 1)).run();
    reply.send({ ingestApiKey: key });
  });

  fastify.post("/sync/run", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    try {
      reply.send(startSyncPush());
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : "failed to start sync" });
    }
  });

  fastify.get("/sync/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    reply.send(getSyncJob() ?? { status: "idle", entries: [], startedAt: 0 });
  });

  // --- Ingest routes, API-key auth (the remote AudioHub instance pushing content here) ---

  fastify.get("/sync/manifest", { preHandler: requireSyncApiKey }, async (_request, reply) => {
    reply.send({ contentHashes: listManifest() });
  });

  fastify.post(
    "/sync/upload",
    { preHandler: requireSyncApiKey, config: { rateLimit: { max: 200, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const metaHeader = request.headers["x-sync-meta"];
      if (typeof metaHeader !== "string") {
        reply.code(400).send({ error: "missing X-Sync-Meta header" });
        return;
      }
      let meta: SyncUploadMeta;
      try {
        meta = JSON.parse(Buffer.from(metaHeader, "base64").toString("utf8"));
      } catch {
        reply.code(400).send({ error: "invalid X-Sync-Meta header" });
        return;
      }
      if (!meta.contentHash || !meta.filename) {
        reply.code(400).send({ error: "contentHash and filename are required" });
        return;
      }
      try {
        await ingestUpload(meta, request.body as Readable);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(500).send({ error: err instanceof Error ? err.message : "upload failed" });
      }
    }
  );

  fastify.delete<{ Params: { contentHash: string } }>(
    "/sync/files/:contentHash",
    { preHandler: requireSyncApiKey },
    async (request, reply) => {
      ingestDelete(request.params.contentHash);
      reply.send({ ok: true });
    }
  );
}
