import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFoldersForReview, useFolderContents, useDeleteFolders } from "../api/hooks/library";
import { useClearFolderRating } from "../api/hooks/ratings";
import { api, folderCoverUrl } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import RatingStars from "../components/RatingStars";
import type { FileDetail, FolderReviewRow } from "../api/types";

/** Which folders are ticked survives a trip to the player screen and back — reviewing a big
 * folder often means listening to something, and losing the checkboxes for it would push the user
 * straight back towards "just delete the lot". */
const SELECTION_STORAGE_KEY = "audiohub.folderCleanup.selection";

function loadSelection(): number[] {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  return hours > 0
    ? `${hours}h ${minutes}m`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatWhen(ms: number | null): string | null {
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
}

async function playFileById(fileId: number) {
  const file = await api.get<FileDetail>(`/files/${fileId}`);
  usePlayerStore.getState().play(file);
}

/** The reasons a folder might be here by mistake, spelled out rather than left for the user to
 * infer from a file count. */
function warningsFor(folder: FolderReviewRow): string[] {
  const warnings: string[] = [];
  if (folder.maxFileRating && folder.maxFileRating >= 4) {
    warnings.push(`contains a ${folder.maxFileRating}-star file`);
  } else if (folder.highlyRatedFileCount > 0) {
    warnings.push(`${folder.highlyRatedFileCount} file${folder.highlyRatedFileCount === 1 ? "" : "s"} rated 3+`);
  }
  if (folder.transcriptCount > 0) {
    warnings.push(`${folder.transcriptCount} transcript${folder.transcriptCount === 1 ? "" : "s"}`);
  }
  const played = folder.lastPlayedAt && Date.now() - folder.lastPlayedAt < 30 * 24 * 60 * 60 * 1000;
  if (played) warnings.push(`played ${formatWhen(folder.lastPlayedAt)}`);
  return warnings;
}

function FolderContentsList({ folderId }: { folderId: number }) {
  const { data, isLoading } = useFolderContents(folderId, true);
  const currentFileId = usePlayerStore((s) => s.currentFile?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  if (isLoading) return <div className="px-3 py-2 text-xs text-slate-500">Loading contents…</div>;
  if (!data || data.files.length === 0) {
    return <div className="px-3 py-2 text-xs text-slate-500">No audio files indexed in this folder.</div>;
  }

  return (
    <div className="space-y-0.5">
      {data.files.map((file) => {
        const isCurrent = currentFileId === file.id;
        return (
          <div
            key={file.id}
            className={`flex items-center gap-2 rounded px-2 py-1.5 ${isCurrent ? "bg-slate-800" : "hover:bg-slate-800/60"}`}
          >
            <button
              onClick={() => (isCurrent ? togglePlay() : playFileById(file.id))}
              title={isCurrent && isPlaying ? "Pause" : "Play — the review list stays exactly where it is"}
              aria-label={isCurrent && isPlaying ? "Pause" : `Play ${file.title ?? file.filename}`}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs text-slate-100"
            >
              {isCurrent && isPlaying ? "❚❚" : "▶"}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{file.title ?? file.filename}</div>
              <div className="truncate text-[11px] text-slate-500">
                {file.subPath.includes("/") && <span>{file.subPath.slice(0, file.subPath.lastIndexOf("/"))} · </span>}
                {formatDuration(file.durationSec)} · {formatBytes(file.sizeBytes)}
                {file.hasTranscript && " · 📄"}
                {file.lastPlayedAt && ` · played ${formatWhen(file.lastPlayedAt)}`}
              </div>
            </div>
            {file.rating !== null && <RatingStars value={file.rating} size="sm" readOnly />}
          </div>
        );
      })}
      {data.truncated && (
        <div className="px-2 py-1 text-[11px] text-slate-500">
          Showing the first {data.files.length} files — this folder holds more.
        </div>
      )}
    </div>
  );
}

export default function FolderCleanupReview() {
  const navigate = useNavigate();
  const { data: folders, isLoading } = useFoldersForReview(1);
  const deleteFolders = useDeleteFolders();
  const clearFolderRating = useClearFolderRating();

  const [selectedIds, setSelectedIds] = useState<number[]>(loadSelection);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  // A deleted folder's rows are cleaned up by the rescan the delete kicks off, which finishes
  // after this list refetches — so hide what we just moved to the trash rather than leaving it
  // sitting there, tickable, for another few seconds.
  const [justDeletedIds, setJustDeletedIds] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const hasMiniPlayer = usePlayerStore((s) => s.currentFile !== null);

  useEffect(() => {
    try {
      sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selectedIds));
    } catch {
      // Private-mode storage failures only cost the convenience of a remembered selection.
    }
  }, [selectedIds]);

  // A folder that left the 1-star list (rating cleared, already deleted) must not stay selected —
  // otherwise a stale id could be submitted later. Once the server stops listing a deleted folder,
  // it no longer needs hiding either.
  useEffect(() => {
    if (!folders) return;
    const live = new Set(folders.map((f) => f.id));
    setSelectedIds((ids) => (ids.every((id) => live.has(id)) ? ids : ids.filter((id) => live.has(id))));
    setJustDeletedIds((ids) => (ids.every((id) => live.has(id)) ? ids : ids.filter((id) => live.has(id))));
  }, [folders]);

  const visibleFolders = useMemo(
    () => (folders ?? []).filter((f) => !justDeletedIds.includes(f.id)),
    [folders, justDeletedIds]
  );
  const selected = useMemo(
    () => visibleFolders.filter((f) => selectedIds.includes(f.id)),
    [visibleFolders, selectedIds]
  );
  const selectedTotals = useMemo(
    () =>
      selected.reduce(
        (acc, f) => ({ files: acc.files + f.fileCount, bytes: acc.bytes + f.sizeBytes }),
        { files: 0, bytes: 0 }
      ),
    [selected]
  );

  function toggleSelected(id: number) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  function toggleExpanded(id: number) {
    setExpandedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  async function onConfirmDelete() {
    const ids = selected.map((f) => f.id);
    setConfirming(false);
    try {
      const res = await deleteFolders.mutateAsync(ids);
      setSelectedIds([]);
      setExpandedIds([]);
      setJustDeletedIds((current) => [...current, ...res.deleted.map((d) => d.folderId)]);
      const failedNote = res.failed.length > 0 ? ` ${res.failed.length} could not be moved.` : "";
      setResult(
        `Moved ${res.deletedCount} folder${res.deletedCount === 1 ? "" : "s"} to the trash.${failedNote} They stay recoverable from Settings → Trash for 30 days.`
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to delete folders");
    }
  }

  const totalFiles = visibleFolders.reduce((sum, f) => sum + f.fileCount, 0);

  return (
    <div className={`mx-auto max-w-2xl space-y-4 p-4 ${hasMiniPlayer ? "pb-56" : "pb-40"}`}>
      <div>
        <button onClick={() => navigate("/settings")} className="text-xs text-slate-400 hover:text-indigo-400">
          ← Settings
        </button>
        <h1 className="mt-1 text-lg font-semibold">Review 1-star folders</h1>
        <p className="text-xs text-slate-500">
          Nothing is deleted until you tick a folder and confirm. Expand a folder to see — and play — every file
          inside it; playing never loses your place here. Deleted folders go to the trash and stay recoverable for
          30 days.
        </p>
      </div>

      {isLoading && <div className="text-slate-400">Loading…</div>}

      {folders && visibleFolders.length === 0 && (
        <div className="rounded-lg border border-slate-800 p-4 text-sm text-slate-400">
          No folders are rated 1 star. Nothing to review.
        </div>
      )}

      {folders && visibleFolders.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            {visibleFolders.length} folder{visibleFolders.length === 1 ? "" : "s"} · {totalFiles} file
            {totalFiles === 1 ? "" : "s"} · {selectedIds.length} selected
          </span>
          <span className="flex gap-2">
            <button
              onClick={() => setSelectedIds(visibleFolders.map((f) => f.id))}
              className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
              className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700 disabled:opacity-50"
            >
              Clear
            </button>
          </span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs text-slate-300">
          {result}{" "}
          <Link to="/settings" className="text-indigo-400 hover:underline">
            Open Settings → Trash
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {visibleFolders.map((folder) => {
          const isSelected = selectedIds.includes(folder.id);
          const isExpanded = expandedIds.includes(folder.id);
          const warnings = warningsFor(folder);
          return (
            <div
              key={folder.id}
              className={`rounded-lg border p-3 ${isSelected ? "border-red-800 bg-red-950/20" : "border-slate-800"}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(folder.id)}
                  aria-label={`Select ${folder.name} for deletion`}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-red-500"
                />
                {folder.coverImagePath ? (
                  <img src={folderCoverUrl(folder.id)} alt="" className="h-12 w-12 flex-shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                    ♪
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{folder.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {folder.libraryRootName} · {folder.relativePath}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
                    {folder.subfolderCount > 0 &&
                      ` in ${folder.subfolderCount} subfolder${folder.subfolderCount === 1 ? "" : "s"}`}{" "}
                    · {formatBytes(folder.sizeBytes)} · {formatDuration(folder.durationSec)}
                  </div>
                  {warnings.length > 0 && (
                    <div className="mt-1 text-xs text-amber-400">⚠ {warnings.join(" · ")}</div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => toggleExpanded(folder.id)}
                      className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                    >
                      {isExpanded ? "Hide files" : `Show ${folder.fileCount} file${folder.fileCount === 1 ? "" : "s"}`}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedIds((ids) => ids.filter((i) => i !== folder.id));
                        clearFolderRating.mutate(folder.id);
                      }}
                      title="Removes the 1-star rating so this folder drops off the delete list"
                      className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                    >
                      Keep — clear 1★
                    </button>
                    {/* A new tab, so browsing the folder for context never unwinds this review. */}
                    <a
                      href={`/library/folder/${folder.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
                    >
                      Open in library ↗
                    </a>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="mt-2 border-t border-slate-800 pt-2">
                  <FolderContentsList folderId={folder.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedIds.length > 0 && (
        <div
          className={`fixed left-0 right-0 z-30 border-t border-slate-700 bg-slate-900/95 p-3 ${hasMiniPlayer ? "bottom-16" : "bottom-0"}`}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-slate-400">
              {selectedIds.length} folder{selectedIds.length === 1 ? "" : "s"} · {selectedTotals.files} file
              {selectedTotals.files === 1 ? "" : "s"} · {formatBytes(selectedTotals.bytes)}
            </div>
            <button
              onClick={() => setConfirming(true)}
              disabled={deleteFolders.isPending}
              className="flex-shrink-0 rounded bg-red-900/70 px-3 py-2 text-sm text-red-200 disabled:opacity-50"
            >
              {deleteFolders.isPending ? "Moving…" : "Move to trash…"}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">
              Move {selected.length} folder{selected.length === 1 ? "" : "s"} to the trash?
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {selectedTotals.files} file{selectedTotals.files === 1 ? "" : "s"} ({formatBytes(selectedTotals.bytes)})
              will leave your library. They are moved to a trash folder on the same drive, not erased — restore them
              from Settings → Trash within 30 days, after which they are deleted for good.
            </p>
            <ul className="mt-3 space-y-1 text-xs">
              {selected.map((folder) => (
                <li key={folder.id} className="rounded bg-slate-800/60 px-2 py-1">
                  <div className="truncate">{folder.relativePath}</div>
                  <div className="text-slate-500">
                    {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"} · {formatBytes(folder.sizeBytes)}
                    {warningsFor(folder).length > 0 && (
                      <span className="text-amber-400"> · ⚠ {warningsFor(folder).join(" · ")}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded bg-slate-800 px-3 py-2 text-sm">
                Cancel
              </button>
              <button onClick={onConfirmDelete} className="rounded bg-red-900/70 px-3 py-2 text-sm text-red-200">
                Move to trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
