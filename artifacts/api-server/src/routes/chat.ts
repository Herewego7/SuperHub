import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { checkRateLimit } from "../replit_integrations/auth/rateLimit";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { replyWithChat, type ChatHistory } from "../chatReply";
import type { ChatAction, ChatSnapshot } from "../chatBrain";
import { choresDismissedBySlip, dismissSlip, muteSender } from "../ingest/process";
import { slipKey } from "../ingest/parse";

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

async function applyAction(userId: string, action: ChatAction): Promise<void> {
  if (action.kind === "create_task") {
    await storage.createChore({
      userId,
      title: action.title.slice(0, 200),
      taskType: "todo",
      points: 0,
      profileIds: action.profileIds,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      recurrenceType: "daily",
      isActive: true,
    });
    return;
  }
  if (action.kind === "complete_task") {
    const chore = (await storage.getChoresByUser(userId)).find((item) => item.id === action.choreId);
    await storage.createChoreCompletion({
      choreId: action.choreId,
      profileId: action.profileId,
      points: chore?.points ?? 0,
    });
    return;
  }
  if (action.kind === "create_event") {
    const start = new Date(action.start);
    const end = new Date(action.end);
    if (Number.isNaN(start.getTime())) return;
    await storage.createEvent({
      userId,
      title: action.title.slice(0, 200),
      startTime: start,
      endTime: Number.isNaN(end.getTime()) ? start : end,
      location: action.location,
      profileIds: action.profileIds,
      source: "app",
    });
    return;
  }
  if (action.kind === "update_event") {
    const patch = { ...action.patch };
    if (typeof patch.startTime === "string") patch.startTime = new Date(patch.startTime);
    if (typeof patch.endTime === "string") patch.endTime = new Date(patch.endTime);
    await storage.updateEvent(action.eventId, patch as Parameters<typeof storage.updateEvent>[1], userId);
    return;
  }
  if (action.kind === "delete_event") {
    await storage.deleteEvent(action.eventId, userId);
    return;
  }
  if (action.kind === "remember_fact") {
    await storage.updateProfile(action.profileId, { facts: action.facts }, userId);
    return;
  }
  if (action.kind === "set_school") {
    await storage.updateProfile(action.profileId, { school: action.school }, userId);
    return;
  }
  if (action.kind === "assign") {
    await storage.updateChore(action.choreId, { profileIds: action.profileIds }, userId);
    return;
  }
  if (action.kind === "grocery_have") {
    const items = await storage.getGroceryItemsByUser(userId);
    const found = items.find((item) => item.name.toLowerCase() === action.name.toLowerCase());
    if (found) await storage.updateGroceryItem(found.id, { alreadyHave: true }, userId);
    else await storage.createGroceryItem({ userId, name: action.name, alreadyHave: true });
    return;
  }
  if (action.kind === "mute_sender") {
    const settings = await storage.getCalendarSettingsByUser(userId);
    const next = muteSender({ mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] }, action.address);
    await storage.updateCalendarSettings({ mutedSenders: next.mutedSenders, userId });
    return;
  }
  if (action.kind === "not_relevant") {
    const key = slipKey(action.title);
    if (!key) return;
    const settings = await storage.getCalendarSettingsByUser(userId);
    const next = dismissSlip({ mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] }, key);
    for (const id of choresDismissedBySlip(await storage.getChoresByUser(userId), key)) {
      await storage.deleteChore(id, userId);
    }
    await storage.updateCalendarSettings({ dismissedSlipKeys: next.dismissedSlipKeys, userId });
  }
}

function changedKeys(actions: ChatAction[]): string[] {
  const keys = new Set<string>();
  for (const action of actions) {
    if (action.kind === "create_task" || action.kind === "complete_task" || action.kind === "assign" || action.kind === "not_relevant") keys.add("chores");
    if (action.kind === "create_event" || action.kind === "update_event" || action.kind === "delete_event") keys.add("events");
    if (action.kind === "remember_fact" || action.kind === "set_school") keys.add("profiles");
    if (action.kind === "grocery_have") keys.add("groceries");
    if (action.kind === "mute_sender" || action.kind === "not_relevant") keys.add("mail");
  }
  return [...keys];
}

export function registerChatRoutes(app: Express): void {
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
      const [profiles, events, chores, completions, meals, celebrations, groceries, location, account] = await Promise.all([
        storage.getProfilesByUser(userId),
        storage.getEventsByUser(userId),
        storage.getChoresByUser(userId),
        storage.getChoreCompletionsByUser(userId),
        storage.getMealsByUser(userId),
        storage.getCelebrationsByUser(userId),
        storage.getGroceryItemsByUser(userId),
        storage.getLocationSettingsByUser(userId),
        authStorage.getUser(req.user?.claims?.sub),
      ]);
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
        celebrations: celebrations.map((row: { name: string; monthDay: string; type?: string | null; year?: number | null }) => ({ name: row.name, monthDay: row.monthDay, type: row.type, year: row.year })),
        groceries: groceries.filter((item: { alreadyHave?: boolean | null }) => !item.alreadyHave).map((item: { name: string }) => ({ name: item.name })),
      };
      const brain = await replyWithChat(snap, historyOf(req.body?.history), text);
      if (brain.fallback) {
        res.json({ fallback: true });
        return;
      }
      for (const action of brain.actions) await applyAction(userId, action);
      res.json({ fallback: false, text: brain.text, changed: changedKeys(brain.actions) });
    } catch (error) {
      req.log?.error?.({ error }, "Chat reply failed");
      res.json({ fallback: true });
    }
  });
}
