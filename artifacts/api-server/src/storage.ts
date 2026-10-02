import { decideProfileIdCleanup } from "./lib/profileCleanup";
import { insertProfileRow, loadProfiles, updateProfileRow } from "./lib/profileRows";
import { driverWriteFields, driverIdsOf } from "./lib/eventDrivers";
import { markSchedulerWorkDirty } from "./lib/workGate";
import { settingsRowForUser } from "./lib/settingsOwnership";
import { assignmentsVisibleToFamily, assignmentsToDeactivate } from "./lib/calendarAssignmentScope";
import {
  profiles,
  events,
  chores,
  choreCompletions,
  choreSkips,
  achievements,
  rewards,
  rewardRedemptions,
  calendarSettings,
  locationSettings,
  googleCalendarTokens,
  outlookCalendarTokens,
  calendarAssignments,
  icalSubscriptions,
  behaviourBoardSettings,
  behaviourRules,
  behaviourIncidents,
  googleCalendarEventAssignments,
  eventCalendarSyncs,
  dailyContent,
  dailyContentAssignments,
  dailyContentCompletions,
  customProfileGroups,
  meals,
  mealIngredients,
  groceryItems,
  groceryStaples,
  savedMeals,
  savedMealIngredients,
  celebrations,
  celebrationGiftIdeas,
  celebrationPhotos,
  choreSpins,
  wishlistItems,
  healthReminders,
  healthReminderEvents,
  streakFreezes,
  shoutouts,
  comments,
  familyShareTokens,
  allowanceSettings,
  allowancePayouts,
  walletSettings,
  walletBalances,
  walletTransactions,
  savingsGoals,
  pointAdjustments,
  completionBonuses,
  rewardSettings,
  onboardingStatus,
  type OnboardingStatus,
  type FamilyShareToken,
  type AllowanceSettings,
  type AllowancePayout,
  type WalletSettings,
  type WalletBalance,
  type WalletTransaction,
  type SavingsGoal,
  type RewardSettings,
  type PointAdjustment,
  type HealthReminder,
  type InsertHealthReminder,
  type HealthReminderEvent,
  type StreakFreeze,
  type Shoutout,
  type Comment,
  type WishlistItem,
  type InsertWishlistItem,
  type ChoreSpin,
  type InsertChoreSpin,
  type Meal,
  type InsertMeal,
  type MealIngredient,
  type InsertMealIngredient,
  type GroceryItem,
  type InsertGroceryItem,
  type GroceryStaple,
  type InsertGroceryStaple,
  type SavedMeal,
  type InsertSavedMeal,
  type SavedMealIngredient,
  type InsertSavedMealIngredient,
  type Celebration,
  type InsertCelebration,
  type CelebrationGiftIdea,
  type InsertCelebrationGiftIdea,
  type CelebrationPhoto,
  type InsertCelebrationPhoto,
  type Profile,
  type InsertProfile,
  type Event,
  type InsertEvent,
  type Chore,
  type InsertChore,
  type ChoreCompletion,
  type ChoreSkip,
  type InsertChoreCompletion,
  type Achievement,
  type InsertAchievement,
  type Reward,
  type InsertReward,
  type RewardRedemption,
  type InsertRewardRedemption,
  type CalendarSettings,
  type InsertCalendarSettings,
  type LocationSettings,
  type InsertLocationSettings,
  type GoogleCalendarTokens,
  type InsertGoogleCalendarTokens,
  type OutlookCalendarTokens,
  type InsertOutlookCalendarTokens,
  type CalendarAssignment,
  type InsertCalendarAssignment,
  type IcalSubscription,
  type InsertIcalSubscription,
  type BehaviourBoardSettings,
  type InsertBehaviourBoardSettings,
  type BehaviourRule,
  type InsertBehaviourRule,
  type BehaviourIncident,
  type InsertBehaviourIncident,
  type GoogleCalendarEventAssignment,
  type EventCalendarSync,
  type InsertEventCalendarSync,
  type DailyContent,
  type InsertDailyContent,
  type DailyContentAssignment,
  type InsertDailyContentAssignment,
  type DailyContentCompletion,
  type InsertDailyContentCompletion,
  type CustomProfileGroup,
  type InsertCustomProfileGroup,
  type CompletionBonus,
  type InsertCompletionBonus,
} from "@workspace/db";
import { db } from "./db";
import { eq, and, gte, lte, inArray, desc, isNull, or, sql } from "drizzle-orm";

// A handful of storage methods (the ones read/written inside a
// `db.transaction(...)` row-lock, e.g. the cash-out flow) accept this so they
// can run on the SAME pooled connection as the surrounding transaction instead
// of quietly reaching back into the shared pool for a second one. Mixing the
// two inside one transaction is what caused a real production deadlock: the
// transaction holds a connection (and a row lock) waiting on work that itself
// needs another connection from the identical pool — under load, every
// in-flight request can end up holding one connection while waiting on
// another that's held by a twin request in the same situation, exhausting the
// pool until Postgres's idle-in-transaction timeout kills it. Defaults to the
// plain pooled `db` so every existing non-transactional caller is unaffected.
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Star-history shapes for the read-only Insights endpoint. Defined locally
// (not imported from @workspace/shared-types) to avoid adding a cross-package
// dependency for one type — mirrors the frontend's identical definition, the
// same trade-off groceryMerge.ts already makes.
export type StarLedgerEvent = { at: string; delta: number; kind: "completion" | "bonus" | "adjustment" | "redemption" | "cashout" };
export type StarLedger = { balance: number; totalEarned: number; totalSpent: number; events: StarLedgerEvent[] };
import { randomUUID } from "crypto";
import {
  computeStreak,
  dateKeyTz,
  isoWeekKeyFromDateKey,
  previousDayKey,
  todayKeyTz,
  yesterdayKeyTz,
} from "./lib/streak";

// Google expands a recurring event's instance id as
// `${recurringEventId}_${basicUtcTimestamp}` where the timestamp is either
// `YYYYMMDDTHHMMSSZ` (timed) or `YYYYMMDD` (all-day). Parse that suffix back to
// the occurrence's start instant so a series-level assignment can identify which
// per-occurrence override rows it supersedes. Returns null if the suffix isn't
// in a recognized form (so callers can leave such rows untouched).
function parseGoogleInstanceStart(suffix: string): Date | null {
  const m = suffix.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (h !== undefined) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  return new Date(Date.UTC(+y, +mo - 1, +d));
}

export interface IStorage {
  // Profiles
  getProfiles(): Promise<Profile[]>;
  getProfilesByUser(userId: string): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(id: string, profile: Partial<InsertProfile>, userId?: string): Promise<Profile | undefined>;
  deleteProfile(id: string, userId?: string): Promise<boolean>;

  // Events
  getEvents(): Promise<Event[]>;
  getEventsByUser(userId: string): Promise<Event[]>;
  getEventsByProfile(profileId: string): Promise<Event[]>;
  getEventsByDateRange(startDate: Date, endDate: Date): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: string, event: Partial<InsertEvent>, userId: string): Promise<Event | undefined>;
  deleteEvent(id: string, userId: string): Promise<boolean>;
  getExistingExternalIds(userId: string, source: string, externalIds: string[]): Promise<Set<string>>;
  bulkCreateEvents(events: InsertEvent[]): Promise<Event[]>;

  // Chores
  getChores(): Promise<Chore[]>;
  getChoresByUser(userId: string): Promise<Chore[]>;
  getChoresByProfile(profileId: string): Promise<Chore[]>;
  createChore(chore: InsertChore): Promise<Chore>;
  updateChore(id: string, chore: Partial<InsertChore>, userId: string): Promise<Chore | undefined>;
  /** Deletes the chore AND any sub-to-dos filed under it, as one group. */
  deleteChore(id: string, userId: string): Promise<boolean>;
  /** Sub-to-dos filed under a given to-do, in display order. */
  getChildChores(parentId: string): Promise<Chore[]>;
  /**
   * Marks to-dos whose completion is older than `cutoff` as archived, plus
   * any sub-to-dos filed under them. Nothing is deleted — archived rows are
   * still the record behind stars already awarded and Family Activity; they
   * just stop being shipped to every client on every app open. Returns how
   * many rows were archived.
   */
  archiveOldCompletedTodos(userId: string, cutoff: Date): Promise<number>;
  reorderChores(userId: string, orderedIds: string[]): Promise<void>;

  // Chore Completions
  getChoreCompletions(): Promise<ChoreCompletion[]>;
  getChoreSkips(userId: string, since: Date): Promise<ChoreSkip[]>;
  addChoreSkip(userId: string, choreId: string, profileId: string, skipDate: Date): Promise<ChoreSkip>;
  removeChoreSkip(userId: string, choreId: string, profileId: string, skipDate: Date): Promise<boolean>;
  getChoreCompletionsByProfile(profileId: string): Promise<ChoreCompletion[]>;
  getChoreCompletionsByDate(date: Date): Promise<ChoreCompletion[]>;
  getChoreCompletionsByUser(userId: string): Promise<ChoreCompletion[]>;
  getChoreCompletionsByUserAndDate(userId: string, date: Date): Promise<ChoreCompletion[]>;
  getChoreCompletionsInRange(choreId: string, profileId: string, startDate: Date, endDate: Date): Promise<ChoreCompletion[]>;
  getChoreCompletionsByChore(choreId: string): Promise<ChoreCompletion[]>;
  createChoreCompletion(completion: InsertChoreCompletion): Promise<ChoreCompletion>;
  deleteChoreCompletion(choreId: string, profileId: string): Promise<void>;

  // Achievements
  getAchievements(): Promise<Achievement[]>;
  getAchievementsByProfile(profileId: string): Promise<Achievement[]>;
  getAchievementsByUser(userId: string): Promise<Achievement[]>;
  createAchievement(achievement: InsertAchievement): Promise<Achievement>;

  // Calendar Settings
  getCalendarSettingsByUser(userId: string): Promise<CalendarSettings | undefined>;
  updateCalendarSettings(settings: InsertCalendarSettings & { userId: string }): Promise<CalendarSettings>;
  claimPlanKey(userId: string, key: string, today: string): Promise<boolean>;
  releasePlanKey(userId: string, key: string): Promise<void>;

  // Location Settings
  getLocationSettingsByUser(userId: string): Promise<LocationSettings | undefined>;
  updateLocationSettings(settings: InsertLocationSettings & { userId: string }): Promise<LocationSettings>;

  // Google Calendar Tokens
  getGoogleCalendarTokens(profileId: string): Promise<GoogleCalendarTokens | undefined>;
  saveGoogleCalendarTokens(tokens: InsertGoogleCalendarTokens): Promise<GoogleCalendarTokens>;
  disconnectGoogleCalendar(profileId: string): Promise<boolean>;
  getGoogleAccountsByUser(userId: string): Promise<{ profileId: string; email: string }[]>;
  setGoogleCalendarSelection(profileId: string, calendarIds: string[]): Promise<GoogleCalendarTokens | undefined>;
  setGoogleCalendarWriteTarget(profileId: string, calendarId: string | null): Promise<GoogleCalendarTokens | undefined>;

  // Outlook Calendar Tokens
  getOutlookCalendarTokens(profileId: string): Promise<OutlookCalendarTokens | undefined>;
  saveOutlookCalendarTokens(tokens: InsertOutlookCalendarTokens): Promise<OutlookCalendarTokens>;
  disconnectOutlookCalendar(profileId: string): Promise<boolean>;
  setOutlookCalendarSelection(profileId: string, calendarIds: string[]): Promise<OutlookCalendarTokens | undefined>;
  setOutlookCalendarWriteTarget(profileId: string, calendarId: string | null): Promise<OutlookCalendarTokens | undefined>;

  // iCal (.ics URL) subscriptions — read-only
  getIcalSubscriptions(profileId: string): Promise<IcalSubscription[]>;
  getIcalSubscriptionById(id: string): Promise<IcalSubscription | undefined>;
  getIcalSubscriptionsByUser(userId: string): Promise<IcalSubscription[]>;
  createIcalSubscription(sub: InsertIcalSubscription): Promise<IcalSubscription>;
  deleteIcalSubscription(id: string): Promise<boolean>;
  updateIcalSubscriptionStatus(id: string, status: { lastFetchedAt?: Date; lastError?: string | null }): Promise<void>;

  // BratBusters Behaviour Board
  getBehaviourBoardSettings(userId: string): Promise<BehaviourBoardSettings | undefined>;
  upsertBehaviourBoardSettings(userId: string, updates: Partial<InsertBehaviourBoardSettings>): Promise<BehaviourBoardSettings>;
  getBehaviourRules(userId: string): Promise<BehaviourRule[]>;
  getBehaviourRule(id: string, userId: string): Promise<BehaviourRule | undefined>;
  createBehaviourRule(rule: InsertBehaviourRule): Promise<BehaviourRule>;
  updateBehaviourRule(id: string, updates: Partial<InsertBehaviourRule>, userId: string): Promise<BehaviourRule | undefined>;
  deleteBehaviourRule(id: string, userId: string): Promise<boolean>;
  getBehaviourIncidents(userId: string, opts?: { status?: string; limit?: number }): Promise<BehaviourIncident[]>;
  getBehaviourIncident(id: string, userId: string): Promise<BehaviourIncident | undefined>;
  createBehaviourIncident(incident: InsertBehaviourIncident): Promise<BehaviourIncident>;
  resolveBehaviourIncident(id: string, userId: string, status: "resolved_positive" | "negative_applied", note?: string | null): Promise<BehaviourIncident | undefined>;
  deleteBehaviourIncident(id: string, userId: string): Promise<boolean>;

  // Calendar Assignments
  getCalendarAssignments(profileId: string): Promise<CalendarAssignment[]>;
  getCalendarAssignmentsByUser(userId: string): Promise<CalendarAssignment[]>;
  saveCalendarAssignment(assignment: InsertCalendarAssignment): Promise<CalendarAssignment>;
  deleteCalendarAssignment(calendarType: string, calendarId: string, profileId: string): Promise<boolean>;
  getCalendarAssignmentsForProfile(profileId: string): Promise<CalendarAssignment[]>;

  // Google Calendar Event Assignments (DB-backed, works for read-only/imported calendars)
  getGoogleEventAssignmentsByUser(userId: string): Promise<GoogleCalendarEventAssignment[]>;
  setGoogleEventAssignment(userId: string, calendarId: string, eventId: string, profileIds: string[], driverIds?: string[] | null, seriesFromDate?: Date | null): Promise<void>;
  clearGoogleEventInstanceOverridesForSeries(userId: string, calendarId: string, recurringEventId: string, fromDate: Date): Promise<void>;

  // Event ↔ external calendar sync links (two-way sync)
  getEventCalendarSyncs(eventId: string): Promise<EventCalendarSync[]>;
  getExternalEventIdsByUser(userId: string, provider: string): Promise<Set<string>>;
  upsertEventCalendarSync(row: InsertEventCalendarSync): Promise<EventCalendarSync>;
  getRecentSyncErrors(userId: string, limit: number): Promise<{
    id: string; eventId: string; eventTitle: string; eventStartTime: Date;
    provider: string; lastError: string | null; updatedAt: Date; profileNames: string[];
  }[]>;
  dismissSyncError(userId: string, eventId: string, provider: string): Promise<void>;
  /** Events with an unresolved sync error for this profile+provider — used to
      retry pushes after a (re)connect. */
  getErroredSyncEvents(profileId: string, provider: string): Promise<Event[]>;
  deleteEventCalendarSync(eventId: string, profileId: string, provider: string): Promise<void>;
  deleteEventCalendarSyncsForEvent(eventId: string): Promise<void>;

  // Daily Content
  getDailyContent(): Promise<DailyContent[]>;
  getDailyContentByUser(userId: string): Promise<DailyContent[]>;
  getDailyContentById(id: string): Promise<DailyContent | undefined>;
  createDailyContent(content: InsertDailyContent): Promise<DailyContent>;
  updateDailyContent(id: string, content: Partial<InsertDailyContent>, userId: string): Promise<DailyContent | undefined>;
  deleteDailyContent(id: string, userId: string): Promise<boolean>;
  
  // Daily Content Assignments
  getAllDailyContentAssignments(): Promise<DailyContentAssignment[]>;
  getAllDailyContentAssignmentsByUser(userId: string): Promise<DailyContentAssignment[]>;
  getDailyContentAssignments(contentId: string): Promise<DailyContentAssignment[]>;
  getDailyContentAssignmentsByContentAndUser(contentId: string, userId: string): Promise<DailyContentAssignment[]>;
  createDailyContentAssignment(assignment: InsertDailyContentAssignment): Promise<DailyContentAssignment>;
  deleteDailyContentAssignments(contentId: string): Promise<boolean>;

  // Daily Content Completions
  getDailyContentCompletions(profileId?: string, date?: Date): Promise<DailyContentCompletion[]>;
  getDailyContentCompletionsByUser(userId: string, date?: Date): Promise<DailyContentCompletion[]>;
  createDailyContentCompletion(completion: InsertDailyContentCompletion): Promise<DailyContentCompletion>;
  deleteDailyContentCompletion(contentId: string, profileId: string): Promise<boolean>;

  // Rewards
  getRewards(): Promise<Reward[]>;
  getRewardsByUser(userId: string): Promise<Reward[]>;
  getRewardById(id: string): Promise<Reward | undefined>;
  createReward(reward: InsertReward): Promise<Reward>;
  updateReward(id: string, reward: Partial<InsertReward>, userId: string): Promise<Reward | undefined>;
  deleteReward(id: string, userId: string): Promise<boolean>;

  // Reward Redemptions
  getRewardRedemptions(profileId?: string): Promise<RewardRedemption[]>;
  getRewardRedemptionsByUser(userId: string, profileId?: string): Promise<RewardRedemption[]>;
  createRewardRedemption(redemption: InsertRewardRedemption): Promise<RewardRedemption>;
  updateRewardRedemption(id: string, redemption: Partial<InsertRewardRedemption>, userId: string): Promise<RewardRedemption | undefined>;

  // Gamification Helpers
  getProfilePoints(profileId: string, dbClient?: DbOrTx): Promise<number>;
  getStarLedger(profileId: string): Promise<StarLedger>;
  listPointAdjustments(profileId: string, limit?: number): Promise<PointAdjustment[]>;
  createPointAdjustment(input: { userId: string; profileId: string; delta: number; reason: string | null }): Promise<PointAdjustment>;
  getCompletionBonus(profileId: string, localDayStart: Date): Promise<CompletionBonus | undefined>;
  createCompletionBonus(input: InsertCompletionBonus): Promise<CompletionBonus>;
  deleteCompletionBonus(profileId: string, localDayStart: Date): Promise<void>;
  getProfileStreak(profileId: string): Promise<number>;
  getProfileStreakDetails(profileId: string): Promise<{
    streak: number;
    weekKey: string;
    hasFreezeThisWeek: boolean;
    frozenDates: string[];
    canUseFreezeForYesterday: boolean;
  }>;
  getChoreCompletionCount(profileId: string): Promise<number>;
  getCategoryCompletionCounts(profileId: string): Promise<Record<string, number>>;

  // Streak Freezes
  getStreakFreezesForProfile(profileId: string, limit?: number): Promise<StreakFreeze[]>;
  getStreakFreezeForWeek(profileId: string, weekKey: string): Promise<StreakFreeze | undefined>;
  createStreakFreeze(input: { profileId: string; userId: string; weekKey: string; usedForDate: string }): Promise<{ created: boolean; freeze: StreakFreeze }>;

  // Shoutouts (family praise)
  createShoutout(input: { userId: string; fromProfileId: string; toProfileId: string; emoji: string; message: string }): Promise<Shoutout>;
  listShoutoutsForUser(userId: string, limit?: number): Promise<Shoutout[]>;
  getShoutout(id: string): Promise<Shoutout | undefined>;
  markShoutoutSeen(id: string, userId: string): Promise<Shoutout | undefined>;
  getUnseenShoutoutCount(userId: string): Promise<number>;


  // Comments (polymorphic on chore/event)
  listComments(userId: string, entityType: string, entityId: string): Promise<Comment[]>;
  createComment(input: { userId: string; entityType: string; entityId: string; authorProfileId: string | null; message: string }): Promise<Comment>;
  getComment(id: string): Promise<Comment | undefined>;
  deleteComment(id: string, userId: string): Promise<boolean>;

  // Family share tokens (public read-only links)
  listShareTokens(userId: string): Promise<FamilyShareToken[]>;
  createShareToken(input: { userId: string; token: string; label: string | null; expiresAt: Date | null }): Promise<FamilyShareToken>;
  revokeShareToken(id: string, userId: string): Promise<boolean>;
  getShareTokenByToken(token: string): Promise<FamilyShareToken | undefined>;
  touchShareToken(id: string): Promise<void>;

  // Allowance
  getAllowanceSettings(profileId: string): Promise<AllowanceSettings | undefined>;
  upsertAllowanceSettings(input: { userId: string; profileId: string; centsPerPoint: number; currency?: string }): Promise<AllowanceSettings>;
  listAllowancePayouts(profileId: string, limit?: number): Promise<AllowancePayout[]>;
  createAllowancePayout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }): Promise<AllowancePayout>;
  getTotalAllowancePaidPoints(profileId: string): Promise<number>;

  // Reward Settings (unified)
  getRewardSettings(userId: string): Promise<RewardSettings | undefined>;
  upsertRewardSettings(input: { userId: string; redemptionMode?: string; centsPerPoint?: number; currencySymbol?: string; minCashoutPoints?: number; pointsMode?: string; completionBonusPoints?: number; parentPin?: string | null; pinGatedFeatures?: string[] | null; pinResetCodeHash?: string | null; pinResetCodeExpiresAt?: Date | null }): Promise<RewardSettings>;

  // Onboarding walkthrough progress
  getOnboardingStatus(userId: string): Promise<OnboardingStatus | undefined>;
  setOnboardingStep(
    userId: string,
    step: "profile" | "location" | "rewards" | "invite" | "calendar",
    patch: { status?: "done" | "skipped" | null; dismissedUntil?: Date | null },
  ): Promise<OnboardingStatus>;

  // Wallet
  getWalletSettings(userId: string): Promise<WalletSettings | undefined>;
  upsertWalletSettings(input: { userId: string; currencySymbol?: string; minCashoutCents?: number }): Promise<WalletSettings>;
  getOrCreateWalletBalance(userId: string, profileId: string, dbClient?: DbOrTx): Promise<WalletBalance>;
  listWalletTransactions(profileId: string, limit?: number): Promise<WalletTransaction[]>;
  getWalletTransaction(id: string): Promise<WalletTransaction | undefined>;
  listPendingCashouts(userId: string): Promise<WalletTransaction[]>;
  sumPendingCashoutCents(profileId: string): Promise<{ cents: number; points: number }>;
  createCashoutRequest(input: { userId: string; profileId: string; points: number; cents: number; note: string | null }, dbClient?: DbOrTx): Promise<WalletTransaction>;
  approveCashout(txId: string, userId: string): Promise<WalletTransaction | null>;
  declineCashout(txId: string, userId: string): Promise<WalletTransaction | null>;
  /** Unified cashout: records an allowance payout + credits wallet balance + returns the approved tx. */
  cashout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }, dbClient?: DbOrTx): Promise<WalletTransaction>;
  markPaid(input: { userId: string; profileId: string; amountCents: number; note: string | null }): Promise<WalletTransaction | null>;
  depositToSavings(input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null>;
  withdrawFromSavings(input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null>;
  listSavingsGoals(profileId: string): Promise<SavingsGoal[]>;
  getSavingsGoal(id: string): Promise<SavingsGoal | undefined>;
  createSavingsGoal(input: { userId: string; profileId: string; name: string; targetCents: number; photoUrl: string | null }): Promise<SavingsGoal>;
  updateSavingsGoal(id: string, userId: string, updates: { name?: string; targetCents?: number; photoUrl?: string | null }): Promise<SavingsGoal | null>;
  deleteSavingsGoal(id: string, userId: string): Promise<boolean>;
  getApprovedCashoutPoints(profileId: string): Promise<number>;
  getReservedCashoutPoints(profileId: string, dbClient?: DbOrTx): Promise<number>;

  // Custom Profile Groups
  getCustomProfileGroups(userId: string): Promise<CustomProfileGroup[]>;
  getCustomProfileGroup(id: string): Promise<CustomProfileGroup | undefined>;
  createCustomProfileGroup(group: InsertCustomProfileGroup): Promise<CustomProfileGroup>;
  updateCustomProfileGroup(id: string, group: Partial<InsertCustomProfileGroup>, userId: string): Promise<CustomProfileGroup | undefined>;
  deleteCustomProfileGroup(id: string, userId: string): Promise<boolean>;
  reorderCustomProfileGroups(userId: string, orderedIds: string[]): Promise<void>;

  // Meals
  getMealsByUser(userId: string): Promise<Meal[]>;
  getMealsByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<Meal[]>;
  getMeal(id: string, userId: string): Promise<Meal | undefined>;
  createMeal(meal: InsertMeal): Promise<Meal>;
  updateMeal(id: string, updates: Partial<InsertMeal>, userId: string): Promise<Meal | undefined>;
  deleteMeal(id: string, userId: string): Promise<boolean>;

  // Meal Ingredients
  getIngredientsByMealIds(mealIds: string[]): Promise<MealIngredient[]>;
  replaceMealIngredients(mealId: string, ingredients: Omit<InsertMealIngredient, "mealId">[]): Promise<MealIngredient[]>;

  // Grocery Items
  getGroceryItemsByUser(userId: string): Promise<GroceryItem[]>;
  createGroceryItem(item: InsertGroceryItem): Promise<GroceryItem>;
  createGroceryItems(userId: string, items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]>;
  updateGroceryItem(id: string, updates: Partial<InsertGroceryItem>, userId: string): Promise<GroceryItem | undefined>;
  deleteGroceryItem(id: string, userId: string): Promise<boolean>;
  deleteCheckedGroceryItems(userId: string): Promise<number>;
  replaceGroceryItemsForUser(userId: string, items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]>;
  getGroceryStaplesByUser(userId: string): Promise<GroceryStaple[]>;
  createGroceryStaple(staple: InsertGroceryStaple): Promise<GroceryStaple>;
  updateGroceryStaple(id: string, updates: Partial<InsertGroceryStaple>, userId: string): Promise<GroceryStaple | undefined>;
  deleteGroceryStaple(id: string, userId: string): Promise<boolean>;

  // Saved Meals (repository of reusable meal ideas)
  getSavedMealsByUser(userId: string): Promise<SavedMeal[]>;
  getSavedMeal(id: string, userId: string): Promise<SavedMeal | undefined>;
  createSavedMeal(savedMeal: InsertSavedMeal): Promise<SavedMeal>;
  updateSavedMeal(id: string, updates: Partial<InsertSavedMeal>, userId: string): Promise<SavedMeal | undefined>;
  deleteSavedMeal(id: string, userId: string): Promise<boolean>;
  getSavedMealIngredients(savedMealIds: string[]): Promise<SavedMealIngredient[]>;
  replaceSavedMealIngredients(savedMealId: string, ingredients: Omit<InsertSavedMealIngredient, "savedMealId">[]): Promise<SavedMealIngredient[]>;

  // Celebrations
  getCelebrationsByUser(userId: string): Promise<Celebration[]>;
  getCelebration(id: string, userId: string): Promise<Celebration | undefined>;
  createCelebration(celebration: InsertCelebration): Promise<Celebration>;
  updateCelebration(id: string, updates: Partial<InsertCelebration>, userId: string): Promise<Celebration | undefined>;
  deleteCelebration(id: string, userId: string): Promise<boolean>;

  // Celebration gift ideas
  getGiftIdeasByCelebrationIds(celebrationIds: string[]): Promise<CelebrationGiftIdea[]>;
  createGiftIdea(idea: InsertCelebrationGiftIdea): Promise<CelebrationGiftIdea>;
  updateGiftIdea(id: string, updates: Partial<InsertCelebrationGiftIdea>, userId: string): Promise<CelebrationGiftIdea | undefined>;
  deleteGiftIdea(id: string, userId: string): Promise<boolean>;

  // Celebration photos
  getPhotosByCelebrationIds(celebrationIds: string[]): Promise<CelebrationPhoto[]>;
  getCelebrationPhoto(id: string, userId: string): Promise<CelebrationPhoto | undefined>;
  createCelebrationPhoto(photo: InsertCelebrationPhoto): Promise<CelebrationPhoto>;
  deleteCelebrationPhoto(id: string, userId: string): Promise<boolean>;

  // Wishlist items
  getWishlistItemsByUser(userId: string, opts?: { status?: string; submittedByProfileId?: string }): Promise<WishlistItem[]>;
  getWishlistItem(id: string, userId: string): Promise<WishlistItem | undefined>;
  createWishlistItem(item: InsertWishlistItem): Promise<WishlistItem>;
  updateWishlistItem(id: string, updates: Partial<WishlistItem>, userId: string): Promise<WishlistItem | undefined>;
  /**
   * Atomically transition a pending wishlist item into the `approved` status.
   * Returns the updated row on success, or undefined if the row is missing or
   * is already approved/declined/archived. Used to make the approve flow
   * idempotent under concurrent requests.
   */
  claimWishlistItemForApproval(id: string, userId: string): Promise<WishlistItem | undefined>;
  deleteWishlistItem(id: string, userId: string): Promise<boolean>;

  // Chore wheel spin history
  createChoreSpin(spin: InsertChoreSpin): Promise<ChoreSpin>;
  getRecentChoreSpins(userId: string, limit?: number): Promise<ChoreSpin[]>;
  getChoreSpin(id: string, userId: string): Promise<ChoreSpin | undefined>;
  setChoreSpinAssignment(id: string, userId: string, assignedChoreId: string | null): Promise<ChoreSpin | undefined>;
  /** Most recent spin for this user matching either choreId (preferred) or normalized choreTitle. */
  getLastChoreWinner(userId: string, params: { choreId?: string | null; choreTitle?: string | null }): Promise<ChoreSpin | undefined>;

  // Health reminders
  getHealthRemindersByUser(userId: string, opts?: { profileId?: string; includePaused?: boolean }): Promise<HealthReminder[]>;
  getHealthReminder(id: string, userId: string): Promise<HealthReminder | undefined>;
  createHealthReminder(reminder: InsertHealthReminder): Promise<HealthReminder>;
  updateHealthReminder(id: string, updates: Partial<InsertHealthReminder>, userId: string): Promise<HealthReminder | undefined>;
  deleteHealthReminder(id: string, userId: string): Promise<boolean>;
  /** Active = not paused, within startsAt..endsAt. Used by the dispatcher. */
  getActiveHealthReminders(now: Date): Promise<HealthReminder[]>;
  /**
   * Idempotent insert of a scheduled-occurrence row. Returns the existing row
   * if (reminderId, scheduledAt) already exists. Used by the dispatcher to
   * avoid double-firing across ticks / restarts.
   */
  ensureHealthReminderEvent(input: {
    reminderId: string;
    userId: string;
    profileId: string;
    scheduledAt: Date;
  }): Promise<{ event: HealthReminderEvent; created: boolean }>;
  markHealthReminderEventFired(id: string): Promise<HealthReminderEvent | undefined>;
  /** Moves a pending or snoozed dose to fired. False when another wake already took it. */
  claimHealthReminderDispatch(id: string, fromStatus: "pending" | "snoozed"): Promise<boolean>;
  /** Puts a dose back when every push failed, unless someone already acknowledged it. */
  releaseHealthReminderDispatch(id: string, fromStatus: "pending" | "snoozed"): Promise<void>;
  acknowledgeHealthReminderEvent(id: string, userId: string, byProfileId: string | null): Promise<HealthReminderEvent | undefined>;
  snoozeHealthReminderEvent(id: string, userId: string, until: Date): Promise<HealthReminderEvent | undefined>;
  markHealthReminderEventMissed(id: string): Promise<HealthReminderEvent | undefined>;
  /** Snoozed events whose snoozeUntil <= now — i.e. actually due to re-fire. */
  getDueHealthReminderEvents(now: Date): Promise<HealthReminderEvent[]>;
  getHealthReminderEvents(userId: string, opts?: { profileId?: string; status?: string; limit?: number }): Promise<HealthReminderEvent[]>;
  getUnacknowledgedHealthReminderEvents(userId: string): Promise<HealthReminderEvent[]>;

  // Account reset
  resetUserData(userId: string): Promise<void>;
  resetUserDataCategories(userId: string, categories: ResetCategory[]): Promise<void>;
}

export const RESET_CATEGORIES = ["chores", "profiles", "calendar", "meals", "rewards", "behaviour", "notes"] as const;
export type ResetCategory = (typeof RESET_CATEGORIES)[number];

export class DatabaseStorage implements IStorage {
  async getProfiles(): Promise<Profile[]> {
    return loadProfiles();
  }

  async getProfilesByUser(userId: string): Promise<Profile[]> {
    return loadProfiles(eq(profiles.userId, userId));
  }

  async getProfile(id: string): Promise<Profile | undefined> {
    const [profile] = await loadProfiles(eq(profiles.id, id));
    return profile || undefined;
  }

  async createProfile(insertProfile: InsertProfile): Promise<Profile> {
    return insertProfileRow(insertProfile);
  }

  async updateProfile(id: string, insertProfile: Partial<InsertProfile>, userId?: string): Promise<Profile | undefined> {
    // Setting a daily-brief or bedtime time for the first time is what gives
    // those schedulers something to do; they are idle until then.
    markSchedulerWorkDirty("dailyBrief", "bedtimeReminders", "weeklyRecap");
    const whereCondition = userId 
      ? and(eq(profiles.id, id), eq(profiles.userId, userId))
      : eq(profiles.id, id);
    return updateProfileRow(insertProfile, whereCondition);
  }

  async deleteProfile(id: string, userId?: string): Promise<boolean> {
    try {
      // If userId is provided, verify ownership first
      if (userId) {
        const [profile] = await loadProfiles(and(eq(profiles.id, id), eq(profiles.userId, userId)));
        if (!profile) {
          return false;
        }
      }

      // Delete all chore completions for this profile
      await db.delete(choreCompletions).where(eq(choreCompletions.profileId, id));

      // Delete all daily content assignments for this profile
      await db.delete(dailyContentAssignments).where(eq(dailyContentAssignments.profileId, id));

      // Delete all daily content completions for this profile
      await db.delete(dailyContentCompletions).where(eq(dailyContentCompletions.profileId, id));

      // Delete all calendar tokens for this profile
      await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.profileId, id));
      await db.delete(outlookCalendarTokens).where(eq(outlookCalendarTokens.profileId, id));

      // Delete all calendar assignments for this profile
      await db.delete(calendarAssignments).where(eq(calendarAssignments.profileId, id));

      // Delete all reward redemptions for this profile
      await db.delete(rewardRedemptions).where(eq(rewardRedemptions.profileId, id));

      // Delete all achievements for this profile
      await db.delete(achievements).where(eq(achievements.profileId, id));

      // Any reward scoped to just this profile (rewards.scopeProfileId is a
      // RESTRICT-default FK, not cascade/set-null) would otherwise block the
      // final profile delete below with a foreign-key violation. Rather than
      // deleting the reward outright, clear the scope back to null — matching
      // the column's own "null = all profiles can earn" default, so the
      // reward survives for the rest of the family instead of vanishing.
      await db.update(rewards).set({ scopeProfileId: null }).where(eq(rewards.scopeProfileId, id));

      // Delete all chores that only reference this profile.
      // ⚠️ Real bug fixed here: an open bonus chore ("everyone can claim
      // it") is deliberately stored with an EMPTY profileIds array — that's
      // not "unassigned," it's its normal open-to-all state. Filtering this
      // profile's id out of an already-empty array is still empty, so the
      // old code mistook every open bonus chore in the family for "now
      // orphaned, delete it," even though it was never scoped to this
      // profile and other still-active profiles may have already completed
      // it — which then failed the whole profile delete with a foreign-key
      // violation from THEIR chore_completions rows. Skipping any chore
      // this profile's id doesn't actually appear in leaves open/shared
      // chores (and chores solely assigned to other profiles) untouched.
      const allChores = await db.select().from(chores);
      for (const chore of allChores) {
        const decision = decideProfileIdCleanup(chore.profileIds, id);
        if (decision.action === "skip") continue;
        if (decision.action === "delete") {
          // Defense in depth: clear any leftover chore_completions first,
          // from ANY profile — the chore is being removed regardless of who
          // completed it, and chore_completions.choreId is a RESTRICT FK
          // that would otherwise block this delete the same way the
          // profileIds bug decideProfileIdCleanup fixes did.
          await db.delete(choreCompletions).where(eq(choreCompletions.choreId, chore.id));
          await db.delete(chores).where(eq(chores.id, chore.id));
        } else {
          await db.update(chores).set({ profileIds: decision.profileIds }).where(eq(chores.id, chore.id));
        }
      }

      // Delete all events that only reference this profile. Same guard as
      // chores above — an event with an empty profileIds array shouldn't be
      // possible going forward (every creation path now defaults to at
      // least one assignee), but legacy/imported rows could still have one,
      // and the identical "empty stays empty" mis-delete would apply.
      const allEvents = await db.select().from(events);
      for (const event of allEvents) {
        const decision = decideProfileIdCleanup(event.profileIds, id);
        if (decision.action === "skip") continue;
        if (decision.action === "delete") {
          await db.delete(events).where(eq(events.id, event.id));
        } else {
          await db.update(events).set({ profileIds: decision.profileIds }).where(eq(events.id, event.id));
        }
      }

      // Finally, delete the profile
      const result = await db.delete(profiles).where(eq(profiles.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error(`Error deleting profile ${id}:`, error);
      throw error;
    }
  }

  async getEvents(): Promise<Event[]> {
    return await db.select().from(events);
  }

  async getEventsByUser(userId: string): Promise<Event[]> {
    return await db.select().from(events).where(eq(events.userId, userId));
  }

  async getEventsByProfile(profileId: string): Promise<Event[]> {
    const allEvents = await db.select().from(events);
    return allEvents.filter(event =>
      (event.profileIds && event.profileIds.includes(profileId)) ||
      driverIdsOf(event).includes(profileId)
    );
  }

  async getEventsByDateRange(startDate: Date, endDate: Date): Promise<Event[]> {
    return await db.select().from(events).where(
      and(
        gte(events.startTime, startDate),
        lte(events.endTime, endDate)
      )
    );
  }

  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const eventData = {
      ...insertEvent,
      profileIds: (Array.isArray(insertEvent.profileIds) ? insertEvent.profileIds : []) as string[]
    };
    const [event] = await db
      .insert(events)
      .values([eventData] as any)
      .returning();
    return event;
  }

  async updateEvent(id: string, insertEvent: Partial<InsertEvent>, userId: string): Promise<Event | undefined> {
    const updateData: any = { ...insertEvent };
    if (insertEvent.profileIds !== undefined) {
      updateData.profileIds = (Array.isArray(insertEvent.profileIds) ? insertEvent.profileIds : []) as string[];
    }
    const [event] = await db
      .update(events)
      .set(updateData)
      .where(and(eq(events.id, id), eq(events.userId, userId)))
      .returning();
    return event || undefined;
  }

  async deleteEvent(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(events).where(and(eq(events.id, id), eq(events.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getExistingExternalIds(userId: string, source: string, externalIds: string[]): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const rows = await db
      .select({ externalId: events.externalId })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.source, source),
          inArray(events.externalId, externalIds),
        )
      );
    return new Set(rows.map(r => r.externalId).filter((v): v is string => !!v));
  }

  async bulkCreateEvents(insertEvents: InsertEvent[]): Promise<Event[]> {
    if (insertEvents.length === 0) return [];
    const eventsData = insertEvents.map(e => ({
      ...e,
      profileIds: (Array.isArray(e.profileIds) ? e.profileIds : []) as string[],
    }));
    const created = await db.insert(events).values(eventsData as any).returning();
    return created;
  }

  async getChores(): Promise<Chore[]> {
    return await db.select().from(chores);
  }

  async getChoresByUser(userId: string): Promise<Chore[]> {
    return await db
      .select()
      .from(chores)
      .where(eq(chores.userId, userId))
      .orderBy(chores.displayOrder, chores.createdAt);
  }

  async reorderChores(userId: string, orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        db
          .update(chores)
          .set({ displayOrder: index })
          .where(and(eq(chores.id, id), eq(chores.userId, userId)))
      )
    );
  }

  async getChoresByProfile(profileId: string): Promise<Chore[]> {
    const allChores = await db.select().from(chores);
    return allChores.filter(chore => 
      Array.isArray(chore.profileIds) && chore.profileIds.includes(profileId)
    );
  }

  async createChore(insertChore: InsertChore): Promise<Chore> {
    // New chores go to the end of the drag-and-drop order, not the default
    // 0 — otherwise every newly-created chore would jump to the very front
    // of the Manage Chores drawer's list.
    let nextOrder = 0;
    if (insertChore.displayOrder === undefined && insertChore.userId) {
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${chores.displayOrder}), -1)` })
        .from(chores)
        .where(eq(chores.userId, insertChore.userId));
      nextOrder = (maxOrder ?? -1) + 1;
    }
    const choreData = {
      ...insertChore,
      profileIds: (Array.isArray(insertChore.profileIds) ? insertChore.profileIds : []) as string[],
      daysOfWeek: (Array.isArray(insertChore.daysOfWeek) ? insertChore.daysOfWeek : []) as number[],
      displayOrder: insertChore.displayOrder ?? nextOrder,
    };
    const [chore] = await db
      .insert(chores)
      .values([choreData] as any)
      .returning();
    return chore;
  }

  async updateChore(id: string, insertChore: Partial<InsertChore>, userId: string): Promise<Chore | undefined> {
    const updateData: any = { ...insertChore };
    if (insertChore.profileIds !== undefined) {
      updateData.profileIds = (Array.isArray(insertChore.profileIds) ? insertChore.profileIds : []) as string[];
    }
    if (insertChore.daysOfWeek !== undefined) {
      updateData.daysOfWeek = (Array.isArray(insertChore.daysOfWeek) ? insertChore.daysOfWeek : []) as number[];
    }
    const [chore] = await db
      .update(chores)
      .set(updateData)
      .where(and(eq(chores.id, id), eq(chores.userId, userId)))
      .returning();
    return chore || undefined;
  }

  // Sub-to-dos under a given to-do, in display order. Used to warn how many
  // will be removed alongside it and to render them nested.
  async getChildChores(parentId: string): Promise<Chore[]> {
    return await db
      .select()
      .from(chores)
      .where(eq(chores.parentChoreId, parentId))
      .orderBy(chores.displayOrder, chores.createdAt);
  }

  async archiveOldCompletedTodos(userId: string, cutoff: Date): Promise<number> {
    // A to-do's completion is permanent, so "completed before the cutoff and
    // not completed since" is the whole condition. Sub-to-dos are archived
    // alongside their parent regardless of their own state — an incomplete
    // child of an archived parent has nothing left to render under.
    const parents = await db
      .update(chores)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(chores.userId, userId),
          eq(chores.taskType, "todo"),
          isNull(chores.archivedAt),
          sql`exists (select 1 from chore_completions cc where cc.chore_id = ${chores.id} and cc.completed_at < ${cutoff})`,
          sql`not exists (select 1 from chore_completions cc2 where cc2.chore_id = ${chores.id} and cc2.completed_at >= ${cutoff})`,
        ),
      )
      .returning({ id: chores.id });
    if (parents.length === 0) return 0;
    const children = await db
      .update(chores)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(chores.userId, userId),
          isNull(chores.archivedAt),
          inArray(chores.parentChoreId, parents.map((p) => p.id)),
        ),
      )
      .returning({ id: chores.id });
    return parents.length + children.length;
  }

  async deleteChore(id: string, userId: string): Promise<boolean> {
    // A to-do with sub-to-dos deletes as one group — the API surfaces a
    // confirmation naming the count first, so nothing is orphaned into the
    // main list where nobody would recognise it. Only rows owned by this user
    // are touched; each child's completions go first for the same FK reason
    // as the parent's below.
    const children = await db
      .select({ id: chores.id })
      .from(chores)
      .where(and(eq(chores.parentChoreId, id), eq(chores.userId, userId)));
    for (const child of children) {
      await db.delete(choreCompletions).where(eq(choreCompletions.choreId, child.id));
      await db.delete(chores).where(and(eq(chores.id, child.id), eq(chores.userId, userId)));
    }
    // Delete completions first — chore_completions.chore_id has no onDelete
    // cascade, so PostgreSQL will reject the chore delete if any exist.
    await db.delete(choreCompletions).where(eq(choreCompletions.choreId, id));
    const result = await db.delete(chores).where(and(eq(chores.id, id), eq(chores.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getChoreCompletions(): Promise<ChoreCompletion[]> {
    return await db.select().from(choreCompletions);
  }

  async getChoreCompletionsByProfile(profileId: string): Promise<ChoreCompletion[]> {
    return await db.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId));
  }

  // ── Chore skips ("not today", one person, one day) ───────────────────────
  // Stored as local-midnight instants sent by the client; normalized here to
  // the exact same instant on write and read so a lookup can be an equality
  // check rather than a range.
  async getChoreSkips(userId: string, since: Date): Promise<ChoreSkip[]> {
    return await db.select().from(choreSkips).where(
      and(eq(choreSkips.userId, userId), gte(choreSkips.skipDate, since)),
    );
  }

  async addChoreSkip(userId: string, choreId: string, profileId: string, skipDate: Date): Promise<ChoreSkip> {
    const existing = await db.select().from(choreSkips).where(
      and(
        eq(choreSkips.userId, userId),
        eq(choreSkips.choreId, choreId),
        eq(choreSkips.profileId, profileId),
        eq(choreSkips.skipDate, skipDate),
      ),
    );
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(choreSkips).values({ userId, choreId, profileId, skipDate }).returning();
    return row;
  }

  async removeChoreSkip(userId: string, choreId: string, profileId: string, skipDate: Date): Promise<boolean> {
    const result = await db.delete(choreSkips).where(
      and(
        eq(choreSkips.userId, userId),
        eq(choreSkips.choreId, choreId),
        eq(choreSkips.profileId, profileId),
        eq(choreSkips.skipDate, skipDate),
      ),
    );
    return (result.rowCount ?? 0) > 0;
  }


  async getChoreCompletionsByDate(date: Date): Promise<ChoreCompletion[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db.select().from(choreCompletions).where(
      and(
        gte(choreCompletions.completedAt, startOfDay),
        lte(choreCompletions.completedAt, endOfDay)
      )
    );
  }

  async getChoreCompletionsByUser(userId: string): Promise<ChoreCompletion[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    return await db.select().from(choreCompletions).where(inArray(choreCompletions.profileId, profileIds));
  }

  async getChoreCompletionsByUserAndDate(userId: string, date: Date): Promise<ChoreCompletion[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    return await db.select().from(choreCompletions).where(
      and(
        inArray(choreCompletions.profileId, profileIds),
        gte(choreCompletions.completedAt, startOfDay),
        lte(choreCompletions.completedAt, endOfDay)
      )
    );
  }

  async getChoreCompletionsInRange(choreId: string, profileId: string, startDate: Date, endDate: Date): Promise<ChoreCompletion[]> {
    return await db.select().from(choreCompletions).where(
      and(
        eq(choreCompletions.choreId, choreId),
        eq(choreCompletions.profileId, profileId),
        gte(choreCompletions.completedAt, startDate),
        lte(choreCompletions.completedAt, endDate)
      )
    );
  }

  async getChoreCompletionsByChore(choreId: string): Promise<ChoreCompletion[]> {
    return await db.select().from(choreCompletions).where(eq(choreCompletions.choreId, choreId));
  }

  async createChoreCompletion(insertChoreCompletion: InsertChoreCompletion): Promise<ChoreCompletion> {
    const [choreCompletion] = await db
      .insert(choreCompletions)
      .values(insertChoreCompletion)
      .returning();
    return choreCompletion;
  }

  async deleteChoreCompletion(choreId: string, profileId: string): Promise<void> {
    await db.delete(choreCompletions).where(
      and(
        eq(choreCompletions.choreId, choreId),
        eq(choreCompletions.profileId, profileId)
      )
    );
  }

  async getAchievements(): Promise<Achievement[]> {
    return await db.select().from(achievements);
  }

  async getAchievementsByProfile(profileId: string): Promise<Achievement[]> {
    return await db.select().from(achievements).where(eq(achievements.profileId, profileId));
  }

  async getAchievementsByUser(userId: string): Promise<Achievement[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    return await db.select().from(achievements).where(inArray(achievements.profileId, profileIds));
  }

  async createAchievement(insertAchievement: InsertAchievement): Promise<Achievement> {
    const [achievement] = await db
      .insert(achievements)
      .values(insertAchievement)
      .returning();
    return achievement;
  }

  // Calendar Settings
  // Resilient to the two_way_sync_enabled column not existing yet (pre-migration):
  // returns undefined so callers fall back to defaults rather than 500-ing.
  async getCalendarSettingsByUser(userId: string): Promise<CalendarSettings | undefined> {
    try {
      const rows = await db.select().from(calendarSettings).where(eq(calendarSettings.userId, userId));
      // Belt and braces: the WHERE already scopes this, and re-checking in
      // code means a future edit that loosens the query can't silently start
      // handing one family another's row. settingsRowForUser is the tested
      // half of the pair.
      return settingsRowForUser(rows, userId);
    } catch (e) {
      console.warn("getCalendarSettingsByUser failed (column missing?):", e instanceof Error ? e.message : e);
      return undefined;
    }
  }

  /**
   * ⚠️ `userId` is REQUIRED and is what identifies the row to update.
   *
   * This used to call the unscoped `getCalendarSettings()` — a bare
   * `SELECT ... LIMIT 1` — and then update whichever row came back, stamping
   * the caller's userId onto it. With one family that is correct by accident;
   * with two, one family silently overwrites the other's settings and the
   * loser ends up with no row at all. The same bug was found and fixed on the
   * READ side for /api/weather in 2026-09 and the write side was missed.
   */
  async updateCalendarSettings(settings: InsertCalendarSettings & { userId: string }): Promise<CalendarSettings> {
    // One statement, not read-then-write: two concurrent first saves could
    // each find no row and both insert. `set` carries only the fields the
    // caller actually sent, so a partial write (the two-way-sync PATCH sends
    // one field) still updates just that column — same as the read-then-update
    // it replaces.
    const [saved] = await db
      .insert(calendarSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: calendarSettings.userId,
        set: { ...settings, updatedAt: new Date() },
      })
      .returning();
    return saved;
  }

  async claimPlanKey(userId: string, key: string, today: string): Promise<boolean> {
    const kept = sql`(
      SELECT COALESCE(jsonb_agg(to_jsonb(elem)), '[]'::jsonb)
      FROM jsonb_array_elements_text(COALESCE(${calendarSettings.planSentKeys}, '[]'::jsonb)) AS elem
      WHERE split_part(elem, ':', 2) >= ${today}
    ) || jsonb_build_array(${key})`;
    const claimed = await db.update(calendarSettings).set({
      planSentKeys: kept,
      updatedAt: new Date(),
    }).where(and(
      eq(calendarSettings.userId, userId),
      sql`NOT (${calendarSettings.planSentKeys} @> jsonb_build_array(${key}))`,
    )).returning({ userId: calendarSettings.userId });
    if (claimed.length > 0) return true;
    const inserted = await db.insert(calendarSettings).values({ userId, planSentKeys: [key] }).onConflictDoNothing().returning({ userId: calendarSettings.userId });
    if (inserted.length > 0) return true;
    const again = await db.update(calendarSettings).set({
      planSentKeys: kept,
      updatedAt: new Date(),
    }).where(and(
      eq(calendarSettings.userId, userId),
      sql`NOT (${calendarSettings.planSentKeys} @> jsonb_build_array(${key}))`,
    )).returning({ userId: calendarSettings.userId });
    return again.length > 0;
  }

  async releasePlanKey(userId: string, key: string): Promise<void> {
    await db.update(calendarSettings).set({
      planSentKeys: sql`(
        SELECT COALESCE(jsonb_agg(to_jsonb(elem)), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(${calendarSettings.planSentKeys}, '[]'::jsonb)) AS elem
        WHERE elem <> ${key}
      )`,
      updatedAt: new Date(),
    }).where(eq(calendarSettings.userId, userId));
  }

  async getLocationSettingsByUser(userId: string): Promise<LocationSettings | undefined> {
    const rows = await db.select().from(locationSettings).where(eq(locationSettings.userId, userId));
    return settingsRowForUser(rows, userId);
  }

  /** ⚠️ `userId` is REQUIRED — see updateCalendarSettings above for why. */
  async updateLocationSettings(settings: InsertLocationSettings & { userId: string }): Promise<LocationSettings> {
    // Atomic upsert — see updateCalendarSettings above for why.
    const [saved] = await db
      .insert(locationSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: locationSettings.userId,
        set: { ...settings, updatedAt: new Date() },
      })
      .returning();
    return saved;
  }

  // Google Calendar Tokens
  async getGoogleCalendarTokens(profileId: string): Promise<GoogleCalendarTokens | undefined> {
    const [tokens] = await db.select().from(googleCalendarTokens).where(
      and(
        eq(googleCalendarTokens.profileId, profileId),
        eq(googleCalendarTokens.isActive, true)
      )
    );
    return tokens || undefined;
  }

  async saveGoogleCalendarTokens(tokenData: InsertGoogleCalendarTokens): Promise<GoogleCalendarTokens> {
    // Delete any existing tokens for this profile to force fresh tokens
    await db
      .delete(googleCalendarTokens)
      .where(eq(googleCalendarTokens.profileId, tokenData.profileId));

    // Insert new tokens
    const [saved] = await db
      .insert(googleCalendarTokens)
      .values(tokenData)
      .returning();
    return saved;
  }

  async disconnectGoogleCalendar(profileId: string): Promise<boolean> {
    // Delete tokens completely instead of marking inactive
    const result = await db
      .delete(googleCalendarTokens)
      .where(eq(googleCalendarTokens.profileId, profileId));
    return (result.rowCount ?? 0) > 0;
  }

  async getGoogleAccountsByUser(userId: string): Promise<{ profileId: string; email: string }[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    if (!userProfiles.length) return [];
    const profileIds = userProfiles.map(p => p.id);
    const tokens = await db.select({
      profileId: googleCalendarTokens.profileId,
      email: googleCalendarTokens.email,
    }).from(googleCalendarTokens).where(
      and(
        inArray(googleCalendarTokens.profileId, profileIds),
        eq(googleCalendarTokens.isActive, true),
      )
    );
    return tokens
      .filter(t => t.email != null)
      .map(t => ({ profileId: t.profileId, email: t.email! }));
  }

  // Targeted UPDATE (not delete+reinsert like saveGoogleCalendarTokens) so
  // saving a calendar selection never disturbs the stored access/refresh
  // tokens or forces a reconnect.
  async setGoogleCalendarSelection(profileId: string, calendarIds: string[]): Promise<GoogleCalendarTokens | undefined> {
    const [updated] = await db
      .update(googleCalendarTokens)
      .set({ selectedCalendarIds: calendarIds, updatedAt: new Date() })
      .where(eq(googleCalendarTokens.profileId, profileId))
      .returning();
    return updated || undefined;
  }

  // null = reset to the account's primary calendar (see GOOGLE_PRIMARY_CALENDAR
  // in calendarSync.ts).
  async setGoogleCalendarWriteTarget(profileId: string, calendarId: string | null): Promise<GoogleCalendarTokens | undefined> {
    const [updated] = await db
      .update(googleCalendarTokens)
      .set({ writeCalendarId: calendarId, updatedAt: new Date() })
      .where(eq(googleCalendarTokens.profileId, profileId))
      .returning();
    return updated || undefined;
  }

  // iCal (.ics URL) subscriptions — read-only
  async getIcalSubscriptions(profileId: string): Promise<IcalSubscription[]> {
    return db.select().from(icalSubscriptions).where(
      and(eq(icalSubscriptions.profileId, profileId), eq(icalSubscriptions.isActive, true))
    );
  }

  async getIcalSubscriptionById(id: string): Promise<IcalSubscription | undefined> {
    const [sub] = await db.select().from(icalSubscriptions).where(eq(icalSubscriptions.id, id));
    return sub || undefined;
  }

  async getIcalSubscriptionsByUser(userId: string): Promise<IcalSubscription[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    if (!userProfiles.length) return [];
    const profileIds = userProfiles.map(p => p.id);
    return db.select().from(icalSubscriptions).where(
      and(inArray(icalSubscriptions.profileId, profileIds), eq(icalSubscriptions.isActive, true))
    );
  }

  async createIcalSubscription(sub: InsertIcalSubscription): Promise<IcalSubscription> {
    const [saved] = await db.insert(icalSubscriptions).values(sub).returning();
    return saved;
  }

  async deleteIcalSubscription(id: string): Promise<boolean> {
    const result = await db.delete(icalSubscriptions).where(eq(icalSubscriptions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async updateIcalSubscriptionStatus(id: string, status: { lastFetchedAt?: Date; lastError?: string | null }): Promise<void> {
    await db.update(icalSubscriptions)
      .set({ ...status, updatedAt: new Date() })
      .where(eq(icalSubscriptions.id, id));
  }

  // BratBusters Behaviour Board
  async getBehaviourBoardSettings(userId: string): Promise<BehaviourBoardSettings | undefined> {
    const [row] = await db.select().from(behaviourBoardSettings).where(eq(behaviourBoardSettings.userId, userId));
    return row || undefined;
  }

  async upsertBehaviourBoardSettings(userId: string, updates: Partial<InsertBehaviourBoardSettings>): Promise<BehaviourBoardSettings> {
    const existing = await this.getBehaviourBoardSettings(userId);
    if (existing) {
      const [updated] = await db.update(behaviourBoardSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(behaviourBoardSettings.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(behaviourBoardSettings)
      .values({ ...updates, userId })
      .returning();
    return created;
  }

  async getBehaviourRules(userId: string): Promise<BehaviourRule[]> {
    return db.select().from(behaviourRules)
      .where(and(eq(behaviourRules.userId, userId), eq(behaviourRules.isActive, true)))
      .orderBy(behaviourRules.displayOrder);
  }

  async getBehaviourRule(id: string, userId: string): Promise<BehaviourRule | undefined> {
    const [row] = await db.select().from(behaviourRules)
      .where(and(eq(behaviourRules.id, id), eq(behaviourRules.userId, userId)));
    return row || undefined;
  }

  async createBehaviourRule(rule: InsertBehaviourRule): Promise<BehaviourRule> {
    const [created] = await db.insert(behaviourRules).values(rule).returning();
    return created;
  }

  async updateBehaviourRule(id: string, updates: Partial<InsertBehaviourRule>, userId: string): Promise<BehaviourRule | undefined> {
    const [updated] = await db.update(behaviourRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(behaviourRules.id, id), eq(behaviourRules.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteBehaviourRule(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(behaviourRules)
      .where(and(eq(behaviourRules.id, id), eq(behaviourRules.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getBehaviourIncidents(userId: string, opts?: { status?: string; limit?: number }): Promise<BehaviourIncident[]> {
    const conds = [eq(behaviourIncidents.userId, userId)];
    if (opts?.status) conds.push(eq(behaviourIncidents.status, opts.status));
    let q = db.select().from(behaviourIncidents)
      .where(and(...conds))
      .orderBy(desc(behaviourIncidents.startedAt));
    if (opts?.limit) return q.limit(opts.limit);
    return q;
  }

  async getBehaviourIncident(id: string, userId: string): Promise<BehaviourIncident | undefined> {
    const [row] = await db.select().from(behaviourIncidents)
      .where(and(eq(behaviourIncidents.id, id), eq(behaviourIncidents.userId, userId)));
    return row || undefined;
  }

  async createBehaviourIncident(incident: InsertBehaviourIncident): Promise<BehaviourIncident> {
    const [created] = await db.insert(behaviourIncidents).values(incident).returning();
    // Starts a live countdown: the minute-by-minute tick has to resume now,
    // not on the next hourly boundary, or the "5 minutes left" warning
    // could be missed entirely.
    markSchedulerWorkDirty("behaviourTimers");
    return created;
  }

  async resolveBehaviourIncident(id: string, userId: string, status: "resolved_positive" | "negative_applied", note?: string | null): Promise<BehaviourIncident | undefined> {
    // Only a still-pending incident can transition — keeps follow-through honest
    // and the operation idempotent under double-taps.
    const [updated] = await db.update(behaviourIncidents)
      .set({ status, resolvedAt: new Date(), note: note ?? null })
      .where(and(
        eq(behaviourIncidents.id, id),
        eq(behaviourIncidents.userId, userId),
        eq(behaviourIncidents.status, "positive_pending"),
      ))
      .returning();
    return updated || undefined;
  }

  async deleteBehaviourIncident(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(behaviourIncidents)
      .where(and(eq(behaviourIncidents.id, id), eq(behaviourIncidents.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Outlook Calendar Tokens
  async getOutlookCalendarTokens(profileId: string): Promise<OutlookCalendarTokens | undefined> {
    const [tokens] = await db.select().from(outlookCalendarTokens).where(
      and(
        eq(outlookCalendarTokens.profileId, profileId),
        eq(outlookCalendarTokens.isActive, true)
      )
    );
    return tokens || undefined;
  }

  async saveOutlookCalendarTokens(tokenData: InsertOutlookCalendarTokens): Promise<OutlookCalendarTokens> {
    // First deactivate any existing tokens for this profile
    await db
      .update(outlookCalendarTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(outlookCalendarTokens.profileId, tokenData.profileId));

    // Insert new tokens
    const [saved] = await db
      .insert(outlookCalendarTokens)
      .values(tokenData)
      .returning();
    return saved;
  }

  async disconnectOutlookCalendar(profileId: string): Promise<boolean> {
    const result = await db
      .update(outlookCalendarTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(outlookCalendarTokens.profileId, profileId));
    return (result.rowCount ?? 0) > 0;
  }

  // Targeted UPDATE of the ACTIVE row only — saveOutlookCalendarTokens leaves
  // old deactivated rows behind rather than deleting them (see above), so
  // this must be scoped to isActive:true to match getOutlookCalendarTokens's
  // own lookup and avoid touching stale history rows.
  async setOutlookCalendarSelection(profileId: string, calendarIds: string[]): Promise<OutlookCalendarTokens | undefined> {
    const [updated] = await db
      .update(outlookCalendarTokens)
      .set({ selectedCalendarIds: calendarIds, updatedAt: new Date() })
      .where(and(eq(outlookCalendarTokens.profileId, profileId), eq(outlookCalendarTokens.isActive, true)))
      .returning();
    return updated || undefined;
  }

  // null = reset to the account's default calendar (see OUTLOOK_DEFAULT_CALENDAR
  // in calendarSync.ts).
  async setOutlookCalendarWriteTarget(profileId: string, calendarId: string | null): Promise<OutlookCalendarTokens | undefined> {
    const [updated] = await db
      .update(outlookCalendarTokens)
      .set({ writeCalendarId: calendarId, updatedAt: new Date() })
      .where(and(eq(outlookCalendarTokens.profileId, profileId), eq(outlookCalendarTokens.isActive, true)))
      .returning();
    return updated || undefined;
  }

  // Calendar Assignments
  //
  // ⚠️ `profileId` is REQUIRED. The no-argument form returned EVERY family's
  // active assignments — calendar names, real email addresses and profile ids
  // — and the one route that called it that way skipped its ownership check
  // whenever the query parameter was absent. Use
  // getCalendarAssignmentsByUser for the family-wide view.
  async getCalendarAssignments(profileId: string): Promise<CalendarAssignment[]> {
    return await db.select().from(calendarAssignments).where(
      and(
        eq(calendarAssignments.profileId, profileId),
        eq(calendarAssignments.isActive, true)
      )
    );
  }

  /**
   * Every active assignment belonging to one family.
   *
   * calendar_assignments has no userId column of its own — it hangs off
   * profileId — so the tenant key has to come from a join. Scoping by join
   * rather than denormalizing a userId column keeps one source of truth:
   * the profile is the only thing that knows which family it belongs to, and
   * a copied column is a second one that can drift.
   */
  async getCalendarAssignmentsByUser(userId: string): Promise<CalendarAssignment[]> {
    const rows = await db
      .select({ assignment: calendarAssignments })
      .from(calendarAssignments)
      .innerJoin(profiles, eq(profiles.id, calendarAssignments.profileId))
      .where(
        and(
          eq(profiles.userId, userId),
          eq(calendarAssignments.isActive, true)
        )
      );
    // Belt and braces, as with settingsRowForUser: the join already scopes
    // this, and re-checking in code means a future edit that loosens the
    // query cannot silently start handing one family another's rows.
    const profileFamily = new Map(rows.map((r) => [r.assignment.profileId, userId]));
    return assignmentsVisibleToFamily(rows.map((r) => r.assignment), profileFamily, userId);
  }

  async saveCalendarAssignment(assignment: InsertCalendarAssignment): Promise<CalendarAssignment> {
    // Deactivate existing active assignments for this calendar, regardless of
    // which profile currently owns it. A calendar can only belong to one
    // profile at a time, so reassigning must remove the previous owner's row.
    //
    // ⚠️ WITHIN THIS FAMILY ONLY. Calendar ids are not private to a
    // household: two families can legitimately connect the same shared
    // calendar — a school calendar, a public holidays feed, a co-parenting
    // arrangement. Without the family scope, one family assigning such a
    // calendar silently deactivated the other family's assignment, and their
    // events stopped being attributed to anyone.
    // Two plain queries rather than one nested subquery: this runs on a
    // reassignment, not in a loop, and being obviously correct matters more
    // here than saving a round trip.
    const [owningProfile] = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.id, assignment.profileId))
      .limit(1);

    const familyProfileIds = owningProfile?.userId
      ? await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.userId, owningProfile.userId))
      : [];

    // The rule itself lives in lib/calendarAssignmentScope.ts and is tested
    // there with two families — the case production cannot produce. Applying
    // it here, rather than re-expressing it as a WHERE clause, keeps the
    // tested rule and the real one the same rule.
    if (familyProfileIds.length > 0 && owningProfile?.userId) {
      const candidates = await db
        .select()
        .from(calendarAssignments)
        .where(
          and(
            eq(calendarAssignments.calendarId, assignment.calendarId),
            eq(calendarAssignments.calendarType, assignment.calendarType),
            eq(calendarAssignments.isActive, true),
          )
        );
      const profileFamily = new Map(familyProfileIds.map((p) => [p.id, owningProfile.userId!]));
      const stale = assignmentsToDeactivate(candidates, profileFamily, {
        profileId: assignment.profileId,
        calendarId: assignment.calendarId,
        calendarType: assignment.calendarType,
      });
      if (stale.length > 0) {
        await db
          .update(calendarAssignments)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(calendarAssignments.id, stale.map((a) => a.id)));
      }
    }

    // Now check if a row already exists for this exact (calendarId, calendarType, profileId)
    // (it may have just been deactivated above, or may be a brand new profile)
    const existingAssignments = await db.select().from(calendarAssignments).where(
      and(
        eq(calendarAssignments.calendarId, assignment.calendarId),
        eq(calendarAssignments.calendarType, assignment.calendarType),
        eq(calendarAssignments.profileId, assignment.profileId)
      )
    );

    if (existingAssignments.length > 0) {
      // Re-activate and update the existing row for this profile
      const [updated] = await db
        .update(calendarAssignments)
        .set({ ...assignment, isActive: true, updatedAt: new Date() })
        .where(
          and(
            eq(calendarAssignments.calendarId, assignment.calendarId),
            eq(calendarAssignments.calendarType, assignment.calendarType),
            eq(calendarAssignments.profileId, assignment.profileId)
          )
        )
        .returning();
      return updated;
    } else {
      // Insert a fresh row for this profile
      const [saved] = await db
        .insert(calendarAssignments)
        .values({ ...assignment, isActive: true })
        .returning();
      return saved;
    }
  }

  async deleteCalendarAssignment(calendarType: string, calendarId: string, profileId: string): Promise<boolean> {
    const result = await db
      .update(calendarAssignments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(calendarAssignments.calendarType, calendarType),
          eq(calendarAssignments.calendarId, calendarId),
          eq(calendarAssignments.profileId, profileId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async getCalendarAssignmentsForProfile(profileId: string): Promise<CalendarAssignment[]> {
    return this.getCalendarAssignments(profileId);
  }

  // Google Calendar Event Assignments
  async getGoogleEventAssignmentsByUser(userId: string): Promise<GoogleCalendarEventAssignment[]> {
    return await db.select().from(googleCalendarEventAssignments).where(
      eq(googleCalendarEventAssignments.userId, userId)
    );
  }

  async setGoogleEventAssignment(userId: string, calendarId: string, eventId: string, profileIds: string[], driverIds?: string[] | null, seriesFromDate?: Date | null): Promise<void> {
    // Dual-write: the new list plus the legacy single column, so anything still
    // reading drivingProfileId keeps working. See lib/eventDrivers.ts.
    const drivers = driverWriteFields(driverIds ?? []);
    await db.insert(googleCalendarEventAssignments)
      .values({ userId, calendarId, eventId, profileIds, ...drivers, seriesFromDate: seriesFromDate ?? null })
      .onConflictDoUpdate({
        // userId is part of the conflict target, and is NOT in the SET.
        // Previously the target was (calendarId, eventId) and the update
        // reassigned userId, so two families sharing a Google calendar — a
        // school or holidays feed — collided on one row and the second save
        // took the first family's assignment over.
        target: [
          googleCalendarEventAssignments.userId,
          googleCalendarEventAssignments.calendarId,
          googleCalendarEventAssignments.eventId,
        ],
        set: { profileIds, ...drivers, seriesFromDate: seriesFromDate ?? null, updatedAt: new Date() },
      });
  }

  // When a SERIES assignment is saved ("this and following"), any pre-existing
  // single-occurrence (instance) rows for that same series would otherwise
  // permanently shadow it — the GET handler always prefers an instance row over
  // a series row for the same occurrence, and there was previously no way to
  // clear one. So a user removing an assignee via "this and all following"
  // would appear to save successfully yet see no change. Clearing the instance
  // rows the series now supersedes (its own occurrences at/after seriesFromDate)
  // lets the new series value actually take effect. Google expands a recurring
  // instance's id as `${recurringEventId}_${basicUtcTimestamp}`, so instance
  // rows for a series are exactly those whose eventId starts with that prefix.
  async clearGoogleEventInstanceOverridesForSeries(userId: string, calendarId: string, recurringEventId: string, fromDate: Date): Promise<void> {
    const rows = await db.select().from(googleCalendarEventAssignments).where(and(
      eq(googleCalendarEventAssignments.userId, userId),
      eq(googleCalendarEventAssignments.calendarId, calendarId),
      isNull(googleCalendarEventAssignments.seriesFromDate),
    ));
    const prefix = `${recurringEventId}_`;
    // 12h back-tolerance: an all-day occurrence's instance id encodes a UTC
    // midnight, while the client's occurrenceStart can be a local midnight up to
    // ~11h off — this ensures the viewed occurrence is still recognized as
    // at/after the cutoff, while staying well inside the ≥24h gap between
    // occurrences so an earlier one is never swept in.
    const cutoff = fromDate.getTime() - 12 * 60 * 60 * 1000;
    const toDelete = rows
      .filter(r => r.eventId.startsWith(prefix))
      .filter(r => {
        const occ = parseGoogleInstanceStart(r.eventId.slice(prefix.length));
        // If the suffix can't be parsed, leave the row alone rather than risk
        // deleting an intentional override we can't place in time.
        return occ !== null && occ.getTime() >= cutoff;
      })
      .map(r => r.id);
    if (toDelete.length) {
      await db.delete(googleCalendarEventAssignments).where(
        inArray(googleCalendarEventAssignments.id, toDelete)
      );
    }
  }

  // ── Event ↔ external calendar sync links (two-way sync) ──
  // Reads are resilient to the table not existing yet (pre-migration rollout)
  // so core event CRUD and calendar display never break.
  async getEventCalendarSyncs(eventId: string): Promise<EventCalendarSync[]> {
    try {
      return await db.select().from(eventCalendarSyncs).where(eq(eventCalendarSyncs.eventId, eventId));
    } catch (e) {
      console.warn("getEventCalendarSyncs failed (table missing?):", e instanceof Error ? e.message : e);
      return [];
    }
  }

  async getExternalEventIdsByUser(userId: string, provider: string): Promise<Set<string>> {
    try {
      const rows = await db.select({ externalEventId: eventCalendarSyncs.externalEventId })
        .from(eventCalendarSyncs)
        .where(and(eq(eventCalendarSyncs.userId, userId), eq(eventCalendarSyncs.provider, provider)));
      return new Set(rows.map(r => r.externalEventId));
    } catch (e) {
      console.warn("getExternalEventIdsByUser failed (table missing?):", e instanceof Error ? e.message : e);
      return new Set();
    }
  }

  async upsertEventCalendarSync(row: InsertEventCalendarSync): Promise<EventCalendarSync> {
    const [saved] = await db.insert(eventCalendarSyncs)
      .values(row)
      .onConflictDoUpdate({
        target: [eventCalendarSyncs.eventId, eventCalendarSyncs.profileId, eventCalendarSyncs.provider],
        set: {
          externalEventId: row.externalEventId,
          externalCalendarId: row.externalCalendarId,
          syncState: row.syncState ?? "synced",
          lastError: row.lastError ?? null,
          dismissedAt: null, // a fresh sync attempt (success or new failure) un-dismisses
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved;
  }

  // Surfaces persisted sync failures — previously written to this table on
  // every write-path failure (both per-event two-way-sync errors and the
  // Outlook refresh failure recorded via recordError in calendarSync.ts) but
  // never read anywhere, so two-way sync could stop permanently (e.g. a
  // revoked OAuth consent) with no user-visible signal at all.
  //
  // Grouped by (eventId, provider) so a family event fanned out to several
  // profiles (one eventCalendarSyncs row per assigned profile) surfaces as
  // ONE entry naming every affected person, instead of one visually-identical
  // duplicate per profile. Also carries the event's own start time (so the
  // user can find it) and whether it still exists on the calendar (it always
  // does here, since a cascade-delete removes this row with the event —
  // exposed explicitly anyway so the frontend never has to assume).
  async getRecentSyncErrors(userId: string, limit: number): Promise<{
    id: string; eventId: string; eventTitle: string; eventStartTime: Date;
    provider: string; lastError: string | null; updatedAt: Date; profileNames: string[];
  }[]> {
    try {
      const rows = await db.select({
        id: eventCalendarSyncs.id,
        eventId: eventCalendarSyncs.eventId,
        eventTitle: events.title,
        eventStartTime: events.startTime,
        provider: eventCalendarSyncs.provider,
        lastError: eventCalendarSyncs.lastError,
        updatedAt: eventCalendarSyncs.updatedAt,
        profileName: profiles.name,
      })
        .from(eventCalendarSyncs)
        .innerJoin(events, eq(events.id, eventCalendarSyncs.eventId))
        .leftJoin(profiles, eq(profiles.id, eventCalendarSyncs.profileId))
        .where(and(
          eq(eventCalendarSyncs.userId, userId),
          eq(eventCalendarSyncs.syncState, "error"),
          isNull(eventCalendarSyncs.dismissedAt),
        ))
        .orderBy(desc(eventCalendarSyncs.updatedAt));

      const grouped = new Map<string, {
        id: string; eventId: string; eventTitle: string; eventStartTime: Date;
        provider: string; lastError: string | null; updatedAt: Date; profileNames: string[];
      }>();
      for (const r of rows) {
        const key = `${r.eventId}:${r.provider}`;
        const existing = grouped.get(key);
        if (existing) {
          if (r.profileName && !existing.profileNames.includes(r.profileName)) {
            existing.profileNames.push(r.profileName);
          }
        } else {
          grouped.set(key, {
            id: r.id,
            eventId: r.eventId,
            eventTitle: r.eventTitle,
            eventStartTime: r.eventStartTime,
            provider: r.provider,
            lastError: r.lastError,
            updatedAt: r.updatedAt,
            profileNames: r.profileName ? [r.profileName] : [],
          });
        }
      }
      return Array.from(grouped.values())
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit);
    } catch (e) {
      console.warn("getRecentSyncErrors failed (table missing?):", e instanceof Error ? e.message : e);
      return [];
    }
  }

  // Dismisses every errored sync row for one (event, provider) pairing — every
  // affected profile's row, matching how getRecentSyncErrors groups them into
  // one entry. A future successful sync (e.g. after reconnecting) still
  // clears syncState back to "synced" on its own; this only silences an error
  // the user has acknowledged and doesn't want to see again.
  async dismissSyncError(userId: string, eventId: string, provider: string): Promise<void> {
    await db.update(eventCalendarSyncs)
      .set({ dismissedAt: new Date() })
      .where(and(
        eq(eventCalendarSyncs.userId, userId),
        eq(eventCalendarSyncs.eventId, eventId),
        eq(eventCalendarSyncs.provider, provider),
        eq(eventCalendarSyncs.syncState, "error"),
      ));
  }

  async getErroredSyncEvents(profileId: string, provider: string): Promise<Event[]> {
    try {
      const rows = await db.select({ event: events })
        .from(eventCalendarSyncs)
        .innerJoin(events, eq(events.id, eventCalendarSyncs.eventId))
        .where(and(
          eq(eventCalendarSyncs.profileId, profileId),
          eq(eventCalendarSyncs.provider, provider),
          eq(eventCalendarSyncs.syncState, "error"),
        ));
      return rows.map((r) => r.event);
    } catch (e) {
      console.warn("getErroredSyncEvents failed (table missing?):", e instanceof Error ? e.message : e);
      return [];
    }
  }

  async deleteEventCalendarSync(eventId: string, profileId: string, provider: string): Promise<void> {
    await db.delete(eventCalendarSyncs).where(and(
      eq(eventCalendarSyncs.eventId, eventId),
      eq(eventCalendarSyncs.profileId, profileId),
      eq(eventCalendarSyncs.provider, provider),
    ));
  }

  async deleteEventCalendarSyncsForEvent(eventId: string): Promise<void> {
    await db.delete(eventCalendarSyncs).where(eq(eventCalendarSyncs.eventId, eventId));
  }

  // Daily Content
  async getDailyContent(): Promise<DailyContent[]> {
    return await db.select().from(dailyContent).where(eq(dailyContent.isActive, true));
  }

  async getDailyContentByUser(userId: string): Promise<DailyContent[]> {
    return await db.select().from(dailyContent).where(
      and(eq(dailyContent.userId, userId), eq(dailyContent.isActive, true))
    );
  }

  async getDailyContentById(id: string): Promise<DailyContent | undefined> {
    const [content] = await db.select().from(dailyContent).where(eq(dailyContent.id, id));
    return content || undefined;
  }

  async createDailyContent(insertContent: InsertDailyContent): Promise<DailyContent> {
    const [content] = await db
      .insert(dailyContent)
      .values(insertContent)
      .returning();
    return content;
  }

  async updateDailyContent(id: string, updateData: Partial<InsertDailyContent>, userId: string): Promise<DailyContent | undefined> {
    const [content] = await db
      .update(dailyContent)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(dailyContent.id, id), eq(dailyContent.userId, userId)))
      .returning();
    return content || undefined;
  }

  async deleteDailyContent(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(dailyContent).where(and(eq(dailyContent.id, id), eq(dailyContent.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Daily Content Assignments
  async getAllDailyContentAssignments(): Promise<DailyContentAssignment[]> {
    return await db.select().from(dailyContentAssignments);
  }

  async getAllDailyContentAssignmentsByUser(userId: string): Promise<DailyContentAssignment[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    return await db.select().from(dailyContentAssignments).where(inArray(dailyContentAssignments.profileId, profileIds));
  }

  async getDailyContentAssignments(contentId: string): Promise<DailyContentAssignment[]> {
    return await db.select().from(dailyContentAssignments).where(eq(dailyContentAssignments.contentId, contentId));
  }

  async getDailyContentAssignmentsByContentAndUser(contentId: string, userId: string): Promise<DailyContentAssignment[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    return await db.select().from(dailyContentAssignments).where(
      and(
        eq(dailyContentAssignments.contentId, contentId),
        inArray(dailyContentAssignments.profileId, profileIds)
      )
    );
  }

  async createDailyContentAssignment(assignment: InsertDailyContentAssignment): Promise<DailyContentAssignment> {
    const [created] = await db
      .insert(dailyContentAssignments)
      .values(assignment)
      .returning();
    return created;
  }

  async deleteDailyContentAssignments(contentId: string): Promise<boolean> {
    const result = await db.delete(dailyContentAssignments).where(eq(dailyContentAssignments.contentId, contentId));
    return (result.rowCount ?? 0) > 0;
  }

  // Daily Content Completions
  async getDailyContentCompletions(profileId?: string, date?: Date): Promise<DailyContentCompletion[]> {
    let query = db.select().from(dailyContentCompletions);
    
    if (profileId) {
      query = query.where(eq(dailyContentCompletions.profileId, profileId));
    }
    
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      query = query.where(
        and(
          gte(dailyContentCompletions.completedAt, startOfDay),
          lte(dailyContentCompletions.completedAt, endOfDay)
        )
      );
    }
    
    return await query;
  }

  async getDailyContentCompletionsByUser(userId: string, date?: Date): Promise<DailyContentCompletion[]> {
    const userProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
    const profileIds = userProfiles.map(p => p.id);
    if (profileIds.length === 0) return [];
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      return await db.select().from(dailyContentCompletions).where(
        and(
          inArray(dailyContentCompletions.profileId, profileIds),
          gte(dailyContentCompletions.completedAt, startOfDay),
          lte(dailyContentCompletions.completedAt, endOfDay)
        )
      );
    }
    return await db.select().from(dailyContentCompletions).where(
      inArray(dailyContentCompletions.profileId, profileIds)
    );
  }

  async createDailyContentCompletion(completion: InsertDailyContentCompletion): Promise<DailyContentCompletion> {
    const [created] = await db
      .insert(dailyContentCompletions)
      .values(completion)
      .returning();
    return created;
  }

  async deleteDailyContentCompletion(contentId: string, profileId: string): Promise<boolean> {
    const result = await db.delete(dailyContentCompletions).where(
      and(
        eq(dailyContentCompletions.contentId, contentId),
        eq(dailyContentCompletions.profileId, profileId)
      )
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Rewards
  async getRewards(): Promise<Reward[]> {
    return await db.select().from(rewards).where(eq(rewards.isActive, true));
  }

  async getRewardsByUser(userId: string): Promise<Reward[]> {
    return await db.select().from(rewards).where(
      and(eq(rewards.userId, userId), eq(rewards.isActive, true))
    );
  }

  async getRewardById(id: string): Promise<Reward | undefined> {
    const [reward] = await db.select().from(rewards).where(eq(rewards.id, id));
    return reward || undefined;
  }

  async createReward(insertReward: InsertReward): Promise<Reward> {
    const [reward] = await db
      .insert(rewards)
      .values(insertReward)
      .returning();
    return reward;
  }

  async updateReward(id: string, updateData: Partial<InsertReward>, userId: string): Promise<Reward | undefined> {
    const [reward] = await db
      .update(rewards)
      .set(updateData)
      .where(and(eq(rewards.id, id), eq(rewards.userId, userId)))
      .returning();
    return reward || undefined;
  }

  async deleteReward(id: string, userId: string): Promise<boolean> {
    const result = await db
      .update(rewards)
      .set({ isActive: false })
      .where(and(eq(rewards.id, id), eq(rewards.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Reward Redemptions
  async getRewardRedemptions(profileId?: string): Promise<RewardRedemption[]> {
    if (profileId) {
      return await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.profileId, profileId));
    }
    return await db.select().from(rewardRedemptions);
  }

  async getRewardRedemptionsByUser(userId: string, profileId?: string): Promise<RewardRedemption[]> {
    const allRedemptions = await db.select({
      redemption: rewardRedemptions,
      reward: rewards
    }).from(rewardRedemptions)
      .innerJoin(rewards, eq(rewardRedemptions.rewardId, rewards.id))
      .where(eq(rewards.userId, userId));
    
    const redemptions = allRedemptions.map(r => r.redemption);
    
    if (profileId) {
      return redemptions.filter(r => r.profileId === profileId);
    }
    return redemptions;
  }

  async createRewardRedemption(redemption: InsertRewardRedemption): Promise<RewardRedemption> {
    const [created] = await db
      .insert(rewardRedemptions)
      .values(redemption)
      .returning();
    return created;
  }

  async updateRewardRedemption(id: string, updateData: Partial<InsertRewardRedemption>, userId: string): Promise<RewardRedemption | undefined> {
    const redemptionWithReward = await db.select({
      redemption: rewardRedemptions,
      reward: rewards
    }).from(rewardRedemptions)
      .innerJoin(rewards, eq(rewardRedemptions.rewardId, rewards.id))
      .where(and(eq(rewardRedemptions.id, id), eq(rewards.userId, userId)));
    
    if (redemptionWithReward.length === 0) {
      return undefined;
    }

    const [updated] = await db
      .update(rewardRedemptions)
      .set(updateData)
      .where(eq(rewardRedemptions.id, id))
      .returning();
    return updated || undefined;
  }

  // Gamification Helpers
  // `dbClient` defaults to the shared pool — pass the transaction's own client
  // (see DbOrTx above) when calling this from inside a db.transaction(...) that
  // also holds a row lock, so this doesn't reach back into the pool for a
  // second connection while the first is held open.
  async getProfilePoints(profileId: string, dbClient: DbOrTx = db): Promise<number> {
    const completions = await dbClient.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId));
    const earned = completions.reduce((sum, c) => sum + (c.points || 0), 0);
    const adjustments = await dbClient.select().from(pointAdjustments).where(eq(pointAdjustments.profileId, profileId));
    const adjusted = adjustments.reduce((sum, a) => sum + (a.delta || 0), 0);
    // Daily "finished all my chores" bonuses (per_completion mode). Each row
    // carries its own snapshotted points and feeds the balance exactly like a
    // chore completion, so bonus points spend/cash-out identically. In
    // per_chore mode there are simply no bonus rows, so this adds 0.
    const bonuses = await dbClient.select().from(completionBonuses).where(eq(completionBonuses.profileId, profileId));
    const bonusPoints = bonuses.reduce((sum, b) => sum + (b.points || 0), 0);
    // Points SPENT on redeemed rewards — ledger-derived, exactly like the
    // credits above. Without this a reward could be redeemed over and over on
    // the same points AND those points still cashed out as money; now a
    // redemption debits the shared balance the moment its status is
    // "redeemed" (and a not-yet-redeemed/cancelled redemption simply isn't
    // counted, so no separate refund step is needed). Joined to the live
    // reward for its cost — the RESTRICT FK on reward_redemptions.reward_id
    // guarantees the reward row still exists for every redemption.
    const redeemed = await dbClient
      .select({ cost: rewards.pointsCost })
      .from(rewardRedemptions)
      .innerJoin(rewards, eq(rewardRedemptions.rewardId, rewards.id))
      .where(and(
        eq(rewardRedemptions.profileId, profileId),
        eq(rewardRedemptions.status, "redeemed"),
      ));
    const spent = redeemed.reduce((sum, r) => sum + (r.cost || 0), 0);
    // Stars reserved by cash-out requests (pending) or already approved are
    // subtracted here too, so the star count shown everywhere matches the
    // "available to spend/cash out" figure — requesting a cash-out removes
    // those stars from the visible balance immediately, and a decline
    // automatically returns them (the row stops matching the reserved filter).
    // Without this, the pill showed 200 while cash-out availability showed 184.
    const reservedCashout = await this.getReservedCashoutPoints(profileId, dbClient);
    return earned + adjusted + bonusPoints - spent - reservedCashout;
  }

  // Read-only star history for the Insights card. Mirrors getProfilePoints
  // component-for-component (completions + bonuses + positive adjustments as
  // credits; redeemed-reward cost + negative adjustments as debits; cash-outs
  // deliberately excluded, exactly as getProfilePoints does, so `balance`
  // equals the star pill everywhere). Returns chronological signed events plus
  // the same balance figure so nothing has to be re-derived on the client.
  async getStarLedger(profileId: string): Promise<StarLedger> {
    const events: StarLedgerEvent[] = [];

    const completions = await db.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId));
    for (const c of completions) {
      if ((c.points || 0) === 0) continue; // 0-point checklist chores add no visible movement
      events.push({ at: (c.completedAt ?? new Date()).toISOString(), delta: c.points || 0, kind: "completion" });
    }

    const bonuses = await db.select().from(completionBonuses).where(eq(completionBonuses.profileId, profileId));
    for (const b of bonuses) {
      events.push({ at: (b.localDayStart ?? b.createdAt ?? new Date()).toISOString(), delta: b.points || 0, kind: "bonus" });
    }

    const adjustments = await db.select().from(pointAdjustments).where(eq(pointAdjustments.profileId, profileId));
    for (const a of adjustments) {
      if ((a.delta || 0) === 0) continue;
      events.push({ at: (a.createdAt ?? new Date()).toISOString(), delta: a.delta || 0, kind: "adjustment" });
    }

    const redeemedRows = await db
      .select({ cost: rewards.pointsCost, at: rewardRedemptions.redeemedAt, created: rewardRedemptions.createdAt })
      .from(rewardRedemptions)
      .innerJoin(rewards, eq(rewardRedemptions.rewardId, rewards.id))
      .where(and(eq(rewardRedemptions.profileId, profileId), eq(rewardRedemptions.status, "redeemed")));
    for (const r of redeemedRows) {
      events.push({ at: (r.at ?? r.created ?? new Date()).toISOString(), delta: -(r.cost || 0), kind: "redemption" });
    }

    // Cash-out reservations (approved, or still-pending awaiting approval)
    // debit the balance the moment they're made — same rows
    // getReservedCashoutPoints sums, added here as real timeline events so
    // the chart's own cumulative walk actually dips when a cash-out happens,
    // instead of only being reflected in the aggregate `balance` number
    // below with nothing on the line to explain it.
    const cashoutRows = await db.select().from(walletTransactions).where(and(
      eq(walletTransactions.profileId, profileId),
      or(
        eq(walletTransactions.type, "cashout_approved"),
        and(
          eq(walletTransactions.type, "cashout_requested"),
          eq(walletTransactions.status, "pending"),
        ),
      ),
    ));
    for (const tx of cashoutRows) {
      if ((tx.requestedPoints || 0) === 0) continue;
      events.push({ at: (tx.createdAt ?? new Date()).toISOString(), delta: -(tx.requestedPoints || 0), kind: "cashout" });
    }

    events.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
    let totalEarned = 0, totalSpent = 0;
    for (const e of events) {
      if (e.delta > 0) totalEarned += e.delta;
      else totalSpent += -e.delta;
    }
    return {
      balance: totalEarned - totalSpent,
      totalEarned,
      totalSpent,
      events,
    };
  }

  // ── Completion bonuses (per_completion points mode) ──
  async getCompletionBonus(profileId: string, localDayStart: Date): Promise<CompletionBonus | undefined> {
    const [row] = await db
      .select()
      .from(completionBonuses)
      .where(and(eq(completionBonuses.profileId, profileId), eq(completionBonuses.localDayStart, localDayStart)));
    return row || undefined;
  }
  async createCompletionBonus(input: InsertCompletionBonus): Promise<CompletionBonus> {
    const [row] = await db.insert(completionBonuses).values(input).returning();
    return row;
  }
  async deleteCompletionBonus(profileId: string, localDayStart: Date): Promise<void> {
    await db
      .delete(completionBonuses)
      .where(and(eq(completionBonuses.profileId, profileId), eq(completionBonuses.localDayStart, localDayStart)));
  }
  async listPointAdjustments(profileId: string, limit = 20): Promise<PointAdjustment[]> {
    return db.select().from(pointAdjustments).where(eq(pointAdjustments.profileId, profileId)).orderBy(desc(pointAdjustments.createdAt)).limit(limit);
  }
  async createPointAdjustment(input: { userId: string; profileId: string; delta: number; reason: string | null }): Promise<PointAdjustment> {
    const [row] = await db.insert(pointAdjustments).values({
      userId: input.userId,
      profileId: input.profileId,
      delta: input.delta,
      reason: input.reason,
    }).returning();
    return row;
  }

  async getProfileStreak(profileId: string): Promise<number> {
    const details = await this.getProfileStreakDetails(profileId);
    return details.streak;
  }

  async getProfileStreakDetails(profileId: string): Promise<{
    streak: number;
    weekKey: string;
    hasFreezeThisWeek: boolean;
    frozenDates: string[];
    canUseFreezeForYesterday: boolean;
  }> {
    const profile = await this.getProfile(profileId);
    const tz = profile?.userId
      ? (await this.getLocationSettingsByUser(profile.userId))?.timezone || "America/Chicago"
      : "America/Chicago";

    const [completions, freezes] = await Promise.all([
      db.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId)),
      db.select().from(streakFreezes).where(eq(streakFreezes.profileId, profileId)),
    ]);

    const completionKeys = new Set<string>();
    for (const c of completions) {
      if (c.completedAt) completionKeys.add(dateKeyTz(new Date(c.completedAt), tz));
    }
    const freezeKeys = new Set(freezes.map((f) => f.usedForDate));
    const now = new Date();
    const todayK = todayKeyTz(tz, now);
    const yesterdayK = yesterdayKeyTz(tz, now);
    // The "this week" we care about for freeze eligibility is the ISO week
    // containing yesterday — that's the day we'd be bridging. On Mondays,
    // yesterday belongs to the prior week, and we must not block a freeze
    // because the user happened to use one earlier in *this* (current) week.
    const yesterdayWeekKey = isoWeekKeyFromDateKey(yesterdayK);
    const hasFreezeThisWeek = !freezes.some((f) => f.weekKey === yesterdayWeekKey);

    const skipDays: number[] = profile?.streakSkipDays ?? [];
    const { streak, frozenDatesUsed } = computeStreak(completionKeys, freezeKeys, tz, skipDays, now);

    // Freeze for yesterday is only meaningful when it would actually preserve
    // a real streak — i.e. day-before-yesterday has a completion (whether the
    // user has completed today or not, the bridge connects history forward).
    // Skip days don't need a freeze — if yesterday is a skip day, no freeze needed.
    const isSkipDay = (k: string) => {
      const [y, m, d] = k.split("-").map(Number);
      const wd = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
      return skipDays.includes(wd);
    };
    const dayBeforeYesterdayKey = previousDayKey(yesterdayK);
    const canUseFreezeForYesterday =
      hasFreezeThisWeek &&
      !isSkipDay(yesterdayK) &&
      !completionKeys.has(yesterdayK) &&
      completionKeys.has(dayBeforeYesterdayKey);

    return {
      streak,
      weekKey: yesterdayWeekKey,
      hasFreezeThisWeek,
      frozenDates: frozenDatesUsed,
      canUseFreezeForYesterday,
    };
  }

  async getStreakFreezesForProfile(profileId: string, limit = 12): Promise<StreakFreeze[]> {
    return db.select().from(streakFreezes)
      .where(eq(streakFreezes.profileId, profileId))
      .orderBy(desc(streakFreezes.createdAt))
      .limit(limit);
  }

  async getStreakFreezeForWeek(profileId: string, weekKeyStr: string): Promise<StreakFreeze | undefined> {
    const [row] = await db.select().from(streakFreezes)
      .where(and(eq(streakFreezes.profileId, profileId), eq(streakFreezes.weekKey, weekKeyStr)))
      .limit(1);
    return row;
  }

  async createStreakFreeze(input: {
    profileId: string;
    userId: string;
    weekKey: string;
    usedForDate: string;
  }): Promise<{ created: boolean; freeze: StreakFreeze }> {
    const [inserted] = await db.insert(streakFreezes).values(input)
      .onConflictDoNothing({ target: [streakFreezes.profileId, streakFreezes.weekKey] })
      .returning();
    if (inserted) return { created: true, freeze: inserted };
    const existing = await this.getStreakFreezeForWeek(input.profileId, input.weekKey);
    return { created: false, freeze: existing! };
  }

  async createShoutout(input: {
    userId: string;
    fromProfileId: string;
    toProfileId: string;
    emoji: string;
    message: string;
  }): Promise<Shoutout> {
    // seenAt starts null — it's what drives BOTH the unseen-count badge AND
    // whether markShoutoutSeen has anything left to do. Stamping it here
    // (an earlier, incorrect attempt at "the sender already saw it") marked
    // the shoutout seen for literally everyone the instant it was created,
    // since this is one column on the row, not a per-viewer flag — which
    // also meant listShoutoutsForUser's isNull(seenAt) filter below excluded
    // it from every feed read from the very first request. The client
    // already marks a shoutout seen itself, once it's actually been shown
    // to a viewer (recent-shoutouts-card.tsx's auto-mark-after-render,
    // announcements-banner.tsx's explicit dismiss) — nothing here needs to.
    const [row] = await db.insert(shoutouts).values(input).returning();
    return row;
  }

  async listShoutoutsForUser(userId: string, limit = 50): Promise<Shoutout[]> {
    // Recent-praise FEED — every shoutout for this family, seen or not.
    // isNull(seenAt) belongs only on getUnseenShoutoutCount below (the badge
    // count); reusing it here made a shoutout vanish from the feed as soon
    // as it was marked seen, instead of just clearing its badge/highlight.
    return db.select().from(shoutouts)
      .where(eq(shoutouts.userId, userId))
      .orderBy(desc(shoutouts.createdAt))
      .limit(limit);
  }

  async getShoutout(id: string): Promise<Shoutout | undefined> {
    const [row] = await db.select().from(shoutouts).where(eq(shoutouts.id, id)).limit(1);
    return row;
  }

  async markShoutoutSeen(id: string, userId: string): Promise<Shoutout | undefined> {
    const [row] = await db.update(shoutouts)
      .set({ seenAt: new Date() })
      .where(and(eq(shoutouts.id, id), eq(shoutouts.userId, userId)))
      .returning();
    return row;
  }

  async getUnseenShoutoutCount(userId: string): Promise<number> {
    const rows = await db.select({ id: shoutouts.id }).from(shoutouts)
      .where(and(eq(shoutouts.userId, userId), isNull(shoutouts.seenAt)));
    return rows.length;
  }


  async listComments(userId: string, entityType: string, entityId: string): Promise<Comment[]> {
    return db.select().from(comments)
      .where(and(
        eq(comments.userId, userId),
        eq(comments.entityType, entityType),
        eq(comments.entityId, entityId),
      ))
      .orderBy(comments.createdAt);
  }

  async createComment(input: { userId: string; entityType: string; entityId: string; authorProfileId: string | null; message: string }): Promise<Comment> {
    const [row] = await db.insert(comments).values(input).returning();
    return row;
  }

  async getComment(id: string): Promise<Comment | undefined> {
    const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    return row;
  }

  async deleteComment(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(comments)
      .where(and(eq(comments.id, id), eq(comments.userId, userId)))
      .returning({ id: comments.id });
    return rows.length > 0;
  }

  async listShareTokens(userId: string): Promise<FamilyShareToken[]> {
    return db.select().from(familyShareTokens)
      .where(eq(familyShareTokens.userId, userId))
      .orderBy(desc(familyShareTokens.createdAt));
  }
  async createShareToken(input: { userId: string; token: string; label: string | null; expiresAt: Date | null }): Promise<FamilyShareToken> {
    const [row] = await db.insert(familyShareTokens).values(input).returning();
    return row;
  }
  async revokeShareToken(id: string, userId: string): Promise<boolean> {
    const rows = await db.update(familyShareTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(familyShareTokens.id, id), eq(familyShareTokens.userId, userId)))
      .returning({ id: familyShareTokens.id });
    return rows.length > 0;
  }
  async getShareTokenByToken(token: string): Promise<FamilyShareToken | undefined> {
    const [row] = await db.select().from(familyShareTokens).where(eq(familyShareTokens.token, token)).limit(1);
    return row;
  }
  async touchShareToken(id: string): Promise<void> {
    await db.update(familyShareTokens).set({ lastViewedAt: new Date() }).where(eq(familyShareTokens.id, id));
  }

  async getAllowanceSettings(profileId: string): Promise<AllowanceSettings | undefined> {
    const [row] = await db.select().from(allowanceSettings).where(eq(allowanceSettings.profileId, profileId)).limit(1);
    return row;
  }
  async upsertAllowanceSettings(input: { userId: string; profileId: string; centsPerPoint: number; currency?: string }): Promise<AllowanceSettings> {
    const existing = await this.getAllowanceSettings(input.profileId);
    if (existing) {
      const [row] = await db.update(allowanceSettings)
        .set({ centsPerPoint: input.centsPerPoint, currency: input.currency ?? existing.currency, updatedAt: new Date() })
        .where(eq(allowanceSettings.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(allowanceSettings).values({
      userId: input.userId,
      profileId: input.profileId,
      centsPerPoint: input.centsPerPoint,
      currency: input.currency ?? "USD",
    }).returning();
    return row;
  }
  async listAllowancePayouts(profileId: string, limit = 50): Promise<AllowancePayout[]> {
    return db.select().from(allowancePayouts)
      .where(eq(allowancePayouts.profileId, profileId))
      .orderBy(desc(allowancePayouts.createdAt))
      .limit(limit);
  }
  async createAllowancePayout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }): Promise<AllowancePayout> {
    const [row] = await db.insert(allowancePayouts).values(input).returning();
    return row;
  }
  async getTotalAllowancePaidPoints(profileId: string): Promise<number> {
    const rows = await db.select({ points: allowancePayouts.points }).from(allowancePayouts)
      .where(eq(allowancePayouts.profileId, profileId));
    return rows.reduce((sum, r) => sum + (r.points || 0), 0);
  }

  // ── Reward Settings ────────────────────────────────────────────────────
  async getRewardSettings(userId: string): Promise<RewardSettings | undefined> {
    const [row] = await db.select().from(rewardSettings).where(eq(rewardSettings.userId, userId)).limit(1);
    return row;
  }
  async upsertRewardSettings(input: { userId: string; redemptionMode?: string; centsPerPoint?: number; currencySymbol?: string; minCashoutPoints?: number; pointsMode?: string; completionBonusPoints?: number; parentPin?: string | null; pinGatedFeatures?: string[] | null; pinResetCodeHash?: string | null; pinResetCodeExpiresAt?: Date | null }): Promise<RewardSettings> {
    const existing = await this.getRewardSettings(input.userId);
    if (existing) {
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (input.redemptionMode !== undefined) patch.redemptionMode = input.redemptionMode;
      if (input.centsPerPoint !== undefined) patch.centsPerPoint = input.centsPerPoint;
      if (input.currencySymbol !== undefined) patch.currencySymbol = input.currencySymbol;
      if (input.minCashoutPoints !== undefined) patch.minCashoutPoints = input.minCashoutPoints;
      if (input.pointsMode !== undefined) patch.pointsMode = input.pointsMode;
      if (input.completionBonusPoints !== undefined) patch.completionBonusPoints = input.completionBonusPoints;
      if (input.parentPin !== undefined) patch.parentPin = input.parentPin;
      if (input.pinGatedFeatures !== undefined) patch.pinGatedFeatures = input.pinGatedFeatures;
      if (input.pinResetCodeHash !== undefined) patch.pinResetCodeHash = input.pinResetCodeHash;
      if (input.pinResetCodeExpiresAt !== undefined) patch.pinResetCodeExpiresAt = input.pinResetCodeExpiresAt;
      const [row] = await db.update(rewardSettings).set(patch).where(eq(rewardSettings.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(rewardSettings).values({
      userId: input.userId,
      redemptionMode: input.redemptionMode ?? "both",
      centsPerPoint: input.centsPerPoint ?? 0,
      currencySymbol: input.currencySymbol ?? "$",
      minCashoutPoints: input.minCashoutPoints ?? 0,
      pointsMode: input.pointsMode ?? "per_chore",
      completionBonusPoints: input.completionBonusPoints ?? 10,
      parentPin: input.parentPin ?? null,
      pinGatedFeatures: input.pinGatedFeatures ?? null,
      pinResetCodeHash: input.pinResetCodeHash ?? null,
      pinResetCodeExpiresAt: input.pinResetCodeExpiresAt ?? null,
    }).returning();
    return row;
  }

  // ── Onboarding walkthrough progress ─────────────────────────────────────
  async getOnboardingStatus(userId: string): Promise<OnboardingStatus | undefined> {
    const [row] = await db.select().from(onboardingStatus).where(eq(onboardingStatus.userId, userId)).limit(1);
    return row;
  }
  async setOnboardingStep(
    userId: string,
    step: "profile" | "location" | "rewards" | "invite" | "calendar",
    patch: { status?: "done" | "skipped" | null; dismissedUntil?: Date | null },
  ): Promise<OnboardingStatus> {
    const statusCol = `${step}Status` as const;
    const dismissedCol = `${step}DismissedUntil` as const;
    const fields: Record<string, unknown> = { updatedAt: new Date() };
    if ("status" in patch) fields[statusCol] = patch.status ?? null;
    if ("dismissedUntil" in patch) fields[dismissedCol] = patch.dismissedUntil ?? null;

    const existing = await this.getOnboardingStatus(userId);
    if (existing) {
      const [row] = await db.update(onboardingStatus).set(fields).where(eq(onboardingStatus.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(onboardingStatus).values({ userId, ...fields }).returning();
    return row;
  }

  // ── Wallet ─────────────────────────────────────────────────────────────
  async getWalletSettings(userId: string): Promise<WalletSettings | undefined> {
    const [row] = await db.select().from(walletSettings).where(eq(walletSettings.userId, userId)).limit(1);
    return row;
  }
  async upsertWalletSettings(input: { userId: string; currencySymbol?: string; minCashoutCents?: number }): Promise<WalletSettings> {
    const existing = await this.getWalletSettings(input.userId);
    if (existing) {
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (input.currencySymbol !== undefined) patch.currencySymbol = input.currencySymbol;
      if (input.minCashoutCents !== undefined) patch.minCashoutCents = input.minCashoutCents;
      const [row] = await db.update(walletSettings).set(patch).where(eq(walletSettings.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(walletSettings).values({
      userId: input.userId,
      currencySymbol: input.currencySymbol ?? "$",
      minCashoutCents: input.minCashoutCents ?? 0,
    }).returning();
    return row;
  }
  async getOrCreateWalletBalance(userId: string, profileId: string, dbClient: DbOrTx = db): Promise<WalletBalance> {
    const [existing] = await dbClient.select().from(walletBalances).where(eq(walletBalances.profileId, profileId)).limit(1);
    if (existing) return existing;
    const [row] = await dbClient.insert(walletBalances).values({ userId, profileId }).returning();
    return row;
  }
  async listWalletTransactions(profileId: string, limit = 50): Promise<WalletTransaction[]> {
    return db.select().from(walletTransactions)
      .where(eq(walletTransactions.profileId, profileId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit);
  }
  async getWalletTransaction(id: string): Promise<WalletTransaction | undefined> {
    const [row] = await db.select().from(walletTransactions).where(eq(walletTransactions.id, id)).limit(1);
    return row;
  }
  async listPendingCashouts(userId: string): Promise<WalletTransaction[]> {
    return db.select().from(walletTransactions)
      .where(and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.type, "cashout_requested"),
        eq(walletTransactions.status, "pending"),
      ))
      .orderBy(desc(walletTransactions.createdAt));
  }
  async sumPendingCashoutCents(profileId: string): Promise<{ cents: number; points: number }> {
    const rows = await db.select().from(walletTransactions)
      .where(and(
        eq(walletTransactions.profileId, profileId),
        eq(walletTransactions.type, "cashout_requested"),
        eq(walletTransactions.status, "pending"),
      ));
    return rows.reduce((acc, r) => ({
      cents: acc.cents + (r.requestedCents || 0),
      points: acc.points + (r.requestedPoints || 0),
    }), { cents: 0, points: 0 });
  }
  async createCashoutRequest(input: { userId: string; profileId: string; points: number; cents: number; note: string | null }, dbClient: DbOrTx = db): Promise<WalletTransaction> {
    const [row] = await dbClient.insert(walletTransactions).values({
      userId: input.userId,
      profileId: input.profileId,
      type: "cashout_requested",
      status: "pending",
      requestedPoints: input.points,
      requestedCents: input.cents,
      deltaCents: 0,
      deltaPoints: 0,
      note: input.note,
    }).returning();
    return row;
  }
  async approveCashout(txId: string, userId: string): Promise<WalletTransaction | null> {
    const tx = await this.getWalletTransaction(txId);
    if (!tx || tx.userId !== userId) return null;
    if (tx.status !== "pending" || tx.type !== "cashout_requested") return null;
    // Atomically claim the approval: only succeeds if still pending (prevents double-approve)
    const [claimed] = await db.update(walletTransactions)
      .set({
        status: "done",
        type: "cashout_approved",
        deltaCents: tx.requestedCents,
        deltaPoints: -(tx.requestedPoints ?? 0),
        decidedAt: new Date(),
      })
      .where(and(eq(walletTransactions.id, txId), eq(walletTransactions.status, "pending")))
      .returning();
    if (!claimed) return null;
    // Add to balance using SQL arithmetic (atomic additive update, no balance check needed)
    await this.getOrCreateWalletBalance(userId, tx.profileId);
    await db.update(walletBalances)
      .set({ availableCents: sql`${walletBalances.availableCents} + ${tx.requestedCents ?? 0}`, updatedAt: new Date() })
      .where(eq(walletBalances.profileId, tx.profileId));
    return claimed;
  }
  async declineCashout(txId: string, userId: string): Promise<WalletTransaction | null> {
    const tx = await this.getWalletTransaction(txId);
    if (!tx || tx.userId !== userId) return null;
    if (tx.status !== "pending" || tx.type !== "cashout_requested") return null;
    // Include status=pending in WHERE so double-decline is a no-op
    const [updated] = await db.update(walletTransactions)
      .set({ status: "declined", type: "cashout_declined", decidedAt: new Date() })
      .where(and(eq(walletTransactions.id, txId), eq(walletTransactions.status, "pending")))
      .returning();
    return updated ?? null;
  }
  async cashout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }, dbClient: DbOrTx = db): Promise<WalletTransaction> {
    await dbClient.insert(allowancePayouts).values({
      userId: input.userId,
      profileId: input.profileId,
      points: input.points,
      amountCents: input.amountCents,
      note: input.note,
    });
    await this.getOrCreateWalletBalance(input.userId, input.profileId, dbClient);
    await dbClient.update(walletBalances)
      .set({ availableCents: sql`${walletBalances.availableCents} + ${input.amountCents}`, updatedAt: new Date() })
      .where(eq(walletBalances.profileId, input.profileId));
    const [tx] = await dbClient.insert(walletTransactions).values({
      userId: input.userId,
      profileId: input.profileId,
      type: "cashout_approved",
      status: "done",
      deltaCents: input.amountCents,
      deltaPoints: -input.points,
      requestedPoints: input.points,
      requestedCents: input.amountCents,
      note: input.note,
      decidedAt: new Date(),
    }).returning();
    return tx;
  }
  async markPaid(input: { userId: string; profileId: string; amountCents: number; note: string | null }): Promise<WalletTransaction | null> {
    if (input.amountCents <= 0) return null;
    // Atomic conditional debit: deducts only if balance is sufficient (eliminates TOCTOU race)
    const [bal] = await db.update(walletBalances)
      .set({ availableCents: sql`${walletBalances.availableCents} - ${input.amountCents}`, updatedAt: new Date() })
      .where(and(eq(walletBalances.profileId, input.profileId), gte(walletBalances.availableCents, input.amountCents)))
      .returning();
    if (!bal) return null;
    const [tx] = await db.insert(walletTransactions).values({
      userId: input.userId,
      profileId: input.profileId,
      type: "paid",
      status: "done",
      deltaCents: -input.amountCents,
      note: input.note,
      decidedAt: new Date(),
    }).returning();
    return tx;
  }
  async depositToSavings(input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null> {
    if (input.amountCents <= 0) return null;
    // Atomic conditional transfer: only succeeds if available balance is sufficient
    const [bal] = await db.update(walletBalances)
      .set({
        availableCents: sql`${walletBalances.availableCents} - ${input.amountCents}`,
        savingsCents: sql`${walletBalances.savingsCents} + ${input.amountCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(walletBalances.profileId, input.profileId), gte(walletBalances.availableCents, input.amountCents)))
      .returning();
    if (!bal) return null;
    const [tx] = await db.insert(walletTransactions).values({
      userId: input.userId,
      profileId: input.profileId,
      type: "savings_deposit",
      status: "done",
      deltaCents: input.amountCents,
      goalId: input.goalId,
      note: input.note,
    }).returning();
    if (input.goalId) {
      const goal = await this.getSavingsGoal(input.goalId);
      if (goal && goal.profileId === input.profileId) {
        const newSaved = (goal.savedCents ?? 0) + input.amountCents;
        const completed = !goal.completedAt && newSaved >= goal.targetCents;
        await db.update(savingsGoals)
          .set({ savedCents: newSaved, completedAt: completed ? new Date() : goal.completedAt })
          .where(eq(savingsGoals.id, input.goalId));
        if (completed) {
          await db.insert(walletTransactions).values({
            userId: input.userId,
            profileId: input.profileId,
            type: "goal_completed",
            status: "done",
            goalId: input.goalId,
            note: goal.name,
          });
        }
      }
    }
    return tx;
  }
  async withdrawFromSavings(input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null> {
    if (input.amountCents <= 0) return null;
    // Atomic conditional transfer: only succeeds if savings balance is sufficient
    const [bal] = await db.update(walletBalances)
      .set({
        availableCents: sql`${walletBalances.availableCents} + ${input.amountCents}`,
        savingsCents: sql`${walletBalances.savingsCents} - ${input.amountCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(walletBalances.profileId, input.profileId), gte(walletBalances.savingsCents, input.amountCents)))
      .returning();
    if (!bal) return null;
    const [tx] = await db.insert(walletTransactions).values({
      userId: input.userId,
      profileId: input.profileId,
      type: "savings_withdraw",
      status: "done",
      deltaCents: -input.amountCents,
      goalId: input.goalId,
      note: input.note,
    }).returning();
    if (input.goalId) {
      const goal = await this.getSavingsGoal(input.goalId);
      if (goal && goal.profileId === input.profileId) {
        await db.update(savingsGoals)
          .set({ savedCents: Math.max(0, (goal.savedCents ?? 0) - input.amountCents) })
          .where(eq(savingsGoals.id, input.goalId));
      }
    }
    return tx;
  }
  async listSavingsGoals(profileId: string): Promise<SavingsGoal[]> {
    return db.select().from(savingsGoals)
      .where(eq(savingsGoals.profileId, profileId))
      .orderBy(desc(savingsGoals.createdAt));
  }
  async getSavingsGoal(id: string): Promise<SavingsGoal | undefined> {
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
    return row;
  }
  async createSavingsGoal(input: { userId: string; profileId: string; name: string; targetCents: number; photoUrl: string | null }): Promise<SavingsGoal> {
    const [row] = await db.insert(savingsGoals).values(input).returning();
    return row;
  }
  async updateSavingsGoal(id: string, userId: string, updates: { name?: string; targetCents?: number; photoUrl?: string | null }): Promise<SavingsGoal | null> {
    const [row] = await db.update(savingsGoals)
      .set(updates)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)))
      .returning();
    return row || null;
  }
  async deleteSavingsGoal(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)))
      .returning();
    return result.length > 0;
  }
  async getApprovedCashoutPoints(profileId: string): Promise<number> {
    const rows = await db.select().from(walletTransactions)
      .where(and(
        eq(walletTransactions.profileId, profileId),
        eq(walletTransactions.type, "cashout_approved"),
      ));
    return rows.reduce((sum, r) => sum + (r.requestedPoints || 0), 0);
  }
  async getReservedCashoutPoints(profileId: string, dbClient: DbOrTx = db): Promise<number> {
    // Approved cashouts permanently debit points; pending requests reserve them
    // immediately so a kid can't request more than they actually have while
    // waiting on parent approval. A decline flips the row's type away from
    // both of these, so the points automatically un-reserve with no separate
    // refund step needed.
    const rows = await dbClient.select().from(walletTransactions)
      .where(and(
        eq(walletTransactions.profileId, profileId),
        or(
          eq(walletTransactions.type, "cashout_approved"),
          and(
            eq(walletTransactions.type, "cashout_requested"),
            eq(walletTransactions.status, "pending"),
          ),
        ),
      ));
    return rows.reduce((sum, r) => sum + (r.requestedPoints || 0), 0);
  }

  async getChoreCompletionCount(profileId: string): Promise<number> {
    const completions = await db.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId));
    return completions.length;
  }

  async getCategoryCompletionCounts(profileId: string): Promise<Record<string, number>> {
    const completions = await db.select().from(choreCompletions).where(eq(choreCompletions.profileId, profileId));
    const allChores = await db.select().from(chores);
    
    const counts: Record<string, number> = {};
    
    for (const completion of completions) {
      const chore = allChores.find(c => c.id === completion.choreId);
      const category = chore?.category || 'general';
      counts[category] = (counts[category] || 0) + 1;
    }
    
    return counts;
  }

  // Custom Profile Groups
  async getCustomProfileGroups(userId: string): Promise<CustomProfileGroup[]> {
    return await db
      .select()
      .from(customProfileGroups)
      .where(eq(customProfileGroups.userId, userId))
      .orderBy(customProfileGroups.displayOrder);
  }

  async reorderCustomProfileGroups(userId: string, orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        db
          .update(customProfileGroups)
          .set({ displayOrder: index })
          .where(and(eq(customProfileGroups.id, id), eq(customProfileGroups.userId, userId)))
      )
    );
  }

  async getCustomProfileGroup(id: string): Promise<CustomProfileGroup | undefined> {
    const [group] = await db.select().from(customProfileGroups).where(eq(customProfileGroups.id, id));
    return group || undefined;
  }

  async createCustomProfileGroup(group: InsertCustomProfileGroup): Promise<CustomProfileGroup> {
    const [created] = await db.insert(customProfileGroups).values(group).returning();
    return created;
  }

  async updateCustomProfileGroup(id: string, group: Partial<InsertCustomProfileGroup>, userId: string): Promise<CustomProfileGroup | undefined> {
    const [updated] = await db
      .update(customProfileGroups)
      .set(group)
      .where(and(eq(customProfileGroups.id, id), eq(customProfileGroups.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteCustomProfileGroup(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(customProfileGroups)
      .where(and(eq(customProfileGroups.id, id), eq(customProfileGroups.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Meals
  async getMealsByUser(userId: string): Promise<Meal[]> {
    return await db.select().from(meals).where(eq(meals.userId, userId));
  }

  async getMealsByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<Meal[]> {
    return await db.select().from(meals).where(
      and(
        eq(meals.userId, userId),
        gte(meals.date, startDate),
        lte(meals.date, endDate),
      )
    );
  }

  async getMeal(id: string, userId: string): Promise<Meal | undefined> {
    const [meal] = await db.select().from(meals).where(and(eq(meals.id, id), eq(meals.userId, userId)));
    return meal || undefined;
  }

  async createMeal(meal: InsertMeal): Promise<Meal> {
    const [created] = await db.insert(meals).values(meal).returning();
    return created;
  }

  async updateMeal(id: string, updates: Partial<InsertMeal>, userId: string): Promise<Meal | undefined> {
    const [updated] = await db
      .update(meals)
      .set(updates)
      .where(and(eq(meals.id, id), eq(meals.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteMeal(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(meals).where(and(eq(meals.id, id), eq(meals.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Meal Ingredients
  async getIngredientsByMealIds(mealIds: string[]): Promise<MealIngredient[]> {
    if (mealIds.length === 0) return [];
    return await db.select().from(mealIngredients).where(inArray(mealIngredients.mealId, mealIds));
  }

  async replaceMealIngredients(mealId: string, ingredients: Omit<InsertMealIngredient, "mealId">[]): Promise<MealIngredient[]> {
    await db.delete(mealIngredients).where(eq(mealIngredients.mealId, mealId));
    if (ingredients.length === 0) return [];
    const rows = ingredients.map((ing, idx) => ({
      mealId,
      item: ing.item,
      quantity: ing.quantity ?? null,
      displayOrder: ing.displayOrder ?? idx,
    }));
    const inserted = await db.insert(mealIngredients).values(rows).returning();
    return inserted;
  }

  // Grocery Items
  async getGroceryItemsByUser(userId: string): Promise<GroceryItem[]> {
    return await db.select().from(groceryItems).where(eq(groceryItems.userId, userId));
  }

  async createGroceryItem(item: InsertGroceryItem): Promise<GroceryItem> {
    const data: InsertGroceryItem = {
      ...item,
      sourceMealIds: Array.isArray(item.sourceMealIds) ? item.sourceMealIds : [],
    };
    const [created] = await db.insert(groceryItems).values(data).returning();
    return created;
  }

  async createGroceryItems(userId: string, items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]> {
    if (items.length === 0) return [];
    const rows: InsertGroceryItem[] = items.map((it) => ({
      userId,
      name: it.name,
      quantity: it.quantity ?? null,
      isChecked: it.isChecked ?? false,
      sourceMealIds: Array.isArray(it.sourceMealIds) ? it.sourceMealIds : [],
      category: it.category ?? null,
    }));
    return await db.insert(groceryItems).values(rows).returning();
  }

  async updateGroceryItem(id: string, updates: Partial<InsertGroceryItem>, userId: string): Promise<GroceryItem | undefined> {
    const [updated] = await db
      .update(groceryItems)
      .set(updates)
      .where(and(eq(groceryItems.id, id), eq(groceryItems.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteGroceryItem(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(groceryItems).where(and(eq(groceryItems.id, id), eq(groceryItems.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteCheckedGroceryItems(userId: string): Promise<number> {
    const result = await db.delete(groceryItems).where(
      and(eq(groceryItems.userId, userId), eq(groceryItems.isChecked, true))
    );
    return result.rowCount ?? 0;
  }

  async replaceGroceryItemsForUser(userId: string, items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]> {
    await db.delete(groceryItems).where(eq(groceryItems.userId, userId));
    if (items.length === 0) return [];
    const rows: InsertGroceryItem[] = items.map((it) => ({
      userId,
      name: it.name,
      quantity: it.quantity ?? null,
      isChecked: it.isChecked ?? false,
      alreadyHave: it.alreadyHave ?? false,
      sourceMealIds: Array.isArray(it.sourceMealIds) ? it.sourceMealIds : [],
      category: it.category ?? null,
    }));
    const inserted = await db.insert(groceryItems).values(rows).returning();
    return inserted;
  }

  async getGroceryStaplesByUser(userId: string): Promise<GroceryStaple[]> {
    return await db.select().from(groceryStaples).where(eq(groceryStaples.userId, userId));
  }

  async createGroceryStaple(staple: InsertGroceryStaple): Promise<GroceryStaple> {
    const [created] = await db.insert(groceryStaples).values(staple).returning();
    return created;
  }

  async updateGroceryStaple(id: string, updates: Partial<InsertGroceryStaple>, userId: string): Promise<GroceryStaple | undefined> {
    const [updated] = await db
      .update(groceryStaples)
      .set(updates)
      .where(and(eq(groceryStaples.id, id), eq(groceryStaples.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteGroceryStaple(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(groceryStaples).where(and(eq(groceryStaples.id, id), eq(groceryStaples.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Saved Meals
  async getSavedMealsByUser(userId: string): Promise<SavedMeal[]> {
    return await db.select().from(savedMeals).where(eq(savedMeals.userId, userId));
  }

  async getSavedMeal(id: string, userId: string): Promise<SavedMeal | undefined> {
    const [row] = await db.select().from(savedMeals).where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
    return row || undefined;
  }

  async createSavedMeal(savedMeal: InsertSavedMeal): Promise<SavedMeal> {
    const [created] = await db.insert(savedMeals).values(savedMeal).returning();
    return created;
  }

  async updateSavedMeal(id: string, updates: Partial<InsertSavedMeal>, userId: string): Promise<SavedMeal | undefined> {
    const [updated] = await db
      .update(savedMeals)
      .set(updates)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteSavedMeal(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(savedMeals).where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSavedMealIngredients(savedMealIds: string[]): Promise<SavedMealIngredient[]> {
    if (savedMealIds.length === 0) return [];
    return await db.select().from(savedMealIngredients).where(inArray(savedMealIngredients.savedMealId, savedMealIds));
  }

  async replaceSavedMealIngredients(savedMealId: string, ingredients: Omit<InsertSavedMealIngredient, "savedMealId">[]): Promise<SavedMealIngredient[]> {
    await db.delete(savedMealIngredients).where(eq(savedMealIngredients.savedMealId, savedMealId));
    if (ingredients.length === 0) return [];
    const rows = ingredients.map((ing, idx) => ({
      savedMealId,
      item: ing.item,
      quantity: ing.quantity ?? null,
      displayOrder: ing.displayOrder ?? idx,
    }));
    const inserted = await db.insert(savedMealIngredients).values(rows).returning();
    return inserted;
  }

  // ===== Celebrations =====
  async getCelebrationsByUser(userId: string): Promise<Celebration[]> {
    return await db.select().from(celebrations).where(eq(celebrations.userId, userId));
  }

  async getCelebration(id: string, userId: string): Promise<Celebration | undefined> {
    const [row] = await db.select().from(celebrations)
      .where(and(eq(celebrations.id, id), eq(celebrations.userId, userId)));
    return row || undefined;
  }

  async createCelebration(celebration: InsertCelebration): Promise<Celebration> {
    const [created] = await db.insert(celebrations).values(celebration).returning();
    return created;
  }

  async updateCelebration(id: string, updates: Partial<InsertCelebration>, userId: string): Promise<Celebration | undefined> {
    const [updated] = await db.update(celebrations)
      .set(updates)
      .where(and(eq(celebrations.id, id), eq(celebrations.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteCelebration(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(celebrations)
      .where(and(eq(celebrations.id, id), eq(celebrations.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getGiftIdeasByCelebrationIds(celebrationIds: string[]): Promise<CelebrationGiftIdea[]> {
    if (celebrationIds.length === 0) return [];
    return await db.select().from(celebrationGiftIdeas).where(inArray(celebrationGiftIdeas.celebrationId, celebrationIds));
  }

  async createGiftIdea(idea: InsertCelebrationGiftIdea): Promise<CelebrationGiftIdea> {
    const [created] = await db.insert(celebrationGiftIdeas).values(idea).returning();
    return created;
  }

  async updateGiftIdea(id: string, updates: Partial<InsertCelebrationGiftIdea>, userId: string): Promise<CelebrationGiftIdea | undefined> {
    // Ensure parent celebration belongs to user
    const [existing] = await db.select({ id: celebrationGiftIdeas.id })
      .from(celebrationGiftIdeas)
      .innerJoin(celebrations, eq(celebrations.id, celebrationGiftIdeas.celebrationId))
      .where(and(eq(celebrationGiftIdeas.id, id), eq(celebrations.userId, userId)));
    if (!existing) return undefined;
    const [updated] = await db.update(celebrationGiftIdeas)
      .set(updates)
      .where(eq(celebrationGiftIdeas.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteGiftIdea(id: string, userId: string): Promise<boolean> {
    const [existing] = await db.select({ id: celebrationGiftIdeas.id })
      .from(celebrationGiftIdeas)
      .innerJoin(celebrations, eq(celebrations.id, celebrationGiftIdeas.celebrationId))
      .where(and(eq(celebrationGiftIdeas.id, id), eq(celebrations.userId, userId)));
    if (!existing) return false;
    const result = await db.delete(celebrationGiftIdeas).where(eq(celebrationGiftIdeas.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getPhotosByCelebrationIds(celebrationIds: string[]): Promise<CelebrationPhoto[]> {
    if (celebrationIds.length === 0) return [];
    return await db.select().from(celebrationPhotos).where(inArray(celebrationPhotos.celebrationId, celebrationIds));
  }

  async getCelebrationPhoto(id: string, userId: string): Promise<CelebrationPhoto | undefined> {
    const [row] = await db.select({
      id: celebrationPhotos.id,
      celebrationId: celebrationPhotos.celebrationId,
      year: celebrationPhotos.year,
      imageUrl: celebrationPhotos.imageUrl,
      caption: celebrationPhotos.caption,
      createdAt: celebrationPhotos.createdAt,
    })
      .from(celebrationPhotos)
      .innerJoin(celebrations, eq(celebrations.id, celebrationPhotos.celebrationId))
      .where(and(eq(celebrationPhotos.id, id), eq(celebrations.userId, userId)));
    return row;
  }

  async createCelebrationPhoto(photo: InsertCelebrationPhoto): Promise<CelebrationPhoto> {
    const [created] = await db.insert(celebrationPhotos).values(photo).returning();
    return created;
  }

  async deleteCelebrationPhoto(id: string, userId: string): Promise<boolean> {
    const [existing] = await db.select({ id: celebrationPhotos.id })
      .from(celebrationPhotos)
      .innerJoin(celebrations, eq(celebrations.id, celebrationPhotos.celebrationId))
      .where(and(eq(celebrationPhotos.id, id), eq(celebrations.userId, userId)));
    if (!existing) return false;
    const result = await db.delete(celebrationPhotos).where(eq(celebrationPhotos.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ===== Wishlist items =====
  async getWishlistItemsByUser(userId: string, opts?: { status?: string; submittedByProfileId?: string }): Promise<WishlistItem[]> {
    const conds = [eq(wishlistItems.userId, userId)];
    if (opts?.status) conds.push(eq(wishlistItems.status, opts.status));
    if (opts?.submittedByProfileId) conds.push(eq(wishlistItems.submittedByProfileId, opts.submittedByProfileId));
    return await db.select().from(wishlistItems)
      .where(and(...conds))
      .orderBy(desc(wishlistItems.createdAt));
  }

  async getWishlistItem(id: string, userId: string): Promise<WishlistItem | undefined> {
    const [row] = await db.select().from(wishlistItems)
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId)));
    return row || undefined;
  }

  async createWishlistItem(item: InsertWishlistItem): Promise<WishlistItem> {
    const [created] = await db.insert(wishlistItems).values(item).returning();
    return created;
  }

  async updateWishlistItem(id: string, updates: Partial<WishlistItem>, userId: string): Promise<WishlistItem | undefined> {
    const [updated] = await db.update(wishlistItems)
      .set(updates)
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async claimWishlistItemForApproval(id: string, userId: string): Promise<WishlistItem | undefined> {
    // Atomic conditional update: only succeeds if the row is still pending.
    // Two concurrent approve requests will see exactly one success, the other
    // returns undefined — preventing duplicate reward creation.
    const [claimed] = await db.update(wishlistItems)
      .set({ status: "approved", decidedAt: new Date() })
      .where(and(
        eq(wishlistItems.id, id),
        eq(wishlistItems.userId, userId),
        eq(wishlistItems.status, "pending"),
      ))
      .returning();
    return claimed || undefined;
  }

  async deleteWishlistItem(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(wishlistItems)
      .where(and(eq(wishlistItems.id, id), eq(wishlistItems.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // ===== Chore wheel spin history =====
  async createChoreSpin(spin: InsertChoreSpin): Promise<ChoreSpin> {
    const eligibleProfileIds: string[] = Array.isArray(spin.eligibleProfileIds)
      ? (spin.eligibleProfileIds as string[])
      : [];
    const [created] = await db
      .insert(choreSpins)
      .values({ ...spin, eligibleProfileIds })
      .returning();
    return created;
  }

  async getRecentChoreSpins(userId: string, limit: number = 5): Promise<ChoreSpin[]> {
    return await db.select().from(choreSpins)
      .where(eq(choreSpins.userId, userId))
      .orderBy(desc(choreSpins.createdAt))
      .limit(limit);
  }

  async getChoreSpin(id: string, userId: string): Promise<ChoreSpin | undefined> {
    const [row] = await db.select().from(choreSpins)
      .where(and(eq(choreSpins.id, id), eq(choreSpins.userId, userId)));
    return row ?? undefined;
  }

  async setChoreSpinAssignment(id: string, userId: string, assignedChoreId: string | null): Promise<ChoreSpin | undefined> {
    const [row] = await db.update(choreSpins)
      .set({ assignedChoreId })
      .where(and(eq(choreSpins.id, id), eq(choreSpins.userId, userId)))
      .returning();
    return row ?? undefined;
  }

  async getLastChoreWinner(
    userId: string,
    params: { choreId?: string | null; choreTitle?: string | null }
  ): Promise<ChoreSpin | undefined> {
    // Prefer choreId match; fall back to normalized title match. Authoritative across
    // full history (not bounded by recent-N) so the fairness toggle never silently
    // misses a stale winner.
    if (params.choreId) {
      const [row] = await db.select().from(choreSpins)
        .where(and(eq(choreSpins.userId, userId), eq(choreSpins.choreId, params.choreId)))
        .orderBy(desc(choreSpins.createdAt))
        .limit(1);
      if (row) return row;
    }
    const title = (params.choreTitle ?? "").trim().toLowerCase();
    if (title.length === 0) return undefined;
    const userSpins = await db.select().from(choreSpins)
      .where(eq(choreSpins.userId, userId))
      .orderBy(desc(choreSpins.createdAt));
    return userSpins.find(s => (s.choreTitle ?? "").trim().toLowerCase() === title);
  }

  async initializeDefaultData(): Promise<void> {
    // Check if we already have profiles
    const existingProfiles = await this.getProfiles();
    if (existingProfiles.length > 0) {
      return;
    }

    // Initialize with family members
    const defaultProfiles: InsertProfile[] = [
      {
        name: "Mommy",
        color: "hsl(300, 69%, 71%)",
        initials: "M",
        photoUrl: null,
        email: null,
        isActive: true,
      },
      {
        name: "Daddy",
        color: "hsl(200, 98%, 39%)",
        initials: "D",
        photoUrl: null,
        email: null,
        isActive: true,
      },
      {
        name: "Emma",
        color: "hsl(27, 87%, 67%)",
        initials: "E",
        photoUrl: null,
        email: null,
        isActive: true,
      },
      {
        name: "Liam",
        color: "hsl(142, 71%, 45%)",
        initials: "L",
        photoUrl: null,
        email: null,
        isActive: true,
      },
    ];

    for (const profile of defaultProfiles) {
      await this.createProfile(profile);
    }
  }

  // ===== Health reminders =====

  async getHealthRemindersByUser(userId: string, opts?: { profileId?: string; includePaused?: boolean }): Promise<HealthReminder[]> {
    const conds = [eq(healthReminders.userId, userId)];
    if (opts?.profileId) conds.push(eq(healthReminders.profileId, opts.profileId));
    if (!opts?.includePaused) conds.push(eq(healthReminders.isPaused, false));
    return await db.select().from(healthReminders)
      .where(and(...conds))
      .orderBy(desc(healthReminders.createdAt));
  }

  async getHealthReminder(id: string, userId: string): Promise<HealthReminder | undefined> {
    const [row] = await db.select().from(healthReminders)
      .where(and(eq(healthReminders.id, id), eq(healthReminders.userId, userId)));
    return row;
  }

  async createHealthReminder(reminder: InsertHealthReminder): Promise<HealthReminder> {
    const [created] = await db.insert(healthReminders).values(reminder).returning();
    // The scheduler stops polling once it finds no reminders (lib/workGate.ts).
    // Without this it would not notice the first one for up to an hour.
    markSchedulerWorkDirty("healthReminders");
    return created;
  }

  async updateHealthReminder(id: string, updates: Partial<InsertHealthReminder>, userId: string): Promise<HealthReminder | undefined> {
    const [updated] = await db.update(healthReminders)
      .set(updates)
      .where(and(eq(healthReminders.id, id), eq(healthReminders.userId, userId)))
      .returning();
    // Covers un-pausing and re-scheduling as well as editing.
    markSchedulerWorkDirty("healthReminders");
    return updated;
  }

  async deleteHealthReminder(id: string, userId: string): Promise<boolean> {
    const deleted = await db.delete(healthReminders)
      .where(and(eq(healthReminders.id, id), eq(healthReminders.userId, userId)))
      .returning({ id: healthReminders.id });
    return deleted.length > 0;
  }

  async getActiveHealthReminders(now: Date): Promise<HealthReminder[]> {
    return await db.select().from(healthReminders)
      .where(and(
        eq(healthReminders.isPaused, false),
        lte(healthReminders.startsAt, now),
      ));
  }

  async ensureHealthReminderEvent(input: {
    reminderId: string;
    userId: string;
    profileId: string;
    scheduledAt: Date;
  }): Promise<{ event: HealthReminderEvent; created: boolean }> {
    // Insert-or-noop using the (reminderId, scheduledAt) unique index, then
    // re-select. Safe under concurrent ticks / multiple instances.
    const inserted = await db.insert(healthReminderEvents).values({
      reminderId: input.reminderId,
      userId: input.userId,
      profileId: input.profileId,
      scheduledAt: input.scheduledAt,
      status: "pending",
    }).onConflictDoNothing({
      target: [healthReminderEvents.reminderId, healthReminderEvents.scheduledAt],
    }).returning();
    if (inserted[0]) {
      return { event: inserted[0], created: true };
    }
    const [existing] = await db.select().from(healthReminderEvents)
      .where(and(
        eq(healthReminderEvents.reminderId, input.reminderId),
        eq(healthReminderEvents.scheduledAt, input.scheduledAt),
      ))
      .limit(1);
    return { event: existing!, created: false };
  }

  async markHealthReminderEventFired(id: string): Promise<HealthReminderEvent | undefined> {
    const [updated] = await db.update(healthReminderEvents)
      .set({ firedAt: new Date(), status: "fired" })
      .where(eq(healthReminderEvents.id, id))
      .returning();
    return updated;
  }

  async claimHealthReminderDispatch(id: string, fromStatus: "pending" | "snoozed"): Promise<boolean> {
    const updated = await db.update(healthReminderEvents)
      .set({ firedAt: new Date(), status: "fired" })
      .where(and(eq(healthReminderEvents.id, id), eq(healthReminderEvents.status, fromStatus)))
      .returning({ id: healthReminderEvents.id });
    return updated.length > 0;
  }

  async releaseHealthReminderDispatch(id: string, fromStatus: "pending" | "snoozed"): Promise<void> {
    await db.update(healthReminderEvents)
      .set({ firedAt: null, status: fromStatus })
      .where(and(
        eq(healthReminderEvents.id, id),
        eq(healthReminderEvents.status, "fired"),
        isNull(healthReminderEvents.acknowledgedAt),
      ));
  }

  async acknowledgeHealthReminderEvent(id: string, userId: string, byProfileId: string | null): Promise<HealthReminderEvent | undefined> {
    const [updated] = await db.update(healthReminderEvents)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedByProfileId: byProfileId,
        status: "acknowledged",
        snoozeUntil: null,
      })
      .where(and(eq(healthReminderEvents.id, id), eq(healthReminderEvents.userId, userId)))
      .returning();
    return updated;
  }

  async snoozeHealthReminderEvent(id: string, userId: string, until: Date): Promise<HealthReminderEvent | undefined> {
    const [updated] = await db.update(healthReminderEvents)
      .set({ snoozeUntil: until, status: "snoozed" })
      .where(and(eq(healthReminderEvents.id, id), eq(healthReminderEvents.userId, userId)))
      .returning();
    // A snoozed event has to be re-fired even if every reminder is paused.
    markSchedulerWorkDirty("healthReminders");
    return updated;
  }

  async markHealthReminderEventMissed(id: string): Promise<HealthReminderEvent | undefined> {
    const [updated] = await db.update(healthReminderEvents)
      .set({ status: "missed" })
      .where(eq(healthReminderEvents.id, id))
      .returning();
    return updated;
  }

  async getDueHealthReminderEvents(now: Date): Promise<HealthReminderEvent[]> {
    // Only events actually snoozed whose snooze period has now elapsed — the
    // caller (processSnoozedAndMissed) re-fires each of these with a
    // "(snoozed)" push, so a plain "fired" (never-snoozed) event must NOT be
    // included here or it gets a false "(snoozed)" re-push every tick until
    // acknowledged. A stale "fired" event with no ack is instead handled by
    // the separate missed-sweep below, which only marks it missed — it never
    // re-fires it.
    return await db.select().from(healthReminderEvents)
      .where(and(
        eq(healthReminderEvents.status, "snoozed"),
        lte(healthReminderEvents.snoozeUntil, now),
      ));
  }

  async getHealthReminderEvents(userId: string, opts?: { profileId?: string; status?: string; limit?: number }): Promise<HealthReminderEvent[]> {
    const conds = [eq(healthReminderEvents.userId, userId)];
    if (opts?.profileId) conds.push(eq(healthReminderEvents.profileId, opts.profileId));
    if (opts?.status) conds.push(eq(healthReminderEvents.status, opts.status));
    const q = db.select().from(healthReminderEvents)
      .where(and(...conds))
      .orderBy(desc(healthReminderEvents.scheduledAt));
    return opts?.limit ? await q.limit(opts.limit) : await q;
  }

  async resetUserData(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Collect parent IDs needed for child tables that have non-cascade FKs
      const profileRows = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
      const choreRows   = await tx.select({ id: chores.id }).from(chores).where(eq(chores.userId, userId));
      const rewardRows  = await tx.select({ id: rewards.id }).from(rewards).where(eq(rewards.userId, userId));

      const profileIds = profileRows.map(r => r.id);
      const choreIds   = choreRows.map(r => r.id);
      const rewardIds  = rewardRows.map(r => r.id);

      // Delete every table that references profiles.id with a non-cascade
      // ("restrict") FK BEFORE the profiles themselves, or the final
      // `profiles` delete raises a foreign-key violation. NOTE:
      // achievements / google+outlook calendar tokens have NO userId column
      // (only profileId), so they must be scoped by profileId — the old code
      // filtered them by a non-existent `.userId`, which both failed to
      // compile cleanly and, at runtime, meant this whole reset threw for any
      // account that had ever connected a calendar (also silently swallowed
      // by joinFamily()'s solo-family teardown, orphaning the old data).
      if (choreIds.length > 0)   await tx.delete(choreCompletions).where(inArray(choreCompletions.choreId, choreIds));
      if (rewardIds.length > 0)  await tx.delete(rewardRedemptions).where(inArray(rewardRedemptions.rewardId, rewardIds));
      if (profileIds.length > 0) {
        await tx.delete(choreCompletions).where(inArray(choreCompletions.profileId, profileIds));
        await tx.delete(rewardRedemptions).where(inArray(rewardRedemptions.profileId, profileIds));
        await tx.delete(calendarAssignments).where(inArray(calendarAssignments.profileId, profileIds));
        await tx.delete(achievements).where(inArray(achievements.profileId, profileIds));
        await tx.delete(googleCalendarTokens).where(inArray(googleCalendarTokens.profileId, profileIds));
        await tx.delete(outlookCalendarTokens).where(inArray(outlookCalendarTokens.profileId, profileIds));
      }

      // All user-scoped parent tables. (Tables that reference profiles.id with
      // a *cascade* FK — icalSubscriptions, streakFreezes, behaviourIncidents,
      // completion bonuses, etc. — are cleaned up automatically when `profiles`
      // is deleted last.) This list is a superset of the per-category reset so
      // "Reset everything" truly wipes everything, including the tables the old
      // version missed (streakFreezes, savedMeals, rewardSettings, behaviour*,
      // ical subscriptions, calendar sync bookkeeping).
      await tx.delete(events).where(eq(events.userId, userId));
      await tx.delete(chores).where(eq(chores.userId, userId));
      await tx.delete(streakFreezes).where(eq(streakFreezes.userId, userId));
      await tx.delete(rewards).where(eq(rewards.userId, userId));
      await tx.delete(rewardSettings).where(eq(rewardSettings.userId, userId));
      await tx.delete(pointAdjustments).where(eq(pointAdjustments.userId, userId));
      await tx.delete(calendarSettings).where(eq(calendarSettings.userId, userId));
      await tx.delete(locationSettings).where(eq(locationSettings.userId, userId));
      await tx.delete(googleCalendarEventAssignments).where(eq(googleCalendarEventAssignments.userId, userId));
      await tx.delete(eventCalendarSyncs).where(eq(eventCalendarSyncs.userId, userId));
      await tx.delete(dailyContent).where(eq(dailyContent.userId, userId));
      await tx.delete(customProfileGroups).where(eq(customProfileGroups.userId, userId));
      await tx.delete(meals).where(eq(meals.userId, userId));
      await tx.delete(savedMeals).where(eq(savedMeals.userId, userId));
      await tx.delete(groceryItems).where(eq(groceryItems.userId, userId));
      await tx.delete(celebrations).where(eq(celebrations.userId, userId));
      await tx.delete(choreSpins).where(eq(choreSpins.userId, userId));
      await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
      await tx.delete(healthReminders).where(eq(healthReminders.userId, userId));
      await tx.delete(shoutouts).where(eq(shoutouts.userId, userId));
      await tx.delete(comments).where(eq(comments.userId, userId));
      await tx.delete(behaviourIncidents).where(eq(behaviourIncidents.userId, userId));
      await tx.delete(behaviourRules).where(eq(behaviourRules.userId, userId));
      await tx.delete(behaviourBoardSettings).where(eq(behaviourBoardSettings.userId, userId));
      await tx.delete(familyShareTokens).where(eq(familyShareTokens.userId, userId));
      await tx.delete(allowanceSettings).where(eq(allowanceSettings.userId, userId));
      await tx.delete(allowancePayouts).where(eq(allowancePayouts.userId, userId));
      await tx.delete(walletSettings).where(eq(walletSettings.userId, userId));
      await tx.delete(walletBalances).where(eq(walletBalances.userId, userId));
      await tx.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
      await tx.delete(savingsGoals).where(eq(savingsGoals.userId, userId));

      // Profiles LAST — cascade-deletes any remaining cascade-linked children.
      if (profileIds.length > 0) await tx.delete(profiles).where(eq(profiles.userId, userId));
    });
  }

  async resetUserDataCategories(userId: string, categories: ResetCategory[]): Promise<void> {
    const set = new Set(categories);
    await db.transaction(async (tx) => {
      const profileRows = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId));
      const profileIds = profileRows.map(r => r.id);

      if (set.has("chores")) {
        const choreRows = await tx.select({ id: chores.id }).from(chores).where(eq(chores.userId, userId));
        const choreIds = choreRows.map(r => r.id);
        if (choreIds.length > 0) await tx.delete(choreCompletions).where(inArray(choreCompletions.choreId, choreIds));
        await tx.delete(chores).where(eq(chores.userId, userId));
        await tx.delete(choreSpins).where(eq(choreSpins.userId, userId));
        if (profileIds.length > 0) await tx.delete(achievements).where(inArray(achievements.profileId, profileIds));
        await tx.delete(pointAdjustments).where(eq(pointAdjustments.userId, userId));
        await tx.delete(streakFreezes).where(eq(streakFreezes.userId, userId));
      }

      if (set.has("calendar")) {
        if (profileIds.length > 0) await tx.delete(icalSubscriptions).where(inArray(icalSubscriptions.profileId, profileIds));
        await tx.delete(events).where(eq(events.userId, userId));
        await tx.delete(calendarSettings).where(eq(calendarSettings.userId, userId));
        await tx.delete(locationSettings).where(eq(locationSettings.userId, userId));
        if (profileIds.length > 0) await tx.delete(googleCalendarTokens).where(inArray(googleCalendarTokens.profileId, profileIds));
        if (profileIds.length > 0) await tx.delete(outlookCalendarTokens).where(inArray(outlookCalendarTokens.profileId, profileIds));
        await tx.delete(googleCalendarEventAssignments).where(eq(googleCalendarEventAssignments.userId, userId));
        await tx.delete(eventCalendarSyncs).where(eq(eventCalendarSyncs.userId, userId));
      }

      if (set.has("meals")) {
        await tx.delete(meals).where(eq(meals.userId, userId));
        await tx.delete(groceryItems).where(eq(groceryItems.userId, userId));
        await tx.delete(savedMeals).where(eq(savedMeals.userId, userId));
      }

      if (set.has("rewards")) {
        const rewardRows = await tx.select({ id: rewards.id }).from(rewards).where(eq(rewards.userId, userId));
        const rewardIds = rewardRows.map(r => r.id);
        if (rewardIds.length > 0) await tx.delete(rewardRedemptions).where(inArray(rewardRedemptions.rewardId, rewardIds));
        await tx.delete(rewards).where(eq(rewards.userId, userId));
        await tx.delete(rewardSettings).where(eq(rewardSettings.userId, userId));
        await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
        await tx.delete(allowanceSettings).where(eq(allowanceSettings.userId, userId));
        await tx.delete(allowancePayouts).where(eq(allowancePayouts.userId, userId));
        await tx.delete(walletSettings).where(eq(walletSettings.userId, userId));
        await tx.delete(walletBalances).where(eq(walletBalances.userId, userId));
        await tx.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
        await tx.delete(savingsGoals).where(eq(savingsGoals.userId, userId));
      }

      if (set.has("behaviour")) {
        await tx.delete(behaviourIncidents).where(eq(behaviourIncidents.userId, userId));
        await tx.delete(behaviourRules).where(eq(behaviourRules.userId, userId));
        await tx.delete(behaviourBoardSettings).where(eq(behaviourBoardSettings.userId, userId));
      }

      if (set.has("notes")) {
        await tx.delete(dailyContent).where(eq(dailyContent.userId, userId));
        await tx.delete(healthReminders).where(eq(healthReminders.userId, userId));
        await tx.delete(shoutouts).where(eq(shoutouts.userId, userId));
        await tx.delete(comments).where(eq(comments.userId, userId));
        await tx.delete(celebrations).where(eq(celebrations.userId, userId));
        await tx.delete(familyShareTokens).where(eq(familyShareTokens.userId, userId));
      }

      // Profiles are handled LAST, after every other selected category, so
      // that tables the other categories delete (achievements, calendar
      // tokens, chore completions, reward redemptions) are gone before the
      // profiles they reference. Deleting a profile also requires clearing
      // every remaining table that references profiles.id with a non-cascade
      // FK first — otherwise "reset Profiles" alone (or Profiles + a category
      // that doesn't own those children) raises a foreign-key violation.
      if (set.has("profiles") && profileIds.length > 0) {
        await tx.delete(choreCompletions).where(inArray(choreCompletions.profileId, profileIds));
        await tx.delete(rewardRedemptions).where(inArray(rewardRedemptions.profileId, profileIds));
        await tx.delete(calendarAssignments).where(inArray(calendarAssignments.profileId, profileIds));
        await tx.delete(achievements).where(inArray(achievements.profileId, profileIds));
        await tx.delete(googleCalendarTokens).where(inArray(googleCalendarTokens.profileId, profileIds));
        await tx.delete(outlookCalendarTokens).where(inArray(outlookCalendarTokens.profileId, profileIds));
        await tx.delete(customProfileGroups).where(eq(customProfileGroups.userId, userId));
        await tx.delete(profiles).where(eq(profiles.userId, userId));
      }
    });
  }

  async getUnacknowledgedHealthReminderEvents(userId: string): Promise<HealthReminderEvent[]> {
    // A snoozed event should disappear from this list until its snooze
    // actually elapses — previously "snoozed" alone was enough to stay
    // included regardless of snoozeUntil, so pressing Snooze had no visible
    // effect at all.
    const now = new Date();
    return await db.select().from(healthReminderEvents)
      .where(and(
        eq(healthReminderEvents.userId, userId),
        or(
          eq(healthReminderEvents.status, "fired"),
          and(eq(healthReminderEvents.status, "snoozed"), lte(healthReminderEvents.snoozeUntil, now)),
        ),
      ))
      .orderBy(desc(healthReminderEvents.scheduledAt));
  }
}

// Note: MemStorage is kept for compatibility but DatabaseStorage is the primary implementation
export class MemStorage implements IStorage {
  private profiles: Map<string, Profile>;
  private events: Map<string, Event>;
  private chores: Map<string, Chore>;
  private choreCompletions: Map<string, ChoreCompletion>;
  private achievements: Map<string, Achievement>;
  private calendarSettings: CalendarSettings | undefined;
  private locationSettings: LocationSettings | undefined;

  constructor() {
    this.profiles = new Map();
    this.events = new Map();
    this.chores = new Map();
    this.choreCompletions = new Map();
    this.achievements = new Map();

    // Initialize with family members
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    const defaultProfiles: Profile[] = [
      {
        id: "mommy-id",
        name: "Mommy",
        color: "hsl(300, 69%, 71%)",
        initials: "M",
        isActive: true,
        photoUrl: null,
        createdAt: new Date()
      },
      {
        id: "daddy-id", 
        name: "Daddy",
        color: "hsl(230, 89%, 74%)",
        initials: "D",
        isActive: true,
        photoUrl: null,
        createdAt: new Date()
      },
      {
        id: "paisley-id",
        name: "Paisley", 
        color: "hsl(330, 81%, 60%)",
        initials: "P",
        isActive: true,
        photoUrl: null,
        createdAt: new Date()
      },
      {
        id: "truitt-id",
        name: "Truitt",
        color: "hsl(35, 91%, 54%)", 
        initials: "T",
        isActive: true,
        photoUrl: null,
        createdAt: new Date()
      },
      {
        id: "jett-id",
        name: "Jett",
        color: "hsl(160, 84%, 39%)",
        initials: "J", 
        isActive: true,
        photoUrl: null,
        createdAt: new Date()
      }
    ];

    defaultProfiles.forEach(profile => {
      this.profiles.set(profile.id, profile);
    });
  }

  // Profiles
  async getProfiles(): Promise<Profile[]> {
    return Array.from(this.profiles.values()).filter(p => p.isActive);
  }

  async getProfilesByUser(userId: string): Promise<Profile[]> {
    return Array.from(this.profiles.values()).filter(p => p.userId === userId && p.isActive);
  }

  async getProfile(id: string): Promise<Profile | undefined> {
    return this.profiles.get(id);
  }

  async createProfile(insertProfile: InsertProfile): Promise<Profile> {
    const id = randomUUID();
    const profile: Profile = {
      ...insertProfile,
      id,
      parentalConsentAt: insertProfile.parentalConsentAt ?? null,
      parentalConsentBy: insertProfile.parentalConsentBy ?? null,
      createdAt: new Date(),
    };
    this.profiles.set(id, profile);
    return profile;
  }

  async updateProfile(id: string, updates: Partial<InsertProfile>, userId?: string): Promise<Profile | undefined> {
    const profile = this.profiles.get(id);
    if (!profile) return undefined;
    if (userId && profile.userId !== userId) return undefined;

    const updatedProfile = { ...profile, ...updates };
    this.profiles.set(id, updatedProfile);
    return updatedProfile;
  }

  async deleteProfile(id: string, userId?: string): Promise<boolean> {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    if (userId && profile.userId !== userId) return false;

    const updatedProfile = { ...profile, isActive: false };
    this.profiles.set(id, updatedProfile);
    return true;
  }

  // Events
  async getEvents(): Promise<Event[]> {
    return Array.from(this.events.values());
  }

  async getEventsByUser(userId: string): Promise<Event[]> {
    return Array.from(this.events.values()).filter(e => e.userId === userId);
  }

  async getEventsByProfile(profileId: string): Promise<Event[]> {
    return Array.from(this.events.values()).filter(e => e.profileId === profileId);
  }

  async getEventsByDateRange(startDate: Date, endDate: Date): Promise<Event[]> {
    return Array.from(this.events.values()).filter(e => 
      e.startTime >= startDate && e.startTime <= endDate
    );
  }

  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const id = randomUUID();
    const event: Event = {
      ...insertEvent,
      id,
      movedFrom: insertEvent.movedFrom ?? null,
      createdAt: new Date(),
    };
    this.events.set(id, event);
    return event;
  }

  async updateEvent(id: string, updates: Partial<InsertEvent>, userId: string): Promise<Event | undefined> {
    const event = this.events.get(id);
    if (!event) return undefined;
    if (event.userId !== userId) return undefined;

    const updatedEvent = { ...event, ...updates };
    this.events.set(id, updatedEvent);
    return updatedEvent;
  }

  async deleteEvent(id: string, userId: string): Promise<boolean> {
    const event = this.events.get(id);
    if (!event) return false;
    if (event.userId !== userId) return false;
    return this.events.delete(id);
  }

  async getExistingExternalIds(userId: string, source: string, externalIds: string[]): Promise<Set<string>> {
    const wanted = new Set(externalIds);
    const found = new Set<string>();
    for (const event of this.events.values()) {
      if (
        event.userId === userId &&
        event.source === source &&
        event.externalId &&
        wanted.has(event.externalId)
      ) {
        found.add(event.externalId);
      }
    }
    return found;
  }

  async bulkCreateEvents(insertEvents: InsertEvent[]): Promise<Event[]> {
    const created: Event[] = [];
    for (const insertEvent of insertEvents) {
      const id = randomUUID();
      const event: Event = {
        ...insertEvent,
        id,
        createdAt: new Date(),
      } as Event;
      this.events.set(id, event);
      created.push(event);
    }
    return created;
  }

  // Chores
  async getChores(): Promise<Chore[]> {
    return Array.from(this.chores.values()).filter(c => c.isActive);
  }

  async getChoresByUser(userId: string): Promise<Chore[]> {
    return Array.from(this.chores.values()).filter(c => c.userId === userId && c.isActive);
  }

  async getChoresByProfile(profileId: string): Promise<Chore[]> {
    return Array.from(this.chores.values()).filter(c => 
      c.profileIds && c.profileIds.includes(profileId) && c.isActive
    );
  }

  async createChore(insertChore: InsertChore): Promise<Chore> {
    const id = randomUUID();
    const chore: Chore = {
      ...insertChore,
      id,
      createdAt: new Date(),
    };
    this.chores.set(id, chore);
    return chore;
  }

  async updateChore(id: string, updates: Partial<InsertChore>, userId: string): Promise<Chore | undefined> {
    const chore = this.chores.get(id);
    if (!chore) return undefined;
    if (chore.userId !== userId) return undefined;

    const updatedChore = { ...chore, ...updates };
    this.chores.set(id, updatedChore);
    return updatedChore;
  }

  async getChildChores(parentId: string): Promise<Chore[]> {
    return Array.from(this.chores.values()).filter(c => (c as any).parentChoreId === parentId);
  }

  async archiveOldCompletedTodos(_userId: string, _cutoff: Date): Promise<number> {
    return 0;
  }

  async deleteChore(id: string, userId: string): Promise<boolean> {
    const chore = this.chores.get(id);
    if (!chore) return false;
    if (chore.userId !== userId) return false;

    // Sub-to-dos go with their parent (see DatabaseStorage.deleteChore).
    for (const child of Array.from(this.chores.values())) {
      if ((child as any).parentChoreId === id && child.userId === userId) {
        this.chores.set(child.id, { ...child, isActive: false });
      }
    }
    const updatedChore = { ...chore, isActive: false };
    this.chores.set(id, updatedChore);
    return true;
  }

  async reorderChores(userId: string, orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const chore = this.chores.get(id);
      if (chore && chore.userId === userId) {
        this.chores.set(id, { ...chore, displayOrder: index });
      }
    });
  }

  // Chore Completions
  // MemStorage is the no-database fallback; skips are not persisted here.
  async getChoreSkips(_userId: string, _since: Date): Promise<ChoreSkip[]> { return []; }
  async addChoreSkip(_userId: string, choreId: string, profileId: string, skipDate: Date): Promise<ChoreSkip> {
    return { id: "mem", userId: "mem", choreId, profileId, skipDate, createdAt: new Date() } as ChoreSkip;
  }
  async removeChoreSkip(_userId: string, _choreId: string, _profileId: string, _skipDate: Date): Promise<boolean> { return false; }

  async getChoreCompletions(): Promise<ChoreCompletion[]> {
    return Array.from(this.choreCompletions.values());
  }

  async getChoreCompletionsByProfile(profileId: string): Promise<ChoreCompletion[]> {
    return Array.from(this.choreCompletions.values()).filter(c => c.profileId === profileId);
  }

  async getChoreCompletionsByDate(date: Date): Promise<ChoreCompletion[]> {
    const dateStr = date.toDateString();
    return Array.from(this.choreCompletions.values()).filter(c => 
      c.completedAt?.toDateString() === dateStr
    );
  }

  async getChoreCompletionsInRange(choreId: string, profileId: string, startDate: Date, endDate: Date): Promise<ChoreCompletion[]> {
    return Array.from(this.choreCompletions.values()).filter(c =>
      c.choreId === choreId &&
      c.profileId === profileId &&
      c.completedAt &&
      c.completedAt >= startDate &&
      c.completedAt <= endDate
    );
  }

  async getChoreCompletionsByChore(choreId: string): Promise<ChoreCompletion[]> {
    return Array.from(this.choreCompletions.values()).filter(c => c.choreId === choreId);
  }

  async createChoreCompletion(insertCompletion: InsertChoreCompletion): Promise<ChoreCompletion> {
    const id = randomUUID();
    const completion: ChoreCompletion = {
      ...insertCompletion,
      id,
      completedAt: new Date(),
    };
    this.choreCompletions.set(id, completion);
    return completion;
  }

  async deleteChoreCompletion(choreId: string, profileId: string): Promise<void> {
    // Find and delete the completion for today
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    for (const [id, completion] of this.choreCompletions) {
      if (
        completion.choreId === choreId && 
        completion.profileId === profileId &&
        completion.completedAt &&
        completion.completedAt >= startOfDay &&
        completion.completedAt < endOfDay
      ) {
        this.choreCompletions.delete(id);
        break;
      }
    }
  }

  // Achievements
  async getAchievements(): Promise<Achievement[]> {
    return Array.from(this.achievements.values());
  }

  async getAchievementsByProfile(profileId: string): Promise<Achievement[]> {
    return Array.from(this.achievements.values()).filter(a => a.profileId === profileId);
  }

  async createAchievement(insertAchievement: InsertAchievement): Promise<Achievement> {
    const id = randomUUID();
    const achievement: Achievement = {
      ...insertAchievement,
      id,
      earnedAt: new Date(),
    };
    this.achievements.set(id, achievement);
    return achievement;
  }

  // Calendar Settings - simple in-memory implementation
  async getCalendarSettingsByUser(userId: string): Promise<CalendarSettings | undefined> {
    return this.calendarSettings?.userId === userId ? this.calendarSettings : undefined;
  }

  async updateCalendarSettings(settings: InsertCalendarSettings & { userId: string }): Promise<CalendarSettings> {
    const calendarSettings: CalendarSettings = {
      id: randomUUID(),
      userId: settings.userId ?? null,
      startHour: settings.startHour ?? 8,
      endHour: settings.endHour ?? 22,
      weekStartsOn: settings.weekStartsOn ?? 0,
      twoWaySyncEnabled: settings.twoWaySyncEnabled ?? false,
      familyCalendarId: settings.familyCalendarId ?? null,
      familyCalendarProfileId: settings.familyCalendarProfileId ?? null,
      familyCalendarProvider: settings.familyCalendarProvider ?? null,
      scanInbox: settings.scanInbox ?? true,
      shareOriginals: settings.shareOriginals ?? false,
      mutedSenders: settings.mutedSenders ?? [],
      dismissedSlipKeys: settings.dismissedSlipKeys ?? [],
      planSentKeys: settings.planSentKeys ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.calendarSettings = calendarSettings;
    return calendarSettings;
  }

  async claimPlanKey(userId: string, key: string, today: string): Promise<boolean> {
    const existing = this.calendarSettings?.userId === userId ? this.calendarSettings.planSentKeys ?? [] : null;
    if (existing?.includes(key)) return false;
    const kept = (existing ?? []).filter((item) => {
      const day = item.slice(item.lastIndexOf(":") + 1);
      return !/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today;
    });
    const planSentKeys = [...kept, key];
    if (!this.calendarSettings || this.calendarSettings.userId !== userId) {
      this.calendarSettings = {
        id: randomUUID(),
        userId,
        startHour: 8,
        endHour: 22,
        weekStartsOn: 0,
        twoWaySyncEnabled: false,
        familyCalendarId: null,
        familyCalendarProfileId: null,
        familyCalendarProvider: null,
        scanInbox: true,
        shareOriginals: false,
        mealsOnCalendar: false,
        mutedSenders: [],
        dismissedSlipKeys: [],
        planSentKeys,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return true;
    }
    this.calendarSettings = { ...this.calendarSettings, planSentKeys, updatedAt: new Date() };
    return true;
  }

  async releasePlanKey(userId: string, key: string): Promise<void> {
    if (!this.calendarSettings || this.calendarSettings.userId !== userId) return;
    this.calendarSettings = {
      ...this.calendarSettings,
      planSentKeys: (this.calendarSettings.planSentKeys ?? []).filter((item) => item !== key),
      updatedAt: new Date(),
    };
  }

  async getLocationSettingsByUser(userId: string): Promise<LocationSettings | undefined> {
    return this.locationSettings?.userId === userId ? this.locationSettings : undefined;
  }

  async updateLocationSettings(settings: InsertLocationSettings & { userId: string }): Promise<LocationSettings> {
    const locationSettings: LocationSettings = {
      id: randomUUID(),
      city: settings.city || "Farmington",
      state: settings.state || "Minnesota", 
      country: settings.country || "United States",
      latitude: settings.latitude || 44.6402,
      longitude: settings.longitude || -93.1468,
      timezone: settings.timezone || "America/Chicago",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.locationSettings = locationSettings;
    return locationSettings;
  }

  // Google Calendar Tokens - stub implementations
  async getGoogleCalendarTokens(profileId: string): Promise<GoogleCalendarTokens | undefined> {
    return undefined;
  }

  async saveGoogleCalendarTokens(tokens: InsertGoogleCalendarTokens): Promise<GoogleCalendarTokens> {
    const savedTokens: GoogleCalendarTokens = {
      ...tokens,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return savedTokens;
  }

  async disconnectGoogleCalendar(profileId: string): Promise<boolean> {
    return false;
  }

  async getGoogleAccountsByUser(_userId: string): Promise<{ profileId: string; email: string }[]> {
    return [];
  }

  // iCal subscriptions - stub implementations
  async getIcalSubscriptions(_profileId: string): Promise<IcalSubscription[]> { return []; }
  async getIcalSubscriptionById(_id: string): Promise<IcalSubscription | undefined> { return undefined; }
  async getIcalSubscriptionsByUser(_userId: string): Promise<IcalSubscription[]> { return []; }
  async createIcalSubscription(sub: InsertIcalSubscription): Promise<IcalSubscription> {
    return {
      ...sub,
      id: randomUUID(),
      calendarColor: sub.calendarColor ?? null,
      isActive: sub.isActive ?? true,
      lastFetchedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IcalSubscription;
  }
  async deleteIcalSubscription(_id: string): Promise<boolean> { return false; }
  async updateIcalSubscriptionStatus(_id: string, _status: { lastFetchedAt?: Date; lastError?: string | null }): Promise<void> {}

  // Behaviour Board - stub implementations
  async getBehaviourBoardSettings(_userId: string): Promise<BehaviourBoardSettings | undefined> { return undefined; }
  async upsertBehaviourBoardSettings(userId: string, updates: Partial<InsertBehaviourBoardSettings>): Promise<BehaviourBoardSettings> {
    return { id: randomUUID(), userId, familyMotto: null, defaultTimerMinutes: 15, createdAt: new Date(), updatedAt: new Date(), ...updates } as BehaviourBoardSettings;
  }
  async getBehaviourRules(_userId: string): Promise<BehaviourRule[]> { return []; }
  async getBehaviourRule(_id: string, _userId: string): Promise<BehaviourRule | undefined> { return undefined; }
  async createBehaviourRule(rule: InsertBehaviourRule): Promise<BehaviourRule> {
    return { id: randomUUID(), timerMinutes: 15, displayOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...rule } as BehaviourRule;
  }
  async updateBehaviourRule(_id: string, _updates: Partial<InsertBehaviourRule>, _userId: string): Promise<BehaviourRule | undefined> { return undefined; }
  async deleteBehaviourRule(_id: string, _userId: string): Promise<boolean> { return false; }
  async getBehaviourIncidents(_userId: string, _opts?: { status?: string; limit?: number }): Promise<BehaviourIncident[]> { return []; }
  async getBehaviourIncident(_id: string, _userId: string): Promise<BehaviourIncident | undefined> { return undefined; }
  async createBehaviourIncident(incident: InsertBehaviourIncident): Promise<BehaviourIncident> {
    return { id: randomUUID(), status: "positive_pending", resolvedAt: null, note: null, createdAt: new Date(), ...incident } as BehaviourIncident;
  }
  async resolveBehaviourIncident(_id: string, _userId: string, _status: "resolved_positive" | "negative_applied", _note?: string | null): Promise<BehaviourIncident | undefined> { return undefined; }
  async deleteBehaviourIncident(_id: string, _userId: string): Promise<boolean> { return false; }

  // Outlook Calendar Tokens - stub implementations
  async getOutlookCalendarTokens(profileId: string): Promise<OutlookCalendarTokens | undefined> {
    return undefined;
  }

  async saveOutlookCalendarTokens(tokens: InsertOutlookCalendarTokens): Promise<OutlookCalendarTokens> {
    const savedTokens: OutlookCalendarTokens = {
      ...tokens,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return savedTokens;
  }

  async disconnectOutlookCalendar(profileId: string): Promise<boolean> {
    return false;
  }

  // Calendar Assignments - stub implementations
  async getCalendarAssignments(_profileId: string): Promise<CalendarAssignment[]> {
    return [];
  }

  async getCalendarAssignmentsByUser(_userId: string): Promise<CalendarAssignment[]> {
    return [];
  }


  async saveCalendarAssignment(assignment: InsertCalendarAssignment): Promise<CalendarAssignment> {
    const savedAssignment: CalendarAssignment = {
      ...assignment,
      id: randomUUID(),
      audienceProfileIds: assignment.audienceProfileIds ?? [],
      watched: assignment.watched ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return savedAssignment;
  }

  async deleteCalendarAssignment(calendarType: string, calendarId: string, profileId: string): Promise<boolean> {
    return false;
  }

  async getCalendarAssignmentsForProfile(profileId: string): Promise<CalendarAssignment[]> {
    return [];
  }

  // Google Calendar Event Assignments (stubs)
  async getGoogleEventAssignmentsByUser(_userId: string): Promise<GoogleCalendarEventAssignment[]> {
    return [];
  }

  async setGoogleEventAssignment(_userId: string, _calendarId: string, _eventId: string, _profileIds: string[], _driverIds?: string[] | null, _seriesFromDate?: Date | null): Promise<void> {
    // no-op in memory
  }

  async clearGoogleEventInstanceOverridesForSeries(_userId: string, _calendarId: string, _recurringEventId: string, _fromDate: Date): Promise<void> {
    // no-op in memory
  }

  // Event ↔ external calendar sync links (stubs)
  async getEventCalendarSyncs(_eventId: string): Promise<EventCalendarSync[]> {
    return [];
  }
  async getExternalEventIdsByUser(_userId: string, _provider: string): Promise<Set<string>> {
    return new Set();
  }
  async upsertEventCalendarSync(row: InsertEventCalendarSync): Promise<EventCalendarSync> {
    return {
      id: randomUUID(),
      eventId: row.eventId,
      userId: row.userId,
      profileId: row.profileId,
      provider: row.provider,
      externalEventId: row.externalEventId,
      externalCalendarId: row.externalCalendarId,
      syncState: row.syncState ?? "synced",
      lastError: row.lastError ?? null,
      dismissedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  async getErroredSyncEvents(_profileId: string, _provider: string): Promise<Event[]> {
    return [];
  }
  async deleteEventCalendarSync(_eventId: string, _profileId: string, _provider: string): Promise<void> {
    // no-op in memory
  }
  async deleteEventCalendarSyncsForEvent(_eventId: string): Promise<void> {
    // no-op in memory
  }
  async getRecentSyncErrors(_userId: string, _limit: number): Promise<{
    id: string; eventId: string; eventTitle: string; eventStartTime: Date;
    provider: string; lastError: string | null; updatedAt: Date; profileNames: string[];
  }[]> {
    return [];
  }
  async dismissSyncError(_userId: string, _eventId: string, _provider: string): Promise<void> {
    // no-op in memory
  }

  // Daily Content
  async getDailyContent(): Promise<DailyContent[]> {
    return [];
  }

  async getDailyContentByUser(userId: string): Promise<DailyContent[]> {
    return [];
  }
  
  async getDailyContentById(id: string): Promise<DailyContent | undefined> {
    return undefined;
  }
  
  async createDailyContent(content: InsertDailyContent): Promise<DailyContent> {
    const dailyContent: DailyContent = {
      ...content,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return dailyContent;
  }
  
  async updateDailyContent(id: string, content: Partial<InsertDailyContent>): Promise<DailyContent | undefined> {
    return undefined;
  }
  
  async deleteDailyContent(id: string): Promise<boolean> {
    return false;
  }
  
  // Daily Content Assignments
  async getAllDailyContentAssignments(): Promise<DailyContentAssignment[]> {
    return [];
  }
  
  async getDailyContentAssignments(contentId: string): Promise<DailyContentAssignment[]> {
    return [];
  }
  
  async createDailyContentAssignment(assignment: InsertDailyContentAssignment): Promise<DailyContentAssignment> {
    const dailyAssignment: DailyContentAssignment = {
      ...assignment,
      id: randomUUID(),
      createdAt: new Date(),
    };
    return dailyAssignment;
  }
  
  async deleteDailyContentAssignments(contentId: string): Promise<boolean> {
    return false;
  }
  
  // Daily Content Completions
  async getDailyContentCompletions(profileId?: string, date?: Date): Promise<DailyContentCompletion[]> {
    return [];
  }
  
  async createDailyContentCompletion(completion: InsertDailyContentCompletion): Promise<DailyContentCompletion> {
    const dailyCompletion: DailyContentCompletion = {
      ...completion,
      id: randomUUID(),
      completedAt: new Date(),
    };
    return dailyCompletion;
  }
  
  async deleteDailyContentCompletion(contentId: string, profileId: string): Promise<boolean> {
    return false;
  }

  // Rewards - stub implementations
  async getRewards(): Promise<Reward[]> {
    return [];
  }

  async getRewardsByUser(userId: string): Promise<Reward[]> {
    return [];
  }

  async getRewardById(id: string): Promise<Reward | undefined> {
    return undefined;
  }

  async createReward(reward: InsertReward): Promise<Reward> {
    return {
      ...reward,
      id: randomUUID(),
      icon: reward.icon || '🎁',
      isActive: reward.isActive ?? true,
      scopeProfileId: reward.scopeProfileId || null,
      createdAt: new Date(),
    };
  }

  async updateReward(id: string, reward: Partial<InsertReward>): Promise<Reward | undefined> {
    return undefined;
  }

  async deleteReward(id: string): Promise<boolean> {
    return false;
  }

  // Reward Redemptions - stub implementations
  async getRewardRedemptions(profileId?: string): Promise<RewardRedemption[]> {
    return [];
  }

  async getRewardRedemptionsByUser(userId: string, profileId?: string): Promise<RewardRedemption[]> {
    return [];
  }

  async createRewardRedemption(redemption: InsertRewardRedemption): Promise<RewardRedemption> {
    return {
      ...redemption,
      id: randomUUID(),
      status: redemption.status || 'available',
      unlockedAt: redemption.unlockedAt || null,
      redeemedAt: redemption.redeemedAt || null,
      createdAt: new Date(),
    };
  }

  async updateRewardRedemption(id: string, redemption: Partial<InsertRewardRedemption>, userId: string): Promise<RewardRedemption | undefined> {
    return undefined;
  }

  // Gamification Helpers - stub implementations
  async getProfilePoints(profileId: string): Promise<number> {
    return 0;
  }
  async getStarLedger(_profileId: string): Promise<StarLedger> {
    return { balance: 0, totalEarned: 0, totalSpent: 0, events: [] };
  }
  async listPointAdjustments(_profileId: string, _limit?: number): Promise<PointAdjustment[]> { return []; }
  async createPointAdjustment(input: { userId: string; profileId: string; delta: number; reason: string | null }): Promise<PointAdjustment> {
    return { id: randomUUID(), userId: input.userId, profileId: input.profileId, delta: input.delta, reason: input.reason, createdAt: new Date() } as PointAdjustment;
  }
  async getCompletionBonus(_profileId: string, _localDayStart: Date): Promise<CompletionBonus | undefined> { return undefined; }
  async createCompletionBonus(input: InsertCompletionBonus): Promise<CompletionBonus> {
    return { id: randomUUID(), createdAt: new Date(), ...input } as CompletionBonus;
  }
  async deleteCompletionBonus(_profileId: string, _localDayStart: Date): Promise<void> {}

  async getProfileStreak(profileId: string): Promise<number> {
    return 0;
  }

  async getProfileStreakDetails(profileId: string): Promise<{
    streak: number;
    weekKey: string;
    hasFreezeThisWeek: boolean;
    frozenDates: string[];
    canUseFreezeForYesterday: boolean;
  }> {
    return { streak: 0, weekKey: "", hasFreezeThisWeek: true, frozenDates: [], canUseFreezeForYesterday: false };
  }

  async getStreakFreezesForProfile(_profileId: string, _limit?: number): Promise<StreakFreeze[]> {
    return [];
  }

  async getStreakFreezeForWeek(_profileId: string, _weekKey: string): Promise<StreakFreeze | undefined> {
    return undefined;
  }

  async createStreakFreeze(input: { profileId: string; userId: string; weekKey: string; usedForDate: string }): Promise<{ created: boolean; freeze: StreakFreeze }> {
    return { created: true, freeze: { id: randomUUID(), ...input, createdAt: new Date() } as StreakFreeze };
  }

  private shoutouts: Shoutout[] = [];
  async createShoutout(input: { userId: string; fromProfileId: string; toProfileId: string; emoji: string; message: string }): Promise<Shoutout> {
    // See the matching DbStorage method above — seenAt starts null, not
    // stamped here, so the shoutout isn't excluded from the feed below.
    const row = { id: randomUUID(), ...input, createdAt: new Date(), seenAt: null } as Shoutout;
    this.shoutouts.unshift(row);
    return row;
  }
  async listShoutoutsForUser(userId: string, limit = 50): Promise<Shoutout[]> {
    return this.shoutouts
      .filter((s) => s.userId === userId)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, limit);
  }
  async getShoutout(id: string): Promise<Shoutout | undefined> {
    return this.shoutouts.find((s) => s.id === id);
  }
  async markShoutoutSeen(id: string, userId: string): Promise<Shoutout | undefined> {
    const row = this.shoutouts.find((s) => s.id === id && s.userId === userId);
    if (!row) return undefined;
    row.seenAt = new Date();
    return row;
  }
  async getUnseenShoutoutCount(userId: string): Promise<number> {
    return this.shoutouts.filter((s) => s.userId === userId && !s.seenAt).length;
  }

  private comments: Comment[] = [];
  async listComments(userId: string, entityType: string, entityId: string): Promise<Comment[]> {
    return this.comments
      .filter((c) => c.userId === userId && c.entityType === entityType && c.entityId === entityId)
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  }
  async createComment(input: { userId: string; entityType: string; entityId: string; authorProfileId: string | null; message: string }): Promise<Comment> {
    const row = { id: randomUUID(), ...input, createdAt: new Date() } as Comment;
    this.comments.push(row);
    return row;
  }
  async getComment(id: string): Promise<Comment | undefined> {
    return this.comments.find((c) => c.id === id);
  }
  async deleteComment(id: string, userId: string): Promise<boolean> {
    const i = this.comments.findIndex((c) => c.id === id && c.userId === userId);
    if (i === -1) return false;
    this.comments.splice(i, 1);
    return true;
  }

  private shareTokens: FamilyShareToken[] = [];
  async listShareTokens(userId: string): Promise<FamilyShareToken[]> {
    return this.shareTokens.filter((s) => s.userId === userId);
  }
  async createShareToken(input: { userId: string; token: string; label: string | null; expiresAt: Date | null }): Promise<FamilyShareToken> {
    const row = { id: randomUUID(), ...input, revokedAt: null, lastViewedAt: null, createdAt: new Date() } as FamilyShareToken;
    this.shareTokens.push(row);
    return row;
  }
  async revokeShareToken(id: string, userId: string): Promise<boolean> {
    const row = this.shareTokens.find((s) => s.id === id && s.userId === userId);
    if (!row) return false;
    row.revokedAt = new Date();
    return true;
  }
  async getShareTokenByToken(token: string): Promise<FamilyShareToken | undefined> {
    return this.shareTokens.find((s) => s.token === token);
  }
  async touchShareToken(id: string): Promise<void> {
    const row = this.shareTokens.find((s) => s.id === id);
    if (row) row.lastViewedAt = new Date();
  }

  private allowanceSettingsArr: AllowanceSettings[] = [];
  private allowancePayoutsArr: AllowancePayout[] = [];
  async getAllowanceSettings(profileId: string): Promise<AllowanceSettings | undefined> {
    return this.allowanceSettingsArr.find((s) => s.profileId === profileId);
  }
  async upsertAllowanceSettings(input: { userId: string; profileId: string; centsPerPoint: number; currency?: string }): Promise<AllowanceSettings> {
    const existing = this.allowanceSettingsArr.find((s) => s.profileId === input.profileId);
    if (existing) {
      existing.centsPerPoint = input.centsPerPoint;
      if (input.currency) existing.currency = input.currency;
      existing.updatedAt = new Date();
      return existing;
    }
    const row = {
      id: randomUUID(),
      userId: input.userId,
      profileId: input.profileId,
      centsPerPoint: input.centsPerPoint,
      currency: input.currency ?? "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AllowanceSettings;
    this.allowanceSettingsArr.push(row);
    return row;
  }
  async listAllowancePayouts(profileId: string, limit = 50): Promise<AllowancePayout[]> {
    return this.allowancePayoutsArr
      .filter((p) => p.profileId === profileId)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, limit);
  }
  async createAllowancePayout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }): Promise<AllowancePayout> {
    const row = { id: randomUUID(), ...input, createdAt: new Date() } as AllowancePayout;
    this.allowancePayoutsArr.push(row);
    return row;
  }
  async getTotalAllowancePaidPoints(profileId: string): Promise<number> {
    return this.allowancePayoutsArr
      .filter((p) => p.profileId === profileId)
      .reduce((sum, r) => sum + (r.points || 0), 0);
  }

  // Wallet — MemStorage stubs (unused at runtime; satisfy IStorage interface).
  private rewardSettingsMap: Map<string, RewardSettings> = new Map();
  async getRewardSettings(userId: string): Promise<RewardSettings | undefined> { return this.rewardSettingsMap.get(userId); }
  async upsertRewardSettings(input: { userId: string; redemptionMode?: string; centsPerPoint?: number; currencySymbol?: string; minCashoutPoints?: number; pointsMode?: string; completionBonusPoints?: number; parentPin?: string | null; pinGatedFeatures?: string[] | null; pinResetCodeHash?: string | null; pinResetCodeExpiresAt?: Date | null }): Promise<RewardSettings> {
    const existing = this.rewardSettingsMap.get(input.userId);
    const row: RewardSettings = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      redemptionMode: input.redemptionMode ?? existing?.redemptionMode ?? "both",
      centsPerPoint: input.centsPerPoint ?? existing?.centsPerPoint ?? 0,
      currencySymbol: input.currencySymbol ?? existing?.currencySymbol ?? "$",
      minCashoutPoints: input.minCashoutPoints ?? existing?.minCashoutPoints ?? 0,
      pointsMode: input.pointsMode ?? existing?.pointsMode ?? "per_chore",
      completionBonusPoints: input.completionBonusPoints ?? existing?.completionBonusPoints ?? 10,
      parentPin: input.parentPin !== undefined ? input.parentPin : (existing?.parentPin ?? null),
      pinGatedFeatures: input.pinGatedFeatures !== undefined ? input.pinGatedFeatures : (existing?.pinGatedFeatures ?? null),
      pinResetCodeHash: input.pinResetCodeHash !== undefined ? input.pinResetCodeHash : (existing?.pinResetCodeHash ?? null),
      pinResetCodeExpiresAt: input.pinResetCodeExpiresAt !== undefined ? input.pinResetCodeExpiresAt : (existing?.pinResetCodeExpiresAt ?? null),
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.rewardSettingsMap.set(input.userId, row);
    return row;
  }

  private onboardingStatusMap: Map<string, OnboardingStatus> = new Map();
  async getOnboardingStatus(userId: string): Promise<OnboardingStatus | undefined> { return this.onboardingStatusMap.get(userId); }
  async setOnboardingStep(
    userId: string,
    step: "profile" | "location" | "rewards" | "invite" | "calendar",
    patch: { status?: "done" | "skipped" | null; dismissedUntil?: Date | null },
  ): Promise<OnboardingStatus> {
    const existing = this.onboardingStatusMap.get(userId);
    const row: OnboardingStatus = existing ?? {
      id: randomUUID(),
      userId,
      profileStatus: null, profileDismissedUntil: null,
      locationStatus: null, locationDismissedUntil: null,
      rewardsStatus: null, rewardsDismissedUntil: null,
      inviteStatus: null, inviteDismissedUntil: null,
      calendarStatus: null, calendarDismissedUntil: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    if ("status" in patch) (row as any)[`${step}Status`] = patch.status ?? null;
    if ("dismissedUntil" in patch) (row as any)[`${step}DismissedUntil`] = patch.dismissedUntil ?? null;
    row.updatedAt = new Date();
    this.onboardingStatusMap.set(userId, row);
    return row;
  }
  async getWalletSettings(_userId: string): Promise<WalletSettings | undefined> { return undefined; }
  async upsertWalletSettings(input: { userId: string; currencySymbol?: string; minCashoutCents?: number }): Promise<WalletSettings> {
    return { id: randomUUID(), userId: input.userId, currencySymbol: input.currencySymbol ?? "$", minCashoutCents: input.minCashoutCents ?? 0, createdAt: new Date(), updatedAt: new Date() } as WalletSettings;
  }
  async getOrCreateWalletBalance(userId: string, profileId: string): Promise<WalletBalance> {
    return { id: randomUUID(), userId, profileId, availableCents: 0, savingsCents: 0, updatedAt: new Date() } as WalletBalance;
  }
  async listWalletTransactions(_profileId: string, _limit?: number): Promise<WalletTransaction[]> { return []; }
  async getWalletTransaction(_id: string): Promise<WalletTransaction | undefined> { return undefined; }
  async listPendingCashouts(_userId: string): Promise<WalletTransaction[]> { return []; }
  async sumPendingCashoutCents(_profileId: string): Promise<{ cents: number; points: number }> { return { cents: 0, points: 0 }; }
  async createCashoutRequest(input: { userId: string; profileId: string; points: number; cents: number; note: string | null }): Promise<WalletTransaction> {
    return { id: randomUUID(), userId: input.userId, profileId: input.profileId, type: "cashout_requested", status: "pending", deltaCents: 0, deltaPoints: 0, requestedPoints: input.points, requestedCents: input.cents, goalId: null, note: input.note, decidedAt: null, createdAt: new Date() } as WalletTransaction;
  }
  async approveCashout(_txId: string, _userId: string): Promise<WalletTransaction | null> { return null; }
  async declineCashout(_txId: string, _userId: string): Promise<WalletTransaction | null> { return null; }
  async cashout(input: { userId: string; profileId: string; points: number; amountCents: number; note: string | null }): Promise<WalletTransaction> {
    return { id: randomUUID(), userId: input.userId, profileId: input.profileId, type: "cashout_approved", status: "done", deltaCents: input.amountCents, deltaPoints: -input.points, requestedPoints: input.points, requestedCents: input.amountCents, goalId: null, note: input.note, decidedAt: new Date(), createdAt: new Date() } as WalletTransaction;
  }
  async markPaid(_input: { userId: string; profileId: string; amountCents: number; note: string | null }): Promise<WalletTransaction | null> { return null; }
  async depositToSavings(_input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null> { return null; }
  async withdrawFromSavings(_input: { userId: string; profileId: string; amountCents: number; goalId: string | null; note: string | null }): Promise<WalletTransaction | null> { return null; }
  async listSavingsGoals(_profileId: string): Promise<SavingsGoal[]> { return []; }
  async getSavingsGoal(_id: string): Promise<SavingsGoal | undefined> { return undefined; }
  async createSavingsGoal(input: { userId: string; profileId: string; name: string; targetCents: number; photoUrl: string | null }): Promise<SavingsGoal> {
    return { id: randomUUID(), userId: input.userId, profileId: input.profileId, name: input.name, targetCents: input.targetCents, savedCents: 0, photoUrl: input.photoUrl, createdAt: new Date(), completedAt: null } as SavingsGoal;
  }
  async updateSavingsGoal(_id: string, _userId: string, _updates: { name?: string; targetCents?: number; photoUrl?: string | null }): Promise<SavingsGoal | null> { return null; }
  async deleteSavingsGoal(_id: string, _userId: string): Promise<boolean> { return false; }
  async getApprovedCashoutPoints(_profileId: string): Promise<number> { return 0; }
  async getReservedCashoutPoints(_profileId: string): Promise<number> { return 0; }

  async getChoreCompletionCount(profileId: string): Promise<number> {
    return 0;
  }

  async getCategoryCompletionCounts(profileId: string): Promise<Record<string, number>> {
    return {};
  }

  // Custom Profile Groups - stub implementations
  async getCustomProfileGroups(userId: string): Promise<CustomProfileGroup[]> {
    return [];
  }

  async getCustomProfileGroup(id: string): Promise<CustomProfileGroup | undefined> {
    return undefined;
  }

  async createCustomProfileGroup(group: InsertCustomProfileGroup): Promise<CustomProfileGroup> {
    return { ...group, id: randomUUID(), createdAt: new Date() } as CustomProfileGroup;
  }

  async updateCustomProfileGroup(id: string, group: Partial<InsertCustomProfileGroup>, userId: string): Promise<CustomProfileGroup | undefined> {
    return undefined;
  }

  async deleteCustomProfileGroup(id: string, userId: string): Promise<boolean> {
    return false;
  }

  async reorderCustomProfileGroups(userId: string, orderedIds: string[]): Promise<void> {}

  // Meals (stub)
  async getMealsByUser(_userId: string): Promise<Meal[]> { return []; }
  async getMealsByUserAndDateRange(_userId: string, _startDate: string, _endDate: string): Promise<Meal[]> { return []; }
  async getMeal(_id: string, _userId: string): Promise<Meal | undefined> { return undefined; }
  async createMeal(meal: InsertMeal): Promise<Meal> {
    return { ...meal, id: randomUUID(), createdAt: new Date(), notes: meal.notes ?? null } as Meal;
  }
  async updateMeal(_id: string, _updates: Partial<InsertMeal>, _userId: string): Promise<Meal | undefined> { return undefined; }
  async deleteMeal(_id: string, _userId: string): Promise<boolean> { return false; }
  async getIngredientsByMealIds(_mealIds: string[]): Promise<MealIngredient[]> { return []; }
  async replaceMealIngredients(_mealId: string, _ingredients: Omit<InsertMealIngredient, "mealId">[]): Promise<MealIngredient[]> { return []; }
  async getGroceryItemsByUser(_userId: string): Promise<GroceryItem[]> { return []; }
  async createGroceryItem(item: InsertGroceryItem): Promise<GroceryItem> {
    return {
      ...item,
      id: randomUUID(),
      createdAt: new Date(),
      quantity: item.quantity ?? null,
      isChecked: item.isChecked ?? false,
      sourceMealIds: (Array.isArray(item.sourceMealIds) ? item.sourceMealIds : []) as string[],
    } as GroceryItem;
  }
  async createGroceryItems(_userId: string, _items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]> { return []; }
  async updateGroceryItem(_id: string, _updates: Partial<InsertGroceryItem>, _userId: string): Promise<GroceryItem | undefined> { return undefined; }
  async deleteGroceryItem(_id: string, _userId: string): Promise<boolean> { return false; }
  async deleteCheckedGroceryItems(_userId: string): Promise<number> { return 0; }
  async replaceGroceryItemsForUser(_userId: string, _items: Omit<InsertGroceryItem, "userId">[]): Promise<GroceryItem[]> { return []; }
  async getGroceryStaplesByUser(_userId: string): Promise<GroceryStaple[]> { return []; }
  async createGroceryStaple(staple: InsertGroceryStaple): Promise<GroceryStaple> {
    return { id: randomUUID(), createdAt: new Date(), quantity: null, category: null, ...staple } as GroceryStaple;
  }
  async updateGroceryStaple(_id: string, _updates: Partial<InsertGroceryStaple>, _userId: string): Promise<GroceryStaple | undefined> { return undefined; }
  async deleteGroceryStaple(_id: string, _userId: string): Promise<boolean> { return false; }

  // Saved Meals (stub)
  async getSavedMealsByUser(_userId: string): Promise<SavedMeal[]> { return []; }
  async getSavedMeal(_id: string, _userId: string): Promise<SavedMeal | undefined> { return undefined; }
  async createSavedMeal(savedMeal: InsertSavedMeal): Promise<SavedMeal> {
    return { ...savedMeal, id: randomUUID(), createdAt: new Date(), notes: savedMeal.notes ?? null } as SavedMeal;
  }
  async updateSavedMeal(_id: string, _updates: Partial<InsertSavedMeal>, _userId: string): Promise<SavedMeal | undefined> { return undefined; }
  async deleteSavedMeal(_id: string, _userId: string): Promise<boolean> { return false; }
  async getSavedMealIngredients(_savedMealIds: string[]): Promise<SavedMealIngredient[]> { return []; }
  async replaceSavedMealIngredients(_savedMealId: string, _ingredients: Omit<InsertSavedMealIngredient, "savedMealId">[]): Promise<SavedMealIngredient[]> { return []; }

  // Celebrations (stub)
  async getCelebrationsByUser(_userId: string): Promise<Celebration[]> { return []; }
  async getCelebration(_id: string, _userId: string): Promise<Celebration | undefined> { return undefined; }
  async createCelebration(c: InsertCelebration): Promise<Celebration> {
    return { ...c, id: randomUUID(), createdAt: new Date(), year: c.year ?? null, customLabel: c.customLabel ?? null, profileId: c.profileId ?? null, notes: c.notes ?? null, type: c.type ?? "birthday" } as Celebration;
  }
  async updateCelebration(_id: string, _u: Partial<InsertCelebration>, _userId: string): Promise<Celebration | undefined> { return undefined; }
  async deleteCelebration(_id: string, _userId: string): Promise<boolean> { return false; }
  async getGiftIdeasByCelebrationIds(_ids: string[]): Promise<CelebrationGiftIdea[]> { return []; }
  async createGiftIdea(idea: InsertCelebrationGiftIdea): Promise<CelebrationGiftIdea> {
    return { ...idea, id: randomUUID(), createdAt: new Date(), isChecked: idea.isChecked ?? false, displayOrder: idea.displayOrder ?? 0 } as CelebrationGiftIdea;
  }
  async updateGiftIdea(_id: string, _u: Partial<InsertCelebrationGiftIdea>, _userId: string): Promise<CelebrationGiftIdea | undefined> { return undefined; }
  async deleteGiftIdea(_id: string, _userId: string): Promise<boolean> { return false; }
  async getPhotosByCelebrationIds(_ids: string[]): Promise<CelebrationPhoto[]> { return []; }
  async getCelebrationPhoto(_id: string, _userId: string): Promise<CelebrationPhoto | undefined> { return undefined; }
  async createCelebrationPhoto(p: InsertCelebrationPhoto): Promise<CelebrationPhoto> {
    return { ...p, id: randomUUID(), createdAt: new Date(), year: p.year ?? null, caption: p.caption ?? null } as CelebrationPhoto;
  }
  async deleteCelebrationPhoto(_id: string, _userId: string): Promise<boolean> { return false; }

  // Wishlist items (stub)
  async getWishlistItemsByUser(_userId: string, _opts?: { status?: string; submittedByProfileId?: string }): Promise<WishlistItem[]> { return []; }
  async getWishlistItem(_id: string, _userId: string): Promise<WishlistItem | undefined> { return undefined; }
  async createWishlistItem(item: InsertWishlistItem): Promise<WishlistItem> {
    return {
      ...item,
      id: randomUUID(),
      createdAt: new Date(),
      decidedAt: null,
      approvedRewardId: null,
      submittedByProfileId: item.submittedByProfileId ?? null,
      description: item.description ?? null,
      photoUrl: item.photoUrl ?? null,
      link: item.link ?? null,
      parentNote: item.parentNote ?? null,
      finalPriceCoins: item.finalPriceCoins ?? null,
      inventoryCap: item.inventoryCap ?? null,
      status: item.status ?? "pending",
      suggestedPriceCoins: item.suggestedPriceCoins,
    } as WishlistItem;
  }
  async updateWishlistItem(_id: string, _updates: Partial<WishlistItem>, _userId: string): Promise<WishlistItem | undefined> { return undefined; }
  async claimWishlistItemForApproval(_id: string, _userId: string): Promise<WishlistItem | undefined> { return undefined; }
  async deleteWishlistItem(_id: string, _userId: string): Promise<boolean> { return false; }

  // Chore wheel spin history (stub)
  async createChoreSpin(spin: InsertChoreSpin): Promise<ChoreSpin> {
    return {
      ...spin,
      id: randomUUID(),
      createdAt: new Date(),
      choreId: spin.choreId ?? null,
      winnerProfileId: spin.winnerProfileId ?? null,
      excludedRecentWinner: spin.excludedRecentWinner ?? false,
      assignedChoreId: spin.assignedChoreId ?? null,
      eligibleProfileIds: (Array.isArray(spin.eligibleProfileIds) ? spin.eligibleProfileIds : []) as string[],
    } as ChoreSpin;
  }
  async getRecentChoreSpins(_userId: string, _limit?: number): Promise<ChoreSpin[]> { return []; }
  async getChoreSpin(_id: string, _userId: string): Promise<ChoreSpin | undefined> { return undefined; }
  async setChoreSpinAssignment(_id: string, _userId: string, _assignedChoreId: string | null): Promise<ChoreSpin | undefined> { return undefined; }
  async getLastChoreWinner(_userId: string, _params: { choreId?: string | null; choreTitle?: string | null }): Promise<ChoreSpin | undefined> { return undefined; }

  // Health reminders (stub)
  async getHealthRemindersByUser(_userId: string, _opts?: { profileId?: string; includePaused?: boolean }): Promise<HealthReminder[]> { return []; }
  async getHealthReminder(_id: string, _userId: string): Promise<HealthReminder | undefined> { return undefined; }
  async createHealthReminder(reminder: InsertHealthReminder): Promise<HealthReminder> {
    return {
      ...reminder,
      id: randomUUID(),
      createdAt: new Date(),
      type: reminder.type ?? "generic",
      dose: reminder.dose ?? null,
      location: reminder.location ?? null,
      notes: reminder.notes ?? null,
      recipientsJson: (Array.isArray(reminder.recipientsJson) ? reminder.recipientsJson : []) as string[],
      snoozeMinutes: reminder.snoozeMinutes ?? 15,
      isPaused: reminder.isPaused ?? false,
      startsAt: reminder.startsAt ?? new Date(),
      endsAt: reminder.endsAt ?? null,
    } as HealthReminder;
  }
  async updateHealthReminder(_id: string, _updates: Partial<InsertHealthReminder>, _userId: string): Promise<HealthReminder | undefined> { return undefined; }
  async deleteHealthReminder(_id: string, _userId: string): Promise<boolean> { return false; }
  async getActiveHealthReminders(_now: Date): Promise<HealthReminder[]> { return []; }
  async ensureHealthReminderEvent(_input: { reminderId: string; userId: string; profileId: string; scheduledAt: Date }): Promise<{ event: HealthReminderEvent; created: boolean }> {
    return { event: { id: randomUUID(), ..._input, firedAt: null, acknowledgedAt: null, acknowledgedByProfileId: null, status: "pending", snoozeUntil: null, createdAt: new Date() } as HealthReminderEvent, created: true };
  }
  async markHealthReminderEventFired(_id: string): Promise<HealthReminderEvent | undefined> { return undefined; }
  async claimHealthReminderDispatch(_id: string, _fromStatus: "pending" | "snoozed"): Promise<boolean> { return true; }
  async releaseHealthReminderDispatch(_id: string, _fromStatus: "pending" | "snoozed"): Promise<void> {}
  async acknowledgeHealthReminderEvent(_id: string, _userId: string, _byProfileId: string | null): Promise<HealthReminderEvent | undefined> { return undefined; }
  async snoozeHealthReminderEvent(_id: string, _userId: string, _until: Date): Promise<HealthReminderEvent | undefined> { return undefined; }
  async markHealthReminderEventMissed(_id: string): Promise<HealthReminderEvent | undefined> { return undefined; }
  async getDueHealthReminderEvents(_now: Date): Promise<HealthReminderEvent[]> { return []; }
  async getHealthReminderEvents(_userId: string, _opts?: { profileId?: string; status?: string; limit?: number }): Promise<HealthReminderEvent[]> { return []; }
  async getUnacknowledgedHealthReminderEvents(_userId: string): Promise<HealthReminderEvent[]> { return []; }
  async resetUserData(_userId: string): Promise<void> { /* no-op in MemStorage */ }
  async resetUserDataCategories(_userId: string, _categories: ResetCategory[]): Promise<void> { /* no-op in MemStorage */ }
}

export const storage = new DatabaseStorage();

// Initialize default data
storage.initializeDefaultData().catch(console.error);
