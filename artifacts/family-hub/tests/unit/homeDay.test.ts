import assert from "node:assert/strict";
import test from "node:test";
import { choreProgress, choresForCount, dinnerName, horizonEvents, schoolEmailNames, todosForHome, visibleForProfiles } from "../../src/lib/homeDay";

const shared = { id: "study", taskType: "todo", profileIds: ["liam", "parent"], isActive: true };
const liamOnly = { id: "liam-pack", taskType: "todo", profileIds: ["liam"], isActive: true };

test("a shared to-do with two people is one record", () => {
  const both = todosForHome([shared], ["liam", "parent"], ["liam", "parent"]);
  assert.equal(both.length, 1);
  assert.equal(both[0].id, "study");
  const justLiam = todosForHome([shared, liamOnly], ["liam"], ["liam", "parent"]);
  assert.deepEqual(justLiam.map((todo) => todo.id), ["study", "liam-pack"]);
});

test("All Family keeps shared to-dos and drops personal ones", () => {
  const all = todosForHome([shared, liamOnly], ["liam", "parent"], ["liam", "parent"]);
  assert.deepEqual(all.map((todo) => todo.id), ["study"]);
});

test("chore progress counts a shared chore once", () => {
  const day = new Date(2026, 9, 1);
  const progress = choreProgress(
    [{ id: "dishes", taskType: "chore", profileIds: ["liam", "parent"], isActive: true, daysOfWeek: [4], recurrenceType: null }],
    [{ choreId: "dishes", completedAt: day }],
    day,
  );
  assert.deepEqual(progress, { done: 1, total: 1 });
});

test("one person's chore count leaves out someone else's chore", () => {
  const day = new Date(2026, 9, 1);
  const rows = [
    { id: "liam", taskType: "chore", profileIds: ["liam"], isActive: true, daysOfWeek: [4], recurrenceType: null },
    { id: "parent", taskType: "chore", profileIds: ["parent"], isActive: true, daysOfWeek: [4], recurrenceType: null },
  ];
  const one = choreProgress(choresForCount(rows, ["liam"], ["liam", "parent"]), [], day);
  const all = choreProgress(choresForCount(rows, ["liam", "parent"], ["liam", "parent"]), [], day);
  assert.deepEqual(one, { done: 0, total: 1 });
  assert.deepEqual(all, { done: 0, total: 2 });
});

test("horizon skips a weekly routine and keeps a one-off next week", () => {
  const today = new Date(2026, 9, 1);
  const rows = horizonEvents(
    [
      { id: "practice", title: "Practice", startTime: new Date(2026, 9, 3), recurrenceType: "weekly" },
      { id: "recital", title: "Recital", startTime: new Date(2026, 9, 6), recurrenceType: null },
    ],
    today,
  );
  assert.deepEqual(rows.map((row) => row.id), ["recital"]);
});

test("a kid does not see a school email that does not name them", () => {
  assert.equal(schoolEmailNames({ title: "Permission slip", description: "Ava must return it", category: "school_email" }, "Ava"), true);
  assert.equal(schoolEmailNames({ title: "Picture day", description: "Thursday at 9", category: "school_email" }, "Ava"), false);
  assert.equal(schoolEmailNames({ title: "Pack lunch", description: null, category: "todo" }, "Ava"), true);
});

test("Chad's filter hides an event that is only for Liam", () => {
  const rows = visibleForProfiles(
    [{ title: "Practice", profileIds: ["liam"] }, { title: "Dinner", profileIds: [] }],
    ["chad"],
  );
  assert.deepEqual(rows.map((row) => row.title), ["Dinner"]);
});

test("dinner is the meal in that slot on that date", () => {
  assert.equal(dinnerName([{ date: "2026-10-01", slot: "dinner", name: "Tacos" }], new Date(2026, 9, 1)), "Tacos");
  assert.equal(dinnerName([{ date: "2026-10-02", slot: "dinner", name: "Soup" }], new Date(2026, 9, 1)), null);
});
