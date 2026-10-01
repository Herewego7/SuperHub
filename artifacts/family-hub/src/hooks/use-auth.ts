import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { User } from "@workspace/shared-types";
import { apiUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authToken";
import { isNativeAuth } from "@/lib/nativeAuth";
import { clearToken } from "@/lib/authToken";
import { performLogout } from "@/lib/logoutSequence";
import { clearTenantState } from "@/lib/clearTenantState";

async function fetchUser(): Promise<User | null> {
  // On native, authenticate with the bearer token; on web, with the session cookie.
  const token = await getToken();
  const response = await fetch(apiUrl("/api/auth/user"), {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Tell the server to end this device's session.
 *
 * Sign-in sets a session cookie as well as returning a bearer token, and the
 * app sends that cookie on every request. Without this call the cookie kept
 * authenticating after sign-out and put the person straight back in — see
 * lib/logoutSequence.ts. Best-effort: offline is no reason to refuse to sign
 * out, so a failure is swallowed and the local sign-out carries on.
 */
async function endServerSession(): Promise<void> {
  try {
    const token = await getToken();
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    /* offline or the server asleep — sign out locally regardless */
  }
}

async function logout(queryClient: QueryClient): Promise<void> {
  // ⚠️ The ORDER of these steps is the entire correctness of sign-out, and it
  // lives in lib/logoutSequence.ts with the reasoning and its test. The
  // previous version cleared the cache before dropping the token, which
  // refetched the user WITH a valid token and signed the person straight back
  // in — a sign-out button that did nothing (2026-09-30).
  //
  // Clearing still happens before any new identity can exist, which is what
  // the old comment here was protecting; dropping the credential first does
  // not weaken that, it just ends the session before anything can use it.
  await performLogout({
    isNative: isNativeAuth(),
    endServerSession: endServerSession,
    dropToken: () => clearToken(),
    cancelQueries: () => queryClient.cancelQueries(),
    clearTenant: () => clearTenantState(queryClient),
    markSignedOut: () => queryClient.setQueryData(["/api/auth/user"], null),
    redirectWeb: () => { window.location.href = "/api/logout"; },
    // Native sign-out ends in a fresh start — see lib/logoutSequence.ts for
    // why an in-place update was not enough.
    reload: () => { window.location.reload(); },
  });
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(queryClient),
    onSuccess: () => {
      // clearTenantState already emptied the cache; this makes "signed out"
      // the explicit answer rather than "not fetched yet", so the app routes
      // to the login screen instead of flashing a loading state.
      queryClient.setQueryData(["/api/auth/user"], null);
    },
    onError: () => {
      // The clearing already happened. Land on signed-out regardless, rather
      // than leaving someone in a half-signed-out app with no data.
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  // A switch that did not go through Sign Out is handled BEFORE the app
  // mounts, by useAccountSwitchGate in App.tsx. It used to run here, after
  // the new account's data had already started loading, and its cache wipe
  // made every sign-in as a different account load everything twice
  // (2026-09-30: ~1 minute instead of a few seconds).

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
