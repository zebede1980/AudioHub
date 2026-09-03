import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useLibraryRoots, useScanStatus } from "../api/hooks/library";
import { useFolder } from "../api/hooks/folder";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import {
  useListSoundgasmPosts,
  useResolveSoundgasmPost,
  useStartSoundgasmDownload,
  useRetrySoundgasmDownload,
  useSoundgasmDownloadStatus,
  useSoundgasmDownloadFolder,
  type SoundgasmPost,
} from "../api/hooks/soundgasm";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import type { FileDetail } from "../api/types";

const AUTO_SELECT_THRESHOLD = 10;

const STATUS_STYLE: Record<string, string> = {
  pending: "text-slate-500",
  downloading: "text-indigo-400",
  done: "text-emerald-400",
  skipped: "text-slate-500",
  error: "text-red-400",
};

/**
 * Self-contained view of one download job (bulk profile import or a single quick import).
 * Each instance polls its own job/folder state, so multiple imports run fully independently.
 */
function ImportJobPanel({ jobId, label, onDismiss }: { jobId: string; label: string; onDismiss?: () => void }) {
  const queryClient = useQueryClient();
  const job = useSoundgasmDownloadStatus(jobId);
  const retry = useRetrySoundgasmDownload(jobId);
  const settled = job.data !== undefined && job.data.status !== "running";
  const folderLink = useSoundgasmDownloadFolder(jobId, settled);
  const { data: folder } = useFolder(folderLink.data?.folderId, { sort: "track" });

  // A finished download is not a finished import: it ends by kicking off a library scan, and only
  // once that scan has indexed the new audio does it appear in the folder listing below. Watching
  // the scan is what stops this panel saying "Done." over an empty (or, on a repeat import from
  // the same uploader, a stale) list — which reads as "the file was never saved".
  const { data: scan } = useScanStatus(job.data?.libraryRootId, settled);
  const isIndexing = settled && scan?.status === "running";

  // Refresh the folder — and the folder link, which 404s until the scan creates the folder row —
  // once there is no scan left to wait for. This fires both when the download settles (covering a
  // scan that finished before this panel began watching) and when a watched scan completes.
  useEffect(() => {
    if (!settled || isIndexing) return;
    queryClient.invalidateQueries({ queryKey: ["soundgasm-download-folder", jobId] });
    queryClient.invalidateQueries({ queryKey: ["folder"] });
  }, [settled, isIndexing, jobId, queryClient]);
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  if (!job.data) return null;

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  const failedItems = job.data.items.filter((i) => i.status === "error");
  const busy = job.data.status === "running" || retry.isPending;
  // While the job is running, show every item so progress is visible; once it's settled, the
  // finished tracks show up in the folder listing below, so only errors still need this list.
  const progressItems = busy ? job.data.items : failedItems;

  return (
    <div className="space-y-2 rounded border border-slate-800 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
        <span>
          {job.data.status === "running"
            ? "Downloading…"
            : job.data.status === "error"
              ? "Job failed."
              : isIndexing
                ? "Downloaded — scanning library…"
                : "Done."}{" "}
          {job.data.items.filter((i) => i.status === "done" || i.status === "skipped").length} /{" "}
          {job.data.items.length} processed
          {failedItems.length > 0 ? `, ${failedItems.length} failed` : ""}
          {" — "}
          {folderLink.data ? (
            <Link to={`/library/folder/${folderLink.data.folderId}`} className="text-indigo-400 hover:underline">
              {label}
            </Link>
          ) : (
            <span>{label}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {failedItems.length > 0 && (
            <button
              onClick={() => retry.mutate(undefined)}
              disabled={busy}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium disabled:opacity-50"
            >
              Retry all failed ({failedItems.length})
            </button>
          )}
          {!busy && onDismiss && (
            <button onClick={onDismiss} title="Dismiss" className="text-slate-500 hover:text-slate-300">
              ✕
            </button>
          )}
        </span>
      </div>

      {progressItems.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-slate-800 p-2 text-sm">
          {progressItems.map((item) => (
            <div key={item.postUrl} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate" title={item.title}>
                {item.title}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`text-xs ${STATUS_STYLE[item.status]}`} title={item.error}>
                  {item.status}
                </span>
                {item.status === "error" && (
                  <button
                    onClick={() => retry.mutate([item.postUrl])}
                    disabled={busy}
                    className="rounded bg-slate-800 px-2 py-0.5 text-xs disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {isIndexing && (
        <div className="rounded border border-slate-800 p-2 text-xs text-slate-400">
          Saved to disk. Indexing them into the library…
          {scan?.progress ? ` ${scan.progress.filesScanned} files seen so far.` : ""} They'll appear below when the
          scan finishes.
        </div>
      )}

      {/* Downloaded fine, scan finished, and still nothing here: say so rather than showing an
          empty panel that reads as a failed import. */}
      {settled &&
        !isIndexing &&
        job.data.status === "ok" &&
        folder &&
        folder.files.length === 0 &&
        job.data.items.some((i) => i.status === "done" || i.status === "skipped") && (
          <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-300">
            The download finished but the library scan didn't pick anything up in this folder. The files are on disk
            under <code>{job.data.destDir}</code> — a rescan from{" "}
            <Link to="/settings" className="underline">
              Settings
            </Link>{" "}
            should surface them.
          </div>
        )}

      {folder && folder.files.length > 0 && (
        <div className="space-y-1">
          {folder.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              isCurrent={currentFile?.id === file.id}
              onPlay={() => playFile(file.id)}
              onRate={(rating) => setRating.mutate({ fileId: file.id, rating })}
              onClearRating={() => clearRating.mutate(file.id)}
              onViewTranscript={() => setViewingTranscriptFileId(file.id)}
              onEditTags={() => setEditingTagsFileId(file.id)}
            />
          ))}
          {folder.files.length === folder.pageSize && folderLink.data && (
            <Link
              to={`/library/folder/${folderLink.data.folderId}`}
              className="block py-1 text-center text-xs text-indigo-400 hover:underline"
            >
              View full folder →
            </Link>
          )}
        </div>
      )}

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

export default function ImportSoundgasm() {
  const [profileUrl, setProfileUrl] = useState("");
  const [listing, setListing] = useState<{ username: string; posts: SoundgasmPost[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [libraryRootId, setLibraryRootId] = useState<number | undefined>(undefined);
  const [bulkJobId, setBulkJobId] = useState<string | undefined>(undefined);
  const [bulkLabel, setBulkLabel] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [manualPostUrl, setManualPostUrl] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [quickJobs, setQuickJobs] = useState<{ jobId: string; label: string }[]>([]);

  const { data: roots } = useLibraryRoots();
  const list = useListSoundgasmPosts();
  const resolvePost = useResolveSoundgasmPost();
  const startBulkDownload = useStartSoundgasmDownload();
  const startQuickDownload = useStartSoundgasmDownload();

  const effectiveRootId = libraryRootId ?? roots?.[0]?.id;

  const filteredPosts =
    listing?.posts.filter((p) => p.title.toLowerCase().includes(filterText.trim().toLowerCase())) ?? [];

  async function onList(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setListing(null);
    setBulkJobId(undefined);
    setFilterText("");
    try {
      const result = await list.mutateAsync(profileUrl);
      setListing(result);
      setSelected(
        new Set(result.posts.length <= AUTO_SELECT_THRESHOLD ? result.posts.map((p) => p.postUrl) : [])
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load profile");
    }
  }

  // Fully independent of the profile-listing flow above: resolves and downloads a single post
  // from any user, one click at a time, so importing several one-off tracks from different
  // uploaders in a row never depends on (or gets blocked by) whatever profile is currently listed.
  async function onQuickImport(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    if (!effectiveRootId) {
      setManualError("No library root selected.");
      return;
    }
    try {
      const { username, post } = await resolvePost.mutateAsync(manualPostUrl);
      const { jobId } = await startQuickDownload.mutateAsync({
        libraryRootId: effectiveRootId,
        username,
        posts: [post],
      });
      setQuickJobs((prev) => [{ jobId, label: `Soundgasm/${username}` }, ...prev]);
      setManualPostUrl("");
    } catch (err) {
      setManualError(err instanceof ApiError ? err.message : "Failed to import post");
    }
  }

  function toggle(postUrl: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postUrl)) next.delete(postUrl);
      else next.add(postUrl);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredPosts.forEach((p) => next.add(p.postUrl));
      return next;
    });
  }

  function selectNoneVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredPosts.forEach((p) => next.delete(p.postUrl));
      return next;
    });
  }

  async function onDownload() {
    if (!listing || !effectiveRootId || selected.size === 0) return;
    setError(null);
    try {
      const posts = listing.posts.filter((p) => selected.has(p.postUrl));
      const { jobId } = await startBulkDownload.mutateAsync({
        libraryRootId: effectiveRootId,
        username: listing.username,
        posts,
      });
      setBulkJobId(jobId);
      setBulkLabel(`Soundgasm/${listing.username}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start download");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-lg font-semibold">Import from Soundgasm</h1>

      {roots && roots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-slate-400">Save to</label>
          <select
            value={effectiveRootId ?? ""}
            onChange={(e) => setLibraryRootId(Number(e.target.value))}
            className="rounded bg-slate-800 px-2 py-1 text-sm"
          >
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">→ Soundgasm/&lt;uploader&gt;</span>
        </div>
      )}

      <form onSubmit={onQuickImport} className="flex gap-2">
        <input
          type="text"
          placeholder="https://soundgasm.net/u/username/post-title — quick single-track import"
          value={manualPostUrl}
          onChange={(e) => setManualPostUrl(e.target.value)}
          className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={resolvePost.isPending || startQuickDownload.isPending || !manualPostUrl || !effectiveRootId}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {resolvePost.isPending || startQuickDownload.isPending ? "Importing…" : "Import"}
        </button>
      </form>
      {manualError && <div className="text-sm text-red-400">{manualError}</div>}

      {quickJobs.length > 0 && (
        <div className="space-y-2">
          {quickJobs.map((qj) => (
            <ImportJobPanel
              key={qj.jobId}
              jobId={qj.jobId}
              label={qj.label}
              onDismiss={() => setQuickJobs((prev) => prev.filter((j) => j.jobId !== qj.jobId))}
            />
          ))}
        </div>
      )}

      <hr className="border-slate-800" />

      <form onSubmit={onList} className="flex gap-2">
        <input
          type="text"
          placeholder="https://soundgasm.net/u/username — bulk import from a profile"
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={list.isPending || !profileUrl}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {list.isPending ? "Loading…" : "List posts"}
        </button>
      </form>

      {error && <div className="text-sm text-red-400">{error}</div>}

      {listing && !bulkJobId && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
            <span>
              {listing.username} — {filterText ? `${filteredPosts.length} of ${listing.posts.length}` : listing.posts.length}{" "}
              post{listing.posts.length === 1 ? "" : "s"}, {selected.size} selected
            </span>
            <div className="flex gap-2">
              <button onClick={selectAllVisible} className="rounded bg-slate-800 px-2 py-1 text-xs">
                Select all{filterText ? " shown" : ""}
              </button>
              <button onClick={selectNoneVisible} className="rounded bg-slate-800 px-2 py-1 text-xs">
                Select none{filterText ? " shown" : ""}
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="Filter posts by title…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="max-h-96 space-y-1 overflow-y-auto rounded border border-slate-800 p-2">
            {filteredPosts.length === 0 && (
              <div className="px-2 py-1 text-sm text-slate-500">No posts match "{filterText}".</div>
            )}
            {filteredPosts.map((post) => (
              <label
                key={post.postUrl}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  checked={selected.has(post.postUrl)}
                  onChange={() => toggle(post.postUrl)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1 truncate" title={post.title}>
                  {post.title}
                </span>
              </label>
            ))}
          </div>

          <button
            onClick={onDownload}
            disabled={selected.size === 0 || !effectiveRootId || startBulkDownload.isPending}
            className="w-full rounded bg-indigo-600 py-2 text-sm font-medium disabled:opacity-50"
          >
            {startBulkDownload.isPending ? "Starting…" : `Download ${selected.size} selected`}
          </button>
        </div>
      )}

      {bulkJobId && bulkLabel && <ImportJobPanel jobId={bulkJobId} label={bulkLabel} />}
    </div>
  );
}
