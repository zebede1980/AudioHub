import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { libraryRoots, folders, files } from "../db/schema.js";
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
