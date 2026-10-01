import { test } from "node:test";
import assert from "node:assert/strict";
import { driverIdsOf, isDriver, driverWriteFields } from "../../src/lib/eventDrivers.ts";

test("no drivers at all", () => {
  assert.deepEqual(driverIdsOf(null), []);
  assert.deepEqual(driverIdsOf({}), []);
  assert.deepEqual(driverIdsOf({ drivingProfileId: null, drivingProfileIds: [] }), []);
});

test("legacy single column is used when the new list is empty", () => {
  assert.deepEqual(driverIdsOf({ drivingProfileId: "mom" }), ["mom"]);
  assert.deepEqual(driverIdsOf({ drivingProfileId: "mom", drivingProfileIds: [] }), ["mom"]);
});

test("the new list wins over the legacy column when it has values", () => {
  // A row whose legacy column is stale must not resurrect the old driver.
  assert.deepEqual(
    driverIdsOf({ drivingProfileId: "mom", drivingProfileIds: ["dad", "gran"] }),
    ["dad", "gran"],
  );
});

test("duplicates and junk entries are dropped", () => {
  assert.deepEqual(
    driverIdsOf({ drivingProfileIds: ["dad", "dad", "", null as unknown as string, "mom"] }),
    ["dad", "mom"],
  );
});

test("isDriver", () => {
  const ev = { drivingProfileIds: ["dad", "mom"] };
  assert.equal(isDriver(ev, "mom"), true);
  assert.equal(isDriver(ev, "kid"), false);
  assert.equal(isDriver(null, "mom"), false);
});

test("driverWriteFields dual-writes, keeping the first driver in the legacy column", () => {
  assert.deepEqual(driverWriteFields(["dad", "mom"]), {
    drivingProfileIds: ["dad", "mom"],
    drivingProfileId: "dad",
  });
  // Clearing every driver must null the legacy column, not leave it behind.
  assert.deepEqual(driverWriteFields([]), { drivingProfileIds: [], drivingProfileId: null });
  assert.deepEqual(driverWriteFields(["a", "a", ""]), {
    drivingProfileIds: ["a"],
    drivingProfileId: "a",
  });
});

// ---------------------------------------------------------------------------
// Drivers used to be merged into profileIds on save (a withDrivers() helper),
// which made removing someone from "Assign to" impossible while they were
// still driving: the save reported success and then silently put them back.
// The two lists are separate now; "a driver counts as being on this event" is
// resolved by ORing them at READ time (the view filters, and profileIdsOf() in
// the server's calendarSync, which is what still copies the event onto a
// driver's own Google/Outlook calendar).
//
// Asserted against the source of the save sites themselves, because that merge
// is a one-line change at each call site rather than anything a running
// component exposes — a behavioural test of the modal alone would pass whether
// or not the merge came back (2026-09-04).
// ---------------------------------------------------------------------------
test("no save path merges drivers into the assignee list", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "src/lib/eventDrivers.ts",
    "src/components/calendar3-view.tsx",
    "src/components/home-view.tsx",
    "src/pages/family-hub.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    // The helper itself, and the shape of an inlined equivalent.
    assert.ok(!/\bwithDrivers\s*\(/.test(src), `${f} must not call withDrivers()`);
    assert.ok(
      !/profileIds:\s*(Array\.from\(new Set\(\[|\[)\s*\.\.\..*drivingProfileIds/.test(src),
      `${f} must not union drivingProfileIds into a profileIds payload`,
    );
  }
});
