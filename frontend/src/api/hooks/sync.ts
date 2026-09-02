import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";

export interface SyncConfig {
  remoteBaseUrl: string | null;
  remoteApiKeySet: boolean;
  minRating: number;
  ingestApiKey: string | null;
  ingestLibraryRootId: number | null;
}

export type SyncEntryStatus = "queued" | "in-progress" | "done" | "skipped" | "error";

export interface SyncPushEntry {
  fileId: number;
  relativePath: string;
  action: "upload" | "delete";
  status: SyncEntryStatus;
  error?: string;
}

export interface SyncJobState {
  status: "idle" | "running" | "done" | "error";
  entries: SyncPushEntry[];
  startedAt: number;
  finishedAt?: number;
}

export function useSyncConfig() {
  return useQuery<SyncConfig>({
    queryKey: ["sync-config"],
    queryFn: () => api.get("/sync/config"),
  });
}

export function useSaveSyncConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { remoteBaseUrl?: string; remoteApiKey?: string; minRating?: number }) =>
      api.put("/sync/config", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync-config"] }),
  });
}

export function useSaveIngestConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ingestLibraryRootId: number | null }) => api.put("/sync/ingest-config", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync-config"] }),
  });
}

export function useRegenerateIngestKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ingestApiKey: string }>("/sync/ingest-key/regenerate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync-config"] }),
  });
}

export function useTriggerSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncJobState>("/sync/run"),
    onSuccess: (data) => queryClient.setQueryData(["sync-status"], data),
  });
}

export function useSyncStatus(enabled: boolean) {
  return useQuery<SyncJobState>({
    queryKey: ["sync-status"],
    queryFn: () => api.get("/sync/status"),
    enabled,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
}
