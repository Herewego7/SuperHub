/**
 * SuperHub chat, using Bot Life's rules: look things up, change data only when
 * asked, and confirm before deleting, remembering, muting, or dismissing mail.
 * A child never gets inbox tools.
 */

export type ChatProfile = {
  id: string;
  name: string;
  school?: string | null;
  facts?: string[] | null;
  role?: string | null;
  isChild?: boolean | null;
};

export type ChatEvent = {
  id: string;
  title: string;
  startTime: string | Date;
  endTime?: string | Date | null;
  location?: string | null;
  profileIds?: string[] | null;
  drivingProfileIds?: string[] | null;
  source?: string | null;
  isAllDay?: boolean | null;
};

export type ChatChore = {
  id: string;
  title: string;
  taskType?: string | null;
  profileIds?: string[] | null;
  category?: string | null;
  description?: string | null;
  points?: number | null;
};

export type ChatSnapshot = {
  now: Date;
  timeZone: string;
  firstName: string;
  isChild: boolean;
  profiles: ChatProfile[];
  events: ChatEvent[];
  chores: ChatChore[];
  doneIds: string[];
  meals: { name: string; date: string; mealType?: string | null }[];
  savedMeals?: { id: string; name: string }[];
  celebrations: { name: string; monthDay: string; type?: string | null; year?: number | null }[];
  groceries: { name: string }[];
  weather?: { temperature?: number; condition?: string; location?: string } | null;
};

export type ChatAction =
  | { kind: "create_task"; title: string; profileIds: string[] }
  | { kind: "complete_task"; choreId: string; profileId: string }
  | { kind: "create_event"; title: string; start: string; end: string; location: string | null; profileIds: string[] }
  | { kind: "update_event"; eventId: string; patch: Record<string, unknown> }
  | { kind: "delete_event"; eventId: string }
  | { kind: "remember_fact"; profileId: string; facts: string[] }
  | { kind: "set_school"; profileId: string; school: string | null }
  | { kind: "assign"; choreId: string; profileIds: string[] }
  | { kind: "grocery_have"; name: string }
  | { kind: "mute_sender"; address: string }
  | { kind: "not_relevant"; title: string }
  | { kind: "plan_dinners"; dinners: { date: string; name: string }[] };

const ADULT_ONLY = new Set(["mute_sender", "mark_not_relevant", "search_mail"]);
const NEEDS_YES = new Set(["delete_event", "remember_fact", "forget_school", "mute_sender", "mark_not_relevant", "plan_dinners"]);

export function userSaidYes(text: string): boolean {
  return /^(yes|yeah|yep|yup|sure|ok|okay|do it|confirm|please do|go ahead)\b/i.test(text.trim());
}

function names(snap: ChatSnapshot, ids: string[] | null | undefined): string {
  const list = (ids ?? []).map((id) => snap.profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function whenLabel(value: string | Date, zone: string, allDay: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(date);
  if (allDay) return `${day}, all day`;
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day}, ${clock}`;
}

function localKey(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The household the model is allowed to talk about. Mail bodies stay out of a child's copy. */
export function chatBriefing(snap: ChatSnapshot): string {
  const zone = snap.timeZone || "America/Chicago";
  const today = localKey(snap.now, zone);
  const people = snap.profiles.map((person) => {
    const bits = [person.name];
    if (person.role) bits.push(person.role);
    if (person.school) bits.push(`school ${person.school}`);
    if (!snap.isChild && person.facts?.length) bits.push(`facts: ${person.facts.join("; ")}`);
    return bits.join(", ");
  });
  const horizon = snap.now.getTime() + 14 * 86400000;
  const events = snap.events
    .filter((event) => {
      const at = new Date(event.startTime).getTime();
      return !Number.isNaN(at) && at >= snap.now.getTime() - 12 * 3600000 && at <= horizon;
    })
    .slice(0, 40)
    .map((event) => {
      const who = names(snap, event.profileIds);
      const drive = names(snap, event.drivingProfileIds);
      return `- ${whenLabel(event.startTime, zone, event.isAllDay === true)} — ${event.title}${event.location ? ` at ${event.location}` : ""}${who ? `, for ${who}` : ""}${drive ? `, ${drive} driving` : ""} [${event.id}]`;
    });
  const open = snap.chores.filter((chore) => !snap.doneIds.includes(chore.id) && chore.taskType !== "chore");
  const todos = open.slice(0, 30).map((chore) => {
    const quote = !snap.isChild && chore.category === "school_email" ? chore.description?.slice(0, 160) : "";
    return `- ${chore.title}${names(snap, chore.profileIds) ? `, for ${names(snap, chore.profileIds)}` : ""}${quote ? `. ${quote}` : ""} [${chore.id}]`;
  });
  const chores = snap.chores.filter((chore) => chore.taskType !== "todo").slice(0, 20).map((chore) => {
    const done = snap.doneIds.includes(chore.id);
    return `- ${chore.title}${done ? " (done)" : ""} [${chore.id}]`;
  });
  const dinners = snap.meals
    .filter((meal) => meal.mealType === "dinner" || !meal.mealType)
    .filter((meal) => meal.date >= today)
    .slice(0, 8)
    .map((meal) => `- ${meal.date}: ${meal.name}`);
  const days = snap.celebrations.slice(0, 12).map((row) => `- ${row.name} ${row.type || "birthday"} ${row.monthDay}`);
  return [
    `People:\n${people.join("\n") || "(none)"}`,
    `Coming up:\n${events.join("\n") || "(nothing scheduled)"}`,
    `Open to-dos:\n${todos.join("\n") || "(none)"}`,
    `Chores:\n${chores.join("\n") || "(none)"}`,
    `Dinners:\n${dinners.join("\n") || "(none planned)"}`,
    `Saved meals:\n${(snap.savedMeals ?? []).map((meal) => meal.name).slice(0, 40).join(", ") || "(none saved)"}`,
    `Birthdays and anniversaries:\n${days.join("\n") || "(none saved)"}`,
    `Groceries still on the list:\n${snap.groceries.map((item) => item.name).slice(0, 30).join(", ") || "(none)"}`,
    snap.weather?.condition ? `Weather now: ${snap.weather.temperature ?? ""} ${snap.weather.condition}${snap.weather.location ? ` in ${snap.weather.location}` : ""}.` : "",
  ].filter(Boolean).join("\n\n");
}

export function chatSystemPrompt(snap: ChatSnapshot): string {
  const zone = snap.timeZone || "America/Chicago";
  const today = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(snap.now);
  return [
    "You are SuperHub, a family's chief of staff: warm, brief, and practical.",
    `Now: ${today} (${zone}). Today is ${localKey(snap.now, zone)}. You're talking with ${snap.firstName || "a parent"}.`,
    "Household, already looked up. Do not invent events, times, or people that are not here:",
    chatBriefing(snap),
    "Rules:",
    "- You can't send messages, emails, or texts to anyone, and never offer to.",
    "- Answer a direct question in the first sentence.",
    "- For a day or a week, write two or three short paragraphs and no headings: what they need to do, where the family needs to be, then one heads-up.",
    "- Say who each thing is for. Leave out someone's job unless they asked about work.",
    "- Mention weather only when it changes the plan.",
    "- Change the calendar, to-dos, chores, meals, or groceries only when they ask in this conversation.",
    "- To plan dinners, call plan_dinners with a date (YYYY-MM-DD) and a name for each night. Prefer a saved meal name when one fits. Ask first, then call again with confirmed=true after they say yes. That writes the Meals tab.",
    "- Before delete_event, remember_fact, forget_school, mute_sender, mark_not_relevant, or plan_dinners, ask first. Call the tool with confirmed=true only after they say yes.",
    "- Events that live on Google, Outlook, or an iCal feed cannot be deleted or moved here. The tool will say to hand that off.",
    "- Tonight means 8:00 PM unless they name a time.",
    "- Keep replies under about 80 words, or 120 for a week. Bold a few key words with ** at most.",
    snap.isChild
      ? "This person is a child. Do not read, search, quote, or summarize email or newsletters. Do not mute senders or dismiss mail. Talk about their own plan, chores, and dinner."
      : "Mail tools are allowed for this adult. Still confirm before muting a sender or marking something not relevant.",
  ].join("\n");
}

export function toolDeclarations(isChild: boolean): { name: string; description: string; parameters: Record<string, unknown> }[] {
  const obj = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
  });
  const str = { type: "string" };
  const ids = { type: "array", items: { type: "string" } };
  const all = [
    { name: "create_task", description: "Add a to-do.", parameters: obj({ title: str, profileIds: ids }, ["title"]) },
    { name: "complete_task", description: "Check off a chore or to-do by id.", parameters: obj({ choreId: str }, ["choreId"]) },
    { name: "create_event", description: "Add an event on the family calendar. Times are ISO 8601.", parameters: obj({ title: str, start: str, end: str, location: str, profileIds: ids }, ["title", "start", "end"]) },
    { name: "update_event", description: "Change a SuperHub event's title, time, place, or who it is for.", parameters: obj({ eventId: str, title: str, start: str, end: str, location: str, profileIds: ids }, ["eventId"]) },
    { name: "delete_event", description: "Delete a SuperHub event after the user says yes.", parameters: obj({ eventId: str, confirmed: { type: "boolean" } }, ["eventId"]) },
    { name: "remember_fact", description: "Remember one fact about a person, after they say yes.", parameters: obj({ profileId: str, fact: str, confirmed: { type: "boolean" } }, ["profileId", "fact"]) },
    { name: "set_school", description: "Save a person's school.", parameters: obj({ profileId: str, school: str }, ["profileId", "school"]) },
    { name: "forget_school", description: "Clear a person's school after they say yes.", parameters: obj({ profileId: str, confirmed: { type: "boolean" } }, ["profileId"]) },
    { name: "assign", description: "Assign a chore or to-do to people.", parameters: obj({ choreId: str, profileIds: ids }, ["choreId", "profileIds"]) },
    { name: "grocery_have", description: "Take an item off the grocery list because the family already has it.", parameters: obj({ name: str }, ["name"]) },
    { name: "mute_sender", description: "Stop mail from an address after they say yes.", parameters: obj({ address: str, confirmed: { type: "boolean" } }, ["address"]) },
    { name: "mark_not_relevant", description: "Remove a school-email to-do after they say yes.", parameters: obj({ title: str, confirmed: { type: "boolean" } }, ["title"]) },
    { name: "plan_dinners", description: "Put dinners on the meal plan after they say yes. Prefer saved meal names.", parameters: obj({ meals: { type: "array", items: obj({ date: str, name: str }, ["date", "name"]) }, confirmed: { type: "boolean" } }, ["meals"]) },
  ];
  return isChild ? all.filter((tool) => !ADULT_ONLY.has(tool.name)) : all;
}

function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? args as Record<string, unknown> : {};
}

function textArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key].trim() : "";
}

function idList(args: Record<string, unknown>, snap: ChatSnapshot): string[] {
  const raw = args.profileIds;
  if (!Array.isArray(raw)) return [];
  const known = new Set(snap.profiles.map((person) => person.id));
  return raw.filter((id): id is string => typeof id === "string" && known.has(id));
}

function ask(what: string): { output: { needsConfirmation: true; ask: string }; action: null; handoff: false } {
  return { output: { needsConfirmation: true, ask: `Ask the user to confirm first: ${what}. Call again with confirmed=true only after they say yes.` }, action: null, handoff: false };
}

/** Validate one tool call against this household. External calendars hand back to the app. */
export function handleToolCall(
  name: string,
  args: unknown,
  snap: ChatSnapshot,
  saidYes: boolean,
): { output: unknown; action: ChatAction | null; handoff: boolean } {
  if (snap.isChild && ADULT_ONLY.has(name)) {
    return { output: { error: "Not available for a child." }, action: null, handoff: false };
  }
  const input = asRecord(args);
  const confirmed = input.confirmed === true && saidYes;
  if (NEEDS_YES.has(name) && !confirmed) return ask(name.split("_").join(" "));

  if (name === "create_task") {
    const title = textArg(input, "title");
    if (!title) return { output: { error: "A to-do needs a title." }, action: null, handoff: false };
    const profileIds = idList(input, snap);
    return { output: { ok: true, title }, action: { kind: "create_task", title, profileIds }, handoff: false };
  }
  if (name === "complete_task") {
    const chore = snap.chores.find((item) => item.id === textArg(input, "choreId"));
    if (!chore) return { output: { error: "I don't see that chore." }, action: null, handoff: false };
    const profileId = (chore.profileIds ?? []).find((id) => snap.profiles.some((person) => person.id === id)) ?? snap.profiles[0]?.id;
    if (!profileId) return { output: { error: "Nobody to give the points to." }, action: null, handoff: false };
    return { output: { ok: true, title: chore.title }, action: { kind: "complete_task", choreId: chore.id, profileId }, handoff: false };
  }
  if (name === "create_event") {
    const title = textArg(input, "title");
    const start = textArg(input, "start");
    const end = textArg(input, "end") || start;
    if (!title || !start) return { output: { error: "An event needs a title and a start." }, action: null, handoff: false };
    return {
      output: { ok: true, title },
      action: { kind: "create_event", title, start, end, location: textArg(input, "location") || null, profileIds: idList(input, snap) },
      handoff: false,
    };
  }
  const event = () => snap.events.find((item) => item.id === textArg(input, "eventId"));
  if (name === "update_event" || name === "delete_event") {
    const found = event();
    if (!found) return { output: { error: "I don't see that event." }, action: null, handoff: false };
    if (found.source === "google" || found.source === "outlook" || found.source === "ical") {
      return { output: { handoff: true, where: found.source }, action: null, handoff: true };
    }
    if (name === "delete_event") {
      return { output: { ok: true, title: found.title }, action: { kind: "delete_event", eventId: found.id }, handoff: false };
    }
    const patch: Record<string, unknown> = {};
    if (textArg(input, "title")) patch.title = textArg(input, "title");
    if (textArg(input, "start")) patch.startTime = textArg(input, "start");
    if (textArg(input, "end")) patch.endTime = textArg(input, "end");
    if (typeof input.location === "string") patch.location = textArg(input, "location") || null;
    if (Array.isArray(input.profileIds)) patch.profileIds = idList(input, snap);
    return { output: { ok: true, title: found.title }, action: { kind: "update_event", eventId: found.id, patch }, handoff: false };
  }
  if (name === "remember_fact") {
    const person = snap.profiles.find((item) => item.id === textArg(input, "profileId"));
    const fact = textArg(input, "fact");
    if (!person || !fact) return { output: { error: "I need a person and a fact." }, action: null, handoff: false };
    const facts = [...(person.facts ?? [])];
    if (!facts.some((item) => item.toLowerCase() === fact.toLowerCase())) facts.push(fact);
    return { output: { ok: true, name: person.name }, action: { kind: "remember_fact", profileId: person.id, facts }, handoff: false };
  }
  if (name === "set_school" || name === "forget_school") {
    const person = snap.profiles.find((item) => item.id === textArg(input, "profileId"));
    if (!person) return { output: { error: "I don't see that person." }, action: null, handoff: false };
    const school = name === "forget_school" ? null : textArg(input, "school");
    if (name === "set_school" && !school) return { output: { error: "A school needs a name." }, action: null, handoff: false };
    return { output: { ok: true, name: person.name }, action: { kind: "set_school", profileId: person.id, school }, handoff: false };
  }
  if (name === "assign") {
    const chore = snap.chores.find((item) => item.id === textArg(input, "choreId"));
    if (!chore) return { output: { error: "I don't see that chore." }, action: null, handoff: false };
    return { output: { ok: true }, action: { kind: "assign", choreId: chore.id, profileIds: idList(input, snap) }, handoff: false };
  }
  if (name === "grocery_have") {
    const item = textArg(input, "name");
    if (!item) return { output: { error: "Name the grocery." }, action: null, handoff: false };
    return { output: { ok: true, name: item }, action: { kind: "grocery_have", name: item }, handoff: false };
  }
  if (name === "mute_sender") {
    const address = textArg(input, "address");
    if (!address.includes("@")) return { output: { error: "That is not an email address." }, action: null, handoff: false };
    return { output: { ok: true }, action: { kind: "mute_sender", address: address.toLowerCase() }, handoff: false };
  }
  if (name === "mark_not_relevant") {
    const title = textArg(input, "title");
    if (!title) return { output: { error: "Name the item." }, action: null, handoff: false };
    return { output: { ok: true }, action: { kind: "not_relevant", title }, handoff: false };
  }
  if (name === "plan_dinners") {
    const raw = input.meals;
    const dinners = (Array.isArray(raw) ? raw : []).flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const date = typeof (row as { date?: unknown }).date === "string" ? (row as { date: string }).date.trim() : "";
      const meal = typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !meal) return [];
      return [{ date, name: meal.slice(0, 80) }];
    }).slice(0, 14);
    if (dinners.length === 0) return { output: { error: "Name a date and a dinner." }, action: null, handoff: false };
    if (!confirmed) return ask(dinners.map((dinner) => `${dinner.date}: ${dinner.name}`).join(", "));
    return { output: { ok: true }, action: { kind: "plan_dinners", dinners }, handoff: false };
  }
  return { output: { error: `Unknown tool ${name}` }, action: null, handoff: false };
}
