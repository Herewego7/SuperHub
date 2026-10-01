import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authToken";

// On native (Capacitor) the app authenticates with a backend-issued mobile JWT
// instead of session cookies, so attach it as a bearer token. On web getToken()
// returns null and no header is added (behavior unchanged).
async function authHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Try to extract a clean message from JSON error bodies. Backend routes
    // are split between `{ message }` and `{ error }` response shapes — read
    // both so the user sees the intended sentence instead of raw JSON like
    // `{"error":"..."}` in a toast.
    try {
      const json = JSON.parse(text);
      const clean = json?.message ?? json?.error;
      if (typeof clean === "string" && clean) {
        const err = new Error(clean);
        // Some routes (e.g. recipe import) attach an optional machine-
        // readable `code` alongside the human message — carry it onto the
        // Error object so a caller CAN branch on it, without requiring every
        // other route to add one. Harmless no-op for routes that don't.
        if (typeof json?.code === "string") (err as any).code = json.code;
        throw err;
      }
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
    }
    throw new Error(text || `Request failed (${res.status})`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: await authHeaders(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(apiUrl(queryKey.join("/") as string), {
      headers: await authHeaders(),
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // Revalidate when the user returns to the app (e.g. switching back to
      // the tab on an iPad) or the network reconnects, so data created on
      // another device shows up without a full page reload. Data is treated
      // as fresh for 30s to avoid hammering the server during normal use.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
