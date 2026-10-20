import assert from "node:assert/strict";
import test from "node:test";
import { alreadyRead, undoubleDecide, withoutDecide, mailReadPrompt, parseMailRead, plansFromRead, subjectPlaceholder } from "../src/ingest/readMail.ts";
import { slipMail } from "../src/ingest/process.ts";

const people = [{ name: "Liam", isChild: true, school: "Oak Elementary" }];
const message = { subject: "Oak weekly", fromAddress: "news@school.org", snippet: "This week", accountId: "google" };
const now = new Date(2026, 9, 2, 11, 0, 0);

test("a mail read becomes a newsletter, a to-do, a key date, and a timed event", () => {
  const read = parseMailRead(JSON.stringify({
    familyRelated: true,
    newsletter: { title: "Oak Weekly", highlights: ["Picture day is Friday", "Bring a jacket"] },
    items: [
      { kind: "todo", title: "Return the form", detail: "Signed copy", date: "2026-10-06", time: null, who: ["Liam", "Nobody"] },
      { kind: "keydate", title: "No school", detail: "Teacher workshop", date: "2026-10-09", time: null, who: [] },
      { kind: "event", title: "Soccer practice", detail: "At the field", date: "2026-10-06", time: "4:00 PM", who: ["Liam"] },
    ],
  }), people);
  assert.ok(read);
  const planned = plansFromRead(message, read, ["liam"], { mutedSenders: [], dismissedSlipKeys: [] }, [], [], now);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Oak Weekly", "Return the form", "No school"]);
  assert.match(planned.todos[0].description, /Plan: newsletter/);
  assert.match(planned.todos[1].description, /Plan: todo/);
  assert.match(planned.todos[1].description, /Due 10\/6\/2026/);
  assert.match(planned.todos[1].description, /For Liam/);
  assert.match(planned.todos[2].description, /Plan: keydate/);
  assert.equal(planned.events.length, 1);
  assert.equal(planned.events[0].title, "Soccer practice");
  assert.equal(planned.events[0].hours, 16);
  assert.equal(alreadyRead(planned.todos[0].description, "Oak weekly"), true);
  assert.equal(subjectPlaceholder("Oak weekly", "From: news@school.org\nThis week", "Oak weekly"), true);
  assert.equal(subjectPlaceholder(planned.todos[0].title, planned.todos[0].description, "Oak weekly"), false);
});

test("a read belongs to the parent whose mailbox it came to, and the note says where the email lives", () => {
  const read = parseMailRead(JSON.stringify({
    familyRelated: true,
    newsletter: { name: "Oak Weekly", title: "Oak Weekly 9/28", highlights: ["Picture day is Friday"] },
    items: [
      { kind: "todo", title: "Return the form", detail: "", date: null, time: null, who: [] },
      { kind: "event", title: "Soccer practice", detail: "", date: "2026-10-06", time: "4:00 PM", who: [] },
    ],
  }), people);
  assert.ok(read);
  assert.equal(read.newsletter?.name, "Oak Weekly");
  const mail = {
    ...message,
    fromName: "Ms. Simonovich",
    provider: "gmail" as const,
    messageId: "18f2a",
    receivedAt: "2026-10-02T14:03:00.000Z",
    ownerProfileIds: ["dad"],
  };
  const planned = plansFromRead(mail, read, ["mom", "dad", "liam"], { mutedSenders: [], dismissedSlipKeys: [] }, [], [], now);
  assert.deepEqual(planned.todos.map((todo) => todo.profileIds), [["dad"], ["dad"]]);
  assert.deepEqual(planned.events[0].profileIds, ["dad"]);
  const letter = planned.todos[0].description;
  assert.match(letter, /^From: news@school\.org\nPlan: newsletter\nRef: oak weekly\nName: Oak Weekly\nSender: Ms\. Simonovich\nSent: 2026-10-02T14:03:00\.000Z\nMail: gmail:dad:18f2a\nPicture day is Friday\.$/);
  assert.doesNotMatch(planned.todos[1].description, /Name:/);
  assert.deepEqual(slipMail(planned.todos[1].description), { provider: "gmail", ownerProfileId: "dad", messageId: "18f2a" });
  assert.equal(alreadyRead(letter, "Oak weekly"), true);
  assert.equal(subjectPlaceholder(planned.todos[0].title, letter, "Oak weekly"), false);
  const shared = plansFromRead({ ...mail, ownerProfileIds: ["mom", "dad"] }, read, ["liam"], { mutedSenders: [], dismissedSlipKeys: [] }, [], [], now);
  assert.deepEqual(shared.todos[0].profileIds, ["mom", "dad"]);
  const sentIn = plansFromRead(message, read, ["liam"], { mutedSenders: [], dismissedSlipKeys: [] }, [], [], now);
  assert.deepEqual(sentIn.todos[0].profileIds, ["liam"]);
  assert.equal(slipMail(sentIn.todos[0].description), null);
});

test("next week's issue under the same title gets its own row, unless that title was removed", () => {
  const read = parseMailRead(JSON.stringify({
    familyRelated: true,
    newsletter: { name: "Room 12 News", title: "Room 12 News", highlights: ["Bring a jacket"] },
    items: [],
  }), people);
  assert.ok(read);
  const mail = { ...message, subject: "Room 12 News", receivedAt: "2026-10-09T15:00:00.000Z" };
  const planned = plansFromRead(mail, read, ["dad"], { mutedSenders: [], dismissedSlipKeys: [] }, ["room 12 news"], [], now);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Room 12 News (Oct 9)"]);
  const removed = plansFromRead(mail, read, ["dad"], { mutedSenders: [], dismissedSlipKeys: ["room 12 news"] }, [], [], now);
  assert.equal(removed.todos.length, 0);
});

test("a hidden newsletter is skipped while the to-dos in the same email still come through", () => {
  const read = parseMailRead(JSON.stringify({
    familyRelated: true,
    newsletter: { name: "Oak Weekly", title: "Oak Weekly 10/9", highlights: ["Picture day is Friday"] },
    items: [{ kind: "todo", title: "Return the form", detail: "", date: null, time: null, who: [] }],
  }), people);
  assert.ok(read);
  const state = { mutedSenders: [], dismissedSlipKeys: [], mutedNewsletters: ["news@school.org|oak weekly"] };
  const planned = plansFromRead(message, read, ["dad"], state, [], [], now);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Return the form"]);
});

test("the reader sees a long letter, earlier messages, and the open calendar", () => {
  const body = "x".repeat(20_000);
  const prompt = mailReadPrompt(
    { subject: "Week", snippet: "short", accountId: "a", body, thread: ["From: Coach\nSaturday at 9, Field 3"] },
    [],
    [],
    undefined,
    ["Calendar: Soccer (Sat 4:00 PM)"],
  );
  assert.equal(prompt.includes(body), true);
  assert.match(prompt, /Calendar: Soccer/);
  assert.match(prompt, /earlier message 1/);
  assert.match(prompt, /Saturday at 9/);
});

test("mail that is not for the family is declined, and a bad reply is ignored", () => {
  const read = parseMailRead('{"familyRelated":false,"newsletter":null,"items":[]}', people);
  assert.equal(read?.familyRelated, false);
  assert.equal(read?.items.length, 0);
  assert.equal(parseMailRead("not json"), null);
});

test("an item goes to the people the mail names, and a taught sender beats that", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  const mail = {
    id: "m1", accountId: "a", subject: "Thrive 2026 Conference", snippet: "", body: "",
    fromAddress: "emails@brushfire.com", ownerProfileIds: ["dad", "mom"],
  };
  const read = {
    familyRelated: true,
    newsletter: null,
    items: [
      { kind: "todo" as const, title: "Thrive 2026 Conference", detail: "At Mayo Civic Center.", date: null, time: null, who: ["Mom"], changeOf: null },
      { kind: "decision" as const, title: "RSVP for the game", detail: "", date: null, time: null, who: [], changeOf: null },
    ],
    profileFacts: [],
  };
  const people = [{ id: "dad", name: "Dad", facts: [] }, { id: "mom", name: "Mom", facts: [] }];
  const state = { mutedSenders: [], dismissedSlipKeys: [] };
  const planned = plansFromRead(mail, read, ["dad", "mom"], state, [], [], now, new Set(), people);
  assert.deepEqual(planned.todos.map((todo) => todo.profileIds), [["mom"], ["dad", "mom"]], "named people first, then the inboxes it came in");
  const taught = [{ id: "dad", name: "Dad", facts: ["Mail from emails@brushfire.com is for Dad."] }, { id: "mom", name: "Mom", facts: [] }];
  const learned = plansFromRead(mail, read, ["dad", "mom"], state, [], [], now, new Set(), taught);
  assert.deepEqual(learned.todos.map((todo) => todo.profileIds), [["dad"], ["dad"]], "what the family taught wins");
});

test("past events, undated events, and unmatched changes are never to-dos; a late read skips missed deadlines; a to-do keeps its type", () => {
  const now = new Date(2026, 9, 20, 9);
  const state = { mutedSenders: [], dismissedSlipKeys: [] };
  const mail = { id: "m", accountId: "a", subject: "Thrive 2026", snippet: "", body: "", fromAddress: "emails@brushfire.com", receivedAt: new Date(2026, 9, 19, 8).toISOString() };
  const read = {
    familyRelated: true,
    newsletter: null,
    items: [
      { kind: "event" as const, title: "Thrive 2026 Conference", detail: "At Mayo Civic Center.", date: "2026-10-09", time: null, who: [], changeOf: null },
      { kind: "event" as const, title: "Fall party", detail: "Sometime soon.", date: null, time: null, who: [], changeOf: null },
      { kind: "change" as const, title: "Practice moved", detail: "", date: null, time: null, who: [], changeOf: null },
      { kind: "todo" as const, title: "RSVP for the gala", detail: "Let us know by Friday.", date: "2026-10-23", time: null, who: [], changeOf: null, taskType: "rsvp" as const },
      { kind: "backpack" as const, title: "sack lunch", detail: "", date: "2026-10-22", time: null, who: [], changeOf: null, taskType: null },
    ],
    profileFacts: [],
  };
  const planned = plansFromRead(mail, read, ["dad"], state, [], [], now);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["RSVP for the gala", "sack lunch"]);
  assert.match(planned.todos[0].description, /\nType: rsvp\n/);
  assert.match(planned.todos[1].description, /\nType: bring\n/);
  const old = { ...mail, receivedAt: new Date(2026, 9, 1, 8).toISOString() };
  const lateRead = { ...read, items: [{ kind: "todo" as const, title: "Turn in the form", detail: "", date: "2026-10-05", time: null, who: [], changeOf: null, taskType: "sign_form" as const }] };
  assert.deepEqual(plansFromRead(old, lateRead, ["dad"], state, [], [], now).todos, [], "a deadline missed before the mail was read is not added");
});

// The reader sometimes starts a decision with "Decide:" itself (2026-10-19).
test("a decision is titled with one Decide:, and saved doubles are made one", () => {
  assert.equal(withoutDecide("Decide: Accept or decline River Valley Church volunteer request"), "Accept or decline River Valley Church volunteer request");
  assert.equal(withoutDecide("decide: Decide: Pick a camp"), "Pick a camp");
  assert.equal(withoutDecide("Pick a camp"), "Pick a camp");
  assert.equal(undoubleDecide("Decide: Decide: Accept or decline. Due 10/18/2026."), "Decide: Accept or decline. Due 10/18/2026.");
  assert.equal(undoubleDecide("From: a@b.com\nPlan: todo\nDecide: Decide: Decide: Pick"), "From: a@b.com\nPlan: todo\nDecide: Pick");
  assert.equal(undoubleDecide("Decide: Pick a camp"), "Decide: Pick a camp");
});
