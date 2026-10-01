import crypto from "node:crypto";
import http2 from "node:http2";
import { logger } from "./logger";

/**
 * APNs (Apple Push Notification service) sender for the native iOS app.
 *
 * Uses token-based authentication (a p8 auth key) over the APNs HTTP/2 API.
 * Implemented with Node's built-in `http2` + `crypto` — no third-party APNs
 * library — so it needs no extra npm dependency.
 *
 * Configuration (all required for native push to actually send; if any is
 * missing the sender is a graceful no-op so web push still works):
 *   APNS_KEY_P8     — contents of the .p8 auth key (PEM PKCS#8), or a path to it
 *   APNS_KEY_ID     — the 10-char Key ID from the Apple Developer portal
 *   APNS_TEAM_ID    — the 10-char Apple Developer Team ID
 *   APNS_BUNDLE_ID  — the app bundle id / apns-topic (e.g. com.familyhub.app)
 *   APNS_PRODUCTION — "true" to use the production gateway, else sandbox
 *
 * See MOBILE.md and /CLAUDE.md (Push Notifications / APNs section).
 */

const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

export interface ApnsPayload {
  title: string;
  body: string;
  /** Click target path on the web app (carried in custom data). */
  url?: string;
  /** Collapse id — APNs replaces a pending notification with the same id. */
  tag?: string;
  /** Badge count to set on the app icon. */
  badge?: number;
  /** Free-form data merged into the APNs payload alongside `aps`. */
  data?: Record<string, unknown>;
}

interface ApnsConfig {
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

/** Per-token send outcome so callers can prune dead tokens. */
export interface ApnsSendResult {
  token: string;
  ok: boolean;
  /** HTTP status from APNs (e.g. 200 ok, 410 unregistered, 400 bad token). */
  status?: number;
  /** APNs reason string (e.g. "BadDeviceToken", "Unregistered"). */
  reason?: string;
}

/**
 * Rebuild a canonical PEM from however the .p8 survived being pasted into a
 * secret store. Real-world manglings this recovers, all seen in the wild:
 *   - wrapping quotes around the whole value
 *   - real newlines turned into literal "\n" / "\r\n" escape sequences
 *   - real newlines turned into SPACES (single-line secret inputs do this —
 *     the case a plain unescape can't fix, and the one that kept
 *     ProviderTokenSigningFailed alive after the earlier \n fix)
 *   - the whole PEM base64-encoded once more (`base64 AuthKey.p8` guides)
 *   - only the base64 body pasted, BEGIN/END lines lost
 * Returns the canonical PEM plus a human diagnostic; pem is null only when
 * the base64 payload itself is unrecoverable. Never includes key material in
 * the diagnostic.
 */
export function _canonicalizePemKey(raw: string): { pem: string | null; diagnostic: string } {
  let v = raw.trim();
  const notes: string[] = [];

  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
    notes.push("removed wrapping quotes");
  }
  if (v.includes("\\n") || v.includes("\\r")) {
    v = v.replace(/\\r/g, "").replace(/\\n/g, "\n");
    notes.push("converted literal \\n escapes to newlines");
  }

  // Whole value base64-encoded once more? (No PEM marker, but decodes to one.)
  if (!/-----\s*BEGIN/.test(v)) {
    try {
      const decoded = Buffer.from(v.replace(/\s+/g, ""), "base64").toString("utf8");
      if (/-----\s*BEGIN/.test(decoded)) {
        v = decoded;
        notes.push("value was base64-encoded PEM; decoded it");
      }
    } catch {
      /* fall through — handled below */
    }
  }

  // Extract the base64 body between BEGIN/END markers, tolerating ANY
  // whitespace mangling (spaces, tabs, CR/LF, none at all) and hyphen-count
  // drift in the markers.
  const marker = /-{2,}\s*BEGIN\s+([A-Z0-9 ]*?)\s*(?:PRIVATE\s+)?KEY\s*-{2,}([\s\S]*?)-{2,}\s*END\s+[A-Z0-9 ]*?\s*(?:PRIVATE\s+)?KEY\s*-{2,}/;
  const m = v.match(marker);
  let label = "PRIVATE KEY";
  let body: string;
  if (m) {
    const rawLabel = `${m[1] ?? ""}`.trim();
    label = rawLabel ? `${rawLabel} PRIVATE KEY`.replace(/\s+PRIVATE KEY$/, " PRIVATE KEY").trim() : "PRIVATE KEY";
    if (/BEGIN\s+EC/.test(v)) label = "EC PRIVATE KEY";
    body = m[2];
    if (/[ \t]/.test(body.trim())) notes.push("base64 body contained spaces (newlines were lost in pasting)");
  } else {
    // No markers at all — treat the whole value as the body if it's base64ish.
    body = v;
    notes.push("no BEGIN/END markers found; treated value as bare base64 body");
  }

  const compact = body.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return {
      pem: null,
      diagnostic:
        `key body isn't valid base64 (length ${compact.length})` +
        (notes.length ? ` [${notes.join("; ")}]` : ""),
    };
  }

  const wrapped = compact.match(/.{1,64}/g)!.join("\n");
  const pem = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
  return { pem, diagnostic: notes.length ? notes.join("; ") : "key looked well-formed" };
}

// Log the key's parse status once per distinct outcome (not per send).
let lastKeyLog: string | null = null;
function logKeyDiagnosticOnce(message: string, ok: boolean) {
  if (lastKeyLog === message) return;
  lastKeyLog = message;
  if (ok) logger.info(`[apns] ${message}`);
  else logger.error(`[apns] ${message}`);
}

/**
 * Validate the canonicalized key actually parses as the kind of key APNs
 * needs (EC P-256). Returns a short safe description of what's wrong, or
 * null when the key is good. Catches "pasted the wrong file" (an RSA cert
 * key, a certificate, a public key) with a specific message.
 */
export function _describeKeyProblem(pem: string): string | null {
  try {
    const keyObj = crypto.createPrivateKey(pem);
    if (keyObj.asymmetricKeyType !== "ec") {
      return `parses as a ${keyObj.asymmetricKeyType ?? "unknown"} key, not EC — this isn't an Apple APNs auth key (.p8); it may be a certificate/other key`;
    }
    const curve = (keyObj.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve;
    if (curve && curve !== "prime256v1" && curve !== "p256" && curve !== "P-256") {
      return `EC key uses curve ${curve}, but APNs requires P-256 — wrong key file`;
    }
    return null;
  } catch (err) {
    return `Node couldn't parse the key: ${(err as Error).message?.split("\n")[0] ?? "unknown error"}`;
  }
}

function readConfig(): ApnsConfig | null {
  const rawKey = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!rawKey || !keyId || !teamId || !bundleId) return null;

  // Allow either the PEM contents directly or a filesystem path to the .p8.
  let source = rawKey;
  if (!/BEGIN/.test(rawKey) && rawKey.length < 300 && !rawKey.includes(" ")) {
    try {
      // Lazy require so bundlers don't complain when the var holds PEM text.
      source = require("node:fs").readFileSync(rawKey, "utf8");
    } catch {
      /* not a path — treat as (possibly mangled/base64) key text below */
    }
  }

  const { pem, diagnostic } = _canonicalizePemKey(source);
  let key: string;
  if (pem) {
    const problem = _describeKeyProblem(pem);
    if (problem) {
      logKeyDiagnosticOnce(`APNS_KEY_P8 problem: ${problem} (${diagnostic})`, false);
    } else {
      logKeyDiagnosticOnce(`APNS_KEY_P8 parsed OK — EC P-256 (${diagnostic})`, true);
    }
    key = pem;
  } else {
    // Unrecoverable — keep the raw value so the signing path fails with the
    // specific ProviderTokenSigningFailed reason (NOT "not configured", which
    // would wrongly tell the user their env vars are missing).
    logKeyDiagnosticOnce(`APNS_KEY_P8 unrecoverable: ${diagnostic}`, false);
    key = source;
  }

  if (keyId.trim().length !== 10 || teamId.trim().length !== 10) {
    logKeyDiagnosticOnce(
      `APNS_KEY_ID/APNS_TEAM_ID look wrong (lengths ${keyId.trim().length}/${teamId.trim().length}; both are exactly 10 characters in the Apple Developer portal)`,
      false,
    );
  }

  const host =
    (process.env.APNS_PRODUCTION ?? "").toLowerCase() === "true"
      ? PROD_HOST
      : SANDBOX_HOST;

  return { key, keyId: keyId.trim(), teamId: teamId.trim(), bundleId, host };
}

export function isApnsConfigured(): boolean {
  return readConfig() !== null;
}

// ── Provider auth token (ES256 JWT) ──────────────────────────────────────────
// APNs rejects provider tokens older than 1 hour and asks providers not to
// regenerate more than once every 20 minutes, so we cache and refresh at ~50m.
let cachedToken: { value: string; issuedAt: number; keyId: string } | null =
  null;
const TOKEN_REFRESH_MS = 50 * 60 * 1000;

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildProviderToken(cfg: ApnsConfig): string {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.keyId === cfg.keyId &&
    now - cachedToken.issuedAt < TOKEN_REFRESH_MS
  ) {
    return cachedToken.value;
  }

  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const payload = b64url(JSON.stringify({ iss: cfg.teamId, iat }));
  const signingInput = `${header}.${payload}`;

  // ES256 = ECDSA P-256 + SHA-256. APNs (JWS) requires the raw R||S signature
  // (IEEE P1363), not Node's default DER encoding.
  const signature = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: cfg.key,
    dsaEncoding: "ieee-p1363",
  });

  const token = `${signingInput}.${b64url(signature)}`;
  cachedToken = { value: token, issuedAt: now, keyId: cfg.keyId };
  return token;
}

/** Clear the cached provider token (used by tests / key rotation). */
export function _resetApnsTokenCache(): void {
  cachedToken = null;
}

/**
 * Build the APNs provider JWT from the current env config. Returns null when
 * APNs isn't configured. Exposed for unit testing the ES256 signing path.
 */
export function _buildProviderTokenFromEnv(): string | null {
  const cfg = readConfig();
  if (!cfg) return null;
  return buildProviderToken(cfg);
}

/**
 * Build the JSON body APNs expects for an alert push. Exposed for unit testing.
 */
export function buildApnsBody(payload: ApnsPayload): string {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: "default",
  };
  if (typeof payload.badge === "number") aps.badge = payload.badge;

  const body: Record<string, unknown> = { aps };
  if (payload.url) body.url = payload.url;
  if (payload.data) Object.assign(body, payload.data);
  return JSON.stringify(body);
}

/**
 * True when APNs rejected a token purely because the request hit the WRONG
 * ENVIRONMENT, which the alternate-host retry below can fix. Two distinct
 * rejections mean this:
 *
 *  - 400 BadDeviceToken — the TOKEN belongs to the other environment (a
 *    TestFlight/App Store build's production token sent to sandbox, or an Xcode
 *    Debug build's sandbox token sent to production).
 *  - 403 BadEnvironmentKeyInToken — the provider KEY isn't authorized for the
 *    host we used. Apple now allows an APNs auth key to be scoped to Sandbox
 *    only or Production only (rather than both), and a scoped key returns this
 *    against the environment it doesn't cover.
 *
 * The second case was previously NOT retried, so a production-scoped key with
 * APNS_PRODUCTION unset failed permanently — while an unrelated stale sandbox
 * token in the same batch returned 200 and made the whole send look successful.
 *
 * Matched on reason rather than status alone: the status Apple pairs with
 * BadEnvironmentKeyInToken isn't worth depending on, and the reason is
 * unambiguous on its own.
 */
function isWrongEnvironment(r: ApnsSendResult): boolean {
  return (
    r.reason === "BadEnvironmentKeyInToken" ||
    r.reason === "BadCertificateEnvironment" ||
    (r.status === 400 && r.reason === "BadDeviceToken")
  );
}

/**
 * Send one push to many device tokens over a single HTTP/2 connection.
 * No-op (returns []) when APNs isn't configured, so callers don't need to guard.
 */
export async function sendApnsPush(
  tokens: string[],
  payload: ApnsPayload,
): Promise<ApnsSendResult[]> {
  const cfg = readConfig();
  if (!cfg) return [];
  if (tokens.length === 0) return [];

  let providerToken: string;
  try {
    providerToken = buildProviderToken(cfg);
  } catch (err) {
    // The auth JWT couldn't be signed — a malformed/wrong APNS_KEY_P8.
    // Surface it as a per-token failure with a distinct reason instead of an
    // empty result, so callers can tell this apart from "no tokens
    // registered" — and append the safe key diagnostic so the Settings test
    // toast tells the user exactly what's wrong with the pasted key.
    const problem = _describeKeyProblem(cfg.key) ?? (err as Error).message?.split("\n")[0] ?? "unknown";
    logger.error({ err }, `Failed to sign APNs provider token — ${problem}`);
    return tokens.map((token) => ({ token, ok: false, reason: `ProviderTokenSigningFailed: ${problem}` }));
  }

  const body = buildApnsBody(payload);

  // First attempt on the configured host (sandbox unless APNS_PRODUCTION=true).
  let results = await sendBatchToHost(cfg.host, tokens, providerToken, cfg.bundleId, body, payload);

  // A 400 BadDeviceToken means the token belongs to the OTHER APNs environment
  // — e.g. a TestFlight/App-Store build's production token hitting the sandbox
  // host, or a Xcode Debug build's sandbox token hitting production. Rather than
  // make the operator flip APNS_PRODUCTION every time they switch build types,
  // transparently retry just those tokens on the alternate host so delivery
  // works for both. (The provider JWT and apns-topic are the same for both.)
  const altHost = cfg.host === PROD_HOST ? SANDBOX_HOST : PROD_HOST;
  const wrongEnvTokens = results.filter(isWrongEnvironment).map((r) => r.token);
  if (wrongEnvTokens.length > 0) {
    logger.info(
      {
        count: wrongEnvTokens.length,
        from: cfg.host,
        to: altHost,
        reasons: results.filter(isWrongEnvironment).map((r) => `${r.status} ${r.reason}`),
      },
      "APNs wrong-environment retry on alternate host",
    );
    const retried = await sendBatchToHost(altHost, wrongEnvTokens, providerToken, cfg.bundleId, body, payload);
    // Log the retry's own outcome. If BOTH hosts reject with
    // BadEnvironmentKeyInToken, the problem isn't which host we picked — it's
    // that the .p8 auth key itself is scoped to an environment that doesn't
    // cover this device token, which no amount of retrying can fix.
    logger.info(
      { host: altHost, outcome: retried.map((r) => (r.ok ? "ok" : `${r.status} ${r.reason}`)) },
      "APNs alternate-host retry result",
    );
    const byToken = new Map(retried.map((r) => [r.token, r]));
    results = results.map((r) => byToken.get(r.token) ?? r);
  }

  return results;
}

/** Send a batch of tokens to one specific APNs host over a single HTTP/2 connection. */
function sendBatchToHost(
  host: string,
  tokens: string[],
  providerToken: string,
  bundleId: string,
  body: string,
  payload: ApnsPayload,
): Promise<ApnsSendResult[]> {
  return new Promise<ApnsSendResult[]>((resolve) => {
    const session = http2.connect(host);
    const results: ApnsSendResult[] = [];
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(results);
    };

    session.on("error", (err) => {
      logger.warn({ err }, "APNs HTTP/2 session error");
      done();
    });

    let pending = tokens.length;
    for (const token of tokens) {
      const headers: Record<string, string> = {
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "content-type": "application/json",
      };
      if (payload.tag) headers["apns-collapse-id"] = payload.tag.slice(0, 64);

      const req = session.request(headers);
      let status = 0;
      let data = "";

      req.on("response", (h) => {
        status = Number(h[":status"]) || 0;
      });
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        let reason: string | undefined;
        if (status !== 200 && data) {
          try {
            reason = JSON.parse(data)?.reason;
          } catch {
            /* non-JSON error body */
          }
        }
        results.push({ token, ok: status === 200, status, reason });
        if (--pending === 0) done();
      });
      req.on("error", (err) => {
        logger.warn({ err, token: token.slice(0, 12) }, "APNs request error");
        results.push({ token, ok: false });
        if (--pending === 0) done();
      });
      req.end(body);
    }
  });
}
