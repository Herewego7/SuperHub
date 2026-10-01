import assert from "node:assert/strict";
import test from "node:test";
import { BOTTOM_NAV_IDS } from "../../src/lib/bottomNav";

test("bottom bar tabs are home, calendar, chores, meals, and chat", () => {
  assert.deepEqual([...BOTTOM_NAV_IDS], ["home", "calendar", "chores", "meals", "chat"]);
});
