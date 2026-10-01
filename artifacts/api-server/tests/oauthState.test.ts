import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/testdb";

import {
  nativeRedirectFor,
  isOAuthProvider,
  stateHashesMatch,
  OAUTH_STATE_TTL_MS,
} from "../src/lib/oauthState.ts";

/**
 * The pure half only. Single use, provider binding, expiry and replay are
 * enforced by an atomic UPDATE against Postgres — testing those with a mock
 * would prove nothing about the guarantee that matters, so they live in
 * tests/api/tenantIsolation.test.ts against a real database.
 */

test("the deep-link target is derived from the provider, never from a client", () => {
  // This used to travel inside the state and get written straight into
  // window.location, with an allowlist as the only thing between it and an
  // open redirect. Now there is nothing for a client to influence.
  assert.equal(nativeRedirectFor("google"), "familyhub://google-auth");
  assert.equal(nativeRedirectFor("outlook"), "familyhub://outlook-auth");
  // Both must use the scheme the app actually registers.
  for (const p of ["google", "outlook"] as const) {
    assert.ok(nativeRedirectFor(p).startsWith("familyhub://"));
  }
});

test("only the two real providers are accepted", () => {
  assert.equal(isOAuthProvider("google"), true);
  assert.equal(isOAuthProvider("outlook"), true);
  for (const bad of ["", "GOOGLE", "apple", null, undefined, 1, {}]) {
    assert.equal(isOAuthProvider(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("hash comparison is length-safe and constant-time", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  assert.equal(stateHashesMatch(a, a), true);
  assert.equal(stateHashesMatch(a, b), false);
  // timingSafeEqual throws on mismatched lengths; a truncated value must be
  // rejected rather than crash the callback.
  assert.doesNotThrow(() => stateHashesMatch(a, "abc"));
  assert.equal(stateHashesMatch(a, "abc"), false);
  assert.equal(stateHashesMatch("", ""), true);
});

test("the window is short enough that a leaked URL is not useful for long", () => {
  assert.equal(OAUTH_STATE_TTL_MS, 10 * 60 * 1000);
});
