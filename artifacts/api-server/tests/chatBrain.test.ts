import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatBriefing, chatSystemPrompt, eventsForChat, handleToolCall, toolDeclarations, userSaidYes, type ChatSnapshot } from "../src/chatBrain";

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
  it("keeps a Google event chat can already see, and names the sooner one first", () => {
    const merged = eventsForChat(
      [{ id: "local", externalId: "google:copied", title: "Copied" }],
      [{ id: "google-1", externalId: "google:copied", title: "Copied again" }, { id: "google-2", externalId: "google:soccer", title: "Soccer" }],
    );
    assert.deepEqual(merged.map((event) => event.title), ["Copied", "Soccer"]);
    const briefing = chatBriefing({
      ...snap,
      now: new Date("2026-10-05T15:00:00Z"),
      events: [
        { id: "later", title: "Later game", startTime: "2026-10-09T21:00:00Z", profileIds: ["liam"], source: "google" },
        { id: "sooner", title: "Piano", startTime: "2026-10-06T20:00:00Z", profileIds: ["liam"], source: "google" },
      ],
    });
    assert.ok(briefing.indexOf("Piano") < briefing.indexOf("Later game"));
    assert.equal(briefing.includes("Old recital"), false);
    const withOld = chatBriefing({
      ...snap,
      now: new Date("2026-10-05T15:00:00Z"),
      events: [
        { id: "old", title: "Old recital", startTime: "2026-09-20T20:00:00Z", profileIds: ["liam"], source: "google" },
        { id: "sunday", title: "Sunday practice", startTime: "2026-10-04T18:00:00Z", profileIds: ["liam"], source: "google" },
      ],
    });
    assert.equal(withOld.includes("Old recital"), false);
    assert.equal(withOld.includes("Sunday practice"), true);
  });

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

  it("asks before writing dinners", () => {
    const args = { meals: [{ date: "2026-10-05", name: "Tacos" }, { date: "bad", name: "" }], confirmed: true };
    const blocked = handleToolCall("plan_dinners", args, snap, false);
    assert.equal(blocked.action, null);
    const allowed = handleToolCall("plan_dinners", args, snap, true);
    assert.deepEqual(allowed.action, { kind: "plan_dinners", dinners: [{ date: "2026-10-05", name: "Tacos" }] });
    assert.match(chatBriefing({ ...snap, savedMeals: [{ id: "a", name: "Pasta" }] }), /Pasta/);
  });

  it("refuses mail tools for a child", () => {
    const child = { ...snap, isChild: true };
    const muted = handleToolCall("mute_sender", { address: "a@b.com", confirmed: true }, child, true);
    assert.equal(muted.action, null);
    assert.equal(handleToolCall("search", { query: "slip" }, child, true).action, null);
  });

  it("searches mail, opens a map, and files a reminder on the plan", () => {
    const found = handleToolCall("search", { query: "slip lunch" }, snap, true);
    assert.equal((found.output as { results: { title: string }[] }).results[0]?.title, "Sign the slip");
    const map = handleToolCall("maps_link", { place: "Lincoln Elementary" }, snap, true);
    assert.match((map.output as { url: string }).url, /Lincoln%20Elementary/);
    const reminder = handleToolCall("create_reminder", { text: "Pack the bag", when: "2026-10-06" }, snap, true);
    assert.equal(reminder.action?.kind, "create_task");
    assert.equal(toolDeclarations(false).some((tool) => tool.name === "get_newsletters"), true);
    assert.equal(toolDeclarations(true).some((tool) => tool.name === "get_newsletters"), false);
  });
});
