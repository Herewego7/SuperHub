import assert from "node:assert/strict";
import test from "node:test";
import { contrastText, EVENT_FALLBACK_COLOR, eventColor, eventStrip, forEveryone } from "../../src/lib/eventColor";

const people = [
  { id: "family", color: "#7C5CBF", isAllFamilyProfile: true },
  { id: "mom", color: "#E07A5F" },
  { id: "dad", color: "#3D85C6" },
  { id: "linnea", color: "#F2B134" },
];

test("an event takes its person's color before its calendar's", () => {
  assert.equal(eventColor({ profileIds: ["linnea"], calendarColor: "#039BE5" }, people), "#F2B134");
  assert.equal(eventColor({ profileIds: ["dad", "mom"], calendarColor: "#039BE5" }, people), "#E07A5F");
});

test("an event for everyone takes the All Family color", () => {
  assert.equal(eventColor({ profileIds: ["mom", "dad", "linnea"] }, people), "#7C5CBF");
  assert.equal(eventColor({ profileIds: ["family"] }, people), "#7C5CBF");
  assert.equal(forEveryone(["mom", "dad"], people), false);
  assert.equal(forEveryone(["mom"], [{ id: "mom", color: "#E07A5F" }]), false);
});

test("an event with nobody on it keeps its calendar's color", () => {
  assert.equal(eventColor({ profileIds: [], calendarColor: "#039BE5" }, people), "#039BE5");
  assert.equal(eventColor({ profileIds: null }, people), EVENT_FALLBACK_COLOR);
});

test("a shared event shows each person in the strip, and everyone is one color", () => {
  assert.deepEqual(eventStrip({ profileIds: ["dad", "mom"] }, people), ["#E07A5F", "#3D85C6"]);
  assert.deepEqual(eventStrip({ profileIds: ["linnea"] }, people), ["#F2B134"]);
  assert.deepEqual(eventStrip({ profileIds: ["mom", "dad", "linnea"] }, people), ["#7C5CBF"]);
  assert.deepEqual(eventStrip({ profileIds: [], calendarColor: "#039BE5" }, people), ["#039BE5"]);
});

test("a name chip picks the text that reads on its color", () => {
  assert.equal(contrastText("#1d4ed8"), "#ffffff");
  assert.equal(contrastText("#F2B134"), "#1a1a1a");
});
