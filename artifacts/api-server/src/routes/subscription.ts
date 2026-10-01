import type { Express } from "express";
import express from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { logger } from "../lib/logger";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "@workspace/db";
import {
  getEntitlementDecision,
  getFamilyEntitlementDecision,
  setComped,
  applyAppleSubscriptionUpdate,
  findUserIdByOriginalTransactionId,
  releaseAppleSubscriptionFromOtherUsers,
} from "../lib/subscriptionEntitlement";
import {
  fetchSubscriptionState,
  verifyServerNotification,
  decodeWebhookTransactionAndRenewal,
  statusName,
  appStoreConfigCheck,
} from "../lib/appStoreServerApi";

function accountId(req: any): string {
  return req.user?.claims?.sub;
}

// Comma-separated account emails allowed to call the comp endpoint — a
// single-admin allowlist rather than a full role/permissions system, since
// this app has exactly one owner today. Deliberately an env var, not a DB
// column, so granting yourself admin never depends on a migration.
function isAdmin(email: string | null | undefined): boolean {
  const allow = (process.env.SUBSCRIPTION_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email.toLowerCase());
}

export function registerSubscriptionRoutes(app: Express): void {
  // What the app shows: trial countdown, whether gated features are
  // currently allowed, etc. Every gated screen calls this once (via
  // react-query) rather than re-deriving entitlement logic client-side —
  // the SAME decision the backend's own route-level gates use, so the UI
  // and the actual enforcement can never disagree with each other.
  app.get("/api/subscription/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = accountId(req);
      // The HOUSEHOLD decision, because that is what the route gates now use
      // and the two must never disagree. `ownEntitlement` carries this
      // login's own state alongside it, so Settings can still decide whether
      // to offer "Subscribe Now" (this account could buy) separately from
      // whether the family currently has access (it may be covered by
      // someone else's subscription).
      const [decision, own] = await Promise.all([
        getFamilyEntitlementDecision(userId),
        getEntitlementDecision(userId),
      ]);
      res.json({
        ...decision,
        coveredByFamily: decision.entitled && decision.grantedBy !== null && decision.grantedBy !== userId,
        ownEntitlement: { reason: own.reason, isComped: own.isComped, trialEndsAt: own.trialEndsAt },
      });
    } catch (error) {
      req.log.error({ error }, "Failed to load subscription status");
      res.status(500).json({ message: "Failed to load subscription status" });
    }
  });

  // Called by the app right after a StoreKit 2 purchase/restore completes.
  // The client sends whichever transaction id it just obtained; we ask
  // Apple directly for that account's CURRENT subscription state (not the
  // one transaction in isolation) and persist it — this also naturally
  // handles "restore purchases" on a new device, since Apple's response
  // reflects the real current state regardless of which specific
  // transaction id was used to look it up.
  app.post("/api/subscription/verify", isAuthenticated, async (req: any, res) => {
    try {
      const userId = accountId(req);
      const transactionId = typeof req.body?.transactionId === "string" ? req.body.transactionId : null;
      if (!transactionId) {
        return res.status(400).json({ message: "transactionId is required" });
      }
      const state = await fetchSubscriptionState(transactionId);
      if (!state) {
        return res.status(502).json({ message: "Could not confirm this purchase with Apple right now — please try again in a moment." });
      }
      // A subscription follows the Apple ID, so the account holding it can
      // change — and it has to MOVE rather than copy, or the previous account
      // keeps paid access off someone else's card and webhook routing for this
      // transaction becomes ambiguous. See the function's own note.
      const released = await releaseAppleSubscriptionFromOtherUsers(state.originalTransactionId, userId);
      if (released > 0) {
        req.log.info(
          { originalTransactionId: state.originalTransactionId, released, claimedBy: userId },
          "Apple subscription re-linked to a different account",
        );
      }
      await applyAppleSubscriptionUpdate(userId, {
        appleOriginalTransactionId: state.originalTransactionId,
        appleProductId: state.productId,
        appleSubscriptionState: state.status,
        appleExpiresAt: state.expiresDate,
        appleAutoRenewStatus: state.autoRenewStatus,
      });
      const decision = await getEntitlementDecision(userId);
      res.json(decision);
    } catch (error) {
      req.log.error({ error }, "Failed to verify subscription purchase");
      res.status(500).json({ message: "Failed to verify purchase" });
    }
  });

  // App Store Server Notifications V2 — Apple calls this automatically on
  // every renewal/cancellation/refund/billing event, keeping entitlement
  // accurate even if the family never reopens the app. Unauthenticated by
  // necessity (Apple, not a logged-in user, calls this) — signature
  // verification against Apple's own root CA (inside verifyServerNotification
  // AND, separately, decodeWebhookTransactionAndRenewal for the nested JWS)
  // is what makes that safe; a payload that doesn't verify is rejected
  // outright, never trusted.
  app.post(
    "/api/webhooks/app-store-server-notifications",
    express.json({ limit: "1mb" }),
    async (req, res) => {
      try {
        const signedPayload = typeof req.body?.signedPayload === "string" ? req.body.signedPayload : null;
        if (!signedPayload) {
          return res.status(400).json({ message: "Missing signedPayload" });
        }
        const decoded = await verifyServerNotification(signedPayload);
        if (!decoded) {
          // Could not verify — reject rather than silently accept. Apple
          // retries failed webhook deliveries, so a transient failure here
          // (e.g. root certs not configured yet) is recoverable, not a
          // permanently-dropped event.
          return res.status(400).json({ message: "Could not verify notification" });
        }

        if (!decoded.data?.signedTransactionInfo) {
          // TEST notifications (sent when you register/verify the webhook
          // URL in App Store Connect) and a couple of other notification
          // shapes carry no transaction data at all — nothing to apply,
          // acknowledge and move on.
          return res.status(200).json({ ok: true });
        }

        const nested = await decodeWebhookTransactionAndRenewal(decoded.data);
        if (!nested?.originalTransactionId) {
          return res.status(400).json({ message: "Could not decode transaction data" });
        }

        // Prefer appAccountToken (set to our own userId at purchase time,
        // see the native purchase flow) — falls back to matching the
        // already-recorded originalTransactionId for notification shapes
        // where Apple doesn't echo the token back.
        const userId = nested.appAccountToken ?? (await findUserIdByOriginalTransactionId(nested.originalTransactionId));
        if (!userId) {
          // NOT an error, and deliberately not logged as one: with Streamlined
          // Purchasing enabled, someone can subscribe straight from the App
          // Store product page, before this app has ever seen them. There is no
          // appAccountToken (the app sets that at purchase time, and the app
          // wasn't involved) and nothing stored to match against yet. The
          // purchase is claimed the moment they open the app signed in — the
          // launch-time sync posts the transaction to /verify, which links it —
          // and every later notification for it then resolves normally through
          // the fallback above.
          logger.info(
            { originalTransactionId: nested.originalTransactionId, notificationType: decoded.notificationType },
            "App Store notification for a subscription no account has claimed yet — waiting for the buyer to open the app",
          );
          return res.status(200).json({ ok: true, pending: "unclaimed" });
        }

        await applyAppleSubscriptionUpdate(userId, {
          appleOriginalTransactionId: nested.originalTransactionId,
          appleProductId: nested.productId ?? "",
          appleSubscriptionState: statusName(decoded.data.status),
          appleExpiresAt: nested.expiresDate,
          appleAutoRenewStatus: nested.autoRenewStatus,
        });

        res.status(200).json({ ok: true });
      } catch (error) {
        logger.error({ error }, "Failed to process App Store Server Notification");
        res.status(500).json({ message: "Failed to process notification" });
      }
    },
  );

  // Admin-only: a redacted "are the secrets in right?" check, so verifying a
  // deploy's App Store configuration doesn't mean waiting for a real purchase
  // or webhook to fail silently. Values are never returned, only their state.
  app.get("/api/admin/subscription/config-check", isAuthenticated, async (req: any, res) => {
    const email = req.user?.claims?.email as string | undefined;
    if (!isAdmin(email)) {
      return res.status(403).json({ message: "Not authorized" });
    }
    return res.json(appStoreConfigCheck());
  });

  // Admin-only: comp/uncomp a specific account. Single-owner allowlist
  // (SUBSCRIPTION_ADMIN_EMAILS), not exposed to regular users at all.
  app.post("/api/admin/subscription/comp", isAuthenticated, async (req: any, res) => {
    try {
      const email = req.user?.claims?.email as string | undefined;
      if (!isAdmin(email)) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const comped = req.body?.comped !== false; // default true
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;

      // Accepts an email as well as a userId: in practice you know the
      // account by the address someone signed up with, and looking the id up
      // by hand meant shell access to the production database just to comp a
      // friend or un-comp the App Store review account.
      let targetUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
      const targetEmail = typeof req.body?.email === "string" ? req.body.email.trim() : null;
      if (!targetUserId && targetEmail) {
        const [found] = await db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${targetEmail.toLowerCase()}`)
          .limit(1);
        if (!found) {
          return res.status(404).json({ message: `No account found for ${targetEmail}` });
        }
        targetUserId = found.id;
      }
      if (!targetUserId) {
        return res.status(400).json({ message: "userId or email is required" });
      }
      await setComped(targetUserId, comped, reason, email);
      res.json({ ok: true, userId: targetUserId, comped });
    } catch (error) {
      req.log.error({ error }, "Failed to update comp status");
      res.status(500).json({ message: "Failed to update comp status" });
    }
  });
}
