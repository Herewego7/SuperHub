import assert from "node:assert/strict";
import test from "node:test";
import { chatGoogleEvents, chatIcalEvents, chatOutlookEvents, googleChatWrite, googleMoveBody } from "../../src/lib/chatGoogle";

test("chat can see a Google event and who is driving it", () => {
  const rows = chatGoogleEvents([
    {
      profileId: "dad",
      events: [
        {
          id: "abc",
          summary: "Soccer",
          location: "Field 2",
          start: { dateTime: "2026-10-02T16:00:00" },
          end: { dateTime: "2026-10-02T17:00:00" },
          extendedProperties: {
            private: {
              google_calendar_id: "cal-1",
              familyhub_driving_profile_ids: "[\"liam\"]",
              familyhub_profile_ids: "[\"liam\"]",
            },
          },
        },
        { id: "abc", summary: "Soccer again" },
      ],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Soccer");
  assert.deepEqual(rows[0].drivingProfileIds, ["liam"]);
  assert.equal(rows[0].googleCalendarId, "cal-1");
  assert.equal(rows[0].location, "Field 2");
  assert.deepEqual(rows[0].profileIds, ["liam"]);
  assert.equal(rows[0].source, "google");
  assert.equal(rows[0].googleEventId, "abc");
  assert.equal(rows[0].googleProfileId, "dad");
});

test("chat can see an Outlook event and a subscribed event", () => {
  const outlook = chatOutlookEvents(
    [{ profileId: "dad", events: [{ id: "o1", subject: "Piano", isAllDay: false, start: { dateTime: "2026-10-02T15:00:00" }, end: { dateTime: "2026-10-02T15:30:00" }, location: { displayName: "Studio" }, calendar: { id: "ocal" } }] }],
    [{ calendarId: "ocal", calendarType: "outlook", profileId: "liam", audienceProfileIds: ["liam"] }],
    ["liam", "dad"],
  );
  assert.equal(outlook.length, 1);
  assert.equal(outlook[0].title, "Piano");
  assert.equal(outlook[0].source, "outlook");
  assert.equal(outlook[0].location, "Studio");
  assert.deepEqual(outlook[0].profileIds, ["liam"]);
  assert.equal(outlook[0].outlookCalendarId, "ocal");
  const ical = chatIcalEvents([{
    profileId: "dad",
    events: [{ id: "i1", title: "Practice", start: "2026-10-02T16:00:00", end: "2026-10-02T17:00:00", location: "Field 2", isAllDay: false, uid: "series-1" }],
  }]);
  assert.equal(ical.length, 1);
  assert.equal(ical[0].title, "Practice");
  assert.equal(ical[0].source, "ical");
  assert.equal(ical[0].location, "Field 2");
  assert.deepEqual(ical[0].profileIds, ["dad"]);
  assert.equal(ical[0].recurringEventId, "series-1");
});

test("a Google event chat can change has a write path", () => {
  assert.equal(
    googleChatWrite({ source: "google", googleProfileId: "dad", googleCalendarId: "cal 1", googleEventId: "abc" }),
    "/api/google-calendar/events/dad/cal%201/abc",
  );
  assert.equal(googleChatWrite({ source: "outlook", googleProfileId: "dad", googleCalendarId: "cal", googleEventId: "abc" }), null);
  assert.equal(googleChatWrite({ source: "google", googleProfileId: "dad", googleCalendarId: null, googleEventId: "abc" }), null);
});

test("chat can move a one-off Google event and leaves a series", () => {
  const start = new Date(2026, 9, 3, 16, 0, 0);
  const end = new Date(2026, 9, 3, 17, 0, 0);
  const body = googleMoveBody({ source: "google", recurringEventId: null, isAllDay: false }, start, end, true);
  assert.equal(body && typeof body === "object" && body.start, start.toISOString());
  assert.equal(body && typeof body === "object" && body.isAllDay, false);
  const day = new Date(2026, 9, 4, 0, 0, 0);
  const allDay = googleMoveBody({ source: "google", recurringEventId: null, isAllDay: true }, day, end, false);
  assert.equal(allDay && typeof allDay === "object" && allDay.isAllDay, true);
  assert.equal(allDay && typeof allDay === "object" && allDay.end, day.toISOString());
  assert.equal(googleMoveBody({ source: "google", recurringEventId: "series-1", isAllDay: false }, start, end, true), "series");
  assert.equal(googleMoveBody({ source: "outlook", recurringEventId: null, isAllDay: false }, start, end, true), null);
});
