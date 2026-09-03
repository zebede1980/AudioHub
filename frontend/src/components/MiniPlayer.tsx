import { Link, useLocation, useNavigate } from "react-router-dom";
import { usePlayerStore } from "../player/usePlayerStore";
import { fileCoverUrl } from "../api/client";

/** Whether the mini player is currently occupying the bottom of the screen. Exported because the
 * routed content has to reserve room for it — it is fixed-position, so it sits on top of the last
 * row of a list unless something pads the page out by its height. */
export function useMiniPlayerVisible(): boolean {
  const location = useLocation();
  const currentFile = usePlayerStore((s) => s.currentFile);
  return currentFile !== null && location.pathname !== "/player";
}

export default function MiniPlayer() {
  const visible = useMiniPlayerVisible();
  const navigate = useNavigate();
  const currentFile = usePlayerStore((s) => s.currentFile);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const skip = usePlayerStore((s) => s.skip);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  if (!visible || !currentFile) return null;

  const subtitle = currentFile.parsedAuthor ?? currentFile.parsedSeriesOrBook ?? "";
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-700 bg-slate-800">
      <div className="h-0.5 w-full bg-slate-700">
        <div className="h-full bg-indigo-500" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="flex items-center gap-2 p-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate("/player")}
          onKeyDown={(e) => e.key === "Enter" && navigate("/player")}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
        >
          {currentFile.coverImagePath ? (
            <img src={fileCoverUrl(currentFile.id)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
          ) : (
            <div className="h-10 w-10 flex-shrink-0 rounded bg-slate-700" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{currentFile.title ?? currentFile.filename}</div>
            {subtitle && (
              <Link
                to={`/library/folder/${currentFile.folderId}`}
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
              >
                {subtitle}
              </Link>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            skip(-15);
          }}
          title="Back 15 seconds"
          aria-label="Back 15 seconds"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs text-slate-200"
        >
          -15
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            togglePlay();
          }}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            skip(30);
          }}
          title="Forward 30 seconds"
          aria-label="Forward 30 seconds"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs text-slate-200"
        >
          +30
        </button>
      </div>
    </div>
  );
}
