import { Link } from "react-router-dom";
import { usePlayHistory, useClearPlayHistory } from "../api/hooks/history";
import { api, fileCoverUrl } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import type { FileDetail } from "../api/types";

export default function History() {
  const { data, isLoading } = usePlayHistory();
  const clear = useClearPlayHistory();
  const play = usePlayerStore((s) => s.play);

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
        {data?.map((entry) => (
          <div
            key={entry.historyId}
            role="button"
            tabIndex={0}
            onClick={() => playFile(entry.fileId)}
            onKeyDown={(e) => e.key === "Enter" && playFile(entry.fileId)}
            className="flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-800"
          >
            {entry.coverImagePath ? (
              <img src={fileCoverUrl(entry.fileId)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                ♪
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{entry.title ?? entry.filename}</div>
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
            </div>
          </div>
        ))}
      </div>

      {!isLoading && data?.length === 0 && (
        <div className="p-6 text-center text-slate-500">Nothing played yet.</div>
      )}
    </div>
  );
}
