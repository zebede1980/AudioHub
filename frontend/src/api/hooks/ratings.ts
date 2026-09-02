import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { usePlayerStore } from "../../player/usePlayerStore";

// Rating is embedded (denormalized) into all of these listing endpoints' responses, so any change
// needs to invalidate every one of them, not just the query the edit happened to be made from.
function invalidateFileRatingConsumers(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["folder"] });
  queryClient.invalidateQueries({ queryKey: ["file"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["rated-files"] });
  queryClient.invalidateQueries({ queryKey: ["recent-files"] });
  queryClient.invalidateQueries({ queryKey: ["play-history"] });
  queryClient.invalidateQueries({ queryKey: ["tags-tracks"] });
}

function invalidateFolderRatingConsumers(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["folder"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["rated-folders"] });
  // The delete-review screen is a filtered view of folder ratings: clearing a folder's 1 star is
  // exactly how a user takes it off that list, so it has to refetch too.
  queryClient.invalidateQueries({ queryKey: ["folders-review"] });
}

export function useSetRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, rating }: { fileId: number; rating: number }) =>
      api.put(`/files/${fileId}/rating`, { rating }),
    onSuccess: (_, { fileId, rating }) => {
      invalidateFileRatingConsumers(queryClient);
      usePlayerStore.getState().setCurrentFileRating(fileId, rating);
    },
  });
}

export function useClearRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) => api.delete(`/files/${fileId}/rating`),
    onSuccess: (_, fileId) => {
      invalidateFileRatingConsumers(queryClient);
      usePlayerStore.getState().setCurrentFileRating(fileId, null);
    },
  });
}

export function useSetFolderRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, rating }: { folderId: number; rating: number }) =>
      api.put(`/folders/${folderId}/rating`, { rating }),
    onSuccess: () => invalidateFolderRatingConsumers(queryClient),
  });
}

export function useClearFolderRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: number) => api.delete(`/folders/${folderId}/rating`),
    onSuccess: () => invalidateFolderRatingConsumers(queryClient),
  });
}
