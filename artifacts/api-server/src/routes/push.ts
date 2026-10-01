import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { pushSubscriptions, nativePushTokens, profiles } from "@workspace/db";
import { isAuthenticated } from "../replit_integrations/auth";
import { initPush, getPublicKey, sendPushToUser } from "../lib/push";

const subscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
  label: z.string().max(100).optional(),
  profileId: z.string().uuid().nullable().optional(),
});

// Native (Capacitor/APNs) device token registration. The iOS app POSTs this
// after the OS hands back a device token (see family-hub/src/lib/nativeNotifications.ts).
const registerNativeBody = z.object({
  // APNs device tokens are 64+ hex chars; keep the bound generous but sane.
  token: z.string().min(32).max(400),
  platform: z.string().max(20).optional(),
  label: z.string().max(100).optional(),
  profileId: z.string().uuid().nullable().optional(),
  /**
   * Set by the app's launch-time token refresh. The refresh only knows the
   * token — not which profile/label this device was assigned to — so for an
   * already-known token it must update ONLY the token's freshness and leave
   * that assignment alone. Without this flag the refresh would silently reset
   * every device to "no profile" on each launch.
   */
  refresh: z.boolean().optional(),
});

// Matches NotificationCategory in lib/push.ts — kept as a literal list here
// (rather than importing the type) since zod needs runtime values, not just
// a type, to validate the request body.
const notificationCategorySchema = z.object({
  rewardRedeemed: z.boolean().optional(),
  choreAssigned: z.boolean().optional(),
  cashoutRequested: z.boolean().optional(),
  inviteAccepted: z.boolean().optional(),
  notePosted: z.boolean().optional(),
  weeklyRecap: z.boolean().optional(),
  behaviourTimer: z.boolean().optional(),
  // Was missing when celebration reminders shipped — z.object strips unknown
  // keys, so a device's celebration opt-out silently never saved.
  celebrationReminder: z.boolean().optional(),
});

const localHealthBody = z.object({
  token: z.string().min(1),
  enabled: z.boolean(),
});

const updatePrefsBody = z.object({
  notificationPrefs: notificationCategorySchema,
});

function getUserId(req: Request): string | null {
  // Replit auth user shape: req.user.claims.sub
  const u = (req as unknown as { user?: { claims?: { sub?: string } } }).user;
  return u?.claims?.sub ?? null;
}

// Lightweight CSRF defense for state-changing push endpoints. Cookies are
// SameSite by default but we belt-and-brace by also rejecting requests whose
// Origin/Referer doesn't match an allow-list. The allow-list is built from
// $REPLIT_DOMAINS (preview + published) plus localhost for shell/curl tests.
function isSameOrigin(req: Request): boolean {
  const origin = req.get("origin") ?? "";
  const referer = req.get("referer") ?? "";
  const candidate = origin || referer;
  if (!candidate) {
    // No Origin header: typically same-origin form posts or non-browser
    // clients (e.g. mobile app with bearer auth). We allow these because the
    // session cookie itself is SameSite=Lax.
    return true;
  }
  let host: string;
  try {
    host = new URL(candidate).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  for (const d of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    const t = d.trim();
    if (t) allowed.add(t);
  }
  allowed.add("localhost");
  allowed.add("localhost:80");
  allowed.add("127.0.0.1");
  // Allow any explicit replit.dev/replit.app subdomains the user is on.
  if (host.endsWith(".replit.dev") || host.endsWith(".replit.app")) return true;
  return allowed.has(host);
}

function requireSameOrigin(req: Request, res: Response): boolean {
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return false;
  }
  return true;
}

export function registerPushRoutes(app: Express): void {
  // Lazy init on first request — also runs at boot via app.ts.
  app.get("/api/push/public-key", async (_req, res: Response) => {
    try {
      await initPush();
      res.json({ publicKey: getPublicKey() });
    } catch (err) {
      console.error("Failed to get VAPID public key", err);
      res.status(500).json({ error: "Push not available" });
    }
  });

  // Read-only lookup so the Settings UI can find THIS device's subscription
  // row (and its current notification preferences) without risking an
  // accidental upsert that would reset profileId/label — POST /subscribe is
  // an upsert-by-endpoint and always overwrites those fields.
  app.post("/api/push/subscriptions/lookup", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const endpoint = z.string().url().safeParse(req.body?.endpoint);
    if (!endpoint.success) return res.status(400).json({ error: "endpoint required" });
    const [row] = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint.data), eq(pushSubscriptions.userId, userId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ id: row.id, notificationPrefs: row.notificationPrefs });
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = subscribeBody.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid subscription", details: parsed.error.format() });
    }
    const { endpoint, keys, userAgent, label, profileId } = parsed.data;

    // If a profileId is provided, ensure it belongs to the caller.
    if (profileId) {
      const owned = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)))
        .limit(1);
      if (owned.length === 0) {
        return res.status(403).json({ error: "Profile not owned by user" });
      }
    }

    // Upsert by endpoint (unique). If endpoint exists for any user, we move
    // it to this user — devices that re-subscribe should retarget.
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);

    if (existing[0]) {
      const updated = await db
        .update(pushSubscriptions)
        .set({
          userId,
          profileId: profileId ?? null,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: userAgent ?? existing[0].userAgent,
          label: label ?? existing[0].label,
          lastSeenAt: new Date(),
        })
        .where(eq(pushSubscriptions.id, existing[0].id))
        .returning();
      return res.json(updated[0]);
    }

    const inserted = await db
      .insert(pushSubscriptions)
      .values({
        userId,
        profileId: profileId ?? null,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
        label: label ?? null,
      })
      .returning();
    res.status(201).json(inserted[0]);
  });

  // ── Native (APNs) device tokens ────────────────────────────────────────────

  app.post("/api/push/register-native", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = registerNativeBody.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid token", details: parsed.error.format() });
    }
    const { token, platform, label, profileId, refresh } = parsed.data;

    // If a profileId is provided, ensure it belongs to the caller.
    if (profileId) {
      const owned = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)))
        .limit(1);
      if (owned.length === 0) {
        return res.status(403).json({ error: "Profile not owned by user" });
      }
    }

    // Upsert by token (unique). A token that reappears for another user should
    // retarget to the current user (device handed to a different family member).
    const existing = await db
      .select()
      .from(nativePushTokens)
      .where(eq(nativePushTokens.token, token))
      .limit(1);

    if (existing[0]) {
      const updated = await db
        .update(nativePushTokens)
        .set({
          userId,
          // A refresh carries no assignment info — preserve what's stored.
          profileId: refresh ? existing[0].profileId : (profileId ?? null),
          platform: platform ?? existing[0].platform,
          label: refresh ? existing[0].label : (label ?? existing[0].label),
          lastSeenAt: new Date(),
        })
        .where(eq(nativePushTokens.id, existing[0].id))
        .returning();
      return res.json(updated[0]);
    }

    const inserted = await db
      .insert(nativePushTokens)
      .values({
        userId,
        profileId: profileId ?? null,
        token,
        platform: platform ?? "ios",
        label: label ?? null,
      })
      .returning();
    return res.status(201).json(inserted[0]);
  });

  app.get("/api/push/native-tokens", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const rows = await db
      .select()
      .from(nativePushTokens)
      .where(eq(nativePushTokens.userId, userId));
    // Don't leak full device tokens to the client.
    res.json(
      rows.map((r) => ({
        id: r.id,
        profileId: r.profileId,
        platform: r.platform,
        label: r.label,
        token: r.token.slice(0, 12) + "…",
        notificationPrefs: r.notificationPrefs,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
      })),
    );
  });

  // Update which notification categories this native device wants (per-device
  // opt-out — see NotificationCategory in lib/push.ts).
  app.patch("/api/push/native-tokens/:id", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const parsed = updatePrefsBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preferences", details: parsed.error.format() });
    }
    const updated = await db
      .update(nativePushTokens)
      .set({ notificationPrefs: parsed.data.notificationPrefs, lastSeenAt: new Date() })
      .where(and(eq(nativePushTokens.id, req.params.id), eq(nativePushTokens.userId, userId)))
      .returning();
    if (updated.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ notificationPrefs: updated[0].notificationPrefs });
  });

  app.delete(
    "/api/push/native-tokens/:id",
    isAuthenticated,
    async (req, res) => {
      if (!requireSameOrigin(req, res)) return;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthenticated" });
      const result = await db
        .delete(nativePushTokens)
        .where(
          and(
            eq(nativePushTokens.id, req.params.id),
            eq(nativePushTokens.userId, userId),
          ),
        )
        .returning();
      if (result.length === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    },
  );

  // A native device reporting that it has (or no longer has) the family's
  // health reminders scheduled on-device. Merges a single key rather than
  // replacing notificationPrefs, because the per-device category toggles in
  // Settings PATCH the whole object and would otherwise wipe this flag every
  // time someone changed an unrelated switch.
  app.post("/api/push/native/local-health", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const parsed = localHealthBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
    }
    const [row] = await db
      .select()
      .from(nativePushTokens)
      .where(and(eq(nativePushTokens.token, parsed.data.token), eq(nativePushTokens.userId, userId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    const updated = await db
      .update(nativePushTokens)
      .set({
        notificationPrefs: { ...(row.notificationPrefs ?? {}), healthReminderLocal: parsed.data.enabled },
        lastSeenAt: new Date(),
      })
      .where(eq(nativePushTokens.id, row.id))
      .returning();
    return res.json({ notificationPrefs: updated[0].notificationPrefs });
  });

  app.get("/api/push/subscriptions", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    // Don't leak the raw key material to the client.
    res.json(
      rows.map((r) => ({
        id: r.id,
        profileId: r.profileId,
        label: r.label,
        userAgent: r.userAgent,
        endpoint: r.endpoint.slice(0, 60) + "…",
        notificationPrefs: r.notificationPrefs,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
      })),
    );
  });

  // Update which notification categories this web device wants (per-device
  // opt-out — see NotificationCategory in lib/push.ts).
  app.patch("/api/push/subscriptions/:id", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const parsed = updatePrefsBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preferences", details: parsed.error.format() });
    }
    const updated = await db
      .update(pushSubscriptions)
      .set({ notificationPrefs: parsed.data.notificationPrefs, lastSeenAt: new Date() })
      .where(and(eq(pushSubscriptions.id, req.params.id), eq(pushSubscriptions.userId, userId)))
      .returning();
    if (updated.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ notificationPrefs: updated[0].notificationPrefs });
  });

  app.delete(
    "/api/push/subscriptions/:id",
    isAuthenticated,
    async (req, res) => {
      if (!requireSameOrigin(req, res)) return;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthenticated" });
      const result = await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.id, req.params.id),
            eq(pushSubscriptions.userId, userId),
          ),
        )
        .returning();
      if (result.length === 0) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    },
  );

  // Allow user to also unsubscribe by endpoint (used when SW reports the
  // browser dropped the subscription).
  app.post("/api/push/unsubscribe", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const endpoint = z.string().url().safeParse(req.body?.endpoint);
    if (!endpoint.success) return res.status(400).json({ error: "endpoint required" });
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint.data),
          eq(pushSubscriptions.userId, userId),
        ),
      );
    res.json({ ok: true });
  });

  // Fire a test notification to the current user — useful for the Settings UI.
  app.post("/api/push/test", isAuthenticated, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });
    const result = await sendPushToUser(
      { userId },
      {
        title: "Family Hub",
        body: "Test notification — you're all set!",
        url: "/",
        tag: "test",
      },
    );
    res.json(result);
  });

  // One-off verification route for wiring up Sentry (2026-08-24) — logs a
  // harmless, clearly-labeled error via the normal logger.error() path,
  // which the pino hook in lib/logger.ts already forwards to Sentry (a
  // no-op if SENTRY_DSN isn't set). Reused for the same "let the user
  // trigger it themselves from the real app" reasoning as /api/push/test
  // right above it — this session had no way to reach the live deployment
  // or Sentry's own (network-blocked-from-here) servers directly.
  app.post("/api/debug/sentry-test", isAuthenticated, (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    req.log.error(
      { err: new Error("Sentry test error — manually triggered from Settings, safe to ignore") },
      "Sentry wiring test",
    );
    res.json({ ok: true });
  });
}
