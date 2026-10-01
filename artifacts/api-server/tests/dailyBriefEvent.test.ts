import assert from "node:assert/strict";
import test from "node:test";
import { briefListsEvent } from "../src/lib/dailyBrief.ts";

test("a calendar dinner is not also counted as an event in the brief", () => {
  assert.equal(briefListsEvent({ source: "meal" }, true), false);
  assert.equal(briefListsEvent({ source: "meal" }, false), true);
  assert.equal(briefListsEvent({ source: "app" }, true), true);
});
