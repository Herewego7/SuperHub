import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { completionBonuses, pointAdjustments } from "@workspace/db";
import { storage } from "../storage";

// Extracted from the GET /api/weekly-recap handler in routes.ts so both the
// in-app card and the weekly-recap push notification scheduler share one
// source of truth for the computation.
export async function buildWeeklyRecap(userId: string, now: Date = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6); // last 7 days inclusive
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const profiles = (await storage.getProfilesByUser(userId)).filter((p) => !p.isAllFamilyProfile);
  const allChoreIds = new Set((await storage.getChoresByUser(userId)).map((c) => c.id));

  const completionsByProfile = await Promise.all(
    profiles.map(async (p) => {
      const all = await storage.getChoreCompletionsByProfile(p.id);
      const recent = all.filter((c) => {
        const t = new Date(c.completedAt as any).getTime();
        return t >= start.getTime() && t <= end.getTime() && allChoreIds.has(c.choreId);
      });
      // Summing completions' own `points` alone undercounts a
      // `per_completion`-mode family to near-zero: in that mode, individual
      // checklist chores are stored with 0 points each (the real reward is a
      // once-daily "finished everything" bonus, tracked in a separate
      // completion_bonuses row) — the same authoritative-ledger gap already
      // fixed for the star pills/Home/Tasks tab, just never applied here.
      // Point adjustments (a parent's manual +/-) are included too, for the
      // same "this is the real weekly total" reason. Unconditional and safe
      // for `per_chore`-mode families too: their completions already carry
      // real points and this family simply has no bonus/adjustment rows in
      // the window, so both additions are 0.
      const bonusRows = await db.select().from(completionBonuses).where(and(
        eq(completionBonuses.profileId, p.id),
        gte(completionBonuses.localDayStart, start),
        lte(completionBonuses.localDayStart, end),
      ));
      const adjustmentRows = await db.select().from(pointAdjustments).where(and(
        eq(pointAdjustments.profileId, p.id),
        gte(pointAdjustments.createdAt, start),
        lte(pointAdjustments.createdAt, end),
      ));
      const points =
        recent.reduce((s, c) => s + (c.points || 0), 0) +
        bonusRows.reduce((s, b) => s + (b.points || 0), 0) +
        adjustmentRows.reduce((s, a) => s + (a.delta || 0), 0);
      return {
        profileId: p.id,
        name: p.name,
        color: p.color,
        // Pre-existing: `emoji` isn't in the Profile type, but the original
        // (pre-extraction) inline handler read it the same way via the
        // route's loosely-typed `req: any` context masking the error.
        emoji: (p as any).emoji,
        completions: recent.length,
        points,
      };
    }),
  );

  const events = (await storage.getEventsByDateRange(start, end))
    .filter((e) => e.userId === userId)
    .map((e) => ({ id: e.id, title: e.title, startTime: e.startTime, isAllDay: e.isAllDay }));

  const shoutoutsAll = await storage.listShoutoutsForUser(userId, 200);
  const shoutouts = shoutoutsAll
    .filter((s) => new Date(s.createdAt as any).getTime() >= start.getTime())
    .map((s) => ({
      id: s.id,
      fromProfileId: s.fromProfileId,
      toProfileId: s.toProfileId,
      emoji: s.emoji,
      message: s.message,
      createdAt: s.createdAt,
    }));

  const totalCompletions = completionsByProfile.reduce((s, p) => s + p.completions, 0);
  const totalPoints = completionsByProfile.reduce((s, p) => s + p.points, 0);
  const topPerformer = completionsByProfile.slice().sort((a, b) => b.points - a.points)[0] ?? null;

  return {
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    totalCompletions,
    totalPoints,
    topPerformer,
    byProfile: completionsByProfile,
    events,
    shoutouts,
  };
}
