// Coverage for lib/healthSchedule.ts's expandOccurrences — the timezone-
// aware firing-window expansion behind health reminder scheduling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandOccurrences } from "../src/lib/healthSchedule";

const TZ = "America/Chicago"; // UTC-5 (CDT) in August

test("a paused reminder never fires", () => {
  const out = expandOccurrences(
    { scheduleJson: { kind: "daily", time: "08:00" }, startsAt: null, endsAt: null, isPaused: true },
    new Date("2026-08-10T13:00:00Z"), new Date("2026-08-10T13:05:00Z"), TZ,
  );
  assert.deepEqual(out, []);
});

test("'once' fires exactly at its stored instant if inside the window", () => {
  const at = new Date("2026-08-10T13:00:00Z");
  const out = expandOccurrences(
    { scheduleJson: { kind: "once", at: at.toISOString() }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.getTime(), at.getTime());
});

test("'once' does not fire outside the window", () => {
  const out = expandOccurrences(
    { scheduleJson: { kind: "once", at: "2026-08-10T13:00:00.000Z" }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T14:00:00Z"), new Date("2026-08-10T14:05:00Z"), TZ,
  );
  assert.deepEqual(out, []);
});

test("daily at 08:00 local fires within a window covering that local time", () => {
  // 08:00 CDT (UTC-5) = 13:00 UTC.
  const out = expandOccurrences(
    { scheduleJson: { kind: "daily", time: "08:00" }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.equal(out.length, 1);
});

test("daily schedule does not fire at the wrong local hour", () => {
  const out = expandOccurrences(
    { scheduleJson: { kind: "daily", time: "08:00" }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T18:00:00Z"), new Date("2026-08-10T18:05:00Z"), TZ,
  );
  assert.deepEqual(out, []);
});

test("weekly schedule only fires on its configured day(s) of week", () => {
  // 2026-08-10 is a Monday (dow 1).
  const onDay = expandOccurrences(
    { scheduleJson: { kind: "weekly", time: "08:00", days: [1] }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.equal(onDay.length, 1);

  const offDay = expandOccurrences(
    { scheduleJson: { kind: "weekly", time: "08:00", days: [2] /* Tuesday */ }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.deepEqual(offDay, []);
});

test("monthly schedule only fires on its configured day of month", () => {
  const onDay = expandOccurrences(
    { scheduleJson: { kind: "monthly", time: "08:00", dayOfMonth: 10 }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.equal(onDay.length, 1);

  const offDay = expandOccurrences(
    { scheduleJson: { kind: "monthly", time: "08:00", dayOfMonth: 15 }, startsAt: null, endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.deepEqual(offDay, []);
});

test("startsAt in the future suppresses an otherwise-due occurrence", () => {
  const out = expandOccurrences(
    { scheduleJson: { kind: "daily", time: "08:00" }, startsAt: new Date("2027-01-01"), endsAt: null, isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.deepEqual(out, []);
});

test("endsAt in the past suppresses the reminder entirely", () => {
  const out = expandOccurrences(
    { scheduleJson: { kind: "daily", time: "08:00" }, startsAt: null, endsAt: new Date("2020-01-01"), isPaused: false },
    new Date("2026-08-10T12:59:00Z"), new Date("2026-08-10T13:01:00Z"), TZ,
  );
  assert.deepEqual(out, []);
});
