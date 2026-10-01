// ── Celebration snoozes ──────────────────────────────────────────────────────
// Dismissing a celebration used to hide it for the REST OF THE YEAR: one tap
// on day 7 and you never saw it again, including the day before and the day
// itself — the two reminders people most want. The button was doing "handled
// it, hide it" when the intent is usually "yes, I know, tell me when it's
// closer". It now stores a threshold instead: show this again once daysUntil
// drops to N or below.
export type CelebrationSnoozes = Record<string, number>;

export function loadCelebrationSnoozes(storageKey: string): CelebrationSnoozes {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Pre-2026-09-08 shape was a bare array of ids meaning "hidden for the
    // rest of the year". -1 reproduces that exactly (daysUntil is never
    // negative inside the banner's window), so existing dismissals do NOT
    // resurface when this ships.
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.map((id: string) => [id, -1]));
    }
    if (parsed && typeof parsed === "object") return parsed as CelebrationSnoozes;
    return {};
  } catch { return {}; }
}

export function saveCelebrationSnoozes(storageKey: string, map: CelebrationSnoozes) {
  try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch {}
}

/** Where a dismissal lands, given how far out the celebration currently is. */
export function nextCelebrationCheckpoint(daysUntil: number): number {
  if (daysUntil >= 3) return 1;   // a few days out → bring it back the day before
  if (daysUntil >= 1) return 0;   // day before / two days → bring it back on the day
  return -1;                      // dismissed ON the day → nothing left to remind about
}
