import assert from "node:assert/strict";
import test from "node:test";
import { familyCalendarOptionValue, familyCalendarSelectValue, parseFamilyCalendarOption } from "../../src/lib/familyCalendarChoice";

const calendars = [
  { provider: "google" as const, profileId: "chad", calendarId: "family@group.calendar.google.com" },
  { provider: "outlook" as const, profileId: "alex", calendarId: "outlook-family" },
];

test("a saved family calendar keeps the adult who listed it", () => {
  const value = familyCalendarSelectValue("family@group.calendar.google.com", "chad", calendars);
  assert.deepEqual(parseFamilyCalendarOption(value), calendars[0]);
  assert.equal(familyCalendarSelectValue("family@group.calendar.google.com", null, calendars), familyCalendarOptionValue(calendars[0]));
  assert.equal(familyCalendarSelectValue(null, null, calendars), "none");
  assert.equal(parseFamilyCalendarOption("none"), null);
  assert.equal(parseFamilyCalendarOption(familyCalendarOptionValue(calendars[1]))?.profileId, "alex");
});
