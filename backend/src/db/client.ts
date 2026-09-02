import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../config.js";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tracks which migration files have already run, so opening a fresh connection to an
 * already-migrated database (e.g. every scanner worker thread opens its own) doesn't re-execute
 * them. Every prior migration happened to be safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS),
 * which is what let this go unnoticed — but an ALTER TABLE ADD COLUMN, which SQLite has no
 * IF NOT EXISTS form for, is not, and fails with "duplicate column name" on the second run.
 */
function runMigrations(sqlite: Database.Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const applied = new Set(
    (sqlite.prepare(`SELECT filename FROM _migrations`).all() as { filename: string }[]).map((r) => r.filename)
  );

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const markApplied = sqlite.prepare(`INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)`);
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      sqlite.exec(sql);
    } catch (err) {
      // A column this migration adds may already exist if the database ran it once before the
      // _migrations table itself existed to record that — safe to treat as already-applied
      // rather than fatal. Any other failure is a real migration error and still throws.
      if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
    }
    markApplied.run(file, Date.now());
  }
}

/** Opens a fresh SQLite connection (WAL mode, migrations applied). Safe to call from a worker thread. */
export function openDatabase(databasePath: string = config.databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const main = openDatabase();
export const db = main.db;
export const rawDb = main.sqlite;
