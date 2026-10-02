import assert from "node:assert/strict";
import test from "node:test";
import { dinnerCopyRange, dinnerReply, groceryAlreadyHave, groceryHaveAction, groceryListAfterHave, mealEvents } from "../../src/lib/mealCalendar";

test("turning dinners on copies the weeks ahead, not only the week on screen", () => {
  const range = dinnerCopyRange("2026-10-05", "2026-10-11", new Date(2026, 9, 1));
  assert.equal(range.start <= "2026-10-01", true);
  assert.equal(range.end >= "2026-11-12", true);
  const later = dinnerCopyRange("2026-12-07", "2026-12-13", new Date(2026, 9, 1));
  assert.equal(later.end >= "2026-12-13", true);
});

test("the calendar switch off leaves the meal off the event list", () => {
  const events = mealEvents([{ name: "Tacos", slot: "dinner" }], false);
  assert.deepEqual(events, []);
});

test("the calendar switch on keeps the dinner", () => {
  const events = mealEvents([{ name: "Tacos", slot: "dinner" }, { name: "Oatmeal", slot: "breakfast" }], true);
  assert.deepEqual(events.map((meal) => meal.name), ["Tacos"]);
});

test("chat hears that the family already has tortillas", () => {
  assert.equal(groceryAlreadyHave("We already have tortillas."), "tortillas");
  assert.equal(groceryAlreadyHave("the kids have milk"), null);
});

test("already have matches a plural of the same item", () => {
  assert.deepEqual(groceryHaveAction("tortilla", [], [{ name: "Tortillas" }]), { kind: "have", name: "Tortillas" });
  const left = groceryListAfterHave(
    [{ name: "Tortillas" }, { name: "Cheese" }],
    [{ name: "tortilla", alreadyHave: true }],
  );
  assert.deepEqual(left.map((row) => row.name), ["Cheese"]);
  assert.equal(groceryHaveAction("milk", [], [{ name: "Milk chocolate" }]), null);
});

test("already have takes that line off the list and leaves the rest", () => {
  const action = groceryHaveAction("tortillas", [], [{ name: "Tortillas" }]);
  assert.deepEqual(action, { kind: "have", name: "Tortillas" });
  const left = groceryListAfterHave(
    [{ name: "Tortillas" }, { name: "Cheese" }],
    [{ name: "Tortillas", alreadyHave: true }],
  );
  assert.deepEqual(left.map((row) => row.name), ["Cheese"]);
  assert.equal(groceryHaveAction("cheese", [{ id: "c", name: "Cheese" }], []).kind, "delete");
});

test("chat names tonight's dinner and does not mention the inbox", () => {
  const reply = dinnerReply("what's for dinner?", [{ date: "2026-10-01", slot: "dinner", name: "Tacos" }], new Date(2026, 9, 1));
  assert.equal(reply, "Dinner. Tacos");
  assert.equal(reply?.includes("newsletter"), false);
  const friday = dinnerReply("what's for dinner Friday", [
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    { date: "2026-10-02", slot: "dinner", name: "Pasta" },
  ], new Date(2026, 9, 1));
  assert.equal(friday, "Dinner. Pasta");
  assert.equal(dinnerReply("what's for dinner tonight", [
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    { date: "2026-10-02", slot: "dinner", name: "Pasta" },
  ], new Date(2026, 9, 1)), "Dinner. Tacos");
  assert.equal(dinnerReply("what's for dinner this evening", [
    { date: "2026-10-01", slot: "dinner", name: "Tacos" },
    { date: "2026-10-02", slot: "dinner", name: "Pasta" },
  ], new Date(2026, 9, 1)), "Dinner. Tacos");
  assert.equal(dinnerReply("what's for dinner?", [
    { date: "2026-10-02", slot: "dinner", name: "Pasta" },
  ], new Date(2026, 9, 1)), "Dinner tomorrow. Pasta");
});
