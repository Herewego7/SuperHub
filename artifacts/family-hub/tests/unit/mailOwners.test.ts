import assert from "node:assert/strict";
import test from "node:test";
import { mailOwnersFor, namedOwners, noteNames, ownerFixes, senderOwners, teachSender } from "../../src/lib/mailOwners";
import { slipSender } from "../../src/lib/slipMail";

const dad = { id: "dad", name: "Dad", facts: [] as string[] };
const mom = { id: "mom", name: "Mom", facts: [] as string[] };
const people = [dad, mom];

test("an email row names who it is for, and that beats everyone", () => {
  assert.deepEqual(noteNames("From: emails@brushfire.com\nPlan: todo\n10/9/2026 At Mayo Civic Center.\nFor Mom."), ["Mom"]);
  assert.deepEqual(noteNames("Decide if Jett is attending. For Dad and Mom."), ["Dad", "Mom"]);
  assert.deepEqual(namedOwners(["mom", "Jett"], people), ["mom"]);
  const rows = [
    { id: "thrive", category: "school_email", description: "From: emails@brushfire.com\nPlan: todo\nAt Mayo Civic Center.\nFor Mom.", profileIds: ["dad", "mom"] },
    { id: "rsvp", category: "school_email", description: "From: no-reply@mailer.sportsengine.com\nPlan: todo\nFor Dad and Mom.", profileIds: ["dad", "mom"] },
    { id: "mine", category: "school_email", description: "From: emails@brushfire.com\nFor Mom.", profileIds: ["dad", "mom"] },
    { id: "chore", category: "chore", description: "For Mom.", profileIds: ["dad", "mom"] },
  ];
  assert.deepEqual(ownerFixes(rows, people, slipSender, new Set(["mine"])), [{ id: "thrive", profileIds: ["mom"] }]);
});

test("handing one email to someone teaches the sender, and later mail follows", () => {
  const taught = teachSender("Emails@Brushfire.com", ["dad"], people);
  assert.deepEqual(taught, [{ id: "dad", facts: ["Mail from emails@brushfire.com is for Dad."] }]);
  const after = [{ ...dad, facts: taught[0].facts }, mom];
  assert.deepEqual(senderOwners("emails@brushfire.com", after), ["dad"]);
  assert.deepEqual(mailOwnersFor("emails@brushfire.com", "For Mom.", after), ["dad"], "what was taught beats the note");
  const moved = teachSender("emails@brushfire.com", ["mom"], after);
  assert.deepEqual(moved, [{ id: "dad", facts: [] }, { id: "mom", facts: ["Mail from emails@brushfire.com is for Mom."] }]);
  const rows = [{ id: "next", category: "school_email", description: "From: emails@brushfire.com\nFor Dad and Mom.", profileIds: ["dad", "mom"] }];
  assert.deepEqual(ownerFixes(rows, [{ ...dad, facts: [] }, { ...mom, facts: moved[1].facts }], slipSender, new Set()), [{ id: "next", profileIds: ["mom"] }]);
});

test("a person keeps at most 20 facts, dropping the oldest sender rule first", () => {
  const full = { id: "mom", name: "Mom", facts: ["Likes tea", ...Array.from({ length: 19 }, (_, i) => `Mail from s${i}@x.com is for Mom.`)] };
  const [change] = teachSender("new@x.com", ["mom"], [full]);
  assert.equal(change.facts.length, 20);
  assert.equal(change.facts[0], "Likes tea");
  assert.ok(!change.facts.includes("Mail from s0@x.com is for Mom."));
  assert.equal(change.facts.at(-1), "Mail from new@x.com is for Mom.");
});
