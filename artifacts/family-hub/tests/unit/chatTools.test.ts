import assert from "node:assert/strict";
import test from "node:test";
import { checkOffTitle, createEventTitle, deleteEventTitle, drivingReply, familyCalendarOffer, importedEventNeedsConfirm, pointsProfileId, toolsForRole } from "../../src/lib/chatTools";

test("a kid tool list excludes inbox search", () => {
  const tools = toolsForRole(true);
  assert.equal(tools.includes("search"), false);
  assert.equal(tools.includes("get_newsletters"), false);
  assert.equal(tools.includes("complete_task"), true);
});

test("a parent tool list includes inbox search", () => {
  assert.equal(toolsForRole(false).includes("search"), true);
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
