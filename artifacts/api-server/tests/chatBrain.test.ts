import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatBriefing, chatSystemPrompt, handleToolCall, toolDeclarations, userSaidYes, type ChatSnapshot } from "../src/chatBrain";

const snap: ChatSnapshot = {
  now: new Date("2026-10-02T15:00:00Z"),
  timeZone: "America/Chicago",
  firstName: "Chad",
  isChild: false,
  profiles: [
    { id: "dad", name: "Dad", school: null, facts: [], role: "parent" },
    { id: "liam", name: "Liam", school: "Oak", facts: ["allergic to peanuts"], role: "child", isChild: true },
  ],
  events: [
    { id: "soccer", title: "Soccer", startTime: "2026-10-03T21:00:00Z", location: "Field", profileIds: ["liam"], source: "app" },
    { id: "gcal", title: "Practice", startTime: "2026-10-03T22:00:00Z", profileIds: ["liam"], source: "google" },
  ],
  chores: [
    { id: "slip", title: "Sign the slip", taskType: "todo", profileIds: ["dad"], category: "school_email", description: "From the office: bring a lunch." },
    { id: "dishes", title: "Dishes", taskType: "chore", profileIds: ["liam"], points: 5 },
  ],
  doneIds: [],
  meals: [{ name: "Tacos", date: "2026-10-02", mealType: "dinner" }],
  celebrations: [{ name: "Liam", monthDay: "11-02", type: "birthday" }],
  groceries: [{ name: "Milk" }],
};

describe("chat brain", () => {
  it("answers yes the way a confirmation does", () => {
    assert.equal(userSaidYes("Yes, do it"), true);
    assert.equal(userSaidYes("what's tomorrow"), false);
  });

  it("keeps email text away from a child and still shows the plan", () => {
    const child = chatBriefing({ ...snap, isChild: true });
    assert.equal(child.includes("bring a lunch"), false);
    assert.equal(child.includes("allergic to peanuts"), false);
    assert.equal(child.includes("Soccer"), true);
    assert.match(chatSystemPrompt({ ...snap, isChild: true }), /child/i);
    assert.equal(toolDeclarations(true).some((tool) => tool.name === "mute_sender"), false);
    assert.equal(toolDeclarations(false).some((tool) => tool.name === "mute_sender"), true);
  });

  it("will not delete or remember until the person says yes", () => {
    const blocked = handleToolCall("delete_event", { eventId: "soccer", confirmed: true }, snap, false);
    assert.equal(blocked.action, null);
    assert.equal("needsConfirmation" in (blocked.output as object), true);
    const allowed = handleToolCall("delete_event", { eventId: "soccer", confirmed: true }, snap, true);
    assert.equal(allowed.action?.kind, "delete_event");
  });

  it("hands Google events back instead of editing them", () => {
    const handed = handleToolCall("delete_event", { eventId: "gcal", confirmed: true }, snap, true);
    assert.equal(handed.handoff, true);
    assert.equal(handed.action, null);
  });

  it("adds a to-do only for a real person", () => {
    const made = handleToolCall("create_task", { title: "Pack the bag", profileIds: ["liam", "stranger"] }, snap, false);
    assert.deepEqual(made.action, { kind: "create_task", title: "Pack the bag", profileIds: ["liam"] });
  });

  it("refuses mail tools for a child", () => {
    const child = { ...snap, isChild: true };
    const muted = handleToolCall("mute_sender", { address: "a@b.com", confirmed: true }, child, true);
    assert.equal(muted.action, null);
  });
});
