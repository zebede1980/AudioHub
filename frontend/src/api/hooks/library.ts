import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { LibraryRoot, ScanStatus, FolderSummary, RatedFile, RatedFolder, RecentFile } from "../types";

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
