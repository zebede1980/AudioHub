import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../client";

interface SessionResponse {
  username: string;
}

export function useSession() {
  return useQuery<SessionResponse | null>({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        return await api.get<SessionResponse>("/auth/session");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api.post<SessionResponse>("/auth/login", credentials),
    onSuccess: (data) => {
      queryClient.setQueryData(["auth", "session"], data);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "session"], null);
      queryClient.clear();
    },
  });
}
