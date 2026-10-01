import assert from "node:assert/strict";
import test from "node:test";
import { planScheduleLabel } from "../../src/lib/eveningPlanLabel";

test("morning of names the morning time", () => {
  assert.equal(planScheduleLabel("07:30", "morningOf"), "Morning of, 07:30");
});

test("a blank plan time has no label", () => {
  assert.equal(planScheduleLabel(null, "eveningBefore"), null);
});
