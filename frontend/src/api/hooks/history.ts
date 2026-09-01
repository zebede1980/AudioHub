import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";

export interface PlayHistoryEntry {
  historyId: number;
  playedAt: number;
  fileId: number;
  title: string | null;
  filename: string;
  durationSec: number | null;
  coverImagePath: string | null;
  folderId: number;
  folderName: string;
}

export function usePlayHistory() {
  return useQuery<PlayHistoryEntry[]>({
    queryKey: ["play-history"],
    queryFn: () => api.get("/history"),
  });
}

export function useClearPlayHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/history"),
    onSuccess: () => queryClient.setQueryData(["play-history"], []),
  });
}
