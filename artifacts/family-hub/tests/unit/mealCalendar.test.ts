import assert from "node:assert/strict";
import test from "node:test";
import { MEAL_IDEAS } from "../../src/lib/mealIdeasDatabase";
import { assignedDinners, dinnerCopyRange, dinnerPlanReply, dinnerReply, dinnersForTheWeek, dinnersFromSaved, groceryAlreadyHave, groceryHaveAction, groceryHaveReply, groceryListAfterHave, mealEvents, proposedDinners, statedDinners, wantsDinnerPlan, withSavedMeals } from "../../src/lib/mealCalendar";

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
  assert.equal(groceryAlreadyHave("we have the tortillas"), "tortillas");
  assert.equal(groceryAlreadyHave("we've got the tortillas"), "tortillas");
  assert.equal(groceryAlreadyHave("the kids have milk"), null);
  assert.equal(groceryHaveReply("tortillas", null), "I don't see tortillas on the list.");
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

test("named nights become dinners, and a question does not", () => {
  const friday = new Date(2026, 9, 2);
  assert.deepEqual(statedDinners("tacos tonight and pasta tomorrow", friday), [
    { date: "2026-10-02", name: "tacos" },
    { date: "2026-10-03", name: "pasta" },
  ]);
  assert.deepEqual(statedDinners("Monday tacos, Wednesday soup", friday), [
    { date: "2026-10-05", name: "tacos" },
    { date: "2026-10-07", name: "soup" },
  ]);
  assert.deepEqual(statedDinners("what's for dinner tonight", friday), []);
  assert.deepEqual(
    assignedDinners("Let's do tacos on wednesday for sure. Let me think about the other options", new Date(2026, 9, 5)),
    [{ date: "2026-10-07", name: "tacos" }],
  );
  assert.deepEqual(assignedDinners("Does this sound good?", new Date(2026, 9, 5)), []);
  const monday = new Date(2026, 9, 5);
  assert.deepEqual(proposedDinners(`Here is a proposed meal plan for the rest of the week:
- Wednesday: Tacos
- Thursday: Chicken Stir Fry
Does this sound good?`, monday), [
    { date: "2026-10-07", name: "Tacos" },
    { date: "2026-10-08", name: "Chicken Stir Fry" },
  ]);
  assert.deepEqual(proposedDinners("On the meal plan.\nWed, Oct 7: Tacos\nThu, Oct 8: Pizza", monday), []);
  assert.deepEqual(proposedDinners("Wed, Oct 7: Tacos\nThu, Oct 8: Pizza\nReply yes to put these on the meal plan.", monday), [
    { date: "2026-10-07", name: "Tacos" },
    { date: "2026-10-08", name: "Pizza" },
  ]);
  assert.equal(wantsDinnerPlan("plan dinners for the week"), true);
  assert.equal(wantsDinnerPlan("what's for dinner"), false);
});

test("a week of dinners uses saved meals and skips a night that already has one", () => {
  const friday = new Date(2026, 9, 2);
  const picks = dinnersFromSaved(
    [{ id: "a", name: "Tacos" }, { id: "b", name: "Pasta" }],
    [{ date: "2026-10-02", slot: "dinner" }],
    friday,
  );
  assert.deepEqual(picks, [
    { date: "2026-10-03", name: "Tacos" },
    { date: "2026-10-04", name: "Pasta" },
  ]);
  const named = withSavedMeals([{ date: "2026-10-02", name: "pasta" }], [{ name: "Pasta" }], [{ date: "2026-10-02", slot: "dinner", name: "Soup" }]);
  assert.equal(named[0].name, "Pasta");
  assert.equal(named[0].replaces, "Soup");
  assert.match(dinnerPlanReply(named), /Reply yes to put these on the meal plan/);
  const ideas = MEAL_IDEAS.filter((idea) => idea.mealType === "dinner");
  const week = dinnersForTheWeek([], [], new Date(2026, 9, 5));
  assert.equal(week.length, 7);
  assert.equal(week[0].date, "2026-10-05");
  assert.equal(week[0].name, ideas[5 % ideas.length].name);
  const withSaved = dinnersForTheWeek([{ id: "a", name: "Pasta" }], [], new Date(2026, 9, 5));
  assert.equal(withSaved[0].name, "Pasta");
  assert.equal(withSaved.length, 7);
});
