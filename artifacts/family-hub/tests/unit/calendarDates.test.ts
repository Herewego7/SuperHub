// Regression coverage for lib/calendarDates.ts — the 2026-07-11 fix where
// all-day Google/Outlook/iCal events spilled onto a second calendar day
// because their exclusive end date was treated as inclusive, plus the
// Outlook-timed-events-shifted-by-UTC-offset fix in the same batch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoogleEventDates, parseOutlookEventDates, icalDisplayEnd } from "../../src/lib/calendarDates";

test("Google all-day event: a single-day event stays on exactly one day", () => {
  // Google reports a Jul 10 all-day event as start=2026-07-10, end=2026-07-11
  // (exclusive) — the real event covers only Jul 10.
  const { start, end } = parseGoogleEventDates({
    start: { date: "2026-07-10" },
    end: { date: "2026-07-11" },
  });
  assert.equal(start.getDate(), 10);
  assert.equal(end.getDate(), 10, "the exclusive end must not spill onto Jul 11");
  assert.equal(end.getHours(), 23);
});

test("Google all-day event: a genuinely multi-day event still spans the right days", () => {
  // A Jul 10-14 event (5 days) reports end=2026-07-15 (exclusive).
  const { start, end } = parseGoogleEventDates({
    start: { date: "2026-07-10" },
    end: { date: "2026-07-15" },
  });
  assert.equal(start.getDate(), 10);
  assert.equal(end.getDate(), 14, "should end on Jul 14, the last real day, not Jul 15");
});

test("Google timed event: uses dateTime directly, no exclusive-end adjustment", () => {
  const { start, end } = parseGoogleEventDates({
    start: { dateTime: "2026-07-10T14:00:00-05:00" },
    end: { dateTime: "2026-07-10T15:00:00-05:00" },
  });
  assert.equal(end.getTime() - start.getTime(), 60 * 60 * 1000);
});

test("Google all-day: a malformed feed (end === start) doesn't produce a negative-duration event", () => {
  const { start, end } = parseGoogleEventDates({
    start: { date: "2026-07-10" },
    end: { date: "2026-07-10" },
  });
  assert.ok(end >= start, "end must never be before start even with a malformed exclusive-end-equals-start feed");
});

test("Outlook all-day event: a single-day event stays on exactly one day", () => {
  const { start, end } = parseOutlookEventDates({
    isAllDay: true,
    start: { dateTime: "2026-07-10T00:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-07-11T00:00:00.0000000", timeZone: "UTC" },
  });
  assert.equal(start.getDate(), 10);
  assert.equal(end.getDate(), 10);
});

// The real bug: Graph returns a bare (no-offset) dateTime string plus a
// separate timeZone field (UTC, since no Prefer header is sent) — parsing
// the bare string as LOCAL time silently shifted every timed Outlook event
// by the viewer's own UTC offset.
test("Outlook timed event: a bare UTC dateTime is read as UTC, not local time", () => {
  const { start } = parseOutlookEventDates({
    isAllDay: false,
    start: { dateTime: "2026-07-10T14:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-07-10T15:00:00.0000000", timeZone: "UTC" },
  });
  assert.equal(start.toISOString(), "2026-07-10T14:00:00.000Z", "must not be shifted by the local machine's own offset");
});

test("Outlook timed event: a dateTime that already carries an offset is respected as-is", () => {
  const { start } = parseOutlookEventDates({
    isAllDay: false,
    start: { dateTime: "2026-07-10T14:00:00-05:00" },
    end: { dateTime: "2026-07-10T15:00:00-05:00" },
  });
  assert.equal(start.toISOString(), "2026-07-10T19:00:00.000Z");
});

test("icalDisplayEnd: a single-day all-day event stays on its own day", () => {
  // RFC 5545 DTEND is exclusive too — a Jul 10 all-day event has DTEND Jul 11.
  const start = new Date(2026, 6, 10, 12, 0, 0); // noon-anchored, per icalCalendar.ts's asUtcDate convention
  const end = icalDisplayEnd("2026-07-11T12:00:00Z", true, start);
  assert.equal(end.getDate(), 10, "should display as ending on the 10th, not spilling onto the 11th");
});

test("icalDisplayEnd: a non-all-day event is returned as-is, no exclusive-end adjustment", () => {
  const start = new Date("2026-07-10T14:00:00Z");
  const raw = "2026-07-10T15:00:00Z";
  const end = icalDisplayEnd(raw, false, start);
  assert.equal(end.toISOString(), new Date(raw).toISOString());
});
