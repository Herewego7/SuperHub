import assert from "node:assert/strict";
import test from "node:test";
import { bumpUnread, chatOwner, clearedUnread, pendingAfterPlan, pendingConfirmFrom, threadWithPlan, unreadCount, unreadFor } from "../../src/lib/chatThread";

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
  const again = threadWithPlan(thread, "Tomorrow's plan\nDinner. Tacos", "Who is driving soccer?");
  assert.deepEqual(again.map((bubble) => bubble.text), thread.map((bubble) => bubble.text));
});

test("a new notification reply is answered once", () => {
  const before = [{ id: "old", role: "user" as const, text: "Earlier" }];
  const after = threadWithPlan(before, "Tomorrow's plan\nDinner. Tacos", "Who is driving soccer?");
  assert.equal(pendingAfterPlan(before.length, after, "Who is driving soccer?"), "Who is driving soccer?");
  assert.equal(pendingAfterPlan(after.length, threadWithPlan(after, "Tomorrow's plan\nDinner. Tacos", "Who is driving soccer?"), "Who is driving soccer?"), null);
  assert.equal(pendingAfterPlan(before.length, threadWithPlan(before, "Tomorrow's plan\nDinner. Tacos"), null), null);
});

test("unread stays on the person it was sent to", () => {
  const raw = bumpUnread(null, "liam");
  assert.equal(unreadFor(raw, "liam"), 1);
  assert.equal(unreadFor(raw, "chad"), 0);
  assert.equal(unreadFor(clearedUnread(raw, "liam"), "liam"), 0);
  assert.equal(unreadFor("2", "chad"), 2);
});

test("a yes still knows which outside event after chat closes", () => {
  assert.deepEqual(pendingConfirmFrom(JSON.stringify({ kind: "delete", id: "soccer" })), { kind: "delete", id: "soccer" });
  assert.deepEqual(pendingConfirmFrom(JSON.stringify({ kind: "delete", id: "soccer", path: "/api/google-calendar/events/dad/cal/abc" })), { kind: "delete", id: "soccer", path: "/api/google-calendar/events/dad/cal/abc" });
  assert.deepEqual(pendingConfirmFrom(JSON.stringify({ kind: "move", id: "soccer", start: "a", end: "b" })), { kind: "move", id: "soccer", start: "a", end: "b" });
  assert.equal(pendingConfirmFrom("nope"), null);
  assert.equal(pendingConfirmFrom(null), null);
});

test("a seeded unread reply is a badge count", () => {
  assert.equal(unreadCount("1"), 1);
  assert.equal(unreadCount("no"), 0);
  assert.equal(unreadCount(null), 0);
});

// Each set of picked people has its own chat; the tab now says whose (2026-10-21).
test("the chat says whose it is", () => {
  const mom = { id: "m", name: "Mom", color: "#f00" };
  const ava = { id: "a", name: "Ava", color: "#0f0" };
  const ben = { id: "b", name: "Ben", color: "#00f" };
  const dad = { id: "d", name: "Dad", color: "#000" };
  const family = { id: "f", name: "All Family", color: "#888", isAllFamilyProfile: true };
  assert.deepEqual(chatOwner([mom]), { family: false, title: "Mom's chat", forWhom: "Mom", intro: "This is Mom's chat. Pick someone else at the top to see their chat." });
  assert.equal(chatOwner([mom, ava]).title, "Mom and Ava's chat");
  assert.equal(chatOwner([mom, ava, ben]).forWhom, "Mom, Ava and Ben");
  assert.equal(chatOwner([mom, ava, ben, dad]).title, "Chat for 4 people");
  assert.equal(chatOwner([family]).title, "Family chat");
  assert.equal(chatOwner([]).forWhom, "the family");
});
