import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { emptyTrash, listTrash, purgeExpiredTrash, purgeTrashEntry, restoreTrashEntry } from "../trash/trashManager.js";

export default async function trashRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get("/trash", async (_request, reply) => {
    // Sweeping here as well as at startup/nightly means opening the trash never shows an entry
    // that is already past its retention window.
    purgeExpiredTrash();
    reply.send({ retentionDays: config.trash.retentionDays, entries: listTrash() });
  });

  fastify.post<{ Params: { id: string } }>("/trash/:id/restore", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      reply.code(400).send({ error: "invalid trash entry id" });
      return;
    }
    try {
      reply.send(restoreTrashEntry(id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to restore";
      fastify.log.error({ err, id }, "failed to restore trash entry");
      reply.code(400).send({ error: message });
    }
  });

  fastify.delete<{ Params: { id: string } }>("/trash/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      reply.code(400).send({ error: "invalid trash entry id" });
      return;
    }
    purgeTrashEntry(id);
    reply.code(204).send();
  });

  fastify.delete("/trash", async (_request, reply) => {
    reply.send(emptyTrash());
  });
}
