import assert from "node:assert/strict";
import test from "node:test";
import { assignChange, checkOffTitle, createEventTitle, createTodoTitle, dayReply, deleteEventTitle, drivingReply, familyCalendarOffer, importedEventNeedsConfirm, moveEventWhen, pointsProfileId, schoolFact, toolsForRole } from "../../src/lib/chatTools";

test("a kid tool list excludes inbox search", () => {
  const tools = toolsForRole(true);
  assert.equal(tools.includes("search"), false);
  assert.equal(tools.includes("get_newsletters"), false);
  assert.equal(tools.includes("complete_task"), true);
});

test("a parent tool list includes inbox search", () => {
  assert.equal(toolsForRole(false).includes("search"), true);
});

test("move names the event and the clock", () => {
  assert.deepEqual(moveEventWhen("move Soccer to 4:30 pm"), { title: "Soccer", hours: 16, minutes: 30 });
  assert.equal(moveEventWhen("assign Buy milk to Liam"), null);
});

test("assign names the to-do and the person", () => {
  const chores = [{ id: "milk", title: "Buy milk" }];
  const profiles = [{ id: "liam", name: "Liam" }];
  const change = assignChange("assign Buy milk to Liam", chores, profiles);
  assert.deepEqual(change, { choreId: "milk", profileIds: ["liam"], reply: "Buy milk is assigned to Liam." });
  assert.equal(assignChange("hello", chores, profiles), null);
});

test("add a to-do names the task", () => {
  assert.equal(createTodoTitle("add a to-do Buy milk"), "Buy milk");
  assert.equal(createTodoTitle("add event Soccer"), null);
});

test("a new event is offered to the family calendar", () => {
  assert.equal(createEventTitle("add event Soccer practice"), "Soccer practice");
  assert.equal(familyCalendarOffer("family@group.calendar.google.com"), "family@group.calendar.google.com");
  assert.equal(familyCalendarOffer("none"), null);
});

test("a check-off credits the person on screen", () => {
  assert.equal(pointsProfileId(["liam", "ava"], "liam"), "liam");
  assert.equal(pointsProfileId(["liam"], "family"), "liam");
});

test("check off names the chore", () => {
  assert.equal(checkOffTitle("check off dishes"), "dishes");
  assert.equal(checkOffTitle("Who is driving soccer?"), null);
});

test("what's the plan names the day and dinner", () => {
  const day = new Date(2026, 9, 1, 15, 0);
  const reply = dayReply("what's the plan?", {
    chores: [
      { id: "dog", title: "Feed the dog", taskType: "chore", recurrenceType: "daily" },
      { id: "mow", title: "Mow the lawn", taskType: "chore", daysOfWeek: [0] },
      { id: "done", title: "Dishes", taskType: "chore", recurrenceType: "daily" },
      { id: "milk", title: "Buy milk", taskType: "todo" },
    ],
    completions: [{ choreId: "done", completedAt: day }],
    events: [{ title: "Soccer", startTime: day }],
    dinner: "Tacos",
    day,
  });
  assert.equal(reply, "Feed the dog\nBuy milk\nSoccer\nDinner. Tacos");
  assert.equal(dayReply("hello", { chores: [], events: [], dinner: null, day }), null);
});

test("an adult can name a person's school", () => {
  const fact = schoolFact("Liam's school is Lincoln.", [{ id: "liam", name: "Liam" }]);
  assert.deepEqual(fact, { profileId: "liam", name: "Liam", school: "Lincoln" });
  assert.equal(schoolFact("school is Lincoln", [{ id: "liam", name: "Liam" }]), null);
});

test("who is driving names the person on that event", () => {
  const reply = drivingReply(
    "Who is driving soccer?",
    [{ title: "Soccer", drivingProfileIds: ["chad"] }],
    [{ id: "chad", name: "Chad" }],
  );
  assert.equal(reply, "Chad is driving Soccer.");
  assert.equal(drivingReply("Who is driving piano?", [], []), "I don't see piano.");
});

test("deleting an imported event asks first", () => {
  assert.equal(deleteEventTitle("delete the soccer game"), "soccer game");
  assert.equal(importedEventNeedsConfirm("ics"), true);
  assert.equal(importedEventNeedsConfirm("meal"), false);
  assert.equal(importedEventNeedsConfirm(null), false);
});
