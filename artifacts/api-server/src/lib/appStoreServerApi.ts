import {
  AppStoreServerAPIClient,
  SignedDataVerifier,
  Environment,
  Status,
  type JWSTransactionDecodedPayload,
  type JWSRenewalInfoDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { logger } from "./logger";
import { _canonicalizePemKey } from "./apns";
import { X509Certificate } from "node:crypto";

/**
 * Wraps Apple's OFFICIAL @apple/app-store-server-library rather than
 * hand-rolling this ourselves (unlike apns.ts's own hand-written JWT
 * signing) — deliberately, because this is different in kind from APNs:
 * verifying Apple's signed transaction/notification payloads means
 * validating an X.509 certificate chain up to Apple's own root CA, which is
 * genuinely security-sensitive to get right and exactly what Apple provides
 * a maintained library for. This is a narrow, purpose-built dependency for
 * one cryptographic job, not a broad SaaS wrapper like RevenueCat (which the
 * 2026-08-24 plan deliberately avoided for a different reason — this app
 * only needs one product on one platform, so RevenueCat's business-logic
 * abstraction isn't worth the dependency; Apple's own verification library
 * is a different tradeoff entirely).
 *
 * Configuration (all required; readClient()/readVerifier() are graceful
 * no-ops — returning null — if anything is missing, same pattern as
 * apns.ts's readConfig(), so the rest of the subscription system can run
 * with entitlement checks failing open rather than crashing):
 *   APPSTORE_KEY_P8        — contents of the App Store Server API .p8 key
 *                            (App Store Connect → Users and Access → Integrations
 *                            → In-App Purchase key), or a path to it. Distinct
 *                            from the APNs .p8 key — different key, different
 *                            purpose, even though both are ES256 keys from Apple.
 *   APPSTORE_KEY_ID        — the Key ID for that key
 *   APPSTORE_ISSUER_ID     — the Issuer ID (same for every key in your team,
 *                            found on the same Keys page)
 *   APPSTORE_BUNDLE_ID     — falls back to APNS_BUNDLE_ID (same app bundle id)
 *   APPSTORE_ENVIRONMENT   — "production" or "sandbox" (default: sandbox, so
 *                            an unconfigured/dev deploy never accidentally
 *                            talks to production)
 *   APPLE_ROOT_CA_BASE64   — one or more DER-encoded Apple root certificates
 *                            (comma-separated base64 blobs), REQUIRED for
 *                            verifying signed payloads. Download from
 *                            https://www.apple.com/certificateauthority/ (the
 *                            "Apple Root CA - G3" certificate) — this is a
 *                            manual, one-time download only you can do; see
 *                            CLAUDE.md for the exact file to grab.
 */

interface AppStoreConfig {
  key: string;
  keyId: string;
  issuerId: string;
  bundleId: string;
  environment: Environment;
}

function readConfig(): AppStoreConfig | null {
  const rawKey = process.env.APPSTORE_KEY_P8;
  const keyId = process.env.APPSTORE_KEY_ID;
  const issuerId = process.env.APPSTORE_ISSUER_ID;
  const bundleId = process.env.APPSTORE_BUNDLE_ID ?? process.env.APNS_BUNDLE_ID;
  if (!rawKey || !keyId || !issuerId || !bundleId) return null;

  let source = rawKey;
  if (!/BEGIN/.test(rawKey) && rawKey.length < 300 && !rawKey.includes(" ")) {
    try {
      source = require("node:fs").readFileSync(rawKey, "utf8");
    } catch {
      /* not a path — treat as (possibly mangled/base64) key text below */
    }
  }
  // Reuses apns.ts's key-mangling recovery (quotes, escaped/space-mangled
  // newlines, double-base64'd, body-only) — the exact same failure modes
  // apply to any .p8 pasted into a secret store, regardless of which Apple
  // service the key is for.
  const { pem } = _canonicalizePemKey(source);
  const key = pem ?? source;

  const environment =
    (process.env.APPSTORE_ENVIRONMENT ?? "sandbox").toLowerCase() === "production"
      ? Environment.PRODUCTION
      : Environment.SANDBOX;

  return { key, keyId: keyId.trim(), issuerId: issuerId.trim(), bundleId, environment };
}

export function isAppStoreServerApiConfigured(): boolean {
  return readConfig() !== null;
}

let cachedClient: { client: AppStoreServerAPIClient; keyId: string } | null = null;

function getClient(): AppStoreServerAPIClient | null {
  const cfg = readConfig();
  if (!cfg) return null;
  if (cachedClient && cachedClient.keyId === cfg.keyId) return cachedClient.client;
  const client = new AppStoreServerAPIClient(cfg.key, cfg.keyId, cfg.issuerId, cfg.bundleId, cfg.environment);
  cachedClient = { client, keyId: cfg.keyId };
  return client;
}

function readRootCertificates(): Buffer[] {
  const raw = process.env.APPLE_ROOT_CA_BASE64;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((b64) => Buffer.from(b64, "base64"));
}

let cachedVerifier: SignedDataVerifier | null = null;

function getVerifier(): SignedDataVerifier | null {
  const cfg = readConfig();
  if (!cfg) return null;
  const roots = readRootCertificates();
  if (roots.length === 0) {
    logger.error("APPLE_ROOT_CA_BASE64 is not set — cannot verify Apple-signed subscription data");
    return null;
  }
  if (!cachedVerifier) {
    // enableOnlineChecks: false — we don't need live revocation-checking
    // against Apple's OCSP servers for this use case (a compromised
    // intermediate cert being revoked mid-flight is an exceedingly narrow
    // risk here), and enabling it would mean every verification call
    // depends on Apple's OCSP endpoint being reachable, which is one more
    // thing that could turn "verify a subscription" into "verify a
    // subscription, IF Apple's revocation server is also up right now."
    cachedVerifier = new SignedDataVerifier(roots, false, cfg.environment, cfg.bundleId);
  }
  return cachedVerifier;
}

/** Apple's numeric Status enum -> its own string name (falls back to "EXPIRED" for an unrecognized/missing value, the safe default). */
export function statusName(status: Status | number | undefined): string {
  return (status !== undefined && Status[status as Status]) || "EXPIRED";
}

export interface DecodedSubscriptionState {
  originalTransactionId: string;
  productId: string;
  status: string; // Apple's Status enum name: ACTIVE / EXPIRED / BILLING_RETRY / BILLING_GRACE_PERIOD / REVOKED
  expiresDate: Date | null;
  autoRenewStatus: boolean | null;
}

/**
 * Fetches and decodes the current subscription state for whichever account
 * a given transaction id belongs to — used by both the client-driven
 * /api/subscription/verify route (right after a purchase completes) and can
 * be reused to re-sync on demand. Returns null on any failure (not
 * configured, Apple rejected the id, verification failed) — callers should
 * treat null as "couldn't confirm right now," never as "confirmed not
 * subscribed."
 */
export async function fetchSubscriptionState(anyTransactionId: string): Promise<DecodedSubscriptionState | null> {
  const client = getClient();
  const verifier = getVerifier();
  if (!client || !verifier) return null;

  try {
    const response = await client.getAllSubscriptionStatuses(anyTransactionId);
    const items = (response.data ?? []).flatMap((group) => group.lastTransactions ?? []);
    if (items.length === 0) return null;

    // Multiple items can exist across renewal history within the same
    // subscription group; the one with the latest signed date is current.
    let best: { item: (typeof items)[number]; tx: JWSTransactionDecodedPayload; renewal: JWSRenewalInfoDecodedPayload | null } | null = null;
    for (const item of items) {
      if (!item.signedTransactionInfo) continue;
      const tx = await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
      const renewal = item.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo) : null;
      if (!best || (tx.signedDate ?? 0) > (best.tx.signedDate ?? 0)) {
        best = { item, tx, renewal };
      }
    }
    if (!best || !best.tx.originalTransactionId || !best.tx.productId) return null;

    return {
      originalTransactionId: best.tx.originalTransactionId,
      productId: best.tx.productId,
      status: statusName(best.item.status),
      expiresDate: best.tx.expiresDate ? new Date(best.tx.expiresDate) : null,
      autoRenewStatus: best.renewal ? best.renewal.autoRenewStatus === 1 : null,
    };
  } catch (err) {
    logger.error({ err, anyTransactionId }, "Failed to fetch/verify Apple subscription state");
    return null;
  }
}

/**
 * Verifies and decodes an App Store Server Notification V2 payload (the raw
 * request body's `signedPayload` field). Returns null if unconfigured or
 * verification fails — the webhook route must treat that as "reject the
 * request," never as "no update needed."
 */
export async function verifyServerNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload | null> {
  const verifier = getVerifier();
  if (!verifier) return null;
  try {
    return await verifier.verifyAndDecodeNotification(signedPayload);
  } catch (err) {
    logger.error({ err }, "Failed to verify App Store Server Notification");
    return null;
  }
}

/**
 * Decodes the (already-signature-verified, by verifyServerNotification's
 * own outer verification) nested transaction/renewal JWS strings carried in
 * a Server Notification's `data` field. Apple double-signs: the outer
 * envelope AND the nested transaction/renewal info are each independently
 * JWS-signed, so this still runs its own signature check on the nested
 * strings rather than trusting them just because the outer one verified.
 */
export async function decodeWebhookTransactionAndRenewal(data: {
  signedTransactionInfo?: string;
  signedRenewalInfo?: string;
}): Promise<{
  originalTransactionId: string | null;
  productId: string | null;
  expiresDate: Date | null;
  autoRenewStatus: boolean | null;
  appAccountToken: string | null;
} | null> {
  const verifier = getVerifier();
  if (!verifier || !data.signedTransactionInfo) return null;
  try {
    const tx = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo);
    const renewal = data.signedRenewalInfo ? await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo) : null;
    return {
      originalTransactionId: tx.originalTransactionId ?? null,
      productId: tx.productId ?? null,
      expiresDate: tx.expiresDate ? new Date(tx.expiresDate) : null,
      autoRenewStatus: renewal ? renewal.autoRenewStatus === 1 : null,
      appAccountToken: tx.appAccountToken ?? null,
    };
  } catch (err) {
    logger.error({ err }, "Failed to decode nested webhook transaction/renewal info");
    return null;
  }
}

/** Test-only: clear cached client/verifier instances (key rotation). */
export function _resetAppStoreServerCache(): void {
  cachedClient = null;
  cachedVerifier = null;
}

/**
 * A redacted self-check of every App Store secret, for the admin diagnostics
 * route. Reports only whether each value is present and structurally usable —
 * never the value itself, since this is served over HTTP.
 *
 * `rootCertificates` is the one worth watching: a missing or malformed value
 * doesn't fail loudly at boot, it just makes every signature verification
 * refuse to run (getVerifier returns null), so a webhook silently stops
 * working. Parsing the DER here is what turns that into a visible answer.
 */
export function appStoreConfigCheck(): Record<string, unknown> {
  const cfg = readConfig();
  const roots = readRootCertificates();
  let rootsUsable = false;
  if (roots.length > 0) {
    try {
      new X509Certificate(roots[0]);
      rootsUsable = true;
    } catch {
      rootsUsable = false;
    }
  }
  return {
    keyP8: cfg ? "ok" : process.env.APPSTORE_KEY_P8 ? "present but incomplete config" : "missing",
    keyId: process.env.APPSTORE_KEY_ID ? "ok" : "missing",
    issuerId: process.env.APPSTORE_ISSUER_ID ? "ok" : "missing",
    // Falls back to APNS_BUNDLE_ID, so this can read "ok" without a
    // dedicated APPSTORE_BUNDLE_ID secret ever being set. That is intended.
    bundleId: cfg?.bundleId ?? "missing",
    environment: (process.env.APPSTORE_ENVIRONMENT ?? "sandbox (default)").toLowerCase(),
    rootCertificates: roots.length === 0 ? "missing" : rootsUsable ? `ok (${roots.length})` : "present but not a valid certificate",
    adminEmails: (process.env.SUBSCRIPTION_ADMIN_EMAILS ?? "").split(",").filter((s) => s.trim()).length,
    enforcementEnabled: process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED === "true",
    ready: !!cfg && rootsUsable,
  };
}
