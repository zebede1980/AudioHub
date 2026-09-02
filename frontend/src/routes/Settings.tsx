import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLibraryRoots,
  useCreateLibraryRoot,
  useDeleteLibraryRoot,
  useTriggerScan,
  useScanStatus,
  useRatedFiles,
  useDeleteRatedFiles,
  useRatedFolders,
  useDeleteRatedFolders,
} from "../api/hooks/library";
import {
  useConvertibleFiles,
  useStartConversion,
  useConversionStatus,
  useCancelConversion,
} from "../api/hooks/convert";
import { useLogout } from "../api/hooks/auth";
import {
  useSyncConfig,
  useSaveSyncConfig,
  useSaveIngestConfig,
  useRegenerateIngestKey,
  useTriggerSync,
  useSyncStatus,
} from "../api/hooks/sync";
import type { LibraryRoot } from "../api/types";

const BITRATE_OPTIONS = [96, 128, 192];
const CONCURRENCY_OPTIONS = [1, 2, 4];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function RootRow({ root }: { root: LibraryRoot }) {
  const triggerScan = useTriggerScan();
  const deleteRoot = useDeleteLibraryRoot();
  const [polling, setPolling] = useState(false);
  const { data: status } = useScanStatus(root.id, polling);

  async function onScan() {
    setPolling(true);
    await triggerScan.mutateAsync(root.id);
  }

  const isRunning = status?.status === "running";

  return (
    <div className="rounded-lg border border-slate-800 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{root.name}</div>
          <div className="truncate text-xs text-slate-500">{root.containerPath}</div>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <button
            onClick={onScan}
            disabled={isRunning}
            className="rounded bg-indigo-600 px-3 py-1 text-sm disabled:opacity-50"
          >
            {isRunning ? "Scanning…" : "Scan"}
          </button>
          <button
            onClick={() => {
              if (confirm(`Remove "${root.name}"? This deletes its scanned index (ratings included).`)) {
                deleteRoot.mutate(root.id);
              }
            }}
            className="rounded bg-red-900/50 px-3 py-1 text-sm text-red-300"
          >
            Remove
          </button>
        </div>
      </div>
      {status && (
        <div className="mt-2 text-xs text-slate-500">
          {status.status === "running" && status.progress
            ? `Scanning… ${status.progress.filesScanned} files seen`
            : status.status === "ok"
              ? `Last scan OK — ${status.result?.movedFiles ?? 0} moved, ${status.result?.deletedFiles ?? 0} removed`
              : status.status === "error"
                ? `Scan failed: ${status.error}`
                : null}
        </div>
      )}
    </div>
  );
}

function CleanupSection() {
  const { data: ratedFiles } = useRatedFiles();
  const oneStarFileCount = ratedFiles?.filter((f) => f.rating === 1).length ?? 0;
  const deleteFiles = useDeleteRatedFiles();
  const [fileResult, setFileResult] = useState<string | null>(null);

  const { data: ratedFolders } = useRatedFolders();
  const oneStarFolderCount = ratedFolders?.filter((f) => f.rating === 1).length ?? 0;
  const deleteFolders = useDeleteRatedFolders();
  const [folderResult, setFolderResult] = useState<string | null>(null);

  async function onDeleteFiles() {
    if (
      !confirm(
        `Permanently delete ${oneStarFileCount} file${oneStarFileCount === 1 ? "" : "s"} rated 1 star?\n\nThis deletes the actual audio files from disk and cannot be undone.`
      )
    ) {
      return;
    }
    setFileResult(null);
    try {
      const res = await deleteFiles.mutateAsync(1);
      setFileResult(`Deleted ${res.deletedCount} of ${res.total} file${res.total === 1 ? "" : "s"}.`);
    } catch (err) {
      setFileResult(err instanceof Error ? err.message : "Failed to delete files");
    }
  }

  async function onDeleteFolders() {
    if (
      !confirm(
        `Permanently delete ${oneStarFolderCount} folder${oneStarFolderCount === 1 ? "" : "s"} rated 1 star, and everything inside them?\n\nThis deletes the actual folders from disk and cannot be undone.`
      )
    ) {
      return;
    }
    setFolderResult(null);
    try {
      const res = await deleteFolders.mutateAsync(1);
      setFolderResult(`Deleted ${res.deletedCount} of ${res.total} folder${res.total === 1 ? "" : "s"}.`);
    } catch (err) {
      setFolderResult(err instanceof Error ? err.message : "Failed to delete folders");
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-slate-400">Cleanup</h2>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-4">
        <div className="min-w-0">
          <div className="text-sm">Delete all 1-star rated files</div>
          <div className="text-xs text-slate-500">
            {oneStarFileCount} file{oneStarFileCount === 1 ? "" : "s"} currently rated 1 star. This permanently
            removes them from disk, not just the rating.
          </div>
        </div>
        <button
          onClick={onDeleteFiles}
          disabled={oneStarFileCount === 0 || deleteFiles.isPending}
          className="shrink-0 rounded bg-red-900/50 px-3 py-1 text-sm text-red-300 disabled:opacity-50"
        >
          {deleteFiles.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>
      {fileResult && <div className="text-xs text-slate-400">{fileResult}</div>}

      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-4">
        <div className="min-w-0">
          <div className="text-sm">Delete all 1-star rated folders</div>
          <div className="text-xs text-slate-500">
            {oneStarFolderCount} folder{oneStarFolderCount === 1 ? "" : "s"} currently rated 1 star. This
            permanently removes the whole folder — and every file inside it — from disk.
          </div>
        </div>
        <button
          onClick={onDeleteFolders}
          disabled={oneStarFolderCount === 0 || deleteFolders.isPending}
          className="shrink-0 rounded bg-red-900/50 px-3 py-1 text-sm text-red-300 disabled:opacity-50"
        >
          {deleteFolders.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>
      {folderResult && <div className="text-xs text-slate-400">{folderResult}</div>}
    </section>
  );
}

function ConvertSection() {
  const queryClient = useQueryClient();
  const { data: sourceFiles } = useConvertibleFiles();
  const [bitrateKbps, setBitrateKbps] = useState(128);
  const [concurrency, setConcurrency] = useState(2);
  // Always fetched (cheap, single global endpoint) so a page refresh mid-batch still shows
  // progress; the query itself only keeps re-polling while status is running/cancelling.
  const { data: status } = useConversionStatus(true);
  const startConversion = useStartConversion();
  const cancelConversion = useCancelConversion();

  const isActive = status?.status === "running" || status?.status === "cancelling";

  useEffect(() => {
    if (status && (status.status === "done" || status.status === "cancelled")) {
      queryClient.invalidateQueries({ queryKey: ["convertible-files"] });
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    }
  }, [status?.status, queryClient]);

  async function onConvertAll() {
    if (!sourceFiles || sourceFiles.count === 0) return;
    if (
      !confirm(
        `Convert ${sourceFiles.count} file${sourceFiles.count === 1 ? "" : "s"} (${formatBytes(sourceFiles.totalBytes)}) to MP3 at ${bitrateKbps}kbps?\n\nEach original is deleted only after its MP3 is verified — ratings, play history, and playback position carry over.`
      )
    ) {
      return;
    }
    await startConversion.mutateAsync({ bitrateKbps, concurrency });
  }

  const files = status?.files ?? [];
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const bytesSaved = files
    .filter((f) => f.status === "done" && f.sizeBytesAfter !== undefined)
    .reduce((sum, f) => sum + (f.sizeBytesBefore - (f.sizeBytesAfter ?? 0)), 0);

  const extensionCounts = new Map<string, number>();
  for (const f of sourceFiles?.files ?? []) {
    extensionCounts.set(f.extension, (extensionCounts.get(f.extension) ?? 0) + 1);
  }
  const breakdown = [...extensionCounts.entries()]
    .map(([ext, n]) => `${n} ${ext.slice(1).toUpperCase()}`)
    .join(", ");

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-slate-400">Convert to MP3</h2>
      <div className="space-y-3 rounded-lg border border-slate-800 p-4">
        <div className="text-sm">
          {sourceFiles === undefined
            ? "Checking library…"
            : sourceFiles.count === 0
              ? "No WAV or FLAC files found."
              : `${breakdown} file${sourceFiles.count === 1 ? "" : "s"} found, totaling ${formatBytes(sourceFiles.totalBytes)}.`}
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Quality
            <select
              value={bitrateKbps}
              onChange={(e) => setBitrateKbps(Number(e.target.value))}
              disabled={isActive}
              className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-50"
            >
              {BITRATE_OPTIONS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {kbps} kbps
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Parallel conversions
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={isActive}
              className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-50"
            >
              {CONCURRENCY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onConvertAll}
            disabled={!sourceFiles || sourceFiles.count === 0 || isActive}
            className="rounded bg-indigo-600 px-3 py-1 text-sm disabled:opacity-50"
          >
            {isActive ? "Converting…" : `Convert all${sourceFiles?.count ? ` (${sourceFiles.count})` : ""}`}
          </button>
          {isActive && (
            <button
              onClick={() => cancelConversion.mutate()}
              disabled={status?.status === "cancelling"}
              className="rounded bg-red-900/50 px-3 py-1 text-sm text-red-300 disabled:opacity-50"
            >
              {status?.status === "cancelling" ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>

        {status && status.status !== "idle" && files.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-500">
              {doneCount}/{files.length} converted
              {errorCount > 0 ? `, ${errorCount} failed` : ""}
              {bytesSaved > 0 ? ` — ${formatBytes(bytesSaved)} freed so far` : ""}
            </div>
            {errorCount > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-400">
                {files
                  .filter((f) => f.status === "error")
                  .map((f) => (
                    <li key={f.fileId} className="truncate" title={f.error}>
                      {f.relativePath}: {f.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SyncSection() {
  const { data: roots } = useLibraryRoots();
  const { data: cfg } = useSyncConfig();
  const saveConfig = useSaveSyncConfig();
  const saveIngestConfig = useSaveIngestConfig();
  const regenerateKey = useRegenerateIngestKey();
  const triggerSync = useTriggerSync();
  const { data: status } = useSyncStatus(true);

  const [remoteBaseUrl, setRemoteBaseUrl] = useState("");
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [minRating, setMinRating] = useState(4);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (cfg) {
      setRemoteBaseUrl(cfg.remoteBaseUrl ?? "");
      setMinRating(cfg.minRating);
    }
  }, [cfg]);

  async function onSavePushConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaveMsg(null);
    try {
      await saveConfig.mutateAsync({ remoteBaseUrl, ...(remoteApiKey ? { remoteApiKey } : {}), minRating });
      setRemoteApiKey("");
      setSaveMsg("Saved.");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function onSyncNow() {
    setSyncError(null);
    try {
      await triggerSync.mutateAsync();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Failed to start sync");
    }
  }

  const isRunning = status?.status === "running";
  const entries = status?.entries ?? [];
  const doneCount = entries.filter((e) => e.status === "done").length;
  const errorEntries = entries.filter((e) => e.status === "error");
  const canSync = !!cfg?.remoteBaseUrl && cfg.remoteApiKeySet;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-slate-400">Cloud sync</h2>

      <div className="space-y-3 rounded-lg border border-slate-800 p-4">
        <div className="text-sm font-medium">Push to a cloud instance</div>
        <form onSubmit={onSavePushConfig} className="space-y-2">
          <input
            type="text"
            placeholder="https://audiohub.yourdomain.com"
            value={remoteBaseUrl}
            onChange={(e) => setRemoteBaseUrl(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password"
            placeholder={cfg?.remoteApiKeySet ? "API key set — leave blank to keep it" : "API key from the cloud instance"}
            value={remoteApiKey}
            onChange={(e) => setRemoteApiKey(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Minimum rating to sync
            <select
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
              className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200"
            >
              <option value={4}>4+ stars</option>
              <option value={5}>5 stars only</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saveConfig.isPending}
              className="rounded bg-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            >
              {saveConfig.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onSyncNow}
              disabled={!canSync || isRunning}
              className="rounded bg-indigo-600 px-3 py-1 text-sm disabled:opacity-50"
              title={canSync ? undefined : "Set a URL and API key first"}
            >
              {isRunning ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {saveMsg && <div className="text-xs text-slate-400">{saveMsg}</div>}
          {syncError && <div className="text-xs text-red-400">{syncError}</div>}
        </form>

        {status && status.status !== "idle" && (
          <div className="space-y-1">
            <div className="text-xs text-slate-500">
              {entries.length === 0 && status.status === "done"
                ? "Already up to date — nothing to push."
                : `${doneCount}/${entries.length} processed${errorEntries.length > 0 ? `, ${errorEntries.length} failed` : ""}`}
            </div>
            {errorEntries.length > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-400">
                {errorEntries.map((e) => (
                  <li key={`${e.fileId}-${e.action}`} className="truncate" title={e.error}>
                    {e.action === "delete" ? "remove " : ""}
                    {e.relativePath}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-800 p-4">
        <div className="text-sm font-medium">Accept pushes from a local instance</div>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Destination library folder
          <select
            value={cfg?.ingestLibraryRootId ?? ""}
            onChange={(e) =>
              saveIngestConfig.mutate({ ingestLibraryRootId: e.target.value ? Number(e.target.value) : null })
            }
            className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200"
          >
            <option value="">Not configured</option>
            {roots?.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <div className="text-xs text-slate-400">
            Ingest API key{cfg?.ingestApiKey ? "" : " — none generated yet"}
          </div>
          {cfg?.ingestApiKey && (
            <code className="block break-all rounded bg-slate-950 p-2 text-xs text-slate-300">
              {cfg.ingestApiKey}
            </code>
          )}
          <button
            onClick={() => {
              if (!cfg?.ingestApiKey || confirm("Generate a new key? The old one stops working immediately.")) {
                regenerateKey.mutate();
              }
            }}
            disabled={regenerateKey.isPending}
            className="rounded bg-slate-700 px-3 py-1 text-sm disabled:opacity-50"
          >
            {cfg?.ingestApiKey ? "Regenerate key" : "Generate key"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Enter this server's address and the key above into the "Push to a cloud instance" section
          on the other AudioHub instance.
        </p>
      </div>
    </section>
  );
}

export default function Settings() {
  const { data: roots } = useLibraryRoots();
  const createRoot = useCreateLibraryRoot();
  const logout = useLogout();
  const [name, setName] = useState("");
  const [containerPath, setContainerPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createRoot.mutateAsync({ name, containerPath });
      setName("");
      setContainerPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add folder");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={() => logout.mutate()} className="text-sm text-slate-400 underline">
          Sign out
        </button>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-400">Library folders</h2>
        {roots?.map((root) => <RootRow key={root.id} root={root} />)}
        {roots?.length === 0 && <div className="text-sm text-slate-500">No folders added yet.</div>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-400">Add a folder</h2>
        <form onSubmit={onAdd} className="space-y-2">
          <input
            type="text"
            placeholder="Display name (e.g. Audiobooks)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="Container path (e.g. /library/j/Audiobooks)"
            value={containerPath}
            onChange={(e) => setContainerPath(e.target.value)}
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-slate-500">
            Use the path as the <em>container</em> sees it, not the Windows path — forward
            slashes, and starting from the mount point in docker-compose.yml, not the drive
            letter. E.g. Windows <code className="text-slate-400">V:\Download\Audio</code> is{" "}
            <code className="text-slate-400">/library/v/Download/Audio</code> (currently mounted:
            J: → <code className="text-slate-400">/library/j</code>, V: →{" "}
            <code className="text-slate-400">/library/v</code>).
          </p>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={createRoot.isPending}
            className="rounded bg-indigo-600 px-4 py-2 text-sm disabled:opacity-50"
          >
            Add folder
          </button>
        </form>
      </section>

      <ConvertSection />
      <SyncSection />
      <CleanupSection />
    </div>
  );
}
