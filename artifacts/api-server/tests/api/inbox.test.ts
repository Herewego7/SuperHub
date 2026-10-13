import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * Inbox items across two households: opening the original email, Stop emails,
 * hiding a newsletter, and the one-time pass that gives old items an owner.
 */
describe("inbox across households", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;
  let ben: TestFamily;

  const note = (from: string, plan: string, extra = "") => `From: ${from}\nPlan: ${plan}\nRef: ${plan}-${Math.random()}\n${extra}Details.`;

  const inboxItem = async (who: TestFamily, title: string, description: string, profileIds = [who.profileId]) => {
    const row = await api.json<{ id: string }>(who, "/api/chores", {
      method: "POST",
      body: JSON.stringify({ title, description, category: "school_email", taskType: "todo", points: 0, daysOfWeek: [], profileIds }),
    });
    assert.ok(row?.id, `could not create ${title}`);
    return row.id;
  };

  const choreIds = async (who: TestFamily) => (await api.json<{ id: string }[]>(who, "/api/chores")).map((row) => row.id);

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
    ben = await api.createFamily("Ben");
    // No real mailbox is reachable from a test, so keep the background scan from trying.
    for (const who of [ava, ben]) {
      await api.as(who, "/api/calendar-settings/inbox", { method: "PATCH", body: JSON.stringify({ scanInbox: false }) });
    }
  });

  after(async () => {
    await api?.close();
  });

  test("an original email opens only for its own household, and only for its owner", async () => {
    const avas = await inboxItem(ava, "Sign the form", note("frontdesk@school.edu", "todo", `Mail: gmail:${ava.profileId}:abc123\n`));
    const forged = await inboxItem(ben, "Forged", note("frontdesk@school.edu", "todo", `Mail: gmail:${ava.profileId}:abc123\n`));

    const theirs = await api.as(ben, `/api/ingest/original?choreId=${avas}&viewer=${ben.profileId}`);
    assert.equal(theirs.status, 404, "Ben must not open Ava's email");
    const pointed = await api.as(ben, `/api/ingest/original?choreId=${forged}&viewer=${ben.profileId}`);
    assert.equal(pointed.status, 404, "a note naming another household's mailbox must not open it");

    const partner = await api.json<{ id: string }>(ava, "/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "Sam", color: "#22c55e", initials: "SA" }),
    });
    const notOwner = await api.as(ava, `/api/ingest/original?choreId=${avas}&viewer=${partner.id}`);
    assert.equal(notOwner.status, 403, "with Share originals off, only the mailbox owner opens it");

    const owner = await api.as(ava, `/api/ingest/original?choreId=${avas}&viewer=${ava.profileId}`);
    assert.equal(owner.status, 409, "the owner gets as far as their mailbox connection");
    assert.match((await owner.json()).error, /Reconnect/);
  });

  test("Stop emails clears that sender's open items in one household only, and undo lets mail back in", async () => {
    const open = await inboxItem(ava, "Picture day", note("office@school.edu", "todo"));
    const finished = await inboxItem(ava, "Book fair", note("office@school.edu", "keydate"));
    const coach = await inboxItem(ava, "Practice moved", note("coach@club.org", "todo"));
    const bens = await inboxItem(ben, "Ben's slip", note("office@school.edu", "todo"));
    const done = await api.as(ava, "/api/chore-completions", { method: "POST", body: JSON.stringify({ choreId: finished, profileId: ava.profileId, points: 0 }) });
    assert.ok(done.status < 300, `could not finish Book fair (${done.status})`);

    const stopped = await api.json<{ removed: number; mutedSenders: string[] }>(ava, "/api/ingest/mute", { method: "POST", body: JSON.stringify({ address: "Office@School.edu" }) });
    assert.equal(stopped.removed, 1);
    assert.deepEqual(stopped.mutedSenders, ["office@school.edu"]);
    const left = await choreIds(ava);
    assert.equal(left.includes(open), false, "the open item from that sender leaves");
    assert.ok(left.includes(finished), "a finished item stays in history");
    assert.ok(left.includes(coach), "another sender's item stays");
    assert.ok((await choreIds(ben)).includes(bens), "Ben's item from the same sender stays");
    assert.deepEqual((await api.json<{ mutedSenders: string[] }>(ben, "/api/calendar-settings")).mutedSenders, []);

    const undone = await api.json<{ mutedSenders: string[] }>(ava, "/api/ingest/unmute", { method: "POST", body: JSON.stringify({ address: "office@school.edu" }) });
    assert.deepEqual(undone.mutedSenders, []);
  });

  test("hiding a newsletter clears its issues and leaves the sender's to-dos", async () => {
    const issue = await inboxItem(ava, "Room 12 News 10/2", note("news@school.org", "newsletter", "Name: Room 12 News\n"));
    const todo = await inboxItem(ava, "Bring a jacket", note("news@school.org", "todo"));
    const hidden = await api.json<{ removed: number; mutedNewsletters: string[] }>(ava, "/api/ingest/newsletter/hide", {
      method: "POST",
      body: JSON.stringify({ address: "news@school.org", name: "Room 12 News" }),
    });
    assert.equal(hidden.removed, 1);
    assert.deepEqual(hidden.mutedNewsletters, ["news@school.org|room 12 news"]);
    const left = await choreIds(ava);
    assert.equal(left.includes(issue), false);
    assert.ok(left.includes(todo));
    const shown = await api.json<{ mutedNewsletters: string[] }>(ava, "/api/ingest/newsletter/show", {
      method: "POST",
      body: JSON.stringify({ key: "news@school.org|room 12 news" }),
    });
    assert.deepEqual(shown.mutedNewsletters, []);
  });

  test("old inbox items that went to everyone move to the mailbox owner, in that household only, once", async () => {
    const kid = await api.json<{ id: string }>(ava, "/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "Liv", color: "#f97316", initials: "LI", role: "child", isChild: true }),
    });
    const benKid = await api.json<{ id: string }>(ben, "/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "Max", color: "#f97316", initials: "MA", role: "child", isChild: true }),
    });
    const avaProfiles = (await api.json<{ id: string; isAllFamilyProfile?: boolean }[]>(ava, "/api/profiles")).filter((p) => !p.isAllFamilyProfile).map((p) => p.id);
    const benProfiles = (await api.json<{ id: string; isAllFamilyProfile?: boolean }[]>(ben, "/api/profiles")).filter((p) => !p.isAllFamilyProfile).map((p) => p.id);
    assert.ok(avaProfiles.includes(kid.id) && benProfiles.includes(benKid.id));
    const avas = await inboxItem(ava, "Everyone's slip", note("office@school.edu", "todo"), avaProfiles);
    const bens = await inboxItem(ben, "Ben's everyone slip", note("office@school.edu", "todo"), benProfiles);

    const { db } = await import("../../src/db.ts");
    const { googleCalendarTokens } = await import("@workspace/db");
    await db.insert(googleCalendarTokens).values({ profileId: ava.profileId, accessToken: "test-token", isActive: true });

    const { assignInboxOwners } = await import("../../src/ingest/owners.ts");
    await assignInboxOwners([ava.userId, ben.userId]);
    const rows = async (who: TestFamily) => api.json<{ id: string; profileIds: string[] }[]>(who, "/api/chores");
    assert.deepEqual((await rows(ava)).find((row) => row.id === avas)?.profileIds, [ava.profileId], "Ava's item goes to Ava, the mailbox owner");
    assert.deepEqual((await rows(ben)).find((row) => row.id === bens)?.profileIds.sort(), [...benProfiles].sort(), "Ben has no mailbox, so his stays");
    assert.equal(await assignInboxOwners([ava.userId, ben.userId]), 0, "a second pass changes nothing");
  });
});
