export interface LibraryRoot {
  id: number;
  name: string;
  containerPath: string;
  enabled: number;
  createdAt: number;
  lastScannedAt: number | null;
  lastScanStatus: string | null;
  lastScanError: string | null;
}

export interface ScanStatus {
  status: "idle" | "running" | "ok" | "error";
  progress?: { foldersScanned: number; filesScanned: number; filesChanged: number };
  result?: { movedFiles: number; deletedFiles: number };
  error?: string;
}

export interface FolderSummary {
  id: number;
  libraryRootId: number;
  parentFolderId: number | null;
  relativePath: string;
  name: string;
  depth: number;
  coverImagePath: string | null;
  fileCount: number;
  totalDurationSec: number | null;
  lastSeenAt: number;
  rating: number | null;
}

export interface FileRow {
  id: number;
  filename: string;
  title: string | null;
  trackNumber: number | null;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
}

export interface FolderDetail {
  folder: FolderSummary;
  breadcrumb: { id: number; name: string }[];
  subfolders: FolderSummary[];
  files: FileRow[];
  page: number;
  pageSize: number;
}

export interface FileDetail {
  id: number;
  libraryRootId: number;
  folderId: number;
  relativePath: string;
  filename: string;
  extension: string;
  title: string | null;
  trackNumber: number | null;
  parsedAuthor: string | null;
  parsedSeriesOrBook: string | null;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
  prevFileId: number | null;
  nextFileId: number | null;
}

export interface RatedFolder {
  id: number;
  name: string;
  relativePath: string;
  fileCount: number;
  coverImagePath: string | null;
  rating: number;
  ratedAt: number;
}

export interface RatedFile {
  id: number;
  folderId: number;
  folderName: string;
  title: string | null;
  filename: string;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number;
  ratedAt: number;
}

export interface SearchResultRow {
  id: number;
  folder_id: number;
  title: string | null;
  filename: string;
  parsed_author: string | null;
  parsed_series_or_book: string | null;
  duration_sec: number | null;
  cover_image_path: string | null;
  rating: number | null;
}

export interface FolderSearchResult {
  id: number;
  name: string;
  relative_path: string;
  file_count: number;
  cover_image_path: string | null;
  rating: number | null;
}

export interface WavFile {
  id: number;
  relativePath: string;
  filename: string;
  sizeBytes: number;
  folderId: number;
  folderName: string;
  libraryRootId: number;
  libraryRootName: string;
}

export interface WavFilesResponse {
  files: WavFile[];
  count: number;
  totalBytes: number;
}

export type FileConversionStatus = "queued" | "converting" | "done" | "error" | "skipped";

export interface FileConversionState {
  fileId: number;
  relativePath: string;
  sizeBytesBefore: number;
  sizeBytesAfter?: number;
  status: FileConversionStatus;
  error?: string;
}

export interface ConversionStatus {
  status: "idle" | "running" | "cancelling" | "done" | "cancelled";
  bitrateKbps?: number;
  concurrency?: number;
  files?: FileConversionState[];
  startedAt?: number;
  finishedAt?: number;
}
