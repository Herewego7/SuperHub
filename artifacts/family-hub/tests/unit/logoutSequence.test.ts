import { test } from "node:test";
import assert from "node:assert/strict";
import { performLogout, type LogoutSteps } from "../../src/lib/logoutSequence.ts";

// 2026-09-30, reported from the app: the Sign out button did nothing, however
// many times it was pressed, and a moment later the app showed onboarding step
// 1 of 9. One cause: the query cache was cleared while the bearer token was
// still valid, so the refetch that clearing provokes came back with the
// signed-in user and put them right back.

function recorder(over: Partial<LogoutSteps> = {}) {
  const calls: string[] = [];
  const steps: LogoutSteps = {
    isNative: true,
    endServerSession: async () => { calls.push("endServerSession"); },
    dropToken: async () => { calls.push("dropToken"); },
    cancelQueries: async () => { calls.push("cancelQueries"); },
    clearTenant: async () => { calls.push("clearTenant"); },
    markSignedOut: () => { calls.push("markSignedOut"); },
    redirectWeb: () => { calls.push("redirectWeb"); },
    reload: () => { calls.push("reload"); },
    tidyUpTimeoutMs: 50,
    ...over,
  };
  return { calls, steps };
}

test("on native the token is dropped BEFORE anything clears the cache", async () => {
  const { calls, steps } = recorder();
  await performLogout(steps);
  assert.deepEqual(calls, ["endServerSession", "dropToken", "cancelQueries", "clearTenant", "markSignedOut", "reload"]);
  assert.ok(
    calls.indexOf("dropToken") < calls.indexOf("clearTenant"),
    "clearing first refetches /api/auth/user with a valid token and signs the user back in",
  );
});

test("in-flight requests are cancelled before the cache is emptied", async () => {
  // A request started while the token was still valid resolves into a cleared
  // cache as a signed-IN user, landing after the explicit signed-out write.
  const { calls, steps } = recorder();
  await performLogout(steps);
  assert.ok(calls.indexOf("cancelQueries") < calls.indexOf("clearTenant"));
});

test("the token drop is awaited, not merely started", async () => {
  // `await` matters: a floating promise here puts the clearing back in a race
  // with a credential that has not actually gone yet.
  const order: string[] = [];
  let resolveDrop!: () => void;
  const dropped = new Promise<void>((r) => { resolveDrop = r; });
  const { steps } = recorder({
    dropToken: () => { order.push("drop:start"); return dropped; },
    clearTenant: async () => { order.push("clear"); },
  });
  const running = performLogout(steps);
  await Promise.resolve();
  assert.deepEqual(order, ["drop:start"], "clearing must not have started yet");
  resolveDrop();
  await running;
  assert.deepEqual(order, ["drop:start", "clear"]);
});

test("web redirects to the server and never writes a signed-out cache entry", async () => {
  // The redirect throws the page away, so marking the cache would be pointless
  // — and there is no bearer token to drop.
  const { calls, steps } = recorder({ isNative: false });
  await performLogout(steps);
  assert.deepEqual(calls, ["cancelQueries", "clearTenant", "redirectWeb"]);
  // The redirect throws the page away already; reloading as well is pointless.
  assert.ok(!calls.includes("reload"));
  assert.ok(!calls.includes("dropToken"));
  // The web redirect to /api/logout ends the session itself; ending it first
  // would make that route see no user and skip Replit's end-session step.
  assert.ok(!calls.includes("endServerSession"));
  assert.ok(!calls.includes("markSignedOut"));
});

// ── The second credential ───────────────────────────────────────────────────
// 2026-09-30, again: after the first fix, sign-out STILL bounced back. Every
// sign-in also creates a server session and cookie, and the app sends that
// cookie on every request — so the refetch after clearing was authenticated
// by the cookie even with the token gone.

test("on native the server session is ended before anything clears the cache", async () => {
  const { calls, steps } = recorder();
  await performLogout(steps);
  assert.ok(
    calls.indexOf("endServerSession") < calls.indexOf("clearTenant"),
    "a live session cookie authenticates the refetch that clearing provokes",
  );
  assert.ok(
    calls.indexOf("endServerSession") < calls.indexOf("dropToken"),
    "end the session while the request can still be identified as this person's",
  );
});

test("the server session is ended, not merely requested", async () => {
  // Awaited, for the same reason as the token: a floating request puts the
  // cache clear back in a race with a cookie that still works.
  const order: string[] = [];
  let resolveEnd!: () => void;
  const ended = new Promise<void>((r) => { resolveEnd = r; });
  const { steps } = recorder({
    endServerSession: () => { order.push("end:start"); return ended; },
    clearTenant: async () => { order.push("clear"); },
  });
  const running = performLogout(steps);
  await Promise.resolve();
  assert.deepEqual(order, ["end:start"], "nothing may clear before the session is gone");
  resolveEnd();
  await running;
  assert.deepEqual(order, ["end:start", "clear"]);
});

// ── Ending in a fresh start ─────────────────────────────────────────────────
// 2026-09-30, a third time: with both credentials cleared correctly, the device
// still showed a dead button and then onboarding step 1 of 9 — yet a force-quit
// found the person signed out. The credentials were fine; the in-place screen
// update never arrived. So native sign-out ends in a reload, the one path
// observed to work, and nothing after the credentials may block it.

test("native sign-out always ends in a reload", async () => {
  const { calls, steps } = recorder();
  await performLogout(steps);
  assert.equal(calls.at(-1), "reload", "a reload must be the very last thing sign-out does");
});

test("a tidy-up that never finishes cannot hold sign-out hostage", async () => {
  // The exact failure: something after the credentials stalls, and the person
  // is left on a signed-in screen with a button that does nothing.
  const { calls, steps } = recorder({
    clearTenant: () => new Promise<void>(() => { /* never resolves */ }),
  });
  await performLogout(steps);
  assert.ok(calls.includes("reload"), "sign-out must reload even when the tidy-up hangs");
  assert.ok(
    calls.indexOf("dropToken") < calls.indexOf("reload"),
    "and the credentials must already be gone by then",
  );
});

test("a tidy-up that throws does not stop sign-out either", async () => {
  const { calls, steps } = recorder({
    clearTenant: async () => { throw new Error("notification centre unavailable"); },
  });
  await performLogout(steps);
  assert.equal(calls.at(-1), "reload");
});

test("the credentials are never inside the time limit", async () => {
  // Only the tidy-up is bounded. If ending the session or dropping the token
  // could be skipped by a timeout, the reload would come back signed in.
  const order: string[] = [];
  let release!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const { steps } = recorder({
    tidyUpTimeoutMs: 1,
    dropToken: () => { order.push("drop:start"); return slow; },
    reload: () => { order.push("reload"); },
  });
  const running = performLogout(steps);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ["drop:start"], "no reload while the token is still being dropped");
  release();
  await running;
  assert.deepEqual(order, ["drop:start", "reload"]);
});
