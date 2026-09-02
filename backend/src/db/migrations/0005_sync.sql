CREATE TABLE IF NOT EXISTS sync_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  remote_base_url TEXT,
  remote_api_key TEXT,
  min_rating INTEGER NOT NULL DEFAULT 4,
  ingest_api_key TEXT,
  ingest_library_root_id INTEGER REFERENCES library_roots(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS synced_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
