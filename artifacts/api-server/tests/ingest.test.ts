import assert from "node:assert/strict";
import test from "node:test";
import { acceptSchool, choresDismissedBySlip, dismissSlip, eventsDismissedBySlip, inboxScanEnabled, inboxTokenExpiry, ingestMessages, muteSender, schoolEventStart, shareScan, slipDate, slipDayOffset, slipSender, withoutDismissedChores, withoutDismissedSlips } from "../src/ingest/process.ts";
import { outlookToInbound, toInbound } from "../src/ingest/parse.ts";

test("a stored Google token is refreshed once it has expired", () => {
  assert.equal(inboxTokenExpiry("2020-01-01T00:00:00.000Z", true), Date.parse("2020-01-01T00:00:00.000Z"));
  assert.equal(inboxTokenExpiry(null, true), 0);
  assert.equal(inboxTokenExpiry(null, false), undefined);
});

test("scan stays on until someone turns it off", () => {
  assert.equal(inboxScanEnabled(undefined), true);
  assert.equal(inboxScanEnabled(null), true);
  assert.equal(inboxScanEnabled(true), true);
  assert.equal(inboxScanEnabled(false), false);
});

test("a gmail message becomes a slip with the subject and sender", () => {
  const message = toInbound({
    id: "m1",
    snippet: "Please sign &amp; return.",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Permission slip" },
        { name: "From", value: "Office <office@school.edu>" },
      ],
    },
  }, "chad");
  assert.equal(message.subject, "Permission slip");
  assert.equal(message.fromAddress, "office@school.edu");
  assert.equal(message.snippet, "Please sign & return.");
});

test("a time written only in the email body still becomes an event", () => {
  const message = toInbound({
    id: "m2",
    snippet: "See the note.",
    payload: {
      mimeType: "multipart/alternative",
      parts: [{
        mimeType: "text/plain",
        body: { data: Buffer.from("Picture day is Thursday at 3:30 PM.").toString("base64url") },
      }],
    },
  }, "chad");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /Thursday at 3:30 PM/);
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: message.snippet, body: message.body, accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events.length, 1);
  assert.equal(planned.events[0]?.hours, 15);
  assert.equal(planned.events[0]?.minutes, 30);
  assert.match(planned.todos[0]?.description ?? "", /See the note/);
});

test("two scans of one household share one read", async () => {
  let started = 0;
  const inflight = new Map<string, Promise<number>>();
  const start = () => {
    started += 1;
    return new Promise<number>((resolve) => setTimeout(() => resolve(started), 20));
  };
  const first = shareScan(inflight, "home", start);
  const second = shareScan(inflight, "home", start);
  assert.equal(first, second);
  assert.equal(await first, 1);
  assert.equal(started, 1);
});

test("an outlook message becomes a slip with the subject and sender", () => {
  const message = outlookToInbound({
    subject: "Picture day",
    bodyPreview: "Wear a blue shirt &amp; smile.",
    from: { emailAddress: { address: "Office <office@school.edu>" } },
  }, "alex");
  assert.equal(message.subject, "Picture day");
  assert.equal(message.fromAddress, "office@school.edu");
  assert.equal(message.snippet, "Wear a blue shirt & smile.");
});

test("two copies of the same slip from two adults become one to-do", () => {
  const planned = ingestMessages(
    [
      { subject: "Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Please sign and return.", accountId: "chad" },
      { subject: "Re: Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Please sign and return.", accountId: "alex" },
    ],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.todos.length, 1);
  assert.equal(planned.todos[0]?.category, "school_email");
  assert.equal(slipSender(planned.todos[0]?.description), "office@school.edu");
  assert.equal(planned.events.length, 0);
});

test("accepting a school twice leaves one name on the person", () => {
  const first = acceptSchool(null, "Lincoln Elementary");
  assert.equal(acceptSchool(first, "Lincoln Elementary"), "Lincoln Elementary");
  assert.equal(acceptSchool(first, "Washington High"), "Lincoln Elementary");
});

test("a muted sender and a dismissed slip stay off the household list", () => {
  const muted = muteSender({ mutedSenders: [], dismissedSlipKeys: [] }, "Office@school.edu");
  const dismissed = dismissSlip(muted, "picture day");
  const planned = ingestMessages(
    [
      { subject: "Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Sign this.", accountId: "chad" },
      { subject: "Picture day", fromAddress: "other@school.edu", snippet: "Thursday at 9:00 AM.", accountId: "chad" },
    ],
    dismissed,
    [],
    ["liam"],
  );
  assert.equal(planned.todos.length, 0);
});

test("a slip clock is the event time", () => {
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events[0]?.hours, 15);
  assert.equal(planned.events[0]?.minutes, 30);
});

test("a named weekday is the next time that day comes", () => {
  const thursday = new Date(2026, 9, 1);
  assert.equal(slipDayOffset("Thursday at 3:30 PM", thursday), 0);
  assert.equal(slipDayOffset("Friday at 3:30 PM", thursday), 1);
  assert.equal(slipDayOffset("Wednesday at 3:30 PM", thursday), 6);
  assert.equal(slipDayOffset("at 3:30 PM", thursday), null);
  assert.equal(slipDayOffset("next Friday at 3:30 PM", new Date(2026, 9, 2)), 7);
  assert.equal(slipDayOffset("next Friday at 3:30 PM", thursday), 1);
});

test("a written month and day is that calendar date", () => {
  const thursday = new Date(2026, 9, 1);
  const oct8 = slipDate("Picture day October 8 at 3:30 PM", thursday);
  assert.equal(oct8?.getFullYear(), 2026);
  assert.equal(oct8?.getMonth(), 9);
  assert.equal(oct8?.getDate(), 8);
  const past = slipDate("January 2", thursday);
  assert.equal(past?.getFullYear(), 2027);
  assert.equal(slipDate("Thursday at 3:30", thursday), null);
  const numeric = slipDate("Picture day 10/8 at 3:30 PM", thursday);
  assert.equal(numeric?.getFullYear(), 2026);
  assert.equal(numeric?.getMonth(), 9);
  assert.equal(numeric?.getDate(), 8);
  assert.equal(slipDate("10/8/2025", thursday)?.getFullYear(), 2025);
  const late = schoolEventStart("Thursday at 3:30 PM", 15, 30, new Date("2026-10-01T03:00:00.000Z"), "America/Chicago");
  assert.equal(late.toISOString(), "2026-10-01T20:30:00.000Z");
  const today = schoolEventStart("Picture day today at 3:30 PM", 15, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(today.toISOString(), "2026-10-01T20:30:00.000Z");
  const tonight = schoolEventStart("Picture day tonight at 6:30 PM", 18, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(tonight.toISOString(), "2026-10-01T23:30:00.000Z");
  const evening = schoolEventStart("Picture day this evening at 6:30 PM", 18, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(evening.toISOString(), "2026-10-01T23:30:00.000Z");
});

test("not relevant drops the slip already on Home", () => {
  const ids = choresDismissedBySlip(
    [
      { id: "a", title: "Re: Permission slip for the field trip", category: "school_email" },
      { id: "b", title: "Feed the dog", category: "chore" },
    ],
    "permission slip for the field trip",
  );
  assert.deepEqual(ids, ["a"]);
  const eventIds = eventsDismissedBySlip(
    [
      { id: "evt", title: "Permission slip for the field trip", source: "school", externalId: "permission slip for the field trip" },
      { id: "soccer", title: "Soccer", source: "app", externalId: null },
    ],
    "permission slip for the field trip",
  );
  assert.deepEqual(eventIds, ["evt"]);
  const still = withoutDismissedSlips(
    [
      { title: "Permission slip for the field trip", source: "school", externalId: "permission slip for the field trip" },
      { title: "Soccer", source: "app", externalId: null },
    ],
    ["permission slip for the field trip"],
  );
  assert.deepEqual(still.map((event) => event.title), ["Soccer"]);
  const choresLeft = withoutDismissedChores(
    [
      { title: "Permission slip for the field trip", category: "school_email" },
      { title: "Feed the dog", category: "chore" },
    ],
    ["permission slip for the field trip"],
  );
  assert.deepEqual(choresLeft.map((chore) => chore.title), ["Feed the dog"]);
});
