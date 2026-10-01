import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// Plain `createInsertSchema` maps a `timestamp` column to a bare `z.date()`,
// which rejects the ISO string every date actually arrives as once it's gone
// through `JSON.stringify` on the wire (JSON has no Date type) — e.g. editing
// a chore's End Date, or any other nullable/optional timestamp field, always
// failed validation with a generic "Invalid ... data" 400. `coerce: { date }`
// makes these schemas parse an ISO string (or a real Date) into a Date, which
// is what every caller actually sends.
const { createInsertSchema } = createSchemaFactory({ coerce: { date: true } });

// Re-export auth schema (users and sessions tables)
export * from "./models/auth";
import { users } from "./models/auth";

// ─── Family model ────────────────────────────────────────────────────────────
// A "family" groups multiple login accounts so they share one set of data. All
// existing data stays keyed under a single owner `userId` (families.ownerUserId);
// the family tables sit ABOVE that model and map member accounts → owner.
export const families = pgTable("families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("My Family"),
  // The account whose userId owns all of this family's data rows. Every
  // member's requests resolve to this id via getUserId().
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // When the member who was covering this household's subscription leaves, the
  // family keeps access until this moment rather than being locked out
  // mid-week with no warning. Apple refunds nothing either way, so there is no
  // money at stake in softening it — see docs/subscriptions.md.
  // NULL = no grace period in effect (the normal state).
  entitlementGraceUntil: timestamp("entitlement_grace_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const familyMembers = pgTable("family_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: varchar("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // "owner" | "member"
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // A login account belongs to exactly one family at a time.
  uniqueIndex("family_members_user_uq").on(table.userId),
  index("family_members_family_idx").on(table.familyId),
]);

export const familyInvitations = pgTable("family_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  familyId: varchar("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  code: varchar("code").notNull().unique(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  // Who/what this invite is meant for — "parent" | "child" | "shared_device".
  // Purely informational today (not enforced anywhere); nullable since it's
  // new and older invites, plus manually-generated-code invites with no named
  // recipient, may never have one. Recorded now so a future "app behaves
  // differently for parents vs. non-parents" feature (explicitly deferred,
  // see CLAUDE.md) has this data available retroactively for invites sent
  // from now on, instead of needing everyone to redo it later.
  inviteeRole: text("invitee_role"),
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("family_invitations_family_idx").on(table.familyId),
]);

export const insertFamilySchema = createInsertSchema(families).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFamilyMemberSchema = createInsertSchema(familyMembers).omit({ id: true, createdAt: true });
export const insertFamilyInvitationSchema = createInsertSchema(familyInvitations).omit({ id: true, createdAt: true });

export type Family = typeof families.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type FamilyInvitation = typeof familyInvitations.$inferSelect;

export const profiles = pgTable("profiles", {
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(),
  photoUrl: text("photo_url"),
  email: text("email"),
  initials: text("initials").notNull(),
  isActive: boolean("is_active").default(true),
  isAllFamilyProfile: boolean("is_all_family_profile").default(false),
  googleCalendarConnected: boolean("google_calendar_connected").default(false),
  outlookCalendarConnected: boolean("outlook_calendar_connected").default(false),
  // True when this profile has at least one active iCal (.ics URL) subscription.
  icalConnected: boolean("ical_connected").default(false),
  // Optional bedtime cutoff used by the chore-reminder push job. Stored as
  // local "HH:MM" — interpreted in the user's timezone (location_settings).
  bedtimeCutoff: varchar("bedtime_cutoff", { length: 5 }),
  // Optional daily morning-brief send time, "HH:MM" local. NULL = off.
  dailyBriefTime: varchar("daily_brief_time", { length: 5 }),
  // Evening plan replaces the daily brief for this person. NULL = keep the brief.
  eveningPlanTime: varchar("evening_plan_time", { length: 5 }),
  eveningPlanTiming: text("evening_plan_timing").notNull().default("eveningBefore"),
  // Days of the week (0=Sun … 6=Sat) that don't count as chore days for this
  // profile's streak. Missing a skip day never breaks the streak.
  streakSkipDays: integer("streak_skip_days").array().notNull().default(sql`'{}'::integer[]`),
  // Which sections to include in this profile's daily brief. Default = all on.
  dailyBriefSections: jsonb("daily_brief_sections").$type<{
    events?: boolean;
    chores?: boolean;
    meals?: boolean;
    driving?: boolean;
    celebrations?: boolean;
  }>().default({ events: true, chores: true, meals: true, driving: true, celebrations: true }),
  // Optional weekly-recap-digest push. Time is local "HH:MM"; day is
  // 0=Sun … 6=Sat. NULL time = off (matches dailyBriefTime's null-is-off pattern).
  weeklyRecapTime: varchar("weekly_recap_time", { length: 5 }),
  weeklyRecapDay: integer("weekly_recap_day").notNull().default(0),
  // Per-person override for the per_completion daily-checklist bonus. NULL =
  // use the family-wide reward_settings.completionBonusPoints (so existing
  // families are unaffected). Lives on profiles (like bedtime/brief/recap)
  // rather than a jsonb map on reward_settings so it deletes with the profile.
  completionBonusPoints: integer("completion_bonus_points"),
  // ── Adult vs. Kid role ────────────────────────────────────────────────────
  // Who this profile is, for permissions: "adult" (full access) or "child"
  // (a kid — adult-only actions are Parent-PIN-gated when this profile is the
  // active one). Deliberately SEPARATE from the COPPA `isChild` (under-13)
  // flag below: a 14–17-year-old can be role="child" (restricted) without
  // being an under-13 COPPA child. Default "adult" so existing profiles are
  // unrestricted (no behaviour change); the kid predicate also treats any
  // legacy isChild=true profile as a kid so under-13s stay restricted without
  // a data backfill.
  role: text("role").notNull().default("adult"),
  // ── COPPA / children's data ──────────────────────────────────────────────
  // Marks a profile as an under-13 child. Setting this triggers the in-app
  // parental-consent gate before the profile can be created/used. This is the
  // legal under-13 signal ONLY — the day-to-day kid/adult role is `role` above.
  isChild: boolean("is_child").default(false),
  // Optional birth year (year only, not full birth date) per Apple's age-range
  // guidance — used only to surface age-appropriate handling.
  birthYear: integer("birth_year"),
  // Verifiable parental consent: timestamp + the account id that affirmed they
  // are the child's parent/guardian and consented to data collection (COPPA).
  parentalConsentAt: timestamp("parental_consent_at"),
  parentalConsentBy: varchar("parental_consent_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  location: text("location"),
  profileIds: jsonb("profile_ids").$type<string[]>().default([]),
  drivingProfileId: varchar("driving_profile_id").references(() => profiles.id, { onDelete: "set null" }), // DEPRECATED single-driver column. Kept and dual-written so anything still reading it keeps working; drivingProfileIds below is the source of truth.
  drivingProfileIds: jsonb("driving_profile_ids").$type<string[]>().default([]), // Profiles assigned to drive (transportation). Set, not ordered — no pickup/dropoff distinction.
  calendarId: text("calendar_id"), // Calendar assignment (profile calendar email or "family-hub")
  calendarName: text("calendar_name"), // Display name of the calendar
  isAllDay: boolean("is_all_day").default(false),
  source: text("source"), // e.g. "school", "ics", "pdf" - tag for imported events
  externalId: text("external_id"), // External UID for dedup on re-import
  createdAt: timestamp("created_at").defaultNow(),
  // Recurrence — the row itself is always the FIRST occurrence; further
  // occurrences are expanded on read (same approach chores already use for
  // recurrenceType/daysOfWeek), never materialized as separate rows. This
  // keeps creation a single INSERT and avoids needing per-occurrence
  // cleanup on edit/delete. Editing or deleting a recurring event always
  // applies to the whole series in this first pass — there's no concept of
  // "just this occurrence" yet (see CLAUDE.md for the tradeoff writeup).
  recurrenceType: text("recurrence_type"), // null | "daily" | "weekly" | "monthly" | "annually"
  recurrenceEndDate: timestamp("recurrence_end_date"), // null = repeat indefinitely (capped at render time)
  // "Repeat every N days/weeks/months/years". 1 (or null, for every row that
  // predates this column) is the old behaviour exactly.
  recurrenceInterval: integer("recurrence_interval").default(1),
  // Weekly recurrence only: which weekdays it lands on (0=Sunday), matching
  // `chores.daysOfWeek`. This is iCalendar's FREQ=WEEKLY;BYDAY — the pattern
  // Outlook and Google both use for "every Mon and Tue", and what a synced
  // event has to round-trip as. Null/empty = the start date's own weekday,
  // which is what every existing weekly event means today.
  daysOfWeek: jsonb("days_of_week").$type<number[]>(),
  // Occurrences that have been detached from the series — "this event only"
  // edits. Each entry is a LOCAL date key (YYYY-MM-DD) of an occurrence that
  // expansion must skip; the detached copy lives on as its own ordinary event
  // row. Date keys rather than timestamps so that later changing the series'
  // time of day doesn't orphan every exception.
  excludedDates: jsonb("excluded_dates").$type<string[]>(),
}, (table) => [
  index("events_source_external_idx").on(table.userId, table.source, table.externalId),
]);

export const chores = pgTable("chores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull().default("chore"), // "chore" | "todo" | "memory_verse" | "affirmation" | "bible_verse" | "mission" | "custom"
  points: integer("points").default(1),
  profileIds: jsonb("profile_ids").$type<string[]>().notNull(), // Array of profile IDs
  daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull(), // 0=Sunday, 1=Monday, etc.
  recurrenceType: text("recurrence_type").default("weekly"), // "daily", "weekly", "monthly"
  targetCount: integer("target_count"), // If set, chore is a target-count chore (any day in period)
  endDate: timestamp("end_date"), // Optional end date for the chore
  icon: text("icon"),
  category: text("category").default("general"), // cleaning, pets, kitchen, homework, laundry, outdoor, general
  isActive: boolean("is_active").default(true),
  isBonus: boolean("is_bonus").default(false),
  bonusFrequencyType: text("bonus_frequency_type").default("unlimited"), // "unlimited" | "per_period" | "total"
  bonusFrequencyCount: integer("bonus_frequency_count"), // cap N (null = unlimited)
  bonusFrequencyPeriod: text("bonus_frequency_period"), // "day" | "week" | "month" (per_period only)
  displayOrder: integer("display_order").default(0), // drag-and-drop order in the Manage Chores drawer
  // Sub-to-dos: when set, this row is one item underneath another to-do (the
  // "Packing for the trip" → individual packing items pattern). Deliberately
  // ONE level only — a row with a parent can never itself be a parent, which
  // is enforced in the API layer. Null for everything else, so every existing
  // chore/to-do is unaffected. No FK reference here on purpose: the parent is
  // always another row in this same table, and the delete path removes
  // children explicitly (see DELETE /api/chores/:id) rather than relying on
  // a cascade, so the confirmation can state how many go with it.
  parentChoreId: varchar("parent_chore_id"),
  // Completed to-dos are one-time items that stay completed forever, so they
  // pile up in this table indefinitely and were being shipped to every client
  // on every app open. Once a to-do's completion is old enough, it's marked
  // archived: still fully present (it's the points ledger's counterpart and
  // Family Activity's source — nothing is ever purged), just excluded from
  // GET /api/chores unless a caller explicitly asks for it.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const choreCompletions = pgTable("chore_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  choreId: varchar("chore_id").references(() => chores.id).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
  points: integer("points").notNull(),
});

/**
 * "Not today" for one person on one chore. Removing someone from a chore's
 * assignee list is the permanent version; this is the one-day version, so a
 * kid who's away for the evening doesn't have the chore deleted off them
 * forever. One row per (chore, profile, day) — its presence is the whole
 * meaning, so there's nothing to update, only insert and delete.
 *
 * skipDate is the family's own LOCAL midnight, sent by the client, for the
 * same reason chore completions send localDayStart: the server's day boundary
 * is not the family's.
 */
export const choreSkips = pgTable("chore_skips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  choreId: varchar("chore_id").references(() => chores.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  skipDate: timestamp("skip_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pointAdjustments = pgTable("point_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  delta: integer("delta").notNull(), // positive = add points, negative = remove
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("point_adjustments_profile_idx").on(t.profileId, t.createdAt),
]);
export type PointAdjustment = typeof pointAdjustments.$inferSelect;

export const insertPointAdjustmentSchema = createInsertSchema(pointAdjustments).omit({
  id: true,
  createdAt: true,
});
export type InsertPointAdjustment = (typeof insertPointAdjustmentSchema)['_output'];

// Daily "finished all my chores" bonus, used only when reward_settings
// pointsMode === "per_completion". Exactly one row per (profile, local day):
// created the moment a profile's full daily checklist is complete, deleted
// again if a completion is undone and the checklist drops below complete.
// `points` snapshots the bonus amount at earning time, so later changing the
// setting never rewrites already-earned days. Feeds getProfilePoints exactly
// like a chore completion does, so bonus points spend/cash-out identically.
export const completionBonuses = pgTable("completion_bonuses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  // Client's local midnight for the day this bonus is for (same absolute-UTC
  // convention the completion route already uses for its day-boundary logic),
  // so "which day" is the family's day, not the server's timezone.
  localDayStart: timestamp("local_day_start").notNull(),
  points: integer("points").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("completion_bonuses_profile_day_idx").on(t.profileId, t.localDayStart),
]);
export type CompletionBonus = typeof completionBonuses.$inferSelect;
export const insertCompletionBonusSchema = createInsertSchema(completionBonuses).omit({
  id: true,
  createdAt: true,
});
export type InsertCompletionBonus = (typeof insertCompletionBonusSchema)['_output'];

export const achievements = pgTable("achievements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  earnedAt: timestamp("earned_at").defaultNow(),
  type: text("type").notNull(), // 'milestone', 'streak', 'goal', 'category'
});

export const rewards = pgTable("rewards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  pointsCost: integer("points_cost").notNull(),
  icon: text("icon").default("🎁"),
  isActive: boolean("is_active").default(true),
  scopeProfileId: varchar("scope_profile_id").references(() => profiles.id), // null = all profiles can earn
  createdAt: timestamp("created_at").defaultNow(),
});

export const rewardRedemptions = pgTable("reward_redemptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rewardId: varchar("reward_id").references(() => rewards.id).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  status: text("status").notNull().default("available"), // 'available', 'unlocked', 'redeemed'
  unlockedAt: timestamp("unlocked_at"),
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calendarSettings = pgTable("calendar_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  startHour: integer("start_hour").default(8), // Normal day start hour (0-23)
  endHour: integer("end_hour").default(22), // Normal day end hour (0-23)
  weekStartsOn: integer("week_starts_on").default(0), // 0 = Sunday, 1 = Monday
  // When true, events created/edited/deleted in the app are mirrored to each
  // assigned profile's connected Google/Outlook calendar. Default on — most
  // families connecting a calendar expect app events to actually show up on it.
  twoWaySyncEnabled: boolean("two_way_sync_enabled").default(true),
  // One household calendar receives events the app creates. Null until an adult picks one.
  familyCalendarId: text("family_calendar_id"),
  scanInbox: boolean("scan_inbox").notNull().default(true),
  shareOriginals: boolean("share_originals").notNull().default(false),
  mutedSenders: jsonb("muted_senders").$type<string[]>().notNull().default([]),
  dismissedSlipKeys: jsonb("dismissed_slip_keys").$type<string[]>().notNull().default([]),
  planSentKeys: jsonb("plan_sent_keys").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // One row per household, enforced. user_id was nullable, non-unique and
  // carried no index at all: the writer does read-then-insert, so two
  // concurrent first saves could each find nothing and both insert, leaving
  // duplicates that every reader resolves by taking whichever came back
  // first. The unique key is also what makes an atomic upsert possible.
  uniqueIndex("calendar_settings_user_idx").on(table.userId),
]);

export const locationSettings = pgTable("location_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  city: varchar("city").notNull().default("Farmington"),
  state: varchar("state").notNull().default("Minnesota"),
  country: varchar("country").notNull().default("United States"),
  latitude: real("latitude").notNull().default(44.6402),
  longitude: real("longitude").notNull().default(-93.1468),
  timezone: varchar("timezone").notNull().default("America/Chicago"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // See calendarSettings above — same shape, same race.
  uniqueIndex("location_settings_user_idx").on(table.userId),
]);

export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  email: text("email"),
  isActive: boolean("is_active").default(true),
  // Which of the account's calendars to sync. null = sync all (default,
  // backward-compatible with connections made before this feature existed).
  // An empty array is a valid, deliberate "sync nothing" state, distinct from
  // null — so this must stay nullable rather than defaulting to [].
  selectedCalendarIds: jsonb("selected_calendar_ids").$type<string[]>(),
  // Which calendar new (app-created) events are pushed to on two-way sync.
  // null = the account's primary calendar (default, backward-compatible —
  // see GOOGLE_PRIMARY_CALENDAR in calendarSync.ts).
  writeCalendarId: text("write_calendar_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const outlookCalendarTokens = pgTable("outlook_calendar_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  email: text("email"),
  isActive: boolean("is_active").default(true),
  // Same semantics as googleCalendarTokens.selectedCalendarIds above.
  selectedCalendarIds: jsonb("selected_calendar_ids").$type<string[]>(),
  // null = the account's default calendar (backward-compatible — see
  // OUTLOOK_DEFAULT_CALENDAR in calendarSync.ts).
  writeCalendarId: text("write_calendar_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Read-only iCal (.ics URL) subscriptions. Unlike Google/Outlook (OAuth, multi-
// calendar discovery, two-way sync), an .ics feed is a single calendar identified
// by its URL and assigned to one profile. Events are fetched + parsed server-side;
// there is no write-back. One row = one feed.
export const icalSubscriptions = pgTable("ical_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  feedUrl: text("feed_url").notNull(),
  calendarName: text("calendar_name").notNull(),
  calendarColor: text("calendar_color"),
  lastFetchedAt: timestamp("last_fetched_at"),
  lastError: text("last_error"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("ical_subscriptions_profile_idx").on(table.profileId),
]);

export const insertIcalSubscriptionSchema = createInsertSchema(icalSubscriptions).omit({
  id: true,
  lastFetchedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
});
export type IcalSubscription = typeof icalSubscriptions.$inferSelect;
export type InsertIcalSubscription = (typeof insertIcalSubscriptionSchema)['_output'];

// ─── BratBusters Behaviour Board ───────────────────────────────────────────
// Implements Lisa Bunnage's "calm leadership" Behaviour Board: each family
// member has a rule and two consequences (a positive "good deed" first, then a
// negative deprivation if not done in time), plus one family motto. Incidents
// drive the live two-step timer process and double as a history log.

// One row per family (keyed on owner userId) — the motto + default timer.
export const behaviourBoardSettings = pgTable("behaviour_board_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  familyMotto: text("family_motto").default("We respect everybody."),
  // Custom text for the small description line under the "Behavior Board"
  // heading. Null = show the app's default copy (see boardSubtitle fallback
  // in behaviour-board-view.tsx), same pattern as familyMotto above.
  boardSubtitle: text("board_subtitle"),
  defaultTimerMinutes: integer("default_timer_minutes").default(15),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("behaviour_board_settings_user_uq").on(table.userId),
]);

export const insertBehaviourBoardSettingsSchema = createInsertSchema(behaviourBoardSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BehaviourBoardSettings = typeof behaviourBoardSettings.$inferSelect;
export type InsertBehaviourBoardSettings = (typeof insertBehaviourBoardSettingsSchema)['_output'];

// A rule (and its two consequences) for one family member. Rules must be
// observable/specific; the two consequences are the positive "good deed" and the
// negative deprivation. timerMinutes is how long they get to do the good deed.
export const behaviourRules = pgTable("behaviour_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  // The primary/first profile this rule applies to (kept for backward compatibility
  // and as the FK target). For multi-person rules, profileIds holds the full list.
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  // All profiles this rule applies to (multi-select). Falls back to [profileId]
  // for rules created before this column existed.
  profileIds: text("profile_ids").array(),
  ruleText: text("rule_text").notNull(),
  positiveConsequence: text("positive_consequence").notNull(),
  negativeConsequence: text("negative_consequence").notNull(),
  timerMinutes: integer("timer_minutes").default(15),
  displayOrder: integer("display_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("behaviour_rules_user_idx").on(table.userId),
  index("behaviour_rules_profile_idx").on(table.profileId),
]);

export const insertBehaviourRuleSchema = createInsertSchema(behaviourRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BehaviourRule = typeof behaviourRules.$inferSelect;
export type InsertBehaviourRule = (typeof insertBehaviourRuleSchema)['_output'];

// A single rule-break event and its resolution. Consequence text is snapshotted
// so history stays accurate even if the rule is later edited/deleted.
export const behaviourIncidents = pgTable("behaviour_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  ruleId: varchar("rule_id").references(() => behaviourRules.id, { onDelete: "set null" }),
  ruleText: text("rule_text").notNull(),
  positiveConsequence: text("positive_consequence").notNull(),
  negativeConsequence: text("negative_consequence").notNull(),
  timerMinutes: integer("timer_minutes").notNull().default(15),
  // "positive_pending" | "resolved_positive" | "negative_applied"
  status: text("status").notNull().default("positive_pending"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  timerEndsAt: timestamp("timer_ends_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  note: text("note"),
  // Dedup markers so the behaviour-timer scheduler tick (runs every 60s)
  // fires the "5 minutes left" and "time's up" pushes exactly once each,
  // rather than re-sending on every tick while the condition still holds.
  reminderFiredAt: timestamp("reminder_fired_at"),
  timerExpiredPushFiredAt: timestamp("timer_expired_push_fired_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("behaviour_incidents_user_idx").on(table.userId),
  index("behaviour_incidents_profile_idx").on(table.profileId),
  index("behaviour_incidents_status_idx").on(table.userId, table.status),
]);

export const insertBehaviourIncidentSchema = createInsertSchema(behaviourIncidents).omit({
  id: true,
  createdAt: true,
});
export type BehaviourIncident = typeof behaviourIncidents.$inferSelect;
export type InsertBehaviourIncident = (typeof insertBehaviourIncidentSchema)['_output'];

export const calendarAssignments = pgTable("calendar_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => profiles.id).notNull(),
  calendarType: text("calendar_type").notNull(), // "google" or "outlook"
  calendarId: text("calendar_id").notNull(), // The calendar ID from the provider
  calendarName: text("calendar_name").notNull(), // Display name of the calendar
  calendarColor: text("calendar_color"), // Color from the calendar provider
  emailAddress: text("email_address").notNull(), // Email address associated with the calendar
  isActive: boolean("is_active").default(true),
  // Everyone this calendar is for. The row itself stays one calendar id.
  audienceProfileIds: jsonb("audience_profile_ids").$type<string[]>().notNull().default([]),
  watched: boolean("watched").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Named "unique" since it was written but declared as a plain index, so it
  // enforced nothing — a concurrent double-save could leave two active rows
  // for the same calendar and profile, and every reader takes whichever comes
  // back first. Now actually unique.
  uniqueIndex("calendar_assignments_unique_idx").on(table.calendarType, table.calendarId, table.profileId)
]);

// Stores per-event profile assignments in the database, so they work even for
// read-only calendars (imported Outlook feeds, shared calendars without write access).
// Overrides any familyhub_profile_ids stored on the Google event itself.
export const googleCalendarEventAssignments = pgTable("google_calendar_event_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  calendarId: text("calendar_id").notNull(),
  eventId: text("event_id").notNull(),
  profileIds: jsonb("profile_ids").$type<string[]>().notNull(),
  drivingProfileId: varchar("driving_profile_id").references(() => profiles.id, { onDelete: "set null" }), // DEPRECATED — see events.drivingProfileId
  drivingProfileIds: jsonb("driving_profile_ids").$type<string[]>().default([]),
  // When set, this row is a SERIES assignment: eventId holds the recurring event's
  // id (recurringEventId) and the assignment applies to every occurrence whose
  // start is >= seriesFromDate ("this and following"). When null, the row is a
  // single-occurrence assignment whose eventId matches one expanded instance id.
  seriesFromDate: timestamp("series_from_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // ⚠️ userId is part of the key, deliberately. Keyed on (calendarId,
  // eventId) alone, two families connected to the SAME shared Google calendar
  // collided on the same row: setGoogleEventAssignment's upsert also reassigned
  // userId, so the second family's save silently took over the first family's
  // assignment and replaced its assignees. Calendar and event ids are not
  // private — a school or holidays calendar is meant to be shared.
  uniqueIndex("gc_event_assign_user_calendar_event_idx").on(table.userId, table.calendarId, table.eventId)
]);

// Links a local app event to the external calendar copies it was pushed to.
// One row per (event, profile, provider): an event assigned to N people who each
// have a connected calendar produces N rows. Drives edit/delete mirroring and
// read-time dedup so an app-created event never displays twice.
export const eventCalendarSyncs = pgTable("event_calendar_syncs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").references(() => events.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(), // "google" | "outlook"
  externalEventId: text("external_event_id").notNull(),
  externalCalendarId: text("external_calendar_id").notNull(),
  syncState: text("sync_state").notNull().default("synced"), // "synced" | "error"
  lastError: text("last_error"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("event_calendar_syncs_event_idx").on(t.eventId),
  index("event_calendar_syncs_user_provider_idx").on(t.userId, t.provider),
  uniqueIndex("event_calendar_syncs_unique_idx").on(t.eventId, t.profileId, t.provider),
]);

export const insertEventCalendarSyncSchema = createInsertSchema(eventCalendarSyncs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type EventCalendarSync = typeof eventCalendarSyncs.$inferSelect;
export type InsertEventCalendarSync = (typeof insertEventCalendarSyncSchema)['_output'];

export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
});

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

export const insertChoreSchema = createInsertSchema(chores).omit({
  id: true,
  createdAt: true,
});

export const insertChoreCompletionSchema = createInsertSchema(choreCompletions).omit({
  id: true,
});

export const insertChoreSkipSchema = createInsertSchema(choreSkips).omit({
  id: true,
  createdAt: true,
});

export const insertAchievementSchema = createInsertSchema(achievements).omit({
  id: true,
  earnedAt: true,
});

export const insertRewardSchema = createInsertSchema(rewards).omit({
  id: true,
  createdAt: true,
});

export const insertRewardRedemptionSchema = createInsertSchema(rewardRedemptions).omit({
  id: true,
  createdAt: true,
});

export const insertCalendarSettingsSchema = createInsertSchema(calendarSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// country/timezone/latitude/longitude are all NOT NULL with a real DB
// default (see the table above) specifically so a caller that only knows
// city/state can still save — but createInsertSchema still required them
// in this generated Zod schema regardless of that default, so BOTH real
// callers (Settings' Location form, onboarding's Location step) always
// crashed on save: neither ever collects country, and neither computes a
// real timezone. Explicitly optional here fixes both without either
// caller needing to change what it sends.
export const insertLocationSettingsSchema = createInsertSchema(locationSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  country: true,
  timezone: true,
  latitude: true,
  longitude: true,
});

export const insertGoogleCalendarTokensSchema = createInsertSchema(googleCalendarTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOutlookCalendarTokensSchema = createInsertSchema(outlookCalendarTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCalendarAssignmentSchema = createInsertSchema(calendarAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGoogleCalendarEventAssignmentSchema = createInsertSchema(googleCalendarEventAssignments).omit({
  id: true,
  updatedAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = (typeof insertProfileSchema)['_output'];
export type Event = typeof events.$inferSelect;
export type InsertEvent = (typeof insertEventSchema)['_output'];
export type Chore = typeof chores.$inferSelect;
export type InsertChore = (typeof insertChoreSchema)['_output'];
export type ChoreCompletion = typeof choreCompletions.$inferSelect;
export type InsertChoreCompletion = (typeof insertChoreCompletionSchema)['_output'];
export type ChoreSkip = typeof choreSkips.$inferSelect;
export type InsertChoreSkip = (typeof insertChoreSkipSchema)['_output'];
export type Achievement = typeof achievements.$inferSelect;
export type InsertAchievement = (typeof insertAchievementSchema)['_output'];
export type Reward = typeof rewards.$inferSelect;
export type InsertReward = (typeof insertRewardSchema)['_output'];
export type RewardRedemption = typeof rewardRedemptions.$inferSelect;
export type InsertRewardRedemption = (typeof insertRewardRedemptionSchema)['_output'];
export type CalendarSettings = typeof calendarSettings.$inferSelect;
export type InsertCalendarSettings = (typeof insertCalendarSettingsSchema)['_output'];

export type LocationSettings = typeof locationSettings.$inferSelect;
export type InsertLocationSettings = (typeof insertLocationSettingsSchema)['_output'];
export type GoogleCalendarTokens = typeof googleCalendarTokens.$inferSelect;
export type InsertGoogleCalendarTokens = (typeof insertGoogleCalendarTokensSchema)['_output'];
export type OutlookCalendarTokens = typeof outlookCalendarTokens.$inferSelect;
export type InsertOutlookCalendarTokens = (typeof insertOutlookCalendarTokensSchema)['_output'];
export type CalendarAssignment = typeof calendarAssignments.$inferSelect;
export type InsertCalendarAssignment = (typeof insertCalendarAssignmentSchema)['_output'];
export type GoogleCalendarEventAssignment = typeof googleCalendarEventAssignments.$inferSelect;
export type InsertGoogleCalendarEventAssignment = (typeof insertGoogleCalendarEventAssignmentSchema)['_output'];

export const dailyContent = pgTable("daily_content", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'mission', 'affirmation', 'bible_verse', 'memory_verse', 'custom'
  title: text("title").notNull(),
  content: text("content").notNull(),
  reference: text("reference"), // For bible verses, memory verses, etc.
  isActive: boolean("is_active").default(true),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const dailyContentAssignments = pgTable("daily_content_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contentId: varchar("content_id").notNull().references(() => dailyContent.id, { onDelete: "cascade" }),
  profileId: varchar("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailyContentCompletions = pgTable("daily_content_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contentId: varchar("content_id").notNull().references(() => dailyContent.id, { onDelete: "cascade" }),
  profileId: varchar("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at").defaultNow(),
}, (table) => [
  // Unique constraint to prevent duplicate completions for same content+profile on same day
  index("daily_content_completions_unique_idx").on(table.contentId, table.profileId, table.completedAt)
]);

export const insertDailyContentSchema = createInsertSchema(dailyContent).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDailyContentAssignmentSchema = createInsertSchema(dailyContentAssignments).omit({
  id: true,
  createdAt: true,
});

export const insertDailyContentCompletionSchema = createInsertSchema(dailyContentCompletions).omit({
  id: true,
  completedAt: true,
});

export type DailyContent = typeof dailyContent.$inferSelect;
export type InsertDailyContent = (typeof insertDailyContentSchema)['_output'];
export type DailyContentAssignment = typeof dailyContentAssignments.$inferSelect;
export type InsertDailyContentAssignment = (typeof insertDailyContentAssignmentSchema)['_output'];
export type DailyContentCompletion = typeof dailyContentCompletions.$inferSelect;
export type InsertDailyContentCompletion = (typeof insertDailyContentCompletionSchema)['_output'];

// Custom profile groups (e.g., "Adults", "Kids")
export const customProfileGroups = pgTable("custom_profile_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  profileIds: jsonb("profile_ids").$type<string[]>().notNull(),
  color: text("color").default("#6366f1"),
  icon: text("icon").default("👥"),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomProfileGroupSchema = createInsertSchema(customProfileGroups).omit({
  id: true,
  createdAt: true,
});

export type CustomProfileGroup = typeof customProfileGroups.$inferSelect;
export type InsertCustomProfileGroup = (typeof insertCustomProfileGroupSchema)['_output'];

// Meal planning
export const meals = pgTable("meals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  date: text("date").notNull(), // ISO date 'YYYY-MM-DD'
  slot: text("slot").notNull(), // 'breakfast' | 'lunch' | 'dinner'
  name: text("name").notNull(),
  notes: text("notes"),
  // Both optional and independent of each other — a meal can link to a
  // recipe found online, have its own free-typed steps, both, or neither.
  recipeUrl: text("recipe_url"),
  directions: text("directions"),
  // Website attribution, carried over from the saved idea this meal was
  // created from (see the same columns on `saved_meals`) so the credit line
  // survives dragging an imported recipe onto the calendar.
  sourceName: text("source_name"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("meals_user_date_idx").on(table.userId, table.date),
]);

export const mealIngredients = pgTable("meal_ingredients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mealId: varchar("meal_id").references(() => meals.id, { onDelete: "cascade" }).notNull(),
  quantity: text("quantity"),
  item: text("item").notNull(),
  displayOrder: integer("display_order").default(0),
});

export const groceryItems = pgTable("grocery_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  quantity: text("quantity"),
  isChecked: boolean("is_checked").default(false),
  sourceMealIds: jsonb("source_meal_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  // Manual aisle override — null means "use the client's keyword-based guess."
  category: text("category"),
});

// A family's recurring "always want this on the list" items (milk, eggs,
// etc.) — separate from grocery_items so clearing/regenerating the weekly
// list (which deletes all grocery_items rows) never touches these
// definitions. Adding a staple to the active list just creates/updates a
// normal grocery_items row from it.
export const groceryStaples = pgTable("grocery_staples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  quantity: text("quantity"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMealSchema = z.object({
  userId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  slot: z.enum(["breakfast", "lunch", "dinner"]),
  name: z.string(),
  notes: z.string().optional().nullable(),
  recipeUrl: z.string().url().max(2048).optional().nullable(),
  directions: z.string().max(10000).optional().nullable(),
  sourceName: z.string().max(200).optional().nullable(),
  importedAt: z.coerce.date().optional().nullable(),
});

export const insertMealIngredientSchema = createInsertSchema(mealIngredients).omit({
  id: true,
});

export const insertGroceryItemSchema = createInsertSchema(groceryItems).omit({
  id: true,
  createdAt: true,
});

export const insertGroceryStapleSchema = createInsertSchema(groceryStaples).omit({
  id: true,
  createdAt: true,
});

export type Meal = typeof meals.$inferSelect;
export type InsertMeal = (typeof insertMealSchema)['_output'];
export type MealIngredient = typeof mealIngredients.$inferSelect;
export type InsertMealIngredient = (typeof insertMealIngredientSchema)['_output'];
export type GroceryItem = typeof groceryItems.$inferSelect;
export type InsertGroceryItem = (typeof insertGroceryItemSchema)['_output'];
export type GroceryStaple = typeof groceryStaples.$inferSelect;
export type InsertGroceryStaple = (typeof insertGroceryStapleSchema)['_output'];

// Saved meal ideas — a reusable repository of meals the family likes. These are
// date-less templates; dragging one onto a day creates a real dated `meal` from it.
export const savedMeals = pgTable("saved_meals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  // Both optional and independent — see the identical columns on `meals`.
  // Carried over automatically whenever a planned meal is saved as an idea
  // (and vice versa, when an idea is dragged onto the calendar).
  recipeUrl: text("recipe_url"),
  directions: text("directions"),
  // Attribution for a recipe pulled in from a website. `sourceName` is the
  // site's own og:site_name (or a tidied hostname); `importedAt` is when we
  // fetched it, since a site can change its recipe after import. Both null
  // for a hand-typed recipe — their presence is what drives the credit line.
  sourceName: text("source_name"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("saved_meals_user_idx").on(table.userId),
]);

export const savedMealIngredients = pgTable("saved_meal_ingredients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  savedMealId: varchar("saved_meal_id").references(() => savedMeals.id, { onDelete: "cascade" }).notNull(),
  quantity: text("quantity"),
  item: text("item").notNull(),
  displayOrder: integer("display_order").default(0),
});

export const insertSavedMealSchema = z.object({
  userId: z.string(),
  name: z.string(),
  notes: z.string().optional().nullable(),
  recipeUrl: z.string().url().max(2048).optional().nullable(),
  directions: z.string().max(10000).optional().nullable(),
  sourceName: z.string().max(200).optional().nullable(),
  importedAt: z.coerce.date().optional().nullable(),
});

export const insertSavedMealIngredientSchema = createInsertSchema(savedMealIngredients).omit({
  id: true,
});

export type SavedMeal = typeof savedMeals.$inferSelect;
export type InsertSavedMeal = (typeof insertSavedMealSchema)['_output'];
export type SavedMealIngredient = typeof savedMealIngredients.$inferSelect;
export type InsertSavedMealIngredient = (typeof insertSavedMealIngredientSchema)['_output'];

// ===== Birthday & anniversary tracker (Celebrations) =====
export const celebrations = pgTable("celebrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  monthDay: text("month_day").notNull(), // "MM-DD"
  year: integer("year"), // optional birth/start year
  type: text("type").notNull().default("birthday"), // 'birthday' | 'anniversary' | 'other'
  customLabel: text("custom_label"), // Optional label shown when type='other' (e.g. "Pet adoption day")
  // profileId (single) is kept for backward compat with rows created before
  // multi-profile linking existed; profileIds is the source of truth going
  // forward (null means "not set yet" for an old row — code should fall back
  // to [profileId] in that case). Saves always keep profileId in sync with
  // profileIds[0] so anything still reading the old singular field works.
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  profileIds: jsonb("profile_ids").$type<string[]>(),
  notes: text("notes"),
  showYear: boolean("show_year").default(true), // whether to display age/anniversary number on cards
  createdAt: timestamp("created_at").defaultNow(),
  // Which year each milestone reminder was last sent for — recurs every year
  // without needing cleanup, since a new year naturally re-arms both fields.
  reminder30SentYear: integer("reminder_30_sent_year"),
  reminder7SentYear: integer("reminder_7_sent_year"),
}, (table) => [
  index("celebrations_user_idx").on(table.userId),
]);

export const celebrationGiftIdeas = pgTable("celebration_gift_ideas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  celebrationId: varchar("celebration_id").references(() => celebrations.id, { onDelete: "cascade" }).notNull(),
  text: text("text").notNull(),
  isChecked: boolean("is_checked").default(false),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const celebrationPhotos = pgTable("celebration_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  celebrationId: varchar("celebration_id").references(() => celebrations.id, { onDelete: "cascade" }).notNull(),
  imageUrl: text("image_url").notNull(),
  year: integer("year"),
  caption: text("caption"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCelebrationSchema = z.object({
  userId: z.string(),
  name: z.string(),
  monthDay: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, "monthDay must be MM-DD"),
  year: z.number().int().optional().nullable(),
  type: z.enum(["birthday", "anniversary", "other"]).default("birthday"),
  customLabel: z.string().optional().nullable(),
  profileId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  showYear: z.boolean().optional().nullable(),
});

export const insertCelebrationGiftIdeaSchema = createInsertSchema(celebrationGiftIdeas).omit({
  id: true,
  createdAt: true,
});

export const insertCelebrationPhotoSchema = createInsertSchema(celebrationPhotos).omit({
  id: true,
  createdAt: true,
});

export type Celebration = typeof celebrations.$inferSelect;
export type InsertCelebration = (typeof insertCelebrationSchema)['_output'];
export type CelebrationGiftIdea = typeof celebrationGiftIdeas.$inferSelect;
export type InsertCelebrationGiftIdea = (typeof insertCelebrationGiftIdeaSchema)['_output'];
export type CelebrationPhoto = typeof celebrationPhotos.$inferSelect;
export type InsertCelebrationPhoto = (typeof insertCelebrationPhotoSchema)['_output'];

// ===== Chore wheel spin history =====
export const choreSpins = pgTable("chore_spins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  choreTitle: text("chore_title").notNull(),
  choreId: varchar("chore_id").references(() => chores.id, { onDelete: "set null" }),
  eligibleProfileIds: jsonb("eligible_profile_ids").$type<string[]>().notNull(),
  winnerProfileId: varchar("winner_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  excludedRecentWinner: boolean("excluded_recent_winner").default(false),
  assignedChoreId: varchar("assigned_chore_id").references(() => chores.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("chore_spins_user_idx").on(table.userId, table.createdAt),
]);

export const insertChoreSpinSchema = createInsertSchema(choreSpins).omit({
  id: true,
  createdAt: true,
});

export type ChoreSpin = typeof choreSpins.$inferSelect;
export type InsertChoreSpin = (typeof insertChoreSpinSchema)['_output'];

// ===== Wishlist for reward ideas =====
export const wishlistItems = pgTable("wishlist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  submittedByProfileId: varchar("submitted_by_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  photoUrl: text("photo_url"),
  link: text("link"),
  suggestedPriceCoins: integer("suggested_price_coins").notNull().default(50),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'declined' | 'archived'
  parentNote: text("parent_note"),
  finalPriceCoins: integer("final_price_coins"),
  inventoryCap: integer("inventory_cap"),
  approvedRewardId: varchar("approved_reward_id").references(() => rewards.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
}, (table) => [
  index("wishlist_items_user_status_idx").on(table.userId, table.status),
]);

export const insertWishlistItemSchema = createInsertSchema(wishlistItems).omit({
  id: true,
  createdAt: true,
  decidedAt: true,
  approvedRewardId: true,
});

export type WishlistItem = typeof wishlistItems.$inferSelect;
export type InsertWishlistItem = (typeof insertWishlistItemSchema)['_output'];

// ===== Push Notifications =====

// Per-device Web Push subscriptions. One row per browser/device a user has
// opted in on. Pruned on 404/410 from the push service.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  // Optional — when set, pushes targeted at a specific profile only fan out
  // to subscriptions associated with that profile. NULL means "all family".
  profileId: varchar("profile_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  label: text("label"), // user-friendly device label
  // Per-device opt-out for newer, less-essential notification categories
  // (reward redeemed, chore assigned, etc.) — missing/undefined key = still
  // enabled (opt-out model), so existing devices default to "on" for new
  // categories added after they registered. Core/older notification types
  // (bedtime, daily brief, health reminders) aren't gated by this — those
  // already have their own dedicated enable/disable controls.
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean | undefined>>(),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
}, (table) => [
  index("push_subs_user_idx").on(table.userId),
  index("push_subs_profile_idx").on(table.profileId),
]);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
});
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = (typeof insertPushSubscriptionSchema)['_output'];

// Per-device APNs tokens for the native iOS app (Capacitor). Web Push above and
// these native tokens are separate delivery paths: browsers use VAPID/web-push,
// the iOS app uses APNs with a token-based p8 auth key. One row per device that
// opted in. Pruned when APNs reports the token is invalid/unregistered.
export const nativePushTokens = pgTable("native_push_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  // Optional profile scoping, mirroring pushSubscriptions: NULL = whole family.
  profileId: varchar("profile_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  // The APNs device token (hex string). Unique so re-registration upserts.
  token: text("token").notNull().unique(),
  // "ios" today; kept generic in case Android/FCM is added later.
  platform: text("platform").notNull().default("ios"),
  label: text("label"), // user-friendly device label
  // Same semantics as pushSubscriptions.notificationPrefs above.
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean | undefined>>(),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
}, (table) => [
  index("native_push_user_idx").on(table.userId),
  index("native_push_profile_idx").on(table.profileId),
]);

export const insertNativePushTokenSchema = createInsertSchema(nativePushTokens).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
});
export type NativePushTokenRow = typeof nativePushTokens.$inferSelect;
export type InsertNativePushToken = (typeof insertNativePushTokenSchema)['_output'];

// Singleton row holding the server-generated VAPID keypair. Generated on
// first server boot if missing so that no manual env-var dance is required.
export const pushVapidKeys = pgTable("push_vapid_keys", {
  id: varchar("id").primaryKey().default("singleton"),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject").notNull().default("mailto:admin@example.com"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type PushVapidKeys = typeof pushVapidKeys.$inferSelect;

// ===== Health Reminders =====
//
// Per-profile health reminder definitions (medication, appointment, refill,
// generic). Each definition expands into many `health_reminder_events` rows
// over time — one per scheduled occurrence — for acknowledgement / history.
export const healthReminders = pgTable("health_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  profileId: varchar("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  // "medication" | "appointment" | "refill" | "generic"
  type: text("type").notNull().default("generic"),
  title: text("title").notNull(),
  dose: text("dose"),
  location: text("location"),
  notes: text("notes"),
  // Schedule shape:
  //   { kind: "once", at: ISO string }
  //   { kind: "daily", time: "HH:MM" }
  //   { kind: "weekly", time: "HH:MM", days: number[] (0=Sun .. 6=Sat) }
  //   { kind: "monthly", time: "HH:MM", dayOfMonth: number (1..31) }
  // All times are interpreted in the user's timezone (location_settings).
  scheduleJson: jsonb("schedule_json").$type<HealthSchedule>().notNull(),
  // Profile IDs to push to when the reminder fires. Typically the profile
  // itself and/or one or more parent profiles. Empty list falls back to the
  // owning profile.
  recipientsJson: jsonb("recipients_json").$type<string[]>().notNull().default([]),
  snoozeMinutes: integer("snooze_minutes").notNull().default(15),
  isPaused: boolean("is_paused").notNull().default(false),
  startsAt: timestamp("starts_at").notNull().defaultNow(),
  endsAt: timestamp("ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("health_reminders_user_idx").on(table.userId),
  index("health_reminders_profile_idx").on(table.profileId),
]);

export type HealthScheduleOnce = { kind: "once"; at: string };
export type HealthScheduleDaily = { kind: "daily"; time: string };
export type HealthScheduleWeekly = { kind: "weekly"; time: string; days: number[] };
export type HealthScheduleMonthly = { kind: "monthly"; time: string; dayOfMonth: number };
export type HealthSchedule =
  | HealthScheduleOnce
  | HealthScheduleDaily
  | HealthScheduleWeekly
  | HealthScheduleMonthly;

// One row per scheduled occurrence. Created idempotently by the dispatcher
// (unique on reminderId + scheduledAt) when the firing window opens.
export const healthReminderEvents = pgTable("health_reminder_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reminderId: varchar("reminder_id")
    .references(() => healthReminders.id, { onDelete: "cascade" })
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  profileId: varchar("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  firedAt: timestamp("fired_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByProfileId: varchar("acknowledged_by_profile_id").references(
    () => profiles.id,
    { onDelete: "set null" },
  ),
  // "pending" | "fired" | "acknowledged" | "missed" | "snoozed"
  status: text("status").notNull().default("pending"),
  snoozeUntil: timestamp("snooze_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("health_events_reminder_scheduled_uq").on(table.reminderId, table.scheduledAt),
  index("health_events_user_status_idx").on(table.userId, table.status),
  index("health_events_profile_idx").on(table.profileId),
]);

// Route layer validates scheduleJson / recipientsJson shape with its own zod
// schemas; here we only need a row-shape for inserts.
export const insertHealthReminderSchema = createInsertSchema(healthReminders).omit({
  id: true,
  createdAt: true,
});
export type HealthReminder = typeof healthReminders.$inferSelect;
export type InsertHealthReminder = (typeof insertHealthReminderSchema)['_output'];
export type HealthReminderEvent = typeof healthReminderEvents.$inferSelect;

// Streak freezes — at most one per profile per ISO week. When a freeze row
// exists for a date, the streak calculator treats that date as if a chore
// had been completed (bridging a single-day gap).
export const streakFreezes = pgTable("streak_freezes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  weekKey: text("week_key").notNull(), // yyyy-mm-dd of the week's Sunday
  usedForDate: text("used_for_date").notNull(), // yyyy-mm-dd of the bridged day
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("streak_freezes_profile_week_uq").on(t.profileId, t.weekKey),
  index("streak_freezes_profile_idx").on(t.profileId),
]);

export const insertStreakFreezeSchema = createInsertSchema(streakFreezes).omit({
  id: true,
  createdAt: true,
});
export type StreakFreeze = typeof streakFreezes.$inferSelect;
export type InsertStreakFreeze = (typeof insertStreakFreezeSchema)['_output'];

// Family shoutouts — quick praise/kudos sent from one profile to another in
// the same family. Surfaces in a "Recent shoutouts" home card and pushes a
// notification to the recipient profile's devices.
export const shoutouts = pgTable("shoutouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  fromProfileId: varchar("from_profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  toProfileId: varchar("to_profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  emoji: text("emoji").notNull().default("👏"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  seenAt: timestamp("seen_at"),
}, (t) => [
  index("shoutouts_user_created_idx").on(t.userId, t.createdAt),
  index("shoutouts_to_profile_idx").on(t.toProfileId),
]);

export const insertShoutoutSchema = createInsertSchema(shoutouts).omit({
  id: true,
  createdAt: true,
  seenAt: true,
});
export type Shoutout = typeof shoutouts.$inferSelect;
export type InsertShoutout = (typeof insertShoutoutSchema)['_output'];

// Polymorphic comments — short notes attached to a chore or event.
// entityType is one of: "chore" | "event".
export const comments = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  authorProfileId: varchar("author_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("comments_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  index("comments_user_idx").on(t.userId),
]);

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  createdAt: true,
});
export type Comment = typeof comments.$inferSelect;
export type InsertComment = (typeof insertCommentSchema)['_output'];

// Public read-only share tokens (e.g. for grandparents).
export const familyShareTokens = pgTable("family_share_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token").notNull().unique(),
  label: text("label"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  lastViewedAt: timestamp("last_viewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("family_share_tokens_user_idx").on(t.userId),
]);
export type FamilyShareToken = typeof familyShareTokens.$inferSelect;

// Allowance — convert chore points to a cash payout (manual cash-out).
export const allowanceSettings = pgTable("allowance_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull().unique(),
  centsPerPoint: integer("cents_per_point").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("allowance_settings_user_idx").on(t.userId),
]);
export type AllowanceSettings = typeof allowanceSettings.$inferSelect;

export const allowancePayouts = pgTable("allowance_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  points: integer("points").notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("allowance_payouts_profile_idx").on(t.profileId, t.createdAt),
]);
export type AllowancePayout = typeof allowancePayouts.$inferSelect;

// ── Wallet ─────────────────────────────────────────────────────────────
// Family-level wallet settings (one row per user).
export const walletSettings = pgTable("wallet_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  currencySymbol: text("currency_symbol").notNull().default("$"),
  minCashoutCents: integer("min_cashout_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type WalletSettings = typeof walletSettings.$inferSelect;

// ── Reward Settings (unified, replaces scattered allowanceSettings/walletSettings) ──
// One row per user. Created on first access; defaults to "both" mode.
export const rewardSettings = pgTable("reward_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  redemptionMode: text("redemption_mode").notNull().default("both"),
  centsPerPoint: integer("cents_per_point").notNull().default(0),
  currencySymbol: text("currency_symbol").notNull().default("$"),
  minCashoutPoints: integer("min_cashout_points").notNull().default(0),
  // How points are earned (family-wide). "per_chore" (default, original
  // behavior): each completed chore awards its own points. "per_completion":
  // individual required chores award nothing on their own — finishing the
  // whole daily checklist awards a flat `completionBonusPoints` instead
  // (rewards finishing everything, not each individual task). Bonus chores
  // and to-dos keep their own points in BOTH modes — only regular scheduled
  // "checklist" chores change.
  pointsMode: text("points_mode").notNull().default("per_chore"),
  completionBonusPoints: integer("completion_bonus_points").notNull().default(10),
  parentPin: text("parent_pin"),
  // Which parent-only actions require the Parent PIN when the currently
  // selected profile is a child (profiles.isChild) — parent-configurable via
  // Settings. Cash-out/reward-request approval is NOT in this list because
  // it's always PIN-gated unconditionally, never optional. `null` = the
  // sensible default set (see PIN_GATE_DEFAULT_FEATURES in the frontend),
  // not "nothing gated" — preserves the stricter default for anyone who
  // hasn't visited this new setting yet.
  pinGatedFeatures: jsonb("pin_gated_features").$type<string[]>(),
  // "Forgot PIN" recovery: a one-time code emailed to the account's own
  // login address, entered here to prove it's actually the parent before
  // changing an existing PIN. Only the SHA-256 hash is ever stored (same
  // pattern as password_reset_tokens) — a DB leak alone can't be replayed.
  // Single-use and short-lived; cleared the moment it's consumed or replaced
  // by a newer request.
  pinResetCodeHash: text("pin_reset_code_hash"),
  pinResetCodeExpiresAt: timestamp("pin_reset_code_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type RewardSettings = typeof rewardSettings.$inferSelect;
export const insertRewardSettingsSchema = createInsertSchema(rewardSettings).omit({
  id: true, createdAt: true, updatedAt: true,
});

// Per-profile balances. `pendingCents` is NOT stored here; it is derived
// at read time from the sum of open cash-out requests so it can never drift.
export const walletBalances = pgTable("wallet_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull().unique(),
  availableCents: integer("available_cents").notNull().default(0),
  savingsCents: integer("savings_cents").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("wallet_balances_user_idx").on(t.userId),
]);
export type WalletBalance = typeof walletBalances.$inferSelect;

// Wallet ledger. Every state change is one row so balances are
// always reconcilable from the ledger alone.
//
// type values:
//   "cashout_requested"  — kid requests; status starts as "pending"
//   "cashout_approved"   — parent approval; debits points, credits availableCents
//   "cashout_declined"   — parent decline; no balance change
//   "paid"               — parent marks money as physically handed over; debits availableCents
//   "savings_deposit"    — moves availableCents → savingsCents (optionally toward goalId)
//   "savings_withdraw"   — moves savingsCents → availableCents
//   "goal_completed"     — marker row when a goal hits its target
export const walletTransactions = pgTable("wallet_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("done"), // "pending" | "done" | "declined"
  deltaCents: integer("delta_cents").notNull().default(0),
  deltaPoints: integer("delta_points").notNull().default(0),
  // For cash-out requests, points the kid is asking to convert.
  requestedPoints: integer("requested_points").notNull().default(0),
  requestedCents: integer("requested_cents").notNull().default(0),
  goalId: varchar("goal_id"),
  note: text("note"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("wallet_tx_profile_created_idx").on(t.profileId, t.createdAt),
  index("wallet_tx_user_status_idx").on(t.userId, t.status),
]);
export type WalletTransaction = typeof walletTransactions.$inferSelect;

// Per-profile savings goals.
export const savingsGoals = pgTable("savings_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  savedCents: integer("saved_cents").notNull().default(0),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("savings_goals_profile_idx").on(t.profileId),
]);
export type SavingsGoal = typeof savingsGoals.$inferSelect;

// Uploaded files stored directly in the database (base64-encoded).
// This is used instead of GCS object storage for reliability.
export const uploadedFiles = pgTable("uploaded_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type UploadedFile = typeof uploadedFiles.$inferSelect;

// Activity log — durable record for the 30-day history/audit feed.
// chore_complete and reward_redeem are synthesised at query time from their
// dedicated tables; this table captures the events that have no dedicated
// home: chore_uncomplete (the chore_completion row is deleted), shoutout
// (already in shoutouts), point_adjustment (already in point_adjustments).
// In practice only chore_uncomplete needs an explicit write here — the others
// can be joined from their own tables. We keep a single table so the history
// endpoint only needs one sorted merge.
export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: varchar("profile_id").references(() => profiles.id, { onDelete: "cascade" }).notNull(),
  activityType: text("activity_type").notNull(), // chore_uncomplete
  entityId: varchar("entity_id"),
  entityTitle: text("entity_title"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("activity_log_user_created_idx").on(t.userId, t.createdAt),
  index("activity_log_profile_idx").on(t.profileId),
]);

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({
  id: true,
  createdAt: true,
});
export type ActivityLog = typeof activityLog.$inferSelect;

// ── Onboarding walkthrough progress ─────────────────────────────────────────
// Tracks the skippable steps (profile/location/rewards/invite) of the
// first-run onboarding wizard so a "finish setting up" reminder can be shown
// later — per family (userId = family owner), not per device, so the
// reminder follows the family across web/native regardless of who's logged in.
// Each step is one of: absent (not reached yet — wizard still in progress or
// never started), "done", or "skipped". dismissedUntil snoozes the reminder
// for a step without marking it done.
export const onboardingStatus = pgTable("onboarding_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
  profileStatus: text("profile_status"), // "done" | "skipped" | null
  profileDismissedUntil: timestamp("profile_dismissed_until"),
  locationStatus: text("location_status"),
  locationDismissedUntil: timestamp("location_dismissed_until"),
  rewardsStatus: text("rewards_status"),
  rewardsDismissedUntil: timestamp("rewards_dismissed_until"),
  inviteStatus: text("invite_status"),
  inviteDismissedUntil: timestamp("invite_dismissed_until"),
  // Added 2026-08-27 for the new "connect your calendar" onboarding step.
  calendarStatus: text("calendar_status"),
  calendarDismissedUntil: timestamp("calendar_dismissed_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertOnboardingStatusSchema = createInsertSchema(onboardingStatus).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type OnboardingStatus = typeof onboardingStatus.$inferSelect;
export type InsertOnboardingStatus = (typeof insertOnboardingStatusSchema)['_output'];
export type InsertActivityLog = (typeof insertActivityLogSchema)['_output'];
