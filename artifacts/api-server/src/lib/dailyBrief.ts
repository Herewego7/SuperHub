import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  profiles,
  events,
  celebrations,
  locationSettings,
  meals,
  type Profile,
} from "@workspace/db";
import {
  getTodayChoresForProfile,
  localDate,
  localHHMM,
  splitRemaining,
  describeRemaining,
} from "./choreToday";
import { isKidProfile } from "./profileRole";
import { DEFAULT_TIMEZONE } from "./timezone";
import { driverIdsOf } from "./eventDrivers";
import { loadProfiles } from "./profileRows";

export interface DailyBriefItem {
  id: string;
  title: string;
  time?: string;
  meta?: string;
}

export interface DailyBrief {
  profileId: string | null;
  profileName: string;
  date: string;
  events: DailyBriefItem[];
  chores: {
    remaining: number;
    total: number;
    titles: string[];
    // Per-person remaining counts (only people with remaining > 0), split
    // into regular/daily chores, still-unmet target-count chores, and
    // Inspiration items (affirmation/verse/mission — not actually "chores")
    // — set whenever this brief covers more than one person (the family-wide
    // dashboard brief, or a parent/adult's own push, whose personal chore
    // count is usually 0 and not what they actually want to see). A kid's
    // own brief stays scoped to just themself and this is left undefined.
    byPerson?: { name: string; regular: number; target: number; inspiration: number }[];
    // Aggregate split (regular/daily vs. still-unmet target-count vs.
    // Inspiration), always populated regardless of scope — used for the
    // self-only (kid's own) headline, where byPerson is intentionally left
    // unset.
    regularRemaining: number;
    inspirationRemaining: number;
    targetRemaining: number;
  };
  meals: DailyBriefItem[];
  driving: DailyBriefItem[];
  celebrations: DailyBriefItem[];
  headline: string;
  sections: {
    events: boolean;
    chores: boolean;
    meals: boolean;
    driving: boolean;
    celebrations: boolean;
  };
}

const DEFAULT_SECTIONS = {
  events: true,
  chores: true,
  meals: true,
  driving: true,
  celebrations: true,
} as const;

async function getUserTimezone(userId: string): Promise<string> {
  const loc = await db
    .select()
    .from(locationSettings)
    .where(eq(locationSettings.userId, userId))
    .limit(1);
  return loc[0]?.timezone ?? DEFAULT_TIMEZONE;
}

export async function buildDailyBrief(
  userId: string,
  profile: Profile | null,
  now: Date = new Date(),
  tzOverride?: string,
): Promise<DailyBrief> {
  const tz = tzOverride ?? (await getUserTimezone(userId));
  const today = localDate(now, tz);
  const wideStart = new Date(`${today}T00:00:00Z`);
  wideStart.setUTCDate(wideStart.getUTCDate() - 1);
  const wideEnd = new Date(`${today}T23:59:59Z`);
  wideEnd.setUTCDate(wideEnd.getUTCDate() + 1);

  const sections = {
    ...DEFAULT_SECTIONS,
    ...((profile?.dailyBriefSections as Partial<typeof DEFAULT_SECTIONS> | null) ?? {}),
  };

  // A kid's own brief stays scoped to just themself throughout (events,
  // driving, chores below). Everything else — the family-wide dashboard
  // brief (profile === null), and a parent/adult's own push — shows the
  // WHOLE family's events/driving/chores, not just whatever's assigned to
  // that one profile. A parent's own personal events/driving/chores are
  // usually sparse-to-empty, so scoping their brief to just themself meant
  // it frequently had nothing real to say even on a day full of family
  // activity (a kid's soccer game, someone else driving carpool, etc).
  const scopeToSelfOnly = !!profile && isKidProfile(profile);

  // ---- Events ----
  const allEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        gte(events.startTime, wideStart),
        lte(events.startTime, wideEnd),
      ),
    );
  const todaysAllEvents = allEvents
    .filter((e) => localDate(e.startTime, tz) === today)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const todaysEvents = !sections.events
    ? []
    : todaysAllEvents
        .filter((e) => {
          if (!scopeToSelfOnly) return true;
          const ids = (e.profileIds as string[] | null) ?? [];
          return ids.length === 0 || ids.includes(profile!.id);
        })
        .map<DailyBriefItem>((e) => ({
          id: e.id,
          title: e.title,
          time: e.isAllDay ? undefined : localHHMM(e.startTime, tz),
          meta: e.location ?? undefined,
        }));

  // ---- Driving (events where this profile is the assigned driver) ----
  const driving: DailyBriefItem[] = !sections.driving
    ? []
    : todaysAllEvents
        .filter((e) => {
          const drivers = driverIdsOf(e);
          if (drivers.length === 0) return false;
          if (!scopeToSelfOnly) return true; // family/parent brief: any driver
          return drivers.includes(profile!.id);
        })
        .map<DailyBriefItem>((e) => ({
          id: e.id,
          title: e.title,
          time: e.isAllDay ? undefined : localHHMM(e.startTime, tz),
          meta: e.location ?? undefined,
        }));

  // ---- Chores: due today, not yet completed by this profile (or whole family) ----
  // byPerson (below) is what surfaces the family breakdown in the headline.
  let chorePart: DailyBrief["chores"] = { remaining: 0, total: 0, titles: [], regularRemaining: 0, targetRemaining: 0, inspirationRemaining: 0 };
  if (sections.chores) {
    const targetProfiles: Profile[] = scopeToSelfOnly
      ? [profile!]
      : (await loadProfiles(eq(profiles.userId, userId)))
          .filter((p) => !p.isAllFamilyProfile);

    let totalDue = 0;
    let totalRemaining = 0;
    let totalRegular = 0;
    let totalTarget = 0;
    let totalInspiration = 0;
    const remainingTitles: string[] = [];
    const byPerson: { name: string; regular: number; target: number; inspiration: number }[] = [];
    for (const p of targetProfiles) {
      const { due, completedIds } = await getTodayChoresForProfile(
        userId,
        p.id,
        now,
        tz,
      );
      totalDue += due.length;
      for (const c of due) {
        if (!completedIds.has(c.id)) {
          totalRemaining += 1;
          if (remainingTitles.length < 3) {
            remainingTitles.push(scopeToSelfOnly ? c.title : `${c.title} (${p.name})`);
          }
        }
      }
      const { regular, target, inspiration } = splitRemaining(due, completedIds);
      totalRegular += regular;
      totalTarget += target;
      totalInspiration += inspiration;
      if (regular + target + inspiration > 0) byPerson.push({ name: p.name, regular, target, inspiration });
    }
    chorePart = {
      total: totalDue,
      remaining: totalRemaining,
      titles: remainingTitles,
      regularRemaining: totalRegular,
      targetRemaining: totalTarget,
      inspirationRemaining: totalInspiration,
      byPerson: scopeToSelfOnly ? undefined : byPerson,
    };
  }

  // ---- Meals (anything planned for today's local date) ----
  const todayMeals: DailyBriefItem[] = !sections.meals
    ? []
    : (await db
        .select()
        .from(meals)
        .where(and(eq(meals.userId, userId), eq(meals.date, today))))
        .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot))
        .map<DailyBriefItem>((m) => ({
          id: m.id,
          title: m.name,
          meta: m.slot,
        }));

  // ---- Celebrations (matching today's MM-DD) ----
  const monthDay = today.slice(5);
  const todayCelebs: DailyBriefItem[] = !sections.celebrations
    ? []
    : (await db.select().from(celebrations).where(eq(celebrations.userId, userId)))
        .filter((c) => c.monthDay === monthDay)
        .map<DailyBriefItem>((c) => ({
          id: c.id,
          title: c.customLabel || `${c.type === "anniversary" ? "Anniversary" : "Birthday"}`,
          meta: c.year ? `Turning ${new Date().getUTCFullYear() - c.year}` : undefined,
        }));

  return {
    profileId: profile?.id ?? null,
    profileName: profile?.name ?? "Everyone",
    date: today,
    events: todaysEvents,
    chores: chorePart,
    meals: todayMeals,
    driving,
    celebrations: todayCelebs,
    sections,
    headline: composeHeadline({
      events: todaysEvents.length,
      chores: chorePart,
      meals: todayMeals.length,
      driving: driving.length,
      celebrations: todayCelebs.length,
    }),
  };
}

function slotOrder(slot: string): number {
  return slot === "breakfast" ? 0 : slot === "lunch" ? 1 : slot === "dinner" ? 2 : 3;
}

function composeHeadline(counts: {
  events: number;
  chores: DailyBrief["chores"];
  meals: number;
  driving: number;
  celebrations: number;
}): string {
  const parts: string[] = [];
  if (counts.events > 0) parts.push(`${counts.events} event${counts.events === 1 ? "" : "s"}`);
  if (counts.chores.remaining > 0) {
    // Multi-person briefs (family dashboard, or a parent/adult's own push)
    // name who has chores left rather than folding everyone into one opaque
    // total — a parent's own chore list is usually empty, so "N chores" on
    // their own brief used to mean nothing actionable. Regular/daily chores
    // and still-unmet target-count chores are called out separately in
    // both cases, since "3 chores" reads as three same-kind tasks when it
    // might really be 1 chore plus 2 targets still short of their weekly
    // count.
    if (counts.chores.byPerson && counts.chores.byPerson.length > 0) {
      parts.push(
        `Chores remaining: ${counts.chores.byPerson.map((p) => `${p.name} — ${describeRemaining(p.regular, p.target, p.inspiration)}`).join(", ")}`,
      );
    } else {
      parts.push(`Chores remaining: ${describeRemaining(counts.chores.regularRemaining, counts.chores.targetRemaining, counts.chores.inspirationRemaining)}`);
    }
  }
  if (counts.meals > 0) parts.push(`${counts.meals} meal${counts.meals === 1 ? "" : "s"}`);
  if (counts.driving > 0) parts.push(`driving ${counts.driving}`);
  if (counts.celebrations > 0) {
    parts.push(`${counts.celebrations} celebration${counts.celebrations === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "Nothing on the calendar today — enjoy!";
  return `Today: ${parts.join(" · ")}`;
}

export async function buildBriefsForUser(
  userId: string,
  now: Date = new Date(),
): Promise<DailyBrief[]> {
  const tz = await getUserTimezone(userId);
  const userProfiles = await loadProfiles(eq(profiles.userId, userId));
  const real = userProfiles.filter((p) => !p.isAllFamilyProfile);
  const family = await buildDailyBrief(userId, null, now, tz);
  const perProfile = await Promise.all(
    real.map((p) => buildDailyBrief(userId, p, now, tz)),
  );
  return [family, ...perProfile];
}
