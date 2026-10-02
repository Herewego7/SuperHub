import assert from "node:assert/strict";
import test from "node:test";
import { chatVisibleEvents, choreProgress, choresForCount, dinnerName, drivesOnHomeDay, earlierForHome, eventsForDayPlan, eventsForDrivingQuestion, eventsOnHomeDay, homeBirthdayLine, horizonBirthdays, horizonEvents, mailVisibleToKid, openTodos, schoolEmailNames, schoolEventClock, schoolSlipsHeldOnHome, todosForHome, visibleForProfiles } from "../../src/lib/homeDay";

const shared = { id: "study", taskType: "todo", profileIds: ["liam", "parent"], isActive: true };
const liamOnly = { id: "liam-pack", taskType: "todo", profileIds: ["liam"], isActive: true };

test("a shared to-do with two people is one record", () => {
  const both = todosForHome([shared], ["liam", "parent"], ["liam", "parent"]);
  assert.equal(both.length, 1);
  assert.equal(both[0].id, "study");
  const justLiam = todosForHome([shared, liamOnly], ["liam"], ["liam", "parent"]);
  assert.deepEqual(justLiam.map((todo) => todo.id), ["study", "liam-pack"]);
});

test("All Family keeps shared to-dos and drops personal ones", () => {
  const all = todosForHome([shared, liamOnly], ["liam", "parent"], ["liam", "parent"]);
  assert.deepEqual(all.map((todo) => todo.id), ["study"]);
});

test("chore progress counts a shared chore once", () => {
  const day = new Date(2026, 9, 1);
  const progress = choreProgress(
    [{ id: "dishes", taskType: "chore", profileIds: ["liam", "parent"], isActive: true, daysOfWeek: [4], recurrenceType: null }],
    [{ choreId: "dishes", completedAt: day }],
    day,
  );
  assert.deepEqual(progress, { done: 1, total: 1 });
});

test("a checked-off to-do leaves Home", () => {
  const todos = [{ id: "open", title: "Buy milk" }, { id: "done", title: "Dishes" }];
  assert.deepEqual(openTodos(todos, [{ choreId: "done" }]).map((todo) => todo.id), ["open"]);
});

test("earlier today for one person leaves out the rest of the household", () => {
  const day = new Date(2026, 9, 1, 15, 0);
  const rows = [
    { id: "liam", profileId: "liam", completedAt: day },
    { id: "parent", profileId: "parent", completedAt: day },
  ];
  assert.deepEqual(earlierForHome(rows, ["liam"], ["liam", "parent"], day).map((row) => row.id), ["liam"]);
  assert.equal(earlierForHome(rows, ["liam", "parent"], ["liam", "parent"], day).length, 2);
});

test("one person's chore count leaves out someone else's chore", () => {
  const day = new Date(2026, 9, 1);
  const rows = [
    { id: "liam", taskType: "chore", profileIds: ["liam"], isActive: true, daysOfWeek: [4], recurrenceType: null },
    { id: "parent", taskType: "chore", profileIds: ["parent"], isActive: true, daysOfWeek: [4], recurrenceType: null },
  ];
  const one = choreProgress(choresForCount(rows, ["liam"], ["liam", "parent"]), [], day);
  const all = choreProgress(choresForCount(rows, ["liam", "parent"], ["liam", "parent"]), [], day);
  assert.deepEqual(one, { done: 0, total: 1 });
  assert.deepEqual(all, { done: 0, total: 2 });
});

test("horizon skips a weekly routine and keeps a one-off next week", () => {
  const today = new Date(2026, 9, 1);
  const rows = horizonEvents(
    [
      { id: "practice", title: "Practice", startTime: new Date(2026, 9, 3), recurrenceType: "weekly" },
      { id: "recital", title: "Recital", startTime: new Date(2026, 9, 6), recurrenceType: null },
    ],
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["recital"]);
  const copied = horizonEvents(
    [
      { id: "p1", title: "Practice", startTime: new Date(2026, 9, 3), recurringEventId: "series-practice" },
      { id: "p2", title: "Practice", startTime: new Date(2026, 9, 10), recurringEventId: "series-practice" },
      { id: "b1", title: "Liam's birthday", startTime: new Date(2026, 9, 8), recurringEventId: "series-birthday" },
      { id: "b2", title: "Liam's birthday", startTime: new Date(2027, 9, 8), recurringEventId: "series-birthday" },
    ],
    today,
  );
  assert.deepEqual(copied.map((row) => row.id), ["b1"]);
  const dinners = horizonEvents(
    [
      { id: "tacos", title: "Tacos", startTime: new Date(2026, 9, 2, 18, 0), source: "meal" },
      { id: "recital", title: "Recital", startTime: new Date(2026, 9, 6), source: null },
    ],
    today,
  );
  assert.deepEqual(dinners.map((row) => row.id), ["recital"]);
});

test("a kid who is driving still sees that school event", () => {
  const day = new Date(2026, 9, 1, 15, 0);
  const soccer = {
    id: "soccer",
    title: "Soccer practice",
    description: "Bring shin guards",
    source: "school",
    startTime: day,
    drivingProfileIds: ["ava"],
  };
  assert.deepEqual(drivesOnHomeDay([soccer], day, ["ava"], "Ava").map((event) => event.id), ["soccer"]);
  assert.deepEqual(drivesOnHomeDay([soccer], day, ["liam"], "Liam").map((event) => event.id), []);
  assert.deepEqual(drivesOnHomeDay([{ ...soccer, description: "Ava must bring shin guards" }], day, ["ava"], "Ava"), []);
  const later = { ...soccer, id: "later", startTime: new Date(2026, 9, 4, 15, 0) };
  const far = { ...soccer, id: "far", startTime: new Date(2026, 9, 12, 15, 0) };
  assert.deepEqual(drivesOnHomeDay([later, far], day, ["ava"], "Ava").map((event) => event.id), ["later"]);
  const nextCopy = { ...soccer, id: "next", startTime: new Date(2026, 9, 8, 15, 0), recurringEventId: "series-soccer" };
  assert.deepEqual(
    drivesOnHomeDay([{ ...soccer, recurringEventId: "series-soccer" }, nextCopy], day, ["ava"], "Ava").map((event) => event.id),
    ["soccer"],
  );
});

test("a kid can be asked who is driving a school event that does not name them", () => {
  const soccer = {
    id: "soccer",
    title: "Soccer practice",
    description: "Bring shin guards",
    source: "school",
    profileIds: ["dad"],
    drivingProfileIds: ["ava"],
    googleCalendarId: null,
    outlookCalendarId: null,
  };
  assert.deepEqual(chatVisibleEvents([soccer], [], ["ava"], "Ava").map((event) => event.id), []);
  assert.deepEqual(eventsForDrivingQuestion([soccer], [], ["ava"], "Ava").map((event) => event.id), ["soccer"]);
  assert.deepEqual(eventsForDrivingQuestion([soccer], [], ["liam"], "Liam").map((event) => event.id), []);
});

test("a kid's day plan includes the school drive and leaves the email out", () => {
  const soccer = {
    id: "soccer",
    title: "Soccer practice",
    description: "Bring shin guards",
    source: "school",
    profileIds: ["dad"],
    drivingProfileIds: ["ava"],
    googleCalendarId: null,
    outlookCalendarId: null,
  };
  const staff = {
    id: "staff",
    title: "Staff meeting",
    description: "Parents only",
    source: "school",
    profileIds: [],
    drivingProfileIds: [],
    googleCalendarId: null,
    outlookCalendarId: null,
  };
  assert.deepEqual(eventsForDayPlan([soccer, staff], [], ["ava"], "Ava").map((event) => event.id), ["soccer"]);
  assert.deepEqual(eventsForDayPlan([soccer, staff], [], ["liam"], "Liam").map((event) => event.id), []);
});

test("a kid does not see a school email that does not name them", () => {
  assert.equal(schoolEmailNames({ title: "Permission slip", description: "Ava must return it", category: "school_email" }, "Ava"), true);
  assert.equal(schoolEmailNames({ title: "Picture day", description: "Thursday at 9", category: "school_email" }, "Ava"), false);
  assert.equal(schoolEmailNames({ title: "Pack lunch", description: null, category: "todo" }, "Ava"), true);
});

test("a kid's upcoming list hides school mail that does not name them", () => {
  const slip = { title: "Picture day", description: "Thursday at 9", category: "school_email", source: "school" };
  assert.equal(mailVisibleToKid(slip, "Ava"), false);
  assert.equal(mailVisibleToKid({ ...slip, description: "Ava must return it" }, "Ava"), true);
  assert.equal(mailVisibleToKid({ title: "Soccer", source: null }, "Ava"), true);
  assert.equal(mailVisibleToKid(slip, null), true);
});

test("Chad's filter hides an event that is only for Liam", () => {
  const rows = visibleForProfiles(
    [{ title: "Practice", profileIds: ["liam"] }, { title: "Dinner", profileIds: [] }],
    ["chad"],
  );
  assert.deepEqual(rows.map((row) => row.title), ["Dinner"]);
  const driving = visibleForProfiles(
    [{ title: "Carpool", profileIds: ["liam"], drivingProfileIds: ["chad"] }],
    ["chad"],
  );
  assert.deepEqual(driving.map((row) => row.title), ["Carpool"]);
  const legacy = visibleForProfiles(
    [{ title: "Pickup", profileIds: ["liam"], drivingProfileId: "chad", drivingProfileIds: [] }],
    ["chad"],
  );
  assert.deepEqual(legacy.map((row) => row.title), ["Pickup"]);
});

test("chat leaves out an unwatched calendar", () => {
  const rows = chatVisibleEvents(
    [
      { title: "Practice", googleCalendarId: "school", outlookCalendarId: null },
      { title: "Dinner", googleCalendarId: null, outlookCalendarId: null },
    ],
    [{ calendarId: "school", watched: false, isActive: true }],
    [],
    null,
  );
  assert.deepEqual(rows.map((row) => row.title), ["Dinner"]);
});

test("today's dinner event is omitted when the dinner line is shown", () => {
  const day = new Date(2026, 9, 1, 12, 0);
  const rows = eventsOnHomeDay(
    [
      { title: "Tacos", startTime: new Date(2026, 9, 1, 18, 0), source: "meal" },
      { title: "Soccer", startTime: new Date(2026, 9, 1, 16, 0), source: "app" },
    ],
    day,
    null,
    "Tacos",
  );
  assert.deepEqual(rows.map((row) => row.title), ["Soccer"]);
});

test("a timed school email stays on the to-do and leaves Today", () => {
  const day = new Date(2026, 9, 1, 12, 0);
  const rows = eventsOnHomeDay(
    [
      { title: "Picture day", startTime: new Date(2026, 9, 1, 15, 30), source: "school" },
      { title: "Soccer", startTime: new Date(2026, 9, 1, 16, 0), source: "app" },
    ],
    day,
    null,
    null,
    [{ title: "Picture day", category: "school_email" }],
  );
  assert.deepEqual(rows.map((row) => row.title), ["Soccer"]);
  assert.equal(schoolEventClock("Picture day", [{ title: "Picture day", startTime: new Date(2026, 9, 1, 15, 30), source: "school" }], day), "3:30 PM");
  const slip = { id: "slip", title: "Picture day", category: "school_email" as const };
  assert.equal(schoolSlipsHeldOnHome([slip], [], day).length, 1);
  assert.equal(schoolSlipsHeldOnHome([slip], [{ choreId: "slip", completedAt: new Date(2026, 9, 1, 9, 0) }], day).length, 1);
  assert.equal(schoolSlipsHeldOnHome([slip], [{ choreId: "slip", completedAt: new Date(2026, 8, 30, 9, 0) }], day).length, 0);
});

test("horizon lists a birthday in the next week", () => {
  const day = new Date(2026, 9, 1);
  const rows = horizonBirthdays([
    { name: "Liam", monthDay: "10-03", year: 2018, type: "birthday" },
    { name: "Ava", monthDay: "10-01", year: 2016, type: "birthday" },
    { name: "Us", monthDay: "10-04", year: 2013, type: "anniversary" },
    { name: "Noah", monthDay: "11-01", year: 2014 },
  ], day);
  assert.deepEqual(rows.map((row) => row.title), ["Liam turns 8", "Us, 13-year anniversary"]);
  assert.equal(rows[0]?.startTime.getDate(), 3);
  const observed = horizonBirthdays([{ name: "Liam", monthDay: "02-29", year: 2016 }], new Date(2027, 1, 27));
  assert.deepEqual(observed.map((row) => row.title), ["Liam turns 11"]);
  assert.equal(observed[0]?.startTime.getDate(), 28);
});

test("home names a birthday on the day being viewed", () => {
  assert.equal(homeBirthdayLine([{ name: "Liam", monthDay: "10-01", year: 2018, type: "birthday" }], new Date(2026, 9, 1)), "Liam turns 8.");
  assert.equal(homeBirthdayLine([{ name: "Liam", monthDay: "10-02", year: 2018 }], new Date(2026, 9, 1)), null);
  assert.equal(homeBirthdayLine([{ name: "Us", monthDay: "10-01", year: 2013, type: "anniversary" }], new Date(2026, 9, 1)), "Us, 13-year anniversary.");
  assert.equal(homeBirthdayLine([{ name: "Us", monthDay: "10-01", type: "anniversary" }], new Date(2026, 9, 1)), "Us's anniversary.");
  assert.equal(homeBirthdayLine([{ name: "Liam", monthDay: "02-29", year: 2016 }], new Date(2027, 1, 28)), "Liam turns 11.");
});

test("dinner is the meal in that slot on that date", () => {
  assert.equal(dinnerName([{ date: "2026-10-01", slot: "dinner", name: "Tacos" }], new Date(2026, 9, 1)), "Tacos");
  assert.equal(dinnerName([{ date: "2026-10-02", slot: "dinner", name: "Soup" }], new Date(2026, 9, 1)), null);
});
