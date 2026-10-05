import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { checkRateLimit } from "../replit_integrations/auth/rateLimit";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { replyWithChat, type ChatHistory } from "../chatReply";
import { eventsForChat, type ChatAction, type ChatSnapshot } from "../chatBrain";
import { connectedCalendarEvents } from "../scheduler/eveningPlan";
import { choresDismissedBySlip, dismissSlip, muteSender } from "../ingest/process";
import { slipKey } from "../ingest/parse";
import { draftLine, draftWrite, normalizeDraft, readDraft } from "../ai/draft";
import { conditionText, type TemperatureUnit } from "../ai/weather";
import { dinnerCalendarChange, dinnerEventInsert, dinnerLeavesTheApp } from "../meals/dinnerEvent";
import { syncEventCreate, syncEventDelete, syncEventUpdate } from "../calendarSync";

function ownerId(req: any): string {
  return req.familyOwnerId ?? req.user?.claims?.sub;
}

function historyOf(body: unknown): ChatHistory {
  if (!Array.isArray(body)) return [];
  return body.flatMap((turn) => {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") return [];
    const text = turn.text.trim().slice(0, 2000);
    return text ? [{ role: turn.role as "user" | "assistant", text }] : [];
  }).slice(-12);
}

type PlacedDinner = { id: string; name: string; date: string; slot: string; ingredients: { id: string; item: string; quantity?: string | null }[] };
type DinnerRow = { id: string; date: string; slot: string; name: string; notes?: string | null; recipeUrl?: string | null; directions?: string | null; sourceName?: string | null };
type SavedDinner = DinnerRow;
type SavedIngredient = { savedMealId: string; item: string; quantity?: string | null; displayOrder?: number | null };

async function placeDinners(userId: string, dinners: { date: string; name: string }[]): Promise<PlacedDinner[]> {
  const [settings, location, events] = await Promise.all([
    storage.getCalendarSettingsByUser(userId),
    storage.getLocationSettingsByUser(userId),
    storage.getEventsByUser(userId),
  ]);
  const existing = await storage.getMealsByUser(userId) as DinnerRow[];
  const saved = await storage.getSavedMealsByUser(userId) as SavedDinner[];
  const ideas = saved.length > 0
    ? await storage.getSavedMealIngredients(saved.map((meal) => meal.id)) as SavedIngredient[]
    : [];
  const timeZone = location?.timezone || "America/Chicago";
  const enabled = settings?.mealsOnCalendar === true;
  const byDate = new Map(existing.filter((meal) => meal.slot === "dinner").map((meal) => [meal.date, meal]));
  const placed: PlacedDinner[] = [];
  for (const dinner of dinners) {
    const idea = saved.find((meal) => meal.name.trim().toLowerCase() === dinner.name.trim().toLowerCase());
    const ingredients = idea
      ? ideas.filter((row) => row.savedMealId === idea.id).map((row, index) => ({ item: row.item, quantity: row.quantity, displayOrder: row.displayOrder ?? index }))
      : [];
    const fields = {
      name: (idea?.name ?? dinner.name).trim(),
      notes: idea?.notes ?? null,
      recipeUrl: idea?.recipeUrl && /^https?:\/\//i.test(idea.recipeUrl) ? idea.recipeUrl : null,
      directions: idea?.directions ?? null,
      sourceName: idea?.sourceName ?? null,
      importedAt: idea ? new Date() : null,
    };
    const previous = byDate.get(dinner.date);
    const meal = (previous
      ? await storage.updateMeal(previous.id, fields, userId)
      : await storage.createMeal({ userId, date: dinner.date, slot: "dinner", ...fields })) as DinnerRow | undefined;
    if (!meal) continue;
    const savedIngredients = await storage.replaceMealIngredients(meal.id, ingredients);
    if (previous) {
      const change = dinnerCalendarChange(previous, meal, events, settings?.familyCalendarId, enabled, timeZone);
      if (change.updateId && change.create) {
        const updated = await storage.updateEvent(change.updateId, change.create, userId);
        if (updated && dinnerLeavesTheApp(updated)) void syncEventUpdate(updated).catch(() => undefined);
      }
      for (const id of change.deleteIds) {
        const links = await storage.getEventCalendarSyncs(id).catch(() => []);
        await storage.deleteEvent(id, userId);
        void syncEventDelete(links).catch(() => undefined);
      }
      if (!change.updateId && change.create) {
        const created = await storage.createEvent({ ...change.create, userId });
        if (dinnerLeavesTheApp(created)) void syncEventCreate(created).catch(() => undefined);
      }
    } else {
      const dinnerEvent = dinnerEventInsert(meal, settings?.familyCalendarId, enabled, timeZone);
      if (dinnerEvent) {
        const created = await storage.createEvent({ ...dinnerEvent, userId });
        if (dinnerLeavesTheApp(created)) void syncEventCreate(created).catch(() => undefined);
      }
    }
    byDate.set(dinner.date, meal);
    placed.push({ id: meal.id, name: meal.name, date: meal.date, slot: meal.slot, ingredients: savedIngredients });
  }
  return placed;
}

async function applyAction(userId: string, action: ChatAction): Promise<PlacedDinner[]> {
  if (action.kind === "create_task") {
    await storage.createChore({
      userId,
      title: action.title.slice(0, 200),
      description: action.description,
      taskType: "todo",
      points: 0,
      profileIds: action.profileIds,
      daysOfWeek: action.once ? [] : [0, 1, 2, 3, 4, 5, 6],
      ...(action.once ? {} : { recurrenceType: "daily" as const }),
      isActive: true,
    });
    return [];
  }
  if (action.kind === "complete_task") {
    const chore = (await storage.getChoresByUser(userId)).find((item) => item.id === action.choreId);
    await storage.createChoreCompletion({
      choreId: action.choreId,
      profileId: action.profileId,
      points: chore?.points ?? 0,
    });
    return [];
  }
  if (action.kind === "create_event") {
    const start = new Date(action.start);
    const end = new Date(action.end);
    if (Number.isNaN(start.getTime())) return [];
    await storage.createEvent({
      userId,
      title: action.title.slice(0, 200),
      startTime: start,
      endTime: Number.isNaN(end.getTime()) ? start : end,
      location: action.location,
      profileIds: action.profileIds,
      source: "app",
    });
    return [];
  }
  if (action.kind === "update_event") {
    const patch = { ...action.patch };
    if (typeof patch.startTime === "string") patch.startTime = new Date(patch.startTime);
    if (typeof patch.endTime === "string") patch.endTime = new Date(patch.endTime);
    await storage.updateEvent(action.eventId, patch as Parameters<typeof storage.updateEvent>[1], userId);
    return [];
  }
  if (action.kind === "delete_event") {
    await storage.deleteEvent(action.eventId, userId);
    return [];
  }
  if (action.kind === "remember_fact") {
    await storage.updateProfile(action.profileId, { facts: action.facts }, userId);
    return [];
  }
  if (action.kind === "set_school") {
    await storage.updateProfile(action.profileId, { school: action.school }, userId);
    return [];
  }
  if (action.kind === "assign") {
    await storage.updateChore(action.choreId, { profileIds: action.profileIds }, userId);
    return [];
  }
  if (action.kind === "plan_dinners") return placeDinners(userId, action.dinners);
  if (action.kind === "grocery_have") {
    const items = await storage.getGroceryItemsByUser(userId);
    const found = items.find((item) => item.name.toLowerCase() === action.name.toLowerCase());
    if (found) await storage.updateGroceryItem(found.id, { alreadyHave: true }, userId);
    else await storage.createGroceryItem({ userId, name: action.name, alreadyHave: true });
    return [];
  }
  if (action.kind === "mute_sender") {
    const settings = await storage.getCalendarSettingsByUser(userId);
    const next = muteSender({ mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] }, action.address);
    await storage.updateCalendarSettings({ mutedSenders: next.mutedSenders, userId });
    return [];
  }
  if (action.kind === "not_relevant") {
    const key = slipKey(action.title);
    if (!key) return [];
    const settings = await storage.getCalendarSettingsByUser(userId);
    const next = dismissSlip({ mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] }, key);
    for (const id of choresDismissedBySlip(await storage.getChoresByUser(userId), key)) {
      await storage.deleteChore(id, userId);
    }
    await storage.updateCalendarSettings({ dismissedSlipKeys: next.dismissedSlipKeys, userId });
    const { rememberRecord } = await import("../ai/memory");
    void rememberRecord(userId, "example", action.title);
  }
  if (action.kind === "feedback") {
    const { feedbackNotes, db } = await import("@workspace/db");
    await db.insert(feedbackNotes).values({ userId, text: action.text.slice(0, 2000) }).catch(() => undefined);
  }
  return [];
}

function changedKeys(actions: ChatAction[]): string[] {
  const keys = new Set<string>();
  for (const action of actions) {
    if (action.kind === "create_task" || action.kind === "complete_task" || action.kind === "assign" || action.kind === "not_relevant") keys.add("chores");
    if (action.kind === "create_event" || action.kind === "update_event" || action.kind === "delete_event") keys.add("events");
    if (action.kind === "remember_fact" || action.kind === "set_school") keys.add("profiles");
    if (action.kind === "grocery_have") keys.add("groceries");
    if (action.kind === "plan_dinners") {
      keys.add("meals");
      keys.add("events");
    }
    if (action.kind === "mute_sender" || action.kind === "not_relevant") keys.add("mail");
  }
  return [...keys];
}

async function homeForecast(lat?: number | null, lon?: number | null, unit: TemperatureUnit = "fahrenheit"): Promise<{ date: string; high: number; low: number; condition: string }[]> {
  if (lat == null || lon == null) return [];
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&temperature_unit=${unit}&forecast_days=7`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const data = await res.json() as { daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; weathercode?: number[] } };
    return (data.daily?.time ?? []).map((date, index) => ({
      date,
      high: Math.round(data.daily?.temperature_2m_max?.[index] ?? 0),
      low: Math.round(data.daily?.temperature_2m_min?.[index] ?? 0),
      condition: conditionText(data.daily?.weathercode?.[index] ?? -1),
    }));
  } catch {
    return [];
  }
}

async function rememberedNotes(userId: string): Promise<string[]> {
  const { recentRecords } = await import("../ai/memory");
  const rows = await recentRecords(userId, "chunk", 40);
  return rows.map((row) => row.text);
}

export function registerChatRoutes(app: Express): void {
  app.post("/api/plan/draft", isAuthenticated, async (req: any, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 1000) : "";
      if (!text) {
        res.status(400).json({ message: "Type a sentence first." });
        return;
      }
      const userId = ownerId(req);
      const profiles = await storage.getProfilesByUser(userId);
      const names = profiles.filter((profile: { isAllFamilyProfile?: boolean | null }) => !profile.isAllFamilyProfile).map((profile: { name: string }) => profile.name);
      const draft = await readDraft(text, names, new Date());
      res.json({ draft, line: draftLine(draft) });
    } catch (err) {
      console.error("Plan draft failed:", err);
      res.status(500).json({ message: "Couldn't read that sentence." });
    }
  });

  app.post("/api/plan/draft/save", isAuthenticated, async (req: any, res) => {
    try {
      const userId = ownerId(req);
      const profiles = await storage.getProfilesByUser(userId);
      const people = profiles
        .filter((profile: { isAllFamilyProfile?: boolean | null }) => !profile.isAllFamilyProfile)
        .map((profile: { id: string; name: string }) => ({ id: profile.id, name: profile.name }));
      const draft = normalizeDraft(req.body?.draft, people.map((person: { name: string }) => person.name));
      if (!draft) {
        res.status(400).json({ message: "That draft is missing a title." });
        return;
      }
      const location = await storage.getLocationSettingsByUser(userId);
      const write = draftWrite(draft, people, new Date(), location?.timezone || "America/Chicago");
      if (!write) {
        res.status(400).json({ message: "Add a date before saving this." });
        return;
      }
      if (write.kind === "todo") {
        await storage.createChore({
          userId,
          title: write.title,
          description: write.description,
          taskType: "todo",
          points: 0,
          profileIds: write.profileIds,
          daysOfWeek: [],
          isActive: true,
        });
      } else {
        await storage.createEvent({
          userId,
          title: write.title,
          description: write.description || null,
          startTime: write.start,
          endTime: write.end,
          isAllDay: write.allDay,
          profileIds: write.profileIds,
          source: "app",
        });
      }
      res.json({ saved: true, kind: write.kind });
    } catch (err) {
      console.error("Plan draft save failed:", err);
      res.status(500).json({ message: "Couldn't save that." });
    }
  });

  app.post("/api/chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = ownerId(req);
      if (!checkRateLimit(`chat:${userId}`, 30, 10 * 60 * 1000)) {
        res.status(429).json({ message: "Too many messages. Wait a few minutes." });
        return;
      }
      const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2000) : "";
      if (!text) {
        res.status(400).json({ message: "A message is required." });
        return;
      }
      const isChild = req.body?.isChild === true;
      const [profiles, storedEvents, chores, completions, meals, savedMeals, celebrations, groceries, location, account, outsideEvents] = await Promise.all([
        storage.getProfilesByUser(userId),
        storage.getEventsByUser(userId),
        storage.getChoresByUser(userId),
        storage.getChoreCompletionsByUser(userId),
        storage.getMealsByUser(userId),
        storage.getSavedMealsByUser(userId),
        storage.getCelebrationsByUser(userId),
        storage.getGroceryItemsByUser(userId),
        storage.getLocationSettingsByUser(userId),
        authStorage.getUser(req.user?.claims?.sub),
        connectedCalendarEvents(userId).catch(() => []),
      ]);
      const events = eventsForChat(storedEvents, outsideEvents);
      const people = profiles.filter((profile: { isAllFamilyProfile?: boolean | null }) => !profile.isAllFamilyProfile);
      const snap: ChatSnapshot = {
        now: new Date(),
        timeZone: location?.timezone || "America/Chicago",
        firstName: account?.firstName || people[0]?.name || "there",
        isChild,
        profiles: people.map((profile: { id: string; name: string; school?: string | null; facts?: string[] | null; role?: string | null; isChild?: boolean | null }) => ({
          id: profile.id,
          name: profile.name,
          school: profile.school,
          facts: profile.facts,
          role: profile.role,
          isChild: profile.isChild,
        })),
        events: events.map((event: { id: string; title: string; startTime: string | Date; endTime?: string | Date | null; location?: string | null; profileIds?: string[] | null; drivingProfileIds?: string[] | null; source?: string | null; isAllDay?: boolean | null }) => ({
          id: event.id,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          location: event.location,
          profileIds: event.profileIds,
          drivingProfileIds: event.drivingProfileIds,
          source: event.source,
          isAllDay: event.isAllDay,
        })),
        chores: chores.map((chore: { id: string; title: string; taskType?: string | null; profileIds?: string[] | null; category?: string | null; description?: string | null; points?: number | null }) => ({
          id: chore.id,
          title: chore.title,
          taskType: chore.taskType,
          profileIds: chore.profileIds,
          category: chore.category,
          description: chore.description,
          points: chore.points,
        })),
        doneIds: completions.map((completion: { choreId: string }) => completion.choreId),
        meals: meals.map((meal: { name: string; date: string; slot?: string | null }) => ({ name: meal.name, date: meal.date, mealType: meal.slot })),
        savedMeals: savedMeals.map((meal: { id: string; name: string }) => ({ id: meal.id, name: meal.name })),
        celebrations: celebrations.map((row: { name: string; monthDay: string; type?: string | null; year?: number | null }) => ({ name: row.name, monthDay: row.monthDay, type: row.type, year: row.year })),
        groceries: groceries.filter((item: { alreadyHave?: boolean | null }) => !item.alreadyHave).map((item: { name: string }) => ({ name: item.name })),
        forecast: await homeForecast(location?.latitude, location?.longitude, (location?.country ?? "").trim().toLowerCase() === "canada" ? "celsius" : "fahrenheit"),
        temperatureUnit: (location?.country ?? "").trim().toLowerCase() === "canada" ? "celsius" : "fahrenheit",
        notes: await rememberedNotes(userId),
        findMail: isChild ? undefined : async (query: string) => {
          const { searchMemory } = await import("../ai/memory");
          return searchMemory(userId, query);
        },
      };
      const stream = req.body?.stream === true;
      const write = (row: unknown) => {
        res.write(`${JSON.stringify(row)}\n`);
      };
      if (stream) {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
      }
      const brain = await replyWithChat(snap, historyOf(req.body?.history), text, stream ? (chunk) => write({ type: "delta", text: chunk }) : undefined);
      if (brain.fallback) {
        if (stream) {
          write({ type: "fallback" });
          res.end();
          return;
        }
        res.json({ fallback: true });
        return;
      }
      const groceryMeals: PlacedDinner[] = [];
      for (const action of brain.actions) groceryMeals.push(...await applyAction(userId, action));
      const body = {
        fallback: false,
        text: brain.text,
        changed: changedKeys(brain.actions),
        groceryMeals: groceryMeals.filter((meal) => meal.ingredients.length > 0),
      };
      if (stream) {
        write({ type: "done", ...body });
        res.end();
        return;
      }
      res.json(body);
    } catch (error) {
      req.log?.error?.({ error }, "Chat reply failed");
      if (res.headersSent) {
        res.write(`${JSON.stringify({ type: "fallback" })}\n`);
        res.end();
        return;
      }
      res.json({ fallback: true });
    }
  });
}
