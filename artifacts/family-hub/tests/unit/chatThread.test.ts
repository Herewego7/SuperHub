import assert from "node:assert/strict";
import test from "node:test";
import { threadWithPlan, unreadCount } from "../../src/lib/chatThread";

test("a notification reply sits under the plan", () => {
  const thread = threadWithPlan(
    [{ id: "old", role: "user", text: "Earlier" }],
    "Tomorrow's plan\nDinner. Tacos",
    "Who is driving soccer?",
  );
  assert.deepEqual(thread.map((bubble) => bubble.text), [
    "Earlier",
    "Tomorrow's plan\nDinner. Tacos",
    "Who is driving soccer?",
  ]);
});

test("a seeded unread reply is a badge count", () => {
  assert.equal(unreadCount("1"), 1);
  assert.equal(unreadCount("no"), 0);
  assert.equal(unreadCount(null), 0);
});
