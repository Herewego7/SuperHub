import { logger } from "./logger";

/**
 * Lets a polling scheduler stop touching the database when it has nothing to
 * do, without giving up the cadence it needs when it does.
 *
 * WHY THIS EXISTS (2026-09-16). Replit's "Storage" bill is really Neon
 * database COMPUTE-HOURS: the database autosuspends after 5 minutes idle, and
 * every query resets that timer. The schedulers in this app each queried on a
 * fixed interval whether or not anything was due, so the database never got a
 * clean 5-minute gap and stayed awake 24/7 — ~176 hours a month, ~$28.
 *
 * Widening the intervals (2026-08-28) did nothing, for two reasons worth
 * keeping written down:
 *   1. `behaviourTimers` was left on a 60-SECOND tick by mistake, and one
 *      query a minute is enough on its own to keep the database awake forever
 *      no matter what the others do.
 *   2. The rest were widened to exactly 5 minutes — the same as the
 *      autosuspend window — which leaves no idle margin at all.
 *
 * The fix is to stop counting queries and start counting WAKE-UPS. What costs
 * money is how often the database is disturbed, not how much is asked of it
 * once it is up. So:
 *
 *   - A tick reports whether it found any work.
 *   - While there is work, the scheduler keeps its normal cadence — no
 *     latency is traded away for a family that is actually using the feature.
 *   - While there is none, ticks are skipped entirely and the scheduler only
 *     looks again on a shared hourly boundary. Every gated scheduler uses
 *     the SAME boundary, so an idle app disturbs the database twice an hour,
 *     all together, rather than each scheduler waking it separately.
 *   - A write that creates work (a new reminder, a new incident) calls
 *     `markSchedulerWorkDirty`, so the next tick looks immediately instead of
 *     waiting for the boundary. That write has just woken the database
 *     anyway, so the re-check is free.
 *
 * ⚠️ This is a COST control, not a correctness mechanism. A gate that wrongly
 * says "no work" delays a notification, so every path that can create work
 * must mark the gate dirty. When in doubt, mark it — a needless re-check
 * costs one query, a missed one costs a medication reminder.
 */

/**
 * The shared boundary. All gated schedulers re-check on the same one, so an
 * idle app disturbs the database once an hour, all four at the same moment,
 * rather than four times at four different moments.
 *
 * An hour is safe because this is only a SAFETY NET: every path that creates
 * work marks the gate dirty, so a new reminder or a new incident is picked up
 * on the very next tick. The net exists for work that appears without going
 * through one of those paths — a direct database edit, a restored backup, a
 * write path added later by someone who doesn't know about this file.
 */
export const IDLE_RECHECK_MS = 60 * 60_000;

export interface WorkGateState {
  /** What the last tick found. null = never run. */
  known: boolean | null;
  /** The hour-long slot that last answer belongs to. */
  slot: number;
  /** A write said the answer may have changed. */
  dirty: boolean;
}

export function slotOf(now: Date, recheckMs: number = IDLE_RECHECK_MS): number {
  return Math.floor(now.getTime() / recheckMs);
}

/**
 * Pure decision: should this tick run at all? Separated from the gate itself
 * so the rule can be tested without a clock, a database or a scheduler.
 */
export function shouldRunTick(
  state: WorkGateState,
  now: Date,
  recheckMs: number = IDLE_RECHECK_MS,
): boolean {
  if (state.dirty) return true;          // something just changed — look now
  if (state.known === null) return true; // never run: must find out
  if (state.known) return true;          // there was work last time
  return slotOf(now, recheckMs) !== state.slot; // idle: only on the boundary
}

export interface WorkGate {
  /** Run the tick only when this says so, then hand back what it found. */
  shouldRun(now?: Date): boolean;
  record(foundWork: boolean, now?: Date): void;
  markDirty(): void;
  /** For tests and logging. */
  peek(): Readonly<WorkGateState>;
}

const registry = new Map<string, WorkGate>();

export function createWorkGate(name: string, recheckMs: number = IDLE_RECHECK_MS): WorkGate {
  const state: WorkGateState = { known: null, slot: -1, dirty: false };
  const gate: WorkGate = {
    shouldRun: (now = new Date()) => shouldRunTick(state, now, recheckMs),
    record: (foundWork, now = new Date()) => {
      const wasIdle = state.known === false;
      state.known = foundWork;
      state.slot = slotOf(now, recheckMs);
      state.dirty = false;
      if (wasIdle !== !foundWork) {
        logger.info({ scheduler: name, foundWork }, "Scheduler work gate changed");
      }
    },
    markDirty: () => { state.dirty = true; },
    peek: () => state,
  };
  registry.set(name, gate);
  return gate;
}

/**
 * Called from write paths. Safe to call for a scheduler that hasn't started
 * (a one-off script importing storage, say) — it is simply a no-op then.
 */
export function markSchedulerWorkDirty(...names: string[]): void {
  for (const n of names) registry.get(n)?.markDirty();
}

/** Test seam only. */
export function _resetWorkGates(): void {
  registry.clear();
}
