import assert from "node:assert/strict";
import test from "node:test";
import { acceptSchool, choresDismissedBySlip, dismissSlip, ingestMessages, muteSender, slipDate, slipDayOffset, slipSender } from "../src/ingest/process.ts";

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
});
