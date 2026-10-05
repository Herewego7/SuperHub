import { storage } from "../storage";
import { syncEventCreate } from "../calendarSync";
import { geminiClient } from "../geminiClient";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { slipKey, type InboundMessage } from "./parse";
import { ingestMessages, mailWorthSaving, schoolEventStart, type PlannedEvent, type PlannedTodo } from "./process";
import { alreadyRead, plansFromRead, readInboxMessage, subjectPlaceholder, type MailPerson } from "./readMail";

type Saved = { todos: unknown[]; events: unknown[]; scanOff: boolean };

async function storePlanned(
  userId: string,
  planned: { todos: PlannedTodo[]; events: PlannedEvent[] },
  timeZone: string,
  calendarId: string | null,
): Promise<Saved> {
  const todos = [];
  for (const todo of planned.todos) {
    const { slipKey: _slipKey, ...row } = todo;
    todos.push(await storage.createChore({ ...row, userId }));
  }
  const events = [];
  const now = new Date();
  for (const event of planned.events) {
    const note = `${event.title} ${event.description}`;
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

export async function applyIngestedMail(userId: string, messages: InboundMessage[], profileIds: string[]) {
  const settings = await storage.getCalendarSettingsByUser(userId);
  if (settings?.scanInbox === false) return { todos: [], events: [], scanOff: true };
  const chores = await storage.getChoresByUser(userId);
  const existingKeys = chores.filter((chore) => chore.category === "school_email").map((chore) => slipKey(chore.title));
  const savedEvents = await storage.getEventsByUser(userId);
  const existingEventKeys = savedEvents.flatMap((event) =>
    event.source === "school" && event.externalId ? [event.externalId] : [],
  );
  const state = { mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] };
  const familyCalendarId = settings?.familyCalendarId;
  const calendarId = familyCalendarId && familyCalendarId !== "none" ? familyCalendarId : null;
  const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
  const ai = geminiClient();
  if (!ai) {
    return storePlanned(
      userId,
      ingestMessages(messages, state, existingKeys, profileIds, existingEventKeys),
      timeZone,
      calendarId,
    );
  }

  const people = await storage.getProfilesByUser(userId);
  const family: MailPerson[] = people
    .filter((person) => !person.isAllFamilyProfile && person.isActive !== false && person.name?.trim())
    .map((person) => ({ name: person.name, school: person.school, facts: person.facts, isChild: person.isChild || person.role === "child" }));
  const completions = await storage.getChoreCompletionsByUser(userId);
  const done = new Set(completions.map((completion) => completion.choreId));
  const keyword: InboundMessage[] = [];
  const todos = [];
  const events = [];
  for (const message of messages) {
    const subject = message.subject?.trim() ?? "";
    if (!subject || !mailWorthSaving(message)) continue;
    if (message.fromAddress && state.mutedSenders.some((address) => address.toLowerCase() === message.fromAddress?.toLowerCase())) continue;
    if (state.dismissedSlipKeys.includes(slipKey(subject))) continue;
    if (chores.some((chore) => alreadyRead(chore.description, subject))) continue;
    const read = await readInboxMessage(ai, message, family);
    if (!read) {
      keyword.push(message);
      continue;
    }
    if (!read.familyRelated) {
      await retirePlaceholder(userId, chores, done, subject);
      continue;
    }
    const subjectKey = slipKey(subject);
    const openPlaceholder = chores.some((chore) => chore.category === "school_email" && !done.has(chore.id) && subjectPlaceholder(chore.title, chore.description, subject));
    const keptTitle = chores.some((chore) => chore.category === "school_email" && slipKey(chore.title) === subjectKey && (done.has(chore.id) || !subjectPlaceholder(chore.title, chore.description, subject)));
    if (openPlaceholder && !keptTitle) {
      const index = existingKeys.indexOf(subjectKey);
      if (index >= 0) existingKeys.splice(index, 1);
    }
    const planned = plansFromRead(message, read, profileIds, state, existingKeys, existingEventKeys, new Date());
    if (planned.todos.length === 0 && planned.events.length === 0 && !read.newsletter) {
      keyword.push(message);
      continue;
    }
    await retirePlaceholder(userId, chores, done, subject);
    for (const todo of planned.todos) existingKeys.push(todo.slipKey);
    for (const event of planned.events) if (event.externalId) existingEventKeys.push(event.externalId);
    const saved = await storePlanned(userId, planned, timeZone, calendarId);
    todos.push(...saved.todos);
    events.push(...saved.events);
  }
  if (keyword.length > 0) {
    const saved = await storePlanned(
      userId,
      ingestMessages(keyword, state, existingKeys, profileIds, existingEventKeys),
      timeZone,
      calendarId,
    );
    todos.push(...saved.todos);
    events.push(...saved.events);
  }
  return { todos, events, scanOff: false };
}

async function retirePlaceholder(
  userId: string,
  chores: { id: string; title: string; description?: string | null; category?: string | null }[],
  done: Set<string>,
  subject: string,
) {
  for (const chore of chores) {
    if (chore.category !== "school_email" || done.has(chore.id)) continue;
    if (!subjectPlaceholder(chore.title, chore.description, subject)) continue;
    await storage.deleteChore(chore.id, userId);
  }
}
