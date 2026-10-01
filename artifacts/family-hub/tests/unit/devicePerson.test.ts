import assert from "node:assert/strict";
import test from "node:test";
import { devicePersonIds } from "../../src/lib/devicePerson";

const family = [
  { id: "chad", role: "adult" },
  { id: "liam", role: "child", isChild: true },
];

test("a device with no choice starts on the first adult", () => {
  assert.deepEqual(devicePersonIds(null, family), ["chad"]);
});

test("a saved person stays selected and All stays everyone", () => {
  assert.deepEqual(devicePersonIds("liam", family), ["liam"]);
  assert.deepEqual(devicePersonIds("all", family), ["chad", "liam"]);
});
