import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { playHistory, files, folders, ratings, transcripts } from "../db/schema.js";
import { tagsByFileId } from "../db/tagLookup.js";

const MAX_HISTORY = 200;
// Guards against a single play() call logging twice (e.g. a fast double-tap on Play).
const DEDUPE_WINDOW_MS = 5000;

export default async function historyRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.post<{ Body: { fileId: number } }>("/history", async (request, reply) => {
    const fileId = request.body?.fileId;
    if (!fileId) {
      reply.code(400).send({ error: "fileId is required" });
      return;
    }
    const now = Date.now();
    const last = db
      .select({ fileId: playHistory.fileId, playedAt: playHistory.playedAt })
      .from(playHistory)
      .orderBy(desc(playHistory.playedAt))
      .limit(1)
      .get();
    if (!last || last.fileId !== fileId || now - last.playedAt > DEDUPE_WINDOW_MS) {
      db.insert(playHistory).values({ fileId, playedAt: now }).run();
    }
    reply.code(204).send();
  });

  fastify.get("/history", async (_request, reply) => {
    const rows = db
      .select({
        historyId: playHistory.id,
        playedAt: playHistory.playedAt,
        fileId: files.id,
        title: files.title,
        trackNumber: files.trackNumber,
        filename: files.filename,
        durationSec: files.durationSec,
        coverImagePath: files.coverImagePath,
        folderId: files.folderId,
        folderName: folders.name,
        rating: ratings.rating,
        hasTranscript: transcripts.id,
      })
      .from(playHistory)
      .innerJoin(files, and(eq(files.id, playHistory.fileId), isNull(files.deletedAt)))
      .innerJoin(folders, eq(folders.id, files.folderId))
      .leftJoin(ratings, eq(ratings.fileId, files.id))
      .leftJoin(transcripts, eq(transcripts.fileId, files.id))
      .orderBy(desc(playHistory.playedAt))
      .limit(MAX_HISTORY)
      .all()
      .map((r) => ({ ...r, hasTranscript: r.hasTranscript !== null }));

    const tagsByFile = tagsByFileId(rows.map((r) => r.fileId));
    reply.send(rows.map((r) => ({ ...r, tags: tagsByFile.get(r.fileId) ?? [] })));
  });

  fastify.delete("/history", async (_request, reply) => {
    db.delete(playHistory).run();
    reply.code(204).send();
  });
}
