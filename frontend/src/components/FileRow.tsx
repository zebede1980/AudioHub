import RatingStars from "./RatingStars";
import { fileCoverUrl } from "../api/client";
import type { FileRow as FileRowType } from "../api/types";

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  file: FileRowType;
  isCurrent: boolean;
  onPlay: () => void;
  onRate: (rating: number) => void;
}

export default function FileRow({ file, isCurrent, onPlay, onRate }: Props) {
  return (
    <div className={`flex w-full items-center gap-3 rounded px-2 py-2 hover:bg-slate-800 ${isCurrent ? "bg-slate-800" : ""}`}>
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {file.coverImagePath ? (
          <img src={fileCoverUrl(file.id)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
        ) : (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
            ♪
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            {file.trackNumber ? `${file.trackNumber}. ` : ""}
            {file.title ?? file.filename}
          </div>
          <div className="text-xs text-slate-400">{formatDuration(file.durationSec)}</div>
        </div>
      </button>
      <RatingStars value={file.rating} onChange={onRate} size="sm" />
    </div>
  );
}
