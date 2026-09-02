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
  hasTranscript: boolean;
  tags: FileTagSummary[];
}

export interface Tag {
  id: number;
  name: string;
  createdAt: number;
  trackCount?: number;
}

export interface FileTagSummary {
  id: number;
  name: string;
}

export interface TaggedTrack {
  id: number;
  folderId: number;
  title: string | null;
  filename: string;
  trackNumber: number | null;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
  hasTranscript: boolean;
  tags: FileTagSummary[];
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
  trackNumber: number | null;
  filename: string;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number;
  ratedAt: number;
  hasTranscript: boolean;
  tags: FileTagSummary[];
}

export interface RecentFile {
  id: number;
  folderId: number;
  folderName: string;
  title: string | null;
  trackNumber: number | null;
  filename: string;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
  firstSeenAt: number;
  hasTranscript: boolean;
  tags: FileTagSummary[];
}

export interface RandomFile {
  id: number;
  folderId: number;
  folderName: string;
  title: string | null;
  trackNumber: number | null;
  filename: string;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
  hasTranscript: boolean;
  tags: FileTagSummary[];
}

export interface SearchResultRow {
  id: number;
  folderId: number;
  title: string | null;
  trackNumber: number | null;
  filename: string;
  parsedAuthor: string | null;
  parsedSeriesOrBook: string | null;
  durationSec: number | null;
  coverImagePath: string | null;
  rating: number | null;
  hasTranscript: boolean;
  tags: FileTagSummary[];
}

export interface FolderSearchResult {
  id: number;
  name: string;
  relativePath: string;
  fileCount: number;
  coverImagePath: string | null;
  rating: number | null;
}

export interface ConvertibleFile {
  id: number;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  folderId: number;
  folderName: string;
  libraryRootId: number;
  libraryRootName: string;
}

export interface ConvertibleFilesResponse {
  files: ConvertibleFile[];
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

export interface Transcript {
  id: number;
  fileId: number;
  text: string;
  language: string | null;
  model: string;
  createdAt: number;
}

export type FileTranscriptionStatus = "queued" | "transcribing" | "done" | "error" | "skipped";

export interface FileTranscriptionState {
  fileId: number;
  relativePath: string;
  status: FileTranscriptionStatus;
  wordCount?: number;
  error?: string;
}

export interface TranscriptionStatus {
  status: "idle" | "downloading-model" | "running" | "cancelling" | "done" | "cancelled" | "error";
  files?: FileTranscriptionState[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}
