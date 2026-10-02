import { storage } from "../storage";
import { syncEventCreate } from "../calendarSync";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { slipKey, type InboundMessage } from "./parse";
import { ingestMessages, schoolEventStart } from "./process";

export async function applyIngestedMail(userId: string, messages: InboundMessage[], profileIds: string[]) {
  const settings = await storage.getCalendarSettingsByUser(userId);
  if (settings?.scanInbox === false) return { todos: [], events: [], scanOff: true };
  const chores = await storage.getChoresByUser(userId);
  const existingKeys = chores.filter((chore) => chore.category === "school_email").map((chore) => slipKey(chore.title));
  const savedEvents = await storage.getEventsByUser(userId);
  const existingEventKeys = savedEvents.flatMap((event) =>
    event.source === "school" && event.externalId ? [event.externalId] : [],
  );
  const planned = ingestMessages(
    messages,
    { mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] },
    existingKeys,
    profileIds,
    existingEventKeys,
  );
  const todos = [];
  for (const todo of planned.todos) {
    const { slipKey: _slipKey, ...row } = todo;
    todos.push(await storage.createChore({ ...row, userId }));
  }
  const familyCalendarId = settings?.familyCalendarId;
  const calendarId = familyCalendarId && familyCalendarId !== "none" ? familyCalendarId : null;
  const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
  const events = [];
  for (const event of planned.events) {
    const note = `${event.title} ${event.description}`;
    const now = new Date();
    const start = schoolEventStart(note, event.hours, event.minutes, now, timeZone);
    const end = event.endHours == null
      ? new Date(start.getTime() + 60 * 60 * 1000)
      : schoolEventStart(note, event.endHours, event.endMinutes ?? 0, now, timeZone);
    const saved = await storage.createEvent({
      userId,
      title: event.title,
      description: event.description,
      startTime: start,
      endTime: end,
      profileIds: event.profileIds,
      calendarId,
      source: event.source,
      externalId: event.externalId,
    });
    events.push(saved);
    void syncEventCreate(saved).catch((err) =>
      console.warn("syncEventCreate (school email) failed:", err instanceof Error ? err.message : err),
    );
  }
  return { todos, events, scanOff: false };
}
