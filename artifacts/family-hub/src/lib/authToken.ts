import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Auth token storage for the native (Capacitor) app.
 *
 * On the web the app authenticates with same-origin session cookies, so there is
 * no token and every function here is a no-op (getToken returns null → no bearer
 * header is added, behavior unchanged). Inside the iOS app the webview can't use
 * the backend's cookies cross-origin, so we use a backend-issued mobile JWT
 * (see lib/nativeAuth.ts) stored durably in Preferences (UserDefaults).
 */

const KEY = "fh_auth_token";

// In-memory cache. `undefined` = not loaded yet; `null` = loaded, no token.
let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (!Capacitor.isNativePlatform()) {
    cached = null;
    return null;
  }
  try {
    const { value } = await Preferences.get({ key: KEY });
    cached = value ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Synchronous best-effort read (returns null until getToken has loaded once). */
export function getCachedToken(): string | null {
  return cached ?? null;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Preferences.set({ key: KEY, value: token });
  } catch {
    /* best effort */
  }
}

export async function clearToken(): Promise<void> {
  cached = null;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Preferences.remove({ key: KEY });
  } catch {
    /* best effort */
  }
}
