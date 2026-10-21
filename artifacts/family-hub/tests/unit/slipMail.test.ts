import assert from "node:assert/strict";
import test from "node:test";
import { canReadOriginal, fromStoppedSender, newsletterKey, newsletterKeyLabel, newsletterMuted, noteBullets, personRecordLines, savedFacts, savedSchool, schoolFromSlip, schoolSaveTarget, slipMailOwner, slipNewsletterName, slipQuote, slipSender, slipSenderName, slipSentAt, slipText, suggestedSchool } from "../../src/lib/slipMail";
import { kindKeptOut, mailKindsOf } from "../../src/lib/mailKinds";
import { sourceShortLabel } from "../../src/lib/homeDay";
import { schoolEmailNames } from "../../src/lib/homeDay";

test("the person record shows the school once and each remembered fact once", () => {
  assert.deepEqual(
    personRecordLines({ school: "Lincoln Elementary", facts: ["allergic to peanuts", "allergic to peanuts", "likes soccer"] }),
    ["Lincoln Elementary", "allergic to peanuts · likes soccer"],
  );
  assert.deepEqual(personRecordLines({ school: "  ", facts: [] }), []);
});

test("a blank school field clears the saved school", () => {
  assert.equal(savedSchool("  Lincoln Elementary  "), "Lincoln Elementary");
  assert.equal(savedSchool("  "), null);
  assert.equal(savedSchool(null), null);
});

test("remembered facts save once each and a blank field clears them", () => {
  assert.deepEqual(savedFacts("likes soccer\nallergic to peanuts\nlikes soccer"), ["likes soccer", "allergic to peanuts"]);
  assert.deepEqual(savedFacts("  \n"), []);
});

test("a slip keeps the sender off the visible quote", () => {
  const body = "From: office@school.edu\nPlease return this to Lincoln Elementary.";
  assert.equal(slipSender(body), "office@school.edu");
  assert.equal(slipQuote(body), "Please return this to Lincoln Elementary.");
  assert.equal(slipQuote("From: office@school.edu\nPlan: newsletter\nRef: weekly note\nPlease return this to Lincoln Elementary."), "Please return this to Lincoln Elementary.");
  assert.equal(suggestedSchool(slipQuote(body)), "Lincoln Elementary");
});

test("the inbox's header lines stay off the note, and each one reads back", () => {
  const note = [
    "From: teacher@school.edu",
    "Plan: newsletter",
    "Ref: room 12 news",
    "Name: Room 12 News",
    "Sender: Ms. Park",
    "Sent: 2026-10-02T15:30:00.000Z",
    "Mail: gmail:mom:18c2f0a9b",
    "• Picture day is Oct 6",
    "Name: this line is the email's own words",
  ].join("\n");
  assert.equal(slipText(note), "• Picture day is Oct 6\nName: this line is the email's own words");
  assert.equal(slipQuote(note), "• Picture day is Oct 6\nName: this line is the email's own words");
  assert.equal(slipSender(note), "teacher@school.edu");
  assert.equal(slipNewsletterName(note), "Room 12 News");
  assert.equal(slipSenderName(note), "Ms. Park");
  assert.equal(slipSentAt(note)?.toISOString(), "2026-10-02T15:30:00.000Z");
  assert.equal(slipMailOwner(note), "mom");
  assert.equal(slipMailOwner("From: teacher@school.edu\nOlder item."), null);
  assert.equal(slipSentAt("From: teacher@school.edu\nOlder item."), null);
  assert.equal(slipText("From: teacher@school.edu\nPlan: todo\nRef: x"), "");
});

test("the mailbox owner reads the original, other adults need Share originals, and a child never does", () => {
  assert.equal(canReadOriginal(false, "mom", { id: "mom" }), true);
  assert.equal(canReadOriginal(false, "mom", { id: "dad" }), false);
  assert.equal(canReadOriginal(true, "mom", { id: "dad" }), true);
  assert.equal(canReadOriginal(true, "mom", { id: "liam", isChild: true }), false);
  assert.equal(canReadOriginal(true, null, { id: "mom" }), false);
});

test("a hidden newsletter covers its older issues, and a sender-wide hide covers every newsletter", () => {
  const keys = [newsletterKey("Teacher@School.edu", "Room 12 News")];
  assert.equal(newsletterMuted(keys, "teacher@school.edu", "room 12 news"), true);
  assert.equal(newsletterMuted(keys, "teacher@school.edu", null), true);
  assert.equal(newsletterMuted(keys, "teacher@school.edu", "PTA Update"), false);
  assert.equal(newsletterMuted(keys, "office@school.edu", "Room 12 News"), false);
  assert.equal(newsletterMuted([newsletterKey("teacher@school.edu", "")], "teacher@school.edu", "PTA Update"), true);
  assert.deepEqual(newsletterKeyLabel("teacher@school.edu|room 12 news"), { sender: "teacher@school.edu", name: "room 12 news" });
  assert.deepEqual(newsletterKeyLabel("teacher@school.edu|"), { sender: "teacher@school.edu", name: null });
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

test("a note reads as a list: each line, and each sentence in it, without the header or splitting p.m.", () => {
  const description = "From: office@school.org\nPlan: todo\nRef: picture day\nSender: Front Office\nPicture day is Oct. 9 at 8:30 a.m. in the gym. Wear the blue shirt!\n- Forms are due Friday.\nFor Ava and Liam.";
  assert.deepEqual(noteBullets(description), [
    "Picture day is Oct. 9 at 8:30 a.m. in the gym.",
    "Wear the blue shirt!",
    "Forms are due Friday.",
    "For Ava and Liam.",
  ]);
  assert.deepEqual(noteBullets(null), []);
});

test("an open item from a stopped sender never shows, whatever the case of the address", () => {
  const linkedin = { category: "school_email", description: "From: messages-noreply@linkedin.com\nPlan: todo\nRespond to Roderick." };
  assert.equal(fromStoppedSender(linkedin, ["Messages-NoReply@LinkedIn.com"]), true);
  assert.equal(fromStoppedSender(linkedin, ["news@school.org"]), false);
  assert.equal(fromStoppedSender({ category: "chore", description: "From: messages-noreply@linkedin.com\n" }, ["messages-noreply@linkedin.com"]), false);
});

test("a password reset is never a to-do, and a review request is one kind the family can stop", () => {
  assert.deepEqual(mailKindsOf({ subject: "Reset your password", text: "This link expires in 30 minutes.", from: "no-reply@accounts.example" }), ["account"]);
  assert.equal(kindKeptOut(["account"], []), true);
  assert.deepEqual(mailKindsOf({ subject: "Review your recent purchase", text: "How would you rate the rain boots?", from: "orders@shop.example" }), ["reviews"]);
  assert.equal(kindKeptOut(["reviews"], []), false);
  assert.equal(kindKeptOut(["reviews"], ["reviews"]), true);
  assert.deepEqual(mailKindsOf({ subject: "Respond to Roderick Lee's LinkedIn invitation", text: "", from: "messages-noreply@linkedin.com" }), ["social"]);
  assert.deepEqual(mailKindsOf({ subject: "Field trip permission slip", text: "Sign and return by Friday.", from: "teacher@school.org" }), []);
  assert.equal(sourceShortLabel("messages-noreply@linkedin.com", null, "mail"), "linkedin.com");
  assert.equal(sourceShortLabel("info@mail.greatoaksacademy.org", "Great Oaks Academy", "mail"), "Great Oaks Academy");
  assert.equal(sourceShortLabel("news@em.brushfire.com", null, "mail"), "brushfire.com");
  assert.equal(sourceShortLabel(null, null, "todo"), "To-do");
});

test("a blank in the stopped list never crashes Home", () => {
  const linkedin = { category: "school_email", description: "From: messages-noreply@linkedin.com\nPlan: todo\n" };
  assert.equal(fromStoppedSender(linkedin, [null as unknown as string, "messages-noreply@linkedin.com"]), true);
  assert.equal(fromStoppedSender(linkedin, [null as unknown as string]), false);
});

// A Wells Fargo statement stayed after Bills & subscriptions was stopped (2026-10-20).
test("statements and bills read as billing, in the mail's words or the to-do's", () => {
  for (const said of ["Review Wells Fargo statement", "Your Wells Fargo credit card statement is available", "View your eStatement", "American Express payment due", "Pay your Verizon bill", "Statement balance $1,234"]) {
    assert.ok(mailKindsOf({ subject: said }).includes("billing"), said);
  }
  for (const said of ["Pay for the field trip by Friday", "Review the report card with Ava", "Mission statement for the PTA", "Sign the zoo trip form"]) {
    assert.ok(!mailKindsOf({ subject: said }).includes("billing"), said);
  }
});

// "The U.S." and "government ordered..." became two bullets (2026-10-21).
test("initials and a lowercase next word don't end a bullet", () => {
  assert.deepEqual(noteBullets("Hackers breached OpenCode Console. The U.S. government ordered civilian agencies to remove DeepSeek AI. Meta's Muse AI app reached 10 million U.S. downloads in just 40 days. OpenAI outlined three endgames."), [
    "Hackers breached OpenCode Console.",
    "The U.S. government ordered civilian agencies to remove DeepSeek AI.",
    "Meta's Muse AI app reached 10 million U.S. downloads in just 40 days.",
    "OpenAI outlined three endgames.",
  ]);
  assert.deepEqual(noteBullets("Anthropic plans a fund. U.S. prosecutors revealed new ties. Meet in Washington, D.C. on Friday."), [
    "Anthropic plans a fund.",
    "U.S. prosecutors revealed new ties.",
    "Meet in Washington, D.C. on Friday.",
  ]);
  assert.deepEqual(noteBullets("Bring a lunch. Wear sneakers."), ["Bring a lunch.", "Wear sneakers."]);
});
