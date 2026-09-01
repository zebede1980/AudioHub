import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Helmet security headers, plus an Origin-header check on mutating requests as CSRF defense in
 * depth (the session cookie is already SameSite=Strict, which blocks the cross-site case in all
 * modern browsers including iOS Safari; this catches misconfigurations/older clients).
 */
export default fp(async function securityPlugin(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        mediaSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    // Skipped outside production: a local dev proxy (e.g. Vite's `changeOrigin`) rewrites the
    // Host header to the backend's own address while leaving Origin as the dev server's origin,
    // which would otherwise look identical to a cross-site request.
    if (!config.isProduction) return;

    const origin = request.headers.origin;
    if (!origin) return; // same-origin requests from fetch() with credentials often omit Origin on same-site nav

    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      reply.code(403).send({ error: "invalid origin" });
      return;
    }
    const expectedHost = request.headers["x-forwarded-host"] ?? request.headers.host;
    if (originHost !== expectedHost) {
      reply.code(403).send({ error: "cross-origin request rejected" });
    }
  });
});
