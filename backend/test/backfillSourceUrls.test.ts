import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-backfill-test-"));
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { rawDb } = await import("../src/db/client.js");

// Runs the shipped migration SQL, not a copy of it — the point is to pin the guards in the file
// that actually executes against real databases.
const migrationSql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations/0010_backfill_soundgasm_source_urls.sql"),
  "utf8"
);

const ROOT_ID = 1;

function addFolder(relativePath: string, parentFolderId: number | null, sourceUrl: string | null = null): number {
  return (
    rawDb
      .prepare(
        `INSERT INTO folders (library_root_id, parent_folder_id, relative_path, name, depth, last_seen_at, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        ROOT_ID,
        parentFolderId,
        relativePath,
        path.basename(relativePath),
        relativePath ? relativePath.split("/").length : 0,
        Date.now(),
        sourceUrl
      ) as { id: number }
  ).id;
}

function sourceUrlOf(relativePath: string): string | null {
  return (rawDb.prepare(`SELECT source_url FROM folders WHERE relative_path = ?`).get(relativePath) as {
    source_url: string | null;
  }).source_url;
}

rawDb
  .prepare(`INSERT INTO library_roots (id, name, container_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
  .run(ROOT_ID, "test", path.join(workDir, "library"), Date.now());

const soundgasmId = addFolder("Soundgasm", null);
addFolder("Soundgasm/PlainName", soundgasmId);
addFolder("Soundgasm/miss_honey_bun", soundgasmId);
addFolder("Soundgasm/Shy-Curious", soundgasmId);
addFolder("Soundgasm/Has Space", soundgasmId);
addFolder("Soundgasm/Weird&Char", soundgasmId);
addFolder("Soundgasm/AlreadySet", soundgasmId, "https://example.com/set-by-hand");
const uploaderId = addFolder("Soundgasm/WithSub", soundgasmId);
addFolder("Soundgasm/WithSub/Bonus", uploaderId);
const otherId = addFolder("Other", null);
addFolder("Other/Artist", otherId);

rawDb.exec(migrationSql);

test("a plain account-name folder is backfilled", () => {
  assert.equal(sourceUrlOf("Soundgasm/PlainName"), "https://soundgasm.net/u/PlainName");
});

test("underscores and hyphens are treated as account-name characters", () => {
  // Both shapes appear in the real library, so the character class has to accept them.
  assert.equal(sourceUrlOf("Soundgasm/miss_honey_bun"), "https://soundgasm.net/u/miss_honey_bun");
  assert.equal(sourceUrlOf("Soundgasm/Shy-Curious"), "https://soundgasm.net/u/Shy-Curious");
});

test("a name the importer's sanitizer would have altered is left alone", () => {
  // The importer replaces these characters, so a folder containing one was not named from an
  // account name that round-trips — guessing a URL from it would just produce a dead link.
  assert.equal(sourceUrlOf("Soundgasm/Has Space"), null);
  assert.equal(sourceUrlOf("Soundgasm/Weird&Char"), null);
});

test("an existing link is never overwritten", () => {
  assert.equal(sourceUrlOf("Soundgasm/AlreadySet"), "https://example.com/set-by-hand");
});

test("subfolders of an uploader folder are not given a link", () => {
  assert.equal(sourceUrlOf("Soundgasm/WithSub/Bonus"), null);
  assert.equal(sourceUrlOf("Soundgasm/WithSub"), "https://soundgasm.net/u/WithSub");
});

test("folders outside Soundgasm are untouched", () => {
  assert.equal(sourceUrlOf("Other/Artist"), null);
  assert.equal(sourceUrlOf("Other"), null);
  assert.equal(sourceUrlOf("Soundgasm"), null, "the parent folder is not an uploader");
});

test("re-running the migration changes nothing", () => {
  const before = rawDb.prepare(`SELECT id, source_url FROM folders ORDER BY id`).all();
  rawDb.exec(migrationSql);
  const after = rawDb.prepare(`SELECT id, source_url FROM folders ORDER BY id`).all();
  assert.deepEqual(after, before);
});

test.after(() => {
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
