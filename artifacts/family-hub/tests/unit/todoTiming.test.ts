import assert from "node:assert/strict";
import test from "node:test";
import { hardCutoff, INBOX_UNDATED_DAYS, overWhenFound, taskTypeOf, todoPlace } from "../../src/lib/todoTiming";

test("an item's type comes from its saved Type line, else from its words", () => {
  assert.equal(taskTypeOf("RSVP for the game", "From: a@b.org\nPlan: todo\nType: sign_form\n"), "sign_form", "the saved type wins");
  assert.equal(taskTypeOf("Decide: RSVP for Jett's flag football game"), "rsvp");
  assert.equal(taskTypeOf("Gluten-free sack lunch", "Bring Gluten-free sack lunch."), "bring");
  assert.equal(taskTypeOf("Formal Uniform", "Optional Formal Uniform Day for pictures"), "wear");
  assert.equal(taskTypeOf("Sign the zoo trip form"), "sign_form");
  assert.equal(taskTypeOf("Pay the field trip fee"), "pay");
  assert.equal(taskTypeOf("Dentist appointment prep"), "prepare");
  assert.equal(taskTypeOf("Respond to Roderick Lee's LinkedIn invitation"), "other");
});

test("undated inbox items stay two days; typed ones stay", () => {
  const undated = (sentDaysAgo: number | null, inbox = true) => todoPlace({ type: "other", inbox, dueIn: null, viewingToday: true, sentDaysAgo, cutoff: false });
  assert.equal(undated(0), "show");
  assert.equal(undated(INBOX_UNDATED_DAYS), "show");
  assert.equal(undated(INBOX_UNDATED_DAYS + 1), "cleared");
  assert.equal(undated(30), "hidden", "too old to mention");
  assert.equal(undated(30, false), "show", "a to-do someone typed stays");
  assert.equal(todoPlace({ type: "other", inbox: true, dueIn: null, viewingToday: false, sentDaysAgo: 0, cutoff: false }), "hidden", "undated items are today's only");
});

test("dated items show a little before they're due, by type, and leave by type", () => {
  const place = (type: Parameters<typeof todoPlace>[0]["type"], dueIn: number, cutoff = false) => todoPlace({ type, inbox: true, dueIn, viewingToday: true, sentDaysAgo: 1, cutoff });
  assert.equal(place("rsvp", 3), "hidden", "three days out is the Horizon's");
  assert.equal(place("rsvp", 2), "show");
  assert.equal(place("bring", 2), "hidden");
  assert.equal(place("bring", 1), "show", "the day before");
  assert.equal(place("rsvp", -1), "late");
  assert.equal(place("rsvp", -2), "cleared");
  assert.equal(place("bring", -1), "cleared", "a sack lunch is over when its day is");
  assert.equal(place("other", -1, true), "cleared", "a last-day offer can't be done late");
});

test("a deadline already missed when the mail was read is never added", () => {
  const readAt = new Date(2026, 9, 20, 9);
  assert.equal(overWhenFound(new Date(2026, 9, 9), new Date(2026, 9, 2), readAt), true);
  assert.equal(overWhenFound(new Date(2026, 9, 19, 12), new Date(2026, 9, 2), readAt), false, "a day late may still get done");
  assert.equal(overWhenFound(new Date(2026, 9, 9), new Date(2026, 9, 20, 8), readAt), false, "a fresh late notice still counts");
  assert.equal(hardCutoff("Today is the last day to order yearbooks"), true);
  assert.equal(hardCutoff("Return the form by Friday"), false);
});
