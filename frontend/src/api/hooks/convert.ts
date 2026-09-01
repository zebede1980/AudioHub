import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { WavFilesResponse, ConversionStatus } from "../types";

export function useWavFiles() {
  return useQuery<WavFilesResponse>({
    queryKey: ["wav-files"],
    queryFn: () => api.get("/convert/wav-files"),
  });
}

export function useStartConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fileIds?: number[]; bitrateKbps: number; concurrency: number }) =>
      api.post<{ status: string }>("/convert/start", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversion-status"] }),
  });
}

export function useConversionStatus(enabled: boolean) {
  return useQuery<ConversionStatus>({
    queryKey: ["conversion-status"],
    queryFn: () => api.get("/convert/status"),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.data?.status === "cancelling" ? 1000 : false,
  });
}

export function useCancelConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>("/convert/cancel"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversion-status"] }),
  });
}
