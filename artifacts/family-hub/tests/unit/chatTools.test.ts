import assert from "node:assert/strict";
import test from "node:test";
import { checkOffTitle, deleteEventTitle, importedEventNeedsConfirm, pointsProfileId, toolsForRole } from "../../src/lib/chatTools";

test("a kid tool list excludes inbox search", () => {
  const tools = toolsForRole(true);
  assert.equal(tools.includes("search"), false);
  assert.equal(tools.includes("get_newsletters"), false);
  assert.equal(tools.includes("complete_task"), true);
});

test("a parent tool list includes inbox search", () => {
  assert.equal(toolsForRole(false).includes("search"), true);
});

test("a check-off credits the person on screen", () => {
  assert.equal(pointsProfileId(["liam", "ava"], "liam"), "liam");
  assert.equal(pointsProfileId(["liam"], "family"), "liam");
});

test("check off names the chore", () => {
  assert.equal(checkOffTitle("check off dishes"), "dishes");
  assert.equal(checkOffTitle("Who is driving soccer?"), null);
});

test("deleting an imported event asks first", () => {
  assert.equal(deleteEventTitle("delete the soccer game"), "soccer game");
  assert.equal(importedEventNeedsConfirm("ics"), true);
  assert.equal(importedEventNeedsConfirm("meal"), false);
  assert.equal(importedEventNeedsConfirm(null), false);
});
