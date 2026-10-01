import assert from "node:assert";
import crypto from "node:crypto";
import {
  buildApnsBody,
  isApnsConfigured,
  _resetApnsTokenCache,
  _buildProviderTokenFromEnv,
} from "./apns";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function b64urlToBuf(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + "=".repeat(4 - pad) : padded, "base64");
}

// ── buildApnsBody ────────────────────────────────────────────────────────────

test("buildApnsBody produces an alert payload with sound", () => {
  const body = JSON.parse(buildApnsBody({ title: "Hi", body: "There" }));
  assert.deepEqual(body.aps.alert, { title: "Hi", body: "There" });
  assert.equal(body.aps.sound, "default");
});

test("buildApnsBody includes badge only when provided", () => {
  const without = JSON.parse(buildApnsBody({ title: "a", body: "b" }));
  assert.equal("badge" in without.aps, false);
  const withBadge = JSON.parse(
    buildApnsBody({ title: "a", body: "b", badge: 3 }),
  );
  assert.equal(withBadge.aps.badge, 3);
});

test("buildApnsBody carries url and custom data at top level", () => {
  const body = JSON.parse(
    buildApnsBody({
      title: "a",
      body: "b",
      url: "/tasks",
      data: { eventId: "e1" },
    }),
  );
  assert.equal(body.url, "/tasks");
  assert.equal(body.eventId, "e1");
  // Custom data must not clobber the reserved aps key.
  assert.ok(body.aps);
});

// ── isApnsConfigured ─────────────────────────────────────────────────────────

const envKeys = [
  "APNS_KEY_P8",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_PRODUCTION",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of envKeys) savedEnv[k] = process.env[k];
function clearEnv() {
  for (const k of envKeys) delete process.env[k];
  _resetApnsTokenCache();
}

test("isApnsConfigured is false when env is missing", () => {
  clearEnv();
  assert.equal(isApnsConfigured(), false);
  assert.equal(_buildProviderTokenFromEnv(), null);
});

// ── provider token (ES256 JWT) signing ───────────────────────────────────────

test("provider token is a valid ES256 JWT verifiable by the public key", () => {
  clearEnv();
  // Generate a throwaway EC P-256 keypair (same curve Apple's p8 uses).
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  process.env.APNS_KEY_P8 = privateKey;
  process.env.APNS_KEY_ID = "ABC1234567";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_BUNDLE_ID = "com.familyhub.app";
  _resetApnsTokenCache();

  assert.equal(isApnsConfigured(), true);

  const token = _buildProviderTokenFromEnv();
  assert.ok(token, "expected a token");
  const parts = token!.split(".");
  assert.equal(parts.length, 3, "JWT must have 3 parts");

  const header = JSON.parse(b64urlToBuf(parts[0]).toString("utf8"));
  assert.equal(header.alg, "ES256");
  assert.equal(header.kid, "ABC1234567");

  const payload = JSON.parse(b64urlToBuf(parts[1]).toString("utf8"));
  assert.equal(payload.iss, "TEAM123456");
  assert.equal(typeof payload.iat, "number");

  // Verify the raw (P1363) signature with the public key.
  const signingInput = `${parts[0]}.${parts[1]}`;
  const sig = b64urlToBuf(parts[2]);
  assert.equal(sig.length, 64, "ES256 raw signature must be 64 bytes");
  const ok = crypto.verify(
    "SHA256",
    Buffer.from(signingInput),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    sig,
  );
  assert.equal(ok, true, "signature must verify against the public key");
});

test("provider token is cached across calls (same key)", () => {
  const a = _buildProviderTokenFromEnv();
  const b = _buildProviderTokenFromEnv();
  assert.equal(a, b, "token should be cached, not re-signed each call");
});

// restore env
clearEnv();
for (const k of envKeys) if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];

console.log(`\n${passed} tests passed.`);
