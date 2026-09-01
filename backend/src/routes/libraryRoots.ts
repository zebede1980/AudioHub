import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { libraryRoots, folders } from "../db/schema.js";
import { startScan, getScanStatus } from "../scanner/scanManager.js";

export default async function libraryRootsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAuth);

  fastify.get("/library-roots", async () => {
    return db.select().from(libraryRoots).all();
  });

  fastify.post<{ Body: { name: string; containerPath: string } }>("/library-roots", async (request, reply) => {
    const { name, containerPath } = request.body ?? { name: "", containerPath: "" };
    if (!name || !containerPath) {
      reply.code(400).send({ error: "name and containerPath are required" });
      return;
    }
    if (!fs.existsSync(containerPath) || !fs.statSync(containerPath).isDirectory()) {
      reply.code(400).send({ error: `containerPath "${containerPath}" is not an accessible directory` });
      return;
    }
    const row = db
      .insert(libraryRoots)
      .values({ name, containerPath, enabled: 1, createdAt: Date.now() })
      .returning()
      .get();
    reply.code(201).send(row);
  });

  fastify.patch<{ Params: { id: string }; Body: { name?: string; enabled?: boolean } }>(
    "/library-roots/:id",
    async (request, reply) => {
      const id = Number(request.params.id);
      const { name, enabled } = request.body ?? {};
      const updates: Partial<typeof libraryRoots.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

      const row = db.update(libraryRoots).set(updates).where(eq(libraryRoots.id, id)).returning().get();
      if (!row) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.send(row);
    }
  );

  fastify.delete<{ Params: { id: string } }>("/library-roots/:id", async (request, reply) => {
    const id = Number(request.params.id);
    db.delete(libraryRoots).where(eq(libraryRoots.id, id)).run();
    reply.code(204).send();
  });

  fastify.post<{ Params: { id: string } }>("/library-roots/:id/scan", async (request, reply) => {
    const id = Number(request.params.id);
    const root = db.select().from(libraryRoots).where(eq(libraryRoots.id, id)).get();
    if (!root) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const job = startScan(id, root.containerPath);
    reply.send({ status: job.status });
  });

  fastify.get<{ Params: { id: string } }>("/library-roots/:id/scan-status", async (request, reply) => {
    const id = Number(request.params.id);
    reply.send(getScanStatus(id) ?? { status: "idle" });
  });

  fastify.get<{ Params: { id: string } }>("/library-roots/:id/root-folder", async (request, reply) => {
    const rootId = Number(request.params.id);
    const folder = db
      .select()
      .from(folders)
      .where(and(eq(folders.libraryRootId, rootId), eq(folders.relativePath, "")))
      .get();
    if (!folder) {
      reply.code(404).send({ error: "root folder not found — has this library root been scanned yet?" });
      return;
    }
    reply.send(folder);
  });
}
