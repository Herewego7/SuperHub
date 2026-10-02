import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentsVisibleToFamily,
  assignmentsToDeactivate,
  assignPeopleToCalendar,
  calendarIsWritable,
  familyCalendarCreates,
  calendarTokenOwner,
  familyCalendarAccount,
  familyCalendarWriter,
  syncTargetsForEvent,
  eventsOnWatchedCalendars,
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

test("a family calendar is written by the account that connected it", () => {
  assert.deepEqual(
    familyCalendarWriter("school@group.calendar.google.com", all),
    { profileId: "a-mum", provider: "google" },
  );
  assert.equal(familyCalendarWriter("none", all), null);
  assert.equal(familyCalendarWriter("missing", all), null);
  assert.equal(familyCalendarWriter("old@group.calendar.google.com", all), null);
  const creates = familyCalendarCreates(
    [
      { profileId: "a-mum", provider: "google" },
      { profileId: "a-mum", provider: "outlook" },
      { profileId: "a-kid", provider: "google" },
    ],
    { profileId: "a-mum", provider: "google" },
  );
  assert.deepEqual(creates, [{ profileId: "a-mum", provider: "google" }]);
  const kidFirst = [{ profileId: "liam", calendarId: "family@group.calendar.google.com", calendarType: "google", isActive: true }];
  assert.deepEqual(
    familyCalendarAccount("family@group.calendar.google.com", kidFirst, [
      { profileId: "chad", provider: "google", calendarIds: null, writeCalendarId: "family@group.calendar.google.com" },
    ]),
    { profileId: "chad", provider: "google" },
  );
  assert.equal(calendarTokenOwner("family@group.calendar.google.com", "google", [
    { profileId: "chad", provider: "google", calendarIds: null },
    { profileId: "alex", provider: "google", calendarIds: null },
  ], "liam"), "liam");
  assert.equal(calendarTokenOwner("family@group.calendar.google.com", "google", [
    { profileId: "chad", provider: "google", calendarIds: ["family@group.calendar.google.com"] },
  ], "liam"), "chad");
  assert.equal(calendarTokenOwner("family@group.calendar.google.com", "google", [
    { profileId: "chad", provider: "google", calendarIds: null },
  ], "liam"), "chad");
  assert.deepEqual(
    familyCalendarAccount("family@group.calendar.google.com", kidFirst, [
      { profileId: "chad", provider: "google", calendarIds: ["primary"], writeCalendarId: "primary" },
    ], { profileId: "chad", provider: "google" }),
    { profileId: "chad", provider: "google" },
  );
  assert.deepEqual(
    familyCalendarAccount("family@group.calendar.google.com", kidFirst, [
      { profileId: "alex", provider: "google", writeCalendarId: "family@group.calendar.google.com" },
    ], { profileId: "liam", provider: "google" }),
    { profileId: "alex", provider: "google" },
  );
});

test("a dinner without a family calendar is not copied onto every account", () => {
  assert.deepEqual(syncTargetsForEvent("meal", null, [], ["mum", "dad"]), []);
  assert.deepEqual(syncTargetsForEvent("meal", "chad", [], ["mum", "dad"]), ["chad"]);
  assert.deepEqual(syncTargetsForEvent("app", null, [], ["mum", "dad"]), ["mum", "dad"]);
});

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

test("an unwatched calendar is not a write target", () => {
  const assignments = [{ calendarId: "school", watched: false, isActive: true }];
  assert.equal(calendarIsWritable(assignments, "school"), false);
  assert.equal(calendarIsWritable(assignments, "family"), true);
});

test("an unwatched calendar stays off the plan", () => {
  const events = [
    { title: "Practice", googleCalendarId: "school", outlookCalendarId: null },
    { title: "Dinner", googleCalendarId: null, outlookCalendarId: null },
  ];
  const kept = eventsOnWatchedCalendars(events, [{ calendarId: "school", watched: false, isActive: true }]);
  assert.deepEqual(kept.map((event) => event.title), ["Dinner"]);
});

test("assigning two people to one calendar stores one calendar id", () => {
  const saved = assignPeopleToCalendar("school@group.calendar.google.com", ["liam", "chad"]);
  assert.equal(saved.calendarId, "school@group.calendar.google.com");
  assert.deepEqual(saved.audienceProfileIds, ["liam", "chad"]);
  assert.equal(saved.profileId, "liam");
});
