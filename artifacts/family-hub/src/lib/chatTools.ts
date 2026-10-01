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

export function createEventTitle(text: string): string | null {
  const match = text.trim().match(/^(?:add|create)\s+(?:an?\s+)?event\s+(?:called\s+)?(.+?)\.?$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

export function familyCalendarOffer(familyCalendarId: string | null | undefined): string | null {
  const id = familyCalendarId?.trim();
  if (!id || id === "none") return null;
  return id;
}

export function checkOffTitle(text: string): string | null {
  const match = text.trim().match(/^check off (.+)$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

export function schoolFact(
  text: string,
  profiles: { id: string; name: string }[],
): { profileId: string; name: string; school: string } | null {
  const match = text.trim().match(/^(.+?)['’]s school is\s+(.+?)\.?$/i);
  const who = match?.[1]?.trim().toLowerCase();
  const school = match?.[2]?.trim();
  if (!who || !school) return null;
  const profile = profiles.find((person) => person.name.trim().toLowerCase() === who);
  if (!profile) return null;
  return { profileId: profile.id, name: profile.name, school };
}

export function drivingReply(
  text: string,
  events: { title: string; drivingProfileIds?: string[] | null }[],
  profiles: { id: string; name: string }[],
): string | null {
  const asked = text.trim().match(/^who(?:'s| is) driving\s+(.+?)\??$/i)?.[1]?.trim();
  if (!asked) return null;
  const event = events.find((item) => item.title.toLowerCase().includes(asked.toLowerCase()));
  if (!event) return `I don't see ${asked}.`;
  const names = (event.drivingProfileIds ?? [])
    .map((id) => profiles.find((profile) => profile.id === id)?.name)
    .filter((name): name is string => !!name);
  if (names.length === 0) return `Nobody is set to drive ${event.title}.`;
  if (names.length === 1) return `${names[0]} is driving ${event.title}.`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")} and ${last} are driving ${event.title}.`;
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
