import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_RECHECK_MS, slotOf, shouldRunTick, createWorkGate, markSchedulerWorkDirty,
  type WorkGateState,
} from "../src/lib/workGate.ts";

const T0 = new Date("2026-09-16T12:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const state = (over: Partial<WorkGateState> = {}): WorkGateState =>
  ({ known: null, slot: -1, dirty: false, ...over });

test("a scheduler that has never run always looks", () => {
  assert.equal(shouldRunTick(state(), T0), true);
});

test("while there is work, every tick runs — no cadence is traded away", () => {
  const s = state({ known: true, slot: slotOf(T0) });
  assert.equal(shouldRunTick(s, T0), true);
  assert.equal(shouldRunTick(s, plus(60_000)), true);
  assert.equal(shouldRunTick(s, plus(5 * 60_000)), true);
});

// The whole point: an idle scheduler must stop touching the database, or the
// Neon instance never gets its 5 minutes of quiet and bills for being awake.
test("with no work, ticks are skipped until the next hourly boundary", () => {
  const s = state({ known: false, slot: slotOf(T0) });
  assert.equal(shouldRunTick(s, plus(60_000)), false);
  assert.equal(shouldRunTick(s, plus(5 * 60_000)), false);
  assert.equal(shouldRunTick(s, plus(59 * 60_000)), false);
  assert.equal(shouldRunTick(s, plus(IDLE_RECHECK_MS)), true, "never looked again");
});

// Every gated scheduler shares one boundary on purpose: what costs money is
// how often the database is disturbed, not how many queries arrive once it is
// awake. Four schedulers re-checking at four different moments would wake it
// four times.
test("every scheduler's idle re-check lands in the same slot", () => {
  const at = new Date("2026-09-16T12:07:31Z");
  const slots = ["dailyBrief", "bedtime", "health", "behaviour"].map(() => slotOf(at));
  assert.equal(new Set(slots).size, 1);
  assert.equal(slotOf(new Date("2026-09-16T12:59:59Z")), slotOf(new Date("2026-09-16T12:00:00Z")));
  assert.notEqual(slotOf(new Date("2026-09-16T13:00:00Z")), slotOf(new Date("2026-09-16T12:00:00Z")));
});

// A delayed notification is a real cost; a needless query is a rounding error.
test("a write marks the gate dirty and the next tick looks immediately", () => {
  const s = state({ known: false, slot: slotOf(T0), dirty: true });
  assert.equal(shouldRunTick(s, plus(30_000)), true);
});

test("the gate records what a tick found, and clears dirty", () => {
  const gate = createWorkGate("probe-test");
  assert.equal(gate.shouldRun(T0), true, "first run must look");
  gate.record(false, T0);
  assert.equal(gate.shouldRun(plus(60_000)), false);

  markSchedulerWorkDirty("probe-test");
  assert.equal(gate.shouldRun(plus(60_000)), true);
  assert.equal(gate.peek().dirty, true);
  gate.record(true, plus(60_000));
  assert.equal(gate.peek().dirty, false);
  assert.equal(gate.shouldRun(plus(120_000)), true, "work exists — keep ticking");
});

test("marking an unknown scheduler dirty is a no-op, not a crash", () => {
  assert.doesNotThrow(() => markSchedulerWorkDirty("no-such-scheduler"));
});
