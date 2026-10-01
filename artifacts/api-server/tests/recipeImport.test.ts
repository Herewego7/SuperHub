import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_BLOCK_STATUSES, looksLikeBotChallenge } from "../src/recipeImport.ts";

/**
 * Regression: allrecipes.com answers automated requests with 402, which was
 * not in this set — so instead of "that site won't let us read it", the user
 * saw the bare, self-blaming "Failed to fetch page: HTTP 402" and had no way
 * to tell it was the site's decision rather than a bug in the import.
 */
test("statuses that mean the site refused us are all treated as blocked", () => {
  for (const status of [401, 402, 403, 429, 451, 503, 999]) {
    assert.equal(BOT_BLOCK_STATUSES.has(status), true, `${status} should be blocked`);
  }
});

test("a wrong link or the site's own bug is NOT reported as blocked", () => {
  // These must keep the generic error path: 404 means the URL is wrong (the
  // user can fix that), 500 means their server broke (retrying may work).
  for (const status of [404, 410, 500, 502]) {
    assert.equal(BOT_BLOCK_STATUSES.has(status), false, `${status} should not be blocked`);
  }
});

test("a challenge page is detected, a real recipe page is not", () => {
  assert.equal(looksLikeBotChallenge("<title>Just a moment...</title>"), true);
  assert.equal(
    looksLikeBotChallenge("<h1>Chili</h1><p>Brown the beef, then add the captcha-free beans.</p>"),
    false,
  );
});
