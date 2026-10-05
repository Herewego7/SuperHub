import assert from "node:assert/strict";
import test from "node:test";
import { groceriesToAdd, groceryRequest, matchMeal, splitIngredient } from "../src/meals/mealMatch.ts";

test("a spoken dish uses a saved meal before Browse Meal Ideas", () => {
  const saved = matchMeal("tacos", [{ name: "Tacos", ingredients: [{ item: "Tortillas", quantity: null }] }]);
  assert.equal(saved?.source, "saved");
  assert.equal(saved?.ingredients[0].item, "Tortillas");
  const idea = matchMeal("sheet pan chicken fajitas");
  assert.equal(idea?.source, "ideas");
  assert.equal(idea?.name, "Sheet Pan Chicken Fajitas");
  assert.ok(idea?.ingredients.some((row) => row.item === "Tortillas"));
  assert.equal(matchMeal("not a real dish"), null);
});

test("ingredient text splits a quantity off the item", () => {
  assert.deepEqual(splitIngredient("1.5 lb ground beef"), { quantity: "1.5 lb", item: "ground beef" });
  assert.deepEqual(splitIngredient("Tortillas"), { quantity: null, item: "Tortillas" });
});

test("groceries already on the list are not added again", () => {
  assert.deepEqual(
    groceriesToAdd(
      [{ item: "Tortillas", quantity: null }, { item: "Onion", quantity: "1" }],
      [{ name: "tortillas" }],
    ),
    [{ name: "Onion", quantity: "1" }],
  );
});

test("grocery sentences read, add, remove, and pull a meal's ingredients", () => {
  assert.equal(groceryRequest("what's on the grocery list")?.kind, "list");
  assert.deepEqual(groceryRequest("add milk and eggs to the grocery list"), {
    kind: "add",
    items: [{ name: "milk", quantity: null }, { name: "eggs", quantity: null }],
  });
  assert.deepEqual(groceryRequest("take bread off the shopping list"), { kind: "remove", names: ["bread"] });
  assert.equal(groceryRequest("add the ingredients for fajitas to the grocery list")?.kind, "ingredients");
  assert.equal(groceryRequest("let's do tacos on wednesday"), null);
});
