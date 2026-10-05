const DAY_MS = 24 * 60 * 60 * 1000;
export const INBOX_SCAN_KEY = "superhub_inbox_scan_until";

/** The first connection starts a one-day window. A later scan does not restart it. */
export function nextInboxScanUntil(existing: number | null, now: number, reset: boolean): number {
  if (!reset && existing != null) return existing;
  return now + DAY_MS;
}

export function inboxScanOpen(until: number | null, now: number): boolean {
  return until != null && until > now;
}

export function noteInboxScan(reset = false, now = Date.now()) {
  if (typeof localStorage === "undefined") return;
  const raw = Number(localStorage.getItem(INBOX_SCAN_KEY) || "");
  const existing = Number.isFinite(raw) && raw > 0 ? raw : null;
  const until = nextInboxScanUntil(existing, now, reset);
  localStorage.setItem(INBOX_SCAN_KEY, String(until));
  window.dispatchEvent(new Event("superhub-inbox-scan"));
}

export function readInboxScanOpen(now = Date.now()): boolean {
  if (typeof localStorage === "undefined") return false;
  const until = Number(localStorage.getItem(INBOX_SCAN_KEY) || "");
  return inboxScanOpen(Number.isFinite(until) ? until : null, now);
}
