import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * Can family A reach family B's data?
 *
 * One test per cross-tenant defect found in September 2026. Every one of them
 * was found by reading code, because nothing in the existing 300+ tests could
 * see them: the browser suite mocks the API and the unit tests never start
 * Express against a database.
 *
 * These run against the REAL app and a REAL Postgres. They are the only tests
 * in this repo that can fail for the reason that actually matters here.
 */

describe("tenant isolation", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let alice: TestFamily;
  let bob: TestFamily;

  before(async () => {
    api = await startApiHarness();
    // Two entirely separate households, created through the real signup and
    // profile routes so they are owned exactly as real ones are.
    alice = await api.createFamily("Ava");
    bob = await api.createFamily("Ben");
    assert.notEqual(alice.userId, bob.userId, "the two families must be distinct accounts");
  });

  after(async () => {
    await api?.close();
  });

  test("a family's profiles are not visible to another family", () => {
    // The baseline property everything else depends on. If this ever fails,
    // nothing below is meaningful.
    return (async () => {
      const seen = await api.json<any[]>(bob, "/api/profiles");
      const ids = seen.map((p) => p.id);
      assert.ok(!ids.includes(alice.profileId), "Bob must not see Ava's profile");
    })();
  });

  test("calendar assignments do not leak across families", async () => {
    // THE DEFECT: the ownership check lived inside `if (profileId)`, so
    // omitting the query parameter skipped authorization entirely and
    // returned every family's rows — calendar names, real email addresses
    // and profile ids — to any signed-in caller.
    await api.as(alice, "/api/calendar-assignments", {
      method: "POST",
      body: JSON.stringify({
        profileId: alice.profileId,
        calendarType: "google",
        calendarId: "ava-private@group.calendar.google.com",
        calendarName: "Ava's private calendar",
        emailAddress: "ava-private@example.test",
      }),
    });

    const asBob = await api.json<any[]>(bob, "/api/calendar-assignments");
    const body = JSON.stringify(asBob);

    assert.ok(
      !body.includes("ava-private@group.calendar.google.com"),
      "Bob must not see Ava's calendar id",
    );
    assert.ok(!body.includes("ava-private@example.test"), "Bob must not see Ava's email address");
    assert.ok(!body.includes(alice.profileId), "Bob must not see Ava's profile id");

    // And the owner still sees their own — a fix that returns nothing to
    // anybody would pass the assertions above while breaking the feature.
    const asAlice = await api.json<any[]>(alice, "/api/calendar-assignments");
    assert.ok(
      JSON.stringify(asAlice).includes("ava-private@group.calendar.google.com"),
      "Ava must still see her own assignment",
    );
  });

  test("requesting another family's profile by id is refused", async () => {
    const res = await api.as(bob, `/api/calendar-assignments?profileId=${alice.profileId}`);
    assert.equal(res.status, 403, "naming another family's profile must be forbidden");
  });

  test("one family's location settings cannot overwrite another's", async () => {
    // THE DEFECT: the update located its row with a bare SELECT ... LIMIT 1
    // and then stamped the caller's userId onto whatever came back, so one
    // family's save overwrote another's row and left them with none.
    await api.as(alice, "/api/location-settings", {
      method: "PUT",
      body: JSON.stringify({ city: "Farmington", state: "MN", country: "United States" }),
    });
    await api.as(bob, "/api/location-settings", {
      method: "PUT",
      body: JSON.stringify({ city: "Denver", state: "CO", country: "United States" }),
    });

    const aliceSettings = await api.json<any>(alice, "/api/location-settings");
    const bobSettings = await api.json<any>(bob, "/api/location-settings");

    assert.equal(aliceSettings?.city, "Farmington", "Ava's city must survive Ben's save");
    assert.equal(bobSettings?.city, "Denver", "Ben must keep his own city");
  });

  test("one family's calendar settings cannot overwrite another's", async () => {
    await api.as(alice, "/api/calendar-settings", {
      method: "PUT",
      body: JSON.stringify({ startHour: 6, endHour: 20 }),
    });
    await api.as(bob, "/api/calendar-settings", {
      method: "PUT",
      body: JSON.stringify({ startHour: 9, endHour: 17 }),
    });

    const aliceSettings = await api.json<any>(alice, "/api/calendar-settings");
    const bobSettings = await api.json<any>(bob, "/api/calendar-settings");

    assert.equal(aliceSettings?.startHour, 6, "Ava's calendar hours must survive Ben's save");
    assert.equal(bobSettings?.startHour, 9, "Ben must keep his own calendar hours");
  });

  test("two-way sync is a per-family setting, not a global one", async () => {
    // THE DEFECT: isTwoWaySyncEnabled read the same unscoped row, so
    // whichever family sorted first governed whether EVERY family's private
    // events were pushed into an external Google or Outlook account.
    //
    // ⚠️ Ben's value is set explicitly first. two_way_sync_enabled defaults
    // to TRUE in the schema, so asserting on a family that never touched the
    // setting would be reading the default, not testing for a leak — which
    // is exactly what the first version of this test did.
    await api.as(bob, "/api/calendar-settings/two-way-sync", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    await api.as(alice, "/api/calendar-settings/two-way-sync", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });

    const bobSettings = await api.json<any>(bob, "/api/calendar-settings");
    const aliceSettings = await api.json<any>(alice, "/api/calendar-settings");
    assert.equal(
      bobSettings?.twoWaySyncEnabled,
      false,
      "Ben's two-way sync must stay off when Ava turns hers on",
    );
    assert.equal(aliceSettings?.twoWaySyncEnabled, true, "Ava must keep her own setting");
  });

  test("an unauthenticated caller reaches nothing", async () => {
    for (const path of ["/api/profiles", "/api/calendar-assignments", "/api/location-settings"]) {
      const res = await api.as(null, path);
      assert.equal(res.status, 401, `${path} must require authentication`);
    }
  });

  test("a household cannot sign, read or attach another's uploaded object", async () => {
    // ⚠️ REPLACES a vacuous test. The first version signed
    // "/objects/uploads/does-not-exist" and asserted the response was not 200
    // — which is true for a nonexistent object whatever the signature says,
    // so it passed without proving any ownership isolation at all. A REAL
    // uploaded object is the only way to test this.
    const avasObject = await api.uploadObject(alice);

    // Ava can use her own, end to end.
    const hers = await api.json<{ url: string }>(alice, "/api/objects/sign", {
      method: "POST",
      body: JSON.stringify({ path: avasObject }),
    });
    assert.ok(hers?.url?.includes("sig="), "Ava should be able to sign her own object");
    assert.equal((await api.as(null, hers.url)).status, 200, "Ava's signed URL must work");

    // Ben cannot get a signature for it.
    const bensAttempt = await api.as(bob, "/api/objects/sign", {
      method: "POST",
      body: JSON.stringify({ path: avasObject }),
    });
    assert.ok(
      bensAttempt.status === 403 || bensAttempt.status === 404,
      `Ben must not be able to sign Ava's object (got ${bensAttempt.status})`,
    );

    // And he cannot reach it by attaching it to his own record and letting
    // the outbound signer sign it for him — the other half of the same hole.
    await api.as(bob, `/api/profiles/${bob.profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ photoUrl: avasObject }),
    });
    const bensProfiles = await api.json<any[]>(bob, "/api/profiles");
    const smuggled = bensProfiles.find((p) => p.id === bob.profileId)?.photoUrl;
    if (typeof smuggled === "string" && smuggled.includes("sig=")) {
      const res = await api.as(null, smuggled);
      assert.equal(res.status, 403, "a signature minted for Ben must not fetch Ava's object");
    }
  });

  test("uploaded objects are served signed to a native bearer caller", async () => {
    // THE DEFECT: the response signer read the household at middleware time,
    // before isAuthenticated had decoded the bearer token — so native
    // responses went out with BARE object paths and enabling
    // OBJECT_URL_ENFORCEMENT would have blanked every image in the iOS app.
    // The harness authenticates with a bearer token, exactly like native.
    const object = await api.uploadObject(alice);
    await api.as(alice, `/api/profiles/${alice.profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ photoUrl: object }),
    });

    const profiles = await api.json<any[]>(alice, "/api/profiles");
    const photoUrl = profiles.find((p) => p.id === alice.profileId)?.photoUrl;
    assert.ok(
      typeof photoUrl === "string" && photoUrl.includes("sig="),
      `a bearer-authenticated response must carry a signed path, got "${photoUrl}"`,
    );
    assert.equal((await api.as(null, photoUrl)).status, 200, "that signed path must actually fetch");
  });

  test("what is stored stays a bare path", async () => {
    // The round trip that would otherwise persist an expiring URL: read a
    // profile, submit it back unchanged.
    const object = await api.uploadObject(alice);
    await api.as(alice, `/api/profiles/${alice.profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ photoUrl: object }),
    });
    const signed = (await api.json<any[]>(alice, "/api/profiles"))
      .find((p) => p.id === alice.profileId)?.photoUrl;
    await api.as(alice, `/api/profiles/${alice.profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ photoUrl: signed }),
    });
    // Re-read: if a signed URL had been stored, signing it again would
    // produce a doubled query string.
    const after = (await api.json<any[]>(alice, "/api/profiles"))
      .find((p) => p.id === alice.profileId)?.photoUrl;
    assert.equal((String(after).match(/sig=/g) ?? []).length, 1, "storage must hold the bare path");
  });

  test("an event cannot be assigned to another family's profile", async () => {
    // THE DEFECT: profileIds and driver ids were taken straight from the body.
    // Profile UUIDs are not secrets — family-share responses include them —
    // and with two-way sync on this wrote a stranger's event into the victim
    // profile's real Google or Outlook calendar.
    const res = await api.as(bob, "/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "Injected",
        startTime: new Date(Date.now() + 3.6e6).toISOString(),
        endTime: new Date(Date.now() + 7.2e6).toISOString(),
        profileIds: [alice.profileId],
      }),
    });
    assert.equal(res.status, 403, "naming another family's profile must be refused");
  });

  test("an event cannot name another family's profile as the driver", async () => {
    // Drivers travel in two shapes, old and new; both must be validated.
    for (const body of [
      { drivingProfileIds: [alice.profileId] },
      { drivingProfileId: alice.profileId },
    ]) {
      const res = await api.as(bob, "/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Injected driver",
          startTime: new Date(Date.now() + 3.6e6).toISOString(),
          endTime: new Date(Date.now() + 7.2e6).toISOString(),
          profileIds: [bob.profileId],
          ...body,
        }),
      });
      assert.equal(res.status, 403, `${Object.keys(body)[0]} must be validated too`);
    }
  });

  test("a family can still create its own events", async () => {
    // The guard that stops the fix above from being "refuse everything".
    const res = await api.as(bob, "/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "Ben's own event",
        startTime: new Date(Date.now() + 3.6e6).toISOString(),
        endTime: new Date(Date.now() + 7.2e6).toISOString(),
        profileIds: [bob.profileId],
        drivingProfileIds: [bob.profileId],
      }),
    });
    assert.ok(res.status < 300, `Ben must still be able to create his own event (got ${res.status})`);
  });

  test("two families sharing a Google calendar keep separate assignments", async () => {
    // THE DEFECT: google_calendar_event_assignments was uniquely keyed on
    // (calendarId, eventId) with no userId, and the upsert also REASSIGNED
    // userId — so two households connected to the same shared calendar (a
    // school calendar, a holidays feed) collided on one row and whoever saved
    // second took the first one's assignment over, assignees and all.
    //
    // Driven at the storage layer on purpose: the HTTP route that reaches
    // this needs live Google tokens, which a test cannot have, and the defect
    // is in the upsert and the unique index rather than in the route.
    const { storage } = await import("../../src/storage.ts");
    const SHARED_CALENDAR = "school@group.calendar.google.com";
    const SHARED_EVENT = "sports-day-2026";

    await storage.setGoogleEventAssignment(
      alice.userId, SHARED_CALENDAR, SHARED_EVENT, [alice.profileId],
    );
    await storage.setGoogleEventAssignment(
      bob.userId, SHARED_CALENDAR, SHARED_EVENT, [bob.profileId],
    );

    for (const who of [alice, bob] as const) {
      const rows = await storage.getGoogleEventAssignmentsByUser(who.userId);
      const mine = rows.find(
        (r: any) => r.calendarId === SHARED_CALENDAR && r.eventId === SHARED_EVENT,
      );
      assert.ok(mine, "a household lost its assignment on the shared calendar");
      assert.deepEqual(
        mine.profileIds,
        [who.profileId],
        "each household must keep its own assignee on a shared event",
      );
    }
  });

  test("a chore belonging to another family cannot be completed", async () => {
    // THE GAP: the route validated the PROFILE's family but never the
    // CHORE's. Exploiting it needs the chore's unguessable UUID, so this is
    // defence in depth — but the chore row is already locked in the same
    // transaction, so the check is free.
    const avasChore = await api.json<any>(alice, "/api/chores", {
      method: "POST",
      body: JSON.stringify({
        title: "Ava's chore", profileIds: [alice.profileId], daysOfWeek: [], points: 5, taskType: "todo",
      }),
    });
    assert.ok(avasChore?.id, "could not create Ava's chore");

    const res = await api.as(bob, "/api/chore-completions", {
      method: "POST",
      body: JSON.stringify({ choreId: avasChore.id, profileId: bob.profileId, points: 0 }),
    });
    assert.equal(res.status, 403, "Ben must not complete Ava's chore");

    // Ben's own chore still completes — the guard against "refuse everything".
    const bensChore = await api.json<any>(bob, "/api/chores", {
      method: "POST",
      body: JSON.stringify({
        title: "Ben's chore", profileIds: [bob.profileId], daysOfWeek: [], points: 5, taskType: "todo",
      }),
    });
    const own = await api.as(bob, "/api/chore-completions", {
      method: "POST",
      body: JSON.stringify({ choreId: bensChore.id, profileId: bob.profileId, points: 0 }),
    });
    assert.ok(own.status < 300, `Ben must still complete his own chore (got ${own.status})`);
  });

  test("another family's daily content cannot be reassigned", async () => {
    // THE GAP: this route DELETES every assignment for the content before
    // recreating them, so a foreign contentId was a destructive write, not
    // just an unauthorized read.
    const avasContent = await api.json<any>(alice, "/api/daily-content", {
      method: "POST",
      body: JSON.stringify({ type: "note", title: "Note", content: "Ava's private note" }),
    });
    assert.ok(avasContent?.id, "could not create Ava's daily content");

    const res = await api.as(bob, `/api/daily-content/${avasContent.id}/assignments`, {
      method: "POST",
      body: JSON.stringify({ profileIds: [bob.profileId] }),
    });
    assert.equal(res.status, 403, "Ben must not reassign Ava's content");
  });

  test("a household can only ever have one settings row", async () => {
    // THE GAP: the writer did read-then-insert with no unique key, so two
    // concurrent first saves could each find nothing and both insert.
    //
    // ⚠️ This asserts the CONSTRAINT, not a reproduced race. Two requests
    // fired together against a local database do not reliably interleave —
    // an earlier version of this test passed against the old read-then-insert
    // code, which made it worthless. The unique key is the thing that
    // actually prevents the race, so that is what gets tested.
    const solo = await api.signUp();
    await api.as(solo, "/api/location-settings", {
      method: "PUT",
      body: JSON.stringify({ city: "Denver", state: "CO", country: "United States" }),
    });

    const { db } = await import("../../src/db.ts");
    const { locationSettings } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    // A second row for the same household must be impossible at the database
    // level, whatever the application code does.
    await assert.rejects(
      () => db.insert(locationSettings).values({
        userId: solo.userId, city: "Boulder", state: "CO", country: "United States",
        latitude: 40, longitude: -105, timezone: "America/Denver",
      }),
      "a duplicate settings row must be refused by the unique key",
    );

    // And the ordinary path still updates in place rather than erroring.
    const second = await api.as(solo, "/api/location-settings", {
      method: "PUT",
      body: JSON.stringify({ city: "Boulder", state: "CO", country: "United States" }),
    });
    assert.ok(second.status < 300, `a second save must update, not fail (got ${second.status})`);

    const rows = await db.select().from(locationSettings).where(eq(locationSettings.userId, solo.userId));
    assert.equal(rows.length, 1, `exactly one row per household, found ${rows.length}`);
    assert.equal(rows[0].city, "Boulder", "the second save must have taken effect");
  });

  test("OAuth state cannot be minted for another family's profile", async () => {
    // THE DEFECT: the client built this state itself, so anyone who learned a
    // profile id could start a calendar flow for it and have the resulting
    // tokens attached to that profile.
    const res = await api.as(bob, "/api/auth/calendar/state", {
      method: "POST",
      body: JSON.stringify({ profileId: alice.profileId, provider: "google" }),
    });
    assert.equal(res.status, 403, "Ben must not mint a state for Ava's profile");

    const own = await api.as(bob, "/api/auth/calendar/state", {
      method: "POST",
      body: JSON.stringify({ profileId: bob.profileId, provider: "google" }),
    });
    assert.equal(own.status, 200, "Ben must still be able to connect his own calendar");
  });

  test("an OAuth state works exactly once, even across processes", async () => {
    // THE DEFECT: single use was tracked in a process-local Map. Replit
    // Autoscale recycles the container whenever traffic stops, which forgot
    // every nonce and reopened the replay window; a second instance would
    // never have shared it. The guarantee now comes from an atomic
    // UPDATE ... WHERE consumed_at IS NULL, which no in-memory structure can
    // make across processes.
    const { createOAuthTransaction, consumeOAuthTransaction } =
      await import("../../src/lib/oauthState.ts");

    const state = await createOAuthTransaction({
      provider: "google",
      accountUserId: alice.userId,
      familyOwnerUserId: alice.userId,
      profileId: alice.profileId,
      redirectMode: "web",
    });

    const first = await consumeOAuthTransaction(state, "google");
    assert.equal(first.ok, true, "the first use must succeed");

    const second = await consumeOAuthTransaction(state, "google");
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "replayed");
  });

  test("a state minted for Google cannot be completed on Outlook", async () => {
    // Nothing bound the state to a provider before, so a Google state could
    // be handed to the Outlook callback.
    const { createOAuthTransaction, consumeOAuthTransaction, peekOAuthTransaction } =
      await import("../../src/lib/oauthState.ts");

    const state = await createOAuthTransaction({
      provider: "google",
      accountUserId: alice.userId,
      familyOwnerUserId: alice.userId,
      profileId: alice.profileId,
      redirectMode: "web",
    });

    const peeked = await peekOAuthTransaction(state, "outlook");
    assert.equal(peeked.ok, false);
    if (!peeked.ok) assert.equal(peeked.reason, "wrong_provider");

    const consumed = await consumeOAuthTransaction(state, "outlook");
    assert.equal(consumed.ok, false, "the wrong provider must not consume it either");

    // And the real provider still works afterwards — a rejection must not
    // burn the transaction.
    assert.equal((await consumeOAuthTransaction(state, "google")).ok, true);
  });

  test("an unknown or expired state is refused", async () => {
    const { consumeOAuthTransaction, createOAuthTransaction, OAUTH_STATE_TTL_MS } =
      await import("../../src/lib/oauthState.ts");

    const unknown = await consumeOAuthTransaction("not-a-real-state", "google");
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, "not_found");

    const state = await createOAuthTransaction({
      provider: "google",
      accountUserId: alice.userId,
      familyOwnerUserId: alice.userId,
      profileId: alice.profileId,
      redirectMode: "web",
    });
    const later = new Date(Date.now() + OAUTH_STATE_TTL_MS + 60_000);
    const expired = await consumeOAuthTransaction(state, "google", later);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "expired");
  });

  test("the state carries the login account, not just the household", async () => {
    // Recorded so the callback can re-check membership: someone removed from
    // the family while away at the consent screen must not be able to finish.
    const { createOAuthTransaction, consumeOAuthTransaction } =
      await import("../../src/lib/oauthState.ts");
    const state = await createOAuthTransaction({
      provider: "outlook",
      accountUserId: alice.userId,
      familyOwnerUserId: alice.userId,
      profileId: alice.profileId,
      redirectMode: "native",
    });
    const result = await consumeOAuthTransaction(state, "outlook");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.accountUserId, alice.userId);
    assert.equal(result.profileId, alice.profileId);
    assert.equal(result.redirectMode, "native");
  });

  test("minting a state requires a real provider", async () => {
    const res = await api.as(alice, "/api/auth/calendar/state", {
      method: "POST",
      body: JSON.stringify({ profileId: alice.profileId, provider: "not-a-provider" }),
    });
    assert.equal(res.status, 400);
  });

  test("a forged OAuth state is refused at the start of the flow", async () => {
    // The exact attack: a bare JSON state naming someone else's profile.
    const forged = encodeURIComponent(JSON.stringify({ profileId: alice.profileId }));
    const res = await api.as(null, `/api/auth/google?state=${forged}`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    assert.ok(
      location.includes("invalid_state"),
      `a forged state must be rejected, got a redirect to "${location}"`,
    );
  });
  // ── Device-reported doses ───────────────────────────────────────────────
  // /api/health-reminder-events/ensure exists because the phone now fires
  // medication reminders itself and the server has to be told, so the dose can
  // be acknowledged on Home. The client supplies the reminder id, which makes
  // it exactly the shape of endpoint this suite exists for.

  test("a family can record a dose its own device announced", async () => {
    const created = await api.as(alice, "/api/health-reminders", {
      method: "POST",
      body: JSON.stringify({
        profileId: alice.profileId,
        type: "medication",
        title: "Amoxicillin",
        scheduleJson: { kind: "daily", time: "09:00" },
      }),
    });
    assert.equal(created.status, 201);
    const reminder = await created.json();

    const res = await api.as(alice, "/api/health-reminder-events/ensure", {
      method: "POST",
      body: JSON.stringify({ reminderId: reminder.id, scheduledAt: "2026-09-29T09:00:00.000Z" }),
    });
    assert.equal(res.status, 200);
    const event = await res.json();
    assert.equal(event.reminderId, reminder.id);
    assert.equal(event.profileId, alice.profileId);

    // Idempotent: a second device reporting the same dose must not produce a
    // second event, or Home shows the same dose twice.
    const again = await api.as(alice, "/api/health-reminder-events/ensure", {
      method: "POST",
      body: JSON.stringify({ reminderId: reminder.id, scheduledAt: "2026-09-29T09:00:00.000Z" }),
    });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, event.id);
  });

  test("one family cannot record a dose against another family's reminder", async () => {
    const created = await api.as(alice, "/api/health-reminders", {
      method: "POST",
      body: JSON.stringify({
        profileId: alice.profileId,
        type: "medication",
        title: "Private medication",
        scheduleJson: { kind: "daily", time: "21:00" },
      }),
    });
    const reminder = await created.json();

    // Ben knows (or guesses) the id. Without the ownership check this writes a
    // row into Ava's household and surfaces her medication on his Home screen.
    const res = await api.as(bob, "/api/health-reminder-events/ensure", {
      method: "POST",
      body: JSON.stringify({ reminderId: reminder.id, scheduledAt: "2026-09-29T21:00:00.000Z" }),
    });
    assert.equal(res.status, 404, "another family's reminder must not be recordable");

    const bensEvents = await (await api.as(bob, "/api/health-reminder-events?unack=true")).json();
    assert.equal(
      bensEvents.some((e: { reminderId: string }) => e.reminderId === reminder.id),
      false,
      "Ava's reminder must not appear in Ben's events",
    );
  });
  // ── Sign-out ends the server session ────────────────────────────────────
  // 2026-09-30: sign-out on the phone bounced straight back, twice. Every
  // sign-in path calls req.logIn(), so it sets a SESSION COOKIE as well as
  // returning a bearer token, and the app sends that cookie on every request.
  // Dropping the token was not enough: the cookie alone kept authenticating.
  // These prove both halves against the real server rather than by argument —
  // the first attempt at this fix was reasoned out and was wrong.
  //
  // ⚠️ `X-Forwarded-Proto: https` is load-bearing. The session cookie is
  // `secure: true`, so express-session only issues it on a secure request, and
  // this harness speaks plain HTTP. In production Replit's HTTPS proxy sends
  // this header and the app runs `trust proxy`, which is what makes the cookie
  // real there. Without it these tests saw no cookie at all — and the logout
  // test would then have "passed" by getting a 401 it was always going to get.
  const HTTPS = { "X-Forwarded-Proto": "https" };

  async function signInForCookie(): Promise<string> {
    const login = await fetch(`${api.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...HTTPS },
      body: JSON.stringify({ email: alice.email, password: alice.password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    assert.ok(cookie, "sign-in set no session cookie at all");
    return cookie;
  }

  test("a session cookie from sign-in authenticates on its own, with no token", async () => {
    // This is the root cause. If it ever stops being true, the app's extra
    // logout call becomes unnecessary — but it is true today.
    const cookie = await signInForCookie();
    const me = await fetch(`${api.baseUrl}/api/auth/user`, { headers: { Cookie: cookie, ...HTTPS } });
    assert.equal(me.status, 200, "the cookie alone should be a working credential");
  });

  test("POST /api/auth/logout stops that cookie authenticating", async () => {
    const cookie = await signInForCookie();

    // Not vacuous: prove the cookie works BEFORE signing out. Without this, a
    // 401 afterwards would pass whether or not logout did anything.
    const before = await fetch(`${api.baseUrl}/api/auth/user`, { headers: { Cookie: cookie, ...HTTPS } });
    assert.equal(before.status, 200, "precondition: the cookie authenticates before sign-out");

    const out = await fetch(`${api.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, ...HTTPS },
    });
    assert.equal(out.status, 200);

    // The same cookie, replayed after sign-out. This is exactly the refetch
    // that used to sign the person straight back in.
    const after = await fetch(`${api.baseUrl}/api/auth/user`, { headers: { Cookie: cookie, ...HTTPS } });
    assert.equal(after.status, 401, "a signed-out session cookie must not authenticate");
  });
});
