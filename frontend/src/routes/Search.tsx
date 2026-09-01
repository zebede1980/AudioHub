import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSearch } from "../api/hooks/folder";
import { api } from "../api/client";
import { fileCoverUrl, folderCoverUrl } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import { useSetFolderRating } from "../api/hooks/ratings";
import RatingStars from "../components/RatingStars";
import type { FileDetail } from "../api/types";

export default function Search() {
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  // Re-syncs when the navbar search box sends a new ?q= while already on this route — React
  // Router reuses this component instance rather than remounting it for a same-route navigation.
  useEffect(() => setQ(urlQuery), [urlQuery]);
  const { data, isLoading } = useSearch(q);
  const play = usePlayerStore((s) => s.play);
  const navigate = useNavigate();
  const setFolderRating = useSetFolderRating();

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
              {folder.cover_image_path ? (
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
                  {folder.relative_path} · {folder.file_count} file{folder.file_count === 1 ? "" : "s"}
                </div>
              </div>
              <RatingStars
                value={folder.rating}
                onChange={(rating) => setFolderRating.mutate({ folderId: folder.id, rating })}
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
        {data?.files.map((file) => {
          const subtitle = [file.parsed_author, file.parsed_series_or_book].filter(Boolean).join(" · ");
          return (
            <div
              key={file.id}
              role="button"
              tabIndex={0}
              onClick={() => playFile(file.id)}
              onKeyDown={(e) => e.key === "Enter" && playFile(file.id)}
              className="flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-800"
            >
              {file.cover_image_path ? (
                <img src={fileCoverUrl(file.id)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                  ♪
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{file.title ?? file.filename}</div>
                {subtitle && (
                  <Link
                    to={`/library/folder/${file.folder_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
                  >
                    {subtitle}
                  </Link>
                )}
              </div>
              <RatingStars value={file.rating} readOnly size="sm" />
            </div>
          );
        })}
      </div>
      {q && !isLoading && data?.folders.length === 0 && data?.files.length === 0 && (
        <div className="text-center text-slate-500">No results for "{q}".</div>
      )}
    </div>
  );
}
