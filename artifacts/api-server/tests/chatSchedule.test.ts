import assert from "node:assert/strict";
import test from "node:test";
import { scheduleTurn } from "../src/plan/chatSchedule.ts";

const now = new Date("2026-10-05T15:00:00Z");
const zone = "America/Chicago";
const liam = [{ id: "liam", name: "Liam" }];
const soccer = { id: "evt-1", title: "Soccer", startTime: "2026-10-07T21:00:00.000Z", source: "app" };

test("a calendar event asks for the day, the time, and who it is for, then the optional details", () => {
  const askDay = scheduleTurn("add soccer to the calendar", now, zone, liam, [], undefined);
  assert.equal(askDay?.kind, "ask");
  assert.match(askDay && askDay.kind === "ask" ? askDay.text : "", /What day should "soccer" be on/);
  const askTime = scheduleTurn("Wednesday", now, zone, liam, [], askDay?.kind === "ask" ? askDay.text : "");
  assert.match(askTime && askTime.kind === "ask" ? askTime.text : "", /What time should "soccer" start/);
  const askWho = scheduleTurn("4pm", now, zone, liam, [], askTime?.kind === "ask" ? askTime.text : "");
  assert.match(askWho && askWho.kind === "ask" ? askWho.text : "", /Who is "soccer" for/);
  const saved = scheduleTurn("Liam", now, zone, liam, [], askWho?.kind === "ask" ? askWho.text : "");
  assert.equal(saved?.kind, "create_event");
  if (saved?.kind !== "create_event") return;
  assert.equal(saved.title, "soccer");
  assert.equal(saved.start, "2026-10-07T21:00:00.000Z");
  assert.equal(saved.end, "2026-10-07T22:00:00.000Z");
  assert.deepEqual(saved.profileIds, ["liam"]);
  assert.match(saved.text, /On the calendar/);
  assert.match(saved.text, /driver, a place, a repeat, or a description/);
  const created = [{ id: "evt-soccer", title: "soccer", startTime: saved.start, source: "app", isAllDay: false, profileIds: ["liam"] }];
  const skipped = scheduleTurn("no", now, zone, liam, created, saved.text);
  assert.match(skipped && skipped.kind === "ask" ? skipped.text : "", /All set/);
  const added = scheduleTurn("Liam driving at the park every week, bring cleats", now, zone, liam, created, saved.text);
  assert.equal(added?.kind, "update_event");
  if (added?.kind !== "update_event") return;
  assert.deepEqual(added.drivingProfileIds, ["liam"]);
  assert.equal(added.location, "the park");
  assert.equal(added.recurrenceType, "weekly");
  assert.equal(added.description, "bring cleats");
  const unknown = scheduleTurn("Chad driving", now, zone, liam, created, saved.text, "Chad");
  assert.match(unknown && unknown.kind === "ask" ? unknown.text : "", /I don't see Chad/);
});

test("a complete chore sentence still asks how many stars, and a to-do is left alone", () => {
  const stars = scheduleTurn("add a chore dishes on Monday for Liam", now, zone, liam, [], undefined);
  assert.equal(stars?.kind, "ask");
  assert.match(stars && stars.kind === "ask" ? stars.text : "", /How many stars/);
  const chore = scheduleTurn("5", now, zone, liam, [], stars?.kind === "ask" ? stars.text : "");
  assert.equal(chore?.kind, "create_chore");
  if (chore?.kind !== "create_chore") return;
  assert.equal(chore.title, "dishes");
  assert.deepEqual(chore.daysOfWeek, [1]);
  assert.deepEqual(chore.profileIds, ["liam"]);
  assert.equal(chore.points, 5);
  assert.match(chore.text, /On the chore list/);
  assert.equal(scheduleTurn("add a to-do pack the bag", now, zone, liam, [], undefined), null);
  const named = scheduleTurn("add a chore dishes on Monday for Liam worth 2 stars", now, zone, liam, [], undefined);
  assert.equal(named?.kind, "create_chore");
  if (named?.kind === "create_chore") assert.equal(named.points, 2);
});

test("a chore asks for the days, the person, and the stars before it is saved", () => {
  const days = scheduleTurn("add a chore take out the trash", now, zone, liam, [], undefined);
  assert.match(days && days.kind === "ask" ? days.text : "", /Which days/);
  const who = scheduleTurn("Monday and Wednesday", now, zone, liam, [], days?.kind === "ask" ? days.text : "");
  assert.match(who && who.kind === "ask" ? who.text : "", /Who should do the chore/);
  const stars = scheduleTurn("Liam", now, zone, liam, [], who?.kind === "ask" ? who.text : "");
  assert.match(stars && stars.kind === "ask" ? stars.text : "", /How many stars/);
  const saved = scheduleTurn("3 stars", now, zone, liam, [], stars?.kind === "ask" ? stars.text : "");
  assert.equal(saved?.kind, "create_chore");
  if (saved?.kind !== "create_chore") return;
  assert.deepEqual(saved.daysOfWeek, [1, 3]);
  assert.deepEqual(saved.profileIds, ["liam"]);
  assert.equal(saved.points, 3);
});

test("a name that is not in the app is sent back with the real names", () => {
  const family = [{ id: "dad", name: "Dad" }, { id: "liam", name: "Liam" }];
  const days = scheduleTurn("add a chore take out the trash", now, zone, family, [], undefined);
  const who = scheduleTurn("Monday", now, zone, family, [], days?.kind === "ask" ? days.text : "");
  assert.match(who && who.kind === "ask" ? who.text : "", /I can assign Dad, Liam, everyone, or no one/);
  const chad = scheduleTurn("assign it to Chad", now, zone, family, [], who?.kind === "ask" ? who.text : "", "Chad");
  assert.match(chad && chad.kind === "ask" ? chad.text : "", /I don't see Chad/);
  assert.match(chad && chad.kind === "ask" ? chad.text : "", /Dad, Liam/);
  const mine = scheduleTurn("assign it to me", now, zone, family, [], chad?.kind === "ask" ? chad.text : "", "Chad");
  assert.match(mine && mine.kind === "ask" ? mine.text : "", /I don't see Chad/);
  const saved = scheduleTurn("Dad", now, zone, family, [], mine?.kind === "ask" ? mine.text : "", "Chad");
  assert.match(saved && saved.kind === "ask" ? saved.text : "", /How many stars/);
  assert.match(saved && saved.kind === "ask" ? saved.text : "", /for Dad/);
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
