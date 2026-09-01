import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/** Registered with global:false — individual routes opt in via `config: { rateLimit: {...} }`. */
export default fp(async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, { global: false });
});
