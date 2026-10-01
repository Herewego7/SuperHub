import assert from "node:assert/strict";
import test from "node:test";
import { claimPlanSend, planBody, pushesForProfile } from "../src/scheduler/eveningPlan.ts";

test("a profile with a plan time does not also receive a daily brief", () => {
  const kinds = pushesForProfile({ planTime: "19:00", dailyBriefTime: "07:30" });
  assert.deepEqual(kinds, ["evening-plan"]);
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
    chores: [
      { title: "Permission slip", taskType: "todo", category: "school_email" },
      { title: "Feed the dog", taskType: "chore", category: "pets" },
    ],
    events: [],
    dinner: "Tacos",
  });
  assert.equal(body.includes("Permission slip"), false);
  assert.equal(body.includes("Feed the dog"), true);
  assert.equal(body.includes("Tacos"), true);
});
