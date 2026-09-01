import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { config } from "../config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
}

export function createSession(userId: number): { sessionId: string; expiresAt: number } {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + config.sessionSlidingDays * DAY_MS;
  db.insert(sessions).values({ id: sessionId, userId, createdAt: now, lastActiveAt: now, expiresAt }).run();
  return { sessionId, expiresAt };
}

/** Validates a session id, applies sliding expiry, and returns the associated user (or null if invalid/expired). */
export function resolveSession(sessionId: string): SessionUser | null {
  const now = Date.now();
  const row = db
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      username: users.username,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .get();

  if (!row) return null;

  const absoluteMax = row.createdAt + config.sessionAbsoluteMaxDays * DAY_MS;
  if (row.expiresAt < now || now > absoluteMax) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }

  const newExpiresAt = Math.min(now + config.sessionSlidingDays * DAY_MS, absoluteMax);
  db.update(sessions).set({ lastActiveAt: now, expiresAt: newExpiresAt }).where(eq(sessions.id, sessionId)).run();

  return { id: row.userId, username: row.username };
}

export function destroySession(sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}
