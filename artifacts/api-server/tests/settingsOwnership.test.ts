import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsRowForUser, twoWaySyncFromSettings } from "../src/lib/settingsOwnership.ts";

const rows = [
  { id: "row-a", userId: "family-a", city: "Farmington" },
  { id: "row-b", userId: "family-b", city: "Denver" },
];

test("each family updates its OWN row, whatever the order", () => {
  // The bug: this used to be rows[0], so family B's save overwrote family A's
  // row and stamped B's userId on it — leaving A with no row at all.
  assert.equal(settingsRowForUser(rows, "family-a")?.id, "row-a");
  assert.equal(settingsRowForUser(rows, "family-b")?.id, "row-b");
  assert.equal(settingsRowForUser([...rows].reverse(), "family-a")?.id, "row-a");
});

test("a family with no row yet gets undefined, so the caller inserts", () => {
  assert.equal(settingsRowForUser(rows, "family-c"), undefined);
  assert.equal(settingsRowForUser([], "family-a"), undefined);
});

test("an unowned legacy row is never adopted", () => {
  // Claiming a NULL-userId row would hand one family whatever a previous
  // schema left behind, including someone else's city and timezone.
  const orphaned = [{ id: "legacy", userId: null, city: "Farmington" }];
  assert.equal(settingsRowForUser(orphaned, "family-a"), undefined);
});

test("one family's row is never returned to another", () => {
  // The assertion that actually encodes the security property.
  for (const userId of ["family-a", "family-b"]) {
    const hit = settingsRowForUser(rows, userId);
    assert.equal(hit?.userId, userId, `${userId} must only ever get its own row`);
  }
});

// ── Two-way sync default ────────────────────────────────────────────────────
// 2026-09-28: the Settings toggle showed ON while the server treated sync as
// OFF, so app events were silently never written to Google. The two layers
// disagreed about what "no settings row" meant. These pin them together.

test("no settings row means two-way sync is ON, matching the toggle and the column default", () => {
  // The exact production shape: a row that predates the family model has a
  // NULL user_id, settingsRowForUser refuses to adopt it, and the lookup
  // returns undefined. Reading `=== true` here is what dropped every event.
  assert.equal(twoWaySyncFromSettings(undefined), true);
  // A brand-new family that has never opened Calendar settings has no row at
  // all — same path, same answer.
  assert.equal(twoWaySyncFromSettings({}), true);
  assert.equal(twoWaySyncFromSettings({ twoWaySyncEnabled: null }), true);
});

test("only an explicit false turns two-way sync off", () => {
  assert.equal(twoWaySyncFromSettings({ twoWaySyncEnabled: false }), false);
  assert.equal(twoWaySyncFromSettings({ twoWaySyncEnabled: true }), true);
});

test("the server default matches what the Settings toggle renders", () => {
  // settings-modal.tsx: `calendarSettingsData?.twoWaySyncEnabled !== false`.
  // If these two expressions ever diverge again, the switch lies about what
  // the server will do — which is the whole bug.
  const asTheToggleReadsIt = (s: { twoWaySyncEnabled?: boolean | null } | undefined) =>
    s?.twoWaySyncEnabled !== false;
  for (const s of [undefined, {}, { twoWaySyncEnabled: null }, { twoWaySyncEnabled: true }, { twoWaySyncEnabled: false }] as const) {
    assert.equal(
      twoWaySyncFromSettings(s), asTheToggleReadsIt(s),
      `server and toggle disagree for ${JSON.stringify(s)}`,
    );
  }
});
