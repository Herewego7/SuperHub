import { z } from "zod";

// ====== Auth types ======
export type UserFamily = {
  id: string;
  role: string; // "owner" | "member"
  isOwner: boolean;
};

export type User = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  // Null means this account still needs to see the first-run onboarding
  // wizard (a brand-new signup or someone who just joined an existing
  // family) — see the schema column comment for why this is per-account.
  onboardingCompletedAt: string | Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  // Family context attached by /api/auth/user (null if unresolved).
  family?: UserFamily | null;
};

export type UpsertUser = Partial<User> & { id: string };

// ====== Profile ======
export type Profile = {
  id: string;
  userId: string | null;
  name: string;
  color: string;
  photoUrl: string | null;
  email: string | null;
  school?: string | null;
  initials: string;
  isActive: boolean | null;
  isAllFamilyProfile: boolean | null;
  googleCalendarConnected: boolean | null;
  outlookCalendarConnected: boolean | null;
  icalConnected: boolean | null;
  bedtimeCutoff: string | null;
  dailyBriefTime: string | null;
  eveningPlanTime?: string | null;
  eveningPlanTiming?: string | null;
  streakSkipDays: number[] | null;
  // Per-person override for the per_completion daily-checklist star bonus;
  // null/undefined = use the family-wide reward_settings default.
  completionBonusPoints?: number | null;
  // "adult" | "child" — day-to-day kid/adult role for permissions (separate
  // from the COPPA under-13 `isChild` flag below).
  role: string | null;
  // COPPA / children's data
  isChild: boolean | null;
  birthYear: number | null;
  parentalConsentAt: Date | null;
  parentalConsentBy: string | null;
  createdAt: Date | null;
};

// ====== BratBusters Behaviour Board ======
export type BehaviourBoardSettings = {
  id: string;
  userId: string;
  familyMotto: string | null;
  boardSubtitle: string | null;
  defaultTimerMinutes: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type BehaviourRule = {
  id: string;
  userId: string;
  profileId: string;
  profileIds: string[] | null;
  ruleText: string;
  positiveConsequence: string;
  negativeConsequence: string;
  timerMinutes: number | null;
  displayOrder: number | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertBehaviourRule = {
  userId?: string;
  profileId: string;
  profileIds?: string[] | null;
  ruleText: string;
  positiveConsequence: string;
  negativeConsequence: string;
  timerMinutes?: number | null;
  displayOrder?: number | null;
  isActive?: boolean | null;
};

export type BehaviourIncidentStatus = "positive_pending" | "resolved_positive" | "negative_applied";

export type BehaviourIncident = {
  id: string;
  userId: string;
  profileId: string;
  ruleId: string | null;
  ruleText: string;
  positiveConsequence: string;
  negativeConsequence: string;
  timerMinutes: number;
  status: BehaviourIncidentStatus;
  startedAt: Date;
  timerEndsAt: Date;
  resolvedAt: Date | null;
  note: string | null;
  createdAt: Date | null;
};

// ====== iCal (.ics URL) subscription — read-only ======
export type IcalSubscription = {
  id: string;
  profileId: string;
  feedUrl: string;
  calendarName: string;
  calendarColor: string | null;
  lastFetchedAt: Date | null;
  lastError: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertProfile = {
  userId?: string | null;
  name: string;
  color: string;
  photoUrl?: string | null;
  email?: string | null;
  initials: string;
  isActive?: boolean | null;
  isAllFamilyProfile?: boolean | null;
  googleCalendarConnected?: boolean | null;
  outlookCalendarConnected?: boolean | null;
  icalConnected?: boolean | null;
  bedtimeCutoff?: string | null;
  dailyBriefTime?: string | null;
  eveningPlanTime?: string | null;
  eveningPlanTiming?: string | null;
  role?: string | null;
  // COPPA / children's data (parental consent fields are set server-side only)
  isChild?: boolean | null;
  birthYear?: number | null;
};

// ====== Event ======
export type Event = {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
  profileIds: string[] | null;
  drivingProfileId: string | null;
  drivingProfileIds?: string[] | null;
  calendarId: string | null;
  calendarName: string | null;
  isAllDay: boolean | null;
  source: string | null;
  externalId: string | null;
  createdAt: Date | null;
  recurrenceType: "daily" | "weekly" | "monthly" | "annually" | null;
  recurrenceEndDate: Date | null;
};

export type InsertEvent = {
  userId?: string | null;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  location?: string | null;
  profileIds?: string[] | null;
  drivingProfileId?: string | null;
  drivingProfileIds?: string[] | null;
  calendarId?: string | null;
  calendarName?: string | null;
  isAllDay?: boolean | null;
  source?: string | null;
  externalId?: string | null;
  recurrenceType?: "daily" | "weekly" | "monthly" | "annually" | null;
  recurrenceEndDate?: Date | null;
};

// ====== Chore ======
export type TaskType = "chore" | "todo" | "memory_verse" | "affirmation" | "bible_verse" | "mission" | "custom";

export type Chore = {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  taskType: TaskType;
  icon: string | null;
  points: number | null;
  profileIds: string[];
  daysOfWeek: number[];
  recurrenceType: string | null;
  targetCount: number | null;
  endDate: Date | null;
  category: string | null;
  isActive: boolean | null;
  isBonus: boolean | null;
  bonusFrequencyType: string | null;
  bonusFrequencyCount: number | null;
  bonusFrequencyPeriod: string | null;
  createdAt: Date | null;
};

export type InsertChore = {
  userId?: string | null;
  title: string;
  description?: string | null;
  taskType?: TaskType;
  icon?: string | null;
  points?: number | null;
  profileIds: string[];
  daysOfWeek: number[];
  recurrenceType?: string | null;
  targetCount?: number | null;
  endDate?: Date | null;
  category?: string | null;
  isActive?: boolean | null;
  isBonus?: boolean | null;
  bonusFrequencyType?: string | null;
  bonusFrequencyCount?: number | null;
  bonusFrequencyPeriod?: string | null;
};

// ====== ChoreCompletion ======
export type ChoreCompletion = {
  id: string;
  choreId: string;
  profileId: string;
  completedAt: Date | null;
  points: number;
};

export type InsertChoreCompletion = {
  choreId: string;
  profileId: string;
  points: number;
};

// ====== Achievement ======
export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  profileId: string;
  earnedAt: Date | null;
  type: string;
};

export type InsertAchievement = {
  title: string;
  description: string;
  icon: string;
  profileId: string;
  type: string;
};

// ====== Reward ======
export type Reward = {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  pointsCost: number;
  icon: string | null;
  isActive: boolean | null;
  scopeProfileId: string | null;
  createdAt: Date | null;
};

export type InsertReward = {
  userId?: string | null;
  title: string;
  description?: string | null;
  pointsCost: number;
  icon?: string | null;
  isActive?: boolean | null;
  scopeProfileId?: string | null;
};

// ====== RewardRedemption ======
export type RewardRedemption = {
  id: string;
  rewardId: string;
  profileId: string;
  status: string;
  unlockedAt: Date | null;
  redeemedAt: Date | null;
  createdAt: Date | null;
};

export type InsertRewardRedemption = {
  rewardId: string;
  profileId: string;
  status?: string;
  unlockedAt?: Date | null;
  redeemedAt?: Date | null;
};

// ====== Star ledger (read-only Insights card) ======
export type StarLedgerEventKind = "completion" | "bonus" | "adjustment" | "redemption" | "cashout";
export type StarLedgerEvent = {
  at: string;   // ISO timestamp
  delta: number; // +earned, -spent
  kind: StarLedgerEventKind;
};
export type StarLedger = {
  balance: number;      // == getProfilePoints (matches the star pill)
  totalEarned: number;  // Σ positive deltas
  totalSpent: number;   // Σ |negative deltas|
  events: StarLedgerEvent[];
};

// ====== CalendarSettings ======
export type CalendarSettings = {
  id: string;
  userId: string | null;
  startHour: number | null;
  endHour: number | null;
  twoWaySyncEnabled: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertCalendarSettings = {
  userId?: string | null;
  startHour?: number | null;
  endHour?: number | null;
  twoWaySyncEnabled?: boolean | null;
};

// ====== LocationSettings ======
export type LocationSettings = {
  id: string;
  userId: string | null;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertLocationSettings = {
  userId?: string | null;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

// country/timezone/latitude/longitude are all optional here, matching the
// DB column's own NOT NULL + default (see lib/db/schema.ts) — neither real
// caller (Settings' Location form, onboarding's Location step) ever
// collects a country, and this schema requiring it unconditionally meant
// EVERY save of a new location crashed client-side with a raw Zod error
// before the request was even sent (this is exactly the schema the
// Settings form parses against locally before calling the API).
export const insertLocationSettingsSchema = z.object({
  city: z.string(),
  state: z.string(),
  country: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  timezone: z.string().optional(),
});

// ====== GoogleCalendarTokens ======
export type GoogleCalendarTokens = {
  id: string;
  profileId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertGoogleCalendarTokens = {
  profileId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
  email?: string | null;
  isActive?: boolean | null;
};

// ====== OutlookCalendarTokens ======
export type OutlookCalendarTokens = {
  id: string;
  profileId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  email: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertOutlookCalendarTokens = {
  profileId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
  email?: string | null;
  isActive?: boolean | null;
};

// ====== CalendarAssignment ======
export type CalendarAssignment = {
  id: string;
  profileId: string;
  calendarType: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  emailAddress: string;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertCalendarAssignment = {
  profileId: string;
  calendarType: string;
  calendarId: string;
  calendarName: string;
  calendarColor?: string | null;
  emailAddress: string;
  isActive?: boolean | null;
};

// ====== DailyContent ======
export type DailyContent = {
  id: string;
  userId: string | null;
  type: string;
  title: string;
  content: string;
  reference: string | null;
  isActive: boolean | null;
  displayOrder: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type InsertDailyContent = {
  userId?: string | null;
  type: string;
  title: string;
  content: string;
  reference?: string | null;
  isActive?: boolean | null;
  displayOrder?: number | null;
};

export const insertDailyContentSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string(),
  reference: z.string().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
  displayOrder: z.number().optional().nullable(),
});

// ====== DailyContentAssignment ======
export type DailyContentAssignment = {
  id: string;
  contentId: string;
  profileId: string;
  createdAt: Date | null;
};

export type InsertDailyContentAssignment = {
  contentId: string;
  profileId: string;
};

// ====== DailyContentCompletion ======
export type DailyContentCompletion = {
  id: string;
  contentId: string;
  profileId: string;
  completedAt: Date | null;
};

export type InsertDailyContentCompletion = {
  contentId: string;
  profileId: string;
};

// ====== CustomProfileGroup ======
export type CustomProfileGroup = {
  id: string;
  userId: string | null;
  name: string;
  profileIds: string[];
  color: string | null;
  icon: string | null;
  displayOrder: number | null;
  createdAt: Date | null;
};

export type InsertCustomProfileGroup = {
  userId?: string | null;
  name: string;
  profileIds: string[];
  color?: string | null;
  icon?: string | null;
  displayOrder?: number | null;
};

// ====== Meal ======
export type Meal = {
  id: string;
  userId: string;
  date: string;
  slot: string;
  name: string;
  notes: string | null;
  recipeUrl: string | null;
  directions: string | null;
  sourceName: string | null;
  importedAt: Date | null;
  createdAt: Date | null;
};

export type InsertMeal = {
  userId: string;
  date: string;
  slot: string;
  name: string;
  notes?: string | null;
  recipeUrl?: string | null;
  directions?: string | null;
  sourceName?: string | null;
  importedAt?: Date | null;
};

// ====== MealIngredient ======
export type MealIngredient = {
  id: string;
  mealId: string;
  quantity: string | null;
  item: string;
  displayOrder: number | null;
};

export type InsertMealIngredient = {
  mealId: string;
  quantity?: string | null;
  item: string;
  displayOrder?: number | null;
};

// ====== GroceryItem ======
export type GroceryItem = {
  id: string;
  userId: string;
  name: string;
  quantity: string | null;
  isChecked: boolean | null;
  sourceMealIds: string[] | null;
  createdAt: Date | null;
  category: string | null;
};

export type InsertGroceryItem = {
  userId: string;
  name: string;
  quantity?: string | null;
  isChecked?: boolean | null;
  sourceMealIds?: string[] | null;
  category?: string | null;
};

// ====== GroceryStaple (recurring "always want this" item) ======
export type GroceryStaple = {
  id: string;
  userId: string;
  name: string;
  quantity: string | null;
  category: string | null;
  createdAt: Date | null;
};

export type InsertGroceryStaple = {
  userId: string;
  name: string;
  quantity?: string | null;
  category?: string | null;
};

// ====== SavedMeal (reusable meal idea / template) ======
export type SavedMeal = {
  id: string;
  userId: string;
  name: string;
  notes: string | null;
  recipeUrl: string | null;
  directions: string | null;
  sourceName: string | null;
  importedAt: Date | null;
  createdAt: Date | null;
};

export type InsertSavedMeal = {
  userId: string;
  name: string;
  notes?: string | null;
  recipeUrl?: string | null;
  directions?: string | null;
  sourceName?: string | null;
  importedAt?: Date | null;
};

export type SavedMealIngredient = {
  id: string;
  savedMealId: string;
  quantity: string | null;
  item: string;
  displayOrder: number | null;
};

export type InsertSavedMealIngredient = {
  savedMealId: string;
  quantity?: string | null;
  item: string;
  displayOrder?: number | null;
};

// ====== Celebration ======
export type Celebration = {
  id: string;
  userId: string;
  name: string;
  monthDay: string;
  year: number | null;
  type: string;
  customLabel: string | null;
  profileId: string | null;
  profileIds: string[] | null;
  notes: string | null;
  showYear: boolean | null;
  createdAt: Date | null;
};

export type InsertCelebration = {
  userId: string;
  name: string;
  monthDay: string;
  year?: number | null;
  type?: string;
  customLabel?: string | null;
  profileId?: string | null;
  profileIds?: string[] | null;
  notes?: string | null;
  showYear?: boolean | null;
};

// ====== CelebrationGiftIdea ======
export type CelebrationGiftIdea = {
  id: string;
  celebrationId: string;
  text: string;
  isChecked: boolean | null;
  displayOrder: number | null;
  createdAt: Date | null;
};

export type InsertCelebrationGiftIdea = {
  celebrationId: string;
  text: string;
  isChecked?: boolean | null;
  displayOrder?: number | null;
};

// ====== CelebrationPhoto ======
export type CelebrationPhoto = {
  id: string;
  celebrationId: string;
  imageUrl: string;
  year: number | null;
  caption: string | null;
  createdAt: Date | null;
};

export type InsertCelebrationPhoto = {
  celebrationId: string;
  imageUrl: string;
  year?: number | null;
  caption?: string | null;
};

// ====== ChoreSpin ======
export type ChoreSpin = {
  id: string;
  userId: string;
  choreTitle: string;
  choreId: string | null;
  eligibleProfileIds: string[];
  winnerProfileId: string | null;
  excludedRecentWinner: boolean | null;
  assignedChoreId: string | null;
  createdAt: Date | null;
};

export type InsertChoreSpin = {
  userId: string;
  choreTitle: string;
  choreId?: string | null;
  eligibleProfileIds: string[];
  winnerProfileId?: string | null;
  excludedRecentWinner?: boolean | null;
  assignedChoreId?: string | null;
};

// ====== WishlistItem ======
export type WishlistItemStatus = "pending" | "approved" | "declined" | "archived";

export type WishlistItem = {
  id: string;
  userId: string;
  submittedByProfileId: string | null;
  title: string;
  description: string | null;
  photoUrl: string | null;
  link: string | null;
  suggestedPriceCoins: number;
  status: WishlistItemStatus;
  parentNote: string | null;
  finalPriceCoins: number | null;
  inventoryCap: number | null;
  approvedRewardId: string | null;
  createdAt: Date | null;
  decidedAt: Date | null;
};

export type InsertWishlistItem = {
  userId: string;
  submittedByProfileId?: string | null;
  title: string;
  description?: string | null;
  photoUrl?: string | null;
  link?: string | null;
  suggestedPriceCoins: number;
  status?: WishlistItemStatus;
  parentNote?: string | null;
  finalPriceCoins?: number | null;
  inventoryCap?: number | null;
};

// ====== RewardSettings ======
export interface RewardSettings {
  id: string;
  userId: string;
  redemptionMode: "rewards_only" | "cashout_only" | "both";
  centsPerPoint: number;
  currencySymbol: string;
  minCashoutPoints: number;
  // "per_chore" (default): each chore earns its own points. "per_completion":
  // finishing the whole daily checklist earns a flat completionBonusPoints;
  // individual required chores earn nothing.
  pointsMode: "per_chore" | "per_completion";
  completionBonusPoints: number;
  hasParentPin: boolean;
  pinGatedFeatures: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// ====== OnboardingStatus ======
export type OnboardingStepStatus = "done" | "skipped" | null;
export interface OnboardingStatus {
  id: string;
  userId: string;
  profileStatus: OnboardingStepStatus;
  profileDismissedUntil: string | null;
  locationStatus: OnboardingStepStatus;
  locationDismissedUntil: string | null;
  rewardsStatus: OnboardingStepStatus;
  rewardsDismissedUntil: string | null;
  inviteStatus: OnboardingStepStatus;
  inviteDismissedUntil: string | null;
  calendarStatus: OnboardingStepStatus;
  calendarDismissedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// ====== ActivityLogEntry ======
// Normalised shape returned by GET /api/activity-log. Each entry is either
// synthesised from an existing table (chore_completions, reward_redemptions,
// shoutouts, point_adjustments) or read directly from activity_log (for
// chore_uncomplete events).
export type ActivityLogEntryType =
  | 'chore_complete'
  | 'chore_uncomplete'
  | 'reward_redeem'
  | 'shoutout'
  | 'point_adjustment'
  | 'behaviour_incident'
  | 'meal_planned'
  | 'cashout_requested'
  | 'cashout_approved'
  | 'cashout_declined'
  | 'note_posted';

export type ActivityLogEntry = {
  id: string;
  activityType: ActivityLogEntryType;
  profileId: string;
  profileName: string;
  profileColor: string;
  profileInitials: string;
  profilePhotoUrl: string | null;
  toProfileId: string | null;
  toProfileName: string | null;
  toProfileColor: string | null;
  description: string;
  entityTitle: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
};

// ====== Grocery quantity merging ======
// Shared by the frontend (grocery prompt / staples "add to list") and the
// backend (staple "add to list" route) so combining an item that's already
// on the list always behaves the same way, regardless of which flow added it.
const GROCERY_UNIT_ALIASES: Record<string, string> = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', tbsps: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  gram: 'g', grams: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  gallon: 'gal', gallons: 'gal', gal: 'gal',
  quart: 'qt', quarts: 'qt', qt: 'qt',
  pint: 'pt', pints: 'pt', pt: 'pt',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  package: 'pkg', packages: 'pkg', pkg: 'pkg', pkgs: 'pkg',
};

function parseGroceryQuantity(q: string): { amount: number; unit: string | null } | null {
  const trimmed = q.trim().toLowerCase();
  const m = trimmed.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s*([a-z]+)?$/);
  if (!m) return null;
  let amount: number;
  if (m[1].includes('/')) {
    const [n, d] = m[1].split('/').map(Number);
    amount = d ? n / d : NaN;
  } else {
    amount = parseFloat(m[1]);
  }
  if (Number.isNaN(amount)) return null;
  const rawUnit = m[2];
  const unit = rawUnit ? (GROCERY_UNIT_ALIASES[rawUnit] ?? rawUnit) : null;
  return { amount, unit };
}

function formatGroceryQuantity(amount: number, unit: string | null): string {
  const rounded = Math.round(amount * 100) / 100;
  const amountStr = String(rounded);
  return unit ? `${amountStr} ${unit}` : amountStr;
}

// Combines two quantity strings for the same grocery item. When both parse
// as "<number> <unit>" and the units match (after alias normalization —
// "tbsp"/"tablespoons"/"tbs" all count as the same unit), the amounts are
// added and returned in that unit. Otherwise falls back to concatenating
// the two strings distinctly (or "(x2)" if they're identical) rather than
// silently discarding either value.
export function mergeGroceryQuantities(existing: string | null, incoming: string | null): string | null {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const a = parseGroceryQuantity(existing);
  const b = parseGroceryQuantity(incoming);
  if (a && b && a.unit === b.unit) {
    return formatGroceryQuantity(a.amount + b.amount, a.unit);
  }
  if (existing.trim().toLowerCase() === incoming.trim().toLowerCase()) {
    return `${existing} (x2)`;
  }
  return `${existing} + ${incoming}`;
}

// ── What counts as a "regular chore" ──────────────────────────────────────
// `chores.taskType` carries three different kinds of row in one table: real
// chores ("chore"), to-dos ("todo"), and Inspiration content (affirmations,
// verses, missions — created through the Inspiration card in the new-task
// modal, which maps each sub-type straight onto a taskType).
//
// Only real chores decide whether a day is finished. Inspiration is something
// to read, not work to get through, and a family that has any would otherwise
// never see their day complete until they'd ticked the day's verse too — which
// is exactly what happened before 2026-09-11. To-dos have always been excluded
// and keep their own separate celebration.
//
// Unknown values fall through as regular, so an unrecognised taskType can never
// silently make a day impossible to finish.
export const INSPIRATION_TASK_TYPES: ReadonlySet<string> = new Set([
  "affirmation",
  "bible_verse",
  "memory_verse",
  "mission",
  "custom",
]);

export function isInspirationTaskType(taskType: string | null | undefined): boolean {
  return INSPIRATION_TASK_TYPES.has(taskType ?? "chore");
}

// True for the rows that make up the daily checklist: everything the
// "all done" confetti, the Perfect Day achievement and the per_completion
// daily bonus all count. Callers still apply their own scheduling, active,
// bonus- and target-chore filters on top of this.
export function isRequiredChoreTaskType(taskType: string | null | undefined): boolean {
  const t = taskType ?? "chore";
  return t !== "todo" && !INSPIRATION_TASK_TYPES.has(t);
}
