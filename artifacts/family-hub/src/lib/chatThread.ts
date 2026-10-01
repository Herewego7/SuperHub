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

export function appendUserMessage(profileKey: string, text: string): ChatBubble[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const next = [...readThread(profileKey), { id: `${Date.now()}`, role: "user" as const, text: trimmed }];
  localStorage.setItem(keyFor(profileKey), JSON.stringify(next));
  return next;
}
