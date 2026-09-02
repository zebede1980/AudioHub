import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastLoginAt: integer("last_login_at"),
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  ip: text("ip").notNull(),
  success: integer("success").notNull(),
  attemptedAt: integer("attempted_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  lastActiveAt: integer("last_active_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const libraryRoots = sqliteTable("library_roots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  containerPath: text("container_path").notNull().unique(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  lastScannedAt: integer("last_scanned_at"),
  lastScanStatus: text("last_scan_status"),
  lastScanError: text("last_scan_error"),
});

export const folders = sqliteTable(
  "folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libraryRootId: integer("library_root_id").notNull().references(() => libraryRoots.id, { onDelete: "cascade" }),
    parentFolderId: integer("parent_folder_id"),
    relativePath: text("relative_path").notNull(),
    name: text("name").notNull(),
    depth: integer("depth").notNull(),
    coverImagePath: text("cover_image_path"),
    fileCount: integer("file_count").notNull().default(0),
    totalDurationSec: real("total_duration_sec"),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => ({
    uniqRootPath: uniqueIndex("idx_folders_root_path").on(t.libraryRootId, t.relativePath),
    parentIdx: index("idx_folders_parent").on(t.parentFolderId),
  })
);

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libraryRootId: integer("library_root_id").notNull().references(() => libraryRoots.id, { onDelete: "cascade" }),
    folderId: integer("folder_id").notNull().references(() => folders.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    filename: text("filename").notNull(),
    extension: text("extension").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mtimeMs: integer("mtime_ms").notNull(),
    fingerprint: text("fingerprint"),
    durationSec: real("duration_sec"),

    title: text("title"),
    trackNumber: integer("track_number"),
    parsedAuthor: text("parsed_author"),
    parsedSeriesOrBook: text("parsed_series_or_book"),

    tagTitle: text("tag_title"),
    tagArtist: text("tag_artist"),
    tagAlbum: text("tag_album"),
    tagTrack: integer("tag_track"),
    tagGenre: text("tag_genre"),

    coverImagePath: text("cover_image_path"),

    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqRootPath: uniqueIndex("idx_files_root_path").on(t.libraryRootId, t.relativePath),
    folderIdx: index("idx_files_folder").on(t.folderId),
    fingerprintIdx: index("idx_files_fingerprint").on(t.fingerprint),
  })
);

export const ratings = sqliteTable("ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id").notNull().unique().references(() => files.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  ratedAt: integer("rated_at").notNull(),
});

export const folderRatings = sqliteTable("folder_ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  folderId: integer("folder_id").notNull().unique().references(() => folders.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  ratedAt: integer("rated_at").notNull(),
});

export const playHistory = sqliteTable(
  "play_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    playedAt: integer("played_at").notNull(),
  },
  (t) => ({
    playedAtIdx: index("idx_play_history_played_at").on(t.playedAt),
  })
);

export const playbackState = sqliteTable("playback_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id").notNull().unique().references(() => files.id, { onDelete: "cascade" }),
  positionSec: real("position_sec").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const playbackSession = sqliteTable("playback_session", {
  id: integer("id").primaryKey().default(1),
  currentFileId: integer("current_file_id").references(() => files.id),
  positionSec: real("position_sec"),
  isPlaying: integer("is_playing").default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const transcripts = sqliteTable("transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id").notNull().unique().references(() => files.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  language: text("language"),
  model: text("model").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const fileTags = sqliteTable(
  "file_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    uniqFileTag: uniqueIndex("idx_file_tags_file_tag").on(t.fileId, t.tagId),
    tagIdx: index("idx_file_tags_tag").on(t.tagId),
  })
);

// Single-row config (id fixed at 1), same as playbackSession. Holds both roles this instance can
// play: pushing this library's top-rated files out to a remote AudioHub, and/or accepting pushes
// from a remote AudioHub into a local library root. Either, both, or neither can be configured.
export const syncConfig = sqliteTable("sync_config", {
  id: integer("id").primaryKey().default(1),
  // Outgoing (this instance pushes to another AudioHub).
  remoteBaseUrl: text("remote_base_url"),
  remoteApiKey: text("remote_api_key"),
  minRating: integer("min_rating").notNull().default(4),
  // Incoming (this instance accepts pushes from another AudioHub).
  ingestApiKey: text("ingest_api_key"),
  ingestLibraryRootId: integer("ingest_library_root_id").references(() => libraryRoots.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at").notNull(),
});

// Local bookkeeping for files this instance has pushed to its configured remote. Deliberately not
// cascaded off files.id (SET NULL instead) — if the source file is deleted locally, we still need
// this row to know a remote copy exists and should be cleaned up on the next sync run.
export const syncedFiles = sqliteTable("synced_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id").references(() => files.id, { onDelete: "set null" }),
  contentHash: text("content_hash").notNull().unique(),
  relativePath: text("relative_path").notNull(),
  // Hash of {rating, tags, transcript text} at last successful push — lets a sync run detect
  // "audio unchanged but rating/tags/transcript were edited since" without re-fingerprinting the
  // whole file or unconditionally re-sending metadata for every already-synced file every run.
  metadataHash: text("metadata_hash"),
  status: text("status").notNull(), // 'synced' | 'error'
  lastError: text("last_error"),
  syncedAt: integer("synced_at").notNull(),
});

// Cloud-side receipt of a file accepted via /sync/upload, keyed by the pusher's content hash so a
// re-push of identical content (or a manifest check) is idempotent without needing to track the
// pusher's own file ids.
export const syncReceipts = sqliteTable("sync_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentHash: text("content_hash").notNull().unique(),
  libraryRootId: integer("library_root_id").notNull().references(() => libraryRoots.id, { onDelete: "cascade" }),
  relativePath: text("relative_path").notNull(),
  receivedAt: integer("received_at").notNull(),
});

export const sqlNow = sql`(unixepoch() * 1000)`;
