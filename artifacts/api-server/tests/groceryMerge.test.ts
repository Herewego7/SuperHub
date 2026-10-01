// Regression coverage for lib/groceryMerge.ts — the 2026-07 fix where
// "2 cups" + "1 cup" produced the nonsensical "2 cups (x2)" instead of
// "3 cups" (the old code never actually summed the incoming amount).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGroceryQuantities } from "../src/lib/groceryMerge";

test("matching units sum the amounts", () => {
  assert.equal(mergeGroceryQuantities("2 cups", "1 cup"), "3 cup");
});

test("unit aliases are normalized before comparing (tbsp/tablespoons/tbs all match)", () => {
  assert.equal(mergeGroceryQuantities("1 tablespoon", "2 tbsp"), "3 tbsp");
  assert.equal(mergeGroceryQuantities("1 tbs", "1 tbsp"), "2 tbsp");
});

test("fractional amounts are parsed and summed", () => {
  assert.equal(mergeGroceryQuantities("1/2 cup", "1/2 cup"), "1 cup");
});

test("mismatched units fall back to concatenation, not a bogus sum", () => {
  assert.equal(mergeGroceryQuantities("2 cups", "1 tbsp"), "2 cups + 1 tbsp");
});

test("identical non-numeric strings fall back to the old (x2) marker", () => {
  assert.equal(mergeGroceryQuantities("a pinch", "a pinch"), "a pinch (x2)");
});

test("null existing just takes the incoming value", () => {
  assert.equal(mergeGroceryQuantities(null, "2 cups"), "2 cups");
});

test("null incoming just keeps the existing value", () => {
  assert.equal(mergeGroceryQuantities("2 cups", null), "2 cups");
});

test("both null returns null", () => {
  assert.equal(mergeGroceryQuantities(null, null), null);
});

test("bare numbers with no unit still sum", () => {
  assert.equal(mergeGroceryQuantities("2", "3"), "5");
});
