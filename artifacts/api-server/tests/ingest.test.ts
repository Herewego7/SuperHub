import assert from "node:assert/strict";
import test from "node:test";
import { emailTodoOnDay } from "../src/scheduler/eveningPlan.ts";
import { mailKindsOf, stoppedKinds } from "../src/ingest/mailKinds.ts";
import { acceptSchool, choresDismissedBySlip, deviceAlert, knownDomains, mailEventStart, prefilterDrop, dismissSlip, eventsDismissedBySlip, gmailScopeGranted, graphNextLink, holdSchoolEvent, inboxBlockReason, inboxFailure, inboxListStopped, inboxMailFailure, inboxScanEnabled, inboxTokenExpiry, ingestMessages, mailWorthSaving, muteSender, schoolEventStart, shareScan, slipDate, slipDayOffset, slipSender, withoutDismissedChores, withoutDismissedSlips } from "../src/ingest/process.ts";
import { clientMessages, fileParts, gmailInboxQuery, gmailNewsletterQuery, gmailPayload, gmailWebLink, inboxFetchLimit, inboxSinceIso, latestPerSender, mergeMailboxes, outlookAttachments, outlookToInbound, outlookWebLink, readableText, toInbound } from "../src/ingest/parse.ts";
import { inboxMailFailure, mailRateLimited, muteNewsletter, newsletterMuted, openLettersFrom, openMailFrom, politely, savedGmailIds, slipHeader, unmuteNewsletter, unmuteSender } from "../src/ingest/process.ts";
import { inboxOwnerFixes } from "../src/ingest/owners.ts";

test("a catch-up scan reads 30 days, and the regular check stays at 2", () => {
  assert.match(gmailInboxQuery(30), /^newer_than:30d /);
  assert.match(gmailInboxQuery(2), /^newer_than:2d /);
  assert.equal(inboxFetchLimit(30), 2000);
  assert.equal(inboxFetchLimit(2), 300);
  assert.match(gmailNewsletterQuery(), /newer_than:60d older_than:30d/);
  assert.match(gmailNewsletterQuery(), /unsubscribe/);
  const latest = latestPerSender([
    { fromAddress: "news@school.edu", subject: "This week" },
    { fromAddress: "news@school.edu", subject: "Last week" },
    { fromAddress: "coach@school.edu", subject: "Practice" },
  ]);
  assert.deepEqual(latest.map((message) => message.subject), ["This week", "Practice"]);
  assert.equal(inboxSinceIso(30, new Date("2026-10-05T12:00:00.000Z")), "2026-09-05T12:00:00.000Z");
});

test("the mail read reaches archived and filtered mail, and leaves out what the family sent", () => {
  const query = gmailInboxQuery(30);
  assert.doesNotMatch(query, /in:inbox/, "archived and filtered school mail was never downloaded");
  for (const skip of ["-in:chats", "-in:spam", "-in:trash", "-in:sent", "-in:drafts"]) assert.ok(query.includes(skip), `${skip} missing`);
});

test("a stored Google token is refreshed once it has expired", () => {
  assert.equal(inboxTokenExpiry("2020-01-01T00:00:00.000Z", true), Date.parse("2020-01-01T00:00:00.000Z"));
  assert.equal(inboxTokenExpiry(null, true), 0);
  assert.equal(inboxTokenExpiry(null, false), undefined);
});

test("scan stays on until someone turns it off", () => {
  assert.equal(inboxScanEnabled(undefined), true);
  assert.equal(inboxScanEnabled(null), true);
  assert.equal(inboxScanEnabled(true), true);
  assert.equal(inboxScanEnabled(false), false);
});

test("a gmail message becomes a slip with the subject and sender", () => {
  const message = toInbound({
    id: "m1",
    snippet: "Please sign &amp; return.",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Permission slip" },
        { name: "From", value: "Office <office@school.edu>" },
      ],
    },
  }, "chad");
  assert.equal(message.subject, "Permission slip");
  assert.equal(message.fromAddress, "office@school.edu");
  assert.equal(message.snippet, "Please sign & return.");
});

test("a gmail and an outlook message keep the sender's name, when it came, and where it lives", () => {
  const gmail = toInbound({
    id: "18f2a",
    internalDate: String(Date.UTC(2026, 9, 2, 14, 3)),
    payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: "Weekly" }, { name: "From", value: "\"Elizabeth Simonovich\" <es@school.edu>" }] },
  }, "chad@gmail.com");
  assert.equal(gmail.fromName, "Elizabeth Simonovich");
  assert.equal(gmail.provider, "gmail");
  assert.equal(gmail.messageId, "18f2a");
  assert.equal(gmail.receivedAt, "2026-10-02T14:03:00.000Z");
  const bare = toInbound({ id: "1", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "es@school.edu" }] } }, "chad");
  assert.equal(bare.fromName, undefined);
  const outlook = outlookToInbound({
    id: "AAMkAD=",
    subject: "Weekly",
    from: { emailAddress: { address: "es@school.edu", name: "Elizabeth Simonovich" } },
    receivedDateTime: "2026-10-02T14:03:00Z",
  }, "alex");
  assert.equal(outlook.fromName, "Elizabeth Simonovich");
  assert.equal(outlook.provider, "outlook");
  assert.equal(outlook.messageId, "AAMkAD=");
  assert.equal(outlook.receivedAt, "2026-10-02T14:03:00.000Z");
});

test("one email in both parents' mailboxes is read once and belongs to both", () => {
  const letter = { subject: "Oak Weekly", fromAddress: "news@school.org", snippet: "", accountId: "a", receivedAt: "2026-10-02T14:03:00.000Z" };
  const merged = mergeMailboxes([
    { ...letter, ownerProfileIds: ["dad"], messageId: "g1" },
    { ...letter, receivedAt: "2026-10-02T14:04:10.000Z", ownerProfileIds: ["mom"], messageId: "o1" },
    { ...letter, receivedAt: "2026-10-09T14:03:00.000Z", ownerProfileIds: ["dad"] },
    { ...letter, subject: "Re: Oak Weekly", ownerProfileIds: ["mom"] },
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0].ownerProfileIds, ["dad", "mom"]);
  assert.equal(merged[0].messageId, "g1");
  assert.deepEqual(merged[1].ownerProfileIds, ["dad"]);
  assert.deepEqual(merged[2].ownerProfileIds, ["mom"]);
});

test("mail sent in by the app cannot name a mailbox or a message", () => {
  const [row] = clientMessages([{ subject: "Hi", snippet: "", accountId: "x", ownerProfileIds: ["someone"], provider: "gmail", messageId: "theirs" }]);
  assert.equal(row.subject, "Hi");
  assert.equal("ownerProfileIds" in row || "provider" in row || "messageId" in row, false);
  assert.deepEqual(clientMessages("nope"), []);
});

test("stop emails picks the sender's open inbox items and nothing else, and undo lets mail back in", () => {
  const rows = [
    { id: "todo", category: "school_email", description: "From: office@school.edu\nPlan: todo\nRef: a\nSign it." },
    { id: "letter", category: "school_email", description: "From: Office@School.edu\nPlan: newsletter\nRef: b\nNews." },
    { id: "done", category: "school_email", description: "From: office@school.edu\nPlan: todo\nRef: c\nDone." },
    { id: "other", category: "school_email", description: "From: coach@club.org\nPlan: todo\nRef: d\nPractice." },
    { id: "mine", category: null, description: "From: office@school.edu\nA note I wrote." },
  ];
  assert.deepEqual(openMailFrom(rows, " OFFICE@school.edu ", new Set(["done"])), ["todo", "letter"]);
  const muted = muteSender({ mutedSenders: [], dismissedSlipKeys: [] }, "office@school.edu");
  assert.deepEqual(unmuteSender(muted, "Office@School.edu").mutedSenders, []);
});

test("hiding a newsletter skips its issues, keeps the sender's other mail, and clears older nameless issues", () => {
  const keys = muteNewsletter([], "News@School.org", "Room 12 News");
  assert.deepEqual(keys, ["news@school.org|room 12 news"]);
  assert.equal(newsletterMuted(keys, "news@school.org", "Room 12  news"), true);
  assert.equal(newsletterMuted(keys, "news@school.org", "PTA Notes"), false);
  assert.equal(newsletterMuted(keys, "news@school.org", ""), true);
  assert.equal(newsletterMuted(keys, "other@school.org", "Room 12 News"), false);
  assert.equal(newsletterMuted(muteNewsletter([], "news@school.org", ""), "news@school.org", "PTA Notes"), true);
  assert.deepEqual(unmuteNewsletter(keys, "news@school.org|room 12 news"), []);
  const rows = [
    { id: "named", category: "school_email", description: "From: news@school.org\nPlan: newsletter\nRef: a\nName: Room 12 News\nNews." },
    { id: "legacy", category: "school_email", description: "From: news@school.org\nPlan: newsletter\nRef: b\nNews." },
    { id: "pta", category: "school_email", description: "From: news@school.org\nPlan: newsletter\nRef: c\nName: PTA Notes\nNews." },
    { id: "todo", category: "school_email", description: "From: news@school.org\nPlan: todo\nRef: d\nName: Room 12 News\nSign it." },
    { id: "body", category: "school_email", description: "From: news@school.org\nPlan: newsletter\nRef: e\nWelcome back.\nName: Room 12 News" },
  ];
  assert.deepEqual(openLettersFrom(rows, "news@school.org", "Room 12 News", new Set()), ["named", "legacy", "body"]);
  assert.equal(slipHeader(rows[4].description).Name, undefined);
  const planned = ingestMessages(
    [
      { subject: "Room 12 weekly newsletter", fromAddress: "news@school.org", snippet: "Picture day Thursday.", accountId: "dad" },
      { subject: "Permission slip for the field trip", fromAddress: "news@school.org", snippet: "Please sign.", accountId: "dad" },
    ],
    { mutedSenders: [], dismissedSlipKeys: [], mutedNewsletters: keys },
    [],
    ["dad"],
  );
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Permission slip for the field trip"]);
});

test("read full email keeps paragraphs and only links to the mail provider", () => {
  assert.equal(readableText("<style>p{}</style><p>Hello &amp; welcome</p><ul><li>Bring a jacket</li><li>Lunch</li></ul>Bye<br>Ms. S"), "Hello & welcome\n\n• Bring a jacket\n• Lunch\n\nBye\nMs. S");
  assert.equal(outlookWebLink("https://outlook.office365.com/owa/?ItemID=abc"), "https://outlook.office365.com/owa/?ItemID=abc");
  assert.equal(outlookWebLink("https://evil.example/owa"), null);
  assert.equal(outlookWebLink("javascript:alert(1)"), null);
  assert.equal(gmailWebLink("chad@gmail.com", "18f2a"), "https://mail.google.com/mail/?authuser=chad%40gmail.com#all/18f2a");
  assert.equal(gmailWebLink("chad@gmail.com", "../x"), null);
});

test("inbox to-dos that went to everyone move to the mailbox owner, once", () => {
  const audience = ["mom", "dad", "liam"];
  const rows = [
    { id: "all", category: "school_email", profileIds: ["liam", "dad", "mom"] },
    { id: "gone", category: "school_email", profileIds: ["mom", "dad", "liam", "old-kid"] },
    { id: "handed", category: "school_email", profileIds: ["liam"] },
    { id: "chore", category: "chores", profileIds: ["mom", "dad", "liam"] },
  ];
  const fixes = inboxOwnerFixes(rows, audience, ["dad"]);
  assert.deepEqual(fixes, [{ id: "all", profileIds: ["dad"] }, { id: "gone", profileIds: ["dad"] }]);
  const after = rows.map((row) => ({ ...row, profileIds: fixes.find((fix) => fix.id === row.id)?.profileIds ?? row.profileIds }));
  assert.deepEqual(inboxOwnerFixes(after, audience, ["dad"]), []);
  assert.deepEqual(inboxOwnerFixes(rows, audience, []), []);
  assert.deepEqual(inboxOwnerFixes(rows, ["mom", "dad"], ["mom", "dad"]), []);
  assert.deepEqual(inboxOwnerFixes(rows, ["dad"], ["dad"]), []);
});

test("an outlook next page is only followed on Microsoft's host", () => {
  assert.equal(
    graphNextLink("https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc"),
    "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc",
  );
  assert.equal(graphNextLink("https://evil.example/steal"), null);
  assert.equal(graphNextLink("http://graph.microsoft.com/v1.0/me/messages"), null);
});

test("a later inbox page keeps the messages already listed", () => {
  assert.equal(inboxListStopped(new Error("timeout"), 50), true);
  assert.equal(inboxListStopped(new Error("timeout"), 0), false);
  assert.equal(inboxListStopped({ code: 401 }, 50), false);
});

test("one bad inbox message is skipped and a refused account reconnects", () => {
  assert.equal(inboxFailure(new Error("parse")), "skip");
  assert.equal(inboxFailure({ code: 404 }), "skip");
  assert.equal(inboxFailure({ response: { status: 401 } }), "reconnect");
  assert.equal(inboxFailure({ code: 403 }), "reconnect");
  assert.equal(inboxMailFailure({ response: { status: 401 } }), "auth");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }), "scope");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { errors: [{ reason: "accessNotConfigured" }] } } } }), "unavailable");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { status: "PERMISSION_DENIED", message: "Gmail API has not been used in project 1 before or it is disabled." } } } }), "unavailable");
  assert.equal(inboxMailFailure({ response: { status: 403, data: { error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." } } } }), "scope");
  assert.equal(gmailScopeGranted(["https://www.googleapis.com/auth/calendar"]), false);
  assert.equal(gmailScopeGranted(["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/gmail.readonly"]), true);
  assert.equal(gmailScopeGranted(undefined), null);
  assert.equal(inboxBlockReason(["scope", "auth"]), "scope");
  assert.equal(inboxBlockReason(["ok", "scope"]), "ok");
  assert.equal(inboxBlockReason([]), "none");
});

test("five pictures are kept and a ninth megabyte is not", () => {
  const parts = [1, 2, 3, 4, 5, 6].map((n) => ({
    mimeType: "image/png",
    filename: `f${n}.png`,
    body: { attachmentId: String(n), size: 1000 },
  }));
  parts.push({ mimeType: "application/pdf", filename: "big.pdf", body: { attachmentId: "big", size: 9 * 1024 * 1024 } });
  const kept = fileParts({ mimeType: "multipart/mixed", parts });
  assert.deepEqual(kept.map((file) => file.filename), ["f1.png", "f2.png", "f3.png", "f4.png", "f5.png"]);
  const outlook = outlookAttachments([
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, "@odata.type": "#microsoft.graph.fileAttachment", contentType: "image/jpeg", size: 1000, isInline: false, contentBytes: "YQ==" })),
    { id: "big", "@odata.type": "#microsoft.graph.fileAttachment", contentType: "application/pdf", size: 9 * 1024 * 1024, isInline: false },
  ]);
  assert.equal(outlook.length, 5);
  assert.equal(outlook.some((file) => file.id === "big"), false);
});

test("a long email body is kept past the old four thousand characters", () => {
  const body = `${"Bring a jacket. ".repeat(400)}Thursday at 3:30 PM.`;
  const message = toInbound({
    id: "long",
    snippet: "See the note.",
    payload: { mimeType: "text/plain", body: { data: Buffer.from(body).toString("base64url") } },
  }, "chad");
  assert.ok((message.body ?? "").length > 4000);
  assert.match(message.body ?? "", /Thursday at 3:30 PM/);
});

test("a gmail payload keeps the body the scan used to drop", () => {
  const payload = gmailPayload({
    mimeType: "multipart/alternative",
    headers: [
      { name: "Subject", value: "Picture day" },
      { name: "From", value: "Office <office@school.edu>" },
    ],
    parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Thursday at 3:30 PM.").toString("base64url") } }],
  });
  const message = toInbound({ id: "m", snippet: "See the note.", payload }, "chad");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /3:30 PM/);
});

test("a time written only in the email body still becomes an event", () => {
  const message = toInbound({
    id: "m2",
    snippet: "See the note.",
    payload: {
      mimeType: "multipart/alternative",
      parts: [{
        mimeType: "text/plain",
        body: { data: Buffer.from("Picture day is Thursday at 3:30 PM.").toString("base64url") },
      }],
    },
  }, "chad");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /Thursday at 3:30 PM/);
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: message.snippet, body: message.body, accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events.length, 1);
  assert.equal(planned.events[0]?.hours, 15);
  assert.equal(planned.events[0]?.minutes, 30);
  assert.match(planned.todos[0]?.description ?? "", /See the note\.\n\nPicture day is Thursday/);
});

test("two scans of one household share one read", async () => {
  let started = 0;
  const inflight = new Map<string, Promise<number>>();
  const start = () => {
    started += 1;
    return new Promise<number>((resolve) => setTimeout(() => resolve(started), 20));
  };
  const first = shareScan(inflight, "home", start);
  const second = shareScan(inflight, "home", start);
  assert.equal(first, second);
  assert.equal(await first, 1);
  assert.equal(started, 1);
});

test("an outlook time written only in the body still becomes an event", () => {
  const message = outlookToInbound({
    subject: "Picture day",
    bodyPreview: "See the note.",
    body: { contentType: "html", content: "<p>Picture day is Thursday at 3:30 PM.</p>" },
    from: { emailAddress: { address: "office@school.edu" } },
  }, "alex");
  assert.equal(message.snippet, "See the note.");
  assert.match(message.body ?? "", /Thursday at 3:30 PM/);
  const planned = ingestMessages(
    [message],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events[0]?.hours, 15);
  assert.match(planned.todos[0]?.description ?? "", /See the note\.\n\nPicture day is Thursday/);
});

test("an outlook message becomes a slip with the subject and sender", () => {
  const message = outlookToInbound({
    subject: "Picture day",
    bodyPreview: "Wear a blue shirt &amp; smile.",
    from: { emailAddress: { address: "Office <office@school.edu>" } },
  }, "alex");
  assert.equal(message.subject, "Picture day");
  assert.equal(message.fromAddress, "office@school.edu");
  assert.equal(message.snippet, "Wear a blue shirt & smile.");
});

test("a store receipt stays out and a practice note stays", () => {
  const planned = ingestMessages(
    [
      { subject: "Your package was delivered", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today.", accountId: "chad" },
      { subject: "Soccer practice moved", fromAddress: "coach@gmail.com", snippet: "Thursday at 5:30 PM.", accountId: "chad" },
    ],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(mailWorthSaving({ subject: "Your package was delivered", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today." }), false);
  assert.deepEqual(planned.todos.map((todo) => todo.title), ["Soccer practice moved"]);
  assert.equal(planned.events[0]?.hours, 17);
  const game = ingestMessages(
    [{ subject: "Soccer game moved", fromAddress: "coach@gmail.com", snippet: "Thursday at 4:00 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.deepEqual(game.todos.map((todo) => todo.title), ["Soccer game moved"]);
  assert.equal(mailWorthSaving({ subject: "Track your package", fromAddress: "shipment-tracking@amazon.com", snippet: "Arriving today." }), false);
});

test("a saved slip with no calendar event gets the event on the next scan", () => {
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "See the note.", body: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    ["picture day"],
    ["liam"],
    [],
  );
  assert.equal(planned.todos.length, 0);
  assert.equal(planned.events[0]?.hours, 15);
  const held = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    ["picture day"],
    ["liam"],
    ["picture day"],
  );
  assert.equal(held.events.length, 0);
  const again = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: ["picture day"] },
    [],
    ["liam"],
    [],
  );
  assert.equal(again.events.length, 0);
  const removed = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: holdSchoolEvent([], "picture day") },
    ["picture day"],
    ["liam"],
    [],
  );
  assert.equal(removed.events.length, 0);
  assert.equal(withoutDismissedChores([{ title: "Picture day", category: "school_email" }], holdSchoolEvent([], "picture day")).length, 1);
});

test("two copies of the same slip from two adults become one to-do", () => {
  const planned = ingestMessages(
    [
      { subject: "Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Please sign and return.", accountId: "chad" },
      { subject: "Re: Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Please sign and return.", accountId: "alex" },
    ],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.todos.length, 1);
  assert.equal(planned.todos[0]?.category, "school_email");
  assert.equal(slipSender(planned.todos[0]?.description), "office@school.edu");
  assert.equal(planned.events.length, 0);
  const owned = ingestMessages(
    [
      { subject: "Picture day", fromAddress: "office@school.edu", fromName: "Front Office", snippet: "Thursday at 9:00 AM.", accountId: "chad", ownerProfileIds: ["dad"], provider: "gmail", messageId: "m1" },
      { subject: "Re: Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 9:00 AM.", accountId: "alex", ownerProfileIds: ["mom"] },
    ],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["mom", "dad", "liam"],
  );
  assert.deepEqual(owned.todos[0]?.profileIds, ["dad", "mom"]);
  assert.deepEqual(owned.events[0]?.profileIds, ["dad", "mom"]);
  assert.equal(slipSender(owned.todos[0]?.description), "office@school.edu");
  assert.match(owned.todos[0]?.description ?? "", /\nSender: Front Office\n/);
  assert.match(owned.todos[0]?.description ?? "", /\nMail: gmail:dad:m1\n/);
});

test("accepting a school twice leaves one name on the person", () => {
  const first = acceptSchool(null, "Lincoln Elementary");
  assert.equal(acceptSchool(first, "Lincoln Elementary"), "Lincoln Elementary");
  assert.equal(acceptSchool(first, "Washington High"), "Lincoln Elementary");
});

test("a muted sender and a dismissed slip stay off the household list", () => {
  const muted = muteSender({ mutedSenders: [], dismissedSlipKeys: [] }, "Office@school.edu");
  const dismissed = dismissSlip(muted, "picture day");
  const planned = ingestMessages(
    [
      { subject: "Permission slip for the field trip", fromAddress: "office@school.edu", snippet: "Sign this.", accountId: "chad" },
      { subject: "Picture day", fromAddress: "other@school.edu", snippet: "Thursday at 9:00 AM.", accountId: "chad" },
    ],
    dismissed,
    [],
    ["liam"],
  );
  assert.equal(planned.todos.length, 0);
});

test("a slip clock is the event time", () => {
  const planned = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(planned.events[0]?.hours, 15);
  assert.equal(planned.events[0]?.minutes, 30);
  const replyBy = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00 AM. Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(replyBy.events[0]?.hours, 15);
  const ranged = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00 AM. Thursday 3:30-5:00 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(ranged.events[0]?.hours, 15);
  assert.equal(ranged.events[0]?.endHours, 17);
  assert.equal(ranged.events[0]?.endMinutes, 0);
  const replyRange = ingestMessages(
    [{ subject: "Picture day", fromAddress: "office@school.edu", snippet: "Reply by 9:00-10:00 AM. Thursday at 3:30 PM.", accountId: "chad" }],
    { mutedSenders: [], dismissedSlipKeys: [] },
    [],
    ["liam"],
  );
  assert.equal(replyRange.events[0]?.hours, 15);
  assert.equal(replyRange.events[0]?.endHours, undefined);
});

test("a named weekday is the next time that day comes", () => {
  const thursday = new Date(2026, 9, 1);
  assert.equal(slipDayOffset("Thursday at 3:30 PM", thursday), 0);
  assert.equal(slipDayOffset("Friday at 3:30 PM", thursday), 1);
  assert.equal(slipDayOffset("Wednesday at 3:30 PM", thursday), 6);
  assert.equal(slipDayOffset("at 3:30 PM", thursday), null);
  assert.equal(slipDayOffset("next Friday at 3:30 PM", new Date(2026, 9, 2)), 7);
  assert.equal(slipDayOffset("next Friday at 3:30 PM", thursday), 1);
});

test("a written month and day is that calendar date", () => {
  const thursday = new Date(2026, 9, 1);
  const oct8 = slipDate("Picture day October 8 at 3:30 PM", thursday);
  assert.equal(oct8?.getFullYear(), 2026);
  assert.equal(oct8?.getMonth(), 9);
  assert.equal(oct8?.getDate(), 8);
  const past = slipDate("January 2", thursday);
  assert.equal(past?.getFullYear(), 2027);
  assert.equal(slipDate("Thursday at 3:30", thursday), null);
  const numeric = slipDate("Picture day 10/8 at 3:30 PM", thursday);
  assert.equal(numeric?.getFullYear(), 2026);
  assert.equal(numeric?.getMonth(), 9);
  assert.equal(numeric?.getDate(), 8);
  assert.equal(slipDate("10/8/2025", thursday)?.getFullYear(), 2025);
  const late = schoolEventStart("Thursday at 3:30 PM", 15, 30, new Date("2026-10-01T03:00:00.000Z"), "America/Chicago");
  assert.equal(late.toISOString(), "2026-10-01T20:30:00.000Z");
  const today = schoolEventStart("Picture day today at 3:30 PM", 15, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(today.toISOString(), "2026-10-01T20:30:00.000Z");
  const tonight = schoolEventStart("Picture day tonight at 6:30 PM", 18, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(tonight.toISOString(), "2026-10-01T23:30:00.000Z");
  const evening = schoolEventStart("Picture day this evening at 6:30 PM", 18, 30, new Date("2026-10-01T20:00:00.000Z"), "America/Chicago");
  assert.equal(evening.toISOString(), "2026-10-01T23:30:00.000Z");
  const laterToday = schoolEventStart("Picture day at 3:30 PM", 15, 30, new Date("2026-10-01T15:00:00.000Z"), "America/Chicago");
  assert.equal(laterToday.toISOString(), "2026-10-01T20:30:00.000Z");
  const alreadyPassed = schoolEventStart("Picture day at 3:30 PM", 15, 30, new Date("2026-10-01T21:00:00.000Z"), "America/Chicago");
  assert.equal(alreadyPassed.toISOString(), "2026-10-02T20:30:00.000Z");
  const tomorrow = schoolEventStart("Picture day tomorrow at 3:30 PM", 15, 30, new Date("2026-10-01T15:00:00.000Z"), "America/Chicago");
  assert.equal(tomorrow.toISOString(), "2026-10-02T20:30:00.000Z");
});

test("not relevant drops the slip already on Home", () => {
  const ids = choresDismissedBySlip(
    [
      { id: "a", title: "Re: Permission slip for the field trip", category: "school_email" },
      { id: "b", title: "Feed the dog", category: "chore" },
    ],
    "permission slip for the field trip",
  );
  assert.deepEqual(ids, ["a"]);
  const eventIds = eventsDismissedBySlip(
    [
      { id: "evt", title: "Permission slip for the field trip", source: "school", externalId: "permission slip for the field trip" },
      { id: "soccer", title: "Soccer", source: "app", externalId: null },
    ],
    "permission slip for the field trip",
  );
  assert.deepEqual(eventIds, ["evt"]);
  const still = withoutDismissedSlips(
    [
      { title: "Permission slip for the field trip", source: "school", externalId: "permission slip for the field trip" },
      { title: "Soccer", source: "app", externalId: null },
    ],
    ["permission slip for the field trip"],
  );
  assert.deepEqual(still.map((event) => event.title), ["Soccer"]);
  const choresLeft = withoutDismissedChores(
    [
      { title: "Permission slip for the field trip", category: "school_email" },
      { title: "Feed the dog", category: "chore" },
    ],
    ["permission slip for the field trip"],
  );
  assert.deepEqual(choresLeft.map((chore) => chore.title), ["Feed the dog"]);
});

test("a security or device alert is never a to-do or an event, even with a time in it", () => {
  assert.equal(deviceAlert({ subject: "Front Door Left Open Alert", fromAddress: "notifications@alarm.com" }), true);
  assert.equal(deviceAlert({ subject: "Front Door Left Open", fromAddress: "someone@gmail.com" }), true);
  assert.equal(deviceAlert({ subject: "Motion detected at Front Porch", fromAddress: "no-reply@ring.com" }), true);
  assert.equal(deviceAlert({ subject: "Picture day is Tuesday at 8:30 AM", fromAddress: "office@greatoaksacademy.org" }), false);
  assert.equal(deviceAlert({ subject: "Soccer practice opened up a 5:30 PM slot", fromAddress: "coach@teamsnap.com" }), false);
});

test("delivery, order, and receipt mail is never an event, and school mail that mentions delivery still is", () => {
  assert.equal(deviceAlert({ subject: "Your package has been delivered", fromAddress: "shipment-tracking@amazon.com" }), true);
  assert.equal(deviceAlert({ subject: "Delivered: Kids rain boots", fromAddress: "store@example-shop.com" }), true);
  assert.equal(deviceAlert({ subject: "Out for delivery today by 8 PM", fromAddress: "mcinfo@ups.com" }), true);
  assert.equal(deviceAlert({ subject: "Order confirmed: pizza night", fromAddress: "orders@pizza.example" }), true);
  assert.equal(deviceAlert({ subject: "Report cards will be delivered Friday at 3 PM", fromAddress: "office@greatoaksacademy.org" }), false);
  assert.equal(deviceAlert({ subject: "Your trip to Denver: check in at 7 AM", fromAddress: "alerts@united.com" }), false);
});

test("a time that had passed when the email was sent is a report, not an event", () => {
  const tz = "America/Chicago";
  const now = new Date("2026-10-13T15:00:00Z"); // 10 AM in Chicago
  const sent = new Date("2026-10-13T05:30:00Z"); // 12:30 AM in Chicago
  assert.equal(mailEventStart("Front door opened at 12:26 AM", 0, 26, sent, now, tz), null, "already happened when sent");
  assert.equal(mailEventStart("Delivered at 9:14 AM", 9, 14, new Date("2026-10-13T14:20:00Z"), now, tz), null);
  const later = mailEventStart("Practice moved to 5:30 PM", 17, 30, sent, now, tz);
  assert.equal(later?.toISOString(), "2026-10-13T22:30:00.000Z", "a time later that day is still an event");
  assert.equal(mailEventStart("Picture day 10/9 at 8:30 AM", 8, 30, sent, now, tz), null, "a dated event that is over is dropped");
  assert.equal(mailEventStart("Game tomorrow at 9 AM", 9, 0, sent, now, tz)?.toISOString(), "2026-10-14T14:00:00.000Z");
});

test("password resets never become to-dos, and a stopped kind is skipped from any sender", () => {
  const state = { mutedSenders: [], dismissedSlipKeys: [] as string[] };
  const reset = { id: "r", accountId: "a", subject: "Reset your password", snippet: "Click to reset your password. This link expires in 1 hour.", body: "", fromAddress: "no-reply@school.org" };
  assert.deepEqual(ingestMessages([reset], state, [], ["mom"]).todos, []);
  const review = { id: "v", accountId: "a", subject: "How did we do? Review your purchase", snippet: "Rate the soccer cleats you ordered for practice.", body: "", fromAddress: "reviews@shop.example" };
  assert.equal(ingestMessages([review], state, [], ["mom"]).todos.length, 1, "kept until the family stops reviews");
  assert.deepEqual(ingestMessages([review], { ...state, dismissedSlipKeys: ["kind:reviews"] }, [], ["mom"]).todos, []);
  assert.deepEqual(mailKindsOf({ subject: "Chad, you have 3 new invitations", text: "", from: "invitations@linkedin.com" }), ["social"]);
  assert.deepEqual(mailKindsOf({ subject: "Picture day is Friday", text: "Bring a smile.", from: "office@school.org" }), []);
  assert.deepEqual(stoppedKinds(["kind:reviews", "picture day", "kind:nope"]), ["reviews"]);
});

test("the keyword reader also skips a deadline missed before the mail was read", () => {
  const state = { mutedSenders: [], dismissedSlipKeys: [] as string[] };
  const old = { id: "o", accountId: "a", subject: "Field trip form due 10/5", snippet: "Please sign the permission slip.", body: "", fromAddress: "teacher@school.org", receivedAt: new Date(2026, 9, 1, 8).toISOString() };
  assert.deepEqual(ingestMessages([old], state, [], ["mom"], [], [], new Date(2026, 9, 20, 9)).todos, []);
  assert.equal(ingestMessages([old], state, [], ["mom"], [], [], new Date(2026, 9, 2, 9)).todos.length, 1, "read the next day, it still counts");
});

test("shopping and Promotions-tab bulk mail are dropped before any model reads them, but a school or known sender never is", () => {
  assert.equal(prefilterDrop({ fromAddress: "store-news@amazon.com" }), "promotion");
  assert.equal(prefilterDrop({ fromAddress: "deals@shop.example", labels: ["CATEGORY_PROMOTIONS", "INBOX"], bulk: true }), "promotion");
  assert.equal(prefilterDrop({ fromAddress: "deals@shop.example", labels: ["CATEGORY_PROMOTIONS"] }), null, "Promotions without a list header is read");
  assert.equal(prefilterDrop({ fromAddress: "me@gmail.com", labels: ["SENT"] }), "ownOutgoing");
  assert.equal(prefilterDrop({ fromAddress: "news@greatoaksacademy.org", labels: ["CATEGORY_PROMOTIONS"], bulk: true }), null, "a school domain is always read");
  assert.equal(prefilterDrop({ fromAddress: "noreply@teamsnap.com", labels: ["CATEGORY_PROMOTIONS"], bulk: true }), null);
  const mailchimp = { fromAddress: "us1@mcsv.net", labels: ["CATEGORY_PROMOTIONS"], bulk: true, subject: "Eagle News", snippet: "This week at Great Oaks Academy" };
  assert.equal(prefilterDrop(mailchimp), "promotion");
  assert.equal(prefilterDrop(mailchimp, { schools: ["Great Oaks Academy"] }), null, "a newsletter that names a kid's school is read");
  assert.equal(prefilterDrop(mailchimp, { domains: ["mcsv.net"] }), null, "a site that sent something kept before is read");
  assert.deepEqual(knownDomains([{ category: "school_email", description: "From: us1@mcsv.net\n" }, { category: "school_email", description: "From: x@amazon.com\n" }]), ["mcsv.net"]);
});

test("a Gmail message keeps its tab labels and whether it was sent to a list", () => {
  const inbound = toInbound({
    id: "g1",
    labelIds: ["CATEGORY_PROMOTIONS", "INBOX"],
    payload: { headers: [{ name: "From", value: "Shop <deals@shop.example>" }, { name: "Subject", value: "Sale" }, { name: "List-Unsubscribe", value: "<mailto:u@shop.example>" }] },
  }, "acct");
  assert.deepEqual(inbound.labels, ["CATEGORY_PROMOTIONS", "INBOX"]);
  assert.equal(inbound.bulk, true);
});

test("the evening plan lists only the email to-dos Home will show that day", () => {
  const tz = "America/Chicago";
  const lunch = { title: "Sack lunch", description: "From: office@school.org\nPlan: todo\nType: bring\nRef: x\nBring a sack lunch. Due 10/21/2026.", category: "school_email" };
  const linkedin = { title: "Respond to LinkedIn", description: "From: messages-noreply@linkedin.com\nPlan: todo\nRef: y\nSent: 2026-10-10T15:00:00.000Z\nWaiting for you.", category: "school_email" };
  const typed = { title: "Buy milk", description: null, category: null };
  assert.equal(emailTodoOnDay(lunch, "2026-10-21", "2026-10-20", tz), true, "a lunch is on its day");
  assert.equal(emailTodoOnDay(lunch, "2026-10-23", "2026-10-20", tz), false);
  assert.equal(emailTodoOnDay(linkedin, "2026-10-21", "2026-10-20", tz), false, "an old undated inbox item is not tomorrow's");
  assert.equal(emailTodoOnDay(typed, "2026-10-21", "2026-10-20", tz), true);
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


// A 500-message cap left a busy inbox's older mail unread, and Gmail's
// "slow down" read as a missing permission (2026-10-21).
test("mail already saved as an item isn't downloaded again, but a placeholder's is", () => {
  const rows = [
    { description: "From: a@school.org\nPlan: todo\nRef: r1\nMail: gmail:dad:m1\nSign the form." },
    { description: "From: a@school.org\nPlan: keydate\nRef: r2\nMail: gmail:mom:m2\nPicture day." },
    { description: "From: b@shop.com\nMail: gmail:dad:m3\nSubject placeholder." },
    { description: "From: c@x.com\nPlan: todo\nRef: r4\nMail: outlook:dad:m4\nOutlook item." },
  ];
  assert.deepEqual([...savedGmailIds(rows, "dad")], ["m1"]);
  assert.deepEqual([...savedGmailIds(rows, "mom")], ["m2"]);
});

test("a rate limit is not a missing permission, and is waited out", async () => {
  const limited403 = { response: { status: 403, data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } } };
  const quota429 = { response: { status: 429 } };
  const scope403 = { response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } };
  assert.equal(mailRateLimited(limited403), true);
  assert.equal(mailRateLimited(quota429), true);
  assert.equal(mailRateLimited(scope403), false);
  assert.equal(inboxMailFailure(limited403), "skip", "a 403 rate limit doesn't ask to reconnect");
  assert.equal(inboxMailFailure(scope403), "scope");

  let calls = 0;
  const answer = await politely(async () => {
    calls += 1;
    if (calls < 3) throw quota429;
    return "read";
  }, [1, 1, 1]);
  assert.equal(answer, "read");
  assert.equal(calls, 3);
  await assert.rejects(politely(async () => { throw scope403; }, [1]), "other errors aren't retried");
});

// The regular check re-read every recent email that made no item, each time
// the app opened (2026-10-21). Read mail is remembered; failed reads aren't.
test("every email read is remembered in each mailbox it came from, except failed reads", async () => {
  const { readMailRows } = await import("../src/ingest/scanHousehold.ts");
  const mail = (id: string, provider: "gmail" | "outlook", owner: string, subject: string) => ({
    subject, fromAddress: "news@school.org", snippet: "", body: "", provider, messageId: id, ownerProfileIds: [owner],
  });
  const listed = [
    mail("g1", "gmail", "dad", "Picture day"),
    mail("g2", "gmail", "mom", "Picture day"),
    mail("o1", "outlook", "mom", "Lunch menu"),
    mail("g3", "gmail", "dad", "Field trip form"),
    { subject: "No id", fromAddress: "x@y.com", snippet: "", body: "", ownerProfileIds: ["dad"] },
  ];
  const failed = [mail("g3", "gmail", "dad", "Field trip form")];
  assert.deepEqual(readMailRows(listed, failed), [
    { ownerProfileId: "dad", provider: "gmail", messageId: "g1" },
    { ownerProfileId: "mom", provider: "gmail", messageId: "g2" },
    { ownerProfileId: "mom", provider: "outlook", messageId: "o1" },
  ]);
});
