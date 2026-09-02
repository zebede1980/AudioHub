import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { longestRepeatedRun } from "../transcription/quality.js";
import { files, transcripts } from "../db/schema.js";
import {
  startTranscription,
  getTranscriptionStatus,
  cancelTranscription,
  type StartTranscriptionResult,
} from "../transcription/transcriptionManager.js";

/** Shared reply shape for both transcribe entry points: what happened to the request, and how
 * much is now waiting, so the UI can say "queued behind 3 others" instead of guessing. */
function sendStartResult(reply: FastifyReply, result: StartTranscriptionResult) {
  if (result.outcome === "cancelling") {
    reply.code(409).send({ error: "the current transcription batch is cancelling — try again in a moment" });
    return;
  }
  const pendingCount = result.job.files.filter((f) => f.status === "queued" || f.status === "transcribing").length;
  reply.send({
    status: result.job.status,
    outcome: result.outcome,
    addedCount: result.addedCount,
    alreadyPendingCount: result.alreadyPendingCount,
    pendingCount,
  });
}

export default async function transcribeRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  // Asking for a file while a batch is running adds it to that batch's queue rather than being
  // refused — see startTranscription. The only refusal left is a batch that's mid-cancel.
  fastify.post<{ Params: { id: string } }>("/files/:id/transcribe", async (request, reply) => {
    const id = Number(request.params.id);
    const file = db.select({ id: files.id }).from(files).where(eq(files.id, id)).get();
    if (!file) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    sendStartResult(reply, startTranscription([id]));
  });

  fastify.get<{ Params: { id: string } }>("/files/:id/transcript", async (request, reply) => {
    const id = Number(request.params.id);
    const row = db.select().from(transcripts).where(eq(transcripts.fileId, id)).get();
    if (!row) {
      reply.code(404).send({ error: "no transcript for this file" });
      return;
    }
    // Transcripts written before repetition was measured are scored on first read and the result
    // stored, so existing bad ones get flagged too without a startup pass over the whole table.
    let repeatRun = row.repeatRun;
    if (repeatRun === null) {
      repeatRun = longestRepeatedRun(row.text);
      db.update(transcripts).set({ repeatRun }).where(eq(transcripts.id, row.id)).run();
    }

    // The threshold lives with the rest of the transcription config rather than being duplicated
    // in the frontend, so tuning it is a one-line server change.
    reply.send({
      ...row,
      repeatRun,
      repetitionSuspect: repeatRun >= config.transcription.repetitionRunWarning,
    });
  });

  fastify.delete<{ Params: { id: string } }>("/files/:id/transcript", async (request, reply) => {
    const id = Number(request.params.id);
    db.delete(transcripts).where(eq(transcripts.fileId, id)).run();
    reply.code(204).send();
  });

  fastify.post<{ Params: { id: string } }>("/folders/:id/transcribe", async (request, reply) => {
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

    sendStartResult(reply, startTranscription(fileIds));
  });

  fastify.get("/transcribe/status", async (_request, reply) => {
    reply.send(getTranscriptionStatus() ?? { status: "idle" });
  });

  fastify.post("/transcribe/cancel", async (_request, reply) => {
    cancelTranscription();
    reply.send({ status: "cancelling" });
  });
}
