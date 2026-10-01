import { Capacitor } from "@capacitor/core";

/**
 * API base URL resolution for web vs. native (Capacitor) builds.
 *
 * On the web, the app is served from the same origin as the API, so requests use
 * relative paths ("/api/...") and rely on same-origin cookies. Inside a Capacitor
 * iOS app the webview runs at `capacitor://localhost`, which is NOT the backend
 * origin — relative paths would resolve against the local bundle and fail. There
 * we must prefix requests with the real backend origin.
 *
 * The native origin is provided at build time via VITE_API_BASE_URL. On the web
 * build (or if the var is unset) this module is a no-op and behavior is unchanged.
 */
const NATIVE_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "")
  .toString()
  .replace(/\/+$/, "");

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Resolve a request path/URL to its absolute form when running natively.
 * - Already-absolute URLs (http/https) are returned unchanged.
 * - On web, or when no native base is configured, the path is returned unchanged.
 * - On native with a configured base, the base origin is prepended.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!Capacitor.isNativePlatform() || !NATIVE_API_BASE) return path;
  return path.startsWith("/")
    ? `${NATIVE_API_BASE}${path}`
    : `${NATIVE_API_BASE}/${path}`;
}

/**
 * Resolve a stored object path (e.g. "/objects/uploads/uuid") to an absolute
 * URL on native. On web the path works as-is (same origin). On native the
 * Capacitor WebView runs at capacitor://localhost so relative paths never reach
 * the backend — prefix with the API base URL.
 */
export function objectUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return apiUrl(path);
}
