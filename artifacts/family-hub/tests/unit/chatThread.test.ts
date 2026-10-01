import assert from "node:assert/strict";
import test from "node:test";
import { bumpUnread, clearedUnread, threadWithPlan, unreadCount, unreadFor } from "../../src/lib/chatThread";

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

test("unread stays on the person it was sent to", () => {
  const raw = bumpUnread(null, "liam");
  assert.equal(unreadFor(raw, "liam"), 1);
  assert.equal(unreadFor(raw, "chad"), 0);
  assert.equal(unreadFor(clearedUnread(raw, "liam"), "liam"), 0);
  assert.equal(unreadFor("2", "chad"), 2);
});

test("a seeded unread reply is a badge count", () => {
  assert.equal(unreadCount("1"), 1);
  assert.equal(unreadCount("no"), 0);
  assert.equal(unreadCount(null), 0);
});
