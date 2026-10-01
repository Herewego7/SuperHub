import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { entitlements, families, type Entitlement } from "@workspace/db";
import { logger } from "./logger";
import { getFamilyMemberAccountIds, resolveFamilyForAccount } from "../familyService";
import {
  decideFamilyEntitlement,
  graceDeadlineFrom,
  departureStartsGrace,
  type FamilyEntitlementDecision,
  type MemberEntitlementFacts,
} from "./familyEntitlement";

// ── Master kill switch (2026-08 launch plan) ───────────────────────────────
// Every route/screen in this feature checks isEntitled() unconditionally —
// but as long as this env var is unset/false, isEntitled() always returns
// true for everyone, regardless of any other state. This is the single
// biggest safety net for shipping this feature: the entire system (routes,
// gating, purchase flow, comp system) can be deployed and exercised in
// production with ZERO risk of anyone actually being blocked, until this is
// deliberately flipped on once the data (existing users really are comped,
// new signups get correct trial dates) has been spot-checked for real.
export function isEnforcementEnabled(): boolean {
  return process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED === "true";
}

const TRIAL_DAYS = 14;

// Apple's own subscription states (the string names of its numeric `Status`
// enum — ACTIVE=1 / EXPIRED=2 / BILLING_RETRY=3 / BILLING_GRACE_PERIOD=4 /
// REVOKED=5, see @apple/app-store-server-library's Status model) that mean
// "currently paying, keep access." BILLING_GRACE_PERIOD is trusted directly
// rather than re-derived from appleExpiresAt — Apple's own billing-retry
// logic already accounts for it correctly (typically ~16 days), so
// re-implementing that math ourselves would just be a second, possibly-wrong
// copy of a computation Apple's system already does for us.
const ACTIVE_APPLE_STATES = new Set(["ACTIVE", "BILLING_GRACE_PERIOD"]);

export interface EntitlementDecision {
  entitled: boolean;
  reason: "enforcement_disabled" | "comped" | "trialing" | "apple_active" | "expired" | "no_record";
  trialEndsAt: Date | null;
  isComped: boolean;
}

/**
 * The single choke point every gated route/screen must call. Deliberately
 * fails OPEN (entitled: true) whenever the state is anything other than a
 * clearly-confirmed "expired and not comped" — a missing row, enforcement
 * disabled, or an ambiguous state should never accidentally lock someone
 * out of an app they were already using. Only a definitively expired,
 * non-comped, non-trialing account is ever actually gated.
 */
export async function getEntitlementDecision(userId: string): Promise<EntitlementDecision> {
  if (!isEnforcementEnabled()) {
    return { entitled: true, reason: "enforcement_disabled", trialEndsAt: null, isComped: false };
  }

  const row = await getOrCreateEntitlementRow(userId);

  if (row.isComped) {
    return { entitled: true, reason: "comped", trialEndsAt: row.trialEndsAt, isComped: true };
  }

  if (row.trialEndsAt && row.trialEndsAt.getTime() > Date.now()) {
    return { entitled: true, reason: "trialing", trialEndsAt: row.trialEndsAt, isComped: false };
  }

  if (row.appleSubscriptionState && ACTIVE_APPLE_STATES.has(row.appleSubscriptionState)) {
    return { entitled: true, reason: "apple_active", trialEndsAt: row.trialEndsAt, isComped: false };
  }

  return { entitled: false, reason: "expired", trialEndsAt: row.trialEndsAt, isComped: false };
}

export async function isEntitled(userId: string): Promise<boolean> {
  const decision = await getEntitlementDecision(userId);
  return decision.entitled;
}

/**
 * Every entitlement row is looked up lazily, not written eagerly at signup —
 * this means an account created before this table existed (or any account
 * for which the row-creation step at signup somehow didn't run) still gets a
 * row the first time it's checked, defaulting to the DB's own isComped:true
 * default. This is a second, independent safety net on top of the
 * migration's own default — even if a signup path is ever missed, nobody
 * falls through to "no row = ambiguous", they just get comped.
 */
async function getOrCreateEntitlementRow(userId: string): Promise<Entitlement> {
  const [existing] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(entitlements)
      .values({ userId })
      .onConflictDoNothing({ target: entitlements.userId })
      .returning();
    if (created) return created;
    // A concurrent request created it between our SELECT and INSERT — read it back.
    const [row] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
    if (row) return row;
  } catch (err) {
    logger.error({ err, userId }, "Failed to create entitlement row — failing open");
  }

  // Should be unreachable in practice, but if row creation itself somehow
  // fails, return a synthetic comped-true row rather than throwing — a
  // database hiccup here must never be the thing that locks someone out.
  return {
    id: "synthetic",
    userId,
    isComped: true,
    compedReason: "fallback: row creation failed",
    compedBy: null,
    trialStartedAt: null,
    trialEndsAt: null,
    appleOriginalTransactionId: null,
    appleProductId: null,
    appleSubscriptionState: null,
    appleExpiresAt: null,
    appleAutoRenewStatus: null,
    trial7dReminderSentAt: null,
    trial2dReminderSentAt: null,
    trial1dReminderSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Called from every genuinely-new-account creation path (email signup,
 * first-time Apple sign-in) — mirrors exactly how those same routes already
 * explicitly override onboardingCompletedAt to null for a real new account.
 * Deliberately NOT called on login/session-resume, so the trial clock is
 * stamped exactly once, ever, per account.
 */
export async function startTrialForNewAccount(userId: string): Promise<void> {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .insert(entitlements)
    .values({ userId, isComped: false, trialStartedAt: now, trialEndsAt })
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: { isComped: false, trialStartedAt: now, trialEndsAt, updatedAt: new Date() },
    });
}

export async function setComped(userId: string, comped: boolean, reason?: string, compedBy?: string): Promise<void> {
  await db
    .insert(entitlements)
    .values({ userId, isComped: comped, compedReason: reason ?? null, compedBy: compedBy ?? null })
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: { isComped: comped, compedReason: reason ?? null, compedBy: compedBy ?? null, updatedAt: new Date() },
    });
}

export const TRIAL_REMINDER_KINDS = ["7d", "2d", "1d"] as const;
export type TrialReminderKind = (typeof TRIAL_REMINDER_KINDS)[number];

/**
 * Pure decision: given a trial's end date, "now", and which reminders have
 * already been sent, which reminder (if any) should fire this tick? Kept as
 * a standalone pure function (same reasoning as isChoreDueOn/
 * decideProfileIdCleanup) so the exact boundary math is unit-testable
 * without a scheduler or a database. Each kind fires at most once, ever —
 * checked via its own persisted timestamp (never re-derived from whether
 * "now" happens to still be in that window), so a scheduler tick that's
 * slightly late (e.g. the process was down for an hour) doesn't skip a
 * reminder whose exact instant it missed.
 */
export function decideTrialReminder(
  trialEndsAt: Date,
  now: Date,
  sent: { d7: boolean; d2: boolean; d1: boolean },
): TrialReminderKind | null {
  const msLeft = trialEndsAt.getTime() - now.getTime();
  const daysLeft = msLeft / (24 * 60 * 60 * 1000);
  if (daysLeft < 0) return null; // trial already over — the expiry itself isn't one of these 3 reminders
  if (!sent.d1 && daysLeft <= 1) return "1d";
  if (!sent.d2 && daysLeft <= 2) return "2d";
  if (!sent.d7 && daysLeft <= 7) return "7d";
  return null;
}

/**
 * Looks up which account an Apple transaction chain belongs to, by its
 * previously-recorded originalTransactionId — used by the Server
 * Notifications webhook for events where Apple's payload doesn't (or
 * hasn't yet) carried our own appAccountToken, since the very first
 * /api/subscription/verify call already stored this id against the right
 * account.
 */
export async function findUserIdByOriginalTransactionId(originalTransactionId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: entitlements.userId })
    .from(entitlements)
    .where(eq(entitlements.appleOriginalTransactionId, originalTransactionId))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Detach an Apple subscription from every account except `keepUserId`.
 *
 * A subscription belongs to an Apple ID, not to an account in this app, and the
 * two genuinely move apart: someone buys from the App Store page before they
 * have an account, a family re-signs-up, a phone gets handed down. The chosen
 * policy (2026-09-10) is the generous one — whoever most recently proved they
 * own the transaction gets it, and it may float between accounts.
 *
 * "Float" has to mean MOVE, not COPY. Without this, /verify would write the
 * same appleOriginalTransactionId onto a second row and leave the first one
 * saying "active": the old account would keep paid access forever off someone
 * else's card, and findUserIdByOriginalTransactionId (LIMIT 1) would start
 * routing that subscription's webhooks to whichever row the database happened
 * to return first. Releasing the others keeps exactly one owner, so webhook
 * routing stays deterministic.
 */
export async function releaseAppleSubscriptionFromOtherUsers(
  originalTransactionId: string,
  keepUserId: string,
): Promise<number> {
  const released = await db
    .update(entitlements)
    .set({
      appleOriginalTransactionId: null,
      appleProductId: null,
      appleSubscriptionState: null,
      appleExpiresAt: null,
      appleAutoRenewStatus: null,
    })
    .where(
      and(
        eq(entitlements.appleOriginalTransactionId, originalTransactionId),
        ne(entitlements.userId, keepUserId),
      ),
    )
    .returning({ userId: entitlements.userId });
  return released.length;
}

export async function applyAppleSubscriptionUpdate(
  userId: string,
  data: {
    appleOriginalTransactionId: string;
    appleProductId: string;
    appleSubscriptionState: string;
    appleExpiresAt: Date | null;
    appleAutoRenewStatus: boolean | null;
  },
): Promise<void> {
  await db
    .insert(entitlements)
    .values({ userId, ...data })
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: { ...data, updatedAt: new Date() },
    });
}


// ── Household entitlement ───────────────────────────────────────────────────
// The account-level functions above stay as they are: they answer "what is
// THIS login's own state", which Settings still needs in order to show the
// right buttons. Everything that GATES a feature should use the household
// answer below instead — the product is one family hub, and a spouse should
// never hit a paywall on a subscription their household is already paying.

export type { FamilyEntitlementDecision };

/**
 * The household decision for whoever is signed in.
 *
 * Fails OPEN on any error, exactly like getEntitlementDecision — an
 * unreachable database must never be the thing that locks a family out of an
 * app they are paying for.
 */
export async function getFamilyEntitlementDecision(
  authUserId: string,
): Promise<FamilyEntitlementDecision> {
  if (!isEnforcementEnabled()) {
    return {
      entitled: true,
      reason: "enforcement_disabled",
      grantedBy: null,
      trialEndsAt: null,
      graceEndsAt: null,
      isComped: false,
    };
  }

  try {
    const resolved = await resolveFamilyForAccount(authUserId);
    const memberIds = await getFamilyMemberAccountIds(resolved.ownerUserId);

    // Every member needs a row, and rows are created lazily — so ask for each
    // one through getOrCreateEntitlementRow rather than a single IN query that
    // would silently omit members who have never been checked before.
    const rows = await Promise.all(memberIds.map((id) => getOrCreateEntitlementRow(id)));

    const [family] = await db.select().from(families).where(eq(families.id, resolved.familyId)).limit(1);

    const members: MemberEntitlementFacts[] = rows.map((row) => ({
      userId: row.userId,
      isOwner: row.userId === resolved.ownerUserId,
      isComped: row.isComped,
      trialEndsAt: row.trialEndsAt,
      appleSubscriptionState: row.appleSubscriptionState,
    }));

    return decideFamilyEntitlement({
      members,
      graceUntil: family?.entitlementGraceUntil ?? null,
      now: new Date(),
    });
  } catch (err) {
    logger.error({ err, authUserId }, "Family entitlement lookup failed — failing open");
    return {
      entitled: true,
      reason: "no_record",
      grantedBy: null,
      trialEndsAt: null,
      graceEndsAt: null,
      isComped: false,
    };
  }
}

export async function isFamilyEntitled(authUserId: string): Promise<boolean> {
  return (await getFamilyEntitlementDecision(authUserId)).entitled;
}

/**
 * Start the household's grace period because the member covering it is
 * leaving. Called BEFORE the membership row is deleted, while the departing
 * account can still be resolved to the family.
 *
 * Best-effort: a failure here means the family loses access at once rather
 * than in seven days, which is worth logging but never worth failing the
 * departure over — someone trying to leave a family must always be able to.
 */
export async function startGraceIfCoveringMemberLeaves(
  departingUserId: string,
  familyId: string,
): Promise<void> {
  try {
    const row = await getOrCreateEntitlementRow(departingUserId);
    const starts = departureStartsGrace({
      userId: departingUserId,
      isOwner: false,
      isComped: row.isComped,
      trialEndsAt: row.trialEndsAt,
      appleSubscriptionState: row.appleSubscriptionState,
    });
    if (!starts) return;
    await db
      .update(families)
      .set({ entitlementGraceUntil: graceDeadlineFrom(new Date()), updatedAt: new Date() })
      .where(eq(families.id, familyId));
    logger.info({ departingUserId, familyId }, "Household entitlement grace period started");
  } catch (err) {
    logger.error({ err, departingUserId, familyId }, "Failed to start entitlement grace period");
  }
}
