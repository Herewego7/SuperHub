import assert from "node:assert/strict";
import test from "node:test";
import { familyEventsFor, mergeFamilyEvents } from "../../src/lib/familyEvents";

const people = [
  { id: "all", name: "All Family", color: "#7C5CBF", isAllFamilyProfile: true },
  { id: "mom", name: "Mom", color: "#E07A5F", role: "adult" },
  { id: "dad", name: "Dad", color: "#3D85C6", role: "adult" },
];

const googleRow = (extra: Record<string, unknown> = {}) => ({
  id: "g1",
  iCalUID: "g1@google.com",
  summary: "Soccer",
  start: { dateTime: "2026-10-07T16:00:00-05:00" },
  end: { dateTime: "2026-10-07T17:00:00-05:00" },
  extendedProperties: { private: { google_calendar_id: "family@group.calendar.google.com", calendar_color: "#039BE5", calendar_name: "Family" } },
  ...extra,
});

test("every calendar's events come out with one id format, and a local event keeps its own tag", () => {
  const events = mergeFamilyEvents({
    local: [{ id: "e1", title: "Picture day", startTime: "2026-10-07T09:00:00.000Z", endTime: "2026-10-07T10:00:00.000Z", profileIds: ["mom"], source: "school" }],
    google: [{ profileId: "dad", rows: [googleRow()] }],
    outlook: [{ profileId: "mom", rows: [{ id: "o1", subject: "Standup", start: { dateTime: "2026-10-07T14:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-07T14:30:00", timeZone: "UTC" }, calendar: { id: "cal-o", name: "Work" } }] }],
    ical: [{ profileId: "dad", rows: [{ id: "i1", title: "Recycling", start: "2026-10-07T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z", isAllDay: true }] }],
    assignments: [],
    googleAccounts: [],
    people,
  });
  assert.deepEqual(events.map((event) => event.id), ["e1", "google-g1", "outlook-o1", "ical-i1"]);
  assert.deepEqual(events.map((event) => event.provider), ["local", "google", "outlook", "ical"]);
  assert.equal(events[0].source, "school");
  assert.equal(events[1].source, null);
  assert.equal(events[1].calendarName, "Family");
  assert.equal(events[1].color, "#3D85C6", "the person's color comes before the calendar's");
});

test("the same Google event on two people's calendars is one event, and an explicit assignment wins", () => {
  const assigned = googleRow({ extendedProperties: { private: { familyhub_profile_ids: JSON.stringify(["mom", "dad"]), google_calendar_id: "x" } } });
  const events = mergeFamilyEvents({
    local: [],
    google: [{ profileId: "dad", rows: [googleRow()] }, { profileId: "mom", rows: [assigned] }],
    outlook: [],
    ical: [],
    assignments: [],
    googleAccounts: [],
    people,
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].profileIds, ["mom", "dad"]);
  assert.equal(events[0].color, "#7C5CBF", "everyone on it takes the All Family color");
});

test("All Family shows every event, and Mom doesn't see Dad's", () => {
  const rows = [
    { id: "dad", title: "Dad's run", profileIds: ["dad"], drivingProfileIds: [] },
    { id: "mom", title: "Mom's call", profileIds: ["mom"], drivingProfileIds: [] },
    { id: "family", title: "Dinner out", profileIds: ["all"], drivingProfileIds: [] },
  ];
  assert.deepEqual(familyEventsFor(rows, ["mom", "dad"], people, []).map((row) => row.id), ["dad", "mom", "family"]);
  assert.deepEqual(familyEventsFor(rows, ["mom"], people, []).map((row) => row.id), ["mom", "family"]);
});
