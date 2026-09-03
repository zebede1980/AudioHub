import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { folders, files, ratings, folderRatings, libraryRoots, transcripts } from "../db/schema.js";
import { resolveCoverAbsolutePath } from "../scanner/coverCache.js";
import { tagsByFileId } from "../db/tagLookup.js";
import { imageMimeTypeForExtension } from "../streaming/rangeStream.js";
import { startScan } from "../scanner/scanManager.js";
import { foldersForReview, folderContents } from "../trash/folderContents.js";
import { moveFolderToTrash } from "../trash/trashManager.js";
import { mergeFolders, MergeError } from "../folders/mergeFolders.js";
import { uploadToFolder, UploadError } from "../folders/uploadToFolder.js";
import type { Readable } from "node:stream";

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function breadcrumbFor(folderId: number): { id: number; name: string }[] {
  const chain: { id: number; name: string }[] = [];
  let currentId: number | null = folderId;
  while (currentId !== null) {
    const row = db.select().from(folders).where(eq(folders.id, currentId)).get();
    if (!row) break;
    chain.unshift({ id: row.id, name: row.name });
    currentId = row.parentFolderId;
  }
  return chain;
}

export default async function foldersRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  // The upload route takes raw audio bytes, not JSON. Scoped to this plugin instance only, the
  // same way the sync ingest routes do it.
  fastify.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
    done(null, payload);
  });

  /** Candidate folders to merge into the one being viewed — the picker's search. */
  fastify.get<{ Querystring: { q?: string; targetId?: string } }>("/folders/search", async (request, reply) => {
    const targetId = Number(request.query.targetId);
    const target = Number.isInteger(targetId)
      ? db.select().from(folders).where(eq(folders.id, targetId)).get()
      : undefined;

    // A folder can't be merged into its own subfolder, so the target and everything above it are
    // not offerable. Filtering them out here beats letting the user pick one and get an error.
    const excluded = new Set<number>();
    if (target) for (const crumb of breadcrumbFor(target.id)) excluded.add(crumb.id);

    const tokens = (request.query.q ?? "").split(/\s+/).filter(Boolean);
    const rows = db
      .select({
        id: folders.id,
        name: folders.name,
        relativePath: folders.relativePath,
        fileCount: folders.fileCount,
        libraryRootId: folders.libraryRootId,
      })
      .from(folders)
      .all()
      .filter(
        (row) =>
          row.relativePath !== "" &&
          !excluded.has(row.id) &&
          (!target || row.libraryRootId === target.libraryRootId) &&
          tokens.every((token) => row.relativePath.toLowerCase().includes(token.toLowerCase()))
      )
      // Fuller folders first: merging into a stub is the common case, so the real one should be
      // the easy pick rather than buried in an alphabetical list.
      .sort((a, b) => b.fileCount - a.fileCount || a.relativePath.localeCompare(b.relativePath))
      .slice(0, 30);

    reply.send(rows);
  });

  fastify.get("/folders/rated", async (_request, reply) => {
    const rows = db
      .select({
        id: folders.id,
        name: folders.name,
        relativePath: folders.relativePath,
        fileCount: folders.fileCount,
        coverImagePath: folders.coverImagePath,
        rating: folderRatings.rating,
        ratedAt: folderRatings.ratedAt,
      })
      .from(folderRatings)
      .innerJoin(folders, eq(folders.id, folderRatings.folderId))
      .orderBy(desc(folderRatings.rating), desc(folderRatings.ratedAt))
      .all();
    reply.send(rows);
  });

  // Everything the delete-review screen needs to decide folder by folder: recursive file counts
  // and sizes (folders.file_count only counts a folder's *direct* files, which badly understates
  // what a recursive delete would take), plus the signals that flag a misclick — a highly rated
  // file inside, a recent play, transcripts that took real time to generate.
  fastify.get<{ Params: { rating: string } }>("/folders/rated/:rating/review", async (request, reply) => {
    const rating = Number(request.params.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      reply.code(400).send({ error: "rating must be an integer 1-5" });
      return;
    }
    reply.send(foldersForReview(rating));
  });

  // Flat, recursive listing of a folder's audio, so the review screen can expand a folder and let
  // the user play anything inside it before committing to the delete.
  fastify.get<{ Params: { id: string } }>("/folders/:id/contents", async (request, reply) => {
    const id = Number(request.params.id);
    const folder = db.select().from(folders).where(eq(folders.id, id)).get();
    if (!folder) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.send(folderContents(id));
  });

  /**
   * Moves an explicit list of folders to the trash. Deliberately takes ids rather than a star
   * rating: the user confirms a specific set of folders on the review screen, and only those get
   * deleted — a rating changed in another tab (or a folder rated 1 star between review and
   * confirm) can no longer sweep something extra along with it.
   */
  fastify.post<{ Body: { folderIds?: unknown } }>("/folders/delete", async (request, reply) => {
    const raw = request.body?.folderIds;
    const folderIds = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (folderIds.length === 0) {
      reply.code(400).send({ error: "folderIds must be a non-empty array of folder ids" });
      return;
    }

    const touchedRoots = new Map<number, string>();
    const deleted: { folderId: number; name: string; fileCount: number }[] = [];
    const failed: { folderId: number; error: string }[] = [];

    for (const folderId of folderIds) {
      try {
        const result = moveFolderToTrash(folderId);
        deleted.push({ folderId, name: result.name, fileCount: result.fileCount });
        touchedRoots.set(result.libraryRootId, result.containerPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : "failed to delete folder";
        fastify.log.error({ err, folderId }, "failed to move folder to trash");
        failed.push({ folderId, error: message });
      }
    }

    for (const [rootId, containerPath] of touchedRoots) {
      startScan(rootId, containerPath);
    }

    reply.send({ deletedCount: deleted.length, total: folderIds.length, deleted, failed });
  });

  fastify.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/folders/:id",
    async (request, reply) => {
      const id = Number(request.params.id);
      const folder = db.select().from(folders).where(eq(folders.id, id)).get();
      if (!folder) {
        reply.code(404).send({ error: "not found" });
        return;
      }

      const folderRatingRow = db.select().from(folderRatings).where(eq(folderRatings.folderId, id)).get();

      const breadcrumb = breadcrumbFor(id);
      // Sorted in JS with localeCompare rather than SQLite's default BINARY collation, which
      // sorts all-uppercase names before lowercase ones and looks close to random once folder
      // names mix casing conventions.
      const subfolderRows = db.select().from(folders).where(eq(folders.parentFolderId, id)).all();
      const subfolderRatings = subfolderRows.length
        ? db
            .select()
            .from(folderRatings)
            .where(
              inArray(
                folderRatings.folderId,
                subfolderRows.map((f) => f.id)
              )
            )
            .all()
        : [];
      const subfolderRatingByFolderId = new Map(subfolderRatings.map((r) => [r.folderId, r.rating]));
      const subfolders = subfolderRows
        .map((f) => ({ ...f, rating: subfolderRatingByFolderId.get(f.id) ?? null }))
        .sort((a, b) =>
          request.query.folderSort === "fileCount"
            ? b.fileCount - a.fileCount || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
            : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );

      const { page, pageSize, offset } = parsePagination(request.query);
      const order = request.query.order === "desc" ? desc : asc;
      const sortColumn =
        request.query.sort === "title"
          ? files.title
          : request.query.sort === "duration"
            ? files.durationSec
            : request.query.sort === "rating"
              ? ratings.rating
              : files.trackNumber;

      const fileRows = db
        .select({
          id: files.id,
          filename: files.filename,
          title: files.title,
          trackNumber: files.trackNumber,
          durationSec: files.durationSec,
          coverImagePath: files.coverImagePath,
          rating: ratings.rating,
          hasTranscript: transcripts.id,
        })
        .from(files)
        .leftJoin(ratings, eq(ratings.fileId, files.id))
        .leftJoin(transcripts, eq(transcripts.fileId, files.id))
        .where(and(eq(files.folderId, id), isNull(files.deletedAt)))
        .orderBy(order(sortColumn))
        .limit(pageSize)
        .offset(offset)
        .all()
        .map((row) => ({ ...row, hasTranscript: row.hasTranscript !== null }));

      const tagsByFile = tagsByFileId(fileRows.map((f) => f.id));
      const filesWithTags = fileRows.map((f) => ({ ...f, tags: tagsByFile.get(f.id) ?? [] }));

      reply.send({
        folder: { ...folder, rating: folderRatingRow?.rating ?? null },
        breadcrumb,
        subfolders,
        files: filesWithTags,
        page,
        pageSize,
      });
    }
  );

  fastify.put<{ Params: { id: string }; Body: { sourceUrl?: string | null } }>(
    "/folders/:id/source-url",
    async (request, reply) => {
      const id = Number(request.params.id);
      const folder = db.select().from(folders).where(eq(folders.id, id)).get();
      if (!folder) {
        reply.code(404).send({ error: "not found" });
        return;
      }

      const raw = (request.body?.sourceUrl ?? "").trim();
      let sourceUrl: string | null = null;
      if (raw) {
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          reply.code(400).send({ error: "that isn't a valid URL" });
          return;
        }
        // The UI renders this as a clickable link, so anything but http(s) — javascript:, data: —
        // has to be refused here rather than relying on the browser to be unhelpful about it.
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          reply.code(400).send({ error: "only http and https links are allowed" });
          return;
        }
        sourceUrl = parsed.toString();
      }

      db.update(folders).set({ sourceUrl }).where(eq(folders.id, id)).run();
      reply.send({ sourceUrl });
    }
  );

  fastify.post<{ Params: { id: string }; Body: { sourceFolderId?: number } }>(
    "/folders/:id/merge",
    async (request, reply) => {
      const sourceFolderId = Number(request.body?.sourceFolderId);
      if (!Number.isInteger(sourceFolderId)) {
        reply.code(400).send({ error: "sourceFolderId is required" });
        return;
      }
      try {
        reply.send(mergeFolders(Number(request.params.id), sourceFolderId));
      } catch (err) {
        if (err instanceof MergeError) {
          reply.code(err.statusCode).send({ error: err.message });
          return;
        }
        request.log.error({ err }, "folder merge failed");
        reply.code(500).send({ error: err instanceof Error ? err.message : "merge failed" });
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/folders/:id/upload",
    // A single audio file, so the route-level cap is generous but not the server-wide 5GB.
    { bodyLimit: 2 * 1024 * 1024 * 1024 },
    async (request, reply) => {
      // Base64 in a header rather than a query param: filenames carry unicode, quotes and
      // semicolons, none of which survive a raw header value intact.
      const header = request.headers["x-upload-filename"];
      if (typeof header !== "string") {
        reply.code(400).send({ error: "missing X-Upload-Filename header" });
        return;
      }
      let filename: string;
      try {
        filename = Buffer.from(header, "base64").toString("utf8");
      } catch {
        reply.code(400).send({ error: "invalid X-Upload-Filename header" });
        return;
      }
      if (!filename.trim()) {
        reply.code(400).send({ error: "a filename is required" });
        return;
      }
      try {
        reply.send(await uploadToFolder(Number(request.params.id), filename, request.body as Readable));
      } catch (err) {
        if (err instanceof UploadError) {
          reply.code(err.statusCode).send({ error: err.message });
          return;
        }
        request.log.error({ err }, "folder upload failed");
        reply.code(500).send({ error: err instanceof Error ? err.message : "upload failed" });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>("/folders/:id/cover", async (request, reply) => {
    const id = Number(request.params.id);
    const folder = db.select().from(folders).where(eq(folders.id, id)).get();
    if (!folder?.coverImagePath) {
      reply.code(404).send();
      return;
    }
    const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, folder.libraryRootId)).get();
    if (!root) {
      reply.code(404).send();
      return;
    }
    const absPath = resolveCoverAbsolutePath(folder.coverImagePath, root.containerPath);
    if (!fs.existsSync(absPath)) {
      reply.code(404).send();
      return;
    }
    reply.header("Cache-Control", "public, max-age=86400, immutable");
    reply.header("Content-Type", imageMimeTypeForExtension(path.extname(absPath)));
    return reply.send(fs.createReadStream(absPath));
  });
}
