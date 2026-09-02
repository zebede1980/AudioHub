import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A throwaway library root + database per run — nothing here ever touches a real library mount.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiohub-trash-test-"));
const libraryDir = path.join(workDir, "library");
process.env.DATABASE_PATH = path.join(workDir, "test.db");
process.env.SESSION_SECRET = "test-only";
process.env.COVER_CACHE_DIR = path.join(workDir, "covers");

const { db } = await import("../src/db/client.js");
const { folderRatings, folders, files, libraryRoots, ratings, trashEntries } = await import("../src/db/schema.js");
const { moveFolderToTrash, snapshotFolderMetadata, listTrash, purgeExpiredTrash, purgeTrashEntry } = await import(
  "../src/trash/trashManager.js"
);
const { foldersForReview, folderContents } = await import("../src/trash/folderContents.js");
const { TRASH_DIR_NAME } = await import("../src/trash/trashPaths.js");
const { eq } = await import("drizzle-orm");

function writeAudio(relativePath: string, bytes: number) {
  const abs = path.join(libraryDir, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.alloc(bytes, 1));
  return abs;
}

/** Indexes a folder + file directly rather than running the scanner, so these tests stay about
 * trash behaviour and don't depend on audio metadata parsing. */
function indexFolder(rootId: number, relativePath: string, parentFolderId: number | null) {
  return db
    .insert(folders)
    .values({
      libraryRootId: rootId,
      parentFolderId,
      relativePath,
      name: path.basename(relativePath) || "",
      depth: relativePath ? relativePath.split("/").length : 0,
      lastSeenAt: Date.now(),
    })
    .returning({ id: folders.id })
    .get().id;
}

function indexFile(rootId: number, folderId: number, relativePath: string, sizeBytes: number) {
  return db
    .insert(files)
    .values({
      libraryRootId: rootId,
      folderId,
      relativePath,
      filename: path.basename(relativePath),
      extension: path.extname(relativePath),
      sizeBytes,
      mtimeMs: Date.now(),
      durationSec: 60,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    })
    .returning({ id: files.id })
    .get().id;
}

const rootId = (() => {
  fs.mkdirSync(libraryDir, { recursive: true });
  return db
    .insert(libraryRoots)
    .values({ name: "Test", containerPath: libraryDir, createdAt: Date.now() })
    .returning({ id: libraryRoots.id })
    .get().id;
})();

// Layout: Keepers/ (rated 1 star, one direct file + a nested subfolder with two more) and
// Unrelated/ (must never be touched). "Vol_1" exercises the LIKE-wildcard escaping.
const rootFolderId = indexFolder(rootId, "", null);
const keepersId = indexFolder(rootId, "Keepers", rootFolderId);
const nestedId = indexFolder(rootId, "Keepers/Vol_1", keepersId);
const decoyId = indexFolder(rootId, "Keepers Vol 1", rootFolderId);
const unrelatedId = indexFolder(rootId, "Unrelated", rootFolderId);

writeAudio("Keepers/a.mp3", 1000);
writeAudio("Keepers/Vol_1/b.mp3", 2000);
writeAudio("Keepers/Vol_1/c.mp3", 3000);
writeAudio("Keepers Vol 1/decoy.mp3", 4000);
writeAudio("Unrelated/keep.mp3", 5000);

const fileA = indexFile(rootId, keepersId, "Keepers/a.mp3", 1000);
indexFile(rootId, nestedId, "Keepers/Vol_1/b.mp3", 2000);
indexFile(rootId, nestedId, "Keepers/Vol_1/c.mp3", 3000);
indexFile(rootId, decoyId, "Keepers Vol 1/decoy.mp3", 4000);
indexFile(rootId, unrelatedId, "Unrelated/keep.mp3", 5000);

db.insert(ratings).values({ fileId: fileA, rating: 5, ratedAt: Date.now() }).run();
db.insert(folderRatings).values({ folderId: keepersId, rating: 1, ratedAt: Date.now() }).run();
db.insert(folderRatings).values({ folderId: nestedId, rating: 4, ratedAt: Date.now() }).run();

test("review stats count nested files, not just direct ones", () => {
  const review = foldersForReview(1);
  assert.equal(review.length, 1);
  const [row] = review;
  assert.equal(row.relativePath, "Keepers");
  // 3 files (1 direct + 2 nested) and 6000 bytes — the sibling "Keepers Vol 1" must not be
  // swept in by the LIKE prefix match.
  assert.equal(row.fileCount, 3);
  assert.equal(row.sizeBytes, 6000);
  assert.equal(row.subfolderCount, 1);
  assert.equal(row.maxFileRating, 5, "a 5-star file inside must surface as a warning signal");
});

test("folder contents list every nested file with its sub-path", () => {
  const { files: contents, truncated } = folderContents(keepersId);
  assert.equal(truncated, false);
  assert.deepEqual(
    contents.map((f) => f.subPath),
    ["a.mp3", "Vol_1/b.mp3", "Vol_1/c.mp3"]
  );
  assert.equal(contents.find((f) => f.subPath === "a.mp3")?.rating, 5);
});

test("snapshot captures ratings inside the folder but not the folder's own 1 star", () => {
  const snapshot = snapshotFolderMetadata(rootId, "Keepers");
  assert.deepEqual(
    snapshot.files.map((f) => [f.relativePath, f.rating]),
    [["Keepers/a.mp3", 5]]
  );
  assert.deepEqual(snapshot.folderRatings, [{ relativePath: "Keepers/Vol_1", rating: 4 }]);
});

test("deleting a folder moves it into the trash instead of erasing it", () => {
  const result = moveFolderToTrash(keepersId);
  assert.equal(result.fileCount, 3);
  assert.equal(result.sizeBytes, 6000);

  assert.equal(fs.existsSync(path.join(libraryDir, "Keepers")), false, "original location is emptied");
  assert.ok(fs.existsSync(path.join(libraryDir, "Keepers Vol 1", "decoy.mp3")), "sibling folder untouched");
  assert.ok(fs.existsSync(path.join(libraryDir, "Unrelated", "keep.mp3")), "unrelated folder untouched");

  const entry = db.select().from(trashEntries).where(eq(trashEntries.id, result.trashEntryId)).get();
  assert.ok(entry);
  const trashed = path.join(libraryDir, entry.trashRelativePath);
  assert.ok(fs.existsSync(path.join(trashed, "a.mp3")), "audio is intact in the trash");
  assert.ok(fs.existsSync(path.join(trashed, "Vol_1", "c.mp3")), "nested audio is intact in the trash");
  assert.ok(fs.existsSync(`${trashed}.json`), "sidecar manifest written for hand recovery");
});

test("a trash directory with no database row is adopted from its sidecar", () => {
  db.delete(trashEntries).run();
  const entries = listTrash();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].originalRelativePath, "Keepers");
  assert.equal(entries[0].fileCount, 3);
  assert.equal(entries[0].presentOnDisk, true);
});

test("retention sweep keeps fresh entries and erases expired ones", () => {
  assert.equal(purgeExpiredTrash().purgedCount, 0, "a just-deleted folder is not swept");
  assert.equal(listTrash().length, 1);

  const entry = listTrash()[0];
  const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
  db.update(trashEntries).set({ deletedAt: thirtyOneDaysAgo }).where(eq(trashEntries.id, entry.id)).run();

  assert.equal(purgeExpiredTrash().purgedCount, 1);
  assert.equal(listTrash().length, 0);
  assert.equal(fs.readdirSync(path.join(libraryDir, TRASH_DIR_NAME)).length, 0, "trash directory is emptied");
  assert.ok(fs.existsSync(path.join(libraryDir, "Unrelated", "keep.mp3")), "purge stays inside the trash directory");
});

test("purging an unknown entry is a no-op rather than an error", () => {
  purgeTrashEntry(9999);
});

test.after(async () => {
  const { rawDb } = await import("../src/db/client.js");
  rawDb.close(); // Windows won't unlink an open SQLite file.
  fs.rmSync(workDir, { recursive: true, force: true });
});
