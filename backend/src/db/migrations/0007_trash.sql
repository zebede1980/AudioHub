-- Recoverable trash for folder deletions: the folder is moved into <library root>/.audiohub-trash
-- instead of being erased, and purged for real once it is older than the retention window.
CREATE TABLE IF NOT EXISTS trash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  original_relative_path TEXT NOT NULL,
  trash_relative_path TEXT NOT NULL,
  name TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER NOT NULL,
  -- JSON snapshot of the ratings/tags/transcripts of everything inside, re-applied on restore so
  -- an undo brings back the metadata too, not just the audio.
  metadata_snapshot TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trash_entries_path
  ON trash_entries(library_root_id, trash_relative_path);
CREATE INDEX IF NOT EXISTS idx_trash_entries_deleted_at ON trash_entries(deleted_at);
