import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-imports-test-"));
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { rawDb } = await import("../src/db/client.js");
const { markAlreadyImported } = await import("../src/scraper/existingImports.js");
const { importFilenameStem, importFolderRelativePath } = await import("../src/scraper/importPaths.js");

function addRoot(id: number, containerPath: string) {
  rawDb
    .prepare(`INSERT INTO library_roots (id, name, container_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
    .run(id, `root${id}`, containerPath, Date.now());
}

function addFolder(rootId: number, relativePath: string): number {
  return (
    rawDb
      .prepare(
        `INSERT INTO folders (library_root_id, parent_folder_id, relative_path, name, depth, last_seen_at)
         VALUES (?, NULL, ?, ?, ?, ?) RETURNING id`
      )
      .get(rootId, relativePath, path.basename(relativePath), relativePath.split("/").length, Date.now()) as {
      id: number;
    }
  ).id;
}

function addFile(rootId: number, folderId: number, folderRelativePath: string, filename: string, deleted = false) {
  rawDb
    .prepare(
      `INSERT INTO files (library_root_id, folder_id, relative_path, filename, extension, size_bytes,
                          mtime_ms, first_seen_at, last_seen_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    )
    .run(
      rootId,
      folderId,
      `${folderRelativePath}/${filename}`,
      filename,
      path.extname(filename),
      Date.now(),
      Date.now(),
      deleted ? Date.now() : null
    );
}

function post(title: string) {
  return { title, postUrl: `https://soundgasm.net/u/Someone/${encodeURIComponent(title)}` };
}

addRoot(1, path.join(workDir, "libraryA"));
addRoot(2, path.join(workDir, "libraryB"));

const someoneFolder = addFolder(1, importFolderRelativePath("Someone"));
addFile(1, someoneFolder, importFolderRelativePath("Someone"), "A Plain Title.m4a");
addFile(1, someoneFolder, importFolderRelativePath("Someone"), "Slashes and colons in it.mp3");
addFile(1, someoneFolder, importFolderRelativePath("Someone"), "Deleted Track.m4a", true);

const otherFolder = addFolder(1, importFolderRelativePath("SomeoneElse"));
addFile(1, otherFolder, importFolderRelativePath("SomeoneElse"), "A Plain Title.m4a");

test("a post already downloaded is marked", () => {
  const [result] = markAlreadyImported("Someone", [post("A Plain Title")]);
  assert.equal(result.alreadyInLibrary, true);
});

test("a post not in the library is not marked", () => {
  const [result] = markAlreadyImported("Someone", [post("Something Brand New")]);
  assert.equal(result.alreadyInLibrary, false);
});

test("the original title and post url are passed through untouched", () => {
  const original = post("A Plain Title");
  const [result] = markAlreadyImported("Someone", [original]);
  assert.equal(result.title, original.title);
  assert.equal(result.postUrl, original.postUrl);
});

test("the extension is ignored, since it isn't knowable without fetching the post", () => {
  // The file on disk is .mp3; the downloader would save this one as .m4a. Still the same track.
  const [result] = markAlreadyImported("Someone", [post("Slashes/and: colons? in it")]);
  assert.equal(result.alreadyInLibrary, true, "sanitized title matched despite a different extension");
});

test("characters the downloader strips are stripped on both sides", () => {
  // Guards the contract in importPaths: a title that sanitizes to an existing filename is a match.
  assert.equal(importFilenameStem("Slashes/and: colons? in it"), "Slashes and colons in it");
});

test("casing differences still match", () => {
  const [result] = markAlreadyImported("Someone", [post("a PLAIN title")]);
  assert.equal(result.alreadyInLibrary, true);
});

test("a title longer than the filename limit matches on its truncated stem", () => {
  const longTitle = `${"x".repeat(200)} tail`;
  const stem = importFilenameStem(longTitle);
  assert.equal(stem.length, 150);
  addFile(1, someoneFolder, importFolderRelativePath("Someone"), `${stem}.m4a`);

  const [result] = markAlreadyImported("Someone", [post(longTitle)]);
  assert.equal(result.alreadyInLibrary, true);
});

test("a soft-deleted file does not count as already imported", () => {
  const [result] = markAlreadyImported("Someone", [post("Deleted Track")]);
  assert.equal(result.alreadyInLibrary, false, "a deleted file should be offered for re-download");
});

test("the same title under a different uploader is not a match", () => {
  // "A Plain Title" exists under SomeoneElse but not under NobodyYet.
  const [result] = markAlreadyImported("NobodyYet", [post("A Plain Title")]);
  assert.equal(result.alreadyInLibrary, false);
});

test("a file in another library root still counts", () => {
  const folderInB = addFolder(2, importFolderRelativePath("SecondRootUser"));
  addFile(2, folderInB, importFolderRelativePath("SecondRootUser"), "Only In Root B.m4a");

  const [result] = markAlreadyImported("SecondRootUser", [post("Only In Root B")]);
  assert.equal(result.alreadyInLibrary, true, "'do I have this?' shouldn't depend on the destination root");
});

test("a mixed batch is marked per post and keeps its order", () => {
  const results = markAlreadyImported("Someone", [
    post("Something Brand New"),
    post("A Plain Title"),
    post("Also New"),
  ]);
  assert.deepEqual(
    results.map((r) => [r.title, r.alreadyInLibrary]),
    [
      ["Something Brand New", false],
      ["A Plain Title", true],
      ["Also New", false],
    ]
  );
});

test("an empty post list is handled without touching the database", () => {
  assert.deepEqual(markAlreadyImported("Someone", []), []);
});

test.after(() => {
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
