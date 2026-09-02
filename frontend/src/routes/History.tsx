import { useState } from "react";
import { Link } from "react-router-dom";
import { usePlayHistory, useClearPlayHistory } from "../api/hooks/history";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import type { FileDetail, FileRow as FileRowType } from "../api/types";

export default function History() {
  const { data, isLoading } = usePlayHistory();
  const clear = useClearPlayHistory();
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">History</h1>
        {data && data.length > 0 && (
          <button
            onClick={() => {
              if (confirm("Clear your entire play history?")) clear.mutate();
            }}
            disabled={clear.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-sm disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && <div className="text-slate-400">Loading…</div>}

      <div className="space-y-1">
        {data?.map((entry) => {
          const file: FileRowType = {
            id: entry.fileId,
            filename: entry.filename,
            title: entry.title,
            trackNumber: entry.trackNumber,
            durationSec: entry.durationSec,
            coverImagePath: entry.coverImagePath,
            rating: entry.rating,
            hasTranscript: entry.hasTranscript,
            tags: entry.tags,
          };
          return (
            <FileRow
              key={entry.historyId}
              file={file}
              isCurrent={currentFile?.id === entry.fileId}
              onPlay={() => playFile(entry.fileId)}
              onRate={(rating) => setRating.mutate({ fileId: entry.fileId, rating })}
              onClearRating={() => clearRating.mutate(entry.fileId)}
              onViewTranscript={() => setViewingTranscriptFileId(entry.fileId)}
              onEditTags={() => setEditingTagsFileId(entry.fileId)}
              subtitle={
                <div className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-400">
                  <Link
                    to={`/library/folder/${entry.folderId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="truncate hover:text-indigo-400 hover:underline"
                  >
                    {entry.folderName}
                  </Link>
                  <span>·</span>
                  <span>{new Date(entry.playedAt).toLocaleString()}</span>
                </div>
              }
            />
          );
        })}
      </div>

      {!isLoading && data?.length === 0 && (
        <div className="p-6 text-center text-slate-500">Nothing played yet.</div>
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
