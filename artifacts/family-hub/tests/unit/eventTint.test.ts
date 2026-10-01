import { test } from "node:test";
import assert from "node:assert/strict";
import { eventTint } from "../../src/lib/eventTint.ts";

test("a plain hex colour gets the same ~16% wash Home uses", () => {
  assert.equal(eventTint("#3b82f6"), "#3b82f628");
  assert.equal(eventTint("#EF4444"), "#EF444428");
});

// The reason this is a function rather than a string concat at the call site:
// a synced Google/Outlook calendar supplies its own colour string, and
// "rgb(59, 130, 246)28" is not a colour — the browser drops the declaration
// and the row renders with no background at all, which looks like a bug
// rather than like a deliberate grey.
test("anything that is not a 6-digit hex gets no tint, so the caller can fall back", () => {
  assert.equal(eventTint("rgb(59, 130, 246)"), undefined);
  assert.equal(eventTint("blue"), undefined);
  assert.equal(eventTint("#abc"), undefined);          // 3-digit shorthand
  assert.equal(eventTint("#3b82f6ff"), undefined);     // already has alpha
  assert.equal(eventTint("3b82f6"), undefined);        // no leading #
  assert.equal(eventTint(""), undefined);
  assert.equal(eventTint(undefined), undefined);
});
