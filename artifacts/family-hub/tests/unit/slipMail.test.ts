import assert from "node:assert/strict";
import test from "node:test";
import { openEmailHref, schoolFromSlip, slipQuote, slipSender, suggestedSchool } from "../../src/lib/slipMail";

test("a slip keeps the sender off the visible quote", () => {
  const body = "From: office@school.edu\nPlease return this to Lincoln Elementary.";
  assert.equal(slipSender(body), "office@school.edu");
  assert.equal(slipQuote(body), "Please return this to Lincoln Elementary.");
  assert.equal(suggestedSchool(slipQuote(body)), "Lincoln Elementary");
  assert.equal(openEmailHref(false, "office@school.edu"), null);
  assert.equal(openEmailHref(true, "office@school.edu"), "mailto:office@school.edu");
});

test("a school named only in the subject is still offered", () => {
  assert.equal(schoolFromSlip("Lincoln Elementary picture day", "Please send a form."), "Lincoln Elementary");
  assert.equal(schoolFromSlip("Picture day", "From: office@school.edu\nPlease return this to Lincoln Elementary."), "Lincoln Elementary");
});
