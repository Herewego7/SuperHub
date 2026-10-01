/** Chat tools carried over from Bot Life. Mail tools stay off a kid's thread. */

export const CHAT_TOOLS = [
  "get_plan",
  "search",
  "get_newsletters",
  "create_event",
  "update_event",
  "delete_event",
  "create_task",
  "complete_task",
  "assign",
  "create_reminder",
  "get_weather",
  "get_profile",
  "remember_fact",
  "mute_sender",
  "mark_not_relevant",
  "send_feedback",
  "maps_link",
] as const;

const INBOX_TOOLS = new Set(["search", "get_newsletters", "mute_sender", "mark_not_relevant"]);

export function toolsForRole(isChild: boolean): string[] {
  if (!isChild) return [...CHAT_TOOLS];
  return CHAT_TOOLS.filter((tool) => !INBOX_TOOLS.has(tool));
}

export function pointsProfileId(profileIds: string[], profileKey: string): string | null {
  const selected = profileKey.split(",").filter((id) => id && id !== "family");
  if (selected.length === 1 && profileIds.includes(selected[0])) return selected[0];
  return profileIds[0] ?? null;
}

export function checkOffTitle(text: string): string | null {
  const match = text.trim().match(/^check off (.+)$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

export function deleteEventTitle(text: string): string | null {
  const match = /^(?:please\s+)?(?:delete|remove|cancel)\s+(?:the\s+)?(?:event\s+)?["']?(.+?)["']?\.?$/i.exec(text.trim());
  const title = match?.[1]?.trim();
  if (!title || /^(?:yes|no)$/i.test(title)) return null;
  return title;
}

/** Imported events stay until the person confirms. App-made rows do not. */
export function importedEventNeedsConfirm(source: string | null | undefined): boolean {
  return !!source && source !== "app" && source !== "meal";
}
