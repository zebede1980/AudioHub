import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../client";
import type { Transcript, TranscriptionStatus } from "../types";

export function useTranscript(fileId: number | undefined) {
  return useQuery<Transcript | null>({
    queryKey: ["transcript", fileId],
    queryFn: async () => {
      try {
        return await api.get<Transcript>(`/files/${fileId}/transcript`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: fileId !== undefined,
  });
}

export function useTranscribeFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) => api.post<{ status: string }>(`/files/${fileId}/transcribe`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transcription-status"] }),
  });
}

export function useTranscribeFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: number) => api.post<{ status: string }>(`/folders/${folderId}/transcribe`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transcription-status"] }),
  });
}

export function useDeleteTranscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) => api.delete(`/files/${fileId}/transcript`),
    onSuccess: (_data, fileId) => queryClient.invalidateQueries({ queryKey: ["transcript", fileId] }),
  });
}

export function useTranscriptionStatus(enabled: boolean) {
  return useQuery<TranscriptionStatus>({
    queryKey: ["transcription-status"],
    queryFn: () => api.get("/transcribe/status"),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "downloading-model" || status === "running" || status === "cancelling" ? 1000 : false;
    },
  });
}

export function useCancelTranscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>("/transcribe/cancel"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transcription-status"] }),
  });
}
