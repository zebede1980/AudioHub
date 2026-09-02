import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSearch } from "../api/hooks/folder";
import { api } from "../api/client";
import { folderCoverUrl } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import { useSetRating, useClearRating, useSetFolderRating, useClearFolderRating } from "../api/hooks/ratings";
import RatingStars from "../components/RatingStars";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import type { FileDetail, FileRow as FileRowType } from "../api/types";

export default function Search() {
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  // Re-syncs when the navbar search box sends a new ?q= while already on this route — React
  // Router reuses this component instance rather than remounting it for a same-route navigation.
  useEffect(() => setQ(urlQuery), [urlQuery]);
  const { data, isLoading } = useSearch(q);
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const navigate = useNavigate();
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const setFolderRating = useSetFolderRating();
  const clearFolderRating = useClearFolderRating();
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <input
        type="search"
        autoFocus
        placeholder="Search titles, filenames, authors…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {isLoading && <div className="text-slate-400">Searching…</div>}

      {data && data.folders.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-xs font-medium uppercase text-slate-500">Folders</h2>
          {data.folders.map((folder) => (
            <div
              key={folder.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/library/folder/${folder.id}`)}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/library/folder/${folder.id}`)}
              className="flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-slate-800"
            >
              {folder.coverImagePath ? (
                <img
                  src={folderCoverUrl(folder.id)}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                  📁
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{folder.name}</div>
                <div className="truncate text-xs text-slate-400">
                  {folder.relativePath} · {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
                </div>
              </div>
              <RatingStars
                value={folder.rating}
                onChange={(rating) => setFolderRating.mutate({ folderId: folder.id, rating })}
                onClear={() => clearFolderRating.mutate(folder.id)}
                size="sm"
              />
            </div>
          ))}
        </div>
      )}

      {data && data.files.length > 0 && (
        <h2 className="text-xs font-medium uppercase text-slate-500">Tracks</h2>
      )}
      <div className="space-y-1">
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
          const subtitle = [entry.parsedAuthor, entry.parsedSeriesOrBook].filter(Boolean).join(" · ");
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
                subtitle ? (
                  <Link
                    to={`/library/folder/${entry.folderId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
                  >
                    {subtitle}
                  </Link>
                ) : undefined
              }
            />
          );
        })}
      </div>
      {q && !isLoading && data?.folders.length === 0 && data?.files.length === 0 && (
        <div className="text-center text-slate-500">No results for "{q}".</div>
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
