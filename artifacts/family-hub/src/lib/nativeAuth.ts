import { Capacitor } from "@capacitor/core";
import { setToken, clearToken, getToken } from "@/lib/authToken";
import { queryClient } from "@/lib/queryClient";
import { WebAuth } from "@/lib/webAuth";

/**
 * Native (Capacitor) authentication.
 *
 * The web app signs in with Replit OIDC via same-origin session cookies. That
 * doesn't work inside the iOS webview, so on native we use ASWebAuthenticationSession
 * (via WebAuthPlugin) which is Apple's dedicated OAuth browser:
 *
 *   1. Call WebAuth.authenticate({ url: loginUrl, callbackScheme: "familyhub" })
 *   2. ASWebAuthenticationSession opens, user logs in via Replit OIDC
 *   3. Backend issues a JWT and redirects to familyhub://auth?token=<JWT>
 *   4. iOS intercepts the familyhub:// scheme and passes the URL to the plugin's
 *      completion handler (no separate appUrlOpen listener needed)
 *   5. We store the JWT and it's sent as a bearer token on every API request.
 *
 * ASWebAuthenticationSession is used instead of SFSafariViewController because
 * SFSafariViewController partitions sessionStorage per navigation, which breaks
 * Replit's OIDC "state" check mid-flow.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").toString().replace(/\/+$/, "");
const CALLBACK_SCHEME = "familyhub";
const REDIRECT = `${CALLBACK_SCHEME}://auth`;

export function isNativeAuth(): boolean {
  return Capacitor.isNativePlatform();
}

function extractToken(url: string): string | null {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return null;
  try {
    const params = new URLSearchParams(url.slice(qIndex + 1));
    return params.get("token");
  } catch {
    return null;
  }
}

/** Prime the in-memory token cache at app boot. No-op on web. */
export async function initNativeAuth(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await getToken();
}

/** Begin the OAuth flow via ASWebAuthenticationSession. Throws on web. */
export async function nativeLogin(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Native login is only available in the app");
  }
  if (!API_BASE) {
    throw new Error("VITE_API_BASE_URL must be set for the native app to sign in");
  }

  const loginUrl = `${API_BASE}/api/login?redirect=${encodeURIComponent(REDIRECT)}`;

  // ASWebAuthenticationSession handles the entire OAuth round-trip and returns
  // the final redirect URL (familyhub://auth?token=...) directly.
  const { url: callbackUrl } = await WebAuth.authenticate({
    url: loginUrl,
    callbackScheme: CALLBACK_SCHEME,
  });

  const token = extractToken(callbackUrl);
  if (!token) {
    throw new Error(`No token in callback URL: ${callbackUrl}`);
  }

  await setToken(token);
  await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
}

/** Clear the stored token and refresh auth state. No-op on web. */
export async function nativeLogout(): Promise<void> {
  await clearToken();
  await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
}
