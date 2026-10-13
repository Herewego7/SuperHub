import assert from "node:assert/strict";
import test from "node:test";
import { acceptedMealPlan, assignedDinners, dinnerConfirmText, mealRequest, proposedDinners } from "../src/meals/assignDinner.ts";

const monday = new Date("2026-10-05T15:00:00Z");
const week = `Here is a proposed meal plan for the rest of the week:
- Wednesday: Tacos
- Thursday: Chicken Stir Fry
- Friday: Pizza
- Saturday: Grilled Salmon
- Sunday: Roast Chicken

Does this sound good, or would you like to change any of these?`;

test("a named night is a dinner to save, and a proposal is not", () => {
  assert.deepEqual(
    assignedDinners("Let's do tacos on wednesday for sure. Let me think about the other options", monday, "America/Chicago"),
    [{ date: "2026-10-07", name: "Tacos" }],
  );
  assert.deepEqual(assignedDinners("Does this sound good, or would you like to change any of these?", monday, "America/Chicago"), []);
});

test("a proposed week is the list to confirm, and yes writes that same list", () => {
  const nights = proposedDinners(week, monday, "America/Chicago");
  assert.deepEqual(nights, [
    { date: "2026-10-07", name: "Tacos" },
    { date: "2026-10-08", name: "Chicken Stir Fry" },
    { date: "2026-10-09", name: "Pizza" },
    { date: "2026-10-10", name: "Grilled Salmon" },
    { date: "2026-10-11", name: "Roast Chicken" },
  ]);
  const ask = dinnerConfirmText(nights);
  assert.match(ask, /Reply yes to put these on the meal plan/);
  assert.deepEqual(proposedDinners(ask, monday, "America/Chicago"), nights);
  assert.equal(acceptedMealPlan("Yes"), true);
  assert.equal(acceptedMealPlan("sounds good"), true);
  assert.equal(acceptedMealPlan("Yes, but change Friday"), false);
  assert.deepEqual(proposedDinners("On the meal plan.\nWed, Oct 7: Tacos\nThu, Oct 8: Pizza", monday, "America/Chicago"), []);
  assert.deepEqual(proposedDinners("Wednesday: soccer\nThursday: dentist", monday, "America/Chicago"), []);
});

test("the verb and the meal slot are instructions, not part of the meal's name", () => {
  assert.deepEqual(mealRequest("Add eggs for breakfast"), { name: "Eggs", slot: "breakfast" });
  assert.deepEqual(mealRequest("put tacos on the meal plan"), { name: "Tacos" });
  assert.deepEqual(mealRequest("pancakes for lunch"), { name: "Pancakes", slot: "lunch" });
  assert.deepEqual(
    assignedDinners("Add pancakes for breakfast on Wednesday", monday, "America/Chicago"),
    [{ date: "2026-10-07", name: "Pancakes", slot: "breakfast" }],
  );
});

test("a breakfast confirmation names the slot, and yes writes it to breakfast", () => {
  const ask = dinnerConfirmText([{ date: "2026-10-06", name: "Eggs", slot: "breakfast" }]);
  assert.equal(ask, "Tue, Oct 6 · Breakfast: Eggs\nReply yes to put it on the meal plan.");
  assert.deepEqual(proposedDinners(ask, monday, "America/Chicago"), [{ date: "2026-10-06", name: "Eggs", slot: "breakfast" }]);
});
