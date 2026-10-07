// The setup chat reads typed answers as well as taps. These pin what each
// question understands, so "1", "grown-up" and "mom" all keep picking the
// same answer, and a typed city keeps resolving to a real state and timezone.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchChoice, parseNames, parseLocation, parseRegion, parseEmail, parseInviteCode,
  parsePin, parseAmount, parseNumberList, tidyName, initialsOf, joinNames, YES_WORDS, NO_WORDS,
  type Choice,
} from "../../src/lib/setupChat/parse";

const ROLE: Choice[] = [
  { id: "adult", label: "Grown-up", say: ["adult", "parent", "mom", "dad"] },
  { id: "child", label: "Kid", say: ["child", "son", "daughter"] },
];
const YES_NO: Choice[] = [
  { id: "yes", label: "Yes", say: YES_WORDS },
  { id: "no", label: "Not now", say: NO_WORDS },
];
const SPEND: Choice[] = [
  { id: "rewards_only", label: "Spend on rewards" },
  { id: "cashout_only", label: "Cash out for money" },
  { id: "both", label: "Both" },
];

test("a typed number picks that answer, however it's written", () => {
  for (const typed of ["1", "1.", "#1", "1)", "option 1", "1\uFE0F\u20E3", "one", "the first one"]) {
    assert.equal(matchChoice(typed, ROLE), 0, `"${typed}" should pick the first answer`);
  }
  for (const typed of ["2", " 2 ", "two", "second"]) {
    assert.equal(matchChoice(typed, ROLE), 1, `"${typed}" should pick the second answer`);
  }
});

test("a number past the end of the list matches nothing", () => {
  assert.equal(matchChoice("3", ROLE), -1);
  assert.equal(matchChoice("0", ROLE), -1);
});

test("grown-up and kid understand their everyday words", () => {
  for (const typed of ["grown-up", "Grown up", "adult", "parent", "Mom", "dad"]) {
    assert.equal(matchChoice(typed, ROLE), 0, typed);
  }
  for (const typed of ["kid", "child", "son", "Daughter"]) {
    assert.equal(matchChoice(typed, ROLE), 1, typed);
  }
});

test("yes and no understand their everyday words", () => {
  for (const typed of ["yes", "Yep", "sure", "ok", "OK!", "yes please"]) {
    assert.equal(matchChoice(typed, YES_NO), 0, typed);
  }
  for (const typed of ["no", "not now", "later", "skip", "nope", "no thanks"]) {
    assert.equal(matchChoice(typed, YES_NO), 1, typed);
  }
});

test("a negated yes word is not read as yes", () => {
  assert.equal(matchChoice("not sure", YES_NO), -1);
});

test("the start of an answer is enough when only one answer starts that way", () => {
  assert.equal(matchChoice("spend", SPEND), 0);
  assert.equal(matchChoice("cash", SPEND), 1);
  assert.equal(matchChoice("both please", SPEND), 2);
});

test("free-text questions only take an exact answer or a number", () => {
  const solo: Choice[] = [{ id: "solo", label: "It's just me", say: ["just me", "me", "no", "nobody"] }];
  assert.equal(matchChoice("me", solo, { strict: true }), 0);
  assert.equal(matchChoice("1", solo, { strict: true }), 0);
  assert.equal(matchChoice("Justin", solo, { strict: true }), -1, "a name starting like an answer is still a name");
  assert.equal(matchChoice("me and Sarah", solo, { strict: true }), -1);
});

test("unmatched text matches nothing", () => {
  assert.equal(matchChoice("purple", ROLE), -1);
  assert.equal(matchChoice("", ROLE), -1);
});

test("names split on commas, 'and' and '&'", () => {
  assert.deepEqual(parseNames("Sarah, Ava and Noah"), { names: ["Sarah", "Ava", "Noah"], ambiguous: false });
  assert.deepEqual(parseNames("sarah & ava"), { names: ["Sarah", "Ava"], ambiguous: false });
  assert.deepEqual(parseNames("Andrew and Sandy."), { names: ["Andrew", "Sandy"], ambiguous: false });
  assert.deepEqual(parseNames("Ava, ava, Noah"), { names: ["Ava", "Noah"], ambiguous: false });
});

test("several words with no separator are flagged as ambiguous", () => {
  assert.deepEqual(parseNames("Sarah Ava Noah"), { names: ["Sarah Ava Noah"], ambiguous: true });
  assert.deepEqual(parseNames("Mary Kate"), { names: ["Mary Kate"], ambiguous: true });
  assert.deepEqual(parseNames("Sarah"), { names: ["Sarah"], ambiguous: false });
});

test("names keep their own capitals, and lowercase ones are capitalised", () => {
  assert.equal(tidyName("mary-kate"), "Mary-Kate");
  assert.equal(tidyName("McKenna"), "McKenna");
  assert.equal(tidyName("AJ"), "AJ");
  assert.equal(tidyName("  ava   rose "), "Ava Rose");
  assert.equal(tidyName("x".repeat(50)).length, 40, "the 40-character limit the profile form had");
});

test("initials match the profile form's", () => {
  assert.equal(initialsOf("Sarah"), "S");
  assert.equal(initialsOf("mary kate smith"), "MK");
});

test("names read as a list", () => {
  assert.equal(joinNames(["Chad"]), "Chad");
  assert.equal(joinNames(["Chad", "Sarah"]), "Chad and Sarah");
  assert.equal(joinNames(["Chad", "Sarah", "Ava", "Noah"]), "Chad, Sarah, Ava and Noah");
});

test("a city and state resolve, typed either way", () => {
  const expected = { city: "Minneapolis", region: { abbr: "MN", name: "Minnesota", country: "US" }, country: "US" };
  assert.deepEqual(parseLocation("minneapolis mn"), expected);
  assert.deepEqual(parseLocation("Minneapolis, Minnesota"), expected);
  assert.deepEqual(parseLocation("Minneapolis, MN, USA"), expected);
});

test("Canadian cities resolve to their province and country", () => {
  assert.deepEqual(parseLocation("Toronto ON"), { city: "Toronto", region: { abbr: "ON", name: "Ontario", country: "CA" }, country: "CA" });
  assert.deepEqual(parseLocation("saskatoon saskatchewan").region, { abbr: "SK", name: "Saskatchewan", country: "CA" });
  assert.deepEqual(parseLocation("Québec City, QC").city, "Québec City");
  assert.deepEqual(parseLocation("Vancouver, British Columbia").region?.abbr, "BC");
});

test("multi-word cities keep every word", () => {
  assert.deepEqual(parseLocation("st. paul mn").city, "St. Paul");
  assert.deepEqual(parseLocation("Oklahoma City OK").city, "Oklahoma City");
  assert.deepEqual(parseLocation("Washington D.C.").region?.abbr, "DC");
  assert.deepEqual(parseLocation("Washington D.C.").city, "Washington");
});

test("a city with no state comes back without one, to ask for it", () => {
  assert.deepEqual(parseLocation("Kansas City"), { city: "Kansas City", region: null, country: null });
  assert.deepEqual(parseLocation("Paris"), { city: "Paris", region: null, country: null });
  assert.deepEqual(parseLocation("Toronto, Canada"), { city: "Toronto", region: null, country: "CA" });
});

test("a state on its own comes back without a city, to ask for one", () => {
  assert.deepEqual(parseLocation("New York"), { city: null, region: { abbr: "NY", name: "New York", country: "US" }, country: "US" });
});

test("a state or province typed on its own", () => {
  assert.equal(parseRegion("mn")?.abbr, "MN");
  assert.equal(parseRegion("Minnesota")?.abbr, "MN");
  assert.equal(parseRegion("ontario")?.country, "CA");
  assert.equal(parseRegion("ON", "US")?.abbr, "ON", "the region wins over a mismatched country");
  assert.equal(parseRegion("Newfoundland and Labrador")?.abbr, "NL");
  assert.equal(parseRegion("District of Columbia")?.name, "District of Columbia");
  assert.equal(parseRegion("Narnia"), null);
});

test("emails", () => {
  assert.equal(parseEmail(" chad@example.com "), "chad@example.com");
  assert.equal(parseEmail("chad@example.com."), "chad@example.com");
  assert.equal(parseEmail("chad@example"), null);
  assert.equal(parseEmail("chad example.com"), null);
});

test("invite codes ignore spaces, dashes and case, and come out of a link", () => {
  assert.equal(parseInviteCode("k7m2 qx9p"), "K7M2QX9P");
  assert.equal(parseInviteCode("K7M2-QX9P"), "K7M2QX9P");
  assert.equal(parseInviteCode("https://hubforfamilies.com/join?code=K7M2QX9P"), "K7M2QX9P");
  assert.equal(parseInviteCode("K7M2"), null);
  assert.equal(parseInviteCode("K7M2QX9P1"), null);
});

test("a PIN is exactly four digits", () => {
  assert.equal(parsePin("1234"), "1234");
  assert.equal(parsePin("12 34"), "1234");
  assert.equal(parsePin("12a4"), null);
  assert.equal(parsePin("12345"), null);
});

test("amounts read digits and words, and ignore the dollar side", () => {
  assert.equal(parseAmount("10"), 10);
  assert.equal(parseAmount("10 stars"), 10);
  assert.equal(parseAmount("ten"), 10);
  assert.equal(parseAmount("twenty five"), 25);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount("$1 = 10 stars"), 10);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("lots"), null);
});

test("a list of numbers toggles several answers at once", () => {
  assert.deepEqual(parseNumberList("1, 3 and 4", 6), [1, 3, 4]);
  assert.deepEqual(parseNumberList("2", 6), [2]);
  assert.equal(parseNumberList("1 and 9", 6), null);
  assert.equal(parseNumberList("chores", 6), null);
});
