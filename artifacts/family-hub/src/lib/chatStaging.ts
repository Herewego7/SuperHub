import { noteChatUnread } from "@/lib/chatThread";

export const PLAN_KEY = "superhub_evening_plan";
export const PENDING_KEY = "superhub_chat_pending";
export const PLAN_REPLY_KEY = "superhub_evening_plan_reply";

export function stagePendingChat(text: string) {
  const trimmed = text.trim();
  if (!trimmed || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PENDING_KEY, trimmed);
}

export function stageEveningPlan(text: string, reply?: string | null, profileKey?: string | null) {
  sessionStorage.setItem(PLAN_KEY, text);
  const said = reply?.trim();
  if (said) sessionStorage.setItem(PLAN_REPLY_KEY, said);
  else sessionStorage.removeItem(PLAN_REPLY_KEY);
  noteChatUnread(profileKey || "*");
}
