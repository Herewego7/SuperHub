import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeMobileRedirect } from "../src/lib/mobileRedirect.ts";

// Every destination this accepts receives a bearer token after sign-in, taken
// from `/api/login?redirect=...` in the query string. Accepting one an attacker
// controls is account takeover — so what matters most here is what is REFUSED.

test("the Capacitor app's own scheme is accepted", () => {
  // The one real destination. If this ever fails, nobody can sign in on iOS.
  assert.equal(isSafeMobileRedirect("superhub://auth"), true);
  assert.equal(isSafeMobileRedirect("SUPERHUB://auth"), true);
  assert.equal(isSafeMobileRedirect("familyhub://auth"), false);
});

test("a public Expo tunnel can never receive a token", () => {
  // exp.direct is Expo's public tunnel service: anyone can stand one up. These
  // were all accepted until 2026-09-30, for an Expo app that was never used.
  for (const url of [
    "exp://evil.exp.direct/--/auth",
    "exps://evil.exp.direct/--/auth",
    "expo-development-client://evil.exp.direct",
    "https://evil.exp.direct/auth",
    "https://exp.direct/auth",
  ]) {
    assert.equal(isSafeMobileRedirect(url), false, `${url} must be refused`);
  }
});

test("local and LAN Expo destinations are refused too", () => {
  // Whatever happens to be listening on the victim's machine or network.
  for (const url of [
    "exp://localhost:8081",
    "exp://127.0.0.1:8081",
    "exp://192.168.1.20:8081",
    "exp://10.0.0.5:8081",
    "exp://172.16.0.9:8081",
    "http://localhost:8081",
  ]) {
    assert.equal(isSafeMobileRedirect(url), false, `${url} must be refused`);
  }
});

test("the retired Expo app's scheme is refused", () => {
  // A custom scheme is not owned by anyone on iOS. With no real app claiming
  // it, any app that registered it would have been the only taker.
  assert.equal(isSafeMobileRedirect("family-hub-mobile://auth"), false);
});

test("look-alikes and ordinary web destinations are refused", () => {
  for (const url of [
    "https://evil.example/auth",
    "http://familyhub.evil.example",
    "familyhub.evil://auth",
    "javascript:alert(1)",
    "",
    "not a url",
  ]) {
    assert.equal(isSafeMobileRedirect(url), false, `${JSON.stringify(url)} must be refused`);
  }
});
