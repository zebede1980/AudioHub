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
          `SELECT f.id, f.name, f.relative_path AS relativePath, f.file_count AS fileCount,
                  f.cover_image_path AS coverImagePath, fr.rating
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
          `SELECT f.id, f.folder_id AS folderId, f.title, f.track_number AS trackNumber, f.filename,
                  f.parsed_author AS parsedAuthor, f.parsed_series_or_book AS parsedSeriesOrBook,
                  f.duration_sec AS durationSec, f.cover_image_path AS coverImagePath, r.rating,
                  (tr.id IS NOT NULL) AS hasTranscript
           FROM files_fts fts JOIN files f ON f.id = fts.rowid
           LEFT JOIN ratings r ON r.file_id = f.id
           LEFT JOIN transcripts tr ON tr.file_id = f.id
           WHERE files_fts MATCH ? AND f.deleted_at IS NULL
           ORDER BY rank LIMIT ? OFFSET ?`
        )
        .all(ftsQuery, pageSize, offset)
        .map((row: any) => ({ ...row, hasTranscript: !!row.hasTranscript })) as { id: number; hasTranscript: boolean }[];

      const tagsByFile = tagsByFileId(fileRows.map((f) => f.id));
      const filesWithTags = fileRows.map((f) => ({ ...f, tags: tagsByFile.get(f.id) ?? [] }));

      reply.send({ folders: folderRows, files: filesWithTags, page, pageSize });
    }
  );
}
