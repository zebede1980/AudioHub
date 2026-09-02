import RatingStars from "./RatingStars";
import TagList from "./TagList";
import TranscribeButton from "./TranscribeButton";
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
  onClearRating?: () => void;
  onViewTranscript?: () => void;
  onEditTags?: () => void;
  /** Extra context line under the duration (e.g. a folder link + timestamp) for cross-folder lists like History or Recently Added. */
  subtitle?: React.ReactNode;
}

export default function FileRow({
  file,
  isCurrent,
  onPlay,
  onRate,
  onClearRating,
  onViewTranscript,
  onEditTags,
  subtitle,
}: Props) {
  return (
    <div className={`flex w-full items-center gap-3 rounded px-2 py-2 hover:bg-slate-800 ${isCurrent ? "bg-slate-800" : ""}`}>
      {/* A plain div (not <button>) so subtitle can safely nest a real <Link> — a real <button> can't contain interactive content. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onPlay}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlay();
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
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
          {subtitle}
          {file.tags.length > 0 && (
            <div className="mt-1">
              <TagList tags={file.tags} />
            </div>
          )}
        </div>
      </div>
      {file.hasTranscript && (
        <button
          onClick={onViewTranscript}
          title="View transcript"
          className="flex-shrink-0 text-slate-400 hover:text-indigo-400"
        >
          📄
        </button>
      )}
      {/* Renders nothing once a file has a transcript — the 📄 button above covers that case. */}
      <TranscribeButton fileId={file.id} hasTranscript={file.hasTranscript} />
      {onEditTags && (
        <button onClick={onEditTags} title="Edit tags" className="flex-shrink-0 text-slate-400 hover:text-indigo-400">
          🏷️
        </button>
      )}
      <RatingStars value={file.rating} onChange={onRate} onClear={onClearRating} size="sm" />
    </div>
  );
}
