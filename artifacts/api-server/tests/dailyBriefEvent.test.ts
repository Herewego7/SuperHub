import assert from "node:assert/strict";
import test from "node:test";
import { briefListsEvent, briefShowsForKid, choresNamedForKid } from "../src/lib/dailyBrief.ts";

test("a calendar dinner is not also counted as an event in the brief", () => {
  assert.equal(briefListsEvent({ source: "meal" }, true), false);
  assert.equal(briefListsEvent({ source: "meal" }, false), true);
  assert.equal(briefListsEvent({ source: "app" }, true), true);
});

test("a kid's brief hides school mail that does not name them", () => {
  assert.equal(briefShowsForKid({ title: "Picture day", source: "school" }, "Sam"), false);
  assert.equal(briefShowsForKid({ title: "Sam has picture day", source: "school" }, "Sam"), true);
  assert.equal(briefShowsForKid({ title: "Bring a form", category: "school_email" }, "Sam"), false);
  assert.equal(briefShowsForKid({ title: "Soccer", source: "app" }, "Sam"), true);
  assert.equal(briefShowsForKid({ title: "Picture day", source: "school" }, null), true);
});

test("a kid's bedtime count drops a school chore that does not name them", () => {
  const due = [
    { title: "Make bed", category: "chore" },
    { title: "Picture day form", category: "school_email" },
    { title: "Sam, bring the form", category: "school_email" },
  ];
  assert.deepEqual(
    choresNamedForKid(due, "Sam").map((row) => row.title),
    ["Make bed", "Sam, bring the form"],
  );
  assert.equal(choresNamedForKid(due, null).length, 3);
});
