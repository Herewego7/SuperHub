import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideFamilyEntitlement,
  departureStartsGrace,
  graceDeadlineFrom,
  ENTITLEMENT_GRACE_DAYS,
  type MemberEntitlementFacts,
} from "../src/lib/familyEntitlement.ts";

const NOW = new Date("2026-09-19T12:00:00Z");
const LATER = new Date("2026-10-19T12:00:00Z");
const EARLIER = new Date("2026-09-01T12:00:00Z");

function member(over: Partial<MemberEntitlementFacts> = {}): MemberEntitlementFacts {
  return {
    userId: "u1",
    isOwner: false,
    isComped: false,
    trialEndsAt: null,
    appleSubscriptionState: null,
    ...over,
  };
}

const owner = (over: Partial<MemberEntitlementFacts> = {}) =>
  member({ userId: "owner", isOwner: true, ...over });

function decide(members: MemberEntitlementFacts[], graceUntil: Date | null = null) {
  return decideFamilyEntitlement({ members, graceUntil, now: NOW });
}

test("one member's Apple subscription covers the whole household", () => {
  // The point of the feature: a spouse must not hit a paywall on a family
  // the owner is already paying for.
  const d = decide([
    owner({ appleSubscriptionState: "ACTIVE" }),
    member({ userId: "spouse" }),
  ]);
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "apple_active");
  assert.equal(d.grantedBy, "owner");
});

test("it doesn't matter which member is the one paying", () => {
  const d = decide([
    owner(),
    member({ userId: "spouse", appleSubscriptionState: "ACTIVE" }),
  ]);
  assert.equal(d.entitled, true);
  assert.equal(d.grantedBy, "spouse");
});

test("a billing-retry state is NOT active, a grace-period state is", () => {
  // Apple's own naming is the trap here: IN_BILLING_RETRY_PERIOD means the
  // card failed, IN_GRACE_PERIOD/BILLING_GRACE_PERIOD means Apple is still
  // covering them. Treating the first as active gives away the app for free.
  assert.equal(
    decide([owner({ appleSubscriptionState: "IN_BILLING_RETRY_PERIOD" })]).entitled,
    false,
  );
  assert.equal(
    decide([owner({ appleSubscriptionState: "BILLING_GRACE_PERIOD" })]).entitled,
    true,
  );
  assert.equal(decide([owner({ appleSubscriptionState: "EXPIRED" })]).entitled, false);
  assert.equal(decide([owner({ appleSubscriptionState: "REVOKED" })]).entitled, false);
});

test("any member's comp covers the household", () => {
  // Decided 2026-09-19. An account belongs to one family at a time and
  // joining another tears down its own, so a comped account can free exactly
  // one household at a time, at the cost of its own data.
  const d = decide([owner(), member({ userId: "friend", isComped: true })]);
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "comped");
  assert.equal(d.grantedBy, "friend");
  assert.equal(d.isComped, true);
});

test("the OWNER's trial covers the household; a joiner's does not extend it", () => {
  // Otherwise a family gets a fresh 14 days every time somebody new joins.
  const ownerTrialing = decide([owner({ trialEndsAt: LATER }), member({ userId: "spouse" })]);
  assert.equal(ownerTrialing.entitled, true);
  assert.equal(ownerTrialing.reason, "trialing");

  const onlyJoinerTrialing = decide([
    owner({ trialEndsAt: EARLIER }),
    member({ userId: "spouse", trialEndsAt: LATER }),
  ]);
  assert.equal(onlyJoinerTrialing.entitled, false);
  assert.equal(onlyJoinerTrialing.reason, "expired");
});

test("an expired owner trial does not entitle", () => {
  assert.equal(decide([owner({ trialEndsAt: EARLIER })]).entitled, false);
});

test("the grace period keeps the household running after the payer leaves", () => {
  const graceUntil = new Date("2026-09-24T12:00:00Z");
  const d = decide([owner()], graceUntil);
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "grace");
  assert.equal(d.graceEndsAt?.toISOString(), graceUntil.toISOString());
});

test("an elapsed grace period stops entitling", () => {
  assert.equal(decide([owner()], EARLIER).entitled, false);
});

test("a live subscription outranks a grace period", () => {
  // Someone leaving must not downgrade a household that still has a payer in
  // it — grace is stamped unconditionally on departure, so this ordering is
  // what makes that safe.
  const d = decide([owner({ appleSubscriptionState: "ACTIVE" })], new Date("2026-09-24T12:00:00Z"));
  assert.equal(d.reason, "apple_active");
});

test("a household with nothing is not entitled", () => {
  const d = decide([owner(), member({ userId: "spouse" })]);
  assert.equal(d.entitled, false);
  assert.equal(d.reason, "expired");
  assert.equal(d.grantedBy, null);
});

test("no members at all fails OPEN", () => {
  // An empty member list means the lookup went wrong, not that the family is
  // unentitled. Never lock a family out because of our own bug.
  const d = decide([]);
  assert.equal(d.entitled, true);
  assert.equal(d.reason, "no_record");
});

test("only a covering member's departure starts the grace period", () => {
  assert.equal(departureStartsGrace(member({ appleSubscriptionState: "ACTIVE" })), true);
  assert.equal(departureStartsGrace(member({ isComped: true })), true);
  // Someone who was contributing nothing leaving changes nothing.
  assert.equal(departureStartsGrace(member({ trialEndsAt: LATER })), false);
  assert.equal(departureStartsGrace(member()), false);
  assert.equal(departureStartsGrace(member({ appleSubscriptionState: "EXPIRED" })), false);
});

test("the grace deadline is seven days out", () => {
  assert.equal(ENTITLEMENT_GRACE_DAYS, 7);
  assert.equal(graceDeadlineFrom(NOW).toISOString(), "2026-09-26T12:00:00.000Z");
});
