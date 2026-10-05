import assert from "node:assert/strict";
import test from "node:test";
import { inboxScanOpen, nextInboxScanUntil } from "../../src/lib/inboxScan";

const now = Date.parse("2026-10-02T18:00:00Z");
const day = 24 * 60 * 60 * 1000;

test("the first connection opens a one-day scan window and a later scan does not restart it", () => {
  const first = nextInboxScanUntil(null, now, true);
  assert.equal(first, now + day);
  assert.equal(inboxScanOpen(first, now + day - 1), true);
  assert.equal(inboxScanOpen(first, now + day + 1), false);
  assert.equal(nextInboxScanUntil(first, now + 60_000, false), first);
  assert.equal(nextInboxScanUntil(first, now + 60_000, true), now + 60_000 + day);
});
