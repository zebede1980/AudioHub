import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, base64Utf8 } from "../client";
import type { FolderDetail, FileDetail, SearchResultRow, FolderSearchResult } from "../types";

export interface MergeCandidate {
  id: number;
  name: string;
  relativePath: string;
  fileCount: number;
}

export interface MergeResult {
  targetFolderId: number;
  movedFiles: number;
  movedSubfolders: number;
  movedOtherFiles: number;
  renamed: { from: string; to: string }[];
  strandedFiles: number;
}

export interface UploadResult {
  filename: string;
  relativePath: string;
  fileId: number | null;
  renamed: boolean;
}

export function useFolder(
  folderId: number | undefined,
  params?: { sort?: string; order?: string; page?: number; folderSort?: string }
) {
  const query = new URLSearchParams();
  if (params?.sort) query.set("sort", params.sort);
  if (params?.order) query.set("order", params.order);
  if (params?.page) query.set("page", String(params.page));
  if (params?.folderSort) query.set("folderSort", params.folderSort);
  const qs = query.toString();

  return useQuery<FolderDetail>({
    queryKey: ["folder", folderId, params],
    queryFn: () => api.get(`/folders/${folderId}${qs ? `?${qs}` : ""}`),
    enabled: folderId !== undefined,
  });
}

export function useFile(fileId: number | undefined) {
  return useQuery<FileDetail>({
    queryKey: ["file", fileId],
    queryFn: () => api.get(`/files/${fileId}`),
    enabled: fileId !== undefined,
  });
}

/** Folders that could be merged into `targetFolderId` — the target and its ancestors are excluded. */
export function useMergeCandidates(targetFolderId: number | undefined, q: string, enabled: boolean) {
  return useQuery<MergeCandidate[]>({
    queryKey: ["merge-candidates", targetFolderId, q],
    queryFn: () => api.get(`/folders/search?targetId=${targetFolderId}&q=${encodeURIComponent(q)}`),
    enabled: enabled && targetFolderId !== undefined,
  });
}

export function useMergeFolders(targetFolderId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation<MergeResult, Error, number>({
    mutationFn: (sourceFolderId) => api.post(`/folders/${targetFolderId}/merge`, { sourceFolderId }),
    onSuccess: () => {
      // A merge changes the target's contents, the source's existence, and both parents' listings,
      // so nothing folder-shaped can be assumed current afterwards.
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
      queryClient.invalidateQueries({ queryKey: ["merge-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

export function useSetFolderSourceUrl(folderId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation<{ sourceUrl: string | null }, Error, string | null>({
    mutationFn: (sourceUrl) => api.put(`/folders/${folderId}/source-url`, { sourceUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
    },
  });
}

export function useUploadToFolder(folderId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation<UploadResult, Error, File>({
    mutationFn: (file) =>
      api.postBinary(`/folders/${folderId}/upload`, file, { "X-Upload-Filename": base64Utf8(file.name) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
    },
  });
}

export function useSearch(q: string) {
  return useQuery<{ folders: FolderSearchResult[]; files: SearchResultRow[] }>({
    queryKey: ["search", q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}
