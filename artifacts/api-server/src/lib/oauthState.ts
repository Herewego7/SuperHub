import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { oauthTransactions } from "@workspace/db";
import { logger } from "./logger";

/**
 * In-flight calendar OAuth connections, stored in Postgres.
 *
 * WHY THIS EXISTS AT ALL: `/api/auth/google` and `/api/auth/outlook` accepted
 * a client-supplied `state` containing a bare profileId, and their callbacks —
 * unauthenticated by necessity, because the provider redirects a browser to
 * them and the native flow carries no cookies — trusted it. Anyone who learned
 * a profile UUID could start a flow for it and have the resulting tokens
 * attached to that profile, hijacking a household's calendar connection.
 *
 * WHY IT IS NOW A TABLE rather than a signed blob: single use was tracked in a
 * process-local Map. Replit Autoscale recycles the container whenever traffic
 * stops, which forgot every nonce and reopened the replay window, and a second
 * instance would never have shared it. An atomic
 * `UPDATE ... WHERE consumed_at IS NULL` is a guarantee no in-memory structure
 * can make across processes.
 *
 * The token handed to the provider is opaque randomness. Only its SHA-256 hash
 * is stored, so a database leak alone cannot be replayed — the same shape as
 * this repo's password reset tokens.
 */

/** How long a minted transaction stays usable. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthProvider = "google" | "outlook";
export type OAuthRedirectMode = "web" | "native";

/**
 * Where a completed flow sends the browser.
 *
 * Derived here from the provider and mode — never from anything a client
 * sent. The redirect target used to travel inside the state and get written
 * straight into `window.location`, with an allowlist as the only thing
 * between it and an open redirect. Now there is nothing to allowlist.
 */
const NATIVE_REDIRECTS: Record<OAuthProvider, string> = {
  google: "superhub://google-auth",
  outlook: "superhub://outlook-auth",
};

export function nativeRedirectFor(provider: OAuthProvider): string {
  return NATIVE_REDIRECTS[provider];
}

/**
 * The signed-in app is at /app. "/" is the public marketing page, so a
 * finished calendar connection must not land there.
 */
export function webCalendarReturn(query: string): string {
  return `/app?${query.replace(/^\?/, "")}`;
}

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === "google" || value === "outlook";
}

export interface OAuthTransactionRecord {
  provider: OAuthProvider;
  /** The login account that began the flow. */
  accountUserId: string;
  /** The household — what profiles.userId holds. */
  familyOwnerUserId: string;
  profileId: string;
  redirectMode: OAuthRedirectMode;
}

export type OAuthStateFailure =
  | "malformed"
  | "not_found"
  | "expired"
  | "replayed"
  | "wrong_provider";

export type OAuthStateResult =
  | ({ ok: true } & OAuthTransactionRecord)
  | { ok: false; reason: OAuthStateFailure };

function hashState(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time compare of two hex hashes. The hash is not guessable on its
 * own, so this is defence in depth against a comparison timing side channel —
 * same reasoning as resetToken.ts.
 */
export function stateHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Begin a flow. Only ever called from an AUTHENTICATED endpoint that has
 * already checked the caller owns `profileId` — that check is what makes the
 * identity recorded here mean anything.
 *
 * Returns the opaque state to hand to the provider. It is never stored.
 */
export async function createOAuthTransaction(
  record: OAuthTransactionRecord,
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await db.insert(oauthTransactions).values({
    stateHash: hashState(state),
    provider: record.provider,
    accountUserId: record.accountUserId,
    familyOwnerUserId: record.familyOwnerUserId,
    profileId: record.profileId,
    redirectMode: record.redirectMode,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  // Opportunistic tidy-up. Cheap, indexed, and keeps the table from growing
  // without a scheduler — which on Autoscale would only run while somebody
  // happened to be using the app anyway.
  void pruneExpiredOAuthTransactions();
  return state;
}

function toRecord(row: typeof oauthTransactions.$inferSelect): OAuthTransactionRecord {
  return {
    provider: row.provider as OAuthProvider,
    accountUserId: row.accountUserId,
    familyOwnerUserId: row.familyOwnerUserId,
    profileId: row.profileId,
    redirectMode: row.redirectMode as OAuthRedirectMode,
  };
}

/**
 * Look at a transaction WITHOUT consuming it.
 *
 * Used by the flow-start routes so a forged or stale state fails before the
 * person has signed in to Google and granted anything — the callback is what
 * consumes it.
 */
export async function peekOAuthTransaction(
  raw: string | null | undefined,
  provider: OAuthProvider,
  now: Date = new Date(),
): Promise<OAuthStateResult> {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "malformed" };

  const [row] = await db
    .select()
    .from(oauthTransactions)
    .where(eq(oauthTransactions.stateHash, hashState(raw)))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.provider !== provider) return { ok: false, reason: "wrong_provider" };
  if (row.consumedAt) return { ok: false, reason: "replayed" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  return { ok: true, ...toRecord(row) };
}

/**
 * Consume a transaction, exactly once.
 *
 * The UPDATE is the whole point: `consumed_at IS NULL` in the WHERE clause
 * means two concurrent callbacks with the same state cannot both succeed, no
 * matter which process or instance they land on. Checking and then updating
 * would be a race.
 *
 * `provider` is part of the match so a state minted for Google cannot be
 * completed on the Outlook callback.
 */
export async function consumeOAuthTransaction(
  raw: string | null | undefined,
  provider: OAuthProvider,
  now: Date = new Date(),
): Promise<OAuthStateResult> {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "malformed" };
  const stateHash = hashState(raw);

  const claimed = await db
    .update(oauthTransactions)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthTransactions.stateHash, stateHash),
        eq(oauthTransactions.provider, provider),
        isNull(oauthTransactions.consumedAt),
        sql`${oauthTransactions.expiresAt} > ${now}`,
      ),
    )
    .returning();

  if (claimed.length > 0) return { ok: true, ...toRecord(claimed[0]) };

  // Nothing claimed. Read the row back to say WHY, so the logs distinguish a
  // forgery from an expiry from a replay — they call for different responses
  // from whoever is looking.
  const [row] = await db
    .select()
    .from(oauthTransactions)
    .where(eq(oauthTransactions.stateHash, stateHash))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.provider !== provider) return { ok: false, reason: "wrong_provider" };
  if (row.consumedAt) return { ok: false, reason: "replayed" };
  return { ok: false, reason: "expired" };
}

/** Delete transactions past their expiry. Best-effort. */
export async function pruneExpiredOAuthTransactions(): Promise<void> {
  try {
    await db.delete(oauthTransactions).where(lt(oauthTransactions.expiresAt, new Date()));
  } catch (err) {
    logger.warn({ err }, "Failed to prune expired OAuth transactions");
  }
}
