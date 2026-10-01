/**
 * Whether a HOUSEHOLD is entitled, as opposed to a login account.
 *
 * The product is sold as one family hub, but `entitlements` rows belong to
 * individual accounts. Without this, a spouse who joins by invite gets their
 * own trial and their own paywall on a family the owner is already paying for
 * — a refund conversation on day one.
 *
 * The decision itself is a pure function so the rules can be tested without a
 * database; `familyEntitlementFacts` in subscriptionEntitlement.ts does the
 * fetching. Keep it that way: every rule below has a case that only shows up
 * with two or more members, which is exactly what production has none of.
 */

/** One member's entitlement state, flattened to what the decision needs. */
export interface MemberEntitlementFacts {
  userId: string;
  /** The family owner — the account every member's data resolves to. */
  isOwner: boolean;
  isComped: boolean;
  trialEndsAt: Date | null;
  /** Apple's own status string, as received. Null when never subscribed. */
  appleSubscriptionState: string | null;
}

export interface FamilyEntitlementInput {
  members: MemberEntitlementFacts[];
  /** families.entitlementGraceUntil — set when the covering member left. */
  graceUntil: Date | null;
  now: Date;
}

export type FamilyEntitlementReason =
  | "enforcement_disabled"
  | "apple_active"
  | "comped"
  | "trialing"
  | "grace"
  | "expired"
  | "no_record";

export interface FamilyEntitlementDecision {
  entitled: boolean;
  reason: FamilyEntitlementReason;
  /**
   * Which member's state granted this, when it wasn't the viewer's own. Lets
   * Settings say "covered by your family's subscription" instead of showing
   * someone a trial countdown they aren't on — and makes it visible WHICH
   * account is covering a household, which is the early warning if comped
   * accounts ever stop being a small fixed pool.
   */
  grantedBy: string | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  isComped: boolean;
}

/** Apple states that mean "currently paying, keep access". Mirrors
 *  ACTIVE_APPLE_STATES in subscriptionEntitlement.ts deliberately — the two
 *  must agree, and a shared import would make this module need the database. */
const ACTIVE_APPLE_STATES = new Set(["ACTIVE", "BILLING_GRACE_PERIOD"]);

/**
 * The rules, in priority order:
 *
 *  1. Any member with an active Apple subscription covers everyone. This is
 *     what "one subscription per family" means, and it is checked first so the
 *     reason shown is the most accurate one available.
 *  2. Any member being comped covers everyone. Decided 2026-09-19: an account
 *     belongs to exactly one family at a time and joining another tears down
 *     the old one, so a comped account can free exactly one household at a
 *     time, at the cost of its own data. The abuse ceiling is low enough that
 *     zero friction for real families is the better trade.
 *  3. The OWNER's trial covers everyone. Deliberately not any member's — a
 *     joiner's fresh 14 days would otherwise extend the household's trial
 *     every time somebody new arrived.
 *  4. A grace period after the covering member left.
 *  5. Otherwise the household is not entitled.
 */
export function decideFamilyEntitlement(input: FamilyEntitlementInput): FamilyEntitlementDecision {
  const { members, graceUntil, now } = input;

  if (members.length === 0) {
    return {
      entitled: true,
      reason: "no_record",
      grantedBy: null,
      trialEndsAt: null,
      graceEndsAt: null,
      isComped: false,
    };
  }

  const owner = members.find((m) => m.isOwner) ?? null;

  const paying = members.find(
    (m) => m.appleSubscriptionState && ACTIVE_APPLE_STATES.has(m.appleSubscriptionState),
  );
  if (paying) {
    return {
      entitled: true,
      reason: "apple_active",
      grantedBy: paying.userId,
      trialEndsAt: owner?.trialEndsAt ?? null,
      graceEndsAt: null,
      isComped: false,
    };
  }

  const comped = members.find((m) => m.isComped);
  if (comped) {
    return {
      entitled: true,
      reason: "comped",
      grantedBy: comped.userId,
      trialEndsAt: owner?.trialEndsAt ?? null,
      graceEndsAt: null,
      isComped: true,
    };
  }

  if (owner?.trialEndsAt && owner.trialEndsAt.getTime() > now.getTime()) {
    return {
      entitled: true,
      reason: "trialing",
      grantedBy: owner.userId,
      trialEndsAt: owner.trialEndsAt,
      graceEndsAt: null,
      isComped: false,
    };
  }

  if (graceUntil && graceUntil.getTime() > now.getTime()) {
    return {
      entitled: true,
      reason: "grace",
      grantedBy: null,
      trialEndsAt: owner?.trialEndsAt ?? null,
      graceEndsAt: graceUntil,
      isComped: false,
    };
  }

  return {
    entitled: false,
    reason: "expired",
    grantedBy: null,
    trialEndsAt: owner?.trialEndsAt ?? null,
    graceEndsAt: null,
    isComped: false,
  };
}

/** How long a household keeps access after the member covering it leaves. */
export const ENTITLEMENT_GRACE_DAYS = 7;

export function graceDeadlineFrom(now: Date, days: number = ENTITLEMENT_GRACE_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Whether a departing member was the one covering the household, and so
 * whether their leaving should start the grace period.
 *
 * Deliberately does NOT check whether anyone else still covers it: stamping
 * unconditionally avoids a read-modify-write race between two people leaving
 * at once, and `decideFamilyEntitlement` ignores the grace window whenever a
 * remaining member entitles the family anyway.
 */
export function departureStartsGrace(departing: MemberEntitlementFacts): boolean {
  if (departing.appleSubscriptionState && ACTIVE_APPLE_STATES.has(departing.appleSubscriptionState)) {
    return true;
  }
  return departing.isComped;
}
