import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { Tag, TaggedTrack } from "../types";

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: () => api.get("/tags"),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Tag>("/tags", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: number) => api.delete(`/tags/${tagId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["tags-tracks"] });
      queryClient.invalidateQueries({ queryKey: ["file-tags"] });
    },
  });
}

export function useFileTags(fileId: number | undefined) {
  return useQuery<Tag[]>({
    queryKey: ["file-tags", fileId],
    queryFn: () => api.get(`/files/${fileId}/tags`),
    enabled: fileId !== undefined,
  });
}

export function useSetFileTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, tagIds }: { fileId: number; tagIds: number[] }) =>
      api.put<Tag[]>(`/files/${fileId}/tags`, { tagIds }),
    onSuccess: (_, { fileId }) => {
      queryClient.invalidateQueries({ queryKey: ["file-tags", fileId] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["tags-tracks"] });
      // Tags are also embedded (denormalized) into these listing endpoints' responses, so a
      // tag edit anywhere needs to invalidate every list that shows tags, not just the editor's
      // own file-tags query, or the stale tags linger until an unrelated refetch.
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["recent-files"] });
      queryClient.invalidateQueries({ queryKey: ["rated-files"] });
      queryClient.invalidateQueries({ queryKey: ["play-history"] });
    },
  });
}

export function useTracksByTags(tagIds: number[], mode: "all" | "any") {
  const key = [...tagIds].sort((a, b) => a - b).join(",");
  return useQuery<{ files: TaggedTrack[] }>({
    queryKey: ["tags-tracks", key, mode],
    queryFn: () => api.get(`/tags/tracks?tagIds=${key}&mode=${mode}`),
    enabled: tagIds.length > 0,
  });
}
