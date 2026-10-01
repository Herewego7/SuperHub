import type { Request } from "express";

// Resolves the web app's actual public origin — used anywhere a server-sent
// email needs a link back into the app (password reset, family invites).
// Links always open in a real browser (even a native Mail app link opens
// Safari, not the Capacitor webview), so this must point at the real
// deployment origin, not whatever origin the *triggering* API request
// happened to arrive on.
export function resolvePublicBaseUrl(req: Request): string {
  if (process.env.PASSWORD_RESET_BASE_URL) {
    return process.env.PASSWORD_RESET_BASE_URL.replace(/\/+$/, "");
  }
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const host = replitDomain || req.hostname;
  return `${req.protocol}://${host}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}
