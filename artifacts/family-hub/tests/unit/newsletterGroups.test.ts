import { test } from "node:test";
import assert from "node:assert/strict";
import { combineNewsletters, combineRows, declinePair, distinctiveWords, renameRow, separateRow, type NewsletterGrouping } from "../../src/lib/newsletterGroups";

type Row = { id: string };
let day = 20;
function source(sender: string, name: string, senderName: string | null = null) {
  const when = new Date(2026, 9, day--);
  return {
    key: `${sender}|${name.toLowerCase()}`,
    name,
    sender,
    muteName: name,
    issues: [{ id: `${sender}-${name}`, when, sender, senderName }],
  } as unknown as Parameters<typeof combineNewsletters<Row>>[0][number];
}

test("common words don't count as a match", () => {
  assert.deepEqual(distinctiveWords("Great Oaks Academy Weekly Newsletter"), ["great", "oaks"]);
  assert.deepEqual(distinctiveWords("St. Mark's Church"), ["marks"]);
});

test("the same school's office, PTA and teacher combine on their own, named for the child's school", () => {
  const office = source("office@greatoaks.org", "Great Oaks Weekly");
  const teacher = source("jsmith@greatoaks.org", "Mrs. Smith's Class Notes", "Great Oaks Academy");
  const pta = source("greatoaksacademyparentassociation@ccsend.com", "Parent Association Update");
  const other = source("news@forwardfuture.ai", "Forward Future");
  const { letters, suggestion } = combineNewsletters([office, teacher, pta, other], undefined, ["Great Oaks Academy"]);
  assert.equal(letters.length, 2);
  const school = letters.find((row) => row.members.length > 1)!;
  assert.equal(school.name, "Great Oaks Academy");
  assert.deepEqual(school.members.map((m) => m.sender).sort(), ["greatoaksacademyparentassociation@ccsend.com", "jsmith@greatoaks.org", "office@greatoaks.org"]);
  assert.deepEqual(school.issues.map((issue) => issue.when.getDate()), [...school.issues.map((issue) => issue.when.getDate())].sort((a, b) => b - a), "newest first");
  assert.equal(suggestion, null);
});

test("a church's senders on its own domain combine; unrelated senders on a shared mail service don't", () => {
  const office = source("office@stmarks.org", "St. Mark's Weekly");
  const youth = source("youth@stmarks.org", "St Mark's Youth");
  const a = source("lincolnpta@ccsend.com", "Lincoln PTA");
  const b = source("riverbendchurch@ccsend.com", "Riverbend News");
  const { letters } = combineNewsletters([office, youth, a, b]);
  assert.equal(letters.length, 3);
  assert.equal(letters.find((row) => row.members.length === 2)?.name, "St. Mark's Weekly");
});

test("a less clear match is asked about once, and a no is remembered", () => {
  const a = source("info@oaksfoundation.org", "Oaks Foundation");
  const b = source("office@greatoaks.org", "Great Oaks Weekly");
  const first = combineNewsletters([a, b]);
  assert.equal(first.letters.length, 2, "not combined without asking");
  assert.ok(first.suggestion);
  const declined = declinePair({ groups: [], apart: [] }, first.suggestion.pair);
  assert.equal(combineNewsletters([a, b], declined).suggestion, null);
});

test("combine, rename and separate", () => {
  const a = source("news@forwardfuture.ai", "Forward Future");
  const b = source("hello@morningbrew.com", "Morning Brew");
  let grouping: NewsletterGrouping = { groups: [], apart: [] };
  let rows = combineNewsletters([a, b], grouping).letters;
  grouping = combineRows(grouping, rows, null, "g1");
  rows = combineNewsletters([a, b], grouping).letters;
  assert.equal(rows.length, 1);
  grouping = renameRow(grouping, rows[0], "Daily reads", "g2");
  rows = combineNewsletters([a, b], grouping).letters;
  assert.equal(rows[0].name, "Daily reads");
  grouping = separateRow(grouping, rows[0]);
  assert.equal(combineNewsletters([a, b], grouping).letters.length, 2);

  // A separated school stays apart even though it would combine on its own.
  const office = source("office@greatoaks.org", "Great Oaks Weekly");
  const pta = source("pta@greatoaks.org", "Great Oaks PTA");
  const together = combineNewsletters([office, pta]).letters;
  assert.equal(together.length, 1);
  const apart = separateRow({ groups: [], apart: [] }, together[0]);
  const after = combineNewsletters([office, pta], apart);
  assert.equal(after.letters.length, 2);
  assert.equal(after.suggestion, null, "separated rows aren't offered right back");
});

test("two senders named only by their addresses aren't offered as the same", () => {
  const church = source("info@rivervalley.org", "info@rivervalley.org");
  const league = source("notifications@farmingtonbasketball.org", "notifications@farmingtonbasketball.org");
  const { letters, suggestion } = combineNewsletters([church, league]);
  assert.equal(letters.length, 2);
  assert.equal(suggestion, null);
  assert.deepEqual(distinctiveWords("info@rivervalley.org"), []);
});
