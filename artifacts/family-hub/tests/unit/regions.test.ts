// Regression test for the 2026-08-23 Location-settings bug: saving a
// Location has ALWAYS crashed (a required Zod field the form never
// collects), which meant the family's real timezone could never be saved
// and every timed push fell back to a guessed default. regionToTimezone is
// the piece that computes the REAL timezone from the entered state, so it
// needs to keep resolving correctly for every state going forward.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regionToTimezone } from "../../src/lib/regions";

test("2-letter abbreviation resolves correctly", () => {
  assert.equal(regionToTimezone("MN"), "America/Chicago");
});

test("lowercase abbreviation resolves the same way", () => {
  assert.equal(regionToTimezone("mn"), "America/Chicago");
});

test("full state name resolves correctly", () => {
  assert.equal(regionToTimezone("Minnesota"), "America/Chicago");
});

test("full state name is case-insensitive", () => {
  assert.equal(regionToTimezone("minnesota"), "America/Chicago");
});

test("different states resolve to their own real timezone, not a hardcoded default", () => {
  assert.equal(regionToTimezone("California"), "America/Los_Angeles");
  assert.equal(regionToTimezone("NY"), "America/New_York");
  assert.equal(regionToTimezone("AZ"), "America/Phoenix");
});

test("unrecognized input returns undefined rather than guessing", () => {
  assert.equal(regionToTimezone("XX"), undefined);
  assert.equal(regionToTimezone(""), undefined);
  assert.equal(regionToTimezone("Nowhereland"), undefined);
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(regionToTimezone("  MN  "), "America/Chicago");
});

// ---------------------------------------------------------------------------
// Canada support (2026-09-10). The region -> timezone map is a fallback; the
// device's own timezone is preferred. These pin the fallback, the country
// helpers, and the two things most likely to be got wrong by hand.
// ---------------------------------------------------------------------------
import {
  countryFromName, countryFromTimezone, regionLabel, regionsFor, countryInfo,
} from "../../src/lib/regions";

test("Canadian provinces resolve, by abbreviation and by name", () => {
  assert.equal(regionToTimezone("ON"), "America/Toronto");
  assert.equal(regionToTimezone("Ontario"), "America/Toronto");
  assert.equal(regionToTimezone("british columbia"), "America/Vancouver");
  assert.equal(regionToTimezone("QC"), "America/Toronto");
  assert.equal(regionToTimezone("Québec"), "America/Toronto", "accented spelling");
});

test("Saskatchewan is America/Regina — the one province that skips DST", () => {
  // Getting this wrong drifts every timed push by an hour for half the year,
  // and only for half the year, which is the hardest kind of bug to notice.
  assert.equal(regionToTimezone("SK"), "America/Regina");
  assert.equal(regionToTimezone("Saskatchewan"), "America/Regina");
});

test("no Canadian abbreviation is shadowed by a US state", () => {
  // AB BC MB NB NL NS NT NU ON PE QC SK YT vs all 50 states + DC/PR/GU/VI.
  // If a collision were ever introduced, a country-less lookup would silently
  // return the US answer for a Canadian family.
  for (const { abbr } of regionsFor("CA")) {
    assert.equal(
      regionToTimezone(abbr, "CA"), regionToTimezone(abbr),
      `${abbr} resolves differently with and without the country — a US state now shadows it`,
    );
  }
});

test("the country narrows the lookup when one is given", () => {
  assert.equal(regionToTimezone("ON", "US"), undefined, "Ontario is not a US state");
  assert.equal(regionToTimezone("MN", "CA"), undefined, "Minnesota is not a province");
});

test("US states still resolve exactly as before", () => {
  assert.equal(regionToTimezone("MN"), "America/Chicago");
  assert.equal(regionToTimezone("Minnesota"), "America/Chicago");
  assert.equal(regionToTimezone("HI"), "Pacific/Honolulu");
  assert.equal(regionToTimezone("nowhere"), undefined);
});

test("country names round-trip to the values the column already stores", () => {
  assert.equal(countryFromName("United States"), "US");
  assert.equal(countryFromName("Canada"), "CA");
  assert.equal(countryFromName("canada"), "CA");
  // Anything unrecognised (including null, for a row saved before the column
  // was used) falls back to the column's own default rather than a third state.
  assert.equal(countryFromName(null), "US");
  assert.equal(countryFromName("Freedonia"), "US");
  assert.equal(countryInfo("US").name, "United States");
  assert.equal(countryInfo("CA").name, "Canada");
});

test("a timezone implies a country, for pre-selecting the picker only", () => {
  assert.equal(countryFromTimezone("America/Toronto"), "CA");
  assert.equal(countryFromTimezone("America/Regina"), "CA");
  assert.equal(countryFromTimezone("America/Chicago"), "US");
  assert.equal(countryFromTimezone("Europe/London"), undefined);
  assert.equal(countryFromTimezone(undefined), undefined);
});

test("the region field is labelled for its country", () => {
  assert.equal(regionLabel("US"), "State");
  assert.equal(regionLabel("CA"), "Province");
  assert.equal(regionsFor("CA").length, 13, "10 provinces + 3 territories");
  assert.ok(regionsFor("US").length >= 50);
  assert.deepEqual(
    regionsFor("CA").map(r => r.name).slice(0, 2), ["Alberta", "British Columbia"],
    "sorted by name for a picker",
  );
});
