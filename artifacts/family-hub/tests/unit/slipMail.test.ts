import assert from "node:assert/strict";
import test from "node:test";
import { openEmailHref, slipQuote, slipSender, suggestedSchool } from "../../src/lib/slipMail";

test("a slip keeps the sender off the visible quote", () => {
  const body = "From: office@school.edu\nPlease return this to Lincoln Elementary.";
  assert.equal(slipSender(body), "office@school.edu");
  assert.equal(slipQuote(body), "Please return this to Lincoln Elementary.");
  assert.equal(suggestedSchool(slipQuote(body)), "Lincoln Elementary");
  assert.equal(openEmailHref(false, "office@school.edu"), null);
  assert.equal(openEmailHref(true, "office@school.edu"), "mailto:office@school.edu");
});
