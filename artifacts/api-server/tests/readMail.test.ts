import assert from "node:assert/strict";
import test from "node:test";
import { alreadyRead, parseMailRead, plansFromRead, subjectPlaceholder } from "../src/ingest/readMail.ts";

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

test("mail that is not for the family is declined, and a bad reply is ignored", () => {
  const read = parseMailRead('{"familyRelated":false,"newsletter":null,"items":[]}', people);
  assert.equal(read?.familyRelated, false);
  assert.equal(read?.items.length, 0);
  assert.equal(parseMailRead("not json"), null);
});
