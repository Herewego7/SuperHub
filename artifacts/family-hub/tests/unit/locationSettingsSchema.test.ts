// Regression test for the 2026-08-23 bug where saving a Location has ALWAYS
// crashed: insertLocationSettingsSchema required `country`/`timezone`
// unconditionally, even though neither the Settings form nor onboarding's
// Location step ever collects a country, and both fields have a real DB
// default. This is exactly the payload the Settings form parses client-side
// before ever calling the API — if this schema regresses to requiring
// fields the UI doesn't send, Location can never be saved again, and every
// timed push (bedtime/daily brief/weekly recap) silently falls back to a
// guessed default timezone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertLocationSettingsSchema } from "@workspace/shared-types";

test("the exact minimal payload the Settings form sends (city+state only) parses without throwing", () => {
  const result = insertLocationSettingsSchema.parse({ city: "Farmington", state: "MN" });
  assert.deepEqual(result, { city: "Farmington", state: "MN" });
});

test("a full payload (all fields present) still parses correctly", () => {
  const result = insertLocationSettingsSchema.parse({
    city: "Farmington",
    state: "MN",
    country: "United States",
    latitude: 44.6402,
    longitude: -93.1468,
    timezone: "America/Chicago",
  });
  assert.equal(result.timezone, "America/Chicago");
});

test("missing city or state still correctly fails validation", () => {
  assert.throws(() => insertLocationSettingsSchema.parse({ state: "MN" }));
  assert.throws(() => insertLocationSettingsSchema.parse({ city: "Farmington" }));
});
