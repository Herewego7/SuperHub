import assert from "node:assert/strict";
import test from "node:test";
import { withMoreDetail } from "../src/ingest/details.ts";

// Spirit Day showed only its date and school (2026-10-20).
test("more detail is added after what a note says, before its For line, without repeats", () => {
  const note = "From: callaire@school.ccsend.com\nPlan: keydate\nRef: r1\nSender: Great Oaks\n10/30/2026\nGreat Oaks Academy\nFor Ava.";
  const more = withMoreDetail(note, "Wear school colors.\nGreat Oaks Academy.\nBring $2 for the bake sale.");
  assert.equal(more, "From: callaire@school.ccsend.com\nPlan: keydate\nRef: r1\nSender: Great Oaks\n10/30/2026\nGreat Oaks Academy\nWear school colors.\nBring $2 for the bake sale.\nFor Ava.");
  assert.equal(withMoreDetail(note, "Great Oaks Academy."), note, "nothing new leaves it alone");
});
