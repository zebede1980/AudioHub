import type { FastifyInstance } from "fastify";
import { rawDb } from "../db/client.js";
import { tagsByFileId } from "../db/tagLookup.js";

export default async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/search",
    async (request, reply) => {
      const q = (request.query.q ?? "").trim();
      if (!q) {
        reply.send({ folders: [], files: [] });
        return;
      }
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(request.query.pageSize) || 50));
      const offset = (page - 1) * pageSize;

      // Folders are few (hundreds, not millions) so a plain per-token LIKE scan is plenty —
      // no need for a second FTS index just for folder names.
      const tokens = q.split(/\s+/).filter(Boolean);
      const folderWhere = tokens.map(() => "f.name LIKE ? ESCAPE '\\'").join(" AND ");
      const likeParams = tokens.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`);
      const folderRows = rawDb
        .prepare(
          `SELECT f.id, f.name, f.relative_path, f.file_count, f.cover_image_path, fr.rating
           FROM folders f
           LEFT JOIN folder_ratings fr ON fr.folder_id = f.id
           WHERE f.relative_path != '' AND ${folderWhere}
           ORDER BY f.name LIMIT 20`
        )
        .all(...likeParams);

      // Prefix-match every token; quoting handles punctuation safely inside FTS5 MATCH syntax.
      const ftsQuery = tokens.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" ");

      const fileRows = rawDb
        .prepare(
          `SELECT f.id, f.folder_id, f.title, f.filename, f.parsed_author, f.parsed_series_or_book, f.duration_sec, f.cover_image_path, r.rating
           FROM files_fts fts JOIN files f ON f.id = fts.rowid
           LEFT JOIN ratings r ON r.file_id = f.id
           WHERE files_fts MATCH ? AND f.deleted_at IS NULL
           ORDER BY rank LIMIT ? OFFSET ?`
        )
        .all(ftsQuery, pageSize, offset) as { id: number }[];

      const tagsByFile = tagsByFileId(fileRows.map((f) => f.id));
      const filesWithTags = fileRows.map((f) => ({ ...f, tags: tagsByFile.get(f.id) ?? [] }));

      reply.send({ folders: folderRows, files: filesWithTags, page, pageSize });
    }
  );
}
