import assert from "node:assert/strict";
import test from "node:test";
import { slipQuote, slipSender, suggestedSchool } from "../../src/lib/slipMail";

test("a slip keeps the sender off the visible quote", () => {
  const body = "From: office@school.edu\nPlease return this to Lincoln Elementary.";
  assert.equal(slipSender(body), "office@school.edu");
  assert.equal(slipQuote(body), "Please return this to Lincoln Elementary.");
  assert.equal(suggestedSchool(slipQuote(body)), "Lincoln Elementary");
});
