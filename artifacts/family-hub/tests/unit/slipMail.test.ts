import assert from "node:assert/strict";
import test from "node:test";
import { openEmailHref, schoolFromSlip, schoolSaveTarget, slipQuote, slipSender, suggestedSchool } from "../../src/lib/slipMail";
import { schoolEmailNames } from "../../src/lib/homeDay";

test("a slip keeps the sender off the visible quote", () => {
  const body = "From: office@school.edu\nPlease return this to Lincoln Elementary.";
  assert.equal(slipSender(body), "office@school.edu");
  assert.equal(slipQuote(body), "Please return this to Lincoln Elementary.");
  assert.equal(suggestedSchool(slipQuote(body)), "Lincoln Elementary");
  assert.equal(openEmailHref(false, "office@school.edu"), null);
  assert.equal(openEmailHref(true, "office@school.edu"), "mailto:office@school.edu");
});

test("a name in the email body still counts, and the quote stays short", () => {
  const description = "From: office@school.edu\nSee the note.\n\nPicture day for Liam at Lincoln Elementary.";
  assert.equal(slipQuote(description), "See the note.");
  assert.equal(schoolFromSlip("Picture day", description), "Lincoln Elementary");
  assert.equal(schoolEmailNames({ title: "Picture day", description, category: "school_email" }, "Liam"), true);
  assert.equal(schoolSaveTarget("Picture day", description, [{ id: "liam", name: "Liam", role: "child" }], "mom")?.profileId, "liam");
});

test("a school named only in the subject is still offered", () => {
  assert.equal(schoolFromSlip("Lincoln Elementary picture day", "Please send a form."), "Lincoln Elementary");
  assert.equal(schoolFromSlip("Picture day", "From: office@school.edu\nPlease return this to Lincoln Elementary."), "Lincoln Elementary");
});

test("a school email saves onto the child it names", () => {
  const people = [
    { id: "mom", name: "Mom", role: "adult" },
    { id: "liam", name: "Liam", role: "child" },
  ];
  assert.deepEqual(
    schoolSaveTarget("Liam picture day", "Lincoln Elementary", people, "mom"),
    { profileId: "liam", name: "Liam", school: "Lincoln Elementary" },
  );
  assert.equal(schoolSaveTarget("Picture day", "Lincoln Elementary", people, "mom"), null);
  assert.deepEqual(
    schoolSaveTarget("Picture day", "Lincoln Elementary", people, "liam")?.profileId,
    "liam",
  );
  assert.equal(
    schoolSaveTarget("Liam picture day", "Lincoln Elementary", [{ id: "liam", name: "Liam", role: "child", school: "Lincoln Elementary" }], "mom"),
    null,
  );
});
