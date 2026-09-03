import { useState } from "react";
import { Link } from "react-router-dom";
import { usePlayHistory, useClearPlayHistory } from "../api/hooks/history";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "./FileRow";
import TagEditor from "./TagEditor";
import TranscriptModal from "./TranscriptModal";
import type { FileDetail, FileRow as FileRowType } from "../api/types";

/**
 * The Library home's History tab. Lives here rather than beside its sibling lists in
 * LibraryRoots.tsx because it is the only one with its own action (Clear) and modals to carry;
 * folding it in would have pushed that file past readable.
 */
export default function PlayHistoryList() {
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

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
        Nothing played yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={() => {
            if (confirm("Clear your entire play history?")) clear.mutate();
          }}
          disabled={clear.isPending}
          className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 disabled:opacity-50"
        >
          Clear history
        </button>
      </div>

      <div className="space-y-1">
        {data.map((entry) => {
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

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}
