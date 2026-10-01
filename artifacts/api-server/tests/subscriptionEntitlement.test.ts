// Regression tests for lib/subscriptionEntitlement.ts's decideTrialReminder —
// the pure boundary-math behind the 3 trial-countdown push reminders (7 days
// left / 2 days left / expires tomorrow). Kept as a standalone pure function
// specifically so this math is testable without a live scheduler or DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTrialReminder } from "../src/lib/subscriptionEntitlement";

const NONE = { d7: false, d2: false, d1: false };
const day = (n: number) => n * 24 * 60 * 60 * 1000;

test("decideTrialReminder: fires 7d reminder with 7 days left, none sent", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(7));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "7d");
});

test("decideTrialReminder: fires 7d reminder with 3 days left if 7d not yet sent", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(3));
  // 1d/2d take priority over 7d once inside their own windows — 3 days left
  // is past both the 1d and 2d windows, so 7d is the only one that applies.
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "7d");
});

test("decideTrialReminder: 1d reminder wins over 2d/7d inside its own window", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(0.5));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "1d");
});

test("decideTrialReminder: 2d reminder wins over 7d, but not over 1d", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(1.5));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "2d");
});

test("decideTrialReminder: never re-sends a reminder already marked sent", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(0.5));
  assert.equal(decideTrialReminder(trialEndsAt, now, { d7: true, d2: true, d1: true }), null);
});

test("decideTrialReminder: a late tick still fires a still-unsent earlier-window reminder", () => {
  // Scheduler was down and only ticks again with 0.2 days left — 1d hasn't
  // been sent yet, so it fires now rather than being silently skipped.
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(0.2));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "1d");
});

test("decideTrialReminder: returns null once the trial has already ended", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() - day(1));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), null);
});

test("decideTrialReminder: returns null with more than 7 days left", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(10));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), null);
});

test("decideTrialReminder: exact boundary of 7.0 days left fires 7d", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(7));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "7d");
});

test("decideTrialReminder: exact boundary of 1.0 days left fires 1d, not 2d", () => {
  const now = new Date(2026, 0, 1);
  const trialEndsAt = new Date(now.getTime() + day(1));
  assert.equal(decideTrialReminder(trialEndsAt, now, NONE), "1d");
});
