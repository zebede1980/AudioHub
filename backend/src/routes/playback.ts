import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { playbackState, playbackSession, files } from "../db/schema.js";

interface SavePositionBody {
  fileId: number;
  positionSec: number;
  isPlaying?: boolean;
}

async function savePosition(
  request: FastifyRequest<{ Body: SavePositionBody }>,
  reply: FastifyReply
): Promise<void> {
  const { fileId, positionSec, isPlaying } = request.body ?? ({} as SavePositionBody);
  if (!fileId || typeof positionSec !== "number") {
    reply.code(400).send({ error: "fileId and positionSec are required" });
    return;
  }
  const now = Date.now();

  db.insert(playbackState)
    .values({ fileId, positionSec, updatedAt: now })
    .onConflictDoUpdate({ target: playbackState.fileId, set: { positionSec, updatedAt: now } })
    .run();

  db.insert(playbackSession)
    .values({ id: 1, currentFileId: fileId, positionSec, isPlaying: isPlaying ? 1 : 0, updatedAt: now })
    .onConflictDoUpdate({
      target: playbackSession.id,
      set: { currentFileId: fileId, positionSec, isPlaying: isPlaying ? 1 : 0, updatedAt: now },
    })
    .run();

  reply.code(204).send();
}

export default async function playbackRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  // PUT is used for regular throttled saves; POST is also accepted because navigator.sendBeacon
  // (used on pagehide, since a fetch() there could be cancelled mid-flight) can only send POST.
  fastify.put<{ Body: SavePositionBody }>("/playback/position", savePosition);
  fastify.post<{ Body: SavePositionBody }>("/playback/position", savePosition);

  fastify.get("/playback/resume", async (_request, reply) => {
    const session = db.select().from(playbackSession).where(eq(playbackSession.id, 1)).get();
    if (!session?.currentFileId) {
      reply.send({ current: null });
      return;
    }
    const file = db.select().from(files).where(eq(files.id, session.currentFileId)).get();
    reply.send({ current: file ? { file, positionSec: session.positionSec } : null });
  });
}
