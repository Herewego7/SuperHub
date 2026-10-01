import assert from "node:assert/strict";
import test from "node:test";
import { dinnerCalendarChange, dinnerEventInsert } from "../src/meals/dinnerEvent";

test("a dinner saved while the switch is on is offered to the family calendar", () => {
  const event = dinnerEventInsert({ date: "2026-10-01", slot: "dinner", name: "Tacos" }, "family", true);
  assert.equal(event?.title, "Tacos");
  assert.equal(event?.calendarId, "family");
  assert.equal(event?.source, "meal");
});

test("renaming a dinner updates the calendar copy and a delete removes it", () => {
  const existing = [{ id: "e1", title: "Tacos", source: "meal", startTime: new Date(2026, 9, 1, 18, 0) }];
  const renamed = dinnerCalendarChange(
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    { date: "2026-10-01", slot: "dinner", name: "Soup" },
    existing,
    "family",
    true,
  );
  assert.equal(renamed.updateId, "e1");
  const removed = dinnerCalendarChange(
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    null,
    existing,
    "family",
    true,
  );
  assert.deepEqual(removed.deleteIds, ["e1"]);
  const left = dinnerCalendarChange(
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    null,
    existing,
    "family",
    false,
  );
  assert.deepEqual(left.deleteIds, []);
});

test("the switch off leaves a new dinner off the calendar", () => {
  assert.equal(dinnerEventInsert({ date: "2026-10-01", slot: "dinner", name: "Tacos" }, "family", false), null);
  assert.equal(dinnerEventInsert({ date: "2026-10-01", slot: "breakfast", name: "Oatmeal" }, "family", true), null);
});
