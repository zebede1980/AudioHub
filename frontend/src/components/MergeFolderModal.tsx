import { useState } from "react";
import { useMergeCandidates, useMergeFolders, type MergeCandidate, type MergeResult } from "../api/hooks/folder";

/**
 * Picks a folder to merge *into the one you're viewing*. The direction is the easy thing to get
 * backwards here — you end up on the folder you keep — so the wording names both sides everywhere
 * rather than saying "merge" and leaving the reader to work out which one survives.
 */
export default function MergeFolderModal({
  targetFolderId,
  targetName,
  onClose,
  onMerged,
}: {
  targetFolderId: number;
  targetName: string;
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<MergeCandidate | null>(null);
  const { data: candidates, isLoading } = useMergeCandidates(targetFolderId, query, true);
  const merge = useMergeFolders(targetFolderId);

  function confirm() {
    if (!chosen) return;
    merge.mutate(chosen.id, { onSuccess: onMerged });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 rounded border border-slate-700 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Merge another folder into <span className="text-indigo-400">{targetName}</span>
          </h2>
          <button onClick={onClose} className="shrink-0 text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {chosen ? (
          <div className="space-y-3">
            <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">
              Everything in <strong>{chosen.relativePath}</strong> ({chosen.fileCount} file
              {chosen.fileCount === 1 ? "" : "s"}) moves into <strong>{targetName}</strong>, and the empty folder is
              then removed.
              <div className="mt-2 text-xs text-amber-300/80">
                Ratings, tags, play history and transcripts move with the files. Nothing is overwritten — a name
                that's already taken gets a number added.
              </div>
            </div>
            {merge.isError && <div className="text-sm text-red-400">{merge.error.message}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChosen(null)}
                disabled={merge.isPending}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={confirm}
                disabled={merge.isPending}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {merge.isPending ? "Merging…" : "Merge and delete the folder"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              autoFocus
              type="text"
              placeholder="Search folders by name or path…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded border border-slate-800 p-2">
              {isLoading && <div className="px-2 py-1 text-sm text-slate-500">Loading…</div>}
              {!isLoading && candidates?.length === 0 && (
                <div className="px-2 py-1 text-sm text-slate-500">
                  {query ? `No folders match "${query}".` : "No other folders to merge from."}
                </div>
              )}
              {candidates?.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => setChosen(candidate)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{candidate.name}</span>
                    <span className="block truncate text-xs text-slate-500">{candidate.relativePath}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {candidate.fileCount} file{candidate.fileCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
