import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentsVisibleToFamily,
  assignmentsToDeactivate,
  assignPeopleToCalendar,
} from "../src/lib/calendarAssignmentScope.ts";

// Two families, and a calendar both of them have connected — a school
// calendar, say. This is the shape production cannot produce on its own.
const profileFamily = new Map([
  ["a-mum", "family-a"],
  ["a-kid", "family-a"],
  ["b-dad", "family-b"],
]);

const all = [
  { profileId: "a-mum", calendarId: "school@group.calendar.google.com", calendarType: "google", isActive: true },
  { profileId: "a-kid", calendarId: "swimming@group.calendar.google.com", calendarType: "google", isActive: true },
  { profileId: "b-dad", calendarId: "school@group.calendar.google.com", calendarType: "google", isActive: true },
  { profileId: "a-mum", calendarId: "old@group.calendar.google.com", calendarType: "google", isActive: false },
];

test("a family sees only its own assignments", () => {
  // The vulnerability: this endpoint returned every family's rows, carrying
  // calendar names, real email addresses and profile ids, to any signed-in
  // caller who left the profileId query parameter off.
  const visible = assignmentsVisibleToFamily(all, profileFamily, "family-a");
  assert.deepEqual(visible.map((a) => a.profileId).sort(), ["a-kid", "a-mum"]);
  assert.ok(!visible.some((a) => a.profileId === "b-dad"), "family B's row must not appear");
});

test("the other family sees only theirs", () => {
  const visible = assignmentsVisibleToFamily(all, profileFamily, "family-b");
  assert.deepEqual(visible.map((a) => a.profileId), ["b-dad"]);
});

test("inactive rows are not shown", () => {
  const visible = assignmentsVisibleToFamily(all, profileFamily, "family-a");
  assert.ok(!visible.some((a) => a.calendarId.startsWith("old@")));
});

test("a profile belonging to no known family sees nothing", () => {
  assert.deepEqual(assignmentsVisibleToFamily(all, new Map(), "family-a"), []);
});

test("reassigning a SHARED calendar does not touch the other family's row", () => {
  // Both families have connected the same school calendar. Family A moving it
  // from mum to the kid must leave family B's assignment alone.
  const toDeactivate = assignmentsToDeactivate(all, profileFamily, {
    profileId: "a-kid",
    calendarId: "school@group.calendar.google.com",
    calendarType: "google",
  });
  assert.deepEqual(toDeactivate.map((a) => a.profileId), ["a-mum"]);
  assert.ok(
    !toDeactivate.some((a) => a.profileId === "b-dad"),
    "family B's assignment for the same calendar must survive",
  );
});

test("reassignment still clears the previous owner inside the family", () => {
  // The behaviour that must NOT be lost: one calendar, one profile.
  const toDeactivate = assignmentsToDeactivate(all, profileFamily, {
    profileId: "a-kid",
    calendarId: "school@group.calendar.google.com",
    calendarType: "google",
  });
  assert.equal(toDeactivate.length, 1);
  assert.equal(toDeactivate[0].profileId, "a-mum");
});

test("calendar type is part of the match", () => {
  // A Google and an Outlook calendar can share an id string; reassigning one
  // must not deactivate the other.
  const toDeactivate = assignmentsToDeactivate(all, profileFamily, {
    profileId: "a-kid",
    calendarId: "school@group.calendar.google.com",
    calendarType: "outlook",
  });
  assert.deepEqual(toDeactivate, []);
});

test("an unknown incoming profile deactivates nothing", () => {
  // Fail closed: without a family we cannot say what is safe to touch.
  const toDeactivate = assignmentsToDeactivate(all, profileFamily, {
    profileId: "who-is-this",
    calendarId: "school@group.calendar.google.com",
    calendarType: "google",
  });
  assert.deepEqual(toDeactivate, []);
});

test("an already-inactive row is not re-deactivated", () => {
  const toDeactivate = assignmentsToDeactivate(all, profileFamily, {
    profileId: "a-kid",
    calendarId: "old@group.calendar.google.com",
    calendarType: "google",
  });
  assert.deepEqual(toDeactivate, []);
});

test("assigning two people to one calendar stores one calendar id", () => {
  const saved = assignPeopleToCalendar("school@group.calendar.google.com", ["liam", "chad"]);
  assert.equal(saved.calendarId, "school@group.calendar.google.com");
  assert.deepEqual(saved.audienceProfileIds, ["liam", "chad"]);
  assert.equal(saved.profileId, "liam");
});
