-- AudioHub initial schema. Idempotent (IF NOT EXISTS) so it can run safely on every boot.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  success INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS library_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  container_path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_scanned_at INTEGER,
  last_scan_status TEXT,
  last_scan_error TEXT
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  parent_folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL,
  cover_image_path TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_duration_sec REAL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(library_root_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder_id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  fingerprint TEXT,
  duration_sec REAL,
  title TEXT,
  track_number INTEGER,
  parsed_author TEXT,
  parsed_series_or_book TEXT,
  tag_title TEXT,
  tag_artist TEXT,
  tag_album TEXT,
  tag_track INTEGER,
  tag_genre TEXT,
  cover_image_path TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(library_root_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_fingerprint ON files(fingerprint);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  title, filename, parsed_author, parsed_series_or_book,
  content='files', content_rowid='id'
);

-- Keep FTS index in sync with the files table.
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, title, filename, parsed_author, parsed_series_or_book)
  VALUES (new.id, new.title, new.filename, new.parsed_author, new.parsed_series_or_book);
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, filename, parsed_author, parsed_series_or_book)
  VALUES ('delete', old.id, old.title, old.filename, old.parsed_author, old.parsed_series_or_book);
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, filename, parsed_author, parsed_series_or_book)
  VALUES ('delete', old.id, old.title, old.filename, old.parsed_author, old.parsed_series_or_book);
  INSERT INTO files_fts(rowid, title, filename, parsed_author, parsed_series_or_book)
  VALUES (new.id, new.title, new.filename, new.parsed_author, new.parsed_series_or_book);
END;

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  rated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  position_sec REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_file_id INTEGER REFERENCES files(id),
  position_sec REAL,
  is_playing INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
