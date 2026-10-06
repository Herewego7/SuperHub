import assert from "node:assert/strict";
import test from "node:test";
import { GoogleCalendarService } from "../src/googleCalendar.ts";

test("a pasted space on the Google client id is not sent to Google", () => {
  const previousId = process.env.GOOGLE_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = " 861185341355-example.apps.googleusercontent.com\n";
  process.env.GOOGLE_CLIENT_SECRET = " GOCSPX-example ";
  try {
    const url = new GoogleCalendarService().getAuthUrl("state-1", "super-hub.replit.app");
    const params = new URL(url).searchParams;
    assert.equal(params.get("client_id"), "861185341355-example.apps.googleusercontent.com");
    assert.equal(url.includes("client_id=+"), false);
    assert.equal(url.includes("client_id=%20"), false);
  } finally {
    if (previousId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousSecret;
  }
});
