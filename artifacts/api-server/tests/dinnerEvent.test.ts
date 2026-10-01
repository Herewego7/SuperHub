import assert from "node:assert/strict";
import test from "node:test";
import { dinnerEventInsert } from "../src/meals/dinnerEvent";

test("a dinner saved while the switch is on is offered to the family calendar", () => {
  const event = dinnerEventInsert({ date: "2026-10-01", slot: "dinner", name: "Tacos" }, "family", true);
  assert.equal(event?.title, "Tacos");
  assert.equal(event?.calendarId, "family");
  assert.equal(event?.source, "meal");
});

test("the switch off leaves a new dinner off the calendar", () => {
  assert.equal(dinnerEventInsert({ date: "2026-10-01", slot: "dinner", name: "Tacos" }, "family", false), null);
  assert.equal(dinnerEventInsert({ date: "2026-10-01", slot: "breakfast", name: "Oatmeal" }, "family", true), null);
});
