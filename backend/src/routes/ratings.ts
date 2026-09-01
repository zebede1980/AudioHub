import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ratings, files, folderRatings, folders } from "../db/schema.js";

export default async function ratingsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.put<{ Params: { id: string }; Body: { rating: number } }>("/files/:id/rating", async (request, reply) => {
    const fileId = Number(request.params.id);
    const rating = Number(request.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      reply.code(400).send({ error: "rating must be an integer 1-5" });
      return;
    }
    const file = db.select().from(files).where(eq(files.id, fileId)).get();
    if (!file) {
      reply.code(404).send({ error: "not found" });
      return;
    }

    const ratedAt = Date.now();
    db.insert(ratings)
      .values({ fileId, rating, ratedAt })
      .onConflictDoUpdate({ target: ratings.fileId, set: { rating, ratedAt } })
      .run();
    reply.send({ fileId, rating });
  });

  fastify.delete<{ Params: { id: string } }>("/files/:id/rating", async (request, reply) => {
    const fileId = Number(request.params.id);
    db.delete(ratings).where(eq(ratings.fileId, fileId)).run();
    reply.code(204).send();
  });

  fastify.put<{ Params: { id: string }; Body: { rating: number } }>(
    "/folders/:id/rating",
    async (request, reply) => {
      const folderId = Number(request.params.id);
      const rating = Number(request.body?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        reply.code(400).send({ error: "rating must be an integer 1-5" });
        return;
      }
      const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
      if (!folder) {
        reply.code(404).send({ error: "not found" });
        return;
      }

      const ratedAt = Date.now();
      db.insert(folderRatings)
        .values({ folderId, rating, ratedAt })
        .onConflictDoUpdate({ target: folderRatings.folderId, set: { rating, ratedAt } })
        .run();
      reply.send({ folderId, rating });
    }
  );

  fastify.delete<{ Params: { id: string } }>("/folders/:id/rating", async (request, reply) => {
    const folderId = Number(request.params.id);
    db.delete(folderRatings).where(eq(folderRatings.folderId, folderId)).run();
    reply.code(204).send();
  });
}
