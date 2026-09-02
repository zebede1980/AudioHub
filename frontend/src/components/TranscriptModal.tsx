import { useTranscript, useTranscribeFile, useTranscriptionStatus } from "../api/hooks/transcribe";

interface Props {
  fileId: number;
  onClose: () => void;
}

export default function TranscriptModal({ fileId, onClose }: Props) {
  const { data: transcript, isLoading } = useTranscript(fileId);
  const transcribe = useTranscribeFile();
  const { data: status } = useTranscriptionStatus(true);

  const entry = status?.files?.find((f) => f.fileId === fileId);
  const batchActive = status?.status === "running" || status?.status === "downloading-model";
  const isPending = batchActive && (entry?.status === "queued" || entry?.status === "transcribing");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-400">Transcript</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>

        {/* whisper can fall into repeating one sentence for the rest of a file. Saying so beats
            presenting the result as if it were sound, and re-running often clears it. */}
        {transcript?.repetitionSuspect && (
          <div className="mb-3 space-y-2 rounded border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-300">
            <div>
              ⚠ This transcript looks degraded — the same sentence repeats {transcript.repeatRun} times in a row,
              which usually means speech-to-text got stuck rather than the audio actually repeating.
            </div>
            <button
              onClick={() => transcribe.mutate(fileId)}
              disabled={isPending || transcribe.isPending}
              className="rounded bg-slate-800 px-2 py-1 text-amber-200 disabled:opacity-50"
            >
              {isPending
                ? entry?.status === "transcribing"
                  ? "Transcribing…"
                  : "Queued…"
                : batchActive
                  ? "Add to transcription queue"
                  : "Transcribe again"}
            </button>
            {transcribe.isError && <div className="text-red-400">{(transcribe.error as Error).message}</div>}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : transcript ? (
          <p className="whitespace-pre-wrap text-sm text-slate-300">{transcript.text}</p>
        ) : (
          <div className="text-sm text-slate-500">No transcript found.</div>
        )}
      </div>
    </div>
  );
}
