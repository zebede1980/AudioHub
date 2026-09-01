import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { resolveSession, type SessionUser } from "../auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);

  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    const sessionId = request.cookies?.[config.sessionCookieName];
    request.user = sessionId ? resolveSession(sessionId) : null;
  });

  fastify.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
