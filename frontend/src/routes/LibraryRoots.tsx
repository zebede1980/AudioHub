import { useState } from "react";
import { Link } from "react-router-dom";
import { useLibraryRoots, useRatedFiles, useRootFolder } from "../api/hooks/library";
import { api, fileCoverUrl } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import RatingStars from "../components/RatingStars";
import type { LibraryRoot, FileDetail } from "../api/types";

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
  const play = usePlayerStore((s) => s.play);

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
      {data.map((file) => (
        <div
          key={file.id}
          role="button"
          tabIndex={0}
          onClick={() => playFile(file.id)}
          onKeyDown={(e) => e.key === "Enter" && playFile(file.id)}
          className="flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-800"
        >
          {file.coverImagePath ? (
            <img src={fileCoverUrl(file.id)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
              ♪
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{file.title ?? file.filename}</div>
            <Link
              to={`/library/folder/${file.folderId}`}
              onClick={(e) => e.stopPropagation()}
              className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
            >
              {file.folderName}
            </Link>
          </div>
          <RatingStars value={file.rating} readOnly size="sm" />
        </div>
      ))}
    </div>
  );
}

export default function LibraryRoots() {
  const { data: roots, isLoading } = useLibraryRoots();
  const [mode, setMode] = useState<"folders" | "rated">("folders");

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
      </div>

      {mode === "rated" ? (
        <RatedFilesList />
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
