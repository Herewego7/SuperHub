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

export function noteChatUnread(): number {
  const next = unreadCount(localStorage.getItem(UNREAD_KEY)) + 1;
  localStorage.setItem(UNREAD_KEY, String(next));
  window.dispatchEvent(new Event("superhub-chat-unread"));
  return next;
}

export function appendUserMessage(profileKey: string, text: string): ChatBubble[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const next = [...readThread(profileKey), { id: `${Date.now()}`, role: "user" as const, text: trimmed }];
  localStorage.setItem(keyFor(profileKey), JSON.stringify(next));
  return next;
}
