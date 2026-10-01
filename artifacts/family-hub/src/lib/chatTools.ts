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

export function assignChange(
  text: string,
  chores: { id: string; title: string }[],
  profiles: { id: string; name: string }[],
): { choreId: string; profileIds: string[]; reply: string } | { reply: string } | null {
  const match = text.trim().match(/^assign\s+(.+?)\s+to\s+(.+?)\.?$/i);
  if (!match) return null;
  const title = match[1].trim();
  const who = match[2].trim();
  const chore = chores.find((item) => item.title.toLowerCase() === title.toLowerCase());
  if (!chore) return { reply: `I don't see ${title}.` };
  if (/^(nobody|no one|everyone)$/i.test(who)) {
    return { choreId: chore.id, profileIds: [], reply: `${chore.title} is for everyone.` };
  }
  const profile = profiles.find((person) => person.name.toLowerCase() === who.toLowerCase());
  if (!profile) return { reply: `I don't see ${who}.` };
  return { choreId: chore.id, profileIds: [profile.id], reply: `${chore.title} is assigned to ${profile.name}.` };
}

export function createTodoTitle(text: string): string | null {
  const match = text.trim().match(/^(?:add|create)\s+(?:a\s+)?to-?do\s+(?:called\s+)?(.+?)\.?$/i);
  const title = match?.[1]?.trim();
  return title ? title : null;
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

function dueOnDay(
  chore: {
    taskType?: string | null;
    isActive?: boolean | null;
    daysOfWeek?: number[] | null;
    recurrenceType?: string | null;
    targetCount?: number | null;
    endDate?: Date | string | null;
  },
  start: Date,
): boolean {
  if (chore.isActive === false) return false;
  if (chore.taskType === "todo") return true;
  if (chore.taskType && chore.taskType !== "chore") return false;
  if (chore.endDate && new Date(chore.endDate) < start) return false;
  if (chore.targetCount && chore.targetCount > 0) return true;
  if (chore.recurrenceType === "daily") return true;
  return (chore.daysOfWeek ?? []).includes(start.getDay());
}

export function dayReply(
  text: string,
  input: {
    chores: {
      id?: string;
      title: string;
      taskType?: string | null;
      isActive?: boolean | null;
      daysOfWeek?: number[] | null;
      recurrenceType?: string | null;
      targetCount?: number | null;
      endDate?: Date | string | null;
    }[];
    events: { title: string; startTime: Date | string }[];
    completions?: { choreId: string; completedAt?: Date | string | null }[];
    dinner?: string | null;
    day: Date;
  },
): string | null {
  if (!/\bwhat(?:'s| is) (?:the plan|my day)\b/i.test(text.trim())) return null;
  const start = new Date(input.day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const done = new Set(
    (input.completions ?? [])
      .filter((completion) => {
        if (!completion.completedAt) return false;
        const at = new Date(completion.completedAt);
        return at >= start && at < end;
      })
      .map((completion) => completion.choreId),
  );
  const lines: string[] = [];
  for (const chore of input.chores) {
    if (chore.id && done.has(chore.id)) continue;
    if (!dueOnDay(chore, start)) continue;
    lines.push(chore.title);
  }
  for (const event of input.events) {
    const at = new Date(event.startTime);
    if (at >= start && at < end) lines.push(event.title);
  }
  const kept = lines.slice(0, 5);
  if (input.dinner) kept.push(`Dinner. ${input.dinner}`);
  return kept.join("\n") || "Nothing on the plan.";
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

export function moveEventWhen(text: string): { title: string; hours: number; minutes: number } | null {
  const match = text.trim().match(/^move\s+(.+?)\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\.?$/i);
  if (!match) return null;
  const title = match[1].trim();
  let hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  const suffix = match[4].toLowerCase();
  if (!title || hours < 1 || hours > 12 || minutes > 59) return null;
  if (suffix === "pm" && hours !== 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  return { title, hours, minutes };
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
