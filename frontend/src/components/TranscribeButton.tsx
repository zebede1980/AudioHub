import { useTranscribeFile, useTranscriptionStatus } from "../api/hooks/transcribe";

/**
 * Per-row transcribe control. Every list in the app renders files through FileRow, so living here
 * puts it on the library, search, history, tags, top-rated and post-import lists at once.
 *
 * All instances share the one ["transcription-status"] query, so a 50-row list still makes a
 * single status request (and a single poll per second while a batch is running).
 */
export default function TranscribeButton({ fileId, hasTranscript }: { fileId: number; hasTranscript: boolean }) {
  const { data: status } = useTranscriptionStatus(true);
  const transcribe = useTranscribeFile();

  const entry = status?.files?.find((f) => f.fileId === fileId);
  const batchActive = status?.status === "running" || status?.status === "downloading-model";
  const isPending = batchActive && (entry?.status === "queued" || entry?.status === "transcribing");

  if (isPending) {
    const label =
      status?.status === "downloading-model"
        ? "Waiting for the speech-to-text model to download"
        : entry?.status === "transcribing"
          ? "Transcribing now"
          : "Queued for transcription";
    return (
      <span className="flex-shrink-0 text-slate-400" title={label} aria-label={label}>
        {entry?.status === "transcribing" ? "🎙️" : "⏳"}
      </span>
    );
  }

  // A finished transcript is reachable through FileRow's own 📄 button — no need to offer it again.
  if (hasTranscript) return null;

  if (transcribe.isError) {
    const message = (transcribe.error as Error).message;
    return (
      <button
        onClick={() => transcribe.mutate(fileId)}
        title={`${message} — click to try again`}
        aria-label={`Transcription request failed: ${message}. Click to try again.`}
        className="flex-shrink-0 text-red-400"
      >
        ⚠️
      </button>
    );
  }

  return (
    <button
      onClick={() => transcribe.mutate(fileId)}
      disabled={transcribe.isPending}
      title={batchActive ? "Add to the transcription queue" : "Transcribe this file"}
      aria-label={batchActive ? "Add to the transcription queue" : "Transcribe this file"}
      className="flex-shrink-0 text-slate-400 hover:text-indigo-400 disabled:opacity-50"
    >
      🎙️
    </button>
  );
}
