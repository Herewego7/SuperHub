// The rule text pushed to Google and Outlook (2026-09-12). Getting this wrong
// produces a WRONG series on someone else's calendar rather than an error, so
// the conversion is pure and pinned here rather than checked by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleRecurrence, outlookRecurrence, excludedInstants, alignStartToWeeklyDays, outlookInstancesToDelete } from "../src/lib/recurrenceRule";
import { expandRecurringEvents } from "../src/lib/eventRecurrence";
import type { Event } from "@workspace/db";

// Monday 7 Sep 2026, 9:00 local.
const MON = new Date(2026, 8, 7, 9, 0, 0);
function ev(partial: Partial<Event> = {}): Event {
  return {
    id: "e1", userId: "u1", title: "Swim",
    startTime: MON, endTime: new Date(2026, 8, 7, 10, 0, 0),
    isAllDay: false, description: null, location: null, profileIds: [],
    recurrenceType: "weekly", recurrenceEndDate: null,
    recurrenceInterval: 1, daysOfWeek: null, excludedDates: null,
    createdAt: new Date(),
    ...partial,
  } as Event;
}

test("a one-off event carries no rule at all", () => {
  assert.equal(googleRecurrence(ev({ recurrenceType: null })), undefined);
  assert.equal(outlookRecurrence(ev({ recurrenceType: null })), undefined);
});

test("Google: weekly on Mon+Tue every 2 weeks", () => {
  const out = googleRecurrence(ev({ daysOfWeek: [1, 2], recurrenceInterval: 2 }))!;
  assert.equal(out[0], "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU");
});

test("Google: interval 1 is left out — it is the default and noise in the rule", () => {
  assert.equal(googleRecurrence(ev({ daysOfWeek: [3] }))![0], "RRULE:FREQ=WEEKLY;BYDAY=WE");
});

test("Google: a weekly event with no days ticked spells out its own weekday", () => {
  // Locally "no days" means the start date's day. BYDAY has to say so
  // explicitly, or the provider is guessing from its own anchor.
  assert.equal(googleRecurrence(ev())![0], "RRULE:FREQ=WEEKLY;BYDAY=MO");
});

test("Google: UNTIL covers the whole last day, matching local expansion", () => {
  // Compared as an INSTANT, not as literal text: UNTIL is in UTC, so on a
  // server running in Chicago the correct answer reads 20260922T045959Z. An
  // assertion pinned to the UTC-server spelling fails everywhere else, which
  // is a broken test rather than a broken rule.
  const out = googleRecurrence(ev({ recurrenceEndDate: new Date(2026, 8, 21) }))!;
  const m = /UNTIL=(\d{8})T(\d{6})Z/.exec(out[0]);
  assert.ok(m, `expected a UTC UNTIL: ${out[0]}`);
  const [, date, time] = m;
  const until = new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)),
    Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6)),
  ));
  const lastMoment = new Date(2026, 8, 21, 23, 59, 59);
  assert.equal(until.getTime(), lastMoment.getTime(), "UNTIL must not cut the last local day short");
});

test("Google: excluded occurrences become EXDATE at the real occurrence instant", () => {
  const out = googleRecurrence(ev({ excludedDates: ["2026-09-14"] }))!;
  const exdate = out.find(l => l.startsWith("EXDATE"));
  assert.ok(exdate, "a detached occurrence must be excluded from the synced series");
  // 9am local on the 14th — the same instant the local expansion would emit.
  const expected = new Date(2026, 8, 14, 9, 0, 0);
  const y = expected.getUTCFullYear();
  assert.ok(
    exdate.includes(String(y)),
    `EXDATE must name the occurrence's own instant, got ${exdate}`,
  );
});

test("an excluded date reconstructs the series' time of day, not midnight", () => {
  const [d] = excludedInstants(ev({ excludedDates: ["2026-09-14"] }));
  assert.equal(d.getHours(), 9, "an EXDATE at midnight matches no occurrence and is ignored");
  assert.equal(d.getDate(), 14);
});

test("Google: all-day exclusions use a date, not a timestamp", () => {
  const out = googleRecurrence(ev({ isAllDay: true, excludedDates: ["2026-09-14"] }))!;
  assert.ok(out.some(l => l.startsWith("EXDATE;VALUE=DATE:20260914")), out.join(" | "));
});

test("Outlook: weekly on Mon+Tue every 2 weeks", () => {
  const out = outlookRecurrence(ev({ daysOfWeek: [1, 2], recurrenceInterval: 2 }))!;
  assert.deepEqual(out.pattern, {
    type: "weekly", interval: 2, daysOfWeek: ["monday", "tuesday"], firstDayOfWeek: "sunday",
  });
  assert.deepEqual(out.range, { type: "noEnd", startDate: "2026-09-07" });
});

test("Outlook: an end date becomes an endDate range", () => {
  const out = outlookRecurrence(ev({ recurrenceEndDate: new Date(2026, 8, 21) }))!;
  assert.deepEqual(out.range, { type: "endDate", startDate: "2026-09-07", endDate: "2026-09-21" });
});

test("Outlook: monthly and yearly anchor to the start date's own day", () => {
  const m = outlookRecurrence(ev({ recurrenceType: "monthly", startTime: new Date(2026, 8, 17, 9, 0) }))!;
  assert.deepEqual(m.pattern, { type: "absoluteMonthly", interval: 1, dayOfMonth: 17 });
  const y = outlookRecurrence(ev({ recurrenceType: "annually", startTime: new Date(2026, 8, 17, 9, 0) }))!;
  assert.deepEqual(y.pattern, { type: "absoluteYearly", interval: 1, dayOfMonth: 17, month: 9 });
});

test("daily carries its interval and no weekday list", () => {
  assert.equal(googleRecurrence(ev({ recurrenceType: "daily", recurrenceInterval: 3 }))![0], "RRULE:FREQ=DAILY;INTERVAL=3");
  assert.deepEqual(outlookRecurrence(ev({ recurrenceType: "daily", recurrenceInterval: 3 }))!.pattern, { type: "daily", interval: 3 });
});

// ── The four gaps found auditing the sync path (2026-09-12) ────────────────

test("Google: an all-day series ends with a DATE, not a timestamp", () => {
  // RFC 5545: UNTIL's value type must match DTSTART's. An all-day DTSTART is a
  // DATE, so a timestamped UNTIL makes the rule invalid — and an invalid rule
  // is rejected or ignored, losing the end date entirely rather than being
  // corrected.
  const out = googleRecurrence(ev({ isAllDay: true, recurrenceEndDate: new Date(2026, 8, 21) }))!;
  assert.match(out[0], /UNTIL=20260921(;|$)/, `all-day UNTIL must be a bare date: ${out[0]}`);
  assert.doesNotMatch(out[0], /UNTIL=\d{8}T/, "an all-day rule must not carry a time");
});

test("a timed series still ends with a timestamp", () => {
  const out = googleRecurrence(ev({ recurrenceEndDate: new Date(2026, 8, 21) }))!;
  assert.match(out[0], /UNTIL=\d{8}T\d{6}Z/, out[0]);
});

test("a weekly start day that isn't ticked moves forward to the first one that is", () => {
  // Wednesday start, Mon+Tue ticked. Locally the stored row is always
  // occurrence one, so it would stay on the Wednesday while Google and Outlook
  // expand only Mondays and Tuesdays — the same event showing a different
  // first occurrence in the app and on a connected calendar.
  const wed = new Date(2026, 8, 9, 9, 0, 0);
  const aligned = alignStartToWeeklyDays(wed, new Date(2026, 8, 9, 10, 0, 0), [1, 2]);
  assert.ok(aligned, "a start on an unticked day has to move");
  assert.equal(aligned.startTime.getDay(), 1, "Monday is the next ticked day after Wednesday");
  assert.equal(aligned.startTime.getDate(), 14);
  assert.equal(aligned.startTime.getHours(), 9, "the time of day must survive the move");
  assert.equal(
    aligned.endTime.getTime() - aligned.startTime.getTime(), 60 * 60 * 1000,
    "the duration must survive the move",
  );
});

test("a start day that IS ticked is left exactly where it is", () => {
  const mon = new Date(2026, 8, 7, 9, 0, 0);
  assert.equal(alignStartToWeeklyDays(mon, new Date(2026, 8, 7, 10, 0), [1, 2]), null);
});

test("no ticked days means nothing to align", () => {
  const wed = new Date(2026, 8, 9, 9, 0, 0);
  assert.equal(alignStartToWeeklyDays(wed, wed, []), null);
  assert.equal(alignStartToWeeklyDays(wed, wed, null), null);
});

test("alignment never moves more than six days, whichever day is ticked", () => {
  for (let startDay = 0; startDay < 7; startDay++) {
    for (let tick = 0; tick < 7; tick++) {
      const start = new Date(2026, 8, 6 + startDay, 9, 0, 0); // 6 Sep 2026 is a Sunday
      const aligned = alignStartToWeeklyDays(start, start, [tick]);
      const result = aligned ? aligned.startTime : start;
      assert.equal(result.getDay(), tick, `start ${startDay} ticking ${tick} landed on ${result.getDay()}`);
      const moved = (result.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      assert.ok(moved >= 0 && moved <= 6, `moved ${moved} days`);
    }
  }
});

// ── Outlook has no EXDATE: holes are punched by deleting instances ─────────

test("Outlook: only the detached occurrences are picked out for deletion", () => {
  const excluded = [new Date(Date.UTC(2026, 8, 14, 9, 0, 0))];
  const ids = outlookInstancesToDelete([
    { id: "i1", start: { dateTime: "2026-09-07T09:00:00" } },
    { id: "i2", start: { dateTime: "2026-09-14T09:00:00" } },
    { id: "i3", start: { dateTime: "2026-09-21T09:00:00" } },
  ], excluded);
  assert.deepEqual(ids, ["i2"], "deleting the wrong instance removes an occurrence someone still expects");
});

test("Outlook: Graph's naive datetime is read as UTC, the zone the series was written in", () => {
  // The series is written with timeZone 'UTC', but Graph returns the datetime
  // WITHOUT a zone marker. Parsing it as local time matches nothing except on
  // a UTC server — and matching nothing looks exactly like the feature not
  // existing. Pinned with an explicit non-UTC interpretation to make the bug
  // visible if the Z is ever dropped again.
  const target = new Date(Date.UTC(2026, 8, 14, 9, 0, 0));
  assert.deepEqual(
    outlookInstancesToDelete([{ id: "i2", start: { dateTime: "2026-09-14T09:00:00" } }], [target]),
    ["i2"],
  );
  // A wall-clock time one hour off must NOT match.
  assert.deepEqual(
    outlookInstancesToDelete([{ id: "i2", start: { dateTime: "2026-09-14T10:00:00" } }], [target]),
    [],
  );
});

test("Outlook: an instance that already carries a zone is respected as-is", () => {
  const target = new Date(Date.UTC(2026, 8, 14, 13, 0, 0));
  assert.deepEqual(
    outlookInstancesToDelete([{ id: "i2", start: { dateTime: "2026-09-14T09:00:00-04:00" } }], [target]),
    ["i2"],
  );
});

test("Outlook: malformed or id-less instances are skipped, not thrown on", () => {
  const target = new Date(Date.UTC(2026, 8, 14, 9, 0, 0));
  assert.deepEqual(
    outlookInstancesToDelete(
      [null, undefined, {}, { id: "x" }, { id: null, start: { dateTime: "2026-09-14T09:00:00" } },
       { id: "y", start: { dateTime: "not a date" } }],
      [target],
    ),
    [],
  );
});

test("Outlook: nothing excluded means nothing deleted", () => {
  assert.deepEqual(
    outlookInstancesToDelete([{ id: "i1", start: { dateTime: "2026-09-07T09:00:00" } }], []),
    [],
  );
});

// ── Do the two systems agree? ──────────────────────────────────────────────
// Local expansion and the rule pushed to a provider are separate code paths
// describing one series. Everything above checks each in isolation; this
// checks they say the SAME thing, which is the failure the user actually sees
// (an event on a different day in the app than on their Google calendar).

const ICAL_TO_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function bydayOf(rule: string): number[] {
  const m = /BYDAY=([^;]+)/.exec(rule);
  return m ? m[1].split(",").map(d => ICAL_TO_DOW[d]) : [];
}

test("every locally-expanded occurrence falls on a day the pushed rule allows", () => {
  for (const ticked of [[1, 2], [0, 6], [1, 3, 5], [4]]) {
    for (let startDay = 0; startDay < 7; startDay++) {
      // 6 Sep 2026 is a Sunday, so +startDay walks the whole week.
      const rawStart = new Date(2026, 8, 6 + startDay, 9, 0, 0);
      const rawEnd = new Date(2026, 8, 6 + startDay, 10, 0, 0);
      // Exactly what the create route does before storing the row.
      const aligned = alignStartToWeeklyDays(rawStart, rawEnd, ticked);
      const row = ev({
        startTime: aligned?.startTime ?? rawStart,
        endTime: aligned?.endTime ?? rawEnd,
        daysOfWeek: ticked,
        recurrenceEndDate: new Date(2026, 9, 15),
      });

      const allowed = bydayOf(googleRecurrence(row)![0]);
      assert.deepEqual(
        [...allowed].sort(), [...ticked].sort(),
        `BYDAY should name exactly the ticked days for ${ticked}`,
      );

      const occurrences = expandRecurringEvents([row], new Date(2026, 8, 1));
      assert.ok(occurrences.length > 1, "expected a real series to compare");
      for (const occ of occurrences) {
        const dow = new Date(occ.startTime).getDay();
        assert.ok(
          allowed.includes(dow),
          `start on day ${startDay} ticking ${ticked}: local expansion produced a ` +
            `${dow} that the rule sent to Google does not allow — the app and a ` +
            `connected calendar would disagree`,
        );
      }
    }
  }
});
