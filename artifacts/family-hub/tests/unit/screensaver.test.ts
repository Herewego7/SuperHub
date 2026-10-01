import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowScreensaver, SCREENSAVER_IDLE_MS } from "../../src/lib/screensaver.ts";

const MIN = 60_000;
const t = (m: number) => m * MIN;

test("stays away while someone is using the device", () => {
  assert.equal(shouldShowScreensaver(t(0), t(1)), false);
  assert.equal(shouldShowScreensaver(t(0), t(9)), false);
});

test("appears once the idle period has elapsed", () => {
  assert.equal(shouldShowScreensaver(t(0), t(10)), true);
  assert.equal(shouldShowScreensaver(t(0), t(45)), true);
});

/**
 * The reason this is timestamp arithmetic rather than a setTimeout. iOS
 * suspends timers in a backgrounded WebView, so an iPad that sleeps three
 * minutes into an idle period and wakes half an hour later would never have
 * fired a ten-minute timeout — and would come back showing half-hour-old
 * chores, which is the exact failure the screensaver exists to prevent.
 */
test("a device that slept through the idle period is still idle when it wakes", () => {
  const lastTouched = t(0);
  const sleptAt = t(3);
  const wokeAt = t(40);
  assert.equal(shouldShowScreensaver(lastTouched, sleptAt), false, "not idle yet when it slept");
  assert.equal(shouldShowScreensaver(lastTouched, wokeAt), true, "must be idle on waking");
});

test("the boundary is inclusive, so the check can't sit one tick short forever", () => {
  assert.equal(shouldShowScreensaver(0, SCREENSAVER_IDLE_MS - 1), false);
  assert.equal(shouldShowScreensaver(0, SCREENSAVER_IDLE_MS), true);
});

test("an override shortens the wait without touching the default", () => {
  assert.equal(shouldShowScreensaver(0, 2_000, 1_000), true);
  assert.equal(shouldShowScreensaver(0, 500, 1_000), false);
  assert.equal(SCREENSAVER_IDLE_MS, 10 * MIN);
});

// ── which picture it shows ────────────────────────────────────────────────
// Deliberately ONE, held until the family changes it. An earlier version
// rotated the built-in library; the objection that killed it is worth
// keeping: a picture someone chose is a picture they like, and rotating
// others past it means the wall sometimes shows one they don't. The rule is
// now simply "whatever the privacy screen shows", so the picking logic lives
// in one place and the two surfaces cannot disagree.
