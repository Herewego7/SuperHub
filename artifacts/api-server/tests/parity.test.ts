import assert from "node:assert/strict";
import test from "node:test";
import { duplicateBand, forOtherGrades, mapsUrl, planLinesStayHonest, searchHits, shouldRead, similarExamples, titleSimilarity } from "../src/ai/parity.ts";
import { plansFromRead } from "../src/ingest/readMail.ts";

test("a sure unrelated email is skipped, and an unsure one is still read", () => {
  assert.equal(shouldRead({ familyRelated: false, needsFullRead: false, confidence: 0.95 }, true), false);
  assert.equal(shouldRead({ familyRelated: false, needsFullRead: true, confidence: 0.95 }, true), true);
  assert.equal(shouldRead({ familyRelated: true, needsFullRead: false, confidence: 0.2 }, false), true);
});

test("another grade is dropped, and a rewritten plan cannot invent a time", () => {
  assert.equal(forOtherGrades("5th grade field trip", new Set(["2"])), true);
  assert.equal(forOtherGrades("5th grade field trip", new Set(["5"])), false);
  assert.equal(planLinesStayHonest("Soccer at 4:00 PM on Friday", ["Soccer, Friday at 4:00 PM"]), true);
  assert.equal(planLinesStayHonest("Soccer at 4:00 PM on Friday", ["Soccer at 5:00 PM"]), false);
});

test("a close not-relevant example is kept, and a weak one is not", () => {
  const weak = { text: "old flyer", embedding: [0.6, 0.8], ref: "news@school.edu" };
  assert.deepEqual(similarExamples([weak], [1, 0]), []);
  assert.deepEqual(similarExamples([weak], [1, 0], "news@school.edu"), ["old flyer"]);
  assert.deepEqual(similarExamples([
    { text: "store receipt", embedding: [1, 0] },
    { text: "soccer signup", embedding: [0, 1] },
  ], [0, 1]), ["soccer signup"]);
});

test("search, maps, and a near-duplicate title", () => {
  const hits = searchHits([{ title: "Picture day", text: "Bring a smile", kind: "mail" }, { title: "Dishes", text: "", kind: "todo" }], "picture smile");
  assert.equal(hits[0]?.title, "Picture day");
  assert.match(mapsUrl("Lincoln Elementary"), /maps\.apple\.com/);
  assert.equal(duplicateBand(titleSimilarity("Picture day form", "Picture day form")), "same");
  assert.equal(duplicateBand(titleSimilarity("Picture day", "Dishes tonight")), "new");
});

test("a backpack item, a decision, and a change do not become a second copy of the event", () => {
  const planned = plansFromRead(
    { subject: "Update", snippet: "Moved", accountId: "google" },
    {
      familyRelated: true,
      newsletter: null,
      facts: [],
      items: [
        { kind: "backpack", title: "Red shirt", detail: "Spirit day", date: "2026-10-06", time: null, who: [], changeOf: null },
        { kind: "decision", title: "the party", detail: "Yes or no", date: null, time: null, who: [], changeOf: null },
        { kind: "change", title: "Practice moved", detail: "Now later", date: "2026-10-06", time: "5:00 PM", who: [], changeOf: "Soccer practice" },
      ],
    },
    ["liam"],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    [],
    new Date(2026, 9, 2),
  );
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Red shirt", "Decide: the party"]);
  assert.match(planned.todos[0].description, /Bring Red shirt/);
  assert.equal(planned.events.length, 0);
  assert.equal(planned.changes[0]?.changeOf, "Soccer practice");
  assert.equal(planned.changes[0]?.time, "5:00 PM");
});
