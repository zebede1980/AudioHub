import { useState } from "react";
import { Link } from "react-router-dom";
import { useTags, useDeleteTag, useTracksByTags } from "../api/hooks/tags";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import type { FileDetail, FileRow as FileRowType } from "../api/types";

export default function Tags() {
  const { data: tags, isLoading } = useTags();
  const deleteTag = useDeleteTag();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mode, setMode] = useState<"all" | "any">("all");
  const { data, isLoading: tracksLoading } = useTracksByTags(selectedIds, mode);
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  function toggleTag(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function onDeleteTag(e: React.MouseEvent, id: number, name: string) {
    e.stopPropagation();
    if (confirm(`Delete the tag "${name}"? It will be removed from every track.`)) {
      deleteTag.mutate(id);
      setSelectedIds((prev) => prev.filter((t) => t !== id));
    }
  }

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <h1 className="text-lg font-semibold">Tags</h1>

      {isLoading && <div className="text-slate-400">Loading tags…</div>}
      {tags?.length === 0 && (
        <div className="text-sm text-slate-500">
          No tags yet. Add one from a track's 🏷️ button in your library.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {tags?.map((tag) => {
          const active = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              className={`group flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
                active ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"
              }`}
            >
              {tag.name}
              <span className={active ? "text-indigo-200" : "text-slate-500"}>{tag.trackCount ?? 0}</span>
              <span
                role="button"
                title={`Delete tag "${tag.name}"`}
                onClick={(e) => onDeleteTag(e, tag.id, tag.name)}
                className="ml-0.5 hidden text-xs opacity-70 hover:opacity-100 group-hover:inline"
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>

      {selectedIds.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Match</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "all" | "any")}
            className="rounded bg-slate-800 px-2 py-1 text-xs"
          >
            <option value="all">all selected tags</option>
            <option value="any">any selected tag</option>
          </select>
        </div>
      )}

      {selectedIds.length === 0 ? (
        <div className="text-sm text-slate-500">Select one or more tags to see matching tracks.</div>
      ) : (
        <div className="space-y-1">
          {tracksLoading && <div className="text-slate-400">Loading tracks…</div>}
          {data?.files.map((entry) => {
            const file: FileRowType = {
              id: entry.id,
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
                key={entry.id}
                file={file}
                isCurrent={currentFile?.id === entry.id}
                onPlay={() => playFile(entry.id)}
                onRate={(rating) => setRating.mutate({ fileId: entry.id, rating })}
                onClearRating={() => clearRating.mutate(entry.id)}
                onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
                onEditTags={() => setEditingTagsFileId(entry.id)}
                subtitle={
                  <Link
                    to={`/library/folder/${entry.folderId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
                  >
                    View folder
                  </Link>
                }
              />
            );
          })}
          {!tracksLoading && data?.files.length === 0 && (
            <div className="text-center text-slate-500">No tracks match{selectedIds.length > 1 ? ` (${mode === "all" ? "all" : "any"} selected tags)` : ""}.</div>
          )}
        </div>
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
