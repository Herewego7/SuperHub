import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, RESET_CATEGORIES, type ResetCategory, type DbOrTx } from "../storage";
import { insertProfileSchema, insertEventSchema, insertChoreSchema, insertChoreCompletionSchema, insertCalendarSettingsSchema, insertLocationSettingsSchema, insertDailyContentSchema, insertDailyContentAssignmentSchema, insertDailyContentCompletionSchema, insertGoogleCalendarTokensSchema, insertOutlookCalendarTokensSchema, insertCalendarAssignmentSchema, insertRewardSchema, insertRewardRedemptionSchema, insertMealSchema, insertMealIngredientSchema, insertGroceryItemSchema, insertGroceryStapleSchema, insertSavedMealSchema, insertCelebrationSchema, insertCelebrationGiftIdeaSchema, insertCelebrationPhotoSchema, insertWishlistItemSchema, db, chores as choresTbl, choreCompletions as choreCompletionsTbl, activityLog as activityLogTbl, profiles as profilesTbl, rewardRedemptions as rewardRedemptionsTbl, rewards as rewardsTbl, shoutouts as shoutoutsTbl, pointAdjustments as pointAdjustmentsTbl, meals as mealsTbl, events as eventsTbl, walletTransactions as walletTransactionsTbl, dailyContent as dailyContentTbl, dailyContentAssignments as dailyContentAssignmentsTbl } from "@workspace/db";
import { eq, and, gte, lt, or, inArray, desc } from "drizzle-orm";
import { feedbackNotes } from "@workspace/db/schema";
import { GoogleCalendarService } from "../googleCalendar";
import { OutlookCalendarService } from "../outlookCalendar";
import { ObjectStorageService, ObjectNotFoundError, cleanupReplacedPhoto } from "../objectStorage";
import { setupAuth, registerAuthRoutes, registerLocalAuthRoutes, isAuthenticated, setFamilyResolver } from "../replit_integrations/auth";
import { registerPushRoutes } from "./push";
import { registerFamilyRoutes } from "./family";
import { resolveFamilyForAccount, backfillFamilies, deleteAccount, FamilyError, getFamilyMemberAccountIds } from "../familyService";
import { extractEventFromImage } from "../flyerExtract";
import { syncEventCreate, syncEventUpdate, syncEventDelete, getFreshOutlookAccessToken, retryFailedSyncsForProfile } from "../calendarSync";
import { registerDailyBriefRoutes } from "./dailyBrief";
import { yesterdayKeyTz, isoWeekKeyFromDateKey } from "../lib/streak";
import { driverIdsOf, driverWriteFields } from "../lib/eventDrivers";
import { registerHealthReminderRoutes } from "./healthReminders";
import { registerKbRoutes } from "./kb";
import { registerChatRoutes } from "./chat";
import { registerSubscriptionRoutes } from "./subscription";
import { sendPushToUser } from "../lib/push";
import { buildWeeklyRecap } from "../lib/weeklyRecap";
import { celebrationsWithMeta, isValidMonthDay, resolveOccurrence } from "../lib/celebrations";
import { geocodeCity } from "../lib/geocode";
import { DEFAULT_TIMEZONE } from "../lib/timezone";
import { mergeGroceryQuantities } from "../lib/groceryMerge";
import { assignPeopleToCalendar } from "../lib/calendarAssignmentScope";
import { acceptSchool, choresDismissedBySlip, dismissSlip, eventsDismissedBySlip, holdSchoolEvent, muteSender, withoutDismissedChores, withoutDismissedSlips } from "../ingest/process";
import { applyIngestedMail } from "../ingest/saveMail";
import { inboxReadiness, scanAfterConnect, scanConnectedInboxes } from "../ingest/scanHousehold";
import { householdScanProgress, scanStatusFor } from "../ingest/scanProgress";
import { requestInboxScan } from "../ingest/scanState";
import { markSchedulerWorkDirty } from "../lib/workGate";
import { dinnerCalendarChange, dinnerEventInsert, dinnerLeavesTheApp, dinnersToCopy } from "../meals/dinnerEvent";
import { INBOX_INITIAL_DAYS, slipKey } from "../ingest/parse";
import { moveClock } from "../scheduler/eveningPlan";
import { expandRecurringEvents, resolveSeriesEventId } from "../lib/eventRecurrence";
import { planRecurringEdit, planRecurringDelete, type EditScope } from "../lib/recurringEdit";
import { alignStartToWeeklyDays } from "../lib/recurrenceRule";
import { checkAndAwardAchievements, checkAndAwardPerfectDay, syncCompletionBonus } from "../achievementService";
import { previewFromIcsUrl, previewFromPdfObjectPath } from "../calendarImport";
import { importRecipeFromUrl } from "../recipeImport";
import { extractRecipeFromImages, MAX_RECIPE_IMAGES } from "../recipeExtract";
import { fetchIcalEvents, validateIcalFeed, invalidateIcalCache, IcalError } from "../icalCalendar";
import { z } from "zod";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "../replit_integrations/auth/rateLimit";
import { isFamilyEntitled } from "../lib/subscriptionEntitlement";
import { isAllowedUploadType } from "../lib/uploadTypes";
import { signObjectPathsIn, verifyObjectSignature, signObjectPath } from "../lib/objectSigning";
import { foreignProfileIds, profileIdsNamedByEventWrite } from "../lib/profileScope";
import {
  createOAuthTransaction,
  peekOAuthTransaction,
  consumeOAuthTransaction,
  nativeRedirectFor,
  webCalendarReturn,
  isOAuthProvider,
  type OAuthProvider,
} from "../lib/oauthState";

// Free-trial-then-subscribe (2026-08 launch plan): the one shared reply for
// every gated route below. 402 (Payment Required) is the semantically
// correct status for "this needs a subscription" and is distinct from 401/403
// (auth failures the client already handles differently), so the frontend can
// key its "Upgrade to continue" UI off this status specifically. isEntitled()
// itself fails open (enforcement disabled / comped / trialing / ambiguous
// state all return true), so this never blocks anyone unless enforcement is
// explicitly turned on AND their trial has genuinely, definitively ended.
// Takes the signed-in ACCOUNT id and asks whether the HOUSEHOLD is entitled.
// Was isEntitled(account), which gave every login in a family its own trial
// and its own paywall on a family hub sold as one subscription — a spouse
// could be gated on a subscription the owner was already paying for.
async function requireEntitled(userId: string, res: any): Promise<boolean> {
  if (await isFamilyEntitled(userId)) return true;
  res.status(402).json({
    message: "Your free trial has ended. Subscribe to keep using this feature.",
    code: "subscription_required",
  });
  return false;
}
import { authStorage } from "../replit_integrations/auth/storage";
import { verifyPassword } from "../replit_integrations/auth/password";
import { sendEmail } from "../lib/email";
import { escapeHtml } from "../lib/publicUrl";

// Helper to get the DATA userId for an authenticated request. With the family
// model this is the family OWNER's id (resolved by auth middleware into
// req.familyOwnerId), so every member of a family operates on the same shared
// data. Falls back to the raw account id when no family is attached.
function getUserId(req: any): string {
  return req.familyOwnerId ?? req.user?.claims?.sub;
}

// Helper to get the raw LOGGED-IN account id (not the family owner). Used by
// family-management endpoints that must act on the specific account, e.g.
// "which family am I in", "leave family", "accept invite".
function getAuthAccountId(req: any): string {
  return req.user?.claims?.sub;
}

// Push several of the new notification categories (reward redeemed, cashout
// requested) to "the parents" — every logged-in account in the family, not
// just its nominal owner (see getFamilyMemberAccountIds). Best-effort: a push
// failure must never break the request that triggered it.
async function notifyFamily(
  dataOwnerUserId: string,
  payload: { title: string; body: string; url?: string; tag?: string; data?: Record<string, unknown> },
  category: Parameters<typeof sendPushToUser>[2],
): Promise<void> {
  try {
    const memberIds = await getFamilyMemberAccountIds(dataOwnerUserId);
    await Promise.all(
      memberIds.map((memberId) => sendPushToUser({ userId: memberId }, payload, category)),
    );
  } catch (err) {
    console.error("notifyFamily failed:", err);
  }
}

// Helper to validate that a profile belongs to the authenticated user
/** Thrown by multer's fileFilter so the route can answer 415 rather than 500. */
class UnsupportedUploadTypeError extends Error {
  constructor(public readonly mimetype: string) {
    super(`Unsupported upload type: ${mimetype}`);
    this.name = "UnsupportedUploadTypeError";
  }
}

/**
 * Reject a write that names any profile outside the caller's household.
 *
 * Returns true when the request has already been answered, so callers read as
 * `if (await rejectForeignProfileIds(...)) return;`.
 *
 * One helper rather than a check per route: the routes accept assignees and
 * drivers in several shapes, and enumerating them at each call site is how one
 * gets missed.
 */
async function rejectForeignProfileIds(req: any, res: any, userId: string): Promise<boolean> {
  const named = profileIdsNamedByEventWrite(req.body ?? {});
  if (named.length === 0) return false;
  const own = (await storage.getProfilesByUser(userId)).map((p) => p.id);
  const foreign = foreignProfileIds(named, own);
  if (foreign.length === 0) return false;
  req.log?.warn?.({ foreign, userId }, "Rejected a write naming profiles outside the household");
  res.status(403).json({ message: "One or more profiles do not belong to you" });
  return true;
}

async function validateProfileOwnership(profileId: string, userId: string): Promise<boolean> {
  const profile = await storage.getProfile(profileId);
  return profile?.userId === userId;
}

// Aggregate meal ingredients into a deduped grocery list (case-insensitive name match,
// concatenated quantities). Does NOT do unit conversion.
function aggregateIngredients(
  ingredients: Array<{ id: string; mealId: string; item: string; quantity: string | null; displayOrder: number | null }>,
): Array<{ name: string; quantity: string | null; sourceMealIds: string[] }> {
  const map = new Map<string, { name: string; quantities: string[]; sourceMealIds: Set<string> }>();
  for (const ing of ingredients) {
    const key = ing.item.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { name: ing.item.trim(), quantities: [], sourceMealIds: new Set() });
    }
    const entry = map.get(key)!;
    if (ing.quantity && ing.quantity.trim()) {
      entry.quantities.push(ing.quantity.trim());
    }
    entry.sourceMealIds.add(ing.mealId);
  }
  return Array.from(map.values())
    .map(e => ({
      name: e.name,
      quantity: e.quantities.length > 0 ? e.quantities.join(" + ") : null,
      sourceMealIds: Array.from(e.sourceMealIds),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication (MUST be before other routes)
  await setupAuth(app);
  // Wire family resolution into the auth middleware so every authenticated
  // request resolves to its family's shared owner id (req.familyOwnerId).
  setFamilyResolver(resolveFamilyForAccount);

  // Sign every uploaded-object path on its way OUT of any /api response.
  //
  // One choke point instead of the four tables that store a path (profiles,
  // celebration photos, wishlist items, savings goals) and everything that
  // joins them. The matching strip on the way in lives in app.ts, so what is
  // stored stays bare.
  //
  // ⚠️ The household is resolved INSIDE res.json, not here.
  //
  // This middleware runs before each route's own isAuthenticated, and that is
  // where req.familyOwnerId gets populated (and where a native bearer token is
  // decoded into req.user at all). Reading it at middleware time therefore
  // got:
  //   - native bearer  -> nothing; the response went out with BARE object
  //                       paths, so enabling OBJECT_URL_ENFORCEMENT would
  //                       have blanked every image in the iOS app;
  //   - joined web member -> the MEMBER's account id rather than the family
  //                       owner's, binding signatures to the wrong identity.
  // An earlier comment here claimed setFamilyResolver populated it. It does
  // not — it only registers the resolver function.
  //
  // By the time a route calls res.json(), isAuthenticated has run, so reading
  // it then is correct for every caller.
  app.use("/api", (req: any, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const userId = req.familyOwnerId ?? req.user?.claims?.sub;
      // Unauthenticated responses (login, the Apple webhook, health) carry no
      // object paths, and there would be no household to bind a signature to.
      if (!userId || res.locals.skipObjectSigning) return originalJson(body);
      return originalJson(signObjectPathsIn(body, userId));
    }) as typeof res.json;
    next();
  });

  registerAuthRoutes(app);
  registerLocalAuthRoutes(app);
  // Family management (invite / join / members)
  registerFamilyRoutes(app);
  // Ensure every existing user has a family (idempotent, runs once at boot).
  backfillFamilies().catch((err) => console.error("Family backfill failed:", err));

  // Web push notifications (PWA)
  registerPushRoutes(app);
  // Daily morning brief
  registerDailyBriefRoutes(app);
  // Health reminders (medication / appointment / refill / generic)
  registerHealthReminderRoutes(app);
  // Knowledge Base "ask a question" backlog + email forward
  registerKbRoutes(app);
  registerChatRoutes(app);
  // Free-trial-then-subscribe entitlement (2026-08 launch plan)
  registerSubscriptionRoutes(app);

  // Profiles - protected routes, filtered by userId
  app.get("/api/profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      let profiles = await storage.getProfilesByUser(userId);
      
      // Auto-create "All Family" profile for new users
      const hasAllFamilyProfile = profiles.some(p => p.isAllFamilyProfile);
      if (!hasAllFamilyProfile) {
        const allFamilyProfile = await storage.createProfile({
          userId,
          name: "All Family",
          initials: "👨‍👩‍👧‍👦",
          color: "#6366f1",
          isAllFamilyProfile: true,
          isActive: true,
        });
        profiles = [allFamilyProfile, ...profiles];
      }
      
      // Sort: All Family profile first, then others by creation date
      profiles.sort((a, b) => {
        if (a.isAllFamilyProfile) return -1;
        if (b.isAllFamilyProfile) return 1;
        return new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime();
      });
      
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch profiles" });
    }
  });

  app.post("/api/profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profileData = insertProfileSchema.parse(req.body);
      // Parental consent is recorded only via POST /api/profiles/:id/parental-consent,
      // never accepted from the client on create, so it can't be forged.
      delete (profileData as Record<string, unknown>).parentalConsentAt;
      delete (profileData as Record<string, unknown>).parentalConsentBy;
      const profile = await storage.createProfile({ ...profileData, userId });
      res.status(201).json(profile);
    } catch (error) {
      res.status(400).json({ message: "Invalid profile data" });
    }
  });

  app.patch("/api/profiles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      // Use a plain Zod schema to avoid drizzle-zod v4/v3 mixing issues.
      const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
      const profileUpdateSchema = z.object({
        name: z.string().optional(),
        color: z.string().optional(),
        initials: z.string().optional(),
        email: z.string().nullable().optional(),
        school: z.string().nullable().optional(),
        facts: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        photoUrl: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
        isAllFamilyProfile: z.boolean().optional(),
        googleCalendarConnected: z.boolean().optional(),
        outlookCalendarConnected: z.boolean().optional(),
        bedtimeCutoff: hhmm,
        dailyBriefTime: hhmm,
        eveningPlanTime: hhmm,
        eveningPlanTiming: z.enum(["eveningBefore", "morningOf"]).optional(),
        dailyBriefSections: z.object({
          events: z.boolean().optional(),
          chores: z.boolean().optional(),
          meals: z.boolean().optional(),
          driving: z.boolean().optional(),
          celebrations: z.boolean().optional(),
        }).nullable().optional(),
        streakSkipDays: z.array(z.number().int().min(0).max(6)).optional(),
        // Weekly-recap digest schedule. These were MISSING from this schema
        // since the feature shipped — z.object strips unknown keys, so the
        // Settings controls for them silently never saved and the recap
        // scheduler read columns the UI could never set.
        weeklyRecapTime: hhmm,
        weeklyRecapDay: z.number().int().min(0).max(6).optional(),
        // Per-person daily-checklist bonus override (per_completion mode);
        // null clears it back to the family-wide default.
        completionBonusPoints: z.number().int().min(0).max(10000).nullable().optional(),
        // Adult vs. kid role (drives Parent-PIN gating). Separate from the
        // COPPA under-13 `isChild` flag below.
        role: z.enum(["adult", "child"]).optional(),
        // COPPA: a profile may be flagged as a child (under 13) with an optional
        // birth year. Parental consent itself is recorded only via the dedicated
        // /parental-consent endpoint, never through this generic update.
        isChild: z.boolean().optional(),
        birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
      });
      const updates = profileUpdateSchema.parse(req.body);
      // Fetch the pre-update row so a replaced/cleared photo's OLD blob can
      // be cleaned up below — storage.updateProfile only returns the new one.
      const existing = updates.photoUrl !== undefined ? await storage.getProfile(id) : undefined;
      const profile = await storage.updateProfile(id, updates, userId);
      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }
      if (updates.photoUrl !== undefined) cleanupReplacedPhoto(existing?.photoUrl, updates.photoUrl);
      res.json(profile);
    } catch (error) {
      req.log.error({ err: error }, "Failed to update profile");
      res.status(400).json({ message: "Invalid profile data" });
    }
  });

  // COPPA: record verifiable parental consent for a child profile. The consent
  // timestamp and the affirming account id are stamped server-side so they can't
  // be forged by the client. Marks the profile as a child as a side effect.
  app.post("/api/profiles/:id/parental-consent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = getAuthAccountId(req);
      const { id } = req.params;
      const profile = await storage.getProfile(id);
      if (!profile || profile.userId !== userId) {
        return res.status(404).json({ message: "Profile not found" });
      }
      if (profile.isAllFamilyProfile) {
        return res.status(400).json({ message: "Cannot set consent on the All Family profile" });
      }
      const updated = await storage.updateProfile(
        id,
        { isChild: true, parentalConsentAt: new Date(), parentalConsentBy: accountId },
        userId,
      );
      return res.json(updated);
    } catch (error) {
      req.log.error({ err: error }, "Failed to record parental consent");
      return res.status(400).json({ message: "Could not record parental consent" });
    }
  });

  app.delete("/api/profiles/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;

      // Check if this is the All Family profile (cannot be deleted)
      const profile = await storage.getProfile(id);
      if (profile?.isAllFamilyProfile) {
        return res.status(400).json({ message: "Cannot delete the All Family profile" });
      }
      
      const success = await storage.deleteProfile(id, userId);
      if (!success) {
        return res.status(404).json({ message: "Profile not found" });
      }
      res.status(204).send();
    } catch (error) {
      req.log?.error?.({ err: error }, "Failed to delete profile");
      // Surface the real underlying error (e.g. a Postgres foreign-key
      // violation naming the exact constraint/table) in the response itself
      // — this is a family-internal app with no untrusted end users, and a
      // constraint-violation message is diagnostic text, not a secret.
      // Without this, diagnosing a failure required digging through server
      // logs neither the user nor Claude Code (no deployment access) could
      // easily reach.
      const detail = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to delete profile: ${detail}` });
    }
  });

  // Events - protected routes, filtered by userId
  app.get("/api/events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const events = await storage.getEventsByUser(userId);
      const settings = await storage.getCalendarSettingsByUser(userId);
      res.json(expandRecurringEvents(withoutDismissedSlips(events, settings?.dismissedSlipKeys ?? [])));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.post("/api/events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // Assignees and drivers are taken straight from the body; without this
      // a household could assign an event to another family's profile, and
      // two-way sync would then push it into that profile's real calendar.
      if (await rejectForeignProfileIds(req, res, userId)) return;

      // Convert string dates to Date objects
      const processedData = {
        ...req.body,
        userId,
        startTime: new Date(req.body.startTime),
        endTime: new Date(req.body.endTime)
      };
      

      // Keep the legacy single-driver column in step with the list, so anything
      // still reading drivingProfileId (older clients, existing queries) sees a
      // driver. See lib/eventDrivers.ts.
      if (processedData.drivingProfileIds !== undefined) {
        Object.assign(processedData, driverWriteFields(processedData.drivingProfileIds ?? []));
      } else if (processedData.drivingProfileId !== undefined) {
        Object.assign(processedData, driverWriteFields(processedData.drivingProfileId ? [processedData.drivingProfileId] : []));
      }
      const eventData = insertEventSchema.parse(processedData);
      // A weekly series whose start day isn't one of its own ticked days would
      // mean two different things in two places: locally the stored row is
      // always occurrence one, while Google and Outlook expand only the ticked
      // days. Moving the start onto the first ticked day (what Outlook itself
      // does) makes the row satisfy its own rule, so every reader agrees.
      if (eventData.recurrenceType === "weekly") {
        const aligned = alignStartToWeeklyDays(
          new Date(eventData.startTime), new Date(eventData.endTime), eventData.daysOfWeek as number[] | null,
        );
        if (aligned) Object.assign(eventData, aligned);
      }
      const event = await storage.createEvent(eventData);
      // Mirror to connected calendars (best-effort; never blocks the response).
      // Deliberately NOT awaited: pushing a copy to each assigned profile's
      // Google/Outlook calendar is several external round-trips, and none of
      // them affect what GET /api/events returns (that reads the local events
      // table; sync bookkeeping lives in the separate event_calendar_syncs
      // table). Awaiting it only made the user wait seconds to see their own
      // change. Failures are already swallowed + recorded inside, and surface
      // via the Settings sync-error banner.
      void syncEventCreate(event).catch((err) =>
        console.warn("syncEventCreate (background) failed:", err instanceof Error ? err.message : err),
      );
      res.status(201).json(event);
    } catch (error) {
      console.error("Event creation error:", error);
      res.status(400).json({ message: "Invalid event data" });
    }
  });

  app.patch("/api/events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (await rejectForeignProfileIds(req, res, userId)) return;
      const { id } = req.params;
      
      // Prevent editing Google Calendar events
      if (id.startsWith('google-')) {
        return res.status(403).json({ message: "Google Calendar events cannot be edited" });
      }

      // A synthetic recurring-event occurrence (see lib/eventRecurrence.ts)
      // isn't a real row — its displayed startTime/endTime are computed, not
      // stored. Writing them straight back would shift the whole series'
      // anchor to whatever occurrence happened to be open, so an edit that
      // names an occurrence has to say WHICH of the three things it means.
      const seriesId = resolveSeriesEventId(id);
      const isOccurrence = id !== seriesId;
      const scope: EditScope = req.body.scope ?? (isOccurrence ? "occurrence" : "series");
      if (isOccurrence && !req.body.occurrenceStart) {
        return res.status(400).json({ message: "Editing one occurrence needs the occurrence's own start time." });
      }

      // Convert string dates to Date objects if present
      const processedData = { ...req.body };
      // Routing instructions, not columns — they must not reach the schema.
      delete processedData.scope;
      delete processedData.occurrenceStart;
      if (processedData.startTime) {
        processedData.startTime = new Date(processedData.startTime);
      }
      if (processedData.endTime) {
        processedData.endTime = new Date(processedData.endTime);
      }
      if (processedData.startTime instanceof Date) {
        const [existing] = await db.select({ startTime: eventsTbl.startTime, isAllDay: eventsTbl.isAllDay }).from(eventsTbl).where(eq(eventsTbl.id, seriesId)).limit(1);
        const allDay = processedData.isAllDay !== undefined ? processedData.isAllDay === true : existing?.isAllDay === true;
        if (!allDay) {
          const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
          const label = moveClock(existing?.startTime, processedData.startTime, timeZone);
          if (label) processedData.movedFrom = `${label}\n${new Date().toISOString()}`;
        }
      }
      

      // Keep the legacy single-driver column in step with the list, so anything
      // still reading drivingProfileId (older clients, existing queries) sees a
      // driver. See lib/eventDrivers.ts.
      if (processedData.drivingProfileIds !== undefined) {
        Object.assign(processedData, driverWriteFields(processedData.drivingProfileIds ?? []));
      } else if (processedData.drivingProfileId !== undefined) {
        Object.assign(processedData, driverWriteFields(processedData.drivingProfileId ? [processedData.drivingProfileId] : []));
      }
      const updates = insertEventSchema.partial().parse(processedData);
      // Same alignment as the create route. It was missing here, so an event
      // created first and THEN given a Mon+Tue rule kept its original weekday
      // while every later occurrence moved — reported 2026-09-12 as "that
      // event still stayed on the Wednesday, but the future events went to Mon
      // and Tues". Only for a whole-series edit: detaching or splitting an
      // occurrence is anchored to that occurrence's own day on purpose.
      if (scope === "series" && updates.recurrenceType === "weekly") {
        const st = updates.startTime ?? (await storage.getEventsByUser(userId)).find(e => e.id === seriesId)?.startTime;
        const en = updates.endTime ?? (await storage.getEventsByUser(userId)).find(e => e.id === seriesId)?.endTime;
        if (st && en) {
          const aligned = alignStartToWeeklyDays(
            new Date(st), new Date(en), (updates.daysOfWeek ?? null) as number[] | null,
          );
          if (aligned) Object.assign(updates, aligned);
        }
      }

      // "This event" / "this and all following" split the series rather than
      // editing it in place — see lib/recurringEdit.ts for the arithmetic.
      let event: Awaited<ReturnType<typeof storage.updateEvent>>;
      if (isOccurrence || (scope !== "series" && req.body.occurrenceStart)) {
        const all = await storage.getEventsByUser(userId);
        const existing = all.find(e => e.id === seriesId);
        if (!existing) return res.status(404).json({ message: "Event not found" });
        const plan = planRecurringEdit(
          existing, scope, new Date(req.body.occurrenceStart), updates as Record<string, unknown>,
        );
        const patchedSeries = await storage.updateEvent(seriesId, plan.seriesPatch as any, userId);
        // ⚠️ The series patch has to be MIRRORED, not just stored. It carries
        // the exclusion (or the pulled-back end date) that stops the original
        // occurrence still showing on a connected calendar — without this the
        // detached copy is created externally while the series keeps its old
        // occurrence, so the event appears twice on Google and Outlook.
        if (patchedSeries) {
          void syncEventUpdate(patchedSeries).catch((err) =>
            console.warn("syncEventUpdate (series patch) failed:", err instanceof Error ? err.message : err),
          );
        }
        if (plan.newEvent) {
          const created = await storage.createEvent({ ...(plan.newEvent as any), userId });
          void syncEventCreate(created).catch((err) =>
            console.warn("syncEventCreate (background) failed:", err instanceof Error ? err.message : err),
          );
          // The detached/new row is what the caller is now looking at, so it
          // is what comes back — returning the series would make the client
          // render the occurrence it just moved away from.
          return res.json(created);
        }
        event = await storage.updateEvent(seriesId, updates, userId);
      } else {
        event = await storage.updateEvent(id, updates, userId);
      }
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      // Mirror the edit (and any assignee changes) to connected calendars.
      // Not awaited — see the note on the create route above. This one is the
      // worst offender: re-assigning an event from one person to the whole
      // family creates a fresh external copy per newly-assigned profile per
      // provider, so awaiting it made a simple "assign to everyone" save take
      // seconds before the UI could update.
      void syncEventUpdate(event).catch((err) =>
        console.warn("syncEventUpdate (background) failed:", err instanceof Error ? err.message : err),
      );
      res.json(event);
    } catch (error) {
      res.status(400).json({ message: "Invalid event data" });
    }
  });

  app.delete("/api/events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // A synthetic recurring-event occurrence isn't a real row — deleting
      // any occurrence removes the whole series (its one real underlying
      // event row) since there's no per-occurrence exception concept yet.
      const id = resolveSeriesEventId(req.params.id);

      // Prevent deleting Google Calendar events
      if (id.startsWith('google-')) {
        return res.status(403).json({ message: "Google Calendar events cannot be deleted" });
      }

      // Deleting ONE occurrence, or this one and everything after it. Neither
      // removes the row — they narrow the series and the change is mirrored
      // like any other edit. Without this the only option was the whole
      // series, so dropping one cancelled week lost the other fifty-one.
      const delScope = String(req.query.scope ?? "series") as EditScope;
      const delOccurrence = req.query.occurrenceStart ? new Date(String(req.query.occurrenceStart)) : null;
      if (delScope !== "series" && delOccurrence) {
        const all = await storage.getEventsByUser(userId);
        const existing = all.find(e => e.id === id);
        if (!existing) return res.status(404).json({ message: "Event not found" });
        const patch = planRecurringDelete(existing, delScope, delOccurrence);
        if (patch) {
          const narrowed = await storage.updateEvent(id, patch as any, userId);
          if (narrowed) {
            void syncEventUpdate(narrowed).catch((err) =>
              console.warn("syncEventUpdate (delete scope) failed:", err instanceof Error ? err.message : err),
            );
          }
          return res.status(204).send();
        }
        // patch === null means this really is the whole series; fall through.
      }

      // Capture external-calendar links BEFORE deleting (the rows cascade-delete
      // with the event, but we still need them to remove the external copies).
      // Defensive: never let sync bookkeeping block the core delete.
      let syncLinks: Awaited<ReturnType<typeof storage.getEventCalendarSyncs>> = [];
      try {
        syncLinks = await storage.getEventCalendarSyncs(id);
      } catch (e) {
        console.warn("Could not load event sync links (continuing with delete):", e instanceof Error ? e.message : e);
      }
      const removing = (await storage.getEventsByUser(userId)).find((event) => event.id === id);
      const success = await storage.deleteEvent(id, userId);
      if (!success) {
        return res.status(404).json({ message: "Event not found" });
      }
      if (removing?.source === "school") {
        const key = removing.externalId || slipKey(removing.title);
        if (key) {
          try {
            const settings = await storage.getCalendarSettingsByUser(userId);
            const keys = holdSchoolEvent(settings?.dismissedSlipKeys ?? [], key);
            if (keys.length !== (settings?.dismissedSlipKeys ?? []).length) {
              await storage.updateCalendarSettings({ dismissedSlipKeys: keys, userId });
            }
          } catch (err) {
            console.warn("Could not remember a removed school event:", err instanceof Error ? err.message : err);
          }
        }
      }
      // Not awaited — see the note on the create route above. The local row is
      // already gone, which is all GET /api/events reads; removing the external
      // copies can finish in the background.
      void syncEventDelete(syncLinks).catch((err) =>
        console.warn("syncEventDelete (background) failed:", err instanceof Error ? err.message : err),
      );
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  // Calendar Import (ICS feed + PDF upload) ----------------------------
  const icsPreviewSchema = z.object({ url: z.string().min(1) });
  app.post("/api/calendar-imports/ics/preview", isAuthenticated, async (req: any, res) => {
    try {
      const { url } = icsPreviewSchema.parse(req.body);
      const preview = await previewFromIcsUrl(url);
      res.json(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read ICS feed";
      console.error("ICS preview error:", message);
      res.status(400).json({ message });
    }
  });

  const pdfPreviewSchema = z.object({ objectURL: z.string().min(1) });
  app.post("/api/calendar-imports/pdf/preview", isAuthenticated, async (req: any, res) => {
    try {
      const { objectURL } = pdfPreviewSchema.parse(req.body);
      const objectStorageService = new ObjectStorageService();
      const objectPath = objectStorageService.normalizeObjectEntityPath(objectURL);
      const preview = await previewFromPdfObjectPath(objectPath);
      res.json(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read PDF";
      console.error("PDF preview error:", message);
      res.status(400).json({ message });
    }
  });

  const flyerExtractSchema = z.object({
    imageURL: z.string().min(1),
    // The client's own local calendar day. Optional so an older app build
    // keeps working (extractEventFromImage falls back to the server's date).
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  app.post("/api/flyer-extract", isAuthenticated, async (req: any, res) => {
    let parsedBody: { imageURL: string; today?: string };
    try {
      parsedBody = flyerExtractSchema.parse(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return res.status(400).json({ message });
    }
    try {
      const result = await extractEventFromImage(parsedBody.imageURL, parsedBody.today);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read flyer";
      console.error("Flyer extract error:", message, error);
      res.status(502).json({ message });
    } finally {
      // The uploaded photo is a one-shot AI input — nothing else ever
      // references it again, win or lose, so it's pure orphaned storage from
      // the moment this request finishes. Fire-and-forget: never blocks or
      // fails the response either way.
      new ObjectStorageService().deleteObjectByPath(parsedBody.imageURL).catch(() => false);
    }
  });

  const previewEventSchema = z.object({
    externalId: z.string(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    startTime: z.string(),
    endTime: z.string(),
    isAllDay: z.boolean(),
  });
  const confirmImportSchema = z.object({
    source: z.string().min(1).max(40),
    sourceLabel: z.string().min(1).max(80),
    profileIds: z.array(z.string()).default([]),
    events: z.array(previewEventSchema).min(1),
  });
  app.post("/api/calendar-imports/confirm", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const payload = confirmImportSchema.parse(req.body);

      // Validate every chosen profileId belongs to the user
      for (const profileId of payload.profileIds) {
        const ok = await validateProfileOwnership(profileId, userId);
        if (!ok) {
          return res.status(403).json({ message: "One or more profiles do not belong to you" });
        }
      }

      // Dedup against any existing imported events with same source+externalId
      const incomingExternalIds = payload.events.map(e => e.externalId);
      const existing = await storage.getExistingExternalIds(userId, payload.source, incomingExternalIds);

      const toInsert = payload.events
        .filter(e => !existing.has(e.externalId))
        .map((e) => ({
          userId,
          title: e.title,
          description: e.description ?? null,
          location: e.location ?? null,
          startTime: new Date(e.startTime),
          endTime: new Date(e.endTime),
          profileIds: payload.profileIds,
          isAllDay: !!e.isAllDay,
          source: payload.source,
          externalId: e.externalId,
          calendarId: payload.source,
          calendarName: payload.sourceLabel,
        }));

      const created = await storage.bulkCreateEvents(toInsert as any);
      res.status(201).json({
        importedCount: created.length,
        skippedCount: payload.events.length - created.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import events";
      console.error("Calendar import confirm error:", message);
      res.status(400).json({ message });
    }
  });

  // Chores - protected routes, filtered by userId
  // One-time lazy migration: fold legacy Inspiration items (daily_content, except
  // notes) into the unified tasks (chores) table, then remove the originals.
  async function migrateInspirationToTasks(userId: string) {
    const legacy = (await storage.getDailyContentByUser(userId)).filter(c => c.type !== "note");
    for (const item of legacy) {
      try {
        const assignments = await storage.getDailyContentAssignments(item.id);
        const description = item.reference
          ? `${item.content}\n— ${item.reference}`
          : item.content;
        await storage.createChore({
          userId,
          title: item.title,
          description,
          taskType: item.type as any, // mission | affirmation | bible_verse | memory_verse | custom
          points: 0,
          profileIds: assignments.map(a => a.profileId),
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          recurrenceType: "weekly", // all 7 days selected = effectively daily
          isActive: item.isActive ?? true,
        });
        await storage.deleteDailyContentAssignments(item.id);
        await storage.deleteDailyContent(item.id, userId);
      } catch (err) {
        console.error("inspiration->tasks migration failed for item " + item.id, err);
      }
    }
  }

  // Completed to-dos never revert, so without this they accumulate forever
  // and every client re-downloads the family's entire to-do history on every
  // app open. Nothing is purged — see storage.archiveOldCompletedTodos. The
  // sweep is throttled to once a day per account rather than run on a
  // scheduler tick, which would keep the database awake for no reason (see
  // the scheduler-interval work on database compute cost).
  const TODO_ARCHIVE_AFTER_DAYS = 30;
  const lastTodoArchiveSweep = new Map<string, number>();
  async function maybeArchiveOldTodos(userId: string) {
    const last = lastTodoArchiveSweep.get(userId) ?? 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    lastTodoArchiveSweep.set(userId, Date.now());
    const cutoff = new Date(Date.now() - TODO_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    await storage.archiveOldCompletedTodos(userId, cutoff);
  }

  app.get("/api/chores", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      await migrateInspirationToTasks(userId);
      await maybeArchiveOldTodos(userId).catch((err) =>
        req.log?.warn?.({ err }, "to-do archive sweep failed"),
      );
      const all = await storage.getChoresByUser(userId);
      // The completed-to-dos history drawer asks for everything; every other
      // caller gets the working set.
      const includeArchived = req.query.includeArchived === "1";
      const settings = await storage.getCalendarSettingsByUser(userId);
      const chores = withoutDismissedChores(
        includeArchived ? all : all.filter((c) => !(c as any).archivedAt),
        settings?.dismissedSlipKeys ?? [],
      );
      res.json(chores);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch chores" });
    }
  });

  // Sub-to-dos are deliberately ONE level deep. Validates that a proposed
  // parent exists, belongs to this user, is itself a to-do, and isn't already
  // a child — so a sub-to-do can never have its own sub-to-dos, no matter
  // what a client sends. Returns an error message, or null when it's fine.
  // Scoped to this user's own chores, which validates ownership inherently —
  // there's no single-chore getter, and reusing getChoresByUser avoids adding
  // one just for this.
  async function validateTodoParent(parentChoreId: string, userId: string): Promise<string | null> {
    const owned = await storage.getChoresByUser(userId);
    const parent = owned.find((c) => c.id === parentChoreId);
    if (!parent) return "That to-do doesn't exist.";
    if (parent.taskType !== "todo") return "Only to-dos can hold other to-dos.";
    if ((parent as any).parentChoreId) return "A to-do can only be nested one level deep.";
    return null;
  }

  app.post("/api/chores", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const choreData = insertChoreSchema.parse(req.body);
      const parentId = (choreData as any).parentChoreId;
      if (parentId) {
        const problem = await validateTodoParent(parentId, userId);
        // Bare return (not `return res...`): this handler otherwise falls off
        // the end returning undefined, and mixing the two trips noImplicitReturns.
        if (problem) { res.status(400).json({ message: problem }); return; }
      }
      const chore = await storage.createChore({ ...choreData, userId });
      res.status(201).json(chore);
    } catch (error) {
      res.status(400).json({ message: "Invalid chore data" });
    }
  });

  // Reorder chores by drag-and-drop (Manage Chores drawer) — persists a full
  // ordered list of ids in one call. Must be registered before /:id to avoid
  // being shadowed by it.
  app.post("/api/chores/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
        return res.status(400).json({ message: "Couldn't save the new order — please try again." });
      }
      await storage.reorderChores(userId, orderedIds);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to reorder chores" });
    }
  });

  // Bonus chore pool — must be registered before /:id to avoid shadowing

  // Returns the start of the current window for a per-period bonus chore.
  function getBonusWindowStart(period: string): Date {
    const now = new Date();
    if (period === "day") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "week") {
      const day = now.getDay(); // 0=Sun
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const mon = new Date(now);
      mon.setDate(now.getDate() + mondayOffset);
      mon.setHours(0, 0, 0, 0);
      return mon;
    } else {
      // month
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  // Compute completionCount and isLocked for a bonus chore
  async function enrichBonusChore(chore: any) {
    const freqType = chore.bonusFrequencyType ?? "unlimited";
    if (freqType === "unlimited" || !chore.bonusFrequencyCount) {
      return { ...chore, completionCount: 0, isLocked: false };
    }
    const all = await storage.getChoreCompletionsByChore(chore.id);
    let completionCount: number;
    if (freqType === "total") {
      completionCount = all.length;
    } else {
      const windowStart = getBonusWindowStart(chore.bonusFrequencyPeriod ?? "week");
      completionCount = all.filter(c => c.completedAt && new Date(c.completedAt) >= windowStart).length;
    }
    const isLocked = completionCount >= chore.bonusFrequencyCount;
    return { ...chore, completionCount, isLocked };
  }

  app.get("/api/chores/bonus", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const all = await storage.getChoresByUser(userId);
      const bonusChores = all.filter(c => c.isBonus === true);
      const enriched = await Promise.all(bonusChores.map(enrichBonusChore));
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bonus chores" });
    }
  });

  const bonusChoreSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional().nullable(),
    icon: z.string().max(64).optional().nullable(),
    points: z.number().int().min(0).max(10000).default(1),
    // Who the bonus chore is an OPTION for. Empty/omitted = everyone (the whole
    // family — the original, only-ever behavior); a specific list scopes who
    // sees it as claimable. No one is ever *required* to do a bonus chore.
    profileIds: z.array(z.string()).optional(),
    bonusFrequencyType: z.enum(["unlimited", "per_period", "total"]).default("unlimited"),
    bonusFrequencyCount: z.number().int().min(1).optional().nullable(),
    bonusFrequencyPeriod: z.enum(["day", "week", "month"]).optional().nullable(),
  });

  app.post("/api/chores/bonus", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const body = bonusChoreSchema.parse(req.body);
      const { profileIds, ...rest } = body;
      const chore = await storage.createChore({
        ...rest,
        userId,
        profileIds: profileIds ?? [],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        isBonus: true,
        isActive: true,
      });
      res.status(201).json(chore);
    } catch (error) {
      res.status(400).json({ message: "Invalid bonus chore data" });
    }
  });

  app.patch("/api/chores/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const updates = insertChoreSchema.partial().parse(req.body);
      const newParent = (updates as any).parentChoreId;
      if (newParent) {
        if (newParent === id) return res.status(400).json({ message: "A to-do can't be filed under itself." });
        const problem = await validateTodoParent(newParent, userId);
        if (problem) return res.status(400).json({ message: problem });
        // Moving a to-do that already has its own items underneath would
        // create a second level, which this feature deliberately doesn't do.
        const ownKids = await storage.getChildChores(id);
        if (ownKids.length > 0) {
          return res.status(400).json({ message: "This to-do already has to-dos under it, so it can't be filed under another one." });
        }
      }
      const chore = await storage.updateChore(id, updates, userId);
      if (!chore) {
        return res.status(404).json({ message: "Chore not found" });
      }
      res.json(chore);
    } catch (error) {
      res.status(400).json({ message: "Invalid chore data" });
    }
  });

  app.delete("/api/chores/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const success = await storage.deleteChore(id, userId);
      if (!success) {
        return res.status(404).json({ message: "Chore not found" });
      }
      res.status(204).send();
    } catch (error) {
      req.log?.error?.({ err: error }, "delete chore failed");
      res.status(500).json({ message: "Failed to delete chore" });
    }
  });

  // Returns current-period progress for all target-count chores assigned to a profile.
  app.get("/api/chores/:profileId/weekly-targets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ message: "Access denied" });

      const allChores = await storage.getChoresByUser(userId);
      const targetChores = allChores.filter(c =>
        c.isActive &&
        c.profileIds.includes(profileId) &&
        c.targetCount != null && c.targetCount > 0
      );

      const now = new Date();
      const results = await Promise.all(targetChores.map(async (chore) => {
        const period = chore.recurrenceType || "weekly";
        let start: Date, end: Date;
        if (period === "monthly") {
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        } else {
          const dow = now.getDay();
          start = new Date(now);
          start.setDate(now.getDate() - dow);
          start.setHours(0, 0, 0, 0);
          end = new Date(start);
          end.setDate(start.getDate() + 6);
          end.setHours(23, 59, 59, 999);
        }
        const completions = await storage.getChoreCompletionsInRange(chore.id, profileId, start, end);
        const progress = completions.length;
        const target = chore.targetCount!;
        return {
          choreId: chore.id,
          title: chore.title,
          targetCount: target,
          period,
          progress,
          completed: progress >= target,
        };
      }));

      res.json(results);
    } catch (error) {
      req.log?.error?.({ err: error }, "fetch weekly targets failed");
      res.status(500).json({ message: "Failed to fetch weekly targets" });
    }
  });

  // Chore Completions
  app.get("/api/chore-completions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId, date } = req.query;
      
      if (profileId) {
        const isOwner = await validateProfileOwnership(profileId as string, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }
      
      let completions;
      if (profileId) {
        completions = await storage.getChoreCompletionsByProfile(profileId as string);
      } else if (date) {
        completions = await storage.getChoreCompletionsByUserAndDate(userId, new Date(date as string));
      } else {
        completions = await storage.getChoreCompletionsByUser(userId);
      }
      
      res.json(completions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch chore completions" });
    }
  });

  // ── Chore skips ("not today") ────────────────────────────────────────────
  // A skip is one person, one chore, one day — the temporary counterpart to
  // removing someone from a chore's assignee list, which is permanent.
  app.get("/api/chore-skips", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // Only recent days are ever consulted (today, or a day being reviewed),
      // so there's no reason to ship a family's whole history every load.
      const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      return res.json(await storage.getChoreSkips(userId, since));
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch chore skips" });
    }
  });

  app.post("/api/chore-skips", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { choreId, profileId, skipDate } = req.body ?? {};
      if (!choreId || !profileId || !skipDate) {
        return res.status(400).json({ message: "choreId, profileId and skipDate are required" });
      }
      if (!(await validateProfileOwnership(profileId, userId))) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      const day = new Date(skipDate);
      if (Number.isNaN(day.getTime())) {
        return res.status(400).json({ message: "skipDate is not a valid date" });
      }
      return res.json(await storage.addChoreSkip(userId, choreId, profileId, day));
    } catch (error) {
      req.log?.error?.({ error }, "Failed to skip chore for the day");
      return res.status(500).json({ message: "Failed to skip this chore for the day" });
    }
  });

  app.delete("/api/chore-skips", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { choreId, profileId, skipDate } = req.query as Record<string, string>;
      if (!choreId || !profileId || !skipDate) {
        return res.status(400).json({ message: "choreId, profileId and skipDate are required" });
      }
      const day = new Date(skipDate);
      if (Number.isNaN(day.getTime())) {
        return res.status(400).json({ message: "skipDate is not a valid date" });
      }
      return res.json({ removed: await storage.removeChoreSkip(userId, choreId, profileId, day) });
    } catch (error) {
      return res.status(500).json({ message: "Failed to undo this skip" });
    }
  });

  app.post("/api/chore-completions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Convert completedAt string to Date if provided
      const body = { ...req.body };
      if (body.completedAt && typeof body.completedAt === 'string') {
        body.completedAt = new Date(body.completedAt);
      }
      // The client's own local midnight for "today" — see the duplicate-completion
      // check below for why this can't just be recomputed from completedAt here.
      const clientLocalDayStart: Date | null = body.localDayStart ? new Date(body.localDayStart) : null;

      const completionData = insertChoreCompletionSchema.parse(body);

      if (completionData.profileId) {
        const isOwner = await validateProfileOwnership(completionData.profileId, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }

      // Family points mode: in "per_completion" the individual required
      // ("checklist") chores award nothing — finishing the whole day awards a
      // flat bonus instead. Bonus chores and to-dos keep their own points in
      // both modes, so only checklist chores are zeroed here.
      const rewardCfg = await storage.getRewardSettings(userId);
      const perCompletionMode = rewardCfg?.pointsMode === "per_completion";
      const completionBonusPoints = rewardCfg?.completionBonusPoints ?? 10;
      
      // Atomic bonus-chore cap enforcement + insert via DB transaction.
      // SELECT ... FOR UPDATE on the chore row serialises concurrent requests
      // for the same chore, preventing double-completion races at cap boundary.
      let capReached = false;
      let futureBlocked = false;
      let foreignChore = false;
      const completion = await db.transaction(async (tx) => {
        // Lock the chore row for the duration of this transaction so concurrent
        // requests for the same chore must queue behind us.
        const [choreRow] = await tx
          .select()
          .from(choresTbl)
          .where(eq(choresTbl.id, completionData.choreId))
          .for("update");

        // The profile was checked above; the CHORE was not. Completing another
        // household's chore needs its unguessable UUID, so this is defence in
        // depth rather than a reachable defect — but the chore row is already
        // locked here, so the check costs nothing and lives in the same
        // transaction as the insert.
        //
        // ⚠️ Deliberately checks the chore's OWNER, not whether this profile is
        // currently assigned to it. Requiring assignment would break bonus
        // chores (unassigned by design), shared chores, and any chore
        // reassigned after the fact.
        if (choreRow && choreRow.userId && choreRow.userId !== userId) {
          foreignChore = true;
          return null;
        }

        // Chores (not to-dos, which aren't schedule-bound) can't be completed
        // before their day arrives. clientLocalDayStart is the family's own
        // local midnight for the day being marked, as an absolute UTC instant —
        // comparing it directly to the server's own "now" tells us whether that
        // local day has actually started yet, with no timezone lookup needed.
        if (choreRow && choreRow.taskType !== "todo" && clientLocalDayStart && clientLocalDayStart.getTime() > Date.now()) {
          futureBlocked = true;
          return null;
        }

        // Cap enforcement only applies to bonus chores with a non-unlimited limit.
        if (
          choreRow?.isBonus &&
          choreRow.bonusFrequencyType &&
          choreRow.bonusFrequencyType !== "unlimited" &&
          choreRow.bonusFrequencyCount
        ) {
          let windowCount: number;
          if (choreRow.bonusFrequencyType === "total") {
            const rows = await tx
              .select({ id: choreCompletionsTbl.id })
              .from(choreCompletionsTbl)
              .where(eq(choreCompletionsTbl.choreId, completionData.choreId));
            windowCount = rows.length;
          } else {
            const windowStart = getBonusWindowStart(choreRow.bonusFrequencyPeriod ?? "week");
            const rows = await tx
              .select({ id: choreCompletionsTbl.id })
              .from(choreCompletionsTbl)
              .where(and(
                eq(choreCompletionsTbl.choreId, completionData.choreId),
                gte(choreCompletionsTbl.completedAt, windowStart)
              ));
            windowCount = rows.length;
          }
          if (windowCount >= choreRow.bonusFrequencyCount) {
            capReached = true;
            return null;
          }
        }

        // For regular (non-bonus) chores, prevent duplicate completions on the
        // same calendar day. Bonus chores already have their own cap logic above.
        if (!choreRow?.isBonus && completionData.profileId) {
          // Prefer the client's own local midnight over recomputing one here:
          // `.setHours(0,0,0,0)` on a bare Date uses the SERVER's local
          // timezone, which almost never matches the family's — that mismatch
          // meant this "already completed today" check could see a family's
          // very first completion of their day as colliding with a leftover
          // completion from the previous evening (still "today" in the
          // server's timezone), rejecting it every time.
          let dayStart: Date;
          let dayEnd: Date;
          if (clientLocalDayStart) {
            dayStart = clientLocalDayStart;
            dayEnd = new Date(clientLocalDayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
          } else {
            const completedAt = (completionData as any).completedAt || new Date();
            dayStart = new Date(completedAt);
            dayStart.setHours(0, 0, 0, 0);
            dayEnd = new Date(completedAt);
            dayEnd.setHours(0, 0, 0, 0);
            dayEnd.setDate(dayEnd.getDate() + 1);
          }
          const [existing] = await tx
            .select({ id: choreCompletionsTbl.id })
            .from(choreCompletionsTbl)
            .where(and(
              eq(choreCompletionsTbl.choreId, completionData.choreId),
              eq(choreCompletionsTbl.profileId, completionData.profileId),
              gte(choreCompletionsTbl.completedAt, dayStart),
              lt(choreCompletionsTbl.completedAt, dayEnd),
            ));
          if (existing) {
            capReached = true;
            return null;
          }
        }

        // Points are SERVER-AUTHORITATIVE: always take the chore's own
        // configured points, never the client-sent value. Otherwise any
        // authenticated device could POST `points: 999999` and inflate a
        // balance that feeds rewards and real-money cash-out. In per_completion
        // mode a required checklist chore earns 0 — its reward is the whole-day
        // bonus, not the individual task (bonus/target chores and to-dos keep
        // their own points in both modes).
        if (choreRow) {
          const isChecklistChore =
            choreRow.isActive === true &&
            !choreRow.isBonus &&
            (choreRow.targetCount == null || choreRow.targetCount <= 0) &&
            choreRow.taskType !== "todo";
          (completionData as any).points =
            perCompletionMode && isChecklistChore ? 0 : (choreRow.points ?? 0);
        }

        const [inserted] = await tx
          .insert(choreCompletionsTbl)
          .values(completionData as any)
          .returning();
        return inserted;
      });

      if (foreignChore) {
        return res.status(403).json({ message: "Access denied: that chore does not belong to you" });
      }
      if (futureBlocked) {
        return res.status(400).json({ message: "This chore isn't scheduled yet — you can check it off once that day arrives." });
      }
      if (capReached) {
        return res.status(409).json({ message: "This chore can't be completed again yet — the limit has been reached." });
      }

      // Check and award achievements after chore completion
      if (completionData.profileId) {
        try {
          const newAchievements = await checkAndAwardAchievements(completionData.profileId);
          if (newAchievements.length > 0) {
            console.log(`Awarded ${newAchievements.length} new achievement(s) to profile ${completionData.profileId}`);
          }
        } catch (achievementError) {
          console.error("Error checking achievements:", achievementError);
        }
        try {
          await checkAndAwardPerfectDay(completionData.profileId, clientLocalDayStart);
        } catch (perfectDayError) {
          console.error("Error checking perfect-day achievement:", perfectDayError);
        }
        // per_completion mode: (re)award the day's completion bonus if this
        // completion just finished the checklist.
        if (perCompletionMode) {
          try {
            await syncCompletionBonus(userId, completionData.profileId, clientLocalDayStart, completionBonusPoints);
          } catch (bonusError) {
            console.error("Error syncing completion bonus:", bonusError);
          }
        }
      }

      res.status(201).json(completion);
    } catch (error) {
      console.error("chore-completion error:", error);
      res.status(400).json({ message: "Invalid completion data" });
    }
  });

  // ===== Chore Wheel / Spin =====
  // The spin lifecycle is split into two endpoints to keep history honest:
  //   1. POST /api/chore-spins        — record the wheel result exactly once.
  //   2. POST /api/chore-spins/:id/assign — turn that recorded spin into a
  //      today-only chore for the winner. Updates the original spin row in
  //      place so we never write two history rows for the same spin.
  // We also expose GET /api/chore-spins/last-winner so the fairness toggle can
  // look up the authoritative most-recent winner across full history (not just
  // the bounded recent list shown in the modal).
  const choreSpinSubmitSchema = z.object({
    choreTitle: z.string().min(1).max(120),
    choreId: z.string().nullable().optional(),
    eligibleProfileIds: z.array(z.string()).min(1),
    winnerProfileId: z.string(),
    excludedRecentWinner: z.boolean().optional(),
  });
  app.post("/api/chore-spins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const body = choreSpinSubmitSchema.parse(req.body);

      // Validate eligible + winner profiles belong to this user
      const profileIdsToCheck = Array.from(new Set([...body.eligibleProfileIds, body.winnerProfileId]));
      for (const pid of profileIdsToCheck) {
        const ok = await validateProfileOwnership(pid, userId);
        if (!ok) return res.status(403).json({ message: "One or more profiles do not belong to you" });
      }
      if (!body.eligibleProfileIds.includes(body.winnerProfileId)) {
        return res.status(400).json({ message: "Winner must be one of the eligible profiles" });
      }

      // Validate referenced chore (if any) belongs to user
      if (body.choreId) {
        const userChores = await storage.getChoresByUser(userId);
        const sourceChore = userChores.find(c => c.id === body.choreId);
        if (!sourceChore) return res.status(404).json({ message: "Chore not found" });
      }

      const spin = await storage.createChoreSpin({
        userId,
        choreTitle: body.choreTitle,
        choreId: body.choreId ?? null,
        eligibleProfileIds: body.eligibleProfileIds,
        winnerProfileId: body.winnerProfileId,
        excludedRecentWinner: body.excludedRecentWinner ?? false,
        assignedChoreId: null,
      });
      res.status(201).json(spin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid spin data";
      res.status(400).json({ message });
    }
  });

  // Convert a recorded spin into a today-only chore for its winner.
  //
  // Assignment strategy (intentional one-off):
  //   - We model "just for today" by creating a normal chore whose
  //     daysOfWeek = [today's DOW] and endDate = end of today (23:59:59.999).
  //     This piggy-backs on the existing recurrence/ filtering logic so the
  //     assignment shows up exactly once on today's chores list and is
  //     automatically gone tomorrow (no separate ad-hoc table needed).
  //   - Dedupe: if there's already an active chore today for this user with
  //     the same title that already includes the winner, we LINK to it
  //     instead of creating a duplicate (covers re-spins of the same source
  //     chore, or assigning a wheel chore that was already scheduled today).
  //   - Idempotent: re-calling assign for the same spin returns the existing
  //     assignedChoreId without side effects.
  //
  // Optional `points` overrides the source-chore points (or the default of 1
  // when the spin was for an ad-hoc chore).
  const assignSpinSchema = z.object({
    points: z.number().int().min(0).max(50).optional(),
  });
  app.post("/api/chore-spins/:id/assign", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const spinId = req.params.id;
      const { points: pointsOverride } = assignSpinSchema.parse(req.body ?? {});

      const spin = await storage.getChoreSpin(spinId, userId);
      if (!spin) return res.status(404).json({ message: "Spin not found" });
      if (!spin.winnerProfileId) {
        return res.status(400).json({ message: "Spin has no winner to assign" });
      }
      // Idempotency: if this spin was already assigned, return the existing chore.
      if (spin.assignedChoreId) {
        return res.json({ spin, assignedChoreId: spin.assignedChoreId });
      }

      // Look up the source chore (if any) to inherit description/points
      let sourceChore = null as null | Awaited<ReturnType<typeof storage.getChoresByUser>>[number];
      const userChores = await storage.getChoresByUser(userId);
      if (spin.choreId) {
        sourceChore = userChores.find(c => c.id === spin.choreId) ?? null;
      }

      const today = new Date();
      const dow = today.getDay();
      const startOfToday = new Date(today);
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(today);
      endOfToday.setHours(23, 59, 59, 999);

      // Dedupe: if there's already an active chore today for this user with the
      // same title that includes the winner, link to it instead of creating a
      // duplicate. Keeps today's chores list clean across re-spins.
      const titleKey = (spin.choreTitle || "").trim().toLowerCase();
      const winnerId = spin.winnerProfileId;
      const duplicate = userChores.find(c => {
        if (!c.isActive) return false;
        if ((c.title || "").trim().toLowerCase() !== titleKey) return false;
        if (Array.isArray(c.daysOfWeek) && !c.daysOfWeek.includes(dow)) return false;
        if (c.endDate && new Date(c.endDate) < startOfToday) return false;
        const ids = Array.isArray(c.profileIds) ? c.profileIds : [];
        return ids.includes(winnerId);
      });

      let assignedChoreId: string;
      if (duplicate) {
        assignedChoreId = duplicate.id;
      } else {
        const points = pointsOverride ?? sourceChore?.points ?? 1;
        const created = await storage.createChore({
          userId,
          title: spin.choreTitle,
          description: sourceChore?.description ?? "Wheel spin assignment",
          points,
          profileIds: [winnerId],
          daysOfWeek: [dow],
          recurrenceType: "weekly",
          endDate: endOfToday,
          category: "wheel",
          isActive: true,
        });
        assignedChoreId = created.id;
      }

      const updated = await storage.setChoreSpinAssignment(spinId, userId, assignedChoreId);
      res.json({ spin: updated ?? spin, assignedChoreId });

      // Own try/catch: res is already sent above. Only fires on a genuinely
      // new assignment (the idempotent early-return above never reaches here).
      try {
        await sendPushToUser(
          { userId, profileId: winnerId },
          {
            title: "You were assigned a chore!",
            body: spin.choreTitle,
            url: "/?openTab=chores",
            tag: `chore-assigned-${assignedChoreId}`,
            data: { kind: "chore-assigned", choreId: assignedChoreId, profileId: winnerId },
          },
          "choreAssigned",
        );
      } catch (err) {
        console.error("Failed to send chore-assigned notification:", err);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to assign spin";
      res.status(400).json({ message });
    }
  });

  app.get("/api/chore-spins/recent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(parseInt((req.query.limit as string) || "5", 10) || 5, 25);
      const spins = await storage.getRecentChoreSpins(userId, limit);
      res.json(spins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent spins" });
    }
  });

  // Authoritative latest winner for a given chore (by id or normalized title).
  // Used by the wheel modal's fairness toggle so it never silently misses a
  // stale winner that fell off the bounded recent-spins list.
  app.get("/api/chore-spins/last-winner", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const choreId = typeof req.query.choreId === "string" && req.query.choreId.length > 0
        ? (req.query.choreId as string)
        : null;
      const choreTitle = typeof req.query.choreTitle === "string"
        ? (req.query.choreTitle as string)
        : null;
      if (!choreId && !choreTitle) {
        return res.status(400).json({ message: "Provide choreId or choreTitle" });
      }
      const last = await storage.getLastChoreWinner(userId, { choreId, choreTitle });
      res.json({ winnerProfileId: last?.winnerProfileId ?? null, spinId: last?.id ?? null });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch last winner" });
    }
  });

  app.delete("/api/chore-completions/:choreId/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { choreId, profileId } = req.params;

      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }

      // Delete first; only audit-log if a completion row was actually removed,
      // preventing false history entries on duplicate/stale requests.
      // Determine which calendar day to un-complete. Prefer the client's own
      // local midnight (?localDayStart=, an absolute UTC instant — the same
      // value the completion POST sent), because `.setHours(0,0,0,0)` below
      // uses the SERVER's timezone: for a family in a different timezone that
      // window can target the wrong local day, deleting 0 rows and leaving the
      // chore stuck checked. The ?date=/server-now fallbacks remain for old
      // clients only.
      const clientDayStartRaw = req.query.localDayStart ? new Date(req.query.localDayStart as string) : null;
      const clientDayStart = clientDayStartRaw && !isNaN(clientDayStartRaw.getTime()) ? clientDayStartRaw : null;
      let dayStart: Date;
      let dayEnd: Date;
      if (clientDayStart) {
        dayStart = clientDayStart;
        dayEnd = new Date(clientDayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
      } else {
        const targetDate = req.query.date ? new Date(req.query.date as string) : new Date();
        dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);
        dayEnd = new Date(targetDate);
        dayEnd.setHours(0, 0, 0, 0);
        dayEnd.setDate(dayEnd.getDate() + 1);
      }

      // To-dos are one-time items, not daily-recurring — they can be checked
      // off on one day and unchecked while viewing a different one (the
      // client no longer scopes their "is this done" read to the viewed day
      // either, see chores-view.tsx/people-view.tsx). Restricting the delete
      // to the viewed day's window would silently remove 0 rows whenever the
      // real completion falls on a different day, leaving the to-do stuck
      // checked with no error. Uncompleting a to-do removes its one
      // completion regardless of which day it actually happened on.
      const [choreRow] = await db
        .select({ taskType: choresTbl.taskType })
        .from(choresTbl)
        .where(and(eq(choresTbl.id, choreId), eq(choresTbl.userId, userId)));
      const isTodo = choreRow?.taskType === "todo";

      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(choreCompletionsTbl)
          .where(
            isTodo
              ? and(
                  eq(choreCompletionsTbl.choreId, choreId),
                  eq(choreCompletionsTbl.profileId, profileId),
                )
              : and(
                  eq(choreCompletionsTbl.choreId, choreId),
                  eq(choreCompletionsTbl.profileId, profileId),
                  gte(choreCompletionsTbl.completedAt, dayStart),
                  lt(choreCompletionsTbl.completedAt, dayEnd),
                )
          )
          .returning({ id: choreCompletionsTbl.id });

        if (deleted.length === 0) return; // nothing was removed — skip audit

        const [chore] = await tx
          .select({ title: choresTbl.title, points: choresTbl.points })
          .from(choresTbl)
          .where(and(eq(choresTbl.id, choreId), eq(choresTbl.userId, userId)));

        await tx.insert(activityLogTbl).values({
          userId,
          profileId,
          activityType: 'chore_uncomplete',
          entityId: choreId,
          entityTitle: chore?.title ?? null,
          metadata: { points: chore?.points ?? 0 },
        });
      });

      // per_completion mode: if un-completing this chore dropped the day's
      // checklist back below complete, remove that day's bonus. The client
      // sends the same local-midnight instant it sent when completing, so the
      // bonus row's day-key matches regardless of server timezone.
      const rewardCfg = await storage.getRewardSettings(userId);
      if (rewardCfg?.pointsMode === "per_completion") {
        const clientLocalDayStart: Date | null = req.query.localDayStart
          ? new Date(req.query.localDayStart as string)
          : null;
        try {
          await syncCompletionBonus(userId, profileId, clientLocalDayStart, rewardCfg.completionBonusPoints ?? 10);
        } catch (bonusError) {
          console.error("Error syncing completion bonus on uncomplete:", bonusError);
        }
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete chore completion" });
    }
  });

  // Achievements
  app.get("/api/achievements", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.query;
      
      if (profileId) {
        const isOwner = await validateProfileOwnership(profileId as string, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }
      
      let achievements;
      if (profileId) {
        achievements = await storage.getAchievementsByProfile(profileId as string);
      } else {
        achievements = await storage.getAchievementsByUser(userId);
      }
      
      res.json(achievements);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch achievements" });
    }
  });

  // Retroactively check and award achievements for all profiles belonging to the user
  app.post("/api/achievements/check-all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profiles = await storage.getProfilesByUser(userId);
      
      const allNewAchievements: any[] = [];
      
      for (const profile of profiles) {
        if (!profile.isAllFamilyProfile) {
          const newAchievements = await checkAndAwardAchievements(profile.id);
          if (newAchievements.length > 0) {
            allNewAchievements.push({
              profileId: profile.id,
              profileName: profile.name,
              achievements: newAchievements,
            });
          }
        }
      }
      
      res.json({
        message: `Checked ${profiles.length} profiles`,
        newAchievements: allNewAchievements,
      });
    } catch (error) {
      console.error("Error checking achievements:", error);
      res.status(500).json({ message: "Failed to check achievements" });
    }
  });

  app.post("/api/achievements", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const achievementData = req.body;
      
      if (achievementData.profileId) {
        const isOwner = await validateProfileOwnership(achievementData.profileId, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }
      
      const achievement = await storage.createAchievement(achievementData);
      res.status(201).json(achievement);
    } catch (error) {
      res.status(400).json({ message: "Invalid achievement data" });
    }
  });

  // Custom Profile Groups
  app.get("/api/custom-profile-groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const groups = await storage.getCustomProfileGroups(userId);
      res.json(groups);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch custom profile groups" });
    }
  });

  app.post("/api/custom-profile-groups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { name, profileIds, color, icon } = req.body;
      
      if (!name || !profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
        return res.status(400).json({ message: "Name and at least one profile are required" });
      }
      
      const group = await storage.createCustomProfileGroup({
        userId,
        name,
        profileIds,
        color: color || "#6366f1",
        icon: icon || "👥",
      });
      res.status(201).json(group);
    } catch (error) {
      res.status(400).json({ message: "Failed to create custom profile group" });
    }
  });

  app.patch("/api/custom-profile-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { name, profileIds, color, icon, displayOrder } = req.body;

      const group = await storage.updateCustomProfileGroup(id, { name, profileIds, color, icon, displayOrder }, userId);
      if (!group) {
        return res.status(404).json({ message: "Custom profile group not found" });
      }
      res.json(group);
    } catch (error) {
      res.status(400).json({ message: "Failed to update custom profile group" });
    }
  });

  // Reorder custom groups by drag-and-drop — persists a full ordered list of
  // ids in one call rather than N separate PATCHes for each moved row.
  app.post("/api/custom-profile-groups/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
        return res.status(400).json({ message: "Couldn't save the new order — please try again." });
      }
      await storage.reorderCustomProfileGroups(userId, orderedIds);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to reorder custom profile groups" });
    }
  });

  app.delete("/api/custom-profile-groups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const success = await storage.deleteCustomProfileGroup(id, userId);
      if (!success) {
        return res.status(404).json({ message: "Custom profile group not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete custom profile group" });
    }
  });

  // Rewards
  app.get("/api/rewards", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const rewards = await storage.getRewardsByUser(userId);
      res.json(rewards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch rewards" });
    }
  });

  app.get("/api/rewards/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const reward = await storage.getRewardById(req.params.id);
      if (!reward) {
        return res.status(404).json({ message: "Reward not found" });
      }
      // Verify the reward belongs to the authenticated user
      if (reward.userId !== userId) {
        return res.status(403).json({ message: "Access denied: Reward does not belong to you" });
      }
      res.json(reward);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch reward" });
    }
  });

  app.post("/api/rewards", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const rewardData = insertRewardSchema.parse(req.body);
      const reward = await storage.createReward({ ...rewardData, userId });
      res.status(201).json(reward);
    } catch (error) {
      res.status(400).json({ message: "Invalid reward data" });
    }
  });

  app.patch("/api/rewards/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertRewardSchema.partial().parse(req.body);
      const reward = await storage.updateReward(req.params.id, updates, userId);
      if (!reward) {
        return res.status(404).json({ message: "Reward not found" });
      }
      res.json(reward);
    } catch (error) {
      res.status(400).json({ message: "Invalid reward data" });
    }
  });

  app.delete("/api/rewards/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteReward(req.params.id, userId);
      if (!success) {
        return res.status(404).json({ message: "Reward not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete reward" });
    }
  });

  // Reward Redemptions
  app.get("/api/reward-redemptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.query;
      
      if (profileId) {
        const isOwner = await validateProfileOwnership(profileId as string, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }
      
      const redemptions = await storage.getRewardRedemptionsByUser(userId, profileId as string | undefined);
      res.json(redemptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch redemptions" });
    }
  });

  app.post("/api/reward-redemptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!(await requireEntitled(getAuthAccountId(req), res))) return;
      // Coerce ISO-string timestamps to Date before Zod validation (z.date() rejects strings)
      const rawBody = { ...req.body };
      if (typeof rawBody.redeemedAt === "string") rawBody.redeemedAt = new Date(rawBody.redeemedAt);
      if (typeof rawBody.unlockedAt === "string") rawBody.unlockedAt = new Date(rawBody.unlockedAt);
      const redemptionData = insertRewardRedemptionSchema.parse(rawBody);
      
      // Validate profile belongs to user
      if (redemptionData.profileId) {
        const isOwner = await validateProfileOwnership(redemptionData.profileId, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
      }
      
      // Validate reward belongs to user and check points
      let reward = null;
      if (redemptionData.rewardId) {
        reward = await storage.getRewardById(redemptionData.rewardId);
        if (!reward || reward.userId !== userId) {
          return res.status(403).json({ message: "Access denied: Reward does not belong to you" });
        }
      }
      
      // Validate profile has enough points to redeem the reward
      if (reward && redemptionData.profileId) {
        const profilePoints = await storage.getProfilePoints(redemptionData.profileId);
        if (profilePoints < reward.pointsCost) {
          return res.status(400).json({ 
            message: `Not enough stars. Need ${reward.pointsCost}, but only have ${profilePoints}.` 
          });
        }
        
        // Multiple redemptions of the same reward are allowed — no duplicate check.
      }
      
      const redemption = await storage.createRewardRedemption(redemptionData);
      res.status(201).json(redemption);

      if (redemption.status === "redeemed" && redemption.profileId) {
        checkAndAwardAchievements(redemption.profileId).catch((err) => console.error("Error checking achievements:", err));
      }

      // Fire-and-forget after responding — parents need to know a reward was
      // redeemed so they actually deliver it, but this must never delay or
      // fail the redemption itself (own try/catch: the outer one would
      // otherwise try to send a second response on error, since res is
      // already sent above).
      if (reward && redemptionData.profileId) {
        try {
          const profile = await storage.getProfile(redemptionData.profileId);
          await notifyFamily(
            userId,
            {
              title: `${profile?.name ?? "Someone"} redeemed a reward!`,
              body: `${reward.title} (${reward.pointsCost} stars)`,
              url: "/?openTab=chores&openSubTab=rewards",
              tag: `reward-redemption-${redemption.id}`,
              data: { kind: "reward-redeemed", redemptionId: redemption.id, profileId: redemptionData.profileId },
            },
            "rewardRedeemed",
          );
        } catch (err) {
          console.error("Failed to send reward-redeemed notification:", err);
        }
      }
    } catch (error) {
      res.status(400).json({ message: "Invalid redemption data" });
    }
  });

  app.patch("/api/reward-redemptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertRewardRedemptionSchema.partial().parse(req.body);
      const redemption = await storage.updateRewardRedemption(req.params.id, updates, userId);
      if (!redemption) {
        return res.status(404).json({ message: "Redemption not found" });
      }
      res.json(redemption);

      if (redemption.status === "redeemed" && redemption.profileId) {
        checkAndAwardAchievements(redemption.profileId).catch((err) => console.error("Error checking achievements:", err));
      }
    } catch (error) {
      res.status(400).json({ message: "Invalid redemption data" });
    }
  });

  // Gamification Stats
  app.get("/api/points/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      
      const points = await storage.getProfilePoints(profileId);
      res.json({ profileId, points });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stars" });
    }
  });

  // Read-only star history for the Insights card — chronological signed
  // events (earned/spent) + totals + the authoritative balance (matches the
  // star pill). Additive; changes nothing about how points are computed.
  app.get("/api/stars/ledger/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      const ledger = await storage.getStarLedger(profileId);
      res.json(ledger);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch star history" });
    }
  });

  app.post("/api/points/:profileId/adjust", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        delta: z.number().int().min(-10000).max(10000),
        reason: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body);
      const adj = await storage.createPointAdjustment({
        userId,
        profileId: profile.id,
        delta: body.delta,
        reason: body.reason?.trim() || null,
      });
      res.status(201).json(adj);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      req.log?.warn?.({ err }, "point adjustment failed");
      res.status(500).json({ message: "Failed to adjust stars" });
    }
  });

  app.get("/api/streaks/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      
      const details = await storage.getProfileStreakDetails(profileId);
      res.json({ profileId, streak: details.streak, ...details });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch streak" });
    }
  });

  app.get("/api/streak-freezes/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ message: "Access denied" });
      const [freezes, details] = await Promise.all([
        storage.getStreakFreezesForProfile(profileId, 12),
        storage.getProfileStreakDetails(profileId),
      ]);
      res.json({ profileId, freezes, ...details });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch streak freezes" });
    }
  });

  app.post("/api/streak-freezes/:profileId/use", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ message: "Access denied" });

      // Compute the user-local "yesterday" using their timezone, then enforce
      // the policy: a freeze can only be used for that exact day, and only
      // when it would actually preserve an existing streak.
      const settings = await storage.getLocationSettingsByUser(userId);
      const tz = settings?.timezone || "America/Chicago";
      const now = new Date();
      const yesterdayKey = yesterdayKeyTz(tz, now);
      // Week key is derived directly from yesterday's date string so it always
      // matches the eligibility check in getProfileStreakDetails.
      const wk = isoWeekKeyFromDateKey(yesterdayKey);

      const rawDate: string | undefined = req.body?.date;
      if (rawDate !== undefined && rawDate !== yesterdayKey) {
        return res.status(400).json({ message: "Streak freezes can only be used for yesterday" });
      }

      // Verify eligibility: this week's freeze is unused AND would actually
      // bridge a real streak.
      const details = await storage.getProfileStreakDetails(profileId);
      if (!details.hasFreezeThisWeek) {
        return res.status(409).json({ message: "A streak freeze is already used for this week" });
      }
      if (!details.canUseFreezeForYesterday) {
        return res.status(400).json({ message: "No streak gap to bridge for yesterday" });
      }

      const { created, freeze } = await storage.createStreakFreeze({
        profileId,
        userId,
        weekKey: wk,
        usedForDate: yesterdayKey,
      });
      const updated = await storage.getProfileStreakDetails(profileId);
      res.status(created ? 201 : 200).json({ freeze, ...updated });
    } catch (error) {
      res.status(500).json({ message: "Failed to use streak freeze" });
    }
  });

  // ─── Comments (polymorphic on chore/event) ─────────────────────────────
  const ENTITY_TYPES = new Set(["chore", "event"]);

  // Verify a comment's target entity belongs to this user. Native chores and
  // events live in the DB and are looked up directly. Google Calendar events are
  // surfaced on the client with synthetic "google-<id>" ids and are never stored
  // in the events table — they still belong to the authenticated user's calendar,
  // and comments are always user-scoped on both read and write, so we accept
  // those ids here. Without this, commenting on any imported calendar event 404s.
  const userOwnsCommentEntity = async (
    userId: string,
    entityType: string,
    entityId: string,
  ): Promise<boolean> => {
    if (entityType === "chore") {
      return (await storage.getChoresByUser(userId)).some((c) => c.id === entityId);
    }
    if (entityId.startsWith("google-")) return true;
    return (await storage.getEventsByUser(userId)).some((e) => e.id === entityId);
  };

  app.get("/api/comments/:entityType/:entityId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { entityType, entityId } = req.params;
      if (!ENTITY_TYPES.has(entityType)) return res.status(400).json({ message: "Invalid entityType" });
      // Verify the entity belongs to this user before returning anything.
      const ownsEntity = await userOwnsCommentEntity(userId, entityType, entityId);
      if (!ownsEntity) return res.status(404).json({ message: "Not found" });
      const rows = await storage.listComments(userId, entityType, entityId);
      res.json(rows);
    } catch (err) {
      req.log?.warn?.({ err }, "list comments failed");
      res.status(500).json({ message: "Failed to list comments" });
    }
  });

  app.post("/api/comments/:entityType/:entityId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { entityType, entityId } = req.params;
      if (!ENTITY_TYPES.has(entityType)) return res.status(400).json({ message: "Invalid entityType" });
      const schema = z.object({
        message: z.string().trim().min(1).max(500),
        authorProfileId: z.string().min(1).optional(),
      });
      const body = schema.parse(req.body);
      // Validate ownership of target entity.
      const ownsEntity = await userOwnsCommentEntity(userId, entityType, entityId);
      if (!ownsEntity) return res.status(404).json({ message: "Not found" });
      // Validate authorProfile if given.
      let authorProfileId: string | null = null;
      if (body.authorProfileId) {
        const profile = await storage.getProfile(body.authorProfileId);
        if (!profile || profile.userId !== userId) return res.status(403).json({ message: "Not your profile" });
        authorProfileId = profile.id;
      }
      const row = await storage.createComment({
        userId,
        entityType,
        entityId,
        authorProfileId,
        message: body.message,
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid comment", issues: err.issues });
      req.log?.warn?.({ err }, "create comment failed");
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

  app.delete("/api/comments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.deleteComment(req.params.id, userId);
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  // ─── Family share tokens (public read-only links) ──────────────────────
  app.get("/api/share-tokens", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      res.json(await storage.listShareTokens(userId));
    } catch (err) {
      req.log?.warn?.({ err }, "list share tokens failed");
      res.status(500).json({ message: "Failed to list share links" });
    }
  });

  app.post("/api/share-tokens", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        label: z.string().trim().max(80).optional(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      });
      const body = schema.parse(req.body ?? {});
      const token = randomBytes(18).toString("base64url");
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;
      const row = await storage.createShareToken({
        userId,
        token,
        label: body.label?.trim() || null,
        expiresAt,
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      req.log?.warn?.({ err }, "create share token failed");
      res.status(500).json({ message: "Failed to create share link" });
    }
  });

  app.delete("/api/share-tokens/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.revokeShareToken(req.params.id, userId);
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to revoke share link" });
    }
  });

  // PUBLIC — no auth. Returns sanitized week view for grandparents.
  app.get("/api/public/share/:token", async (req: any, res) => {
    try {
      const row = await storage.getShareTokenByToken(req.params.token);
      if (!row || row.revokedAt) return res.status(404).json({ message: "Link not found" });
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return res.status(410).json({ message: "Link expired" });
      }
      const userId = row.userId;
      // Sanitize: only public-safe fields.
      const profiles = (await storage.getProfilesByUser(userId))
        .filter((p) => !p.isAllFamilyProfile)
        .map((p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji }));
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(now.getDate() - now.getDay()); // Sunday
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const events = (await storage.getEventsByDateRange(weekStart, weekEnd))
        .filter((e) => e.userId === userId)
        .map((e) => ({
          id: e.id,
          title: e.title,
          startTime: e.startTime,
          endTime: e.endTime,
          isAllDay: e.isAllDay,
          location: e.location,
          profileIds: e.profileIds ?? [],
        }));
      // Limit to a small set of public-safe chore fields (rotation snapshot only).
      const chores = (await storage.getChoresByUser(userId))
        .slice(0, 30)
        .map((c) => ({
          id: c.id,
          title: c.title,
          profileIds: c.profileIds ?? [],
        }));
      // fire-and-forget touch
      storage.touchShareToken(row.id).catch(() => {});
      res.set("Cache-Control", "no-store");
      res.json({
        label: row.label,
        profiles,
        events,
        chores,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
      });
    } catch (err) {
      req.log?.warn?.({ err }, "public share failed");
      res.status(500).json({ message: "Failed to load share" });
    }
  });

  // ─── Allowance ─────────────────────────────────────────────────────────
  async function loadAllowanceState(userId: string, profileId: string) {
    const settings = await storage.getAllowanceSettings(profileId);
    const earned = await storage.getProfilePoints(profileId);
    const paid = await storage.getTotalAllowancePaidPoints(profileId);
    const pendingPoints = Math.max(0, earned - paid);
    const cents = settings?.centsPerPoint ?? 0;
    const pendingCents = pendingPoints * cents;
    return { settings, earned, paid, pendingPoints, pendingCents };
  }

  app.get("/api/allowance/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const state = await loadAllowanceState(userId, profile.id);
      const payouts = await storage.listAllowancePayouts(profile.id, 20);
      res.json({ ...state, payouts });
    } catch (err) {
      req.log?.warn?.({ err }, "get allowance failed");
      res.status(500).json({ message: "Failed to load allowance" });
    }
  });

  app.put("/api/allowance/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        centsPerPoint: z.number().int().min(0).max(1000),
        currency: z.string().trim().min(1).max(8).optional(),
      });
      const body = schema.parse(req.body);
      const row = await storage.upsertAllowanceSettings({
        userId,
        profileId: profile.id,
        centsPerPoint: body.centsPerPoint,
        currency: body.currency,
      });
      res.json(row);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to save allowance settings" });
    }
  });

  app.post("/api/allowance/:profileId/cashout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({ note: z.string().trim().max(140).optional() });
      const body = schema.parse(req.body ?? {});
      const state = await loadAllowanceState(userId, profile.id);
      if (state.pendingPoints <= 0) return res.status(400).json({ message: "Nothing pending to cash out" });
      if ((state.settings?.centsPerPoint ?? 0) <= 0) return res.status(400).json({ message: "Set an allowance rate first" });
      const payout = await storage.createAllowancePayout({
        userId,
        profileId: profile.id,
        points: state.pendingPoints,
        amountCents: state.pendingCents,
        note: body.note?.trim() || null,
      });
      res.status(201).json(payout);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      req.log?.warn?.({ err }, "cashout failed");
      res.status(500).json({ message: "Failed to cash out" });
    }
  });

  // ─── Wallet ────────────────────────────────────────────────────────────
  // Available points = earned (completions + adjustments) − reserved cashout points.
  // "Reserved" covers both approved cashouts (permanently debited) AND pending
  // requests (reserved the instant they're submitted, so a kid can't request more
  // than they have while a request is still awaiting parent approval). Legacy
  // allowance_payouts are NOT deducted here; the new cashout flow records
  // approvals as wallet_transactions (type="cashout_approved"), not allowance_payouts.
  // Optional dbClient: pass the transaction's own client (see DbOrTx) when
  // calling this from inside a db.transaction(...) that also holds a row
  // lock (the cash-out flows below) — otherwise this reaches back into the
  // shared pool for a second connection while the first is held open, which
  // is exactly what caused a real production deadlock/timeout under load.
  async function loadAvailablePoints(profileId: string, dbClient?: DbOrTx): Promise<number> {
    // getProfilePoints already subtracts reserved (pending + approved) cash-out
    // points, so the star pill and this "available" figure stay in sync — don't
    // subtract reserved a second time here or it would double-count.
    return Math.max(0, await storage.getProfilePoints(profileId, dbClient));
  }

  // ── Reward Settings ───────────────────────────────────────────────────
  function sanitizeRewardSettings(row: any) {
    const { parentPin, pinResetCodeHash, pinResetCodeExpiresAt, ...rest } = row;
    return { ...rest, hasParentPin: !!parentPin };
  }

  app.get("/api/reward-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      let settings = await storage.getRewardSettings(userId);
      if (!settings) {
        const walletCfg = await storage.getWalletSettings(userId);
        const allProfiles = await storage.getProfilesByUser(userId);
        // 10 cents/star (10 stars per dollar) and a 10-star cashout minimum
        // are just sensible starting numbers for a family that's never
        // configured this before (works out to a $1 minimum) — an existing
        // per-profile allowance rate, if one was already set up, still
        // takes priority.
        let centsPerPoint = 10;
        for (const p of allProfiles) {
          const a = await storage.getAllowanceSettings(p.id);
          if (a && a.centsPerPoint > 0) { centsPerPoint = a.centsPerPoint; break; }
        }
        settings = await storage.upsertRewardSettings({
          userId,
          redemptionMode: "rewards_only",
          centsPerPoint,
          currencySymbol: walletCfg?.currencySymbol ?? "$",
          minCashoutPoints: 10,
        });
      }
      res.json(sanitizeRewardSettings(settings));
    } catch (err) {
      req.log?.warn?.({ err }, "reward settings fetch failed");
      res.status(500).json({ message: "Failed to load reward settings" });
    }
  });

  app.put("/api/reward-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        redemptionMode: z.enum(["rewards_only", "cashout_only", "both"]).optional(),
        centsPerPoint: z.number().int().min(0).max(10000).optional(),
        currencySymbol: z.string().trim().min(1).max(4).optional(),
        minCashoutPoints: z.number().int().min(0).optional(),
        pointsMode: z.enum(["per_chore", "per_completion"]).optional(),
        completionBonusPoints: z.number().int().min(1).max(1000).optional(),
        parentPin: z.string().regex(/^\d{4}$/).nullable().optional(),
        pinGatedFeatures: z.array(z.string()).nullable().optional(),
        // Only needed when CHANGING an already-set PIN (see the guard below) —
        // proof that the request really is a parent, not just anyone who
        // happens to have the family's shared login session open on a kid's
        // device (e.g. a child on the "All Family" profile, which isn't
        // PIN-gated). One of the two, not both.
        accountPassword: z.string().optional(),
        pinResetCode: z.string().optional(),
      });
      const { accountPassword, pinResetCode, ...body } = schema.parse(req.body);

      const existing = await storage.getRewardSettings(userId);
      const changingExistingPin = body.parentPin !== undefined && !!existing?.parentPin;
      let clearResetCode = false;

      if (changingExistingPin) {
        const accountId = getAuthAccountId(req);
        if (!checkRateLimit(`pin-change:${accountId}`, 10, 15 * 60 * 1000)) {
          return res.status(429).json({ message: "Too many attempts — try again in a few minutes." });
        }
        let verified = false;
        if (accountPassword) {
          const account = await authStorage.getUser(accountId);
          verified = !!(
            account?.authProvider === "email" &&
            account.passwordHash &&
            (await verifyPassword(accountPassword, account.passwordHash))
          );
          if (!verified) return res.status(403).json({ message: "That password isn't correct." });
        } else if (pinResetCode) {
          const codeOk =
            !!existing?.pinResetCodeHash &&
            !!existing?.pinResetCodeExpiresAt &&
            existing.pinResetCodeExpiresAt.getTime() >= Date.now() &&
            timingSafeEqual(
              Buffer.from(createHash("sha256").update(pinResetCode).digest("hex")),
              Buffer.from(existing.pinResetCodeHash),
            );
          if (!codeOk) return res.status(403).json({ message: "That code is incorrect or has expired." });
          verified = true;
          clearResetCode = true; // single-use
        } else {
          return res.status(403).json({
            message: "Enter your account password (or request an email code) to change the PIN.",
          });
        }
        if (!verified) return res.status(403).json({ message: "Couldn't verify your identity." });
      }

      const row = await storage.upsertRewardSettings({
        userId,
        ...body,
        ...(clearResetCode ? { pinResetCodeHash: null, pinResetCodeExpiresAt: null } : {}),
      });
      res.json(sanitizeRewardSettings(row));
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to save reward settings" });
    }
  });

  // "Forgot PIN": emails a one-time code to the CALLER'S OWN registered
  // account email (not typed into any on-screen field, so a kid on a shared
  // device never sees it) — proof of identity to change an existing Parent
  // PIN without knowing it. The code is checked by PUT /api/reward-settings
  // above via its `pinResetCode` field.
  app.post("/api/reward-settings/request-pin-reset-code", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = getAuthAccountId(req);
      // Per-account, not per-family: two different family members requesting
      // codes shouldn't share one budget or invalidate each other's in-flight
      // code (the DB row only holds one at a time — the last request wins,
      // same "one outstanding token" pattern as the password-reset flow).
      if (!checkRateLimit(`pin-reset-request:${accountId}`, 5, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many requests — try again in a bit." });
      }
      const account = await authStorage.getUser(accountId);
      if (!account?.email) {
        return res.status(400).json({ message: "Your account has no email on file to send a code to." });
      }
      const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
      const codeHash = createHash("sha256").update(code).digest("hex");
      await storage.upsertRewardSettings({
        userId,
        pinResetCodeHash: codeHash,
        pinResetCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      const name = account.firstName ? escapeHtml(account.firstName) : "there";
      try {
        await sendEmail({
          to: account.email,
          subject: "Your SuperHub PIN reset code",
          html: `<p>Hi ${name},</p><p>Your one-time code to reset the Parent PIN is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>It expires in 10 minutes. If you didn't request this, you can safely ignore this email — your PIN won't change.</p>`,
          text: `Hi ${name},\n\nYour one-time code to reset the Parent PIN is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can safely ignore this email — your PIN won't change.`,
        });
      } catch (err) {
        req.log?.warn?.({ err }, "pin reset code email failed to send");
        return res.status(500).json({ message: "Couldn't send the email — check the server's email configuration." });
      }
      res.json({ ok: true, sentTo: account.email });
    } catch (err) {
      res.status(500).json({ message: "Failed to request a reset code" });
    }
  });

  // ── Onboarding walkthrough progress ─────────────────────────────────────────
  app.get("/api/onboarding-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const row = await storage.getOnboardingStatus(userId);
      res.json(row ?? {
        profileStatus: null, profileDismissedUntil: null,
        locationStatus: null, locationDismissedUntil: null,
        rewardsStatus: null, rewardsDismissedUntil: null,
        inviteStatus: null, inviteDismissedUntil: null,
        calendarStatus: null, calendarDismissedUntil: null,
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to load onboarding status" });
    }
  });

  app.patch("/api/onboarding-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        step: z.enum(["profile", "location", "rewards", "invite", "calendar"]),
        action: z.enum(["skip", "done", "dismiss"]),
      });
      const { step, action } = schema.parse(req.body);
      const patch =
        action === "dismiss"
          ? { dismissedUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
          : { status: (action === "skip" ? "skipped" : "done") as "skipped" | "done", dismissedUntil: null };
      const row = await storage.setOnboardingStep(userId, step, patch);
      res.json(row);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to update onboarding status" });
    }
  });

  app.post("/api/reward-settings/verify-pin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // A typical parent PIN is 4 digits (10k combinations) — without a rate
      // limit, any authenticated device on the account (i.e. a kid's) could
      // brute-force the parent gate in minutes. Keyed by account, not IP, so
      // switching devices doesn't reset the budget.
      if (!checkRateLimit(`verify-pin:${userId}`, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many attempts — try again in a few minutes." });
      }
      const { pin } = z.object({ pin: z.string() }).parse(req.body);
      const settings = await storage.getRewardSettings(userId);
      if (!settings?.parentPin) {
        // No PIN set — grant access (parent hasn't set one yet)
        return res.json({ ok: true });
      }
      // Constant-time comparison (hash both sides to equalize length first).
      const a = createHash("sha256").update(settings.parentPin).digest();
      const b = createHash("sha256").update(pin).digest();
      res.json({ ok: timingSafeEqual(a, b) });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid" });
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/wallet-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getWalletSettings(userId);
      res.json(settings ?? { userId, currencySymbol: "$", minCashoutCents: 0 });
    } catch (err) {
      req.log?.warn?.({ err }, "wallet settings fetch failed");
      res.status(500).json({ message: "Failed to load wallet settings" });
    }
  });

  app.put("/api/wallet-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        currencySymbol: z.string().trim().min(1).max(4).optional(),
        minCashoutCents: z.number().int().min(0).max(1_000_000).optional(),
      });
      const body = schema.parse(req.body);
      const row = await storage.upsertWalletSettings({ userId, ...body });
      res.json(row);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to save wallet settings" });
    }
  });

  // Create a pending cashout request for a specific points amount (requires parent approval)
  app.post("/api/wallet/:profileId/request-cashout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!(await requireEntitled(getAuthAccountId(req), res))) return;
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        points: z.number().int().min(1),
        cents: z.number().int().min(1).optional(),
        note: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body);
      const rewardCfg = await storage.getRewardSettings(userId);
      const centsPerPoint = rewardCfg?.centsPerPoint ?? 0;
      if (centsPerPoint <= 0) return res.status(400).json({ message: "No cash-out rate set — a grown-up can set one in Settings → Rewards & Approvals." });
      // The client may round the requested cents DOWN (to quarters), so accept
      // its value — but never above what the reserved points are actually
      // worth, or a doctored request could reserve 10 points and ask for $500.
      const maxCents = body.points * centsPerPoint;
      const amountCents = Math.min(body.cents ?? maxCents, maxCents);
      if (amountCents < 1) return res.status(400).json({ message: "Amount is too small to cash out" });
      // Lock the profile row so concurrent requests serialize here — two
      // simultaneous requests could otherwise both pass the balance check and
      // together reserve more points than the profile has.
      const tx = await db.transaction(async (dbTx) => {
        await dbTx
          .select({ id: profilesTbl.id })
          .from(profilesTbl)
          .where(eq(profilesTbl.id, profile.id))
          .for("update");
        // Both calls below run on `dbTx` (the transaction's own connection),
        // not the shared pool — mixing the two here previously caused a real
        // production deadlock: this transaction holds a connection (and the
        // row lock above) while separately asking the same pool for another
        // connection to run these queries, which can exhaust the pool under
        // concurrent load until Postgres's idle-in-transaction timeout kills it.
        const availablePoints = await loadAvailablePoints(profile.id, dbTx);
        if (body.points > availablePoints) return null;
        return await storage.createCashoutRequest({
          userId,
          profileId: profile.id,
          points: body.points,
          cents: amountCents,
          note: body.note?.trim() ?? null,
        }, dbTx);
      });
      if (!tx) return res.status(400).json({ message: "Not enough stars" });
      res.status(201).json(tx);

      // Own try/catch: res is already sent above, so any error here must not
      // reach the outer catch (which would try to send a second response).
      try {
        await notifyFamily(
          userId,
          {
            title: `${profile.name} requested a cashout`,
            body: `${body.points} stars → $${(amountCents / 100).toFixed(2)}`,
            url: "/?openTab=chores&openSubTab=rewards&openAction=parentControls",
            tag: `cashout-request-${tx.id}`,
            data: { kind: "cashout-requested", cashoutId: tx.id, profileId: profile.id },
          },
          "cashoutRequested",
        );
      } catch (err) {
        console.error("Failed to send cashout-requested notification:", err);
      }
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      req.log?.warn?.({ err }, "request-cashout failed");
      res.status(500).json({ message: "Failed to create cashout request" });
    }
  });

  app.get("/api/wallet/pending", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const pending = await storage.listPendingCashouts(userId);
      res.json(pending);
    } catch (err) {
      req.log?.warn?.({ err }, "wallet pending fetch failed");
      res.status(500).json({ message: "Failed to load pending requests" });
    }
  });

  app.get("/api/wallet/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const balance = await storage.getOrCreateWalletBalance(userId, profile.id);
      const pending = await storage.sumPendingCashoutCents(profile.id);
      const transactions = await storage.listWalletTransactions(profile.id, 30);
      const payouts = await storage.listAllowancePayouts(profile.id, 20);
      const goals = await storage.listSavingsGoals(profile.id);
      const allowance = await storage.getAllowanceSettings(profile.id);
      const settings = await storage.getWalletSettings(userId);
      const availablePoints = await loadAvailablePoints(profile.id);
      const centsPerPoint = allowance?.centsPerPoint ?? 0;
      res.json({
        balance: {
          availableCents: balance.availableCents,
          savingsCents: balance.savingsCents,
          pendingCents: pending.cents,
          pendingPoints: pending.points,
        },
        availablePoints,
        centsPerPoint,
        currencySymbol: settings?.currencySymbol ?? "$",
        minCashoutCents: settings?.minCashoutCents ?? 0,
        transactions,
        payouts,
        goals,
      });
    } catch (err) {
      req.log?.warn?.({ err }, "wallet fetch failed");
      res.status(500).json({ message: "Failed to load wallet" });
    }
  });

  app.post("/api/wallet/:profileId/cashout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        note: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body ?? {});
      const allowance = await storage.getAllowanceSettings(profile.id);
      const centsPerPoint = allowance?.centsPerPoint ?? 0;
      if (centsPerPoint <= 0) return res.status(400).json({ message: "Set an allowance rate first" });
      const settings = await storage.getWalletSettings(userId);
      const minCents = settings?.minCashoutCents ?? 0;
      // Same profile-row lock as request-cashout: without it, two concurrent
      // cashouts could both read the same balance and together pay out more
      // points than exist.
      const result = await db.transaction(async (dbTx) => {
        await dbTx
          .select({ id: profilesTbl.id })
          .from(profilesTbl)
          .where(eq(profilesTbl.id, profile.id))
          .for("update");
        // Same reasoning as request-cashout above: run everything on `dbTx`
        // so this doesn't compete with its own row lock for a second pooled
        // connection.
        const availablePoints = await loadAvailablePoints(profile.id, dbTx);
        if (availablePoints <= 0) return { error: "No stars available to cash out" } as const;
        const amountCents = availablePoints * centsPerPoint;
        if (amountCents < minCents) {
          return { error: `Minimum cash-out is ${(minCents / 100).toFixed(2)}` } as const;
        }
        const tx = await storage.cashout({
          userId,
          profileId: profile.id,
          points: availablePoints,
          amountCents,
          note: body.note?.trim() || null,
        }, dbTx);
        return { tx } as const;
      });
      if ("error" in result) return res.status(400).json({ message: result.error });
      res.status(201).json(result.tx);
      checkAndAwardAchievements(profile.id).catch((err) => console.error("Error checking achievements:", err));
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      req.log?.warn?.({ err }, "cashout failed");
      res.status(500).json({ message: "Failed to cash out" });
    }
  });

  app.post("/api/wallet/requests/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const tx = await storage.approveCashout(req.params.id, userId);
      if (!tx) return res.status(404).json({ message: "Request not found or already decided" });
      res.json(tx);
      if (tx.profileId) {
        checkAndAwardAchievements(tx.profileId).catch((err) => console.error("Error checking achievements:", err));
      }
    } catch (err) {
      req.log?.warn?.({ err }, "approve cashout failed");
      res.status(500).json({ message: "Failed to approve" });
    }
  });

  app.post("/api/wallet/requests/:id/decline", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const tx = await storage.declineCashout(req.params.id, userId);
      if (!tx) return res.status(404).json({ message: "Request not found or already decided" });
      res.json(tx);
      // Points were only ever reserved (never actually debited) for a pending
      // request, so declining automatically returns them to the profile's
      // available balance with no separate credit — just tell them it happened.
      if (tx.profileId) {
        const amount = `$${((tx.requestedCents ?? 0) / 100).toFixed(2)}`;
        sendPushToUser(
          { userId, profileId: tx.profileId },
          {
            title: "Cashout declined",
            body: `Your request to cash out ${tx.requestedPoints ?? 0} stars (${amount}) was declined. Your stars have been returned.`,
            url: "/?openTab=chores&openSubTab=rewards&openAction=cashoutStars",
            tag: `cashout-declined-${tx.id}`,
            data: { kind: "cashout-declined", cashoutId: tx.id, profileId: tx.profileId },
          },
        ).catch((err) => req.log?.warn?.({ err }, "cashout decline push failed"));
      }
    } catch (err) {
      req.log?.warn?.({ err }, "decline cashout failed");
      res.status(500).json({ message: "Failed to decline" });
    }
  });

  app.post("/api/wallet/:profileId/mark-paid", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        amountCents: z.number().int().min(1),
        note: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body);
      const tx = await storage.markPaid({
        userId,
        profileId: profile.id,
        amountCents: body.amountCents,
        note: body.note?.trim() || null,
      });
      if (!tx) return res.status(400).json({ message: "Insufficient available balance" });
      res.status(201).json(tx);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to mark paid" });
    }
  });

  app.post("/api/wallet/:profileId/savings/deposit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        amountCents: z.number().int().min(1),
        goalId: z.string().nullable().optional(),
        note: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body);
      if (body.goalId) {
        const goal = await storage.getSavingsGoal(body.goalId);
        if (!goal || goal.profileId !== profile.id) {
          return res.status(400).json({ message: "Invalid savings goal" });
        }
      }
      const tx = await storage.depositToSavings({
        userId,
        profileId: profile.id,
        amountCents: body.amountCents,
        goalId: body.goalId ?? null,
        note: body.note?.trim() || null,
      });
      if (!tx) return res.status(400).json({ message: "Insufficient available balance" });
      res.status(201).json(tx);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to deposit" });
    }
  });

  app.post("/api/wallet/:profileId/savings/withdraw", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getProfile(req.params.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Not found" });
      const schema = z.object({
        amountCents: z.number().int().min(1),
        goalId: z.string().nullable().optional(),
        note: z.string().trim().max(140).optional(),
      });
      const body = schema.parse(req.body);
      if (body.goalId) {
        const goal = await storage.getSavingsGoal(body.goalId);
        if (!goal || goal.profileId !== profile.id) {
          return res.status(400).json({ message: "Invalid savings goal" });
        }
      }
      const tx = await storage.withdrawFromSavings({
        userId,
        profileId: profile.id,
        amountCents: body.amountCents,
        goalId: body.goalId ?? null,
        note: body.note?.trim() || null,
      });
      if (!tx) return res.status(400).json({ message: "Insufficient savings balance" });
      res.status(201).json(tx);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to withdraw" });
    }
  });

  app.post("/api/savings-goals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        profileId: z.string(),
        name: z.string().trim().min(1).max(80),
        targetCents: z.number().int().min(1),
        photoUrl: z.string().trim().max(500).nullable().optional(),
      });
      const body = schema.parse(req.body);
      const profile = await storage.getProfile(body.profileId);
      if (!profile || profile.userId !== userId) return res.status(404).json({ message: "Profile not found" });
      const goal = await storage.createSavingsGoal({
        userId,
        profileId: profile.id,
        name: body.name,
        targetCents: body.targetCents,
        photoUrl: body.photoUrl ?? null,
      });
      res.status(201).json(goal);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to create goal" });
    }
  });

  app.patch("/api/savings-goals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        name: z.string().trim().min(1).max(80).optional(),
        targetCents: z.number().int().min(1).optional(),
        photoUrl: z.string().trim().max(500).nullable().optional(),
      });
      const body = schema.parse(req.body);
      const goal = await storage.updateSavingsGoal(req.params.id, userId, body);
      if (!goal) return res.status(404).json({ message: "Goal not found" });
      res.json(goal);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid", issues: err.issues });
      res.status(500).json({ message: "Failed to update goal" });
    }
  });

  app.delete("/api/savings-goals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.deleteSavingsGoal(req.params.id, userId);
      if (!ok) return res.status(404).json({ message: "Goal not found" });
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete goal" });
    }
  });

  // ─── Weekly recap (in-app) ─────────────────────────────────────────────
  app.get("/api/weekly-recap", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const recap = await buildWeeklyRecap(userId);
      res.json(recap);
    } catch (err) {
      req.log?.warn?.({ err }, "weekly recap failed");
      res.status(500).json({ message: "Failed to load weekly recap" });
    }
  });

  // ─── Family Shoutouts (praise) ─────────────────────────────────────────
  app.get("/api/shoutouts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);
      const rows = await storage.listShoutoutsForUser(userId, limit);
      res.json(rows);
    } catch (err) {
      req.log?.warn?.({ err }, "list shoutouts failed");
      res.status(500).json({ message: "Failed to list shoutouts" });
    }
  });

  app.get("/api/shoutouts/unseen-count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const count = await storage.getUnseenShoutoutCount(userId);
      res.json({ count });
    } catch (err) {
      res.status(500).json({ message: "Failed to count shoutouts" });
    }
  });

  app.post("/api/shoutouts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        fromProfileId: z.string().min(1),
        toProfileId: z.string().min(1),
        emoji: z.string().min(1).max(8).optional(),
        message: z.string().trim().min(1).max(140),
      });
      const body = schema.parse(req.body);
      if (body.fromProfileId === body.toProfileId) {
        return res.status(400).json({ message: "Pick a different family member to praise" });
      }
      const [fromProfile, toProfile] = await Promise.all([
        storage.getProfile(body.fromProfileId),
        storage.getProfile(body.toProfileId),
      ]);
      if (!fromProfile || fromProfile.userId !== userId) {
        return res.status(403).json({ message: "Not your profile" });
      }
      if (!toProfile || toProfile.userId !== userId) {
        return res.status(404).json({ message: "Recipient not found" });
      }
      const shoutout = await storage.createShoutout({
        userId,
        fromProfileId: body.fromProfileId,
        toProfileId: body.toProfileId,
        emoji: body.emoji ?? "👏",
        message: body.message,
      });
      // Best-effort push to recipient's devices.
      sendPushToUser(
        { userId, profileId: body.toProfileId },
        {
          title: `${shoutout.emoji} Shoutout from ${fromProfile.name}`,
          body: shoutout.message,
          url: "/?openTab=home&openAction=praiseSection",
          tag: `shoutout-${shoutout.id}`,
          data: { kind: "shoutout", shoutoutId: shoutout.id },
        },
      ).catch((err) => req.log?.warn?.({ err }, "shoutout push failed"));
      res.status(201).json(shoutout);
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Invalid shoutout", issues: err.issues });
      req.log?.warn?.({ err }, "create shoutout failed");
      res.status(500).json({ message: "Failed to send shoutout" });
    }
  });

  app.post("/api/shoutouts/:id/seen", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updated = await storage.markShoutoutSeen(req.params.id, userId);
      if (!updated) return res.status(404).json({ message: "Shoutout not found" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to mark shoutout seen" });
    }
  });

  app.get("/api/stats/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.params;
      
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      
      const [points, streakDetails, completionCount, categoryCounts] = await Promise.all([
        storage.getProfilePoints(profileId),
        storage.getProfileStreakDetails(profileId),
        storage.getChoreCompletionCount(profileId),
        storage.getCategoryCompletionCounts(profileId)
      ]);
      res.json({
        profileId,
        points,
        streak: streakDetails.streak,
        streakDetails,
        completionCount,
        categoryCounts
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Calendar Settings routes
  app.get("/api/calendar-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getCalendarSettingsByUser(userId);
      // Return default settings if none exist
      const defaultSettings = settings || {
        startHour: 8,
        endHour: 22,
        weekStartsOn: 0,
        twoWaySyncEnabled: true,
        familyCalendarId: null,
        familyCalendarProfileId: null,
        familyCalendarProvider: null,
        scanInbox: true,
        shareOriginals: false,
        mealsOnCalendar: false,
        mutedSenders: [],
        dismissedSlipKeys: [],
      };
      res.json(defaultSettings);
    } catch (error) {
      console.error("Error fetching calendar settings:", error);
      res.status(500).json({ error: "Failed to fetch calendar settings" });
    }
  });

  app.put("/api/calendar-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { startHour, endHour, weekStartsOn } = req.body;

      if (typeof startHour !== 'number' || typeof endHour !== 'number') {
        return res.status(400).json({ error: "Start hour and end hour must be numbers" });
      }

      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        return res.status(400).json({ error: "Hours must be between 0 and 23" });
      }

      if (startHour >= endHour) {
        return res.status(400).json({ error: "Start hour must be less than end hour" });
      }

      if (weekStartsOn !== undefined && weekStartsOn !== 0 && weekStartsOn !== 1) {
        return res.status(400).json({ error: "Week start day must be 0 (Sunday) or 1 (Monday)" });
      }

      const settings = await storage.updateCalendarSettings({
        startHour,
        endHour,
        userId,
        ...(weekStartsOn !== undefined ? { weekStartsOn } : {}),
      });
      res.json(settings);
    } catch (error) {
      console.error("Error updating calendar settings:", error);
      res.status(500).json({ error: "Failed to update calendar settings" });
    }
  });

  // Toggle two-way calendar sync (writes app events to connected calendars).
  app.patch("/api/calendar-settings/two-way-sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const settings = await storage.updateCalendarSettings({ twoWaySyncEnabled: enabled, userId });
      res.json(settings);
    } catch (error) {
      console.error("Error updating two-way sync setting:", error);
      res.status(500).json({ error: "Failed to update two-way sync setting" });
    }
  });

  app.patch("/api/calendar-settings/family-calendar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const calendarId = req.body.calendarId;
      const profileId = req.body.profileId;
      const provider = req.body.provider;
      if (calendarId !== null && typeof calendarId !== "string") {
        return res.status(400).json({ error: "calendarId must be a string or null" });
      }
      if (profileId != null && typeof profileId !== "string") {
        return res.status(400).json({ error: "profileId must be a string or null" });
      }
      if (provider != null && provider !== "google" && provider !== "outlook") {
        return res.status(400).json({ error: "provider must be google or outlook" });
      }
      const settings = await storage.updateCalendarSettings({
        familyCalendarId: calendarId,
        familyCalendarProfileId: calendarId ? (typeof profileId === "string" ? profileId : null) : null,
        familyCalendarProvider: calendarId ? (provider === "google" || provider === "outlook" ? provider : null) : null,
        userId,
      });
      res.json(settings);
    } catch (error) {
      console.error("Error updating family calendar:", error);
      res.status(500).json({ error: "Failed to update family calendar" });
    }
  });

  app.patch("/api/calendar-settings/meals-on-calendar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (typeof req.body.enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const settings = await storage.updateCalendarSettings({ mealsOnCalendar: req.body.enabled, userId });
      res.json(settings);
    } catch (error) {
      console.error("Error updating meals on calendar:", error);
      res.status(500).json({ error: "Failed to update meals on calendar" });
    }
  });

  app.post("/api/calendar-settings/meals-on-calendar/copy", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getCalendarSettingsByUser(userId);
      if (settings?.mealsOnCalendar !== true || typeof req.body.start !== "string" || typeof req.body.end !== "string") {
        return res.json({ copied: 0 });
      }
      const meals = await storage.getMealsByUserAndDateRange(userId, req.body.start, req.body.end);
      const events = await storage.getEventsByUser(userId);
      const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
      let copied = 0;
      for (const meal of dinnersToCopy(meals, events, timeZone)) {
        const event = dinnerEventInsert(meal, settings.familyCalendarId, true, timeZone);
        if (!event) continue;
        const created = await storage.createEvent({ ...event, userId });
        if (created && dinnerLeavesTheApp(created)) {
          void syncEventCreate(created).catch((err) => console.warn("Dinner calendar copy failed:", err instanceof Error ? err.message : err));
        }
        copied += 1;
      }
      res.json({ copied });
    } catch (error) {
      console.error("Error copying dinners onto the calendar:", error);
      res.status(500).json({ error: "Failed to copy dinners" });
    }
  });

  app.patch("/api/calendar-settings/inbox", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const patch: { scanInbox?: boolean; shareOriginals?: boolean; userId: string } = { userId };
      if (typeof req.body.scanInbox === "boolean") patch.scanInbox = req.body.scanInbox;
      if (typeof req.body.shareOriginals === "boolean") patch.shareOriginals = req.body.shareOriginals;
      if (patch.scanInbox === undefined && patch.shareOriginals === undefined) {
        return res.status(400).json({ error: "scanInbox or shareOriginals must be a boolean" });
      }
      const settings = await storage.updateCalendarSettings(patch);
      if (patch.scanInbox === true) markSchedulerWorkDirty("inboxScan");
      res.json(settings);
    } catch (error) {
      console.error("Error updating inbox settings:", error);
      res.status(500).json({ error: "Failed to update inbox settings" });
    }
  });

  app.post("/api/ingest/mail", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profileIds = Array.isArray(req.body.profileIds) ? req.body.profileIds.filter((id: unknown) => typeof id === "string") : [];
      for (const profileId of profileIds) {
        const isOwner = await validateProfileOwnership(profileId, userId);
        if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      }
      const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
      const saved = await applyIngestedMail(userId, messages, profileIds);
      res.status(saved.scanOff ? 200 : 201).json(saved);
    } catch (error) {
      console.error("Error ingesting mail:", error);
      res.status(500).json({ error: "Failed to ingest mail" });
    }
  });

  app.get("/api/ingest/scan-status", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const memory = householdScanProgress(userId);
    const settings = await storage.getCalendarSettingsByUser(userId);
    res.json({
      ...memory,
      ...scanStatusFor(memory, {
        requestedAt: settings?.inboxScanRequestedAt ?? null,
        finishedAt: settings?.inboxScanFinishedAt ?? null,
      }),
    });
  });

  app.post("/api/ingest/scan", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ready = await inboxReadiness(userId);
      if (!ready.canRead) {
        res.json({ todos: [], events: [], started: false, scanOff: ready.scanOff, connected: ready.connected, needsReconnect: ready.needsReconnect, mailProblem: ready.mailProblem });
        return;
      }
      await requestInboxScan(userId).catch((err) => console.warn("Could not record inbox scan:", err instanceof Error ? err.message : err));
      const saved = scanConnectedInboxes(userId, INBOX_INITIAL_DAYS);
      saved.catch((err) => console.error("Error scanning inbox:", err));
      res.json({ todos: [], events: [], started: true, full: true, connected: ready.connected, scanOff: false });
    } catch (error) {
      console.error("Error scanning inbox:", error);
      res.status(500).json({ error: "Failed to scan inbox" });
    }
  });

  app.post("/api/ingest/not-relevant", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const key = typeof req.body.slipKey === "string" && req.body.slipKey
        ? req.body.slipKey
        : typeof req.body.title === "string" ? slipKey(req.body.title) : "";
      if (!key) return res.status(400).json({ error: "slipKey is required" });
      const settings = await storage.getCalendarSettingsByUser(userId);
      const next = dismissSlip(
        { mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] },
        key,
      );
      const chores = await storage.getChoresByUser(userId);
      for (const id of choresDismissedBySlip(chores, key)) {
        await storage.deleteChore(id, userId);
      }
      const events = await storage.getEventsByUser(userId);
      for (const id of eventsDismissedBySlip(events, key)) {
        let syncLinks: Awaited<ReturnType<typeof storage.getEventCalendarSyncs>> = [];
        try {
          syncLinks = await storage.getEventCalendarSyncs(id);
        } catch (e) {
          console.warn("Could not load event sync links (continuing with delete):", e instanceof Error ? e.message : e);
        }
        await storage.deleteEvent(id, userId);
        void syncEventDelete(syncLinks).catch((err) =>
          console.warn("syncEventDelete (not relevant) failed:", err instanceof Error ? err.message : err),
        );
      }
      const saved = await storage.updateCalendarSettings({ dismissedSlipKeys: next.dismissedSlipKeys, userId });
      res.json(saved);
    } catch (error) {
      console.error("Error dismissing a slip:", error);
      res.status(500).json({ error: "Failed to dismiss slip" });
    }
  });

  app.post("/api/ingest/mute", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const address = typeof req.body.address === "string" ? req.body.address : "";
      if (!address) return res.status(400).json({ error: "address is required" });
      const settings = await storage.getCalendarSettingsByUser(userId);
      const next = muteSender(
        { mutedSenders: settings?.mutedSenders ?? [], dismissedSlipKeys: settings?.dismissedSlipKeys ?? [] },
        address,
      );
      const saved = await storage.updateCalendarSettings({ mutedSenders: next.mutedSenders, userId });
      res.json(saved);
    } catch (error) {
      console.error("Error muting a sender:", error);
      res.status(500).json({ error: "Failed to mute sender" });
    }
  });

  app.post("/api/ingest/school", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profileId = typeof req.body.profileId === "string" ? req.body.profileId : "";
      const suggestion = typeof req.body.school === "string" ? req.body.school : "";
      if (!profileId || !suggestion.trim()) return res.status(400).json({ error: "profileId and school are required" });
      const existing = await storage.getProfile(profileId);
      if (!existing || existing.userId !== userId) return res.status(404).json({ message: "Profile not found" });
      const school = acceptSchool(existing.school, suggestion);
      if (school === (existing.school?.trim() || null)) return res.json(existing);
      const profile = await storage.updateProfile(profileId, { school }, userId);
      res.json(profile);
    } catch (error) {
      console.error("Error saving a school:", error);
      res.status(500).json({ error: "Failed to save school" });
    }
  });

  // Location Settings
  app.get("/api/location-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getLocationSettingsByUser(userId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get location settings" });
    }
  });

  app.put("/api/location-settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const settingsData = insertLocationSettingsSchema.parse(req.body);

      // Resolve real coordinates for the city they typed. The clients send
      // 0/0 when they have nothing better; before this, both of them sent
      // Farmington, Minnesota's coordinates for every family on earth, and
      // /api/weather reads coordinates rather than the city name. Best-effort:
      // if the lookup fails we keep whatever came in rather than refusing the
      // save over a third-party outage.
      const needsGeocode =
        !settingsData.latitude || !settingsData.longitude ||
        (Math.abs(settingsData.latitude) < 0.01 && Math.abs(settingsData.longitude) < 0.01);
      let resolved = settingsData;
      if (needsGeocode && settingsData.city) {
        const coords = await geocodeCity(
          settingsData.city,
          settingsData.state ?? "",
          settingsData.country ?? "United States",
        );
        if (coords) resolved = { ...settingsData, ...coords };
      }

      const settings = await storage.updateLocationSettings({ ...resolved, userId });
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to update location settings" });
    }
  });

  // Google Calendar Integration
  const googleCalendarService = new GoogleCalendarService();

  // The ONLY place an OAuth state is minted, and the only step in either
  // calendar flow that is authenticated. Everything downstream trusts the
  // userId inside the state precisely because this check happened here.
  app.post("/api/auth/calendar/state", isAuthenticated, async (req: any, res) => {
    try {
      const familyOwnerUserId = getUserId(req);
      // The LOGIN account, not the household. Recorded so the callback can
      // check this person is still a member — someone removed from the family
      // mid-flow must not be able to finish connecting a calendar to it.
      const accountUserId = getAuthAccountId(req);
      const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : null;
      const provider = req.body?.provider;
      // "native" means hand back to the app over its custom scheme; the
      // server derives the actual URL. No redirect target comes from the
      // client any more.
      const redirectMode = req.body?.native === true ? "native" : "web";

      if (!profileId) {
        return res.status(400).json({ error: "profileId is required" });
      }
      if (!isOAuthProvider(provider)) {
        return res.status(400).json({ error: "provider must be \"google\" or \"outlook\"" });
      }
      if (!(await validateProfileOwnership(profileId, familyOwnerUserId))) {
        // A human sentence, not "Forbidden": apiRequest surfaces this string
        // straight into a toast, and the client cannot see the status code.
        return res.status(403).json({ error: "That person isn't part of your family." });
      }

      const state = await createOAuthTransaction({
        provider,
        accountUserId,
        familyOwnerUserId,
        profileId,
        redirectMode,
      });
      return res.json({ state });
    } catch (error) {
      req.log?.error?.({ err: error }, "Failed to start a calendar OAuth transaction");
      return res.status(500).json({ error: "Couldn't start connecting your calendar" });
    }
  });

  /**
   * Is the account that began this flow still entitled to finish it?
   *
   * Checked on the callback, not just at mint time: a membership can change
   * while someone is away at the provider's consent screen, and the state
   * would otherwise still be good for its full ten minutes.
   */
  async function oauthActorStillValid(tx: {
    accountUserId: string;
    familyOwnerUserId: string;
    profileId: string;
  }): Promise<boolean> {
    try {
      const resolved = await resolveFamilyForAccount(tx.accountUserId);
      if (resolved.ownerUserId !== tx.familyOwnerUserId) return false;
      return await validateProfileOwnership(tx.profileId, tx.familyOwnerUserId);
    } catch {
      return false;
    }
  }

  app.get("/api/auth/google", async (req, res) => {
    const { state } = req.query;
    // Looked at but NOT consumed, so a forged or stale state fails before the
    // person has signed in to Google and granted anything.
    const check = await peekOAuthTransaction(state as string, "google");
    if (!check.ok) {
      console.warn("Rejected Google OAuth start:", check.reason);
      return res.redirect(webCalendarReturn("google_calendar_error=invalid_state"));
    }
    const requestHost = req.get('host');
    const authUrl = googleCalendarService.getAuthUrl(state as string, requestHost);
    res.redirect(authUrl);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    // Declared OUTSIDE the try so the catch can still reach it. It used to be
    // declared inside, so every error in this handler threw a second time in
    // the catch (ReferenceError: mobileRedirect is not defined) and the
    // native app hung on the OAuth screen instead of being handed back a
    // failure.
    let mobileRedirect: string | null = null;
    try {
      const { code, error: oauthError, state } = req.query;

      if (oauthError) {
        console.error('Google OAuth error:', oauthError);
        return res.redirect(webCalendarReturn("google_calendar_error=access_denied"));
      }

      if (!code) {
        console.error('No authorization code received in callback');
        return res.status(400).json({ error: "No authorization code received" });
      }

      // The transaction is the ONLY thing identifying who this connection is
      // for — this callback is deliberately unauthenticated, because the
      // provider redirects a browser here and the native flow carries no
      // cookies. Consumed atomically, so a state captured from a browser
      // history or a proxy log cannot be replayed even by a second instance.
      const verified = await consumeOAuthTransaction(state as string, "google");
      if (!verified.ok) {
        console.warn('Rejected Google OAuth callback:', verified.reason);
        return res.redirect(webCalendarReturn("google_calendar_error=invalid_state"));
      }
      const profileId = verified.profileId;
      // Server-derived, never client-supplied.
      mobileRedirect = verified.redirectMode === "native" ? nativeRedirectFor("google") : null;

      // Independent of the transaction being genuine: is the account that
      // started it still a member of that household, and does the household
      // still own that profile? Both can change while someone is away at
      // Google's consent screen.
      if (!(await oauthActorStillValid(verified))) {
        console.warn("Google OAuth callback from an account no longer entitled to complete it");
        return res.redirect(webCalendarReturn("google_calendar_error=invalid_state"));
      }

      console.log('Received authorization code, exchanging for tokens...');
      const requestHost = req.get('host');
      console.log('Request host for token exchange:', requestHost);
      
      // Revoke old tokens before getting new ones (important for scope changes)
      const existingTokens = await storage.getGoogleCalendarTokens(profileId);
      if (existingTokens && existingTokens.isActive) {
        console.log('Revoking old Google Calendar tokens...');
        await googleCalendarService.revokeToken(existingTokens.accessToken);
      }
      
      const tokens = await googleCalendarService.exchangeCodeForTokens(code as string, requestHost);
      const email = await googleCalendarService.getUserEmail(tokens.access_token!);

      const tokenData = {
        profileId,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || null,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        email,
        isActive: true,
        // saveGoogleCalendarTokens deletes and reinserts the row (see its own
        // comment) — carrying these forward from the pre-reconnect row is the
        // same fix already applied to the silent hourly-refresh path in
        // calendarSync.ts; "Reconnect" hit the identical bug via this
        // separate code path and would otherwise silently reset the family
        // back to "sync all calendars" / the default write target.
        selectedCalendarIds: existingTokens?.selectedCalendarIds ?? null,
        writeCalendarId: existingTokens?.writeCalendarId ?? null,
      };

      await storage.saveGoogleCalendarTokens(tokenData);
      console.log('Google Calendar tokens saved for profile:', profileId);

      // Update profile to mark Google Calendar as connected
      await storage.updateProfile(profileId, { googleCalendarConnected: true });

      // A revoked/expired token is the most common cause of a stuck sync
      // error, and reconnecting alone never retried anything on its own
      // before — fire-and-forget so a slow retry batch doesn't delay the
      // redirect back to the app.
      retryFailedSyncsForProfile(profileId, "google").catch((e) =>
        console.warn("Retry after Google reconnect failed:", e instanceof Error ? e.message : e));
      scanAfterConnect(profileId).catch((e) =>
        console.warn("Inbox scan after Google connect failed:", e instanceof Error ? e.message : e));

      // Redirect back to app with success and profileId
      if (mobileRedirect) {
        const sep = mobileRedirect.includes("?") ? "&" : "?";
        const deepLink = `${mobileRedirect}${sep}google_calendar_connected=true&profileId=${profileId}`;
        const safeDeepLink = JSON.stringify(deepLink);
        return res.send(`<!DOCTYPE html><html><head><title>Connecting calendar...</title>
<script>window.location=${safeDeepLink};</script>
</head><body><p>Completing calendar connection, returning to app...</p></body></html>`);
      } else {
        res.redirect(webCalendarReturn(`google_calendar_connected=true&profileId=${profileId}`));
      }
    } catch (error) {
      console.error("Google Calendar auth error:", error);
      if (mobileRedirect) {
        const sep = mobileRedirect.includes("?") ? "&" : "?";
        const deepLink = `${mobileRedirect}${sep}google_calendar_error=true`;
        const safeDeepLink = JSON.stringify(deepLink);
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>
<script>window.location=${safeDeepLink};</script>
</head><body><p>Returning to app...</p></body></html>`);
      } else {
        res.redirect(webCalendarReturn("google_calendar_error=true"));
      }
    }
  });

  app.get("/api/google-calendar/events/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const [tokens, profile] = await Promise.all([
        storage.getGoogleCalendarTokens(profileId),
        storage.getProfile(profileId),
      ]);
      
      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ error: "No Google Calendar connection found" });
      }

      let events = await googleCalendarService.getCalendarEvents(
        tokens.accessToken,
        tokens.refreshToken || undefined,
        tokens.selectedCalendarIds
      );

      // Dedup: drop events that the app itself pushed to Google (two-way sync),
      // so they don't appear twice alongside their local DB row. Matched by the
      // familyhub_origin marker and by known external IDs.
      const syncedGoogleIds = profile?.userId
        ? await storage.getExternalEventIdsByUser(profile.userId, "google")
        : new Set<string>();
      events = events.filter((e) => {
        const origin = e.extendedProperties?.private?.["familyhub_origin"];
        if (origin === "app") return false;
        if (e.id && syncedGoogleIds.has(e.id)) return false;
        return true;
      });

      // Merge DB-stored event assignments (overrides Google's extendedProperties).
      // This is the only mechanism that works for read-only/imported calendars.
      //
      // Two kinds of assignment can apply to a given occurrence:
      //   - a single-occurrence row (seriesFromDate null) keyed by the instance id
      //   - a series row (seriesFromDate set) keyed by the recurringEventId, which
      //     applies to every occurrence starting at/after seriesFromDate
      // A single-occurrence row always wins over a series row for the same instance.
      if (profile?.userId) {
        const dbAssignments = await storage.getGoogleEventAssignmentsByUser(profile.userId);
        if (dbAssignments.length > 0) {
          const instanceMap = new Map(
            dbAssignments.filter(a => !a.seriesFromDate).map(a => [`${a.calendarId}:${a.eventId}`, a])
          );
          const seriesMap = new Map(
            dbAssignments.filter(a => a.seriesFromDate).map(a => [`${a.calendarId}:${a.eventId}`, a])
          );
          const applyOverride = (event: any, override: any) => {
            if (!event.extendedProperties) event.extendedProperties = {};
            if (!event.extendedProperties.private) event.extendedProperties.private = {};
            event.extendedProperties.private['familyhub_profile_ids'] = JSON.stringify(override.profileIds);
            // Emit BOTH wire keys: the new JSON list, and the legacy bare-string
            // single id (first driver) so a client that hasn't been updated yet
            // still shows a driver rather than none.
            const drivers = driverIdsOf(override);
            if (drivers.length > 0) {
              event.extendedProperties.private['familyhub_driving_profile_ids'] = JSON.stringify(drivers);
              event.extendedProperties.private['familyhub_driving_profile_id'] = drivers[0];
            } else {
              delete event.extendedProperties.private['familyhub_driving_profile_ids'];
              delete event.extendedProperties.private['familyhub_driving_profile_id'];
            }
          };
          for (const event of events as any[]) {
            const gcalId = event.extendedProperties?.private?.['google_calendar_id'];
            const instanceOverride = instanceMap.get(`${gcalId}:${event.id}`);
            if (instanceOverride) {
              applyOverride(event, instanceOverride);
              continue;
            }
            if (event.recurringEventId) {
              const seriesOverride = seriesMap.get(`${gcalId}:${event.recurringEventId}`);
              if (seriesOverride && seriesOverride.seriesFromDate) {
                const occStart = new Date(event.start?.dateTime || event.start?.date || 0);
                if (occStart >= new Date(seriesOverride.seriesFromDate)) {
                  applyOverride(event, seriesOverride);
                }
              }
            }
          }
        }
      }

      res.json(events);
    } catch (error) {
      console.error("Error fetching Google Calendar events:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });


  // Account deletion — GDPR right to erasure, App Store requirement
  app.delete("/api/auth/account", isAuthenticated, async (req: any, res) => {
    try {
      // Use the logged-in ACCOUNT id (not the family owner) — deletion must act
      // on the caller's login, never on the shared family's data owner.
      const accountId = getAuthAccountId(req);
      if (!accountId) return res.status(401).json({ error: "Not authenticated" });
      const result = await deleteAccount(accountId);
      // Clear the session so the client is immediately logged out
      req.session?.destroy?.(() => {});
      res.json({ ok: true, dataDeleted: result.dataDeleted });
    } catch (error) {
      if (error instanceof FamilyError) {
        return res.status(error.status).json({ error: error.message });
      }
      req.log?.error?.({ err: error }, "account deletion failed");
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  app.get("/api/google-calendar/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accounts = await storage.getGoogleAccountsByUser(userId);
      res.json(accounts);
    } catch (error) {
      req.log?.error?.({ err: error }, "fetch google accounts failed");
      res.status(500).json({ message: "Failed to fetch Google Calendar accounts" });
    }
  });

  app.delete("/api/google-calendar/disconnect/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      await storage.disconnectGoogleCalendar(profileId);

      // Update profile to mark Google Calendar as disconnected
      await storage.updateProfile(profileId, { googleCalendarConnected: false });

      res.status(204).send();
    } catch (error) {
      console.error("Error disconnecting Google Calendar:", error);
      res.status(500).json({ error: "Failed to disconnect Google Calendar" });
    }
  });

  // ── iCal (.ics URL) subscriptions — READ ONLY ──────────────────────────────
  // No OAuth: the user pastes a feed URL which we fetch + parse server-side.

  // List a profile's subscriptions (for the Settings management UI).
  app.get("/api/ical-calendar/subscriptions/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      if (!(await validateProfileOwnership(profileId, userId))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subs = await storage.getIcalSubscriptions(profileId);
      res.json(subs);
    } catch (error) {
      req.log?.error?.({ err: error }, "list ical subscriptions failed");
      res.status(500).json({ error: "Failed to list iCal subscriptions" });
    }
  });

  // Add a subscription: validate the feed (fetch + parse) before saving.
  app.post("/api/ical-calendar/subscribe", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        profileId: z.string().min(1),
        feedUrl: z.string().min(1),
        calendarName: z.string().trim().min(1).max(120),
        calendarColor: z.string().trim().max(40).optional().nullable(),
      });
      const body = schema.parse(req.body);
      if (!(await validateProfileOwnership(body.profileId, userId))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Validate by actually fetching + parsing the feed.
      await validateIcalFeed(body.feedUrl);

      const sub = await storage.createIcalSubscription({
        profileId: body.profileId,
        feedUrl: body.feedUrl.trim(),
        calendarName: body.calendarName,
        calendarColor: body.calendarColor ?? null,
        isActive: true,
      });
      await storage.updateIcalSubscriptionStatus(sub.id, { lastFetchedAt: new Date(), lastError: null });
      await storage.updateProfile(body.profileId, { icalConnected: true });
      res.status(201).json(sub);
    } catch (error: any) {
      if (error instanceof IcalError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid request", details: error.errors });
      }
      req.log?.error?.({ err: error }, "ical subscribe failed");
      res.status(500).json({ error: "Failed to add iCal subscription" });
    }
  });

  // Remove a subscription. Clears the profile flag if it was the last one.
  app.delete("/api/ical-calendar/subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      const sub = await storage.getIcalSubscriptionById(id);
      if (!sub) return res.status(404).json({ error: "Subscription not found" });
      if (!(await validateProfileOwnership(sub.profileId, userId))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.deleteIcalSubscription(id);
      invalidateIcalCache(sub.feedUrl);
      const remaining = await storage.getIcalSubscriptions(sub.profileId);
      if (remaining.length === 0) {
        await storage.updateProfile(sub.profileId, { icalConnected: false });
      }
      res.status(204).send();
    } catch (error) {
      req.log?.error?.({ err: error }, "ical unsubscribe failed");
      res.status(500).json({ error: "Failed to remove iCal subscription" });
    }
  });

  // Fetch events from all of a profile's iCal feeds (merged, normalized).
  app.get("/api/ical-calendar/events/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      if (!(await validateProfileOwnership(profileId, userId))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subs = await storage.getIcalSubscriptions(profileId);
      // Feeds are independent URLs — fetching them one after another meant N
      // broken/slow feeds cost roughly N×15s worst case on a cache miss.
      // Nothing about the merge below depends on fetch order.
      const results = await Promise.allSettled(
        subs.map(async (sub) => {
          const events = await fetchIcalEvents(sub.feedUrl);
          await storage.updateIcalSubscriptionStatus(sub.id, { lastFetchedAt: new Date(), lastError: null });
          return { sub, events };
        }),
      );
      const all: any[] = [];
      await Promise.all(results.map(async (result, i) => {
        const sub = subs[i];
        if (result.status === "fulfilled") {
          for (const e of result.value.events) {
            all.push({
              ...e,
              id: `${sub.id}::${e.id}`,
              subscriptionId: sub.id,
              calendarName: sub.calendarName,
              calendarColor: sub.calendarColor,
            });
          }
        } else {
          // One bad feed shouldn't blank the others — record the error and skip.
          const err: any = result.reason;
          await storage.updateIcalSubscriptionStatus(sub.id, {
            lastError: err instanceof IcalError ? err.message : "Failed to fetch feed",
          });
        }
      }));
      res.json(all);
    } catch (error) {
      req.log?.error?.({ err: error }, "fetch ical events failed");
      res.status(500).json({ error: "Failed to fetch iCal events" });
    }
  });

  // ── BratBusters Behaviour Board ────────────────────────────────────────────

  // Aggregate fetch for the tab: settings (motto), rules, active + recent incidents.
  app.get("/api/behaviour-board", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const [settings, rules, activeIncidents, recentIncidents] = await Promise.all([
        storage.getBehaviourBoardSettings(userId),
        storage.getBehaviourRules(userId),
        storage.getBehaviourIncidents(userId, { status: "positive_pending" }),
        storage.getBehaviourIncidents(userId, { limit: 25 }),
      ]);
      res.json({
        settings: settings ?? null,
        rules,
        activeIncidents,
        recentIncidents,
      });
    } catch (error) {
      req.log?.error?.({ err: error }, "fetch behaviour board failed");
      res.status(500).json({ error: "Failed to load behaviour board" });
    }
  });

  // Update the family motto / default timer.
  app.put("/api/behaviour-board/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        familyMotto: z.string().trim().max(200).optional(),
        boardSubtitle: z.string().trim().max(200).optional(),
        defaultTimerMinutes: z.number().int().min(1).max(120).optional(),
      });
      const updates = schema.parse(req.body);
      const settings = await storage.upsertBehaviourBoardSettings(userId, updates);
      res.json(settings);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Invalid settings", details: error.errors });
      req.log?.error?.({ err: error }, "update behaviour settings failed");
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Create a rule (+ its two consequences) for a profile.
  app.post("/api/behaviour-rules", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        // Accept either a single profileId (legacy) or a list of profileIds.
        profileId: z.string().min(1).optional(),
        profileIds: z.array(z.string().min(1)).min(1).optional(),
        ruleText: z.string().trim().min(1).max(200),
        positiveConsequence: z.string().trim().min(1).max(200),
        negativeConsequence: z.string().trim().min(1).max(200),
        timerMinutes: z.number().int().min(1).max(120).optional(),
        displayOrder: z.number().int().optional(),
      }).refine((b) => (b.profileIds && b.profileIds.length > 0) || !!b.profileId, {
        message: "At least one family member is required",
      });
      const body = schema.parse(req.body);
      // Normalise to a de-duplicated list of profile ids.
      const profileIds = Array.from(new Set(body.profileIds ?? (body.profileId ? [body.profileId] : [])));
      for (const pid of profileIds) {
        if (!(await validateProfileOwnership(pid, userId))) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }
      const { profileId: _legacy, profileIds: _ignored, ...rest } = body;
      const rule = await storage.createBehaviourRule({
        ...rest,
        userId,
        profileId: profileIds[0],
        profileIds,
      });
      res.status(201).json(rule);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Invalid rule", details: error.errors });
      req.log?.error?.({ err: error }, "create behaviour rule failed");
      res.status(500).json({ error: "Failed to create rule" });
    }
  });

  // Edit a rule.
  app.patch("/api/behaviour-rules/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        profileIds: z.array(z.string().min(1)).min(1).optional(),
        ruleText: z.string().trim().min(1).max(200).optional(),
        positiveConsequence: z.string().trim().min(1).max(200).optional(),
        negativeConsequence: z.string().trim().min(1).max(200).optional(),
        timerMinutes: z.number().int().min(1).max(120).optional(),
        displayOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      });
      const { profileIds, ...rest } = schema.parse(req.body);
      const updates: Record<string, unknown> = { ...rest };
      // Allow reassigning which family member(s) a rule applies to.
      if (profileIds && profileIds.length > 0) {
        const unique = Array.from(new Set(profileIds));
        for (const pid of unique) {
          if (!(await validateProfileOwnership(pid, userId))) {
            return res.status(403).json({ error: "Forbidden" });
          }
        }
        updates.profileIds = unique;
        updates.profileId = unique[0];
      }
      const rule = await storage.updateBehaviourRule(req.params.id, updates as any, userId);
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      res.json(rule);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Invalid rule", details: error.errors });
      req.log?.error?.({ err: error }, "update behaviour rule failed");
      res.status(500).json({ error: "Failed to update rule" });
    }
  });

  app.delete("/api/behaviour-rules/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.deleteBehaviourRule(req.params.id, userId);
      if (!ok) return res.status(404).json({ error: "Rule not found" });
      res.status(204).send();
    } catch (error) {
      req.log?.error?.({ err: error }, "delete behaviour rule failed");
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  // Start an incident: a rule was broken. Snapshots the rule's consequences and
  // starts the server-authoritative timer. Blocks a second active incident for
  // the same person (the method handles one at a time).
  app.post("/api/behaviour-incidents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({ ruleId: z.string().min(1), profileId: z.string().min(1).optional() });
      const { ruleId, profileId: requestedProfileId } = schema.parse(req.body);
      const rule = await storage.getBehaviourRule(ruleId, userId);
      if (!rule) return res.status(404).json({ error: "Rule not found" });

      // A rule can apply to multiple people; the caller says which person broke it.
      const ruleProfileIds = (rule.profileIds && rule.profileIds.length > 0) ? rule.profileIds : [rule.profileId];
      const profileId = requestedProfileId ?? ruleProfileIds[0];
      if (!ruleProfileIds.includes(profileId)) {
        return res.status(400).json({ error: "That person isn't on this rule." });
      }

      const active = await storage.getBehaviourIncidents(userId, { status: "positive_pending" });
      if (active.some((i) => i.profileId === profileId)) {
        return res.status(409).json({ error: "There's already an active consequence for this person. Resolve it first." });
      }

      const timerMinutes = rule.timerMinutes ?? 15;
      const startedAt = new Date();
      const timerEndsAt = new Date(startedAt.getTime() + timerMinutes * 60_000);
      const incident = await storage.createBehaviourIncident({
        userId,
        profileId,
        ruleId: rule.id,
        ruleText: rule.ruleText,
        positiveConsequence: rule.positiveConsequence,
        negativeConsequence: rule.negativeConsequence,
        timerMinutes,
        status: "positive_pending",
        startedAt,
        timerEndsAt,
      });
      res.status(201).json(incident);

      // Own try/catch: res is already sent above.
      try {
        await sendPushToUser(
          { userId, profileId },
          {
            title: `⏱ Consequence timer started: ${rule.positiveConsequence}`,
            body: `${timerMinutes} minutes to do the good deed`,
            url: "/",
            tag: `behaviour-timer-start-${incident.id}`,
            data: { kind: "behaviour-timer-start", incidentId: incident.id, profileId },
          },
          "behaviourTimer",
        );
      } catch (err) {
        console.error("Failed to send behaviour-timer-start notification:", err);
      }
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Invalid request", details: error.errors });
      req.log?.error?.({ err: error }, "create behaviour incident failed");
      res.status(500).json({ error: "Failed to start consequence" });
    }
  });

  // Resolve an incident: either they did the good deed ("positive") or the timer
  // expired and the deprivation is applied ("negative"). Server enforces that the
  // positive outcome is only allowed before the timer ends (always follow through).
  app.post("/api/behaviour-incidents/:id/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        outcome: z.enum(["positive", "negative"]),
        note: z.string().trim().max(500).optional().nullable(),
      });
      const { outcome, note } = schema.parse(req.body);

      const incident = await storage.getBehaviourIncident(req.params.id, userId);
      if (!incident) return res.status(404).json({ error: "Incident not found" });
      if (incident.status !== "positive_pending") {
        return res.status(409).json({ error: `This consequence is already ${incident.status === "resolved_positive" ? "completed" : "applied"}.` });
      }

      // Follow-through guard: once the timer has elapsed, the good deed no longer
      // counts — the negative consequence must be applied.
      if (outcome === "positive" && new Date(incident.timerEndsAt).getTime() < Date.now()) {
        return res.status(409).json({
          error: "Time's up — the good deed had to be done within the timer. Apply the negative consequence and follow through.",
        });
      }

      const status = outcome === "positive" ? "resolved_positive" : "negative_applied";
      const resolved = await storage.resolveBehaviourIncident(req.params.id, userId, status, note);
      if (!resolved) return res.status(409).json({ error: "Already resolved" });
      res.json(resolved);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ error: "Invalid request", details: error.errors });
      req.log?.error?.({ err: error }, "resolve behaviour incident failed");
      res.status(500).json({ error: "Failed to resolve consequence" });
    }
  });

  // Cancel/remove an incident (e.g. started by mistake or cleaning up history).
  app.delete("/api/behaviour-incidents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.deleteBehaviourIncident(req.params.id, userId);
      if (!ok) return res.status(404).json({ error: "Incident not found" });
      res.status(204).send();
    } catch (error) {
      req.log?.error?.({ err: error }, "delete behaviour incident failed");
      res.status(500).json({ error: "Failed to delete incident" });
    }
  });

  app.patch("/api/google-calendar/events/:profileId/:calendarId/:eventId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId, calendarId, eventId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      // The route's own profileId is checked above, but the BODY names
      // assignees and drivers too and those were never validated — the same
      // gap the event routes had.
      if (await rejectForeignProfileIds(req, res, userId)) return;
      const [tokens, profile] = await Promise.all([
        storage.getGoogleCalendarTokens(profileId),
        storage.getProfile(profileId),
      ]);
      
      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ error: "No Google Calendar connection found" });
      }

      const eventData = req.body;
      
      // Convert date strings to Date objects if they exist
      if (eventData.start) {
        eventData.start = new Date(eventData.start);
      }
      if (eventData.end) {
        eventData.end = new Date(eventData.end);
      }

      // Always persist the profile assignment in the database first.
      // This is the authoritative store and works for ALL calendar types —
      // including imported calendars (e.g. @import.calendar.google.com) where
      // Google's API returns 403 and rejects writes to extendedProperties.
      //
      // For recurring events the client may request a SERIES assignment ("this
      // and following occurrences"): we then key the row by the recurring event's
      // id and record seriesFromDate so the GET handler can apply it to every
      // occurrence at/after that point. Otherwise we store a single-occurrence row
      // keyed by the expanded instance id.
      // Note the driver clause: previously this fired only when profileIds was
      // present, so changing ONLY the driver on a Google-synced event silently
      // never persisted. Accepts either the new list or the legacy single id.
      const incomingDriverIds: string[] | undefined =
        eventData.drivingProfileIds !== undefined
          ? (eventData.drivingProfileIds ?? [])
          : eventData.drivingProfileId !== undefined
            ? (eventData.drivingProfileId ? [eventData.drivingProfileId] : [])
            : undefined;
      if ((eventData.profileIds !== undefined || incomingDriverIds !== undefined) && profile?.userId) {
        const applyToSeries = !!eventData.applyToSeries && !!eventData.recurringEventId;
        const assignmentEventId = applyToSeries ? eventData.recurringEventId : eventId;
        const seriesFromDate = applyToSeries && eventData.occurrenceStart
          ? new Date(eventData.occurrenceStart)
          : null;
        // A driver-only change carries no profileIds, so keep whatever the
        // existing row already had rather than wiping the assignees.
        let profileIdsToSave: string[] = eventData.profileIds;
        let driverIdsToSave: string[] = incomingDriverIds ?? [];
        if (eventData.profileIds === undefined || incomingDriverIds === undefined) {
          const existing = (await storage.getGoogleEventAssignmentsByUser(profile.userId))
            .find(a => a.calendarId === calendarId && a.eventId === assignmentEventId);
          if (eventData.profileIds === undefined) profileIdsToSave = existing?.profileIds ?? [];
          if (incomingDriverIds === undefined) driverIdsToSave = driverIdsOf(existing);
        }
        await storage.setGoogleEventAssignment(
          profile.userId,
          calendarId,
          assignmentEventId,
          profileIdsToSave,
          driverIdsToSave,
          seriesFromDate
        );
        // A series assignment is otherwise silently shadowed by any pre-existing
        // per-occurrence (instance) override for the same series — the GET
        // handler always prefers instance over series for a given occurrence.
        // Clear the instance rows this series now supersedes (its own
        // occurrences at/after seriesFromDate) so "this and all following"
        // actually takes effect instead of appearing to save with no change.
        if (applyToSeries && seriesFromDate) {
          await storage.clearGoogleEventInstanceOverridesForSeries(
            profile.userId,
            calendarId,
            eventData.recurringEventId,
            seriesFromDate
          );
        }
      }

      // Also attempt to write back to Google Calendar (works for writable calendars).
      // This is BEST-EFFORT only. The DB assignment saved above is the authoritative
      // store for which profiles an event shows up for in the Family Hub — that is a
      // local-only concept Google knows nothing about. So a failed Google write-back
      // (read-only calendar, expired token, event not writable, transient error, etc.)
      // must never fail the request: the user's change has already been persisted.
      let updatedEvent: any = { id: eventId, calendarId };
      let googleWriteFailed = false;
      try {
        updatedEvent = await googleCalendarService.updateEvent(
          tokens.accessToken,
          tokens.refreshToken || undefined,
          calendarId,
          eventId,
          eventData
        );
      } catch (error: any) {
        const statusCode = error?.status ?? error?.code ?? error?.response?.status;
        googleWriteFailed = true;
        if (statusCode === 403) {
          // Read-only calendar (imported feed / shared without edit access).
          req.log?.info?.({ calendarId, eventId }, "skipped google write (read-only calendar); DB assignment saved");
        } else {
          // Any other failure: log for observability but do not fail the request,
          // since the local assignment was already saved successfully.
          req.log?.warn?.({ err: error, calendarId, eventId }, "google calendar write-back failed; DB assignment saved");
        }
      }

      res.json({ ...updatedEvent, googleWriteFailed });
    } catch (error) {
      console.error("Error updating Google Calendar event:", error);
      res.status(500).json({ error: "Failed to update calendar event" });
    }
  });

  app.delete("/api/google-calendar/events/:profileId/:calendarId/:eventId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId, calendarId, eventId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const tokens = await storage.getGoogleCalendarTokens(profileId);

      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ message: "This profile's Google Calendar isn't connected anymore." });
      }

      await googleCalendarService.deleteEvent(
        tokens.accessToken,
        tokens.refreshToken || undefined,
        calendarId,
        eventId
      );

      res.status(204).send();
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status;
      console.error("Error deleting Google Calendar event:", status, error?.response?.data ?? error);
      // 401 = the access/refresh token itself is invalid — reconnecting
      // actually fixes this. 403 with a *valid* token is a different
      // problem: Google is refusing the delete for a permissions reason
      // (the event was created by someone else and this account isn't the
      // organizer, or it's on a calendar this account can only view, not
      // edit) — reconnecting the same account won't change that, so telling
      // the user to reconnect was actively misleading them into repeating a
      // step that can't help.
      if (status === 401) {
        return res.status(401).json({ message: "Google Calendar needs to be reconnected — try disconnecting and reconnecting it in Settings." });
      }
      if (status === 403) {
        return res.status(403).json({ message: "Google won't let this account delete that event — it may have been created by someone else, or it's on a calendar you can only view. Try deleting it directly in Google Calendar instead." });
      }
      res.status(500).json({ message: "Failed to delete the calendar event. Try again in a moment." });
    }
  });

  // Calendar Assignments
  app.get("/api/calendar-assignments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId } = req.query;
      if (profileId) {
        // The ownership check used to live inside this `if` and nothing else
        // guarded the other branch — so omitting the query parameter skipped
        // authorization entirely and returned EVERY family's assignments,
        // including calendar names, real email addresses and profile ids.
        const isOwner = await validateProfileOwnership(profileId as string, userId);
        if (!isOwner) return res.status(403).json({ error: "Forbidden" });
        return res.json(await storage.getCalendarAssignments(profileId as string));
      }
      return res.json(await storage.getCalendarAssignmentsByUser(userId));
    } catch (error) {
      console.error("Error fetching calendar assignments:", error);
      res.status(500).json({ error: "Failed to fetch calendar assignments" });
    }
  });

  // Surfaces two-way-sync failures recorded in event_calendar_syncs — a
  // revoked OAuth consent or a stale token can silently stop sync forever
  // with the failure only ever written to this table, never read anywhere.
  app.get("/api/calendar-sync-errors", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const errors = await storage.getRecentSyncErrors(userId, 10);
      res.json(errors);
    } catch (error) {
      console.error("Error fetching calendar sync errors:", error);
      res.status(500).json({ error: "Failed to fetch calendar sync errors" });
    }
  });

  // Dismisses a sync-error entry the user has seen and doesn't want to keep
  // being shown — e.g. an old event, or a failure they've decided not to
  // chase. Clears every profile's row for this (event, provider) pair, since
  // the frontend already shows them merged as one entry. A future sync
  // attempt (success or a fresh failure) un-dismisses automatically.
  app.post("/api/calendar-sync-errors/:eventId/:provider/dismiss", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { eventId, provider } = req.params;
      await storage.dismissSyncError(userId, eventId, provider);
      res.json({ success: true });
    } catch (error) {
      console.error("Error dismissing calendar sync error:", error);
      res.status(500).json({ error: "Failed to dismiss calendar sync error" });
    }
  });

  app.post("/api/calendar-assignments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profileIds = Array.isArray(req.body.profileIds)
        ? req.body.profileIds.filter((id: unknown) => typeof id === "string")
        : req.body.profileId
          ? [req.body.profileId]
          : [];
      for (const profileId of profileIds) {
        const isOwner = await validateProfileOwnership(profileId, userId);
        if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      }
      const folded = assignPeopleToCalendar(String(req.body.calendarId ?? ""), profileIds);
      const assignment = insertCalendarAssignmentSchema.parse({
        ...req.body,
        profileId: folded.profileId,
        audienceProfileIds: folded.audienceProfileIds,
      });
      const savedAssignment = await storage.saveCalendarAssignment(assignment);
      res.status(201).json(savedAssignment);
    } catch (error) {
      console.error("Error saving calendar assignment:", error);
      res.status(500).json({ error: "Failed to save calendar assignment" });
    }
  });

  app.delete("/api/calendar-assignments/:calendarType/:calendarId/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { calendarType, calendarId, profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const success = await storage.deleteCalendarAssignment(calendarType, calendarId, profileId);
      if (success) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Calendar assignment not found" });
      }
    } catch (error) {
      console.error("Error deleting calendar assignment:", error);
      res.status(500).json({ error: "Failed to delete calendar assignment" });
    }
  });

  // Get available calendars for a profile (with assignment info)
  app.get("/api/google-calendar/available-calendars/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const tokens = await storage.getGoogleCalendarTokens(profileId);
      
      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ error: "No Google Calendar connection found" });
      }

      // Get calendar list from Google Calendar service
      const calendars = await googleCalendarService.getAvailableCalendars(
        tokens.accessToken,
        tokens.refreshToken || undefined
      );

      // Every assignment in THIS family — a calendar may be assigned to a
      // different profile in the same household, which is what this lookup is
      // for. It used to read every family's, so two families connecting the
      // same shared calendar (a school or holidays calendar) would each see
      // the other's profile as the assignee.
      const assignments = await storage.getCalendarAssignmentsByUser(userId);

      // null selection = sync all (default/backward-compatible); otherwise
      // only the listed IDs are selected.
      const selectedCalendarIds = tokens.selectedCalendarIds;
      // null write target = the account's primary calendar (default).
      const writeCalendarId = tokens.writeCalendarId || "primary";

      // Combine calendar info with assignment info
      const calendarsWithAssignments = calendars.map(calendar => ({
        ...calendar,
        assignedProfileId: assignments.find(a => a.calendarId === calendar.id && a.calendarType === 'google')?.profileId || null,
        selected: selectedCalendarIds ? selectedCalendarIds.includes(calendar.id) : true,
        // "primary" is Google's alias for the account's own primary
        // calendar — cal.id is the real email-address-style id, so match on
        // cal.primary instead when the stored target is still the default.
        isWriteTarget: writeCalendarId === "primary" ? !!calendar.primary : calendar.id === writeCalendarId,
        canWrite: calendar.accessRole === "owner" || calendar.accessRole === "writer",
      }));

      res.json(calendarsWithAssignments);
    } catch (error) {
      console.error("Error fetching available calendars:", error);
      res.status(500).json({ error: "Failed to fetch available calendars" });
    }
  });

  // Save which of the account's calendars should be synced. Body:
  // { calendarIds: string[] } — an empty array is valid (sync nothing).
  app.post("/api/google-calendar/selected-calendars/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }

      const { calendarIds } = req.body ?? {};
      if (!Array.isArray(calendarIds) || !calendarIds.every((id) => typeof id === "string")) {
        res.status(400).json({ error: "calendarIds must be an array of strings" });
        return;
      }

      const tokens = await storage.getGoogleCalendarTokens(profileId);
      if (!tokens || !tokens.isActive) {
        res.status(404).json({ error: "No Google Calendar connection found" });
        return;
      }

      const updated = await storage.setGoogleCalendarSelection(profileId, calendarIds);
      res.json({ selectedCalendarIds: updated?.selectedCalendarIds ?? calendarIds });
    } catch (error) {
      console.error("Error saving Google calendar selection:", error);
      res.status(500).json({ error: "Failed to save calendar selection" });
    }
  });

  // Save which calendar new (app-created) events are pushed to. Body:
  // { calendarId: string | null } — null resets to the primary calendar.
  app.post("/api/google-calendar/write-target/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }

      const { calendarId } = req.body ?? {};
      if (calendarId !== null && typeof calendarId !== "string") {
        res.status(400).json({ error: "calendarId must be a string or null" });
        return;
      }

      const tokens = await storage.getGoogleCalendarTokens(profileId);
      if (!tokens || !tokens.isActive) {
        res.status(404).json({ error: "No Google Calendar connection found" });
        return;
      }

      // Verify the chosen calendar actually belongs to this account and is
      // writable — otherwise every future event-create silently 403s.
      if (calendarId !== null) {
        const calendars = await googleCalendarService.getAvailableCalendars(
          tokens.accessToken,
          tokens.refreshToken || undefined,
        );
        const target = calendars.find((c) => c.id === calendarId);
        if (!target) {
          res.status(400).json({ error: "That calendar wasn't found on this account." });
          return;
        }
        if (target.accessRole !== "owner" && target.accessRole !== "writer") {
          res.status(400).json({ error: "You don't have write access to that calendar." });
          return;
        }
      }

      const updated = await storage.setGoogleCalendarWriteTarget(profileId, calendarId);
      res.json({ writeCalendarId: updated?.writeCalendarId ?? calendarId });
    } catch (error) {
      console.error("Error saving Google calendar write target:", error);
      res.status(500).json({ error: "Failed to save write target" });
    }
  });

  // Outlook Calendar Integration
  const outlookCalendarService = new OutlookCalendarService();

  // REPLIT_DEV_DOMAIN is documented as a bare hostname (no scheme) — building
  // the redirect URI by simple string interpolation previously produced
  // something like "myapp.repl.co/api/..." with no "https://" prefix, which
  // isn't a valid absolute URI. Azure's redirect-URI allowlist match is exact,
  // so the domain itself is left untouched here — only a missing scheme is
  // ever added, never a different host.
  const outlookRedirectUri = () => {
    const domain = process.env.REPLIT_DEV_DOMAIN || '';
    return /^https?:\/\//i.test(domain)
      ? `${domain}/api/auth/outlook/callback`
      : `https://${domain}/api/auth/outlook/callback`;
  };

  app.get("/api/auth/outlook", async (req, res) => {
    const clientId = process.env.OUTLOOK_CLIENT_ID || '';
    const redirectUri = outlookRedirectUri();
    // The legacy `?profileId=` form is gone deliberately: it let anyone name
    // any profile with no proof whatsoever, which is the same hole the signed
    // state closes. A signed state is now the only accepted form.
    const state = req.query.state as string | undefined;
    const check = await peekOAuthTransaction(state, "outlook");
    if (!check.ok) {
      console.warn("Rejected Outlook OAuth start:", check.reason);
      return res.redirect(webCalendarReturn("outlook_calendar_error=invalid_state"));
    }
    const authUrl = outlookCalendarService.generateAuthUrl(clientId, redirectUri, state);
    res.redirect(authUrl);
  });

  app.get("/api/auth/outlook/callback", async (req, res) => {
    // Outside the try so the catch can hand a native caller back to the app
    // rather than stranding it on a web error page — the same scope bug the
    // Google callback had, fixed here before it could bite.
    let outlookMobileRedirect: string | null = null;
    try {
      const { code, error: oauthError, state } = req.query;

      if (oauthError) {
        console.error('Outlook OAuth error:', oauthError);
        return res.redirect(webCalendarReturn("outlook_calendar_error=access_denied"));
      }

      if (!code) {
        console.error('No authorization code received in callback');
        return res.status(400).json({ error: "No authorization code received" });
      }

      // Validated BEFORE the code is exchanged. The old order spent a network
      // round-trip and burned a single-use authorization code before finding
      // out the request was junk.
      const verified = await consumeOAuthTransaction(state as string, "outlook");
      if (!verified.ok) {
        console.warn('Rejected Outlook OAuth callback:', verified.reason);
        return res.redirect(webCalendarReturn("outlook_calendar_error=invalid_state"));
      }
      const profileId = verified.profileId;
      outlookMobileRedirect = verified.redirectMode === "native" ? nativeRedirectFor("outlook") : null;

      if (!(await oauthActorStillValid(verified))) {
        console.warn("Outlook OAuth callback from an account no longer entitled to complete it");
        return res.redirect(webCalendarReturn("outlook_calendar_error=invalid_state"));
      }

      console.log('Received authorization code, exchanging for tokens...');
      const clientId = process.env.OUTLOOK_CLIENT_ID || '';
      const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || '';
      const redirectUri = outlookRedirectUri();
      const tokens = await outlookCalendarService.exchangeCodeForTokens(clientId, clientSecret, redirectUri, code as string);

      // Best-effort fetch of the account email for display/account mapping.
      let email: string | null = null;
      try {
        const me: any = await outlookCalendarService.getUserProfile(tokens.access_token!);
        email = me?.mail || me?.userPrincipalName || null;
      } catch { /* non-fatal */ }

      // saveOutlookCalendarTokens deletes and reinserts the row — carrying
      // these forward from the pre-reconnect row is the same fix already
      // applied to the silent hourly-refresh path in calendarSync.ts;
      // "Reconnect" hit the identical bug via this separate code path and
      // would otherwise silently reset the family back to "sync all
      // calendars" / the default write target.
      const existingOutlookTokens = await storage.getOutlookCalendarTokens(profileId);

      await storage.saveOutlookCalendarTokens({
        profileId,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || null,
        tokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        email,
        isActive: true,
        selectedCalendarIds: existingOutlookTokens?.selectedCalendarIds ?? null,
        writeCalendarId: existingOutlookTokens?.writeCalendarId ?? null,
      });
      // Mark the profile as connected so its Outlook events are fetched/displayed.
      await storage.updateProfile(profileId, { outlookCalendarConnected: true });
      console.log('Outlook Calendar tokens saved for profile:', profileId);

      retryFailedSyncsForProfile(profileId, "outlook").catch((e) =>
        console.warn("Retry after Outlook reconnect failed:", e instanceof Error ? e.message : e));
      scanAfterConnect(profileId).catch((e) =>
        console.warn("Inbox scan after Outlook connect failed:", e instanceof Error ? e.message : e));

      // Redirect back to app with success
      if (outlookMobileRedirect) {
        const sep = outlookMobileRedirect.includes("?") ? "&" : "?";
        const deepLink = `${outlookMobileRedirect}${sep}outlook_calendar_connected=true&profileId=${profileId}`;
        const safeDeepLink = JSON.stringify(deepLink);
        return res.send(`<!DOCTYPE html><html><head><title>Connecting calendar...</title>
<script>window.location=${safeDeepLink};</script>
</head><body><p>Completing calendar connection, returning to app...</p></body></html>`);
      }
      res.redirect(webCalendarReturn(`outlook_calendar_connected=true&profileId=${profileId}`));
    } catch (error) {
      console.error("Outlook Calendar auth error:", error);
      if (outlookMobileRedirect) {
        const sep = outlookMobileRedirect.includes("?") ? "&" : "?";
        const deepLink = `${outlookMobileRedirect}${sep}outlook_calendar_error=true`;
        const safeDeepLink = JSON.stringify(deepLink);
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>
<script>window.location=${safeDeepLink};</script>
</head><body><p>Returning to app...</p></body></html>`);
      }
      res.redirect(webCalendarReturn("outlook_calendar_error=true"));
    }
  });

  // Short-lived per-profile cache: the frontend already polls this at a 60s
  // staleTime, but several components (Home/Calendar/People) can each hold
  // their own query instance, turning one page view into N simultaneous Graph
  // calls for the same profile. A 45s cache absorbs that burst without ever
  // serving data meaningfully staler than the frontend already tolerates.
  const outlookEventsCache = new Map<string, { events: any[]; expiresAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of outlookEventsCache) {
      if (now > entry.expiresAt) outlookEventsCache.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  app.get("/api/outlook-calendar/events/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req as any);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });

      // Theoretical at today's scale, but a runaway client (or many family
      // members' devices polling at once) shouldn't be able to hammer Graph
      // on this account's behalf with no limit at all.
      if (!checkRateLimit(`outlook-events:${profileId}`, 30, 60_000)) {
        return res.status(429).json({ message: "Too many calendar refreshes — please wait a moment and try again." });
      }

      const cached = outlookEventsCache.get(profileId);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json(cached.events);
      }

      const [tokens, profile] = await Promise.all([
        storage.getOutlookCalendarTokens(profileId),
        storage.getProfile(profileId),
      ]);

      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ error: "No Outlook Calendar connection found" });
      }

      // Was tokens.accessToken directly — Graph tokens expire in ~1h, so any
      // read more than an hour after connecting (or after the last write-
      // triggered refresh) 401'd here and this route always returned it as a
      // generic 500, indistinguishable from "no events." Refresh first, same
      // as the write path already does.
      const accessToken = await getFreshOutlookAccessToken(profileId);
      if (!accessToken) {
        return res.status(404).json({ error: "No Outlook Calendar connection found" });
      }
      let events = await outlookCalendarService.getCalendarEvents(accessToken, tokens.selectedCalendarIds);

      // Dedup: drop Outlook copies the app itself created (two-way sync) so they
      // don't appear twice alongside the local DB row.
      if (profile?.userId) {
        const syncedOutlookIds = await storage.getExternalEventIdsByUser(profile.userId, "outlook");
        if (syncedOutlookIds.size > 0) {
          events = events.filter((e: any) => !(e.id && syncedOutlookIds.has(e.id)));
        }
      }

      outlookEventsCache.set(profileId, { events, expiresAt: Date.now() + 45_000 });
      res.json(events);
    } catch (error) {
      console.error("Error fetching Outlook Calendar events:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  app.patch("/api/outlook-calendar/events/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const eventId = req.body?.eventId;
      if (typeof eventId !== "string" || !eventId) return res.status(400).json({ error: "Missing event" });
      const accessToken = await getFreshOutlookAccessToken(profileId);
      if (!accessToken) return res.status(404).json({ error: "No Outlook Calendar connection found" });
      const { title, location, start, end, isAllDay } = req.body ?? {};
      await outlookCalendarService.updateEvent(accessToken, eventId, {
        ...(title !== undefined ? { title } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(start && end ? { start: new Date(start), end: new Date(end), isAllDay: !!isAllDay } : {}),
      });
      outlookEventsCache.delete(profileId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating Outlook Calendar event:", error);
      res.status(500).json({ error: "Failed to update calendar event" });
    }
  });

  app.delete("/api/outlook-calendar/events/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const eventId = req.query.eventId;
      if (typeof eventId !== "string" || !eventId) return res.status(400).json({ error: "Missing event" });
      const accessToken = await getFreshOutlookAccessToken(profileId);
      if (!accessToken) return res.status(404).json({ error: "No Outlook Calendar connection found" });
      await outlookCalendarService.deleteEvent(accessToken, eventId);
      outlookEventsCache.delete(profileId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting Outlook Calendar event:", error);
      res.status(500).json({ error: "Failed to delete calendar event" });
    }
  });

  app.delete("/api/outlook-calendar/disconnect/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      await storage.disconnectOutlookCalendar(profileId);
      await storage.updateProfile(profileId, { outlookCalendarConnected: false });
      res.status(204).send();
    } catch (error) {
      console.error("Error disconnecting Outlook Calendar:", error);
      res.status(500).json({ error: "Failed to disconnect Outlook Calendar" });
    }
  });

  // Get available calendars for a profile (with assignment info)
  app.get("/api/outlook-calendar/available-calendars/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const tokens = await storage.getOutlookCalendarTokens(profileId);
      
      if (!tokens || !tokens.isActive) {
        return res.status(404).json({ error: "No Outlook Calendar connection found" });
      }

      // Refresh first — see the events route above for why the raw stored
      // token isn't safe to use directly here either.
      const accessToken = await getFreshOutlookAccessToken(profileId);
      if (!accessToken) {
        return res.status(404).json({ error: "No Outlook Calendar connection found" });
      }
      // Get calendar list from Outlook Calendar service
      const calendars = await outlookCalendarService.getAvailableCalendars(accessToken);

      // This family's assignments only — see the Google equivalent above.
      const assignments = await storage.getCalendarAssignmentsByUser(userId);

      // null selection = sync all (default/backward-compatible); otherwise
      // only the listed IDs are selected.
      const selectedCalendarIds = tokens.selectedCalendarIds;
      const writeCalendarId = tokens.writeCalendarId; // null = account's default calendar

      // Combine calendar info with assignment info
      const calendarsWithAssignments = calendars.map(calendar => ({
        ...calendar,
        assignedProfileId: assignments.find(a => a.calendarId === calendar.id && a.calendarType === 'outlook')?.profileId || null,
        selected: selectedCalendarIds ? selectedCalendarIds.includes(calendar.id) : true,
        isWriteTarget: writeCalendarId ? calendar.id === writeCalendarId : calendar.isDefaultCalendar,
        canWrite: calendar.canEdit,
      }));

      res.json(calendarsWithAssignments);
    } catch (error) {
      console.error("Error fetching available Outlook calendars:", error);
      res.status(500).json({ error: "Failed to fetch available Outlook calendars" });
    }
  });

  // Save which of the account's calendars should be synced. Body:
  // { calendarIds: string[] } — an empty array is valid (sync nothing).
  app.post("/api/outlook-calendar/selected-calendars/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }

      const { calendarIds } = req.body ?? {};
      if (!Array.isArray(calendarIds) || !calendarIds.every((id) => typeof id === "string")) {
        res.status(400).json({ error: "calendarIds must be an array of strings" });
        return;
      }

      const tokens = await storage.getOutlookCalendarTokens(profileId);
      if (!tokens || !tokens.isActive) {
        res.status(404).json({ error: "No Outlook Calendar connection found" });
        return;
      }

      const updated = await storage.setOutlookCalendarSelection(profileId, calendarIds);
      res.json({ selectedCalendarIds: updated?.selectedCalendarIds ?? calendarIds });
    } catch (error) {
      console.error("Error saving Outlook calendar selection:", error);
      res.status(500).json({ error: "Failed to save calendar selection" });
    }
  });

  // Save which calendar new (app-created) events are pushed to. Body:
  // { calendarId: string | null } — null resets to the default calendar.
  app.post("/api/outlook-calendar/write-target/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const { profileId } = req.params;
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }

      const { calendarId } = req.body ?? {};
      if (calendarId !== null && typeof calendarId !== "string") {
        res.status(400).json({ error: "calendarId must be a string or null" });
        return;
      }

      const tokens = await storage.getOutlookCalendarTokens(profileId);
      if (!tokens || !tokens.isActive) {
        res.status(404).json({ error: "No Outlook Calendar connection found" });
        return;
      }

      // Verify the chosen calendar actually belongs to this account and is
      // writable — otherwise every future event-create silently fails.
      if (calendarId !== null) {
        // Refresh first — same expired-token issue as the read routes above.
        const accessToken = await getFreshOutlookAccessToken(profileId);
        if (!accessToken) {
          res.status(404).json({ error: "No Outlook Calendar connection found" });
          return;
        }
        const calendars = await outlookCalendarService.getAvailableCalendars(accessToken);
        const target = calendars.find((c) => c.id === calendarId);
        if (!target) {
          res.status(400).json({ error: "That calendar wasn't found on this account." });
          return;
        }
        if (!target.canEdit) {
          res.status(400).json({ error: "You don't have write access to that calendar." });
          return;
        }
      }

      const updated = await storage.setOutlookCalendarWriteTarget(profileId, calendarId);
      res.json({ writeCalendarId: updated?.writeCalendarId ?? calendarId });
    } catch (error) {
      console.error("Error saving Outlook calendar write target:", error);
      res.status(500).json({ error: "Failed to save write target" });
    }
  });

  // Get weather data  
  app.get("/api/weather", isAuthenticated, async (req: any, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      // Was unauthenticated and read storage.getLocationSettings() — a bare
      // `SELECT * FROM location_settings LIMIT 1` with no userId filter — so
      // EVERY family got whichever account's location happened to sort first
      // in the table, and any unauthenticated caller could read it too.
      // getLocationSettingsByUser scopes to the caller's own family, same as
      // every other per-family route.
      const userId = getUserId(req);
      const locationSettings = await storage.getLocationSettingsByUser(userId);
      const lat = req.query.lat || locationSettings?.latitude?.toString() || "44.6402";
      const lon = req.query.lon || locationSettings?.longitude?.toString() || "-93.1468";

      // Canada reads temperatures in Celsius; the US in Fahrenheit. This was
      // hardcoded to fahrenheit, which is right for one of the two countries
      // the app now ships to. The chip renders a bare degree symbol, so the
      // NUMBER is the whole of what a reader sees — getting the unit wrong is
      // not a cosmetic difference.
      const tempUnit =
        (locationSettings?.country ?? "").trim().toLowerCase() === "canada"
          ? "celsius"
          : "fahrenheit";

      // Fetch weather from Open-Meteo API (free, no API key required)
      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&temperature_unit=${tempUnit}`
      );
      
      if (!weatherResponse.ok) {
        throw new Error("Failed to fetch weather data");
      }
      
      const weatherData = await weatherResponse.json();
      
      // Get location name from settings or use reverse geocoding
      let locationName = "Unknown Location";
      if (locationSettings) {
        locationName = `${locationSettings.city}, ${locationSettings.state}`;
      } else {
        try {
          const geoResponse = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
          );
          if (geoResponse.ok) {
            const geoData = await geoResponse.json();
            locationName = geoData.city || geoData.locality || geoData.principalSubdivision || "Unknown Location";
          }
        } catch (geoError) {
          console.warn("Failed to fetch location name:", geoError);
        }
      }
      
      // Map weather codes to conditions
      const getWeatherCondition = (code: number) => {
        if (code === 0) return { condition: "clear", description: "Clear sky" };
        if (code <= 3) return { condition: "clouds", description: "Partly cloudy" };
        if (code <= 48) return { condition: "clouds", description: "Foggy" };
        if (code <= 67) return { condition: "rain", description: "Rainy" };
        if (code <= 77) return { condition: "snow", description: "Snowy" };
        if (code <= 82) return { condition: "rain", description: "Showers" };
        if (code <= 86) return { condition: "snow", description: "Snow showers" };
        if (code <= 99) return { condition: "rain", description: "Thunderstorm" };
        return { condition: "clouds", description: "Cloudy" };
      };
      
      const weatherCondition = getWeatherCondition(weatherData.current_weather?.weathercode || 0);
      
      const daily = weatherData.daily ?? {};
      const days = (daily.time ?? []).map((date: string, index: number) => {
        const code = getWeatherCondition(daily.weathercode?.[index] || 0);
        return {
          date,
          high: Math.round(daily.temperature_2m_max?.[index] || 0),
          low: Math.round(daily.temperature_2m_min?.[index] || 0),
          condition: code.condition,
        };
      });
      const result = {
        location: locationName,
        temperature: Math.round(weatherData.current_weather?.temperature || 70),
        high: Math.round(weatherData.daily?.temperature_2m_max?.[0] || 75),
        low: Math.round(weatherData.daily?.temperature_2m_min?.[0] || 65),
        condition: weatherCondition.condition,
        description: weatherCondition.description,
        days,
      };
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching weather:", error);
      // This fallback payload used to ship on a 500 — but the frontend's
      // default queryFn (throwIfResNotOk) rejects any non-2xx response before
      // ever looking at the body, so the "graceful degradation" was dead code:
      // the widget just discarded it and rendered nothing. A 200 is what
      // actually lets weather-widget.tsx use these placeholder values.
      res.status(200).json({
        location: "Weather Unavailable",
        temperature: 70,
        high: 75,
        low: 65,
        condition: "clouds",
        description: "Unable to load weather"
      });
    }
  });

  // Object Storage Routes
  //
  // Deliberately NOT behind isAuthenticated: images render as <img src>,
  // which cannot send an Authorization header, and on native the WebView runs
  // at capacitor://localhost so the session cookie is cross-origin and is not
  // sent either. Requiring auth here would blank every avatar in the app.
  // A signature in the URL is what authorizes the request instead — see
  // lib/objectSigning.ts.
  app.get("/objects/*name", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const check = verifyObjectSignature(req.path, req.query as Record<string, unknown>);

    // ⚠️ THE CHOKE POINT. A signature proves the server signed this path for
    // that household — NOT that the path belongs to it. Without this check a
    // household could reach another's object two ways: ask /api/objects/sign
    // to sign a path it does not own, or attach that path to one of its own
    // records and let the outbound signer sign it automatically. Comparing
    // the signature's household against the STORED owner closes both at once,
    // which is why it lives here rather than at each of those routes.
    //
    // Deliberately enforced whenever a valid signature is presented, even
    // with OBJECT_URL_ENFORCEMENT off: a correct request always matches, so
    // there is nothing to stage.
    if (check.ok) {
      const owner = await objectStorageService.getObjectOwner(req.path);
      if (owner.exists && owner.userId && owner.userId !== check.userId) {
        req.log.warn(
          { path: req.path, signedFor: check.userId, ownedBy: owner.userId },
          "Refused a signed object request from a different household",
        );
        return res.sendStatus(403);
      }
      // owner.userId === null is a pre-2026-09-19 upload with no recorded
      // owner. Allowed, and logged, until the backfill has run.
      if (owner.exists && !owner.userId) {
        req.log.warn({ path: req.path }, "Served an object with no recorded owner — run the upload-owner backfill");
      }
    }

    if (!check.ok) {
      // OBJECT_URL_ENFORCEMENT lets the signing roll out before it starts
      // refusing anything: unsigned requests are logged with their referrer
      // so every serialization site that still emits a bare path can be
      // found, and only then is it switched on. Same shape as
      // SUBSCRIPTION_ENFORCEMENT_ENABLED, for the same reason.
      if (process.env.OBJECT_URL_ENFORCEMENT === "true") {
        return res.sendStatus(check.reason === "expired" ? 410 : 403);
      }
      req.log.warn(
        { reason: check.reason, path: req.path, referrer: req.get("referer") ?? null },
        "Unsigned object request — would be refused with OBJECT_URL_ENFORCEMENT on",
      );
    }
    try {
      await objectStorageService.streamToResponse(req.path, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      req.log.error({ err: error }, "Error serving object");
      return res.sendStatus(500);
    }
  });

  // Sign a path the CLIENT already holds. Needed only for the privacy-screen
  // background, whose chosen image lives in this device's localStorage rather
  // than in any API response, so it never passes through the outbound signer.
  app.post("/api/objects/sign", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    // The inbound strip in app.ts has already reduced this to a bare path.
    const path = typeof req.body?.path === "string" ? req.body.path : null;
    if (!path || !path.startsWith("/objects/")) {
      return res.status(400).json({ error: "A /objects/ path is required" });
    }

    // Fail fast on a path this household does not own. /objects/* checks the
    // same thing when the URL is actually used, so this is belt and braces —
    // but without it, signing happily hands out a working URL for someone
    // else's file and the refusal only appears later.
    const owner = await new ObjectStorageService().getObjectOwner(path);
    if (!owner.exists) {
      return res.status(404).json({ error: "Not found" });
    }
    if (owner.userId && owner.userId !== userId) {
      req.log?.warn?.({ path, requestedBy: userId, ownedBy: owner.userId }, "Refused to sign another household's object");
      return res.status(403).json({ error: "Not found" });
    }
    // res.json is wrapped by the outbound signer, which would sign this
    // again. Harmless (signObjectPath strips first) but pointless, and
    // clearer to be explicit about producing the value ourselves.
    return res.json({ url: signObjectPath(path, userId) });
  });

  const multer = (await import("multer")).default;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    // Rejected before the bytes are ever stored. See lib/uploadTypes.ts for
    // why SVG is excluded even though it is an image.
    fileFilter: (_req, file, cb) => {
      if (isAllowedUploadType(file.mimetype)) return cb(null, true);
      cb(new UnsupportedUploadTypeError(file.mimetype));
    },
  });

  app.post(
    "/api/objects/upload",
    isAuthenticated,
    (req: any, res, next) => {
      upload.single("file")(req, res, (err: any) => {
        if (err instanceof UnsupportedUploadTypeError) {
          return res.status(415).json({
            error: "That file type can't be uploaded. Use a photo (JPEG, PNG, HEIC or WebP) or a PDF.",
          });
        }
        if (err) return next(err);
        next();
      });
    },
    async (req: any, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      const objectStorageService = new ObjectStorageService();
      try {
        const { objectName, objectPath } = objectStorageService.generateUploadTarget();
        // Was `req.user?.id`, which does not exist on this codebase's auth
        // shape — so userId was undefined on EVERY upload and uploaded_files
        // rows were stored with no owner at all. getUserId gives the family
        // owner id, which is the right tenant key here: a photo belongs to
        // the household, so a spouse can see it and it survives the
        // uploader leaving.
        const userId = getUserId(req);
        await objectStorageService.uploadFile(objectName, req.file.buffer, req.file.mimetype, userId);
        // `objectPath` stays BARE on purpose: callers persist it, and a
        // signed URL in the database (or in the privacy screen's
        // localStorage) would expire in a week and leave a permanently
        // broken image. `signedUrl` is the one to render immediately.
        res.locals.skipObjectSigning = true;
        res.json({ objectPath, signedUrl: signObjectPath(objectPath, userId) });
      } catch (error) {
        req.log.error({ err: error }, "Error uploading file");
        res.status(500).json({ error: "Failed to upload file" });
      }
    },
  );

  app.put("/api/profile-images", isAuthenticated, async (req: any, res) => {
    if (!req.body.profileImageURL || !req.body.profileId) {
      return res.status(400).json({ message: "Couldn't save the photo — please try uploading it again." });
    }

    try {
      const userId = getUserId(req);
      const isOwner = await validateProfileOwnership(req.body.profileId, userId);
      if (!isOwner) return res.status(403).json({ error: "Forbidden" });
      const objectStorageService = new ObjectStorageService();
      const objectPath = objectStorageService.normalizeObjectEntityPath(
        req.body.profileImageURL,
      );

      // Update the profile with the new photo URL
      const profile = await storage.updateProfile(req.body.profileId, {
        photoUrl: objectPath,
      });

      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.status(200).json({
        objectPath: objectPath,
        profile: profile,
      });
    } catch (error) {
      console.error("Error setting profile image:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Daily Content
  app.get("/api/daily-content", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const content = await storage.getDailyContentByUser(userId);
      res.json(content);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily content" });
    }
  });

  app.post("/api/daily-content", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const contentData = insertDailyContentSchema.parse(req.body);
      const content = await storage.createDailyContent({ ...contentData, userId });
      res.status(201).json(content);
    } catch (error) {
      res.status(400).json({ message: "Invalid content data" });
    }
  });

  app.put("/api/daily-content/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const updates = insertDailyContentSchema.partial().parse(req.body);
      const content = await storage.updateDailyContent(id, updates, userId);
      if (!content) {
        return res.status(404).json({ message: "Content not found" });
      }
      res.json(content);
    } catch (error) {
      res.status(400).json({ message: "Invalid content data" });
    }
  });

  app.delete("/api/daily-content/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const success = await storage.deleteDailyContent(id, userId);
      if (!success) {
        return res.status(404).json({ message: "Content not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete content" });
    }
  });

  // Daily Content Assignments
  app.get("/api/daily-content-assignments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const assignments = await storage.getAllDailyContentAssignmentsByUser(userId);
      res.json(assignments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  app.get("/api/daily-content/:contentId/assignments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { contentId } = req.params;
      const assignments = await storage.getDailyContentAssignmentsByContentAndUser(contentId, userId);
      res.json(assignments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  app.post("/api/daily-content/:contentId/assignments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { contentId } = req.params;
      const { profileIds } = req.body;

      // Validate that all provided profileIds belong to this user
      const userProfiles = await storage.getProfilesByUser(userId);
      const userProfileIds = new Set(userProfiles.map(p => p.id));
      if (!Array.isArray(profileIds) || profileIds.some((id: string) => !userProfileIds.has(id))) {
        return res.status(403).json({ message: "Access denied: One or more profiles do not belong to you" });
      }

      // The PROFILES were checked above; the CONTENT was not. Without this,
      // a foreign contentId would first DELETE that household's assignments
      // for it and then point their content at this family's profiles — a
      // destructive write, not just a read. Needs the content's unguessable
      // UUID, so defence in depth rather than a reachable defect.
      const target = await storage.getDailyContentById(contentId);
      if (!target) {
        return res.status(404).json({ message: "Not found" });
      }
      if (target.userId && target.userId !== userId) {
        return res.status(403).json({ message: "Access denied: that content does not belong to you" });
      }

      // Delete existing assignments and recreate
      await storage.deleteDailyContentAssignments(contentId);

      const assignments = [];
      for (const profileId of profileIds) {
        const assignment = await storage.createDailyContentAssignment({
          contentId,
          profileId,
        });
        assignments.push(assignment);
      }

      res.status(201).json(assignments);

      // Own try/catch: res is already sent above. Only notes get a push —
      // other daily-content types (affirmations, bible verses, etc.) are
      // assigned through this same endpoint but aren't "posted" the way a
      // note is, so pushing for those would be noisy and unexpected.
      // Assigning a note to everyone (via the "All Family" option, which the
      // frontend expands to every real profileId) is how a user makes a
      // family-wide announcement — see CLAUDE.md.
      try {
        const content = await storage.getDailyContentById(contentId);
        if (content?.type === "note" && profileIds.length > 0) {
          const authorProfile = content.reference ? await storage.getProfile(content.reference) : null;
          const payload = {
            title: authorProfile ? `${authorProfile.name} posted a note` : "New note",
            body: content.content,
            url: "/?openTab=home&openAction=notesSection",
            tag: `note-${content.id}`,
            data: { kind: "note", contentId: content.id },
          };
          await Promise.all(
            profileIds.map((profileId: string) =>
              sendPushToUser({ userId, profileId }, payload, "notePosted"),
            ),
          );
        }
      } catch (err) {
        console.error("Failed to send note-posted notification:", err);
      }
    } catch (error) {
      res.status(400).json({ message: "Invalid assignment data" });
    }
  });

  // Daily Content Completions
  app.get("/api/daily-content-completions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { profileId, date } = req.query;
      if (profileId) {
        const isOwner = await validateProfileOwnership(profileId as string, userId);
        if (!isOwner) {
          return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
        }
        const completions = await storage.getDailyContentCompletions(
          profileId as string,
          date ? new Date(date as string) : undefined
        );
        return res.json(completions);
      }
      const completions = await storage.getDailyContentCompletionsByUser(
        userId,
        date ? new Date(date as string) : undefined
      );
      res.json(completions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch completions" });
    }
  });

  app.post("/api/daily-content-completions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const completionData = insertDailyContentCompletionSchema.parse(req.body);
      const isOwner = await validateProfileOwnership(completionData.profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      const completion = await storage.createDailyContentCompletion(completionData);
      res.status(201).json(completion);
    } catch (error) {
      res.status(400).json({ message: "Invalid completion data" });
    }
  });

  app.delete("/api/daily-content-completions/:contentId/:profileId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { contentId, profileId } = req.params;
      const isOwner = await validateProfileOwnership(profileId, userId);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied: Profile does not belong to you" });
      }
      const success = await storage.deleteDailyContentCompletion(contentId, profileId);
      if (!success) {
        return res.status(404).json({ message: "Completion not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete completion" });
    }
  });

  // ===== Meals =====
  app.get("/api/meals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { start, end } = req.query;
      const userMeals = (start && end)
        ? await storage.getMealsByUserAndDateRange(userId, String(start), String(end))
        : await storage.getMealsByUser(userId);
      const ingredients = await storage.getIngredientsByMealIds(userMeals.map(m => m.id));
      const ingredientsByMeal = new Map<string, typeof ingredients>();
      for (const ing of ingredients) {
        if (!ingredientsByMeal.has(ing.mealId)) ingredientsByMeal.set(ing.mealId, []);
        ingredientsByMeal.get(ing.mealId)!.push(ing);
      }
      const result = userMeals.map(m => ({
        ...m,
        ingredients: (ingredientsByMeal.get(m.id) || []).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
      }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch meals" });
    }
  });

  const mealIngredientPayloadSchema = z.array(z.object({
    quantity: z.string().nullable().optional(),
    item: z.string(),
    displayOrder: z.number().optional(),
  })).optional();

  async function syncDinnerCalendar(
    userId: string,
    previous: { date: string; slot: string; name: string } | null,
    next: { date: string; slot: string; name: string } | null,
  ) {
    try {
      const settings = await storage.getCalendarSettingsByUser(userId);
      const events = await storage.getEventsByUser(userId);
      const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
      const change = dinnerCalendarChange(previous, next, events, settings?.familyCalendarId, settings?.mealsOnCalendar === true, timeZone);
      if (change.updateId && change.create) {
        const updated = await storage.updateEvent(change.updateId, change.create, userId);
        if (updated && dinnerLeavesTheApp(updated)) {
          void syncEventUpdate(updated).catch((err) => console.warn("Dinner calendar update failed:", err instanceof Error ? err.message : err));
        }
      }
      for (const id of change.deleteIds) {
        const links = await storage.getEventCalendarSyncs(id).catch(() => []);
        await storage.deleteEvent(id, userId);
        void syncEventDelete(links).catch((err) => console.warn("Dinner calendar delete failed:", err instanceof Error ? err.message : err));
      }
      if (!change.updateId && change.create) {
        const created = await storage.createEvent({ ...change.create, userId });
        if (dinnerLeavesTheApp(created)) {
          void syncEventCreate(created).catch((err) => console.warn("Dinner calendar create failed:", err instanceof Error ? err.message : err));
        }
      }
    } catch (err) {
      console.error("Dinner calendar sync failed:", err);
    }
  }

  app.post("/api/meals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { ingredients: ingredientsRaw, ...rest } = req.body || {};
      const mealData = insertMealSchema.parse({ ...rest, userId });
      const ingredients = mealIngredientPayloadSchema.parse(ingredientsRaw) || [];
      const created = await storage.createMeal(mealData);
      const savedIngredients = await storage.replaceMealIngredients(created.id, ingredients);
      const settings = await storage.getCalendarSettingsByUser(userId);
      const timeZone = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
      const dinnerEvent = dinnerEventInsert(created, settings?.familyCalendarId, settings?.mealsOnCalendar === true, timeZone);
      if (dinnerEvent) {
        try {
          const created = await storage.createEvent({ ...dinnerEvent, userId });
          if (dinnerLeavesTheApp(created)) {
            void syncEventCreate(created).catch((err) => console.warn("Dinner calendar create failed:", err instanceof Error ? err.message : err));
          }
        } catch (err) {
          console.error("Dinner calendar write failed:", err);
        }
      }
      res.status(201).json({ ...created, ingredients: savedIngredients });
    } catch (error) {
      console.error("Meal creation error:", error);
      res.status(400).json({ message: "Invalid meal data" });
    }
  });

  app.patch("/api/meals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { ingredients: ingredientsRaw, ...rest } = req.body || {};
      const updates = insertMealSchema.partial().omit({ userId: true }).parse(rest);
      const previous = await storage.getMeal(id, userId);
      const meal = await storage.updateMeal(id, updates, userId);
      if (!meal) return res.status(404).json({ message: "Meal not found" });
      await syncDinnerCalendar(userId, previous ?? null, meal);
      let savedIngredients;
      if (Array.isArray(ingredientsRaw)) {
        const ingredients = mealIngredientPayloadSchema.parse(ingredientsRaw) || [];
        savedIngredients = await storage.replaceMealIngredients(id, ingredients);
      } else {
        savedIngredients = await storage.getIngredientsByMealIds([id]);
      }
      res.json({ ...meal, ingredients: savedIngredients });
    } catch (error) {
      res.status(400).json({ message: "Invalid meal data" });
    }
  });

  app.delete("/api/meals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const previous = await storage.getMeal(req.params.id, userId);
      const success = await storage.deleteMeal(req.params.id, userId);
      if (!success) return res.status(404).json({ message: "Meal not found" });
      await syncDinnerCalendar(userId, previous ?? null, null);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete meal" });
    }
  });

  // ===== Grocery list aggregate (read-only computation) =====
  app.get("/api/grocery-list/aggregate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ message: "Please choose a start and end date." });
      }
      const userMeals = await storage.getMealsByUserAndDateRange(userId, String(start), String(end));
      const ingredients = await storage.getIngredientsByMealIds(userMeals.map(m => m.id));
      const aggregated = aggregateIngredients(ingredients);
      res.json(aggregated);
    } catch (error) {
      res.status(500).json({ message: "Failed to aggregate grocery list" });
    }
  });

  // ===== Persistent grocery items =====
  app.get("/api/grocery-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const items = await storage.getGroceryItemsByUser(userId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch grocery items" });
    }
  });

  app.post("/api/grocery-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const itemData = insertGroceryItemSchema.parse({ ...req.body, userId });
      const item = await storage.createGroceryItem(itemData);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ message: "Invalid grocery item data" });
    }
  });

  // Bulk-add grocery items in one round trip (used by the meal → grocery prompt).
  // Sanitizes server-side so a single bad field can't reject the batch.
  app.post("/api/grocery-items/bulk", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const items = rawItems
        .filter((it: any) => it && typeof it.name === "string" && it.name.trim())
        .map((it: any) => ({
          name: String(it.name).trim(),
          quantity: it.quantity != null ? String(it.quantity) : null,
          isChecked: false,
          sourceMealIds: Array.isArray(it.sourceMealIds) ? it.sourceMealIds.map(String) : [],
        }));
      const created = await storage.createGroceryItems(userId, items);
      res.status(201).json(created);
    } catch (error) {
      console.error("Grocery bulk-add error:", error);
      res.status(500).json({ message: "Failed to add grocery items" });
    }
  });

  app.patch("/api/grocery-items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertGroceryItemSchema.partial().omit({ userId: true }).parse(req.body);
      const item = await storage.updateGroceryItem(req.params.id, updates, userId);
      if (!item) return res.status(404).json({ message: "Grocery item not found" });
      res.json(item);
    } catch (error) {
      res.status(400).json({ message: "Invalid grocery item data" });
    }
  });

  app.delete("/api/grocery-items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteGroceryItem(req.params.id, userId);
      if (!success) return res.status(404).json({ message: "Grocery item not found" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete grocery item" });
    }
  });

  app.post("/api/grocery-items/clear-checked", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const removed = await storage.deleteCheckedGroceryItems(userId);
      res.json({ removed });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear checked items" });
    }
  });

  app.post("/api/grocery-items/regenerate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { start, end } = req.body || {};
      if (!start || !end) {
        return res.status(400).json({ message: "start and end required" });
      }
      const userMeals = await storage.getMealsByUserAndDateRange(userId, String(start), String(end));
      const ingredients = await storage.getIngredientsByMealIds(userMeals.map(m => m.id));
      const aggregated = aggregateIngredients(ingredients);
      const existing = await storage.getGroceryItemsByUser(userId);
      const kept = existing.filter((item) => item.alreadyHave);
      const keptNames = new Set(kept.map((item) => item.name.trim().toLowerCase()));
      const items = [
        ...aggregated
          .filter((a) => !keptNames.has(a.name.trim().toLowerCase()))
          .map((a) => ({
            name: a.name,
            quantity: a.quantity,
            isChecked: false,
            alreadyHave: false,
            sourceMealIds: a.sourceMealIds,
          })),
        ...kept.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          isChecked: false,
          alreadyHave: true,
          sourceMealIds: item.sourceMealIds ?? [],
        })),
      ];
      const created = await storage.replaceGroceryItemsForUser(userId, items);
      res.status(201).json(created);
    } catch (error) {
      console.error("Grocery regenerate error:", error);
      res.status(500).json({ message: "Failed to regenerate grocery list" });
    }
  });

  // ===== Grocery Staples (recurring "always want this" items) =====
  // Separate table from grocery_items so "Start new list" (which wipes
  // grocery_items) never touches these definitions.
  app.get("/api/grocery-staples", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const staples = await storage.getGroceryStaplesByUser(userId);
      res.json(staples.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch staples" });
    }
  });

  app.post("/api/grocery-staples", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const data = insertGroceryStapleSchema.parse({ ...req.body, userId });
      const staple = await storage.createGroceryStaple(data);
      res.status(201).json(staple);
    } catch (error) {
      res.status(400).json({ message: "Invalid staple data" });
    }
  });

  app.patch("/api/grocery-staples/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertGroceryStapleSchema.partial().omit({ userId: true }).parse(req.body);
      const staple = await storage.updateGroceryStaple(req.params.id, updates, userId);
      if (!staple) return res.status(404).json({ message: "Staple not found" });
      res.json(staple);
    } catch (error) {
      res.status(400).json({ message: "Invalid staple data" });
    }
  });

  app.delete("/api/grocery-staples/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteGroceryStaple(req.params.id, userId);
      if (!success) return res.status(404).json({ message: "Staple not found" });
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: "Failed to delete staple" });
    }
  });

  // Add a staple onto the currently-active grocery list — merges into an
  // existing unchecked item with the same name (case-insensitive) instead of
  // creating a duplicate row, combining quantities where they can be
  // confidently summed (see lib/groceryMerge.ts).
  app.post("/api/grocery-staples/:id/add-to-list", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const staples = await storage.getGroceryStaplesByUser(userId);
      const staple = staples.find((s) => s.id === req.params.id);
      if (!staple) return res.status(404).json({ message: "Staple not found" });

      const existingItems = await storage.getGroceryItemsByUser(userId);
      const match = existingItems.find(
        (it) => !it.isChecked && it.name.trim().toLowerCase() === staple.name.trim().toLowerCase(),
      );

      if (match) {
        const updated = await storage.updateGroceryItem(
          match.id,
          { quantity: mergeGroceryQuantities(match.quantity, staple.quantity) },
          userId,
        );
        return res.json(updated);
      }

      const created = await storage.createGroceryItem({
        userId,
        name: staple.name,
        quantity: staple.quantity,
        isChecked: false,
        sourceMealIds: [],
        category: staple.category,
      });
      return res.status(201).json(created);
    } catch (error) {
      console.error("Add staple to list error:", error);
      return res.status(500).json({ message: "Failed to add staple to list" });
    }
  });

  // ===== Saved Meals (reusable meal-idea repository) =====
  app.get("/api/saved-meals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const saved = await storage.getSavedMealsByUser(userId);
      const ingredients = await storage.getSavedMealIngredients(saved.map(m => m.id));
      const byMeal = new Map<string, typeof ingredients>();
      for (const ing of ingredients) {
        if (!byMeal.has(ing.savedMealId)) byMeal.set(ing.savedMealId, []);
        byMeal.get(ing.savedMealId)!.push(ing);
      }
      const result = saved
        .map(m => ({
          ...m,
          ingredients: (byMeal.get(m.id) || []).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch saved meals" });
    }
  });

  app.post("/api/saved-meals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { ingredients: ingredientsRaw, ...rest } = req.body || {};
      const data = insertSavedMealSchema.parse({ ...rest, userId });
      const ingredients = mealIngredientPayloadSchema.parse(ingredientsRaw) || [];
      const created = await storage.createSavedMeal(data);
      const savedIngredients = await storage.replaceSavedMealIngredients(created.id, ingredients);
      res.status(201).json({ ...created, ingredients: savedIngredients });
    } catch (error) {
      console.error("Saved meal creation error:", error);
      res.status(400).json({ message: "Invalid saved meal data" });
    }
  });

  // Import a recipe from a URL the user pasted, saving it straight into
  // their Meal Ideas. The fetch is SSRF-hardened (lib/safeFetch.ts) and
  // rate-limited per account — this is the one endpoint that makes the
  // server dial an arbitrary user-supplied host, so it shouldn't be
  // callable in a tight loop.
  // "Snap a Recipe" — read one recipe out of 1..N photos. Returns the parsed
  // recipe for review; the client saves it via the normal saved-meals POST
  // after the user has had a chance to edit it.
  app.post("/api/saved-meals/extract-photos", isAuthenticated, async (req: any, res) => {
    try {
      const accountId = getAuthAccountId(req);
      if (!(await requireEntitled(accountId, res))) return;
      // Vision calls are the most expensive thing here, so keep the ceiling
      // low enough to matter but well above real use (a family adding a few
      // recipes in one sitting).
      if (!checkRateLimit(`recipe-photos:${accountId}`, 30, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many recipe scans — try again in a bit." });
      }
      const { imageURLs } = z
        .object({ imageURLs: z.array(z.string().min(1)).min(1).max(MAX_RECIPE_IMAGES) })
        .parse(req.body ?? {});

      try {
        const recipe = await extractRecipeFromImages(imageURLs);
        return res.json(recipe);
      } finally {
        // Same reasoning as flyer-extract: these photos are a one-shot AI
        // input for the review screen, never referenced again after this
        // request — clean them up regardless of whether extraction
        // succeeded, instead of leaving up to MAX_RECIPE_IMAGES full-size
        // photos orphaned in Postgres per scan.
        const objectStorageService = new ObjectStorageService();
        for (const url of imageURLs) {
          objectStorageService.deleteObjectByPath(url).catch(() => false);
        }
      }
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ message: `Add between 1 and ${MAX_RECIPE_IMAGES} photos of the recipe` });
      }
      const message = err instanceof Error && err.message ? err.message : "Couldn't read that recipe";
      console.error("Recipe photo extract error:", message);
      return res.status(502).json({ message });
    }
  });

  app.post("/api/saved-meals/import-url", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const accountId = getAuthAccountId(req);
      if (!(await requireEntitled(accountId, res))) return;
      if (!checkRateLimit(`recipe-import:${accountId}`, 20, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many recipe imports — try again in a bit." });
      }
      const { url } = z.object({ url: z.string().min(1).max(2048) }).parse(req.body ?? {});

      const recipe = await importRecipeFromUrl(url);

      const created = await storage.createSavedMeal({
        userId,
        name: recipe.name,
        notes: null,
        recipeUrl: recipe.sourceUrl,
        directions: recipe.directions,
        sourceName: recipe.sourceName,
        importedAt: new Date(),
      });
      const ingredients = await storage.replaceSavedMealIngredients(
        created.id,
        recipe.ingredients.map((ing, idx) => ({
          quantity: ing.quantity,
          item: ing.item,
          displayOrder: idx,
        })),
      );
      return res.status(201).json({ ...created, ingredients, method: recipe.method });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ message: "Please paste a recipe link" });
      // importRecipeFromUrl throws user-facing messages (bad link, private
      // address, no recipe found, site refused) — pass them straight through
      // rather than flattening everything to a generic failure.
      const message = err instanceof Error && err.message
        ? err.message
        : "Couldn't import that recipe";
      console.warn("Recipe import failed:", message);
      // RecipeImportError's optional `code` (e.g. "site_blocked") rides along
      // so the frontend can special-case it later without another round trip
      // — today the message text alone already carries the important part.
      const code = err?.code;
      return res.status(400).json({ message, ...(code ? { code } : {}) });
    }
  });

  app.patch("/api/saved-meals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const { ingredients: ingredientsRaw, ...rest } = req.body || {};
      const updates = insertSavedMealSchema.partial().omit({ userId: true }).parse(rest);
      const saved = await storage.updateSavedMeal(id, updates, userId);
      if (!saved) return res.status(404).json({ message: "Saved meal not found" });
      let savedIngredients;
      if (Array.isArray(ingredientsRaw)) {
        const ingredients = mealIngredientPayloadSchema.parse(ingredientsRaw) || [];
        savedIngredients = await storage.replaceSavedMealIngredients(id, ingredients);
      } else {
        savedIngredients = await storage.getSavedMealIngredients([id]);
      }
      res.json({ ...saved, ingredients: savedIngredients });
    } catch (error) {
      res.status(400).json({ message: "Invalid saved meal data" });
    }
  });

  app.delete("/api/saved-meals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteSavedMeal(req.params.id, userId);
      if (!success) return res.status(404).json({ message: "Saved meal not found" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete saved meal" });
    }
  });

  // ===== Celebrations (birthdays, anniversaries, etc.) =====
  // Date-math helpers (isValidMonthDay/resolveOccurrence/nextOccurrence/
  // celebrationsWithMeta) live in lib/celebrations.ts so the reminder
  // scheduler can compute the exact same next-occurrence/days-until values.

  app.get("/api/celebrations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const rows = await storage.getCelebrationsByUser(userId);
      // The family's timezone, not the server's — see celebrationsWithMeta.
      const tz = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
      const enriched = celebrationsWithMeta(rows, new Date(), tz)
        .sort((a, b) => a.daysUntil - b.daysUntil);
      // Attach gift ideas + photos in one shot
      const ids = rows.map(r => r.id);
      const [gifts, photos] = await Promise.all([
        storage.getGiftIdeasByCelebrationIds(ids),
        storage.getPhotosByCelebrationIds(ids),
      ]);
      const result = enriched.map(c => ({
        ...c,
        giftIdeas: gifts.filter(g => g.celebrationId === c.id)
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
        photos: photos.filter(p => p.celebrationId === c.id)
          .sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      }));
      res.json(result);
    } catch (error) {
      console.error("Celebrations fetch error:", error);
      res.status(500).json({ message: "Failed to fetch celebrations" });
    }
  });

  app.get("/api/celebrations/upcoming", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 3));
      const rows = await storage.getCelebrationsByUser(userId);
      const tz = (await storage.getLocationSettingsByUser(userId))?.timezone || DEFAULT_TIMEZONE;
      const enriched = celebrationsWithMeta(rows, new Date(), tz)
        .filter(c => c.daysUntil <= days)
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, limit);
      res.json(enriched);
    } catch (error) {
      console.error("Upcoming celebrations error:", error);
      res.status(500).json({ message: "Failed to fetch upcoming celebrations" });
    }
  });

  app.get("/api/celebrations/calendar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ message: "Please choose a start and end date." });
      const startDate = new Date(String(start));
      const endDate = new Date(String(end));
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "Invalid start/end date" });
      }
      if (endDate.getTime() < startDate.getTime()) {
        return res.status(400).json({ message: "end must be after start" });
      }
      // Cap range to ~24 months to avoid unbounded synthetic generation.
      const MAX_RANGE_MS = 1000 * 60 * 60 * 24 * 366 * 2;
      if (endDate.getTime() - startDate.getTime() > MAX_RANGE_MS) {
        return res.status(400).json({ message: "Date range too large (max 24 months)" });
      }
      const rows = await storage.getCelebrationsByUser(userId);
      type CelebrationSyntheticEvent = {
        id: string;
        celebrationId: string;
        title: string;
        type: string;
        customLabel: string | null;
        monthDay: string;
        year: number | null;
        ageThisYear: number | null;
        profileId: string | null;
        start: string;
        end: string;
        isAllDay: true;
      };
      const synthetic: CelebrationSyntheticEvent[] = [];
      for (const c of rows) {
        if (!isValidMonthDay(c.monthDay)) continue;
        for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) {
          const occ = resolveOccurrence(y, c.monthDay);
          if (!occ) continue;
          if (occ >= startDate && occ <= endDate) {
            const ageThisYear = c.year ? y - c.year : null;
            const displayAge = ageThisYear !== null && c.showYear !== false;
            const otherLabel = c.customLabel?.trim() || c.name;
            const ordinal = c.type === "anniversary" && displayAge
              ? `${ageThisYear}${ordinalSuffix(ageThisYear!)} Anniversary`
              : c.type === "birthday" && displayAge
                ? `${c.name}'s Birthday (turns ${ageThisYear})`
                : c.type === "birthday"
                  ? `${c.name}'s Birthday`
                  : c.customLabel?.trim()
                    ? `${c.name} — ${otherLabel}`
                    : c.name;
            const dayStart = new Date(occ);
            const dayEnd = new Date(occ);
            dayEnd.setHours(23, 59, 0, 0);
            synthetic.push({
              id: `celebration-${c.id}-${y}`,
              celebrationId: c.id,
              title: ordinal,
              type: c.type,
              customLabel: c.customLabel,
              monthDay: c.monthDay,
              year: c.year,
              ageThisYear,
              profileId: c.profileId,
              start: dayStart.toISOString(),
              end: dayEnd.toISOString(),
              isAllDay: true,
            });
          }
        }
      }
      res.json(synthetic);
    } catch (error) {
      console.error("Celebration calendar error:", error);
      res.status(500).json({ message: "Failed to fetch celebration calendar events" });
    }
  });

  // Every id in profileIds must belong to this user; also keeps the legacy
  // singular profileId column in sync (profileIds[0]) for any code still
  // reading it.
  async function validateAndSyncCelebrationProfiles(data: any, userId: string): Promise<string | null> {
    if (data.profileIds) {
      for (const id of data.profileIds) {
        const ok = await validateProfileOwnership(id, userId);
        if (!ok) return "One of the linked profiles does not belong to you";
      }
      data.profileId = data.profileIds[0] ?? null;
    } else if (data.profileId) {
      const ok = await validateProfileOwnership(data.profileId, userId);
      if (!ok) return "Profile does not belong to you";
    }
    return null;
  }

  app.post("/api/celebrations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const data = insertCelebrationSchema.parse({ ...req.body, userId });
      if (!isValidMonthDay(data.monthDay)) {
        return res.status(400).json({ message: "monthDay must be a valid calendar date (MM-DD)" });
      }
      const profileError = await validateAndSyncCelebrationProfiles(data, userId);
      if (profileError) return res.status(403).json({ message: profileError });
      const created = await storage.createCelebration(data);
      res.status(201).json(created);
    } catch (error) {
      console.error("Create celebration error:", error);
      res.status(400).json({ message: "Invalid celebration data" });
    }
  });

  app.patch("/api/celebrations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertCelebrationSchema.partial().omit({ userId: true }).parse(req.body);
      if (updates.monthDay && !isValidMonthDay(updates.monthDay)) {
        return res.status(400).json({ message: "monthDay must be a valid calendar date (MM-DD)" });
      }
      const profileError = await validateAndSyncCelebrationProfiles(updates, userId);
      if (profileError) return res.status(403).json({ message: profileError });
      const updated = await storage.updateCelebration(req.params.id, updates, userId);
      if (!updated) return res.status(404).json({ message: "Celebration not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update celebration error:", error);
      res.status(400).json({ message: "Invalid celebration data" });
    }
  });

  app.delete("/api/celebrations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // Capture photos BEFORE deletion so we can clean up object storage afterwards.
      const existing = await storage.getCelebration(req.params.id, userId);
      if (!existing) return res.status(404).json({ message: "Celebration not found" });
      const photos = await storage.getPhotosByCelebrationIds([req.params.id]);
      const ok = await storage.deleteCelebration(req.params.id, userId);
      if (!ok) return res.status(404).json({ message: "Celebration not found" });
      // Best-effort cleanup of underlying photo files (DB rows are cascade-deleted).
      const objectStorageService = new ObjectStorageService();
      await Promise.all(
        photos.map(p => objectStorageService.deleteObjectByPath(p.imageUrl).catch(() => false))
      );
      res.status(204).send();
    } catch (error) {
      console.error("Delete celebration error:", error);
      res.status(500).json({ message: "Failed to delete celebration" });
    }
  });

  // Gift ideas
  app.post("/api/celebrations/:id/gift-ideas", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const parent = await storage.getCelebration(req.params.id, userId);
      if (!parent) return res.status(404).json({ message: "Celebration not found" });
      const data = insertCelebrationGiftIdeaSchema.parse({ ...req.body, celebrationId: req.params.id });
      const created = await storage.createGiftIdea(data);
      res.status(201).json(created);
    } catch (error) {
      console.error("Create gift idea error:", error);
      res.status(400).json({ message: "Invalid gift idea data" });
    }
  });

  app.patch("/api/celebrations/gift-ideas/:ideaId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const updates = insertCelebrationGiftIdeaSchema.partial().omit({ celebrationId: true }).parse(req.body);
      const updated = await storage.updateGiftIdea(req.params.ideaId, updates, userId);
      if (!updated) return res.status(404).json({ message: "Gift idea not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update gift idea error:", error);
      res.status(400).json({ message: "Invalid gift idea data" });
    }
  });

  app.delete("/api/celebrations/gift-ideas/:ideaId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.deleteGiftIdea(req.params.ideaId, userId);
      if (!ok) return res.status(404).json({ message: "Gift idea not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Delete gift idea error:", error);
      res.status(500).json({ message: "Failed to delete gift idea" });
    }
  });

  // Photos
  app.post("/api/celebrations/:id/photos", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const parent = await storage.getCelebration(req.params.id, userId);
      if (!parent) return res.status(404).json({ message: "Celebration not found" });
      const { imageUrl, year, caption } = req.body || {};
      if (!imageUrl || typeof imageUrl !== "string") {
        return res.status(400).json({ message: "imageUrl is required" });
      }
      const objectStorageService = new ObjectStorageService();
      const normalizedPath = objectStorageService.normalizeObjectEntityPath(imageUrl);
      const data = insertCelebrationPhotoSchema.parse({
        celebrationId: req.params.id,
        imageUrl: normalizedPath,
        year: year ? Number(year) : null,
        caption: caption || null,
      });
      const created = await storage.createCelebrationPhoto(data);
      res.status(201).json(created);
    } catch (error) {
      console.error("Create celebration photo error:", error);
      res.status(400).json({ message: "Invalid photo data" });
    }
  });

  app.delete("/api/celebrations/photos/:photoId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      // Look up photo first so we know its storage path for cleanup.
      const photo = await storage.getCelebrationPhoto(req.params.photoId, userId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const ok = await storage.deleteCelebrationPhoto(req.params.photoId, userId);
      if (!ok) return res.status(404).json({ message: "Photo not found" });
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObjectByPath(photo.imageUrl).catch(() => false);
      res.status(204).send();
    } catch (error) {
      console.error("Delete celebration photo error:", error);
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  // ===== Wishlist for reward ideas =====
  app.get("/api/wishlist-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const submittedBy = typeof req.query.submittedBy === "string" ? req.query.submittedBy : undefined;
      const items = await storage.getWishlistItemsByUser(userId, {
        status,
        submittedByProfileId: submittedBy,
      });
      res.json(items);
    } catch (error) {
      console.error("Fetch wishlist error:", error);
      res.status(500).json({ message: "Failed to fetch wishlist items" });
    }
  });

  app.post("/api/wishlist-items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const body = { ...req.body, userId };
      // Normalize raw upload URL into a stable object path (matches celebrations photo flow).
      if (body.photoUrl && typeof body.photoUrl === "string") {
        const objectStorageService = new ObjectStorageService();
        body.photoUrl = objectStorageService.normalizeObjectEntityPath(body.photoUrl);
      }
      const data = insertWishlistItemSchema.parse(body);
      // Validate the submitter profile (if provided) belongs to the user.
      if (data.submittedByProfileId) {
        const profile = await storage.getProfile(data.submittedByProfileId);
        if (!profile || profile.userId !== userId) {
          return res.status(400).json({ message: "Invalid submitter profile" });
        }
      }
      const item = await storage.createWishlistItem({ ...data, status: "pending" });
      res.status(201).json(item);
    } catch (error) {
      console.error("Create wishlist item error:", error);
      res.status(400).json({ message: "Invalid wishlist item data" });
    }
  });

  app.patch("/api/wishlist-items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const body = { ...req.body };
      if (body.photoUrl && typeof body.photoUrl === "string") {
        const objectStorageService = new ObjectStorageService();
        body.photoUrl = objectStorageService.normalizeObjectEntityPath(body.photoUrl);
      }
      // PATCH is for editing submission metadata only. Lifecycle transitions go
      // through the dedicated /approve, /decline, and /archive routes so that
      // their authorization checks and idempotency guards can't be bypassed.
      const patchSchema = insertWishlistItemSchema
        .partial()
        .omit({
          userId: true,
          status: true,
          finalPriceCoins: true,
          inventoryCap: true,
          parentNote: true,
        });
      const updates = patchSchema.parse(body);
      // Validate the submitter profile (if reassigned) belongs to the user.
      if (updates.submittedByProfileId) {
        const profile = await storage.getProfile(updates.submittedByProfileId);
        if (!profile || profile.userId !== userId) {
          return res.status(400).json({ message: "Invalid submitter profile" });
        }
      }
      const existing = updates.photoUrl !== undefined ? await storage.getWishlistItem(req.params.id, userId) : undefined;
      const updated = await storage.updateWishlistItem(req.params.id, updates, userId);
      if (!updated) return res.status(404).json({ message: "Wishlist item not found" });
      if (updates.photoUrl !== undefined) cleanupReplacedPhoto(existing?.photoUrl, updates.photoUrl);
      res.json(updated);
    } catch (error) {
      console.error("Update wishlist item error:", error);
      res.status(400).json({ message: "Invalid wishlist item data" });
    }
  });

  app.post("/api/wishlist-items/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const approvalSchema = z.object({
        finalPriceCoins: z.number().int().min(1).max(100000),
        icon: z.string().min(1).max(8).optional(),
        scopeProfileId: z.string().nullable().optional(),
        inventoryCap: z.number().int().min(1).max(10000).nullable().optional(),
      });
      const body = approvalSchema.parse(req.body);
      // Validate scopeProfileId ownership before doing any writes.
      if (body.scopeProfileId) {
        const profile = await storage.getProfile(body.scopeProfileId);
        if (!profile || profile.userId !== userId) {
          return res.status(400).json({ message: "Invalid scope profile" });
        }
      }
      // Atomically claim the wishlist item — this fails if it's not pending,
      // making the approve flow idempotent under concurrent requests.
      const claimed = await storage.claimWishlistItemForApproval(req.params.id, userId);
      if (!claimed) {
        // Either the row doesn't exist or someone already approved/declined/archived it.
        const existing = await storage.getWishlistItem(req.params.id, userId);
        if (!existing) return res.status(404).json({ message: "Wishlist item not found" });
        return res.status(409).json({ message: `Cannot approve — already ${existing.status}` });
      }
      // Now safe to spawn the reward row exactly once for this wishlist item.
      const reward = await storage.createReward({
        userId,
        title: claimed.title,
        description: claimed.description ?? null,
        pointsCost: body.finalPriceCoins,
        icon: body.icon ?? "🎁",
        scopeProfileId: body.scopeProfileId ?? null,
        isActive: true,
      });
      const updated = await storage.updateWishlistItem(req.params.id, {
        finalPriceCoins: body.finalPriceCoins,
        inventoryCap: body.inventoryCap ?? null,
        approvedRewardId: reward.id,
        parentNote: null,
      }, userId);
      // Notify the kid who submitted the idea (best-effort, non-blocking).
      if (claimed.submittedByProfileId) {
        sendPushToUser(
          { userId, profileId: claimed.submittedByProfileId },
          {
            title: "Your reward suggestion was approved!",
            body: `"${claimed.title}" is now in the rewards gallery for ${body.finalPriceCoins} ⭐`,
            url: "/?openTab=chores&openSubTab=rewards",
            tag: `wishlist-${claimed.id}`,
            data: { kind: "wishlist-approved", wishlistId: claimed.id, rewardId: reward.id },
          },
        ).catch((err) => req.log?.warn?.({ err }, "wishlist approve push failed"));
      }
      return res.json({ wishlistItem: updated, reward });
    } catch (error) {
      console.error("Approve wishlist item error:", error);
      return res.status(400).json({ message: "Invalid approval data" });
    }
  });

  app.post("/api/wishlist-items/:id/decline", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const declineSchema = z.object({
        parentNote: z.string().max(1000).optional(),
      });
      const body = declineSchema.parse(req.body);
      const item = await storage.getWishlistItem(req.params.id, userId);
      if (!item) return res.status(404).json({ message: "Wishlist item not found" });
      const updated = await storage.updateWishlistItem(req.params.id, {
        status: "declined",
        parentNote: body.parentNote ?? null,
        decidedAt: new Date(),
      }, userId);
      // Notify submitter that their idea got a parent response.
      if (item.submittedByProfileId) {
        sendPushToUser(
          { userId, profileId: item.submittedByProfileId },
          {
            title: "Reward suggestion reviewed",
            body: body.parentNote
              ? `"${item.title}": ${body.parentNote}`
              : `Your suggestion "${item.title}" wasn't approved this time.`,
            url: "/",
            tag: `wishlist-${item.id}`,
            data: { kind: "wishlist-declined", wishlistId: item.id },
          },
        ).catch((err) => req.log?.warn?.({ err }, "wishlist decline push failed"));
      }
      return res.json(updated);
    } catch (error) {
      console.error("Decline wishlist item error:", error);
      return res.status(400).json({ message: "Invalid decline data" });
    }
  });

  app.post("/api/wishlist-items/:id/archive", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const item = await storage.getWishlistItem(req.params.id, userId);
      if (!item) return res.status(404).json({ message: "Wishlist item not found" });
      const updated = await storage.updateWishlistItem(req.params.id, {
        status: "archived",
        decidedAt: item.decidedAt ?? new Date(),
      }, userId);
      return res.json(updated);
    } catch (error) {
      console.error("Archive wishlist item error:", error);
      return res.status(500).json({ message: "Failed to archive wishlist item" });
    }
  });

  app.delete("/api/wishlist-items/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const existing = await storage.getWishlistItem(req.params.id, userId);
      const ok = await storage.deleteWishlistItem(req.params.id, userId);
      if (!ok) return res.status(404).json({ message: "Wishlist item not found" });
      cleanupReplacedPhoto(existing?.photoUrl, null);
      return res.status(204).send();
    } catch (error) {
      console.error("Delete wishlist item error:", error);
      return res.status(500).json({ message: "Failed to delete wishlist item" });
    }
  });

  // ── Activity log (history feed) ──────────────────────────────────────────────
  // Returns up to 30 days of activity for the authenticated user, synthesised
  // from five sources: chore completions, reward redemptions, shoutouts, point
  // adjustments, and the activity_log table (chore uncompletes).
  app.get("/api/activity-log", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Build a profile lookup map so we can resolve names/colors without N+1 queries
      const userProfiles = await storage.getProfilesByUser(userId);
      const profileMap = new Map(userProfiles.map(p => [p.id, p]));

      const pInfo = (profileId: string) => {
        const p = profileMap.get(profileId);
        return {
          profileId,
          profileName: p?.name ?? 'Unknown',
          profileColor: p?.color ?? '#888',
          profileInitials: p?.initials ?? '?',
          profilePhotoUrl: p?.photoUrl ?? null,
        };
      };

      // Meals have no profileId of their own (they're planned for the whole
      // family, not assigned to one person) — attributed to the "All Family"
      // pseudo-profile, the same one used elsewhere for family-wide items.
      const allFamilyProfile = userProfiles.find(p => p.isAllFamilyProfile);

      // Query all sources in parallel
      const [completions, redemptions, shouts, adjustments, uncompletes, incidents, plannedMeals, cashouts, postedNotes] = await Promise.all([
        db
          .select({
            id: choreCompletionsTbl.id,
            choreId: choreCompletionsTbl.choreId,
            profileId: choreCompletionsTbl.profileId,
            points: choreCompletionsTbl.points,
            completedAt: choreCompletionsTbl.completedAt,
            choreTitle: choresTbl.title,
            isBonus: choresTbl.isBonus,
            targetCount: choresTbl.targetCount,
            taskType: choresTbl.taskType,
          })
          .from(choreCompletionsTbl)
          .innerJoin(choresTbl, eq(choreCompletionsTbl.choreId, choresTbl.id))
          .where(and(eq(choresTbl.userId, userId), gte(choreCompletionsTbl.completedAt, since))),

        db
          .select({
            id: rewardRedemptionsTbl.id,
            profileId: rewardRedemptionsTbl.profileId,
            status: rewardRedemptionsTbl.status,
            redeemedAt: rewardRedemptionsTbl.redeemedAt,
            unlockedAt: rewardRedemptionsTbl.unlockedAt,
            createdAt: rewardRedemptionsTbl.createdAt,
            rewardTitle: rewardsTbl.title,
            pointsCost: rewardsTbl.pointsCost,
          })
          .from(rewardRedemptionsTbl)
          .innerJoin(rewardsTbl, eq(rewardRedemptionsTbl.rewardId, rewardsTbl.id))
          .where(and(eq(rewardsTbl.userId, userId), gte(rewardRedemptionsTbl.createdAt, since))),

        db
          .select()
          .from(shoutoutsTbl)
          .where(and(eq(shoutoutsTbl.userId, userId), gte(shoutoutsTbl.createdAt, since))),

        db
          .select()
          .from(pointAdjustmentsTbl)
          .where(and(eq(pointAdjustmentsTbl.userId, userId), gte(pointAdjustmentsTbl.createdAt, since))),

        db
          .select()
          .from(activityLogTbl)
          .where(and(eq(activityLogTbl.userId, userId), gte(activityLogTbl.createdAt, since))),

        storage.getBehaviourIncidents(userId),

        allFamilyProfile
          ? db
              .select()
              .from(mealsTbl)
              .where(and(eq(mealsTbl.userId, userId), gte(mealsTbl.createdAt, since)))
          : Promise.resolve([]),

        // A cash-out request and its later approval/decline are the SAME row
        // (updated in place, not a new row per stage — see approveCashout/
        // declineCashout in storage.ts), so a row must be included here if
        // EITHER its request (createdAt) or its decision (decidedAt) falls
        // in the window; each timestamp becomes its own entry below.
        db
          .select()
          .from(walletTransactionsTbl)
          .where(and(
            eq(walletTransactionsTbl.userId, userId),
            or(gte(walletTransactionsTbl.createdAt, since), gte(walletTransactionsTbl.decidedAt, since)),
          )),

        // Notes posted to the family, with who each went to. Two queries so
        // the recipients can be named without a join fanning out one row per
        // recipient (a note posted to four people is still one thing that
        // happened).
        (async () => {
          const notes = await db
            .select()
            .from(dailyContentTbl)
            .where(and(
              eq(dailyContentTbl.userId, userId),
              eq(dailyContentTbl.type, 'note'),
              gte(dailyContentTbl.createdAt, since),
            ));
          if (notes.length === 0) return { notes, assignments: [] as { contentId: string; profileId: string }[] };
          const assignments = await db
            .select({ contentId: dailyContentAssignmentsTbl.contentId, profileId: dailyContentAssignmentsTbl.profileId })
            .from(dailyContentAssignmentsTbl)
            .where(inArray(dailyContentAssignmentsTbl.contentId, notes.map(n => n.id)));
          return { notes, assignments };
        })(),
      ]);

      const entries: Array<{
        id: string;
        activityType: string;
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
        timestamp: Date | null;
      }> = [];

      for (const c of completions) {
        const isTargetChore = !!(c.targetCount && c.targetCount > 0);
        entries.push({
          id: `cc-${c.id}`,
          activityType: 'chore_complete',
          ...pInfo(c.profileId),
          toProfileId: null,
          toProfileName: null,
          toProfileColor: null,
          description: `Completed "${c.choreTitle}" (+${c.points} stars)`,
          entityTitle: c.choreTitle,
          // choreId/isBonus/isTargetChore let the client offer an "Undo" on
          // this specific completion — regular (daily-recurring) chores are
          // deliberately left without one here since "undoing" an old daily
          // chore reads as changing the past rather than correcting a
          // mis-tap, unlike a bonus/target chore which has no day concept.
          metadata: { points: c.points, choreId: c.choreId, isBonus: !!c.isBonus, isTargetChore, taskType: c.taskType },
          timestamp: c.completedAt,
        });
      }

      for (const r of redemptions) {
        const ts = r.redeemedAt ?? r.unlockedAt ?? r.createdAt;
        const actionWord = r.status === 'redeemed' ? 'Redeemed' : 'Unlocked';
        entries.push({
          id: `rr-${r.id}`,
          activityType: 'reward_redeem',
          ...pInfo(r.profileId),
          toProfileId: null,
          toProfileName: null,
          toProfileColor: null,
          description: `${actionWord} "${r.rewardTitle}" (${r.pointsCost} stars)`,
          entityTitle: r.rewardTitle,
          metadata: { pointsCost: r.pointsCost, status: r.status },
          timestamp: ts,
        });
      }

      for (const s of shouts) {
        const toProfile = profileMap.get(s.toProfileId);
        entries.push({
          id: `sh-${s.id}`,
          activityType: 'shoutout',
          ...pInfo(s.fromProfileId),
          toProfileId: s.toProfileId,
          toProfileName: toProfile?.name ?? 'Unknown',
          toProfileColor: toProfile?.color ?? '#888',
          description: `${s.emoji} Sent a shoutout to ${toProfile?.name ?? 'someone'}: "${s.message}"`,
          entityTitle: null,
          metadata: { emoji: s.emoji, message: s.message },
          timestamp: s.createdAt,
        });
      }

      for (const a of adjustments) {
        const sign = a.delta > 0 ? '+' : '';
        entries.push({
          id: `pa-${a.id}`,
          activityType: 'point_adjustment',
          ...pInfo(a.profileId),
          toProfileId: null,
          toProfileName: null,
          toProfileColor: null,
          description: a.reason
            ? `${sign}${a.delta} stars — ${a.reason}`
            : `${sign}${a.delta} star adjustment`,
          entityTitle: null,
          metadata: { delta: a.delta, reason: a.reason },
          timestamp: a.createdAt,
        });
      }

      for (const tx of cashouts) {
        const stars = tx.requestedPoints ?? 0;
        const amount = `$${((tx.requestedCents ?? 0) / 100).toFixed(2)}`;
        const starsWord = `${stars} star${stars === 1 ? '' : 's'}`;
        // The older "immediate cash-out" path (no separate approval step)
        // creates the row already-approved, with decidedAt essentially equal
        // to createdAt — showing both a "requested" and an "approved" entry
        // for that would just be a near-duplicate of the same real moment.
        const decidedSeparately = !tx.decidedAt ||
          Math.abs(new Date(tx.decidedAt).getTime() - new Date(tx.createdAt).getTime()) > 2000;
        if (decidedSeparately) {
          entries.push({
            id: `wt-req-${tx.id}`,
            activityType: 'cashout_requested',
            ...pInfo(tx.profileId),
            toProfileId: null,
            toProfileName: null,
            toProfileColor: null,
            description: `Requested a cash-out: ${starsWord} → ${amount}`,
            entityTitle: null,
            metadata: { points: stars, cents: tx.requestedCents },
            timestamp: tx.createdAt,
          });
        }
        if (tx.decidedAt && (tx.type === 'cashout_approved' || tx.type === 'cashout_declined')) {
          entries.push({
            id: `wt-dec-${tx.id}`,
            activityType: tx.type === 'cashout_approved' ? 'cashout_approved' : 'cashout_declined',
            ...pInfo(tx.profileId),
            toProfileId: null,
            toProfileName: null,
            toProfileColor: null,
            description: tx.type === 'cashout_approved'
              ? `Cash-out approved: ${starsWord} → ${amount}`
              : `Cash-out declined: ${starsWord} → ${amount}`,
            entityTitle: null,
            metadata: { points: stars, cents: tx.requestedCents },
            timestamp: tx.decidedAt,
          });
        }
      }

      for (const u of uncompletes) {
        entries.push({
          id: `al-${u.id}`,
          activityType: u.activityType,
          ...pInfo(u.profileId),
          toProfileId: null,
          toProfileName: null,
          toProfileColor: null,
          description: u.entityTitle ? `Unchecked "${u.entityTitle}"` : 'Unchecked a chore',
          entityTitle: u.entityTitle ?? null,
          metadata: (u.metadata as Record<string, unknown> | null) ?? null,
          timestamp: u.createdAt,
        });
      }

      for (const inc of incidents) {
        if (inc.status === 'positive_pending') continue;
        const ts = inc.resolvedAt ?? null;
        if (!ts || new Date(ts) < since) continue;
        const positive = inc.status === 'resolved_positive';
        entries.push({
          id: `bi-${inc.id}`,
          activityType: 'behaviour_incident',
          ...pInfo(inc.profileId),
          toProfileId: null,
          toProfileName: null,
          toProfileColor: null,
          description: positive
            ? `Did the good deed for "${inc.ruleText}"`
            : `Consequence applied for "${inc.ruleText}"`,
          entityTitle: inc.ruleText,
          metadata: { status: inc.status, positive, negativeConsequence: inc.negativeConsequence, positiveConsequence: inc.positiveConsequence },
          timestamp: new Date(ts),
        });
      }

      if (allFamilyProfile) {
        for (const m of plannedMeals) {
          entries.push({
            id: `ml-${m.id}`,
            activityType: 'meal_planned',
            ...pInfo(allFamilyProfile.id),
            toProfileId: null,
            toProfileName: null,
            toProfileColor: null,
            description: `Planned "${m.name}" for ${m.slot} on ${m.date}`,
            entityTitle: m.name,
            metadata: { date: m.date, slot: m.slot },
            timestamp: m.createdAt,
          });
        }
      }

      // Notes posted to the family. Announcements shows them; Family
      // Activity didn't, so a note vanished for good once it was ticked off.
      // One entry per note (not per recipient) — several assignment rows are
      // one act of posting, and the recipients are named in the description.
      {
        const byNote = new Map<string, string[]>();
        for (const a of postedNotes.assignments) {
          const list = byNote.get(a.contentId) ?? [];
          list.push(a.profileId);
          byNote.set(a.contentId, list);
        }
        for (const n of postedNotes.notes) {
          const recipients = (byNote.get(n.id) ?? [])
            .map((id) => profileMap.get(id)?.name)
            .filter(Boolean) as string[];
          // `reference` on a note holds the author's profileId.
          const author = n.reference ? profileMap.get(n.reference) : undefined;
          entries.push({
            id: `nt-${n.id}`,
            activityType: 'note_posted',
            ...pInfo(author?.id ?? allFamilyProfile?.id ?? ''),
            toProfileId: null,
            toProfileName: recipients.join(", ") || null,
            toProfileColor: null,
            // The note's own text is the point of the entry, so it goes in
            // the description (which the feed always renders) rather than
            // entityTitle. Trimmed — a note can run to several sentences.
            description: (() => {
              const text = (n.content ?? "").trim();
              const short = text.length > 70 ? `${text.slice(0, 70)}…` : text;
              const who = recipients.length ? ` for ${recipients.join(", ")}` : "";
              return short ? `Posted a note${who}: "${short}"` : `Posted a note${who}`;
            })(),
            entityTitle: n.content,
            metadata: { contentId: n.id },
            timestamp: n.createdAt,
          });
        }
      }

      entries.sort((a, b) => {
        const ta = a.timestamp?.getTime() ?? 0;
        const tb = b.timestamp?.getTime() ?? 0;
        return tb - ta;
      });

      return res.json(entries);
    } catch (error) {
      req.log.error({ error }, "Failed to fetch activity log");
      return res.status(500).json({ message: "Failed to fetch activity log" });
    }
  });

  app.get("/api/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({ text: feedbackNotes.text, createdAt: feedbackNotes.createdAt })
        .from(feedbackNotes)
        .where(eq(feedbackNotes.userId, getUserId(req)))
        .orderBy(desc(feedbackNotes.createdAt))
        .limit(50);
      res.json(rows.flatMap((row) => row.createdAt ? [{ text: row.text, at: row.createdAt.toISOString() }] : []));
    } catch (error) {
      req.log?.error({ error }, "Failed to read feedback");
      res.status(503).json({ message: "Feedback is not available yet." });
    }
  });

  app.post("/api/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2000) : "";
      if (!text) return res.status(400).json({ message: "Feedback needs text." });
      const [row] = await db.insert(feedbackNotes).values({ userId: getUserId(req), text }).returning();
      res.status(201).json({ text: row.text, at: row.createdAt?.toISOString() ?? new Date().toISOString() });
    } catch (error) {
      req.log?.error({ error }, "Failed to save feedback");
      res.status(503).json({ message: "Feedback is not available yet." });
    }
  });

  // ── Account reset ────────────────────────────────────────────────────────────
  app.delete("/api/account/reset", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.resetUserData(userId);
      return res.json({ ok: true });
    } catch (error) {
      req.log.error({ error }, "Account reset failed");
      return res.status(500).json({ message: "Failed to reset account data" });
    }
  });

  app.post("/api/account/reset-categories", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const categories = req.body?.categories;
      if (!Array.isArray(categories) || categories.length === 0 ||
          !categories.every((c) => RESET_CATEGORIES.includes(c))) {
        return res.status(400).json({ message: "Invalid categories" });
      }
      await storage.resetUserDataCategories(userId, categories as ResetCategory[]);
      return res.json({ ok: true });
    } catch (error) {
      req.log.error({ error }, "Category reset failed");
      return res.status(500).json({ message: "Failed to reset selected data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
