import { storage } from "../storage";
import { syncEventCreate } from "../calendarSync";
import { geminiClient, geminiSetup, askJson, BOTLIFE_MODELS } from "../geminiClient";
import { duplicateBand, familyGrades, titleSimilarity } from "../ai/parity";
import { examplesForMessage, rememberMail } from "../ai/memory";
import { connectedCalendarEvents } from "../scheduler/eveningPlan";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { slipKey, type InboundMessage } from "./parse";
import { ingestMessages, schoolEventStart, slipClock, type PlannedEvent, type PlannedTodo } from "./process";
import { alreadyRead, openContextLines, plansFromRead, readInboxMessage, subjectPlaceholder, type MailPerson } from "./readMail";
import { emptyTally } from "./scanProgress";

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
  if (settings?.scanInbox === false) return { todos: [], events: [], scanOff: true, tally: emptyTally(messages.length) };
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
    const saved = await storePlanned(
      userId,
      ingestMessages(messages, state, existingKeys, profileIds, existingEventKeys),
      timeZone,
      calendarId,
    );
    return { ...saved, tally: emptyTally(messages.length) };
  }

  const people = await storage.getProfilesByUser(userId);
  const family: MailPerson[] = people
    .filter((person) => !person.isAllFamilyProfile && person.isActive !== false && person.name?.trim())
    .map((person) => ({ name: person.name, school: person.school, facts: person.facts, isChild: person.isChild || person.role === "child" }));
  const completions = await storage.getChoreCompletionsByUser(userId);
  const done = new Set(completions.map((completion) => completion.choreId));
  const grades = familyGrades(family);
  const open = await openCalendarLines(userId, chores, done, savedEvents, timeZone);
  const keyword: InboundMessage[] = [];
  const todos = [];
  const events = [];
  const tally = emptyTally(messages.length, geminiSetup().kind);
  for (const message of messages) {
    const subject = message.subject?.trim() ?? "";
    if (
      !subject
      || (message.fromAddress && state.mutedSenders.some((address) => address.toLowerCase() === message.fromAddress?.toLowerCase()))
      || state.dismissedSlipKeys.includes(slipKey(subject))
      || chores.some((chore) => alreadyRead(chore.description, subject))
    ) {
      tally.skipped += 1;
      continue;
    }
    const learned = [
      ...state.dismissedSlipKeys.slice(-8),
      ...(await examplesForMessage(userId, `${subject}\n${message.snippet}`, message.fromAddress)),
    ];
    const read = await readInboxMessage(ai, message, family, learned, open);
    if (!read) {
      tally.readFailed += 1;
      keyword.push(message);
      continue;
    }
    if (!read.familyRelated) {
      if (read.droppedAtTriage) tally.triageSaidNo += 1;
      else tally.readSaidNo += 1;
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
    const planned = plansFromRead(message, read, profileIds, state, existingKeys, existingEventKeys, new Date(), grades);
    const todosToSave = [];
    for (const todo of planned.todos) {
      const near = chores.find((chore) => chore.title !== todo.title && duplicateBand(titleSimilarity(chore.title, todo.title)) !== "new");
      if (near && duplicateBand(titleSimilarity(near.title, todo.title)) === "same") continue;
      if (near) {
        const verdict = await askJson(ai, [BOTLIFE_MODELS.dedupe], "Decide if two household items are the same event or task. JSON {\"same\":boolean}", `${near.title}\n${todo.title}`, undefined, "dedupe");
        if (verdict && typeof verdict === "object" && (verdict as { same?: unknown }).same === true) continue;
      }
      todosToSave.push(todo);
    }
    planned.todos = todosToSave;
    if (planned.todos.length === 0 && planned.events.length === 0 && planned.changes.length === 0 && !read.newsletter) {
      tally.nothingNew += 1;
      keyword.push(message);
      continue;
    }
    tally.used += 1;
    await retirePlaceholder(userId, chores, done, subject);
    for (const todo of planned.todos) existingKeys.push(todo.slipKey);
    for (const event of planned.events) if (event.externalId) existingEventKeys.push(event.externalId);
    const saved = await storePlanned(userId, planned, timeZone, calendarId);
    todos.push(...saved.todos);
    events.push(...saved.events);
    for (const fact of read.facts) {
      const person = people.find((profile) => profile.name?.toLowerCase() === fact.member.toLowerCase());
      if (!person) continue;
      const have = person.facts ?? [];
      if (have.some((line) => line.toLowerCase() === fact.value.toLowerCase())) continue;
      const next = [...have, fact.value].slice(0, 20);
      await storage.updateProfile(person.id, { facts: next }, userId);
      person.facts = next;
    }
    for (const change of planned.changes) {
      const event = savedEvents.find((item) => titleSimilarity(item.title, change.changeOf) >= 0.45);
      if (!event || !change.when) continue;
      const clock = change.time ? slipClock(change.time) : null;
      const start = schoolEventStart(`${change.when} ${change.time ?? ""}`, clock?.hours ?? 9, clock?.minutes ?? 0, new Date(), timeZone);
      await storage.updateEvent(event.id, { startTime: start, endTime: new Date(start.getTime() + 60 * 60 * 1000) }, userId);
    }
    const source = [
      message.subject,
      message.body ?? message.snippet,
      ...(message.thread ?? []),
      ...(message.files ?? []).flatMap((file) => file.text ? [file.text] : []),
    ].filter(Boolean).join("\n\n");
    void rememberMail(userId, source, message.subject);
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
  return { todos, events, scanOff: false, tally };
}

function localDay(value: string | Date, zone: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function whenLabel(value: string | Date, zone: string, allDay: boolean): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(at);
}

async function openCalendarLines(
  userId: string,
  chores: { id: string; title: string; taskType?: string | null }[],
  done: Set<string>,
  savedEvents: { title: string; startTime: string | Date; isAllDay?: boolean | null }[],
  zone: string,
): Promise<string[]> {
  const outside = await connectedCalendarEvents(userId).catch(() => []);
  const today = localDay(new Date(), zone);
  const events = [...savedEvents, ...outside]
    .filter((event) => localDay(event.startTime, zone) >= today)
    .slice(0, 40)
    .map((event) => ({ title: event.title, when: whenLabel(event.startTime, zone, event.isAllDay === true) }));
  const items = chores
    .filter((chore) => !done.has(chore.id) && chore.taskType !== "chore")
    .slice(0, 40)
    .map((chore) => ({ title: chore.title }));
  return openContextLines(items, events);
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
