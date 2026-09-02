import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { TrashListing } from "../types";

export function useTrash() {
  return useQuery<TrashListing>({
    queryKey: ["trash"],
    queryFn: () => api.get("/trash"),
  });
}

/** A restore moves the folder back and triggers a rescan, so everything that lists library
 * content has to be refetched — including the review screen, which the folder may rejoin. */
function invalidateTrashConsumers(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["trash"] });
  queryClient.invalidateQueries({ queryKey: ["folder"] });
  queryClient.invalidateQueries({ queryKey: ["root-folder"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["rated-folders"] });
  queryClient.invalidateQueries({ queryKey: ["folders-review"] });
}

export function useRestoreTrashEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ restoredRelativePath: string; renamed: boolean }>(`/trash/${id}/restore`),
    onSuccess: () => invalidateTrashConsumers(queryClient),
  });
}

export function usePurgeTrashEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/trash/${id}`),
    onSuccess: () => invalidateTrashConsumers(queryClient),
  });
}

export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ purgedCount: number }>("/trash"),
    onSuccess: () => invalidateTrashConsumers(queryClient),
  });
}
