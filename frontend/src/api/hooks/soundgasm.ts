import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { FileRow } from "../types";

export interface SoundgasmPost {
  title: string;
  postUrl: string;
  /** Set by the profile listing: a file this post would save as is already in the library. */
  alreadyInLibrary?: boolean;
}

export interface SoundgasmListResult {
  username: string;
  posts: SoundgasmPost[];
}

export type DownloadItemStatus = "pending" | "downloading" | "done" | "skipped" | "error";

export interface DownloadItem {
  title: string;
  postUrl: string;
  status: DownloadItemStatus;
  error?: string;
}

export interface DownloadJobState {
  id: string;
  status: "running" | "ok" | "error";
  libraryRootId: number;
  destDir: string;
  items: DownloadItem[];
  startedAt: number;
  finishedAt?: number;
}

export function useListSoundgasmPosts() {
  return useMutation({
    mutationFn: (profileUrl: string) => api.post<SoundgasmListResult>("/scrape/soundgasm/list", { profileUrl }),
  });
}

export function useResolveSoundgasmPost() {
  return useMutation({
    mutationFn: (postUrl: string) =>
      api.post<{ username: string; post: SoundgasmPost }>("/scrape/soundgasm/resolve-post", { postUrl }),
  });
}

export function useStartSoundgasmDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { libraryRootId: number; username: string; posts: SoundgasmPost[] }) =>
      api.post<{ jobId: string }>("/scrape/soundgasm/download", input),
    onSuccess: () => {
      // The download job finishes with a library rescan, whose result these queries reflect.
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["root-folder"] });
    },
  });
}

export function useRetrySoundgasmDownload(jobId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postUrls?: string[]) =>
      api.post<DownloadJobState>(`/scrape/soundgasm/download/${jobId}/retry`, { postUrls }),
    onSuccess: (data) => {
      queryClient.setQueryData(["soundgasm-download-status", jobId], data);
    },
  });
}

export function useSoundgasmDownloadStatus(jobId: string | undefined) {
  return useQuery<DownloadJobState>({
    queryKey: ["soundgasm-download-status", jobId],
    queryFn: () => api.get(`/scrape/soundgasm/download-status/${jobId}`),
    enabled: jobId !== undefined,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
}

/**
 * The library rows for just the files this job imported. Preferred over the destination folder's
 * listing for the post-import summary: that folder may already hold hundreds of tracks and is
 * paginated, so a newly imported file can be missing from it entirely.
 */
export function useSoundgasmDownloadFiles(jobId: string | undefined, enabled: boolean) {
  return useQuery<{ files: FileRow[] }>({
    queryKey: ["soundgasm-download-files", jobId],
    queryFn: () => api.get(`/scrape/soundgasm/download/${jobId}/files`),
    enabled: enabled && jobId !== undefined,
  });
}

export function useSoundgasmDownloadFolder(jobId: string | undefined, enabled: boolean) {
  return useQuery<{ folderId: number }>({
    queryKey: ["soundgasm-download-folder", jobId],
    queryFn: () => api.get(`/scrape/soundgasm/download/${jobId}/folder`),
    enabled: enabled && jobId !== undefined,
    // The library rescan that creates this folder record runs after the job finishes and can lag
    // behind on a slow/network-mounted library root, so keep retrying well past a few seconds
    // rather than giving up and leaving the link permanently unclickable.
    retry: 20,
    retryDelay: 1500,
  });
}
