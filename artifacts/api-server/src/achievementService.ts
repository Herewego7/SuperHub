import { storage } from "./storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isRequiredChoreTaskType } from "./lib/taskKinds";
import type { Achievement, Chore, ChoreCompletion } from "@workspace/db";

const PERFECT_DAY_TYPE = "perfect_day";

interface AchievementDefinition {
  type: string;
  title: string;
  description: string;
  icon: string;
  checkCriteria: (stats: ProfileStats) => boolean;
}

interface ProfileStats {
  totalCompletions: number;
  totalPoints: number;
  currentStreak: number;
  totalRewardsRedeemed: number;
  totalBonusChoreCompletions: number;
  totalCashouts: number;
}

const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // ── Streak family ────────────────────────────────────────────────────────────
  {
    type: "streak_3",
    title: "On a Roll",
    description: "3 day streak",
    icon: "flame",
    checkCriteria: (s) => s.currentStreak >= 3,
  },
  {
    type: "streak_7",
    title: "Week Warrior",
    description: "7 day streak",
    icon: "flame",
    checkCriteria: (s) => s.currentStreak >= 7,
  },
  {
    type: "streak_14",
    title: "Two Week Champ",
    description: "14 day streak",
    icon: "flame",
    checkCriteria: (s) => s.currentStreak >= 14,
  },
  {
    type: "streak_30",
    title: "Monthly Master",
    description: "30 day streak",
    icon: "crown",
    checkCriteria: (s) => s.currentStreak >= 30,
  },
  {
    type: "streak_60",
    title: "Unstoppable",
    description: "60 day streak",
    icon: "crown",
    checkCriteria: (s) => s.currentStreak >= 60,
  },
  {
    type: "streak_90",
    title: "Legend",
    description: "90 day streak",
    icon: "crown",
    checkCriteria: (s) => s.currentStreak >= 90,
  },
  {
    type: "streak_180",
    title: "Half-Year Hero",
    description: "180 day streak",
    icon: "crown",
    checkCriteria: (s) => s.currentStreak >= 180,
  },
  {
    type: "streak_365",
    title: "Year of Dedication",
    description: "365 day streak",
    icon: "crown",
    checkCriteria: (s) => s.currentStreak >= 365,
  },

  // ── Chore family ─────────────────────────────────────────────────────────────
  {
    type: "first_chore",
    title: "First Steps",
    description: "Complete your first chore",
    icon: "star",
    checkCriteria: (s) => s.totalCompletions >= 1,
  },
  {
    type: "chores_10",
    title: "Getting Started",
    description: "Complete 10 chores",
    icon: "medal",
    checkCriteria: (s) => s.totalCompletions >= 10,
  },
  {
    type: "chores_25",
    title: "Hard Worker",
    description: "Complete 25 chores",
    icon: "medal",
    checkCriteria: (s) => s.totalCompletions >= 25,
  },
  {
    type: "chores_50",
    title: "Super Helper",
    description: "Complete 50 chores",
    icon: "trophy",
    checkCriteria: (s) => s.totalCompletions >= 50,
  },
  {
    type: "chores_100",
    title: "Chore Champion",
    description: "Complete 100 chores",
    icon: "trophy",
    checkCriteria: (s) => s.totalCompletions >= 100,
  },
  {
    type: "chores_200",
    title: "Task Master",
    description: "Complete 200 chores",
    icon: "crown",
    checkCriteria: (s) => s.totalCompletions >= 200,
  },
  {
    type: "chores_500",
    title: "Hall of Fame",
    description: "Complete 500 chores",
    icon: "crown",
    checkCriteria: (s) => s.totalCompletions >= 500,
  },
  {
    type: "chores_1000",
    title: "Chore Legend",
    description: "Complete 1,000 chores",
    icon: "sparkles",
    checkCriteria: (s) => s.totalCompletions >= 1000,
  },

  // ── Stars family (⭐) ───────────────────────────────────────────────────────
  { type: "points_100",   title: "Star Spark",        description: "Earn 100 stars",        icon: "star", checkCriteria: (s) => s.totalPoints >= 100    },
  { type: "star_250",     title: "Star Seeker",        description: "Earn 250 stars",        icon: "star", checkCriteria: (s) => s.totalPoints >= 250    },
  { type: "points_500",   title: "Star Collector",     description: "Earn 500 stars",        icon: "star", checkCriteria: (s) => s.totalPoints >= 500    },
  { type: "star_750",     title: "Star Chaser",        description: "Earn 750 stars",        icon: "star", checkCriteria: (s) => s.totalPoints >= 750    },
  { type: "points_1000",  title: "Star Master",        description: "Earn 1,000 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 1000   },
  { type: "star_1250",    title: "Star Climber",       description: "Earn 1,250 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 1250   },
  { type: "star_1500",    title: "Star Gazer",         description: "Earn 1,500 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 1500   },
  { type: "star_1750",    title: "Star Striker",       description: "Earn 1,750 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 1750   },
  { type: "star_2000",    title: "Star Legend",        description: "Earn 2,000 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 2000   },
  { type: "star_2250",    title: "Star Blazer",        description: "Earn 2,250 stars",      icon: "star", checkCriteria: (s) => s.totalPoints >= 2250   },

  // ── Rewards-redeemed family ─────────────────────────────────────────────────────
  {
    type: "first_reward_redeemed",
    title: "First Reward",
    description: "Redeem your first reward",
    icon: "gift",
    checkCriteria: (s) => s.totalRewardsRedeemed >= 1,
  },
  {
    type: "rewards_redeemed_10",
    title: "Reward Regular",
    description: "Redeem 10 rewards",
    icon: "gift",
    checkCriteria: (s) => s.totalRewardsRedeemed >= 10,
  },
  {
    type: "rewards_redeemed_25",
    title: "Reward Enthusiast",
    description: "Redeem 25 rewards",
    icon: "gift",
    checkCriteria: (s) => s.totalRewardsRedeemed >= 25,
  },
  {
    type: "rewards_redeemed_50",
    title: "Reward Connoisseur",
    description: "Redeem 50 rewards",
    icon: "gift",
    checkCriteria: (s) => s.totalRewardsRedeemed >= 50,
  },
  {
    type: "rewards_redeemed_100",
    title: "Reward Royalty",
    description: "Redeem 100 rewards",
    icon: "crown",
    checkCriteria: (s) => s.totalRewardsRedeemed >= 100,
  },

  // ── Bonus-chore family (⚡) ──────────────────────────────────────────────────
  { type: "first_bonus_chore",   title: "Extra Mile",           description: "Complete your first bonus chore",  icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 1    },
  { type: "bonus_chores_10",     title: "Bonus Helper",         description: "Complete 10 bonus chores",         icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 10   },
  { type: "bonus_chores_25",     title: "Bonus Booster",        description: "Complete 25 bonus chores",         icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 25   },
  { type: "bonus_chores_50",     title: "Bonus Machine",        description: "Complete 50 bonus chores",         icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 50   },
  { type: "bonus_chores_100",    title: "Bonus Grinder",        description: "Complete 100 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 100  },
  { type: "bonus_chores_150",    title: "Bonus Dynamo",         description: "Complete 150 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 150  },
  { type: "bonus_chores_200",    title: "Bonus Charger",        description: "Complete 200 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 200  },
  { type: "bonus_chores_250",    title: "Bonus Surge",          description: "Complete 250 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 250  },
  { type: "bonus_chores_300",    title: "Bonus Spark",          description: "Complete 300 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 300  },
  { type: "bonus_chores_350",    title: "Bonus Blitz",          description: "Complete 350 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 350  },
  { type: "bonus_chores_400",    title: "Bonus Striker",        description: "Complete 400 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 400  },
  { type: "bonus_chores_450",    title: "Bonus Voltage",        description: "Complete 450 bonus chores",        icon: "zap",   checkCriteria: (s) => s.totalBonusChoreCompletions >= 450  },
  { type: "bonus_chores_500",    title: "Bonus Legend",         description: "Complete 500 bonus chores",        icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 500  },
  { type: "bonus_chores_750",    title: "Bonus Titan",          description: "Complete 750 bonus chores",        icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 750  },
  { type: "bonus_chores_1000",   title: "Bonus Conqueror",      description: "Complete 1,000 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 1000 },
  { type: "bonus_chores_1250",   title: "Bonus Vanguard",       description: "Complete 1,250 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 1250 },
  { type: "bonus_chores_1500",   title: "Bonus Apex",           description: "Complete 1,500 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 1500 },
  { type: "bonus_chores_1750",   title: "Bonus Pinnacle",       description: "Complete 1,750 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 1750 },
  { type: "bonus_chores_2000",   title: "Bonus Champion",       description: "Complete 2,000 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 2000 },
  { type: "bonus_chores_2250",   title: "Bonus Ascendant",      description: "Complete 2,250 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 2250 },
  { type: "bonus_chores_2500",   title: "Bonus Unstoppable",    description: "Complete 2,500 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 2500 },
  { type: "bonus_chores_2750",   title: "Bonus Transcendent",   description: "Complete 2,750 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 2750 },
  { type: "bonus_chores_3000",   title: "Bonus Infinite",       description: "Complete 3,000 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 3000 },
  { type: "bonus_chores_5000",   title: "Bonus Absolute",       description: "Complete 5,000 bonus chores",      icon: "crown", checkCriteria: (s) => s.totalBonusChoreCompletions >= 5000 },

  // ── Cash-out family ─────────────────────────────────────────────────────────────
  {
    type: "first_cashout",
    title: "First Cash-Out",
    description: "Complete your first cash-out",
    icon: "dollar-sign",
    checkCriteria: (s) => s.totalCashouts >= 1,
  },
  {
    type: "cashout_10",
    title: "Cash-Out Regular",
    description: "Complete 10 cash-outs",
    icon: "dollar-sign",
    checkCriteria: (s) => s.totalCashouts >= 10,
  },
  {
    type: "cashout_25",
    title: "Cash-Out Pro",
    description: "Complete 25 cash-outs",
    icon: "dollar-sign",
    checkCriteria: (s) => s.totalCashouts >= 25,
  },
  {
    type: "cashout_50",
    title: "Cash-Out Expert",
    description: "Complete 50 cash-outs",
    icon: "dollar-sign",
    checkCriteria: (s) => s.totalCashouts >= 50,
  },
  {
    type: "cashout_100",
    title: "Cash-Out Legend",
    description: "Complete 100 cash-outs",
    icon: "crown",
    checkCriteria: (s) => s.totalCashouts >= 100,
  },
];

function normalizeToDateKey(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateStreak(completionDates: Date[]): number {
  if (completionDates.length === 0) return 0;

  const uniqueDateKeys = Array.from(new Set(
    completionDates.map(d => normalizeToDateKey(d))
  ));

  uniqueDateKeys.sort((a, b) => b.localeCompare(a));

  if (uniqueDateKeys.length === 0) return 0;

  const today = new Date();
  const todayKey = normalizeToDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = normalizeToDateKey(yesterday);

  if (uniqueDateKeys[0] !== todayKey && uniqueDateKeys[0] !== yesterdayKey) {
    return 0;
  }

  let streak = 1;
  let currentDateKey = uniqueDateKeys[0];

  for (let i = 1; i < uniqueDateKeys.length; i++) {
    const [year, month, day] = currentDateKey.split('-').map(Number);
    const expectedPrev = new Date(year, month - 1, day);
    expectedPrev.setDate(expectedPrev.getDate() - 1);
    const expectedPrevKey = normalizeToDateKey(expectedPrev);

    if (uniqueDateKeys[i] === expectedPrevKey) {
      streak++;
      currentDateKey = uniqueDateKeys[i];
    } else {
      break;
    }
  }

  return streak;
}

async function calculatePointsForProfile(profileId: string, completions: ChoreCompletion[]): Promise<number> {
  const profile = await storage.getProfile(profileId);
  if (!profile || !profile.userId) return 0;

  const userChores = await storage.getChoresByUser(profile.userId);
  const chorePointsMap = new Map(userChores.map(c => [c.id, c.points || 0]));

  return completions.reduce((sum, c) => sum + (chorePointsMap.get(c.choreId) || 0), 0);
}

async function calculateRewardsRedeemedForProfile(profileId: string): Promise<number> {
  const redemptions = await storage.getRewardRedemptions(profileId);
  return redemptions.filter((r) => r.status === "redeemed").length;
}

async function calculateBonusChoreCompletionsForProfile(profileId: string, completions: ChoreCompletion[]): Promise<number> {
  const profileChores = await storage.getChoresByProfile(profileId);
  const bonusChoreIds = new Set(profileChores.filter((c) => c.isBonus).map((c) => c.id));
  return completions.filter((c) => bonusChoreIds.has(c.choreId)).length;
}

async function calculateCashoutsForProfile(profileId: string): Promise<number> {
  // No dedicated "all transactions" query exists; listWalletTransactions caps
  // at a `limit` param, so pass one high enough to cover any real family's
  // lifetime transaction history.
  const transactions = await storage.listWalletTransactions(profileId, 100_000);
  return transactions.filter((t) => t.type === "cashout_approved" && t.status === "done").length;
}

export async function checkAndAwardAchievements(profileId: string): Promise<Achievement[]> {
  const newAchievements: Achievement[] = [];

  const existingAchievements = await storage.getAchievementsByProfile(profileId);
  const existingTypes = new Set(existingAchievements.map(a => a.type));

  const completions = await storage.getChoreCompletionsByProfile(profileId);

  const totalPoints = await calculatePointsForProfile(profileId, completions);

  const { streak: currentStreak } = await storage.getProfileStreakDetails(profileId);

  const [totalRewardsRedeemed, totalBonusChoreCompletions, totalCashouts] = await Promise.all([
    calculateRewardsRedeemedForProfile(profileId),
    calculateBonusChoreCompletionsForProfile(profileId, completions),
    calculateCashoutsForProfile(profileId),
  ]);

  const stats: ProfileStats = {
    totalCompletions: completions.length,
    totalPoints,
    currentStreak,
    totalRewardsRedeemed,
    totalBonusChoreCompletions,
    totalCashouts,
  };

  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    if (existingTypes.has(definition.type)) {
      continue;
    }

    if (definition.checkCriteria(stats)) {
      try {
        const achievement = await storage.createAchievement({
          profileId,
          title: definition.title,
          description: definition.description,
          icon: definition.icon,
          type: definition.type,
        });
        newAchievements.push(achievement);
        existingTypes.add(definition.type);
      } catch (error) {
        console.error(`Failed to create achievement ${definition.type}:`, error);
      }
    }
  }

  return newAchievements;
}

// Unlike every other achievement type above (lifetime-once milestones, deduped
// by `type` alone), "perfect day" is awardable once per calendar day — so it's
// deliberately kept out of ACHIEVEMENT_DEFINITIONS/checkAndAwardAchievements'
// generic type-only dedup loop. There's no dedicated per-day column on
// `achievements`; dedup instead checks whether a `perfect_day` row's own
// `earnedAt` already falls within today's local-day window.
// Normalize a client-supplied local-day instant to a stable day boundary,
// reused everywhere "which day is it for this family" matters below.
export function normalizeDayStart(localDayStart?: Date | null): Date {
  const d = localDayStart ? new Date(localDayStart) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Is a profile's full daily checklist complete for the given (normalized) day?
// The single source of truth for "did they finish everything today", shared by
// the Perfect Day achievement AND the per_completion daily points bonus.
// "Required" = the same definition used client-side for the confetti
// celebration: scheduled today, active, not a bonus chore, not a target-count
// chore, and a real chore rather than a to-do or an Inspiration item. Bonus
// chores / to-dos / target chores are excluded (they keep their own individual
// points even in per_completion mode); Inspiration is reading, not work.
/**
 * The chores that must be done for `dayStart` to count as a finished day.
 *
 * Honours a chore's End date (2026-09-30): the app already hid an ended chore,
 * but this didn't, so a one-off chore past its end date stayed "required" on
 * its weekday forever — silently blocking Perfect Day and the finished-day
 * bonus. `endDate` is stored as the end of its last local day, so a chore
 * whose end is before this day's start is over.
 */
export function requiredChoresForDay<
  C extends Pick<Chore, "isActive" | "isBonus" | "targetCount" | "taskType" | "recurrenceType" | "daysOfWeek" | "endDate">,
>(chores: C[], dayStart: Date): C[] {
  const dayOfWeek = dayStart.getDay();
  return chores.filter((c) =>
    c.isActive &&
    !c.isBonus &&
    (c.targetCount == null || c.targetCount <= 0) &&
    isRequiredChoreTaskType(c.taskType) &&
    !(c.endDate && new Date(c.endDate) < dayStart) &&
    (c.recurrenceType === "daily" || (c.daysOfWeek ?? []).includes(dayOfWeek)),
  );
}

export async function isChecklistCompleteForDay(
  profileId: string,
  dayStart: Date,
): Promise<{ complete: boolean; requiredCount: number }> {
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const chores = await storage.getChoresByProfile(profileId);
  const requiredChores = requiredChoresForDay(chores, dayStart);
  if (requiredChores.length === 0) return { complete: false, requiredCount: 0 };
  const completions = await storage.getChoreCompletionsByProfile(profileId);
  const completedTodayChoreIds = new Set(
    completions
      .filter((c) => c.completedAt && new Date(c.completedAt) >= dayStart && new Date(c.completedAt) < dayEnd)
      .map((c) => c.choreId),
  );
  return { complete: requiredChores.every((c) => completedTodayChoreIds.has(c.id)), requiredCount: requiredChores.length };
}

// Keep the per_completion daily bonus row in sync with checklist completeness.
// Called (fire-and-forget) after every completion insert/delete when the family
// is in per_completion points mode: creates the day's bonus the moment the
// checklist is complete, removes it again if a completion is undone and the
// checklist drops back below complete. Idempotent — one row per (profile, day).
export async function syncCompletionBonus(
  userId: string,
  profileId: string,
  localDayStart: Date | null | undefined,
  bonusPoints: number,
): Promise<void> {
  const dayStart = normalizeDayStart(localDayStart);
  // Per-person override: a profile can earn its own daily-checklist bonus
  // (e.g. an older kid with a bigger list earns more per finished day). The
  // caller passes the family-wide default; a non-null value on the profile
  // wins. Resolved here — the one choke point both the complete and
  // un-complete routes already flow through — so the two can't disagree.
  try {
    const profile = await storage.getProfile(profileId);
    if (profile && profile.completionBonusPoints != null && profile.completionBonusPoints >= 0) {
      bonusPoints = profile.completionBonusPoints;
    }
  } catch {
    /* fall back to the family default */
  }
  // Advisory transaction lock keyed on (profile, day): completion_bonuses has
  // no unique index on that pair, so without serialization two concurrent
  // completions that each finish the checklist can both see "no bonus yet"
  // and insert two rows — a doubled daily bonus. The lock auto-releases at
  // commit; different profiles/days don't contend.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`bonus:${profileId}:${dayStart.toISOString()}`}))`,
    );
    const { complete } = await isChecklistCompleteForDay(profileId, dayStart);
    const existing = await storage.getCompletionBonus(profileId, dayStart);
    if (complete && !existing) {
      await storage.createCompletionBonus({ userId, profileId, localDayStart: dayStart, points: bonusPoints });
    } else if (!complete && existing) {
      await storage.deleteCompletionBonus(profileId, dayStart);
    }
  });
}

export async function checkAndAwardPerfectDay(
  profileId: string,
  localDayStart?: Date | null,
): Promise<Achievement | null> {
  const dayStart = normalizeDayStart(localDayStart);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { complete } = await isChecklistCompleteForDay(profileId, dayStart);
  if (!complete) return null;

  const existingAchievements = await storage.getAchievementsByProfile(profileId);
  const alreadyAwardedToday = existingAchievements.some(
    (a) => a.type === PERFECT_DAY_TYPE && a.earnedAt && new Date(a.earnedAt) >= dayStart && new Date(a.earnedAt) < dayEnd,
  );
  if (alreadyAwardedToday) return null;

  try {
    return await storage.createAchievement({
      profileId,
      title: "Perfect Day!",
      description: "Completed every chore today",
      icon: "🎉",
      type: PERFECT_DAY_TYPE,
    });
  } catch (error) {
    console.error("Failed to create perfect_day achievement:", error);
    return null;
  }
}
