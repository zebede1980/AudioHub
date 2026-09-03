import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A throwaway library root + database per run — nothing here ever touches a real library mount.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-index-test-"));
const libraryDir = path.join(workDir, "library");
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { rawDb } = await import("../src/db/client.js");
const { scanLibraryRoot, indexFilePaths } = await import("../src/scanner/scan.js");

const ROOT_ID = 1;

function writeAudio(relativePath: string, bytes: number) {
  const abs = path.join(libraryDir, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // Not real audio: readAudioTags swallows parse failures and indexes by filename, which keeps
  // these tests about the indexing logic rather than about music-metadata.
  fs.writeFileSync(abs, Buffer.alloc(bytes, 1));
  return abs;
}

function fileRow(relativePath: string) {
  return rawDb
    .prepare(`SELECT id, folder_id, filename, size_bytes, deleted_at, first_seen_at FROM files
              WHERE library_root_id = ? AND relative_path = ?`)
    .get(ROOT_ID, relativePath) as
    | { id: number; folder_id: number; filename: string; size_bytes: number; deleted_at: number | null; first_seen_at: number }
    | undefined;
}

function liveFileCount() {
  return (rawDb.prepare(`SELECT COUNT(*) AS c FROM files WHERE deleted_at IS NULL`).get() as { c: number }).c;
}

rawDb
  .prepare(`INSERT INTO library_roots (id, name, container_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
  .run(ROOT_ID, "test", libraryDir, Date.now());

// A pre-existing library, indexed the normal way, that every targeted index below must leave alone.
writeAudio("Existing/Artist/one.mp3", 1024);
writeAudio("Existing/Artist/two.mp3", 2048);
writeAudio("Existing/other.mp3", 512);
await scanLibraryRoot(rawDb, ROOT_ID, libraryDir);

test("the baseline library scanned normally", () => {
  assert.equal(liveFileCount(), 3);
});

test("indexing one imported path adds only that file", async () => {
  writeAudio("Soundgasm/Someone/new track.m4a", 4096);
  const result = await indexFilePaths(rawDb, ROOT_ID, libraryDir, ["Soundgasm/Someone/new track.m4a"]);

  assert.equal(result.filesScanned, 1);
  assert.equal(result.filesChanged, 1);
  assert.deepEqual(result.missingFiles, []);
  assert.equal(liveFileCount(), 4);

  const row = fileRow("Soundgasm/Someone/new track.m4a");
  assert.ok(row, "the imported file was indexed");
  assert.equal(row.filename, "new track.m4a");
  assert.equal(row.size_bytes, 4096);
});

test("a targeted index never soft-deletes the rest of the library", () => {
  // The failure this guards against: reusing the full walk's reconciliation, which treats every
  // row it did not touch as missing — for a one-file pass, that is the entire library.
  for (const relativePath of ["Existing/Artist/one.mp3", "Existing/Artist/two.mp3", "Existing/other.mp3"]) {
    const row = fileRow(relativePath);
    assert.ok(row, `${relativePath} still indexed`);
    assert.equal(row.deleted_at, null, `${relativePath} was not soft-deleted`);
  }
});

test("the folder chain is created for a folder that was never scanned", () => {
  const rows = rawDb
    .prepare(`SELECT relative_path, name, depth, parent_folder_id, file_count FROM folders
              WHERE library_root_id = ? AND relative_path LIKE 'Soundgasm%' ORDER BY depth`)
    .all(ROOT_ID) as { relative_path: string; name: string; depth: number; parent_folder_id: number; file_count: number }[];

  assert.deepEqual(
    rows.map((r) => [r.relative_path, r.name, r.depth]),
    [
      ["Soundgasm", "Soundgasm", 1],
      ["Soundgasm/Someone", "Someone", 2],
    ]
  );
  // Parent links must be real, or the folder tree renders orphaned in the browser.
  const parent = rows.find((r) => r.depth === 1)!;
  const child = rows.find((r) => r.depth === 2)!;
  const parentId = (rawDb.prepare(`SELECT id FROM folders WHERE library_root_id = ? AND relative_path = ?`)
    .get(ROOT_ID, "Soundgasm") as { id: number }).id;
  assert.equal(child.parent_folder_id, parentId);
  assert.equal(parent.file_count, 0);
  assert.equal(child.file_count, 1);
});

test("re-indexing an unchanged file takes the fast path and does not duplicate it", async () => {
  const before = fileRow("Soundgasm/Someone/new track.m4a")!;
  const result = await indexFilePaths(rawDb, ROOT_ID, libraryDir, ["Soundgasm/Someone/new track.m4a"]);

  assert.equal(result.filesScanned, 1);
  assert.equal(result.filesChanged, 0, "size and mtime matched, so no re-parse");
  assert.equal(liveFileCount(), 4);
  assert.equal(fileRow("Soundgasm/Someone/new track.m4a")!.id, before.id, "same row, not a second one");
});

test("a file whose bytes changed is re-read", async () => {
  const abs = path.join(libraryDir, "Soundgasm/Someone/new track.m4a");
  fs.writeFileSync(abs, Buffer.alloc(8192, 2));
  const result = await indexFilePaths(rawDb, ROOT_ID, libraryDir, ["Soundgasm/Someone/new track.m4a"]);

  assert.equal(result.filesChanged, 1);
  assert.equal(fileRow("Soundgasm/Someone/new track.m4a")!.size_bytes, 8192);
});

test("several imports into one folder are indexed together and counted once", async () => {
  writeAudio("Soundgasm/Someone/second.m4a", 1000);
  writeAudio("Soundgasm/Someone/third.m4a", 1000);
  const result = await indexFilePaths(rawDb, ROOT_ID, libraryDir, [
    "Soundgasm/Someone/second.m4a",
    "Soundgasm/Someone/third.m4a",
  ]);

  assert.equal(result.foldersScanned, 1, "one readdir/recount for the shared folder");
  assert.equal(result.filesScanned, 2);
  assert.equal(liveFileCount(), 6);

  const folder = rawDb
    .prepare(`SELECT file_count FROM folders WHERE library_root_id = ? AND relative_path = ?`)
    .get(ROOT_ID, "Soundgasm/Someone") as { file_count: number };
  assert.equal(folder.file_count, 3, "aggregate recomputed from the DB, not accumulated");
});

test("a path that isn't on disk is reported rather than indexed", async () => {
  const result = await indexFilePaths(rawDb, ROOT_ID, libraryDir, ["Soundgasm/Someone/never-downloaded.m4a"]);

  assert.deepEqual(result.missingFiles, ["Soundgasm/Someone/never-downloaded.m4a"]);
  assert.equal(result.filesChanged, 0);
  assert.equal(fileRow("Soundgasm/Someone/never-downloaded.m4a"), undefined);
  assert.equal(liveFileCount(), 6, "the rest of the library is untouched");
});

test("a cover image beside the audio is picked up", async () => {
  const coverPath = path.join(libraryDir, "Soundgasm/Someone/cover.jpg");
  fs.writeFileSync(coverPath, Buffer.alloc(16, 3));
  writeAudio("Soundgasm/Someone/fourth.m4a", 1000);
  await indexFilePaths(rawDb, ROOT_ID, libraryDir, ["Soundgasm/Someone/fourth.m4a"]);

  const row = rawDb
    .prepare(`SELECT cover_image_path FROM files WHERE library_root_id = ? AND relative_path = ?`)
    .get(ROOT_ID, "Soundgasm/Someone/fourth.m4a") as { cover_image_path: string | null };
  assert.equal(row.cover_image_path, "Soundgasm/Someone/cover.jpg");
});

test("a later full scan agrees with what the targeted index wrote", async () => {
  // The two paths must converge: whatever the targeted index recorded, a full walk should treat as
  // already up to date, and it must not decide the imported files are missing.
  const result = await scanLibraryRoot(rawDb, ROOT_ID, libraryDir);

  assert.equal(result.deletedFiles, 0, "nothing the targeted index wrote looks missing to a full scan");
  assert.equal(result.movedFiles, 0);
  assert.equal(result.filesChanged, 0, "every file already matched on size and mtime");
  assert.equal(liveFileCount(), 7);
});

test.after(() => {
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
