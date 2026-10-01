import assert from "node:assert/strict";
import test from "node:test";
import { checkOffTitle, toolsForRole } from "../../src/lib/chatTools";

test("a kid tool list excludes inbox search", () => {
  const tools = toolsForRole(true);
  assert.equal(tools.includes("search"), false);
  assert.equal(tools.includes("get_newsletters"), false);
  assert.equal(tools.includes("complete_task"), true);
});

test("a parent tool list includes inbox search", () => {
  assert.equal(toolsForRole(false).includes("search"), true);
});

test("check off names the chore", () => {
  assert.equal(checkOffTitle("check off dishes"), "dishes");
  assert.equal(checkOffTitle("Who is driving soccer?"), null);
});
