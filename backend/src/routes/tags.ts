import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db, rawDb } from "../db/client.js";
import { tags, fileTags, files } from "../db/schema.js";
import { tagsByFileId } from "../db/tagLookup.js";

function normalizeTagName(raw: unknown): string | null {
  const name = String(raw ?? "").trim();
  return name ? name : null;
}

export default async function tagsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get("/tags", async (_request, reply) => {
    const rows = db
      .select({
        id: tags.id,
        name: tags.name,
        createdAt: tags.createdAt,
        trackCount: sql<number>`count(${fileTags.id})`,
      })
      .from(tags)
      .leftJoin(fileTags, eq(fileTags.tagId, tags.id))
      .groupBy(tags.id)
      .orderBy(asc(tags.name))
      .all();
    reply.send(rows);
  });

  fastify.post<{ Body: { name: string } }>("/tags", async (request, reply) => {
    const name = normalizeTagName(request.body?.name);
    if (!name) {
      reply.code(400).send({ error: "name is required" });
      return;
    }
    db.insert(tags).values({ name, createdAt: Date.now() }).onConflictDoNothing().run();
    const tag = db.select().from(tags).where(eq(tags.name, name)).get();
    reply.send(tag);
  });

  fastify.delete<{ Params: { id: string } }>("/tags/:id", async (request, reply) => {
    const id = Number(request.params.id);
    db.delete(tags).where(eq(tags.id, id)).run();
    reply.code(204).send();
  });

  // Tracks matching a set of tags, either all of them (narrows results as more tags are added)
  // or any of them. Shaped like the folder file list so the frontend can reuse FileRow.
  fastify.get<{ Querystring: { tagIds?: string; mode?: string; page?: string; pageSize?: string } }>(
    "/tags/tracks",
    async (request, reply) => {
      const tagIds = (request.query.tagIds ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n));
      if (tagIds.length === 0) {
        reply.send({ files: [], page: 1, pageSize: 50 });
        return;
      }
      const mode = request.query.mode === "any" ? "any" : "all";
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(request.query.pageSize) || 50));
      const offset = (page - 1) * pageSize;
      const placeholders = tagIds.map(() => "?").join(",");

      const rows = rawDb
        .prepare(
          `SELECT f.id, f.folder_id as folderId, f.title, f.filename, f.track_number as trackNumber,
                  f.duration_sec as durationSec, f.cover_image_path as coverImagePath,
                  r.rating, (tr.id IS NOT NULL) as hasTranscript
           FROM files f
           JOIN file_tags ft ON ft.file_id = f.id AND ft.tag_id IN (${placeholders})
           LEFT JOIN ratings r ON r.file_id = f.id
           LEFT JOIN transcripts tr ON tr.file_id = f.id
           WHERE f.deleted_at IS NULL
           GROUP BY f.id
           ${mode === "all" ? "HAVING COUNT(DISTINCT ft.tag_id) = ?" : ""}
           ORDER BY f.title, f.filename
           LIMIT ? OFFSET ?`
        )
        .all(...tagIds, ...(mode === "all" ? [tagIds.length] : []), pageSize, offset)
        .map((row: any) => ({ ...row, hasTranscript: !!row.hasTranscript })) as { id: number }[];

      const tagsByFile = tagsByFileId(rows.map((r) => r.id));
      const rowsWithTags = rows.map((r) => ({ ...r, tags: tagsByFile.get(r.id) ?? [] }));

      reply.send({ files: rowsWithTags, page, pageSize });
    }
  );

  fastify.get<{ Params: { id: string } }>("/files/:id/tags", async (request, reply) => {
    const fileId = Number(request.params.id);
    const rows = db
      .select({ id: tags.id, name: tags.name, createdAt: tags.createdAt })
      .from(fileTags)
      .innerJoin(tags, eq(tags.id, fileTags.tagId))
      .where(eq(fileTags.fileId, fileId))
      .orderBy(asc(tags.name))
      .all();
    reply.send(rows);
  });

  fastify.put<{ Params: { id: string }; Body: { tagIds: number[] } }>(
    "/files/:id/tags",
    async (request, reply) => {
      const fileId = Number(request.params.id);
      const tagIds = Array.isArray(request.body?.tagIds) ? request.body.tagIds.map(Number) : [];
      const file = db.select().from(files).where(eq(files.id, fileId)).get();
      if (!file) {
        reply.code(404).send({ error: "not found" });
        return;
      }

      rawDb.transaction(() => {
        db.delete(fileTags).where(eq(fileTags.fileId, fileId)).run();
        for (const tagId of tagIds) {
          db.insert(fileTags).values({ fileId, tagId }).onConflictDoNothing().run();
        }
      })();

      const rows = db
        .select({ id: tags.id, name: tags.name, createdAt: tags.createdAt })
        .from(fileTags)
        .innerJoin(tags, eq(tags.id, fileTags.tagId))
        .where(eq(fileTags.fileId, fileId))
        .orderBy(asc(tags.name))
        .all();
      reply.send(rows);
    }
  );
}
