import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { libraryRoots, folders, files, ratings, transcripts } from "../db/schema.js";
import { tagsByFileId } from "../db/tagLookup.js";
import { listSoundgasmPosts, resolveSoundgasmPost, type SoundgasmPost } from "../scraper/soundgasm.js";
import { markAlreadyImported } from "../scraper/existingImports.js";
import { startSoundgasmDownload, getDownloadJob, retrySoundgasmDownload } from "../scraper/downloadManager.js";

export default async function scrapeRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.post<{ Body: { profileUrl: string } }>("/scrape/soundgasm/list", async (request, reply) => {
    const profileUrl = request.body?.profileUrl;
    if (!profileUrl) {
      reply.code(400).send({ error: "profileUrl is required" });
      return;
    }
    try {
      const { username, posts } = await listSoundgasmPosts(profileUrl);
      reply.send({ username, posts: markAlreadyImported(username, posts) });
    } catch (err) {
      reply.code(422).send({ error: err instanceof Error ? err.message : "failed to fetch profile" });
    }
  });

  fastify.post<{ Body: { postUrl: string } }>("/scrape/soundgasm/resolve-post", async (request, reply) => {
    const postUrl = request.body?.postUrl;
    if (!postUrl) {
      reply.code(400).send({ error: "postUrl is required" });
      return;
    }
    try {
      const result = await resolveSoundgasmPost(postUrl);
      reply.send(result);
    } catch (err) {
      reply.code(422).send({ error: err instanceof Error ? err.message : "failed to fetch post" });
    }
  });

  fastify.post<{ Body: { libraryRootId: number; username: string; posts: SoundgasmPost[] } }>(
    "/scrape/soundgasm/download",
    async (request, reply) => {
      const { libraryRootId, username, posts } = request.body ?? {};
      if (!libraryRootId || !username || !posts?.length) {
        reply.code(400).send({ error: "libraryRootId, username, and at least one post are required" });
        return;
      }
      const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, libraryRootId)).get();
      if (!root) {
        reply.code(404).send({ error: "library root not found" });
        return;
      }
      const job = startSoundgasmDownload(root.id, root.containerPath, username, posts);
      reply.send({ jobId: job.id });
    }
  );

  fastify.post<{ Params: { jobId: string }; Body: { postUrls?: string[] } }>(
    "/scrape/soundgasm/download/:jobId/retry",
    async (request, reply) => {
      const job = retrySoundgasmDownload(request.params.jobId, request.body?.postUrls);
      if (!job) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.send(job);
    }
  );

  fastify.get<{ Params: { jobId: string } }>("/scrape/soundgasm/download-status/:jobId", async (request, reply) => {
    const job = getDownloadJob(request.params.jobId);
    if (!job) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.send(job);
  });

  // Post-download "ease of use": resolve a downloaded item to its library file, and the
  // destination folder to its library folder, so the UI can offer a play/browse-to link.
  fastify.get<{ Params: { jobId: string }; Querystring: { postUrl: string } }>(
    "/scrape/soundgasm/download/:jobId/file",
    async (request, reply) => {
      const job = getDownloadJob(request.params.jobId);
      const item = job?.items.find((i) => i.postUrl === request.query.postUrl);
      if (!job || !item?.relativePath) {
        reply.code(404).send({ error: "not downloaded" });
        return;
      }
      const file = db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.libraryRootId, job.libraryRootId), eq(files.relativePath, item.relativePath)))
        .get();
      if (!file) {
        reply.code(404).send({ error: "not scanned into the library yet — try again in a moment" });
        return;
      }
      reply.send({ fileId: file.id });
    }
  );

  /**
   * The library rows for just the files this job wrote — not the whole destination folder.
   * A repeat import lands in a folder that may already hold hundreds of tracks, and that listing
   * is paginated, so the file you just imported can be absent from the first page entirely.
   */
  fastify.get<{ Params: { jobId: string } }>("/scrape/soundgasm/download/:jobId/files", async (request, reply) => {
    const job = getDownloadJob(request.params.jobId);
    if (!job) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const relativePaths = job.items
      .map((item) => item.relativePath)
      .filter((relativePath): relativePath is string => Boolean(relativePath));
    if (relativePaths.length === 0) {
      reply.send({ files: [] });
      return;
    }

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
        relativePath: files.relativePath,
      })
      .from(files)
      .leftJoin(ratings, eq(ratings.fileId, files.id))
      .leftJoin(transcripts, eq(transcripts.fileId, files.id))
      .where(
        and(
          eq(files.libraryRootId, job.libraryRootId),
          inArray(files.relativePath, relativePaths),
          isNull(files.deletedAt)
        )
      )
      .all()
      .map((row) => ({ ...row, hasTranscript: row.hasTranscript !== null }));

    // Ordered by the job's own item order, so the list reads the way the import ran rather than
    // in whatever order the rows came back.
    const positionByPath = new Map(relativePaths.map((relativePath, i) => [relativePath, i]));
    fileRows.sort((a, b) => (positionByPath.get(a.relativePath) ?? 0) - (positionByPath.get(b.relativePath) ?? 0));

    const tagsByFile = tagsByFileId(fileRows.map((f) => f.id));
    reply.send({
      files: fileRows.map(({ relativePath: _relativePath, ...f }) => ({ ...f, tags: tagsByFile.get(f.id) ?? [] })),
    });
  });

  fastify.get<{ Params: { jobId: string } }>("/scrape/soundgasm/download/:jobId/folder", async (request, reply) => {
    const job = getDownloadJob(request.params.jobId);
    if (!job) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const folder = db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.libraryRootId, job.libraryRootId), eq(folders.relativePath, job.folderRelativePath)))
      .get();
    if (!folder) {
      reply.code(404).send({ error: "not scanned into the library yet — try again in a moment" });
      return;
    }
    reply.send({ folderId: folder.id });
  });
}
