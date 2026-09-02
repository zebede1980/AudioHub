import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { ConvertibleFilesResponse, ConversionStatus } from "../types";

export function useConvertibleFiles() {
  return useQuery<ConvertibleFilesResponse>({
    queryKey: ["convertible-files"],
    queryFn: () => api.get("/convert/convertible-files"),
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
