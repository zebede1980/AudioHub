import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, folders, libraryRoots } from "../db/schema.js";
import { config } from "../config.js";
import { startConversion, getConversionStatus, cancelConversion } from "../converter/conversionManager.js";

export default async function convertRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get("/convert/wav-files", async (_request, reply) => {
    const rows = db
      .select({
        id: files.id,
        relativePath: files.relativePath,
        filename: files.filename,
        sizeBytes: files.sizeBytes,
        folderId: files.folderId,
        folderName: folders.name,
        libraryRootId: files.libraryRootId,
        libraryRootName: libraryRoots.name,
      })
      .from(files)
      .innerJoin(folders, eq(folders.id, files.folderId))
      .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
      .where(and(eq(files.extension, ".wav"), isNull(files.deletedAt)))
      .orderBy(files.relativePath)
      .all();

    const totalBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
    reply.send({ files: rows, count: rows.length, totalBytes });
  });

  fastify.post<{ Body: { fileIds?: number[]; bitrateKbps?: number; concurrency?: number } }>(
    "/convert/start",
    async (request, reply) => {
      const existing = getConversionStatus();
      if (existing && (existing.status === "running" || existing.status === "cancelling")) {
        reply.code(409).send({ error: "a conversion batch is already running" });
        return;
      }

      const {
        fileIds,
        bitrateKbps = config.wavConversion.defaultBitrateKbps,
        concurrency = config.wavConversion.defaultConcurrency,
      } = request.body ?? {};

      if (!config.wavConversion.allowedBitrates.includes(bitrateKbps)) {
        reply
          .code(400)
          .send({ error: `bitrateKbps must be one of ${config.wavConversion.allowedBitrates.join(", ")}` });
        return;
      }
      const clampedConcurrency = Math.max(1, Math.min(concurrency, config.wavConversion.maxConcurrency));

      let targetIds = fileIds;
      if (!targetIds || targetIds.length === 0) {
        targetIds = db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.extension, ".wav"), isNull(files.deletedAt)))
          .all()
          .map((r) => r.id);
      }
      if (targetIds.length === 0) {
        reply.code(400).send({ error: "no WAV files to convert" });
        return;
      }

      const job = startConversion(targetIds, bitrateKbps, clampedConcurrency);
      reply.send({ status: job.status });
    }
  );

  fastify.get("/convert/status", async (_request, reply) => {
    reply.send(getConversionStatus() ?? { status: "idle" });
  });

  fastify.post("/convert/cancel", async (_request, reply) => {
    cancelConversion();
    reply.send({ status: "cancelling" });
  });
}
