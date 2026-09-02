import { useTranscript } from "../api/hooks/transcribe";

interface Props {
  fileId: number;
  onClose: () => void;
}

export default function TranscriptModal({ fileId, onClose }: Props) {
  const { data: transcript, isLoading } = useTranscript(fileId);

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
