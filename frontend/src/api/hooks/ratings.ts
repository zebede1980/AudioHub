import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { usePlayerStore } from "../../player/usePlayerStore";

export function useSetRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, rating }: { fileId: number; rating: number }) =>
      api.put(`/files/${fileId}/rating`, { rating }),
    onSuccess: (_, { fileId, rating }) => {
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["file"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      usePlayerStore.getState().setCurrentFileRating(fileId, rating);
    },
  });
}

export function useSetFolderRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, rating }: { folderId: number; rating: number }) =>
      api.put(`/folders/${folderId}/rating`, { rating }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folder"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });
}
