import assert from "node:assert/strict";
import test from "node:test";
import { assignChange, checkOffTitle, createEventClock, createEventTitle, createTodoTitle, dayReply, deleteEventAction, deleteEventTitle, drivingReply, eventClockLine, familyCalendarOffer, familyReply, forgetFact, importedEventNeedsConfirm, memoryFact, memoryReply, moveEventAction, moveEventWhen, muteAddress, newsletterTitles, notRelevantTitle, placeReply, pointsProfileId, rememberedFacts, reminderRequest, feedbackNote, schoolFact, schoolReply, searchHits, toolsForRole, unknownReply, weatherReply } from "../../src/lib/chatTools";

test("an unrecognized sentence gets a short reply", () => {
  assert.match(unknownReply(true), /plan/);
  assert.doesNotMatch(unknownReply(true), /grocery|inbox|mail/i);
  assert.match(unknownReply(false), /grocery/);
});

test("a kid tool list excludes inbox search", () => {
  const tools = toolsForRole(true);
  assert.equal(tools.includes("search"), false);
  assert.equal(tools.includes("get_newsletters"), false);
  assert.equal(tools.includes("complete_task"), true);
});

test("a parent tool list includes inbox search", () => {
  assert.equal(toolsForRole(false).includes("search"), true);
});

test("a dinner stays on the meal plan when chat tries to move it", () => {
  assert.equal(moveEventAction("meal", "evt"), "keep-meal");
  assert.equal(moveEventAction("app", "evt"), "move");
  assert.equal(moveEventAction("scan", "evt"), "confirm");
});

test("an app-made event deletes and an outside event asks first", () => {
  assert.equal(deleteEventAction("app", "evt"), "delete");
  assert.equal(deleteEventAction(null, "evt"), "delete");
  assert.equal(deleteEventAction("scan", "evt"), "confirm");
  assert.equal(deleteEventAction("meal", "evt"), "keep");
  assert.equal(deleteEventAction("app", "google-1"), "keep");
});

test("who's in the family names each person", () => {
  assert.equal(
    familyReply("who's in the family?", [
      { name: "Everyone", isAllFamilyProfile: true },
      { name: "Liam", school: "Lincoln" },
      { name: "Chad" },
    ]),
    "Liam, Lincoln\nChad",
  );
  assert.equal(
    familyReply("who's in the family?", [{ name: "Liam", school: "Lincoln", facts: ["is allergic to peanuts"] }]),
    "Liam, Lincoln, is allergic to peanuts",
  );
  assert.equal(familyReply("hello", []), null);
});

test("where is names the place already on the event", () => {
  assert.equal(placeReply("where is Soccer?", [{ title: "Soccer", location: "Field 2" }]), "Soccer is at Field 2. https://maps.apple.com/?q=Field%202");
  assert.equal(placeReply("where is the park?", []), "https://maps.apple.com/?q=the%20park");
  assert.equal(placeReply("where is Soccer?", [{ title: "Soccer", location: "" }]), "Soccer doesn't have a place saved.");
  assert.equal(placeReply("hello", []), null);
});

test("what's the weather uses the household reading", () => {
  assert.equal(weatherReply("what's the weather?", { location: "Austin", temperature: 72.4, condition: "Clear" }), "72° in Austin, Clear.");
  assert.equal(weatherReply("what's the weather?", null), "I don't have the weather.");
  assert.equal(weatherReply("hello", null), null);
});

test("newsletters lists open school mail", () => {
  assert.deepEqual(newsletterTitles("newsletters", [{ title: "Permission slip", category: "school_email" }, { title: "Soccer", category: null }]), ["Permission slip"]);
  assert.equal(newsletterTitles("hello", []), null);
  assert.equal(toolsForRole(true).includes("get_newsletters"), false);
});

test("chat can say a saved school back", () => {
  const profiles = [{ name: "Liam", school: "Lincoln" }];
  assert.equal(schoolReply("what's Liam's school?", profiles), "Liam's school is Lincoln.");
  assert.equal(schoolReply("what's my school", profiles, "Liam"), "Liam's school is Lincoln.");
  assert.equal(schoolReply("hello", profiles), null);
});

test("search finds a slip by its words", () => {
  assert.deepEqual(searchHits("search permission", [{ title: "Permission slip" }, { title: "Soccer" }]), ["Permission slip"]);
  assert.equal(searchHits("hello", []), null);
  assert.equal(toolsForRole(true).includes("search"), false);
});

test("mute and not-relevant name the sender and the slip", () => {
  assert.equal(muteAddress("mute office@school.edu"), "office@school.edu");
  assert.equal(notRelevantTitle("not relevant Permission slip"), "Permission slip");
  assert.equal(toolsForRole(true).includes("mute_sender"), false);
});

test("move names the event and the clock", () => {
  const thursday = new Date(2026, 9, 1);
  assert.deepEqual(moveEventWhen("move Soccer to 4:30 pm"), { title: "Soccer", hours: 16, minutes: 30 });
  assert.deepEqual(moveEventWhen("move Soccer to Friday", thursday), { title: "Soccer", on: new Date(2026, 9, 2) });
  assert.deepEqual(moveEventWhen("move Soccer to October 8 at 4:30 pm", thursday), { title: "Soccer", hours: 16, minutes: 30, on: new Date(2026, 9, 8) });
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

test("add event at 4:30 uses that clock", () => {
  const thursday = new Date(2026, 9, 1);
  assert.deepEqual(createEventClock("Soccer at 4:30 pm"), { title: "Soccer", hours: 16, minutes: 30, day: "tomorrow" });
  assert.deepEqual(createEventClock("Soccer today at 4 pm"), { title: "Soccer", hours: 16, minutes: 0, day: "today" });
  assert.deepEqual(createEventClock("Soccer tonight at 6 pm"), { title: "Soccer", hours: 18, minutes: 0, day: "today" });
  assert.deepEqual(createEventClock("Soccer this evening at 6 pm"), { title: "Soccer", hours: 18, minutes: 0, day: "today" });
  assert.deepEqual(createEventClock("Soccer practice"), { title: "Soccer practice", day: "tomorrow" });
  assert.deepEqual(createEventClock("Soccer on October 8 at 4:30 pm", thursday), {
    title: "Soccer",
    hours: 16,
    minutes: 30,
    day: "tomorrow",
    on: new Date(2026, 9, 8),
  });
  assert.deepEqual(createEventClock("Soccer this Friday at 4 pm", thursday), {
    title: "Soccer",
    hours: 16,
    minutes: 0,
    day: "tomorrow",
    on: new Date(2026, 9, 2),
  });
  assert.deepEqual(createEventClock("Soccer Friday at 4 pm", thursday), {
    title: "Soccer",
    hours: 16,
    minutes: 0,
    day: "tomorrow",
    on: new Date(2026, 9, 2),
  });
  assert.deepEqual(createEventClock("Soccer next Friday at 4 pm", new Date(2026, 9, 2, 15, 0)), {
    title: "Soccer",
    hours: 16,
    minutes: 0,
    day: "tomorrow",
    on: new Date(2026, 9, 9),
  });
});

test("a new event is offered to the family calendar", () => {
  assert.equal(createEventTitle("add event Soccer practice"), "Soccer practice");
  assert.equal(familyCalendarOffer("family@group.calendar.google.com"), "family@group.calendar.google.com");
  assert.equal(familyCalendarOffer("none"), null);
});

test("a check-off credits the person on screen", () => {
  assert.equal(pointsProfileId(["liam", "ava"], "liam"), "liam");
  assert.equal(pointsProfileId(["liam"], "family"), "liam");
  assert.equal(pointsProfileId([], "liam"), "liam");
  assert.equal(pointsProfileId([], "liam,ava"), "liam");
  assert.equal(pointsProfileId([], "family"), null);
});

test("check off names the chore", () => {
  assert.equal(checkOffTitle("check off dishes"), "dishes");
  assert.equal(checkOffTitle("Who is driving soccer?"), null);
});

test("what's the plan lists a timed school email once", () => {
  const day = new Date(2026, 9, 1, 15, 30);
  const reply = dayReply("what's the plan?", {
    chores: [{ id: "pic", title: "Picture day", taskType: "todo" }],
    events: [{ title: "Picture day", startTime: day, source: "school" }],
    day,
  });
  assert.equal(reply, "Picture day, 3:30 PM");
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
    events: [{ title: "Soccer", startTime: day }, { title: "Tacos", startTime: new Date(2026, 9, 1, 18, 0), source: "meal" }],
    dinner: "Tacos",
    day,
  });
  assert.equal(reply, "Feed the dog\nBuy milk\nSoccer, 3:00 PM\nDinner. Tacos");
  assert.equal(dayReply("hello", { chores: [], events: [], dinner: null, day }), null);
  const friday = dayReply("what's the plan Friday", {
    chores: [
      { id: "dog", title: "Feed the dog", taskType: "chore", recurrenceType: "daily" },
      { id: "mow", title: "Mow the lawn", taskType: "chore", daysOfWeek: [0] },
      { id: "done", title: "Dishes", taskType: "chore", recurrenceType: "daily" },
      { id: "milk", title: "Buy milk", taskType: "todo" },
      { id: "eggs", title: "Buy eggs", taskType: "todo" },
    ],
    completions: [{ choreId: "done", completedAt: day }, { choreId: "eggs", completedAt: day }],
    events: [{ title: "Soccer", startTime: day }, { title: "Piano", startTime: new Date(2026, 9, 2, 16, 0) }],
    meals: [
      { date: "2026-10-01", slot: "dinner", name: "Tacos" },
      { date: "2026-10-02", slot: "dinner", name: "Pasta" },
    ],
    day,
  });
  assert.equal(friday, "Feed the dog\nDishes\nBuy milk\nPiano, 4:00 PM\nDinner. Pasta");
  assert.equal(dayReply("what's the plan for the weekend", { chores: [], events: [], dinner: null, day }), "I don't know that day.");
  assert.equal(dayReply("what's the plan tonight", { chores: [], events: [{ title: "Soccer", startTime: day }], dinner: "Tacos", day }), "Soccer, 3:00 PM\nDinner. Tacos");
});

test("remember keeps a fact on that person", () => {
  const fact = memoryFact("remember Liam is allergic to peanuts", [{ id: "liam", name: "Liam" }]);
  assert.deepEqual(fact, { profileId: "liam", name: "Liam", fact: "is allergic to peanuts" });
  assert.deepEqual(rememberedFacts(["is allergic to peanuts"], "is allergic to peanuts"), ["is allergic to peanuts"]);
  assert.equal(memoryReply("what do you remember about Liam?", [{ name: "Liam", facts: ["is allergic to peanuts"] }]), "Liam is allergic to peanuts");
  assert.equal(memoryReply("what do you remember about Liam?", [{ name: "Liam", facts: [] }]), "I don't remember anything about Liam.");
  const gone = forgetFact("forget Liam is allergic to peanuts", [{ id: "liam", name: "Liam", facts: ["is allergic to peanuts", "likes soccer"] }]);
  assert.deepEqual(gone, { profileId: "liam", name: "Liam", fact: "is allergic to peanuts", facts: ["likes soccer"] });
  assert.deepEqual(forgetFact("forget Liam has a bike", [{ id: "liam", name: "Liam", facts: ["likes soccer"] }]), { reply: "I don't remember that about Liam." });
});

test("feedback is recognized and not stored", () => {
  assert.equal(feedbackNote("feedback: the plan missed soccer"), "the plan missed soccer");
  assert.equal(feedbackNote("hello"), null);
});

test("remind me becomes a to-do title, not a notification", () => {
  assert.deepEqual(reminderRequest("remind me to call the dentist", []), { title: "call the dentist", profileIds: [] });
  assert.deepEqual(reminderRequest("remind Liam to pack his bag", [{ id: "liam", name: "Liam" }]), { title: "pack his bag", profileIds: ["liam"] });
  assert.deepEqual(reminderRequest("remind Noah to pack", [{ id: "liam", name: "Liam" }]), { reply: "I don't see Noah." });
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

test("a home event names its clock, and the horizon names the day", () => {
  const at = new Date(2026, 9, 2, 16, 0);
  assert.equal(eventClockLine("Soccer", at), "Soccer, 4:00 PM");
  assert.equal(eventClockLine("Picture day", new Date(2026, 9, 2, 0, 0)), "Picture day");
  assert.equal(eventClockLine("Picture day", new Date(2026, 9, 1, 19, 0), false, true), "Picture day");
  assert.match(eventClockLine("Soccer", at, true), /^Soccer, .+, 4:00 PM$/);
});

test("deleting an imported event asks first", () => {
  assert.equal(deleteEventTitle("delete the soccer game"), "soccer game");
  assert.equal(importedEventNeedsConfirm("ics"), true);
  assert.equal(importedEventNeedsConfirm("meal"), false);
  assert.equal(importedEventNeedsConfirm(null), false);
});
