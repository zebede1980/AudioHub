import { useState } from "react";
import { useSyncConfig, useSyncStatus, useTriggerSync } from "../api/hooks/sync";

/** Only renders once a push target is configured (Settings -> Cloud sync) — stays out of the way
 * on instances that don't push anywhere, including a typical cloud/ingest-only instance. */
export default function SyncButton() {
  const { data: cfg } = useSyncConfig();
  const { data: status } = useSyncStatus(true);
  const triggerSync = useTriggerSync();
  const [error, setError] = useState<string | null>(null);

  if (!cfg?.remoteBaseUrl || !cfg.remoteApiKeySet) return null;

  const isRunning = status?.status === "running" || triggerSync.isPending;
  const entries = status?.entries ?? [];
  const doneCount = entries.filter((e) => e.status === "done").length;
  const errorCount = entries.filter((e) => e.status === "error").length;

  async function onClick() {
    setError(null);
    try {
      await triggerSync.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sync");
    }
  }

  const title = error
    ? error
    : status?.status === "done"
      ? entries.length === 0
        ? "Already up to date"
        : `Last sync: ${doneCount} done${errorCount ? `, ${errorCount} failed` : ""}`
      : "Push top-rated files to your cloud instance";

  return (
    <button
      onClick={onClick}
      disabled={isRunning}
      title={title}
      className={`shrink-0 rounded px-3 py-1 text-sm disabled:opacity-50 ${
        error ? "bg-red-900/50 text-red-300" : "bg-slate-800 text-slate-300"
      }`}
    >
      {isRunning ? "☁️ Syncing…" : error ? "⚠️ Sync failed" : "☁️ Sync"}
    </button>
  );
}
