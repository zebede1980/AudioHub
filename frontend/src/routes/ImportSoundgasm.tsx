import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useLibraryRoots } from "../api/hooks/library";
import {
  useListSoundgasmPosts,
  useResolveSoundgasmPost,
  useResolveDownloadedFile,
  useRetrySoundgasmDownload,
  useStartSoundgasmDownload,
  useSoundgasmDownloadStatus,
  useSoundgasmDownloadFolder,
  type SoundgasmPost,
} from "../api/hooks/soundgasm";
import { usePlayerStore } from "../player/usePlayerStore";
import type { FileDetail } from "../api/types";

const AUTO_SELECT_THRESHOLD = 10;

const STATUS_STYLE: Record<string, string> = {
  pending: "text-slate-500",
  downloading: "text-indigo-400",
  done: "text-emerald-400",
  skipped: "text-slate-500",
  error: "text-red-400",
};

export default function ImportSoundgasm() {
  const [profileUrl, setProfileUrl] = useState("");
  const [listing, setListing] = useState<{ username: string; posts: SoundgasmPost[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [libraryRootId, setLibraryRootId] = useState<number | undefined>(undefined);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [manualPostUrl, setManualPostUrl] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const { data: roots } = useLibraryRoots();
  const list = useListSoundgasmPosts();
  const resolvePost = useResolveSoundgasmPost();
  const startDownload = useStartSoundgasmDownload();
  const job = useSoundgasmDownloadStatus(jobId);
  const retry = useRetrySoundgasmDownload(jobId);
  const resolveFile = useResolveDownloadedFile(jobId);
  const play = usePlayerStore((s) => s.play);
  const folderLink = useSoundgasmDownloadFolder(jobId, job.data !== undefined && job.data.status !== "running");

  const effectiveRootId = libraryRootId ?? roots?.[0]?.id;

  const filteredPosts =
    listing?.posts.filter((p) => p.title.toLowerCase().includes(filterText.trim().toLowerCase())) ?? [];

  async function onList(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setListing(null);
    setJobId(undefined);
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

  async function onAddManualPost(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    try {
      const { username, post } = await resolvePost.mutateAsync(manualPostUrl);
      if (listing && listing.username.toLowerCase() !== username.toLowerCase()) {
        setManualError(
          `This post belongs to "${username}", not the currently loaded profile "${listing.username}" — list that profile first.`
        );
        return;
      }
      setListing((prev) =>
        prev
          ? { ...prev, posts: prev.posts.some((p) => p.postUrl === post.postUrl) ? prev.posts : [...prev.posts, post] }
          : { username, posts: [post] }
      );
      setSelected((prev) => new Set(prev).add(post.postUrl));
      setJobId(undefined);
      setManualPostUrl("");
    } catch (err) {
      setManualError(err instanceof ApiError ? err.message : "Failed to resolve post");
    }
  }

  async function onPlayItem(postUrl: string) {
    setPlayError(null);
    setPlayingUrl(postUrl);
    try {
      const { fileId } = await resolveFile.mutateAsync(postUrl);
      const file = await api.get<FileDetail>(`/files/${fileId}`);
      play(file);
    } catch (err) {
      setPlayError(err instanceof ApiError ? err.message : "Failed to play");
    } finally {
      setPlayingUrl(null);
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
      const { jobId: id } = await startDownload.mutateAsync({
        libraryRootId: effectiveRootId,
        username: listing.username,
        posts,
      });
      setJobId(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start download");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <h1 className="text-lg font-semibold">Import from Soundgasm</h1>

      <form onSubmit={onList} className="flex gap-2">
        <input
          type="text"
          placeholder="https://soundgasm.net/u/username"
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

      <form onSubmit={onAddManualPost} className="flex gap-2">
        <input
          type="text"
          placeholder="https://soundgasm.net/u/username/post-title (for posts missing from the list above)"
          value={manualPostUrl}
          onChange={(e) => setManualPostUrl(e.target.value)}
          className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={resolvePost.isPending || !manualPostUrl}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {resolvePost.isPending ? "Adding…" : "Add post"}
        </button>
      </form>
      {manualError && <div className="text-sm text-red-400">{manualError}</div>}

      {listing && !jobId && (
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

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-400">Save to</label>
            <select
              value={effectiveRootId ?? ""}
              onChange={(e) => setLibraryRootId(Number(e.target.value))}
              className="rounded bg-slate-800 px-2 py-1 text-sm"
            >
              {roots?.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              → Soundgasm/{listing.username}
            </span>
          </div>

          <button
            onClick={onDownload}
            disabled={selected.size === 0 || !effectiveRootId || startDownload.isPending}
            className="w-full rounded bg-indigo-600 py-2 text-sm font-medium disabled:opacity-50"
          >
            {startDownload.isPending ? "Starting…" : `Download ${selected.size} selected`}
          </button>
        </div>
      )}

      {job.data && (
        <div className="space-y-2">
          {(() => {
            const failedItems = job.data.items.filter((i) => i.status === "error");
            const busy = job.data.status === "running" || retry.isPending;
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
                  <span>
                    {job.data.status === "running"
                      ? "Downloading…"
                      : job.data.status === "ok"
                        ? "Done."
                        : "Job failed."}{" "}
                    {job.data.items.filter((i) => i.status === "done" || i.status === "skipped").length} /{" "}
                    {job.data.items.length} processed
                    {failedItems.length > 0 ? `, ${failedItems.length} failed` : ""}
                    {" — "}
                    {folderLink.data ? (
                      <Link to={`/library/folder/${folderLink.data.folderId}`} className="text-indigo-400 hover:underline">
                        Soundgasm/{listing?.username}
                      </Link>
                    ) : (
                      <span>Soundgasm/{listing?.username}</span>
                    )}
                  </span>
                  {failedItems.length > 0 && (
                    <button
                      onClick={() => retry.mutate(undefined)}
                      disabled={busy}
                      className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium disabled:opacity-50"
                    >
                      Retry all failed ({failedItems.length})
                    </button>
                  )}
                </div>
                {playError && <div className="text-xs text-red-400">{playError}</div>}
                <div className="max-h-96 space-y-1 overflow-y-auto rounded border border-slate-800 p-2 text-sm">
                  {job.data.items.map((item) => (
                    <div key={item.postUrl} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate" title={item.title}>
                        {item.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={`text-xs ${STATUS_STYLE[item.status]}`} title={item.error}>
                          {item.status}
                        </span>
                        {(item.status === "done" || item.status === "skipped") && (
                          <button
                            onClick={() => onPlayItem(item.postUrl)}
                            disabled={playingUrl === item.postUrl}
                            className="rounded bg-slate-800 px-2 py-0.5 text-xs disabled:opacity-50"
                          >
                            {playingUrl === item.postUrl ? "…" : "▶ Play"}
                          </button>
                        )}
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
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
