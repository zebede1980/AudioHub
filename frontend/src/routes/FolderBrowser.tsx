import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFolder } from "../api/hooks/folder";
import { useSetRating, useClearRating, useSetFolderRating, useClearFolderRating } from "../api/hooks/ratings";
import { useTranscribeFolder, useTranscriptionStatus, useCancelTranscription } from "../api/hooks/transcribe";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FolderGrid from "../components/FolderGrid";
import FileRow from "../components/FileRow";
import RatingStars from "../components/RatingStars";
import TranscriptModal from "../components/TranscriptModal";
import TagEditor from "../components/TagEditor";
import type { FileDetail } from "../api/types";

function TranscribeFolderControl({ folderId, fileIds }: { folderId: number; fileIds: number[] }) {
  const transcribeFolder = useTranscribeFolder();
  const cancelTranscription = useCancelTranscription();
  const { data: status } = useTranscriptionStatus(true);

  const isActive = status?.status === "running" || status?.status === "downloading-model" || status?.status === "cancelling";
  const relevant = status?.files?.filter((f) => fileIds.includes(f.fileId)) ?? [];
  const isThisFolderActive = isActive && relevant.length > 0;

  const doneCount = relevant.filter((f) => f.status === "done").length;
  const errorCount = relevant.filter((f) => f.status === "error").length;

  if (isThisFolderActive) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>
          {status?.status === "downloading-model"
            ? "Downloading model…"
            : `Transcribing… ${doneCount}/${relevant.length}${errorCount ? `, ${errorCount} failed` : ""}`}
        </span>
        <button onClick={() => cancelTranscription.mutate()} className="underline hover:text-red-400">
          Cancel
        </button>
      </div>
    );
  }

  // A batch running for *other* files no longer blocks this button — the server appends these
  // files to that batch's queue. Only a mid-cancel batch refuses, and that surfaces as an error.
  const isCancelling = status?.status === "cancelling";
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => transcribeFolder.mutate(folderId)}
        disabled={isCancelling || transcribeFolder.isPending}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 disabled:opacity-50"
      >
        {isActive ? "Add folder to queue" : "Transcribe folder"}
      </button>
      {transcribeFolder.isError && (
        <span className="text-xs text-red-400">{(transcribeFolder.error as Error).message}</span>
      )}
    </div>
  );
}

export default function FolderBrowser() {
  const { folderId } = useParams<{ folderId: string }>();
  const id = folderId ? Number(folderId) : undefined;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("track");
  const [folderSort, setFolderSort] = useState("name");
  const { data, isLoading, isError } = useFolder(id, { sort, page, folderSort });
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const setFolderRating = useSetFolderRating();
  const clearFolderRating = useClearFolderRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (isError || !data) return <div className="p-6 text-red-400">Folder not found.</div>;

  const { folder, breadcrumb, subfolders, files } = data;
  const hasMore = files.length === data.pageSize;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <Link to={`/library/folder/${crumb.id}`} className="hover:text-slate-200">
              {crumb.name || "Library"}
            </Link>
          </span>
        ))}
      </nav>

      {folder.relativePath !== "" && (
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{folder.name}</h1>
          <RatingStars
            value={folder.rating}
            onChange={(rating) => setFolderRating.mutate({ folderId: folder.id, rating })}
            onClear={() => clearFolderRating.mutate(folder.id)}
          />
        </div>
      )}

      {subfolders.length > 0 && (
        <div className="flex items-center justify-end">
          <select
            value={folderSort}
            onChange={(e) => setFolderSort(e.target.value)}
            className="rounded bg-slate-800 px-2 py-1 text-xs"
          >
            <option value="name">A–Z</option>
            <option value="fileCount">Most files</option>
          </select>
        </div>
      )}

      <FolderGrid
        folders={subfolders}
        onRate={(folderId, rating) => setFolderRating.mutate({ folderId, rating })}
        onClearRating={(folderId) => clearFolderRating.mutate(folderId)}
      />

      {files.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-400">
              {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
            </h2>
            <div className="flex items-center gap-2">
              <TranscribeFolderControl folderId={folder.id} fileIds={files.map((f) => f.id)} />
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="rounded bg-slate-800 px-2 py-1 text-xs"
              >
                <option value="track">Track order</option>
                <option value="title">Title</option>
                <option value="duration">Duration</option>
                <option value="rating">Rating</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                isCurrent={currentFile?.id === file.id}
                onPlay={() => playFile(file.id)}
                onRate={(rating) => setRating.mutate({ fileId: file.id, rating })}
                onClearRating={() => clearRating.mutate(file.id)}
                onViewTranscript={() => setViewingTranscriptFileId(file.id)}
                onEditTags={() => setEditingTagsFileId(file.id)}
              />
            ))}
          </div>
          {(page > 1 || hasMore) && (
            <div className="mt-3 flex justify-center gap-3 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded bg-slate-800 px-3 py-1 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-slate-500">Page {page}</span>
              <button
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
                className="rounded bg-slate-800 px-3 py-1 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {subfolders.length === 0 && files.length === 0 && (
        <div className="p-6 text-center text-slate-500">This folder is empty.</div>
      )}

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}
