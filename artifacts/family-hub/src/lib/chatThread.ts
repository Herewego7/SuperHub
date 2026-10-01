export type ChatBubble = { id: string; role: "user" | "assistant"; text: string };

const keyFor = (profileKey: string) => `superhub_chat_thread_${profileKey}`;

export function readThread(profileKey: string): ChatBubble[] {
  try {
    const raw = localStorage.getItem(keyFor(profileKey));
    const parsed = raw ? JSON.parse(raw) as ChatBubble[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const UNREAD_KEY = "superhub_chat_unread";

export function unreadCount(raw: string | null): number {
  const count = Number(raw || "0");
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function unreadMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const map: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const count = unreadCount(String(value));
        if (count > 0) map[key] = count;
      }
      return map;
    }
  } catch {
    // A plain number from before unread was per person.
  }
  const count = unreadCount(raw);
  return count > 0 ? { "*": count } : {};
}

export function unreadFor(raw: string | null, profileKey: string): number {
  const map = unreadMap(raw);
  return (map[profileKey] ?? 0) + (map["*"] ?? 0);
}

export function bumpUnread(raw: string | null, profileKey: string): string {
  const map = unreadMap(raw);
  map[profileKey] = (map[profileKey] ?? 0) + 1;
  return JSON.stringify(map);
}

export function clearedUnread(raw: string | null, profileKey: string): string {
  const map = unreadMap(raw);
  delete map[profileKey];
  delete map["*"];
  return JSON.stringify(map);
}

export function noteChatUnread(profileKey = "*"): number {
  const next = bumpUnread(localStorage.getItem(UNREAD_KEY), profileKey);
  localStorage.setItem(UNREAD_KEY, next);
  window.dispatchEvent(new Event("superhub-chat-unread"));
  return unreadFor(next, profileKey);
}

export function clearChatUnread(profileKey: string): void {
  localStorage.setItem(UNREAD_KEY, clearedUnread(localStorage.getItem(UNREAD_KEY), profileKey));
}

/** The plan is the latest message, so a notification reply sits directly under it. */
export function threadWithPlan(current: ChatBubble[], plan: string, reply?: string | null): ChatBubble[] {
  const next = [...current];
  if (!next.some((bubble) => bubble.text === plan)) {
    next.push({ id: `evening-plan-${next.length}`, role: "assistant", text: plan });
  }
  const said = reply?.trim();
  if (said) next.push({ id: `evening-reply-${next.length}`, role: "user", text: said });
  return next;
}

export function appendUserMessage(profileKey: string, text: string): ChatBubble[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const next = [...readThread(profileKey), { id: `${Date.now()}`, role: "user" as const, text: trimmed }];
  localStorage.setItem(keyFor(profileKey), JSON.stringify(next));
  return next;
}
