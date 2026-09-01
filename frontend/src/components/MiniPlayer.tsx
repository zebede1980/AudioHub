import { Link, useLocation, useNavigate } from "react-router-dom";
import { usePlayerStore } from "../player/usePlayerStore";
import { fileCoverUrl } from "../api/client";

export default function MiniPlayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentFile = usePlayerStore((s) => s.currentFile);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  if (!currentFile || location.pathname === "/player") return null;

  const subtitle = currentFile.parsedAuthor ?? currentFile.parsedSeriesOrBook ?? "";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 border-t border-slate-700 bg-slate-800 p-2">
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
          togglePlay();
        }}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>
    </div>
  );
}
