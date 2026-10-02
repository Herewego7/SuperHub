import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { celebrations, locationSettings } from "@workspace/db";
import { sendPushToUser } from "../lib/push";
import { pushReachedSomeone } from "../lib/pushDelivery";
import { getFamilyMemberAccountIds } from "../familyService";
import { celebrationsWithMeta } from "../lib/celebrations";
import { logger } from "../lib/logger";
import { DEFAULT_TIMEZONE } from "../lib/timezone";

// Celebrations don't carry a per-family time-of-day setting the way Daily
// Brief/Weekly Recap do — a day-granularity check is all this needs, so it
// runs on a coarser hourly tick. Dedup is persisted on the celebration row
// itself (reminder30SentYear/reminder7SentYear), keyed by the *year* of the
// upcoming occurrence — this naturally re-arms every year with no cleanup,
// the same reasoning as the behaviour-timer scheduler's persisted dedup.
const MILESTONES = [
  { days: 30, field: "reminder30SentYear" as const, label: "30 days" },
  { days: 7, field: "reminder7SentYear" as const, label: "7 days" },
];

type StampField = (typeof MILESTONES)[number]["field"];

async function claimCelebration(id: string, field: StampField, year: number, previous: number | null): Promise<boolean> {
  const stillPrevious = previous == null ? isNull(celebrations[field]) : eq(celebrations[field], previous);
  const rows = await db
    .update(celebrations)
    .set({ [field]: year })
    .where(and(eq(celebrations.id, id), stillPrevious))
    .returning({ id: celebrations.id });
  return rows.length > 0;
}

async function releaseCelebration(id: string, field: StampField, year: number, previous: number | null): Promise<void> {
  await db
    .update(celebrations)
    .set({ [field]: previous })
    .where(and(eq(celebrations.id, id), eq(celebrations[field], year)));
}

export async function runCelebrationReminderTick(now: Date = new Date()): Promise<void> {
  const rows = await db.select().from(celebrations);
  if (rows.length === 0) return;

  // Per-family timezone, the same pattern weeklyRecap/dailyBrief already use.
  // Without it "days until" is computed in the SERVER's zone (UTC on Replit),
  // which fires the 30/7-day reminders a day early for any family west of it
  // — the same off-by-one that made the app say "Tomorrow" for a birthday two
  // days out once UTC had rolled over.
  const tzCache = new Map<string, string>();
  for (const c of rows) {
    if (!c.userId || tzCache.has(c.userId)) continue;
    const loc = await db
      .select()
      .from(locationSettings)
      .where(eq(locationSettings.userId, c.userId))
      .limit(1);
    tzCache.set(c.userId, loc[0]?.timezone ?? DEFAULT_TIMEZONE);
  }

  const enriched = rows.flatMap((row) =>
    celebrationsWithMeta([row], now, tzCache.get(row.userId) ?? DEFAULT_TIMEZONE));

  for (const c of enriched) {
    const occurrenceYear = new Date(c.nextOccurrence).getFullYear();

    for (const milestone of MILESTONES) {
      if (c.daysUntil !== milestone.days) continue;
      if (c[milestone.field] === occurrenceYear) continue; // already sent for this occurrence

      const previous = c[milestone.field] ?? null;
      let claimed = false;
      try {
        claimed = await claimCelebration(c.id, milestone.field, occurrenceYear, previous);
      } catch (err) {
        logger.warn({ err, celebrationId: c.id, milestone: milestone.days }, "Celebration reminder claim failed");
        continue;
      }
      if (!claimed) continue;

      try {
        const memberIds = await getFamilyMemberAccountIds(c.userId);
        const displayName = c.type === "other" && c.customLabel ? c.customLabel : c.name;
        const occDate = new Date(c.nextOccurrence);
        const dateStr = occDate.toLocaleDateString(undefined, { month: "long", day: "numeric" });
        // Same phrasing convention as the in-app celebration cards
        // (celebrations-view.tsx's celebrationWhen): only claim an age/year
        // count when one was actually entered (ageThisYear) and the family
        // hasn't opted to hide it (showYear).
        const hasAge = c.ageThisYear !== null && c.showYear !== false;
        const occasionPhrase = !hasAge
          ? (c.type === "birthday" ? "Birthday" : c.type === "anniversary" ? "Anniversary" : "Coming up")
          : c.type === "anniversary"
          ? `${c.ageThisYear}-year anniversary`
          : c.type === "birthday"
          ? `Turns ${c.ageThisYear}`
          : `${c.ageThisYear} years`;
        // Keep the TITLE short (just the name) — iOS truncates a long title
        // to one line with no way to expand it, which is what made the old
        // "X's anniversary is in 30 days" title unreadable. The detail
        // (occasion + count + date) goes in the body, which gets several
        // lines before truncating.
        const payload = {
          title: displayName,
          body: `${occasionPhrase} in ${milestone.label} — ${dateStr}`,
          url: `/?openCelebration=${c.id}`,
          tag: `celebration-reminder-${c.id}-${milestone.days}-${occurrenceYear}`,
          data: { kind: "celebration-reminder", celebrationId: c.id },
        };
        const results = await Promise.all(
          memberIds.map((memberId) => sendPushToUser({ userId: memberId }, payload, "celebrationReminder")),
        );
        if (results.length > 0 && results.every((item) => !pushReachedSomeone(item))) {
          throw new Error("Celebration reminder reached nobody");
        }
        logger.info({ celebrationId: c.id, milestone: milestone.days }, "Celebration reminder dispatched");
      } catch (err) {
        await releaseCelebration(c.id, milestone.field, occurrenceYear, previous);
        logger.warn({ err, celebrationId: c.id, milestone: milestone.days }, "Celebration reminder failed");
      }
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startCelebrationReminderScheduler(): void {
  if (timer) return;
  const TICK_MS = 60 * 60 * 1000; // hourly — plenty for a day-granularity feature
  runCelebrationReminderTick().catch((err) =>
    logger.error({ err }, "Celebration reminder tick failed"),
  );
  timer = setInterval(() => {
    runCelebrationReminderTick().catch((err) =>
      logger.error({ err }, "Celebration reminder tick failed"),
    );
  }, TICK_MS);
  logger.info("Celebration reminder scheduler started");
}
