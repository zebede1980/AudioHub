import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePlayerStore } from "../player/usePlayerStore";
import { fileCoverUrl } from "../api/client";
import RatingStars from "../components/RatingStars";
import TagEditor from "../components/TagEditor";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import { useFileTags } from "../api/hooks/tags";
import {
  useTranscript,
  useTranscribeFile,
  useTranscriptionStatus,
  useDeleteTranscript,
} from "../api/hooks/transcribe";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function TagsSection({ fileId, onEdit }: { fileId: number; onEdit: () => void }) {
  const { data: fileTags } = useFileTags(fileId);

  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-800 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-400">Tags</h2>
        <button onClick={onEdit} className="text-xs text-slate-500 underline hover:text-indigo-400">
          Edit
        </button>
      </div>

      {fileTags && fileTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {fileTags.map((tag) => (
            <span key={tag.id} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
              {tag.name}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500">No tags yet.</div>
      )}
    </div>
  );
}

function TranscriptSection({ fileId }: { fileId: number }) {
  const { data: transcript, isLoading } = useTranscript(fileId);
  const transcribeFile = useTranscribeFile();
  const deleteTranscript = useDeleteTranscript();
  const { data: status } = useTranscriptionStatus(true);

  const myEntry = status?.files?.find((f) => f.fileId === fileId);
  const isThisFileActive =
    myEntry && (myEntry.status === "queued" || myEntry.status === "transcribing") && (status?.status === "downloading-model" || status?.status === "running");

  if (isLoading) return null;

  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-800 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-400">Transcript</h2>
        {transcript && (
          <button
            onClick={() => deleteTranscript.mutate(fileId)}
            className="text-xs text-slate-500 underline hover:text-red-400"
          >
            Delete
          </button>
        )}
      </div>

      {isThisFileActive ? (
        <div className="text-sm text-slate-400">
          {status?.status === "downloading-model"
            ? "Downloading speech-to-text model (one-time, ~550MB)…"
            : myEntry?.status === "transcribing"
              ? "Transcribing…"
              : "Queued…"}
        </div>
      ) : transcript ? (
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-slate-300">{transcript.text}</p>
      ) : myEntry?.status === "error" ? (
        <div className="space-y-2">
          <div className="text-sm text-red-400">Transcription failed: {myEntry.error}</div>
          <button
            onClick={() => transcribeFile.mutate(fileId)}
            className="rounded bg-indigo-600 px-3 py-1 text-sm"
          >
            Retry
          </button>
        </div>
      ) : (
        <button
          onClick={() => transcribeFile.mutate(fileId)}
          disabled={transcribeFile.isPending}
          className="rounded bg-indigo-600 px-3 py-1 text-sm disabled:opacity-50"
        >
          Transcribe this file
        </button>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PlayerScreen() {
  const navigate = useNavigate();
  const currentFile = usePlayerStore((s) => s.currentFile);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);
  const skip = usePlayerStore((s) => s.skip);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const [editingTags, setEditingTags] = useState(false);

  if (!currentFile) {
    return (
      <div className="p-6 text-center text-slate-400">
        Nothing playing.{" "}
        <button className="underline" onClick={() => navigate("/library")}>
          Browse your library
        </button>
        .
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 p-6">
      <button onClick={() => navigate(-1)} className="self-start text-slate-400">
        ← Back
      </button>

      {currentFile.coverImagePath ? (
        <img src={fileCoverUrl(currentFile.id)} alt="" className="h-64 w-64 rounded-lg object-cover shadow-lg" />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-slate-800 text-6xl text-slate-600">
          ♪
        </div>
      )}

      <div className="text-center">
        <div className="text-lg font-semibold">{currentFile.title ?? currentFile.filename}</div>
        {(currentFile.parsedAuthor || currentFile.parsedSeriesOrBook) && (
          <Link
            to={`/library/folder/${currentFile.folderId}`}
            className="text-sm text-slate-400 hover:text-indigo-400 hover:underline"
          >
            {[currentFile.parsedAuthor, currentFile.parsedSeriesOrBook].filter(Boolean).join(" · ")}
          </Link>
        )}
      </div>

      <RatingStars
        value={currentFile.rating}
        onChange={(rating) => setRating.mutate({ fileId: currentFile.id, rating })}
        onClear={() => clearRating.mutate(currentFile.id)}
      />

      <div className="w-full">
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <button onClick={prev} disabled={!currentFile.prevFileId} className="text-2xl disabled:opacity-30">
          ⏮
        </button>
        <button onClick={() => skip(-15)} className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
          -15s
        </button>
        <button
          onClick={togglePlay}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-2xl"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={() => skip(30)} className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
          +30s
        </button>
        <button onClick={next} disabled={!currentFile.nextFileId} className="text-2xl disabled:opacity-30">
          ⏭
        </button>
      </div>

      <div className="flex w-full items-center gap-4">
        <label className="text-xs text-slate-400">Vol</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="flex-1"
        />
        <select
          value={playbackRate}
          onChange={(e) => setPlaybackRate(Number(e.target.value))}
          className="rounded bg-slate-800 px-1 text-sm"
        >
          {SPEEDS.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      </div>

      <TagsSection fileId={currentFile.id} onEdit={() => setEditingTags(true)} />

      <TranscriptSection fileId={currentFile.id} />

      {editingTags && <TagEditor fileId={currentFile.id} onClose={() => setEditingTags(false)} />}
    </div>
  );
}
