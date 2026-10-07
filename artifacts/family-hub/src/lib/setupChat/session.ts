// The setup chat's progress, kept on this device so closing the app halfway,
// or leaving for Google to connect a calendar, comes back to the same
// question. Kept apart from the Chat tab's threads, and cleared on finish.
// The PIN being typed is never written here.
import type { Mode, SetupState } from "./script";

export const SESSION_VERSION = 1;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function sessionKey(userId: string): string {
  return `superhub_setup_chat_${userId}`;
}

export function serializeSession(mode: Mode, state: SetupState | null): string {
  return JSON.stringify({
    version: SESSION_VERSION,
    mode,
    state: state ? { ...state, pinFirst: undefined } : null,
  });
}

/** The saved mode, and where the chat was. `state` is null when only the
 *  mode was saved, e.g. right before the reload that follows joining. */
export function loadSession(userId: string, store: Store | null = defaultStore()): { mode: Mode; state: SetupState | null } | null {
  try {
    const raw = store?.getItem(sessionKey(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== SESSION_VERSION) return null;
    if (saved.mode !== "fresh" && saved.mode !== "joiner") return null;
    const state = saved.state && typeof saved.state.q === "string" && Array.isArray(saved.state.transcript) ? saved.state : null;
    return { mode: saved.mode, state };
  } catch {
    return null;
  }
}

export function saveSession(userId: string, mode: Mode, state: SetupState | null, store: Store | null = defaultStore()): void {
  if (mode === "replay") return;
  try {
    store?.setItem(sessionKey(userId), serializeSession(mode, state));
  } catch {
    /* storage full or unavailable: the chat just won't resume */
  }
}

export function clearSession(userId: string, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(sessionKey(userId));
  } catch {
    /* nothing to clear */
  }
}
