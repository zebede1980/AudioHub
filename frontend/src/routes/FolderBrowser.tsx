import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFolder } from "../api/hooks/folder";
import { useSetRating, useSetFolderRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FolderGrid from "../components/FolderGrid";
import FileRow from "../components/FileRow";
import RatingStars from "../components/RatingStars";
import type { FileDetail } from "../api/types";

export default function FolderBrowser() {
  const { folderId } = useParams<{ folderId: string }>();
  const id = folderId ? Number(folderId) : undefined;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("track");
  const [folderSort, setFolderSort] = useState("name");
  const { data, isLoading, isError } = useFolder(id, { sort, page, folderSort });
  const setRating = useSetRating();
  const setFolderRating = useSetFolderRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);

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
      />

      {files.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-400">
              {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
            </h2>
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
          <div className="space-y-1">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                isCurrent={currentFile?.id === file.id}
                onPlay={() => playFile(file.id)}
                onRate={(rating) => setRating.mutate({ fileId: file.id, rating })}
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
    </div>
  );
}
