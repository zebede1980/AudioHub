import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, folders, libraryRoots, ratings } from "../db/schema.js";
import { streamFileWithRangeSupport, mimeTypeForExtension, imageMimeTypeForExtension } from "../streaming/rangeStream.js";
import { resolveCoverAbsolutePath } from "../scanner/coverCache.js";
import { startScan } from "../scanner/scanManager.js";

async function loadFileWithRoot(id: number) {
  const file = db.select().from(files).where(eq(files.id, id)).get();
  if (!file) return null;
  const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, file.libraryRootId)).get();
  if (!root) return null;
  return { file, root };
}

export default async function filesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get("/files/rated", async (_request, reply) => {
    const rows = db
      .select({
        id: files.id,
        folderId: files.folderId,
        folderName: folders.name,
        title: files.title,
        filename: files.filename,
        durationSec: files.durationSec,
        coverImagePath: files.coverImagePath,
        rating: ratings.rating,
        ratedAt: ratings.ratedAt,
      })
      .from(ratings)
      .innerJoin(files, and(eq(files.id, ratings.fileId), isNull(files.deletedAt)))
      .innerJoin(folders, eq(folders.id, files.folderId))
      .orderBy(desc(ratings.rating), desc(ratings.ratedAt))
      .all();
    reply.send(rows);
  });

  // Permanently deletes every file at a given star rating from disk (e.g. "clean out my 1-stars").
  // DB reconciliation (soft-deleting the rows, fixing folder aggregate counts) is left to the
  // scanner — the same machinery that already handles a file vanishing from disk — rather than
  // duplicating that bookkeeping here.
  fastify.delete<{ Params: { rating: string } }>("/files/rated/:rating", async (request, reply) => {
    const rating = Number(request.params.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      reply.code(400).send({ error: "rating must be an integer 1-5" });
      return;
    }

    const rows = db
      .select({
        libraryRootId: files.libraryRootId,
        relativePath: files.relativePath,
        containerPath: libraryRoots.containerPath,
      })
      .from(ratings)
      .innerJoin(files, and(eq(files.id, ratings.fileId), isNull(files.deletedAt)))
      .innerJoin(libraryRoots, eq(libraryRoots.id, files.libraryRootId))
      .where(eq(ratings.rating, rating))
      .all();

    const touchedRoots = new Map<number, string>();
    let deletedCount = 0;
    for (const row of rows) {
      const absPath = path.join(row.containerPath, row.relativePath);
      try {
        fs.rmSync(absPath, { force: true });
        deletedCount++;
        touchedRoots.set(row.libraryRootId, row.containerPath);
      } catch (err) {
        fastify.log.error({ err, absPath }, "failed to delete rated file");
      }
    }

    for (const [rootId, containerPath] of touchedRoots) {
      startScan(rootId, containerPath);
    }

    reply.send({ deletedCount, total: rows.length });
  });

  fastify.get<{ Params: { id: string } }>("/files/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const found = await loadFileWithRoot(id);
    if (!found) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const { file } = found;
    const rating = db.select().from(ratings).where(eq(ratings.fileId, id)).get();

    const siblings = db
      .select({ id: files.id, trackNumber: files.trackNumber, filename: files.filename })
      .from(files)
      .where(and(eq(files.folderId, file.folderId), isNull(files.deletedAt)))
      .orderBy(asc(files.trackNumber), asc(files.filename))
      .all();
    const index = siblings.findIndex((s) => s.id === id);
    const prevFileId = index > 0 ? siblings[index - 1].id : null;
    const nextFileId = index >= 0 && index < siblings.length - 1 ? siblings[index + 1].id : null;

    reply.send({ ...file, rating: rating?.rating ?? null, prevFileId, nextFileId });
  });

  fastify.get<{ Params: { id: string } }>("/files/:id/stream", async (request, reply) => {
    const id = Number(request.params.id);
    const found = await loadFileWithRoot(id);
    if (!found) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const { file, root } = found;
    const absPath = path.join(root.containerPath, file.relativePath);
    if (!fs.existsSync(absPath)) {
      reply.code(404).send({ error: "file missing on disk" });
      return;
    }
    await streamFileWithRangeSupport(request, reply, absPath, mimeTypeForExtension(file.extension));
  });

  fastify.get<{ Params: { id: string } }>("/files/:id/cover", async (request, reply) => {
    const id = Number(request.params.id);
    const found = await loadFileWithRoot(id);
    if (!found?.file.coverImagePath) {
      reply.code(404).send();
      return;
    }
    const absPath = resolveCoverAbsolutePath(found.file.coverImagePath, found.root.containerPath);
    if (!fs.existsSync(absPath)) {
      reply.code(404).send();
      return;
    }
    reply.header("Cache-Control", "public, max-age=86400, immutable");
    reply.header("Content-Type", imageMimeTypeForExtension(path.extname(absPath)));
    return reply.send(fs.createReadStream(absPath));
  });
}
