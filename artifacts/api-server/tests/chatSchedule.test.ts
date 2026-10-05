import assert from "node:assert/strict";
import test from "node:test";
import { scheduleTurn } from "../src/plan/chatSchedule.ts";

const now = new Date("2026-10-05T15:00:00Z");
const zone = "America/Chicago";
const liam = [{ id: "liam", name: "Liam" }];
const soccer = { id: "evt-1", title: "Soccer", startTime: "2026-10-07T21:00:00.000Z", source: "app" };

test("a calendar event asks for the day and the time before it is saved", () => {
  const askDay = scheduleTurn("add soccer to the calendar", now, zone, liam, [], undefined);
  assert.equal(askDay?.kind, "ask");
  assert.match(askDay && askDay.kind === "ask" ? askDay.text : "", /What day should "soccer" be on/);
  const askTime = scheduleTurn("Wednesday", now, zone, liam, [], askDay?.kind === "ask" ? askDay.text : "");
  assert.match(askTime && askTime.kind === "ask" ? askTime.text : "", /What time should "soccer" start/);
  const saved = scheduleTurn("4pm", now, zone, liam, [], askTime?.kind === "ask" ? askTime.text : "");
  assert.equal(saved?.kind, "create_event");
  if (saved?.kind !== "create_event") return;
  assert.equal(saved.title, "soccer");
  assert.equal(saved.start, "2026-10-07T21:00:00.000Z");
  assert.equal(saved.end, "2026-10-07T22:00:00.000Z");
  assert.match(saved.text, /On the calendar/);
});

test("a complete chore sentence is a chore, and a to-do is left alone", () => {
  const chore = scheduleTurn("add a chore dishes on Monday for Liam", now, zone, liam, [], undefined);
  assert.equal(chore?.kind, "create_chore");
  if (chore?.kind !== "create_chore") return;
  assert.equal(chore.title, "dishes");
  assert.deepEqual(chore.daysOfWeek, [1]);
  assert.deepEqual(chore.profileIds, ["liam"]);
  assert.match(chore.text, /On the chore list/);
  assert.equal(scheduleTurn("add a to-do pack the bag", now, zone, liam, [], undefined), null);
});

test("a chore without days or a person is asked, then saved", () => {
  const days = scheduleTurn("add a chore take out the trash", now, zone, liam, [], undefined);
  assert.match(days && days.kind === "ask" ? days.text : "", /Which days/);
  const who = scheduleTurn("Monday and Wednesday", now, zone, liam, [], days?.kind === "ask" ? days.text : "");
  assert.match(who && who.kind === "ask" ? who.text : "", /Who should do the chore/);
  const saved = scheduleTurn("Liam", now, zone, liam, [], who?.kind === "ask" ? who.text : "");
  assert.equal(saved?.kind, "create_chore");
  if (saved?.kind !== "create_chore") return;
  assert.deepEqual(saved.daysOfWeek, [1, 3]);
  assert.deepEqual(saved.profileIds, ["liam"]);
});

test("removing a calendar event waits for yes, and an outside event stays put", () => {
  const ask = scheduleTurn("remove soccer from the calendar", now, zone, liam, [soccer], undefined);
  assert.match(ask && ask.kind === "ask" ? ask.text : "", /Reply yes to delete it/);
  const removed = scheduleTurn("yes", now, zone, liam, [soccer], ask?.kind === "ask" ? ask.text : "");
  assert.equal(removed?.kind, "delete_event");
  if (removed?.kind === "delete_event") assert.equal(removed.eventId, "evt-1");
  const google = scheduleTurn("delete the event soccer", now, zone, liam, [{ ...soccer, source: "google" }], undefined);
  assert.match(google && google.kind === "ask" ? google.text : "", /Google Calendar/);
});
