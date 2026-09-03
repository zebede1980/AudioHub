import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A throwaway library root + database per run — nothing here ever touches a real library mount.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-merge-test-"));
const libraryDir = path.join(workDir, "library");
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { rawDb, db } = await import("../src/db/client.js");
const { ratings, transcripts } = await import("../src/db/schema.js");
const { scanLibraryRoot } = await import("../src/scanner/scan.js");
const { mergeFolders, MergeError } = await import("../src/folders/mergeFolders.js");

const ROOT_ID = 1;

function writeFileAt(relativePath: string, bytes: number) {
  const abs = path.join(libraryDir, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(bytes, relativePath.length % 251));
}

function folderByPath(relativePath: string) {
  return rawDb.prepare(`SELECT * FROM folders WHERE library_root_id = ? AND relative_path = ?`).get(ROOT_ID, relativePath) as
    | { id: number; parent_folder_id: number | null; depth: number; file_count: number; cover_image_path: string | null }
    | undefined;
}

function fileByPath(relativePath: string) {
  return rawDb.prepare(`SELECT * FROM files WHERE library_root_id = ? AND relative_path = ?`).get(ROOT_ID, relativePath) as
    | { id: number; folder_id: number; filename: string; deleted_at: number | null; cover_image_path: string | null }
    | undefined;
}

async function rescan() {
  await scanLibraryRoot(rawDb, ROOT_ID, libraryDir);
}

rawDb
  .prepare(`INSERT INTO library_roots (id, name, container_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
  .run(ROOT_ID, "test", libraryDir, Date.now());

// Two uploader folders for what is really the same person, plus an unrelated one that must be
// left completely alone, and a nested tree to prove subfolders survive the move.
writeFileAt("Artist/one.mp3", 1000);
writeFileAt("Artist/two.mp3", 2000);
writeFileAt("Artist/cover.jpg", 50);
writeFileAt("Artist Dupe/three.mp3", 3000);
writeFileAt("Artist Dupe/one.mp3", 4000); // same name as a file in the target: must not overwrite
writeFileAt("Artist Dupe/Bonus/four.mp3", 5000);
writeFileAt("Artist Dupe/Bonus/cover.jpg", 60);
writeFileAt("Unrelated/keep.mp3", 6000);
await rescan();

// Captured now, not inside the test: the merge below runs while this module is evaluated, which
// is before any test body executes, so reading these later would see post-merge state.
const fixtureCounts = {
  artist: folderByPath("Artist")!.file_count,
  dupe: folderByPath("Artist Dupe")!.file_count,
  bonus: folderByPath("Artist Dupe/Bonus")!.file_count,
};

test("the fixture scanned as expected", () => {
  assert.deepEqual(fixtureCounts, { artist: 2, dupe: 2, bonus: 1 });
});

// Attach metadata that must survive: the entire point of moving rows in place.
const movedFileId = fileByPath("Artist Dupe/three.mp3")!.id;
const nestedFileId = fileByPath("Artist Dupe/Bonus/four.mp3")!.id;
db.insert(ratings).values({ fileId: movedFileId, rating: 5, ratedAt: Date.now() }).run();
db.insert(transcripts)
  .values({ fileId: movedFileId, text: "a transcript worth keeping", language: "en", model: "test", createdAt: Date.now() })
  .run();

const targetId = folderByPath("Artist")!.id;
const sourceId = folderByPath("Artist Dupe")!.id;
const result = mergeFolders(targetId, sourceId);

test("the merge reports what it moved", () => {
  assert.equal(result.movedFiles, 2, "three.mp3 and one.mp3");
  assert.equal(result.movedSubfolders, 1, "Bonus");
  assert.equal(result.movedOtherFiles, 0, "Artist Dupe had no loose images of its own");
  assert.equal(result.strandedFiles, 0);
});

test("a name collision is suffixed, never overwritten", () => {
  assert.deepEqual(result.renamed, [{ from: "one.mp3", to: "one (2).mp3" }]);
  // The target's original file kept its bytes; the incoming one landed beside it.
  assert.equal(fs.statSync(path.join(libraryDir, "Artist/one.mp3")).size, 1000);
  assert.equal(fs.statSync(path.join(libraryDir, "Artist/one (2).mp3")).size, 4000);
});

test("files moved on disk and the source directory is gone", () => {
  assert.ok(fs.existsSync(path.join(libraryDir, "Artist/three.mp3")));
  assert.ok(fs.existsSync(path.join(libraryDir, "Artist/Bonus/four.mp3")));
  assert.equal(fs.existsSync(path.join(libraryDir, "Artist Dupe")), false);
});

test("ratings and transcripts follow the file, because the row moved in place", () => {
  const moved = fileByPath("Artist/three.mp3");
  assert.ok(moved);
  assert.equal(moved.id, movedFileId, "same row id — this is what preserves everything keyed to it");
  assert.equal(moved.folder_id, targetId);
  assert.equal(moved.filename, "three.mp3");

  const rating = rawDb.prepare(`SELECT rating FROM ratings WHERE file_id = ?`).get(movedFileId) as { rating: number };
  assert.equal(rating.rating, 5);
  const transcript = rawDb.prepare(`SELECT text FROM transcripts WHERE file_id = ?`).get(movedFileId) as { text: string };
  assert.equal(transcript.text, "a transcript worth keeping");
});

test("the renamed file's row tracks its new name", () => {
  const renamed = fileByPath("Artist/one (2).mp3");
  assert.ok(renamed, "the suffixed file is indexed at its new path");
  assert.equal(renamed.filename, "one (2).mp3");
  assert.equal(fileByPath("Artist Dupe/one.mp3"), undefined, "no row left at the old path");
});

test("a moved subfolder is re-parented and its whole subtree's paths rewritten", () => {
  const bonus = folderByPath("Artist/Bonus");
  assert.ok(bonus, "Bonus now sits under Artist");
  assert.equal(bonus.parent_folder_id, targetId);
  assert.equal(bonus.depth, 2);
  assert.equal(bonus.file_count, 1);
  assert.equal(folderByPath("Artist Dupe/Bonus"), undefined);

  const nested = fileByPath("Artist/Bonus/four.mp3");
  assert.ok(nested, "the nested file's path was rewritten");
  assert.equal(nested.id, nestedFileId, "and in place, so its metadata survives too");
});

test("cover paths inside a moved subtree are rewritten, not left dangling", () => {
  assert.equal(folderByPath("Artist/Bonus")!.cover_image_path, "Artist/Bonus/cover.jpg");
  assert.equal(fileByPath("Artist/Bonus/four.mp3")!.cover_image_path, "Artist/Bonus/cover.jpg");
});

test("files merged into the target pick up the target's cover", () => {
  assert.equal(fileByPath("Artist/three.mp3")!.cover_image_path, "Artist/cover.jpg");
  assert.equal(folderByPath("Artist")!.cover_image_path, "Artist/cover.jpg");
});

test("the target's file count is recomputed", () => {
  assert.equal(folderByPath("Artist")!.file_count, 4, "two originals plus three.mp3 and one (2).mp3");
});

test("the source folder row is gone and unrelated folders are untouched", () => {
  assert.equal(folderByPath("Artist Dupe"), undefined);
  assert.ok(fileByPath("Unrelated/keep.mp3"), "an unrelated folder is not collateral damage");
  assert.equal(fileByPath("Unrelated/keep.mp3")!.deleted_at, null);
});

test("a later full scan finds nothing to fix", async () => {
  // The real proof the index matches the disk: a scan should see no changes, no moves, no deletions.
  const scan = await scanLibraryRoot(rawDb, ROOT_ID, libraryDir);
  assert.equal(scan.filesChanged, 0, "every moved row already matched its file on disk");
  assert.equal(scan.movedFiles, 0);
  assert.equal(scan.deletedFiles, 0);
});

test("merging a folder into itself is refused", () => {
  assert.throws(() => mergeFolders(targetId, targetId), (err: unknown) => err instanceof MergeError);
});

test("merging a folder into its own subfolder is refused", () => {
  const bonusId = folderByPath("Artist/Bonus")!.id;
  assert.throws(
    () => mergeFolders(bonusId, targetId),
    (err: unknown) => err instanceof MergeError && /own subfolders/.test(err.message)
  );
  assert.ok(folderByPath("Artist"), "the refused merge changed nothing");
  assert.ok(folderByPath("Artist/Bonus"));
});

test("merging an unknown folder is refused rather than half-applied", () => {
  assert.throws(() => mergeFolders(targetId, 999999), (err: unknown) => err instanceof MergeError);
});

test("a row whose audio vanished is carried over soft-deleted instead of erased", async () => {
  writeFileAt("Ghost/gone.mp3", 700);
  await rescan();
  const ghostFileId = fileByPath("Ghost/gone.mp3")!.id;
  db.insert(ratings).values({ fileId: ghostFileId, rating: 4, ratedAt: Date.now() }).run();

  // Deleted behind the app's back, so the row still looks live when the merge runs.
  fs.rmSync(path.join(libraryDir, "Ghost/gone.mp3"));

  const ghostMerge = mergeFolders(targetId, folderByPath("Ghost")!.id);
  assert.equal(ghostMerge.strandedFiles, 1);

  const row = rawDb.prepare(`SELECT folder_id, deleted_at FROM files WHERE id = ?`).get(ghostFileId) as
    | { folder_id: number; deleted_at: number | null }
    | undefined;
  assert.ok(row, "the row survived rather than being cascade-deleted with its folder");
  assert.equal(row.folder_id, targetId);
  assert.ok(row.deleted_at, "and is marked deleted, since its audio is gone");
  const rating = rawDb.prepare(`SELECT rating FROM ratings WHERE file_id = ?`).get(ghostFileId) as
    | { rating: number }
    | undefined;
  assert.equal(rating?.rating, 4, "its rating is still there if the file ever comes back");
});

test("folder names containing LIKE wildcards are handled literally", async () => {
  // "100% Real" and "a_b" would both match unrelated paths through an unescaped SQL LIKE.
  writeFileAt("100% Real/hit.mp3", 800);
  writeFileAt("100X Real/decoy.mp3", 900);
  writeFileAt("Wild/a_b/nested.mp3", 1100);
  writeFileAt("Wild/axb/decoy.mp3", 1200);
  await rescan();

  const wildTarget = folderByPath("Artist")!.id;
  mergeFolders(wildTarget, folderByPath("Wild")!.id);

  assert.ok(fileByPath("Artist/a_b/nested.mp3"), "the real subtree moved");
  assert.ok(fileByPath("Artist/axb/decoy.mp3"), "its sibling moved too");
  assert.ok(fileByPath("100% Real/hit.mp3"), "an unrelated wildcard-ish folder was not rewritten");
  assert.ok(fileByPath("100X Real/decoy.mp3"), "nor was the folder a naive LIKE would have matched");
});

test("a rescan does not wipe a folder's source link", async () => {
  // The scanner upserts every folder it walks. If that upsert ever starts overwriting columns it
  // doesn't own, an import's recorded source would silently vanish on the next nightly scan.
  writeFileAt("Linked/track.mp3", 1300);
  await rescan();
  const linkedId = folderByPath("Linked")!.id;
  rawDb.prepare(`UPDATE folders SET source_url = ? WHERE id = ?`).run("https://soundgasm.net/u/Someone", linkedId);

  await rescan();

  const after = rawDb.prepare(`SELECT source_url FROM folders WHERE id = ?`).get(linkedId) as { source_url: string };
  assert.equal(after.source_url, "https://soundgasm.net/u/Someone");
});

test("merging carries a source link over to a target that has none", async () => {
  writeFileAt("Plain/a.mp3", 1400);
  writeFileAt("Sourced/b.mp3", 1500);
  await rescan();
  const plainId = folderByPath("Plain")!.id;
  const sourcedId = folderByPath("Sourced")!.id;
  rawDb.prepare(`UPDATE folders SET source_url = ? WHERE id = ?`).run("https://soundgasm.net/u/Carried", sourcedId);

  mergeFolders(plainId, sourcedId);

  const after = rawDb.prepare(`SELECT source_url FROM folders WHERE id = ?`).get(plainId) as { source_url: string };
  assert.equal(after.source_url, "https://soundgasm.net/u/Carried");
});

test("the target's own source link is never replaced by the source folder's", async () => {
  writeFileAt("KeepsOwn/a.mp3", 1600);
  writeFileAt("OtherSource/b.mp3", 1700);
  await rescan();
  const keepsOwnId = folderByPath("KeepsOwn")!.id;
  const otherId = folderByPath("OtherSource")!.id;
  rawDb.prepare(`UPDATE folders SET source_url = ? WHERE id = ?`).run("https://soundgasm.net/u/Mine", keepsOwnId);
  rawDb.prepare(`UPDATE folders SET source_url = ? WHERE id = ?`).run("https://soundgasm.net/u/Theirs", otherId);

  mergeFolders(keepsOwnId, otherId);

  const after = rawDb.prepare(`SELECT source_url FROM folders WHERE id = ?`).get(keepsOwnId) as { source_url: string };
  assert.equal(after.source_url, "https://soundgasm.net/u/Mine");
});

test.after(() => {
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
