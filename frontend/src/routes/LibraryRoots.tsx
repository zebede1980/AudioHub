import { useState } from "react";
import { Link } from "react-router-dom";
import { useLibraryRoots, useRatedFiles, useRecentFiles, useRootFolder } from "../api/hooks/library";
import { useSetRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import type { LibraryRoot, FileDetail, FileRow as FileRowType } from "../api/types";

function LibraryRootCard({ root }: { root: LibraryRoot }) {
  const { data: rootFolder, isError } = useRootFolder(root.id);

  return (
    <div className="rounded-lg border border-slate-800 p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">{root.name}</div>
        <span
          className={`text-xs ${
            root.lastScanStatus === "error"
              ? "text-red-400"
              : root.lastScanStatus === "running"
                ? "text-yellow-400"
                : "text-slate-500"
          }`}
        >
          {root.lastScanStatus ?? "never scanned"}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-slate-500">{root.containerPath}</div>
      {rootFolder ? (
        <Link to={`/library/folder/${rootFolder.id}`} className="mt-3 inline-block text-sm text-indigo-400">
          Browse →
        </Link>
      ) : isError ? (
        <div className="mt-3 text-sm text-slate-500">
          Not scanned yet — trigger a scan from <Link to="/settings" className="underline">Settings</Link>.
        </div>
      ) : null}
    </div>
  );
}

function RatedFilesList() {
  const { data, isLoading } = useRatedFiles();
  const setRating = useSetRating();
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
    return <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">No rated files yet.</div>;
  }

  return (
    <div className="space-y-1">
      {data.map((entry) => {
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
            onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
            onEditTags={() => setEditingTagsFileId(entry.id)}
            subtitle={
              <Link
                to={`/library/folder/${entry.folderId}`}
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
              >
                {entry.folderName}
              </Link>
            }
          />
        );
      })}

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

function RecentFilesList() {
  const { data, isLoading } = useRecentFiles();
  const setRating = useSetRating();
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
        Nothing scanned in yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {data.map((entry) => {
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
            onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
            onEditTags={() => setEditingTagsFileId(entry.id)}
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
                <span>{new Date(entry.firstSeenAt).toLocaleString()}</span>
              </div>
            }
          />
        );
      })}

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

export default function LibraryRoots() {
  const { data: roots, isLoading } = useLibraryRoots();
  const [mode, setMode] = useState<"folders" | "rated" | "recent">("folders");

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Library</h1>
        <Link to="/settings" className="text-sm text-indigo-400">
          Manage folders
        </Link>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setMode("folders")}
          className={`rounded px-3 py-1 text-sm ${mode === "folders" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Folders
        </button>
        <button
          onClick={() => setMode("rated")}
          className={`rounded px-3 py-1 text-sm ${mode === "rated" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Top Rated
        </button>
        <button
          onClick={() => setMode("recent")}
          className={`rounded px-3 py-1 text-sm ${mode === "recent" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Recently Added
        </button>
      </div>

      {mode === "rated" ? (
        <RatedFilesList />
      ) : mode === "recent" ? (
        <RecentFilesList />
      ) : !roots || roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
          No library folders added yet.{" "}
          <Link to="/settings" className="text-indigo-400 underline">
            Add one
          </Link>
          .
        </div>
      ) : (
        roots.map((root) => <LibraryRootCard key={root.id} root={root} />)
      )}
    </div>
  );
}
