import assert from "node:assert/strict";
import test from "node:test";
import { groceryAlreadyHave, mealEvents } from "../../src/lib/mealCalendar";

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
});
