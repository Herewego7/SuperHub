/**
 * A real API, a real Postgres, and two families.
 *
 * WHY THIS EXISTS: every cross-tenant defect found in September 2026 —
 * settings writes hitting an arbitrary family's row, the two-way sync flag
 * read globally, `/api/calendar-assignments` returning everyone's, calendar
 * assignments deactivating another household's — was invisible to all 300+
 * existing tests, and every one was found by reading code. The browser suite
 * mocks the API; the unit tests never start Express against a database. A
 * green suite said nothing about whether family A can read family B's data.
 *
 * Every defect of that shape needs TWO families to show itself, and production
 * has one. So does every fixture in this repo. This harness exists to make the
 * second one cheap.
 *
 * It deliberately boots the REAL app — the real auth middleware, the real
 * family resolution, the real routes — because the bugs it is hunting live in
 * the seams between those, not inside any one function.
 */

import type { Express } from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

export interface TestAccount {
  email: string;
  password: string;
  token: string;
  /** The account (login) id. */
  userId: string;
}

export interface TestFamily extends TestAccount {
  /** A profile belonging to this family, created through the real API. */
  profileId: string;
}

export interface ApiHarness {
  baseUrl: string;
  /** Fetch as a given family, or anonymously when `who` is null. */
  as(who: TestAccount | null, path: string, init?: RequestInit): Promise<Response>;
  json<T = any>(who: TestAccount | null, path: string, init?: RequestInit): Promise<T>;
  signUp(): Promise<TestAccount>;
  createFamily(profileName: string): Promise<TestFamily>;
  /** Upload a real 1x1 PNG as `who`; resolves to its bare /objects/ path. */
  uploadObject(who: TestAccount): Promise<string>;
  close(): Promise<void>;
}

/**
 * True when a throwaway Postgres is available to test against.
 *
 * TEST_DATABASE_URL is deliberately separate from DATABASE_URL so running the
 * suite can never point at anything real. Without it these tests SKIP rather
 * than fail: `pnpm test` has to stay runnable on a machine with no database,
 * or it stops being run at all.
 */
export function apiTestsEnabled(): boolean {
  return !!process.env.TEST_DATABASE_URL;
}

export async function startApiHarness(): Promise<ApiHarness> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");

  // Point the app's own db module at the throwaway database BEFORE anything
  // imports it — lib/db reads DATABASE_URL at module load and builds its pool
  // there, so a later assignment would be ignored.
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET ??= "test-session-secret-not-used-anywhere-real";
  process.env.OAUTH_STATE_SECRET ??= "test-oauth-state-secret";
  process.env.OBJECT_URL_SECRET ??= "test-object-url-secret";
  // Keep the entitlement gates out of the way: these tests are about tenant
  // isolation, and a paywall answering 402 would mask a 403 we care about.
  delete process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;

  // The app does OIDC discovery at boot against Replit. That is unreachable
  // from a test machine and would take the whole app down with it, so point
  // it at a local stub. This exercises the real setupAuth path rather than
  // skipping it — the family resolution these tests depend on is wired up
  // inside it.
  const oidc = await startOidcStub();
  process.env.ISSUER_URL = oidc.issuer;
  process.env.REPL_ID ??= "test-repl-id";

  const { default: buildApp } = await import("../../src/app.ts");
  const app: Express = await buildApp();

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const as = (who: TestAccount | null, path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(who ? { Authorization: `Bearer ${who.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  const json = async <T>(who: TestAccount | null, path: string, init?: RequestInit): Promise<T> => {
    const res = await as(who, path, init);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  };

  const signUp = async (): Promise<TestAccount> => {
    // A distinct email per call: signup is rate limited per IP, and every
    // test here shares 127.0.0.1.
    const email = `fam-${randomUUID()}@example.test`;
    const password = "correct-horse-battery-staple";
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName: "Test Parent" }),
    });
    if (res.status !== 201) {
      throw new Error(`signup failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const { token } = await res.json();
    if (!token) throw new Error("signup returned no bearer token");

    const account: TestAccount = { email, password, token, userId: "" };
    const me = await json<{ id?: string; claims?: { sub?: string } }>(account, "/api/auth/user");
    account.userId = me?.id ?? me?.claims?.sub ?? "";
    if (!account.userId) throw new Error("could not resolve the new account's user id");
    return account;
  };

  const createFamily = async (profileName: string): Promise<TestFamily> => {
    const account = await signUp();
    // Through the real route, so the profile is owned exactly the way a real
    // one is — a hand-inserted row could differ in a way that hides a bug.
    const profile = await json<{ id: string }>(account, "/api/profiles", {
      method: "POST",
      body: JSON.stringify({
        name: profileName,
        color: "#3b82f6",
        initials: profileName.slice(0, 2).toUpperCase(),
      }),
    });
    if (!profile?.id) throw new Error(`could not create a profile for ${profileName}`);
    return { ...account, profileId: profile.id };
  };

  /**
   * Upload a REAL object through the real route and return its bare path.
   *
   * The first version of the object test used "/objects/uploads/does-not-
   * exist", which returns 404 whether the signature is valid, forged or
   * absent — so it passed without proving anything. A real row is the only
   * way to test ownership.
   */
  const uploadObject = async (who: TestAccount): Promise<string> => {
    // A 1x1 PNG: real bytes, and an allowed content type.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
    const res = await fetch(`${baseUrl}/api/objects/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${who.token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const { objectPath } = await res.json();
    if (typeof objectPath !== "string") throw new Error("upload returned no objectPath");
    return objectPath;
  };

  return {
    baseUrl,
    as,
    json,
    signUp,
    createFamily,
    uploadObject,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await oidc.close();
    },
  };
}

/**
 * The smallest OIDC discovery document openid-client will accept.
 *
 * Nothing here is ever exercised beyond discovery: these tests authenticate
 * with the app's own email/password signup and its bearer token, not with
 * Replit. The stub exists only so `setupAuth` can complete.
 */
async function startOidcStub(): Promise<{ issuer: string; close: () => Promise<void> }> {
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    const issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.url?.startsWith("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  return {
    issuer: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
