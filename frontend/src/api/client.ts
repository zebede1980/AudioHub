const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    // Only set Content-Type when there's an actual body — Fastify's JSON parser rejects a
    // request that declares application/json but sends an empty body (e.g. a bodyless POST
    // like triggering a scan, logging out, or deleting a rating).
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  const body = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const message = (body && typeof body === "object" && "error" in body ? String(body.error) : null) ?? res.statusText;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function fileStreamUrl(fileId: number): string {
  return `${BASE}/files/${fileId}/stream`;
}
export function fileCoverUrl(fileId: number): string {
  return `${BASE}/files/${fileId}/cover`;
}
export function folderCoverUrl(folderId: number): string {
  return `${BASE}/folders/${folderId}/cover`;
}
