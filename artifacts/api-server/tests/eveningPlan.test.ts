import assert from "node:assert/strict";
import test from "node:test";
import { choresForPlan, claimPlanSend, dueForPlan, eventClockTitle, moveClock, planBody, planKeysForClaim, planOpenPath, planTitle, pushesForProfile } from "../src/scheduler/eveningPlan.ts";

test("a morning plan is titled for today", () => {
  assert.equal(planTitle(false, "morningOf"), "Today's plan");
  assert.equal(planTitle(true, "eveningBefore"), "Tomorrow");
});

test("a profile with a plan time does not also receive a daily brief", () => {
  const kinds = pushesForProfile({ planTime: "19:00", dailyBriefTime: "07:30" });
  assert.deepEqual(kinds, ["evening-plan"]);
});

test("two people claimed together both stay sent", () => {
  const saved = planKeysForClaim(["dad:2026-10-02"], ["dad:2026-10-02"]);
  const second = claimPlanSend(planKeysForClaim([], saved), "kid", "2026-10-02");
  assert.deepEqual(second.sentKeys, ["dad:2026-10-02", "kid:2026-10-02"]);
});

test("tomorrow's plan skips a chore that is not due then", () => {
  const thursday = new Date(2026, 9, 1, 12, 0);
  const rows = dueForPlan(
    [
      { id: "dog", title: "Feed the dog", taskType: "chore", recurrenceType: "daily" },
      { id: "mow", title: "Mow", taskType: "chore", daysOfWeek: [6] },
      { id: "milk", title: "Buy milk", taskType: "todo" },
    ],
    thursday,
  );
  assert.deepEqual(rows.map((row) => row.id), ["dog", "milk"]);
});

test("a finished to-do stays out of tomorrow's plan", () => {
  const rows = choresForPlan(
    [
      { id: "milk", title: "Buy milk", taskType: "todo", profileIds: ["liam"] },
      { id: "dog", title: "Feed the dog", taskType: "chore", profileIds: ["liam"] },
    ],
    [],
    "liam",
    ["milk"],
  );
  assert.deepEqual(rows.map((row) => row.id), ["dog"]);
});

test("the plan keeps this person's open chores", () => {
  const rows = choresForPlan(
    [
      { id: "dog", title: "Feed the dog", profileIds: ["liam"] },
      { id: "done", title: "Dishes", profileIds: ["liam"] },
      { id: "dad", title: "Pay the bill", profileIds: ["chad"] },
    ],
    ["done"],
    "liam",
  );
  assert.deepEqual(rows.map((row) => row.id), ["dog"]);
});

test("dinner stays in the plan when the list is long", () => {
  const body = planBody({
    isChild: false,
    chores: [
      { title: "One", taskType: "chore" },
      { title: "Two", taskType: "chore" },
      { title: "Three", taskType: "chore" },
      { title: "Four", taskType: "chore" },
      { title: "Five", taskType: "chore" },
      { title: "Six", taskType: "chore" },
    ],
    events: [],
    dinner: "Tacos",
  });
  assert.equal(body.includes("Dinner. Tacos"), true);
  assert.equal(body.includes("Six"), false);
});

test("a second run the same day does not send again", () => {
  const first = claimPlanSend([], "chad", "2026-10-02");
  const second = claimPlanSend(first.sentKeys, "chad", "2026-10-02");
  assert.equal(first.send, true);
  assert.equal(second.send, false);
});

test("a kid plan leaves out a school email line", () => {
  const body = planBody({
    isChild: true,
    kidName: "Ava",
    chores: [
      { title: "Permission slip", description: "Bring it back", taskType: "todo", category: "school_email" },
      { title: "Ava's slip", description: "Ava must return it", taskType: "todo", category: "school_email" },
      { title: "Feed the dog", taskType: "chore", category: "pets" },
    ],
    events: [
      { title: "Picture day", source: "school" },
      { title: "Ava concert", description: "Ava sings", source: "school" },
    ],
    dinner: "Tacos",
  });
  assert.equal(body.includes("Permission slip"), false);
  assert.equal(body.includes("Picture day"), false);
  assert.equal(body.includes("Ava's slip"), true);
  assert.equal(body.includes("Ava concert"), true);
  assert.equal(body.includes("Feed the dog"), true);
  assert.equal(body.includes("Tacos"), true);
});

test("a changed start keeps the old clock time", () => {
  const previous = new Date(2026, 9, 2, 16, 0);
  const next = new Date(2026, 9, 2, 17, 30);
  assert.equal(moveClock(previous, next), "4:00 PM");
  assert.equal(moveClock(previous, previous), null);
});

test("a plan event names its clock in the family timezone", () => {
  assert.equal(eventClockTitle("Soccer", new Date("2026-10-02T21:00:00Z"), "America/Chicago"), "Soccer, 4:00 PM");
  assert.equal(eventClockTitle("Picture day", new Date("2026-10-02T05:00:00Z"), "America/Chicago"), "Picture day");
  assert.equal(eventClockTitle("Picture day", new Date("2026-10-02T00:00:00Z"), "America/Chicago", true), "Picture day");
});

test("a moved event names the old time", () => {
  const body = planBody({
    isChild: false,
    chores: [],
    events: [{ title: "Soccer", movedFrom: "4:00 PM" }],
  });
  assert.equal(body.includes("Soccer moved from 4:00 PM"), true);
});

test("the plan link opens chat with the dinner line", () => {
  const path = planOpenPath("Feed the dog\nDinner. Tacos", "liam");
  const params = new URLSearchParams(path.slice(path.indexOf("?")));
  assert.equal(params.get("openTab"), "chat");
  assert.equal(params.get("openProfile"), "liam");
  assert.equal(params.get("openPlan")?.includes("Dinner. Tacos"), true);
});
