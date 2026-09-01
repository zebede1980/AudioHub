import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { FolderDetail, FileDetail, SearchResultRow, FolderSearchResult } from "../types";

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

export function useSearch(q: string) {
  return useQuery<{ folders: FolderSearchResult[]; files: SearchResultRow[] }>({
    queryKey: ["search", q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}
