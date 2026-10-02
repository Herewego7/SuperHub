import assert from "node:assert/strict";
import test from "node:test";
import { chatGoogleEvents } from "../../src/lib/chatGoogle";

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
