import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../client";
import type { LibraryRoot, ScanStatus, FolderSummary, RatedFile, RatedFolder, RecentFile, RandomFile } from "../types";

export function useLibraryRoots() {
  return useQuery<LibraryRoot[]>({
    queryKey: ["library-roots"],
    queryFn: () => api.get("/library-roots"),
  });
}

export function useCreateLibraryRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; containerPath: string }) => api.post<LibraryRoot>("/library-roots", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library-roots"] }),
  });
}

export function useDeleteLibraryRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/library-roots/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library-roots"] }),
  });
}

export function useTriggerScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ status: string }>(`/library-roots/${id}/scan`),
    onSuccess: (_data, id) => queryClient.invalidateQueries({ queryKey: ["scan-status", id] }),
  });
}

export function useScanStatus(id: number | undefined, enabled: boolean) {
  return useQuery<ScanStatus>({
    queryKey: ["scan-status", id],
    queryFn: () => api.get(`/library-roots/${id}/scan-status`),
    enabled: enabled && id !== undefined,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
}

export function useRootFolder(rootId: number | undefined) {
  return useQuery<FolderSummary>({
    queryKey: ["root-folder", rootId],
    queryFn: () => api.get(`/library-roots/${rootId}/root-folder`),
    enabled: rootId !== undefined,
    retry: false,
  });
}

export function useRatedFiles() {
  return useQuery<RatedFile[]>({
    queryKey: ["rated-files"],
    queryFn: () => api.get("/files/rated"),
  });
}

export function useDeleteRatedFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rating: number) => api.delete<{ deletedCount: number; total: number }>(`/files/rated/${rating}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rated-files"] });
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

export function useRecentFiles() {
  return useQuery<RecentFile[]>({
    queryKey: ["recent-files"],
    queryFn: () => api.get("/files/recent"),
  });
}

// Exported so consumers can patch this exact cache entry (e.g. a rating just set from the list)
// without invalidating it — invalidating would trigger a refetch, and since this query is
// non-deterministic (ORDER BY RANDOM() server-side), that would reshuffle the batch the user is
// currently looking at instead of just updating one row's rating in place.
export function randomFilesQueryKey(limit: number, includeRated: boolean): QueryKey {
  return ["random-files", limit, includeRated];
}

export function useRandomFiles(limit: number, includeRated: boolean) {
  return useQuery<RandomFile[]>({
    queryKey: randomFilesQueryKey(limit, includeRated),
    queryFn: () => api.get(`/files/random?limit=${limit}&includeRated=${includeRated}`),
  });
}

export function useRatedFolders() {
  return useQuery<RatedFolder[]>({
    queryKey: ["rated-folders"],
    queryFn: () => api.get("/folders/rated"),
  });
}

export function useDeleteRatedFolders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rating: number) => api.delete<{ deletedCount: number; total: number }>(`/folders/rated/${rating}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rated-folders"] });
      queryClient.invalidateQueries({ queryKey: ["rated-files"] });
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}
