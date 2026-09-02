import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { files, transcripts } from "../db/schema.js";
import { config } from "../config.js";
import {
  startTranscription,
  getTranscriptionStatus,
  cancelTranscription,
} from "../transcription/transcriptionManager.js";

export default async function transcribeRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.post<{ Params: { id: string } }>("/files/:id/transcribe", async (request, reply) => {
    const existing = getTranscriptionStatus();
    if (existing && (existing.status === "running" || existing.status === "downloading-model" || existing.status === "cancelling")) {
      reply.code(409).send({ error: "a transcription batch is already running" });
      return;
    }
    const id = Number(request.params.id);
    const file = db.select({ id: files.id }).from(files).where(eq(files.id, id)).get();
    if (!file) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const job = startTranscription([id], config.transcription.defaultConcurrency);
    reply.send({ status: job.status });
  });

  fastify.get<{ Params: { id: string } }>("/files/:id/transcript", async (request, reply) => {
    const id = Number(request.params.id);
    const row = db.select().from(transcripts).where(eq(transcripts.fileId, id)).get();
    if (!row) {
      reply.code(404).send({ error: "no transcript for this file" });
      return;
    }
    reply.send(row);
  });

  fastify.delete<{ Params: { id: string } }>("/files/:id/transcript", async (request, reply) => {
    const id = Number(request.params.id);
    db.delete(transcripts).where(eq(transcripts.fileId, id)).run();
    reply.code(204).send();
  });

  fastify.post<{ Params: { id: string } }>("/folders/:id/transcribe", async (request, reply) => {
    const existing = getTranscriptionStatus();
    if (existing && (existing.status === "running" || existing.status === "downloading-model" || existing.status === "cancelling")) {
      reply.code(409).send({ error: "a transcription batch is already running" });
      return;
    }
    const folderId = Number(request.params.id);
    const fileIds = db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.folderId, folderId), isNull(files.deletedAt)))
      .all()
      .map((r) => r.id);

    if (fileIds.length === 0) {
      reply.code(400).send({ error: "this folder has no files to transcribe" });
      return;
    }

    const job = startTranscription(fileIds, config.transcription.defaultConcurrency);
    reply.send({ status: job.status });
  });

  fastify.get("/transcribe/status", async (_request, reply) => {
    reply.send(getTranscriptionStatus() ?? { status: "idle" });
  });

  fastify.post("/transcribe/cancel", async (_request, reply) => {
    cancelTranscription();
    reply.send({ status: "cancelling" });
  });
}
