import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, loginAttempts } from "../db/schema.js";
import { config } from "../config.js";
import { createSession, destroySession } from "../auth/session.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS_PER_IP = 5;

function ensureSeedAdmin() {
  const existing = db.select().from(users).limit(1).all();
  if (existing.length > 0) return;
  if (!config.adminUsername || !config.adminPasswordHash) {
    console.warn(
      "[auth] No admin user exists yet and ADMIN_USERNAME/ADMIN_PASSWORD_HASH are not set — " +
        "login will be unavailable until these are configured (see scripts/hash-password.ts)."
    );
    return;
  }
  db.insert(users)
    .values({ username: config.adminUsername, passwordHash: config.adminPasswordHash, createdAt: Date.now() })
    .run();
  console.log(`[auth] Seeded admin user "${config.adminUsername}".`);
}

function recentFailedAttempts(ip: string): number {
  const since = Date.now() - LOGIN_WINDOW_MS;
  return db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.ip, ip))
    .all()
    .filter((row) => row.attemptedAt >= since && row.success === 0).length;
}

export default async function authRoutes(fastify: FastifyInstance) {
  ensureSeedAdmin();

  fastify.post<{ Body: { username: string; password: string } }>(
    "/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const ip = request.ip;
      const { username: rawUsername, password } = request.body ?? { username: "", password: "" };
      // Mobile keyboards love to capitalise the first letter and append a space,
      // so match the username case-insensitively and ignore surrounding blanks.
      const username = (rawUsername ?? "").trim();

      if (recentFailedAttempts(ip) >= MAX_FAILED_ATTEMPTS_PER_IP) {
        reply.code(429).send({ error: "Too many failed attempts. Try again later." });
        return;
      }

      const user = username
        ? db
            .select()
            .from(users)
            .where(sql`lower(${users.username}) = lower(${username})`)
            .get()
        : undefined;
      const valid =
        user && password ? await argon2.verify(user.passwordHash, password).catch(() => false) : false;

      db.insert(loginAttempts)
        .values({ username: username ?? "", ip, success: valid ? 1 : 0, attemptedAt: Date.now() })
        .run();

      if (!user || !valid) {
        reply.code(401).send({ error: "Invalid username or password" });
        return;
      }

      db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
      const { sessionId, expiresAt } = createSession(user.id);

      reply.setCookie(config.sessionCookieName, sessionId, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "strict",
        path: "/",
        expires: new Date(expiresAt),
      });
      reply.send({ username: user.username });
    }
  );

  fastify.post("/auth/logout", async (request, reply) => {
    const sessionId = request.cookies?.[config.sessionCookieName];
    if (sessionId) destroySession(sessionId);
    reply.clearCookie(config.sessionCookieName, { path: "/" });
    reply.send({ ok: true });
  });

  fastify.get("/auth/session", async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    reply.send({ username: request.user.username });
  });
}
