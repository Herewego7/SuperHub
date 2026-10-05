import assert from "node:assert/strict";
import test from "node:test";
import { acceptSchool, choresDismissedBySlip, dismissSlip, eventsDismissedBySlip, graphNextLink, holdSchoolEvent, inboxFailure, inboxListStopped, inboxMailFailure, inboxScanEnabled, inboxTokenExpiry, ingestMessages, mailWorthSaving, muteSender, schoolEventStart, shareScan, slipDate, slipDayOffset, slipSender, withoutDismissedChores, withoutDismissedSlips } from "../src/ingest/process.ts";
import { gmailPayload, outlookToInbound, toInbound } from "../src/ingest/parse.ts";

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

test("an outlook next page is only followed on Microsoft's host", () => {
  assert.equal(
    graphNextLink("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc"),
    "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc",
  );
  assert.equal(graphNextLink("https://evil.example/steal"), null);
  assert.equal(graphNextLink("http://graph.microsoft.com/v1.0/me/messages"), null);
});

test("a later inbox page keeps the messages already listed", () => {
  assert.equal(inboxListStopped(new Error("timeout"), 50), true);
  assert.equal(inboxListStopped(new Error("timeout"), 0), false);
  assert.equal(inboxListStopped({ code: 401 }, 50), false);
});

test("one bad inbox message is skipped and a refused account reconnects", () => {
  assert.equal(inboxFailure(new Error("parse")), "skip");
  assert.equal(inboxFailure({ code: 404 }), "skip");
  assert.equal(inboxFailure({ response: { status: 401 } }), "reconnect");
  assert.equal(inboxFailure({ code: 403 }), "reconnect");
  assert.equal(inboxMailFailure({ response: { status: 401 } }), "auth");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }), "scope");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { errors: [{ reason: "accessNotConfigured" }] } } } }), "unavailable");
});

test("a gmail payload keeps the body the scan used to drop", () => {
  const payload = gmailPayload({
    mimeType: "multipart/alternative",
    headers: [
      { name: "Subject", value: "Picture day" },
      { name: "From", value: "Office <office@school.edu>" },
    ],
    parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Thursday at 3:30 PM.").toString("base64url") } }],
  });
  const message = toInbound({ id: "m", snippet: "See the note.", payload }, "chad");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /3:30 PM/);
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
  assert.match(planned.todos[0]?.description ?? "", /See the note\.\n\nPicture day is Thursday/);
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

test("an outlook time written only in the body still becomes an event", () => {
  const message = outlookToInbound({
    subject: "Picture day",
    bodyPreview: "See the note.",
    body: { contentType: "html", content: "<p>Picture day is Thursday at 3:30 PM.</p>" },
    from: { emailAddress: { address: "office@school.edu" } },
  }, "alex");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /Thursday at 3:30 PM/);
  const planned = ingestMessages(
    [message],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events[0]?.hours, 15);
  assert.match(planned.todos[0]?.description ?? "", /See the note\.\n\nPicture day is Thursday/);
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

test("a store receipt stays out and a practice note stays", () => {
  const planned = ingestMessages(
    [
      { subject: "Your package was delivered", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today.", accountId: "chad" },
      { subject: "Soccer practice moved", fromAddress: "coach@gmail.com", snippet: "Thursday at 5:30 PM.", accountId: "chad" },
    ],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(mailWorthSaving({ subject: "Your package was delivered", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today." }), false);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Soccer practice moved"]);
  assert.equal(planned.events[0]?.hours, 17);
  const game = ingestMessages(
    [{ subject: "Soccer game moved", fromAddress: "coach@gmail.com", snippet: "Thursday at 4:00 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.deepEqual(game.todos.map((todo) => todo.title), ["Soccer game moved"]);
  assert.equal(mailWorthSaving({ subject: "Track your package", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today." }), false);
});

test("a saved slip with no calendar event gets the event on the next scan", () => {
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "See the note.", body: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    ["picture day"],
    ["liam"],
    [],
  );
  assert.equal(planned.todos.length, 0);
  assert.equal(planned.events[0]?.hours, 15);
  const held = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    ["picture day"],
    ["liam"],
    ["picture day"],
  );
  assert.equal(held.events.length, 0);
  const again = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: ["picture day"] },
    [],
    ["liam"],
    [],
  );
  assert.equal(again.events.length, 0);
  const removed = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: holdSchoolEvent([], "picture day") },
    ["picture day"],
    ["liam"],
    [],
  );
  assert.equal(removed.events.length, 0);
  assert.equal(withoutDismissedChores([{ title: "Picture day", category: "school_email" }], holdSchoolEvent([], "picture day")).length, 1);
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
  const replyBy = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00 AM. Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(replyBy.events[0]?.hours, 15);
  const ranged = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00 AM. Thursday 3:30-5:00 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(ranged.events[0]?.hours, 15);
  assert.equal(ranged.events[0]?.endHours, 17);
  assert.equal(ranged.events[0]?.endMinutes, 0);
  const replyRange = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00-10:00 AM. Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(replyRange.events[0]?.hours, 15);
  assert.equal(replyRange.events[0]?.endHours, undefined);
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
  const laterToday = schoolEventStart("Picture day at 3:30 PM", 15, 30, new Date("2026-10-01T15:00:00.000Z"), "America/Chicago");
  assert.equal(laterToday.toISOString(), "2026-10-01T20:30:00.000Z");
  const alreadyPassed = schoolEventStart("Picture day at 3:30 PM", 15, 30, new Date("2026-10-01T21:00:00.000Z"), "America/Chicago");
  assert.equal(alreadyPassed.toISOString(), "2026-10-02T20:30:00.000Z");
  const tomorrow = schoolEventStart("Picture day tomorrow at 3:30 PM", 15, 30, new Date("2026-10-01T15:00:00.000Z"), "America/Chicago");
  assert.equal(tomorrow.toISOString(), "2026-10-02T20:30:00.000Z");
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
