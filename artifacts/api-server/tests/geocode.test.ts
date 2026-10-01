import { test } from "node:test";
import assert from "node:assert/strict";
import { geocodeCity } from "../src/lib/geocode";

// The real risk here is not "does it call an API" — it's picking the WRONG
// city of the same name. There is a Farmington in at least nine US states, and
// a London in both Ontario and the UK. These drive the selection logic through
// a stubbed fetch so the choice is pinned without a network call.
const realFetch = globalThis.fetch;
function stubFetch(payload: unknown, ok = true) {
  (globalThis as any).fetch = async () => ({ ok, json: async () => payload });
}
function restore() { (globalThis as any).fetch = realFetch; }

const FARMINGTONS = {
  results: [
    { latitude: 36.72, longitude: -108.21, admin1: "New Mexico", country_code: "US" },
    { latitude: 44.64, longitude: -93.14, admin1: "Minnesota", country_code: "US" },
    { latitude: 42.46, longitude: -83.37, admin1: "Michigan", country_code: "US" },
  ],
};

test("picks the city in the region the family actually entered", async () => {
  stubFetch(FARMINGTONS);
  try {
    const mn = await geocodeCity("Farmington", "Minnesota", "United States");
    assert.deepEqual(mn, { latitude: 44.64, longitude: -93.14 });
    const nm = await geocodeCity("Farmington", "New Mexico", "United States");
    assert.deepEqual(nm, { latitude: 36.72, longitude: -108.21 },
      "the first result is New Mexico — matching on region has to beat ordering");
  } finally { restore(); }
});

test("falls back to the most populous match when the region does not match", async () => {
  stubFetch(FARMINGTONS);
  try {
    const r = await geocodeCity("Farmington", "Nowhere", "United States");
    assert.deepEqual(r, { latitude: 36.72, longitude: -108.21 },
      "Open-Meteo already orders by population, so the first result is the fallback");
  } finally { restore(); }
});

test("a Canadian city resolves to its province", async () => {
  stubFetch({ results: [
    { latitude: 51.50, longitude: -0.12, admin1: "England", country_code: "GB" },
    { latitude: 42.98, longitude: -81.24, admin1: "Ontario", country_code: "CA" },
  ]});
  try {
    const r = await geocodeCity("London", "Ontario", "Canada");
    assert.deepEqual(r, { latitude: 42.98, longitude: -81.24 });
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Failure has to be soft. A location that refuses to save because a third
// party is down is a much worse bug than a wrong forecast.
// ---------------------------------------------------------------------------
test("a failed lookup returns null rather than throwing", async () => {
  stubFetch({}, false);
  try {
    assert.equal(await geocodeCity("Anywhere", "MN", "United States"), null);
  } finally { restore(); }
  (globalThis as any).fetch = async () => { throw new Error("network down"); };
  try {
    assert.equal(await geocodeCity("Anywhere", "MN", "United States"), null,
      "a thrown network error must not propagate out of the save path");
  } finally { restore(); }
});

test("no results, and an empty city, both return null", async () => {
  stubFetch({ results: [] });
  try {
    assert.equal(await geocodeCity("Xyzzy", "MN", "United States"), null);
    assert.equal(await geocodeCity("   ", "MN", "United States"), null);
  } finally { restore(); }
});
