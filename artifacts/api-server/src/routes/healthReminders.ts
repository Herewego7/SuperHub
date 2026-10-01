import type { Express, Request } from "express";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";

function getUserId(req: Request): string | null {
  const u = (req as unknown as { user?: { claims?: { sub?: string } } }).user;
  return u?.claims?.sub ?? null;
}

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: z.string().datetime() }),
  z.object({ kind: z.literal("daily"), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({
    kind: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  z.object({
    kind: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
]);

const createBodySchema = z.object({
  profileId: z.string().min(1),
  type: z.enum(["medication", "appointment", "refill", "generic"]).default("generic"),
  title: z.string().min(1).max(200),
  dose: z.string().max(200).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  scheduleJson: scheduleSchema,
  recipientsJson: z.array(z.string()).default([]),
  snoozeMinutes: z.number().int().min(1).max(240).default(15),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

const updateBodySchema = createBodySchema.partial();

export function registerHealthReminderRoutes(app: Express): void {
  app.get("/api/health-reminders", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const includePaused = req.query.includePaused === "true";
    const rows = await storage.getHealthRemindersByUser(userId, { profileId, includePaused });
    return res.json(rows);
  });

  app.post("/api/health-reminders", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    // Validate profile ownership.
    const profile = await storage.getProfile(parsed.data.profileId);
    if (!profile || profile.userId !== userId) {
      return res.status(400).json({ error: "Invalid profileId" });
    }
    // Validate every recipient profile belongs to the same user.
    if (parsed.data.recipientsJson.length > 0) {
      const recipients = await Promise.all(
        parsed.data.recipientsJson.map((id) => storage.getProfile(id)),
      );
      if (recipients.some((p) => !p || p.userId !== userId)) {
        return res.status(400).json({ error: "Invalid recipient profileId" });
      }
    }
    const created = await storage.createHealthReminder({
      userId,
      profileId: parsed.data.profileId,
      type: parsed.data.type,
      title: parsed.data.title,
      dose: parsed.data.dose ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
      scheduleJson: parsed.data.scheduleJson,
      recipientsJson: parsed.data.recipientsJson,
      snoozeMinutes: parsed.data.snoozeMinutes,
      isPaused: false,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(),
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    });
    return res.status(201).json(created);
  });

  app.patch("/api/health-reminders/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    if (parsed.data.recipientsJson && parsed.data.recipientsJson.length > 0) {
      const recipients = await Promise.all(
        parsed.data.recipientsJson.map((id) => storage.getProfile(id)),
      );
      if (recipients.some((p) => !p || p.userId !== userId)) {
        return res.status(400).json({ error: "Invalid recipient profileId" });
      }
    }
    const updates: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.startsAt) updates.startsAt = new Date(parsed.data.startsAt);
    if (parsed.data.endsAt !== undefined) updates.endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
    const updated = await storage.updateHealthReminder(req.params.id, updates, userId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  });

  app.delete("/api/health-reminders/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const ok = await storage.deleteHealthReminder(req.params.id, userId);
    if (!ok) return res.status(404).json({ error: "Not found" });
    return res.status(204).send();
  });

  app.post("/api/health-reminders/:id/pause", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const updated = await storage.updateHealthReminder(req.params.id, { isPaused: true }, userId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  });

  app.post("/api/health-reminders/:id/resume", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const updated = await storage.updateHealthReminder(req.params.id, { isPaused: false }, userId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  });

  app.get("/api/health-reminder-events", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = req.query.limit ? Math.min(200, Number(req.query.limit) || 50) : 50;
    if (req.query.unack === "true") {
      const rows = await storage.getUnacknowledgedHealthReminderEvents(userId);
      return res.json(rows);
    }
    const rows = await storage.getHealthReminderEvents(userId, { profileId, status, limit });
    return res.json(rows);
  });

  /**
   * A device fired a reminder itself; record it so the dose can be acknowledged.
   *
   * ⚠️ Without this, moving medication reminders onto the device quietly broke
   * the rest of the feature. The "Health reminders to acknowledge" card on Home
   * is driven by health_reminder_events, and only the server's scheduler ever
   * created those rows. On Autoscale that scheduler is asleep, so a reminder
   * now fires perfectly on the phone and then has nowhere to be acknowledged:
   * Home shows no card, the notification's deep link has nothing to point at,
   * and the dose goes unrecorded (2026-09-29).
   *
   * The reminder id is checked against this household before anything is
   * written — the client supplies it, so it is not trusted.
   */
  app.post("/api/health-reminder-events/ensure", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = z
      .object({
        reminderId: z.string().min(1),
        // When the notification was due, not when the app got round to
        // reporting it. ensureHealthReminderEvent keys on (reminderId,
        // scheduledAt), so an accurate value is what makes this idempotent
        // across several devices reporting the same dose.
        scheduledAt: z.string().datetime(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

    const reminder = await storage.getHealthReminder(parsed.data.reminderId, userId);
    if (!reminder) return res.status(404).json({ error: "Not found" });

    const { event, created } = await storage.ensureHealthReminderEvent({
      reminderId: reminder.id,
      userId,
      profileId: reminder.profileId,
      scheduledAt: new Date(parsed.data.scheduledAt),
    });
    // Only stamp a fresh row as fired. Re-stamping would resurrect one that has
    // already been acknowledged, so a second device reporting the same dose
    // cannot undo the tick.
    if (created) await storage.markHealthReminderEventFired(event.id);
    return res.json({ ...event, created });
  });

  app.post("/api/health-reminder-events/:id/acknowledge", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const byProfileId = typeof req.body?.byProfileId === "string" ? req.body.byProfileId : null;
    if (byProfileId) {
      const profile = await storage.getProfile(byProfileId);
      if (!profile || profile.userId !== userId) {
        return res.status(400).json({ error: "Invalid byProfileId" });
      }
    }
    const updated = await storage.acknowledgeHealthReminderEvent(req.params.id, userId, byProfileId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  });

  app.post("/api/health-reminder-events/:id/snooze", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const minutes = Math.min(240, Math.max(1, Number(req.body?.minutes) || 15));
    const until = new Date(Date.now() + minutes * 60_000);
    const updated = await storage.snoozeHealthReminderEvent(req.params.id, userId, until);
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  });
}
