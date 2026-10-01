// Persists which profile+day combos have already gotten the "all chores done"
// confetti celebration. Both chores-view.tsx (Tasks tab) and home-view.tsx
// independently detect "all done" and would otherwise each fire their own
// celebration — this shared, localStorage-backed flag (not a component-local
// ref, which resets every time a tab is unmounted/remounted) is what stops
// the same day's completion from re-celebrating every time the user
// navigates back to a tab.
const STORAGE_KEY = "familyHub_allDoneCelebrated";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

type CelebratedMap = Record<string, number>;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function loadMap(): CelebratedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMap(map: CelebratedMap): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const pruned = Object.fromEntries(Object.entries(map).filter(([, ts]) => ts >= cutoff));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {}
}

// `kind` distinguishes "all chores done" from "all to-dos done" — a profile
// can finish one before the other (or only have one of the two on a given
// day), so each needs its own independent celebration + dedup flag.
export function hasCelebratedAllDone(profileId: string, date: Date, kind: "chores" | "todos" = "chores"): boolean {
  return !!loadMap()[`${kind}:${profileId}:${dateKey(date)}`];
}

export function markCelebratedAllDone(profileId: string, date: Date, kind: "chores" | "todos" = "chores"): void {
  const map = loadMap();
  map[`${kind}:${profileId}:${dateKey(date)}`] = Date.now();
  saveMap(map);
}

/**
 * Forget that a profile+day was celebrated, so finishing again re-celebrates.
 *
 * Without this the flag was write-once per day: the first time a day was
 * completed it fired, and every later completion that day was silent — even
 * after un-checking something and doing it again. That reads as "the confetti
 * is broken", because from the person's side they genuinely did just finish
 * their chores and nothing happened. It also silently swallowed the *chores*
 * celebration on Home whenever the Chores tab had already marked the same
 * day, and vice versa. Called wherever a completion is undone: the day is no
 * longer finished, so the next time it is, it deserves the confetti again.
 */
export function clearCelebratedAllDone(profileId: string, date: Date, kind: "chores" | "todos" = "chores"): void {
  const map = loadMap();
  delete map[`${kind}:${profileId}:${dateKey(date)}`];
  saveMap(map);
}
