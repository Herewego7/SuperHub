import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  pushSubscriptions,
  pushVapidKeys,
  nativePushTokens,
  type PushSubscriptionRow,
  type NativePushTokenRow,
} from "@workspace/db";
import { logger } from "./logger";
import { sendApnsPush, isApnsConfigured } from "./apns";

let cachedPublicKey: string | null = null;
let initialized = false;

// A valid VAPID `sub` claim must be a real `mailto:` or `https:` URI. The old
// default used the `.local` reserved TLD (`mailto:admin@familyhub.local`),
// which Apple's Web Push service (iOS/macOS Safari) can reject outright — and
// which is bad practice for every push service. Prefer an explicit env var,
// then a mailto at the app's real domain, and never the `.local` placeholder.
function resolveVapidSubject(stored?: string | null): string {
  const fromEnv = process.env.VAPID_SUBJECT?.trim();
  if (fromEnv && (fromEnv.startsWith("mailto:") || fromEnv.startsWith("https://"))) {
    return fromEnv;
  }
  // Repair an already-stored bad default so existing deployments get fixed
  // without a manual DB edit (changing the subject does NOT invalidate any
  // existing browser subscriptions — the keypair is unchanged).
  if (stored && !stored.includes(".local") && (stored.startsWith("mailto:") || stored.startsWith("https://"))) {
    return stored;
  }
  return "mailto:support@hubforfamilies.com";
}

export async function initPush(): Promise<void> {
  if (initialized) return;

  const existing = await db.select().from(pushVapidKeys).limit(1);
  let row = existing[0];

  const subject = resolveVapidSubject(row?.subject);

  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    const inserted = await db
      .insert(pushVapidKeys)
      .values({
        id: "singleton",
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject,
      })
      .returning();
    row = inserted[0];
    logger.info("Generated new VAPID keypair for web push");
  } else if (row.subject !== subject) {
    // Persist the corrected subject so it's consistent across restarts.
    await db
      .update(pushVapidKeys)
      .set({ subject })
      .where(eq(pushVapidKeys.id, row.id));
    logger.info({ from: row.subject, to: subject }, "Corrected VAPID subject");
  }

  webpush.setVapidDetails(subject, row.publicKey, row.privateKey);
  cachedPublicKey = row.publicKey;
  initialized = true;
}

export function getPublicKey(): string {
  if (!cachedPublicKey) {
    throw new Error("Push not initialized — call initPush() during boot");
  }
  return cachedPublicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  // Optional click target (path on the web app)
  url?: string;
  // Optional tag — replaces previous notification with same tag
  tag?: string;
  // Free-form data attached to the notification event
  data?: Record<string, unknown>;
}

export interface PushTarget {
  userId: string;
  profileId?: string | null;
}

// Newer, less-essential notification categories a user can opt out of
// per-device (see notificationPrefs on pushSubscriptions/nativePushTokens).
// Older/core categories (bedtime, daily brief, health reminders) aren't in
// this list — they already have their own dedicated on/off controls and
// were never gated by this mechanism, so adding it here would be a silent
// behavior change for existing users.
export type NotificationCategory =
  | "rewardRedeemed"
  | "choreAssigned"
  | "cashoutRequested"
  | "inviteAccepted"
  | "notePosted"
  | "weeklyRecap"
  | "behaviourTimer"
  | "celebrationReminder"
  // Not an opt-out category like the rest: a device sets healthReminderLocal
  // when it has scheduled the family's medication reminders on-device (see
  // family-hub's localHealthReminders.ts), and this tag is what lets the
  // server skip it so the reminder doesn't arrive twice.
  | "healthReminder";

// Missing/undefined key = still enabled. This is an opt-OUT model: a device
// that registered before a given category existed should keep receiving it
// until the user explicitly turns it off, not silently stop.
function categoryEnabled(
  prefs: Record<string, boolean | undefined> | null | undefined,
  category: NotificationCategory | undefined,
): boolean {
  if (!category) return true;
  return prefs?.[category] !== false;
}

export interface PushResult {
  // Web Push (browser/VAPID)
  sent: number;
  pruned: number;
  failed: number;
  // Native APNs (iOS app)
  nativeSent: number;
  nativePruned: number;
  nativeFailed: number;
  // Whether the server has APNs credentials configured at all (all 4 env vars).
  nativeConfigured: boolean;
  // Per-token failure reasons from APNs (e.g. "403 InvalidProviderToken",
  // "400 BadDeviceToken") — surfaced so the client can show WHY a native push
  // didn't land instead of a silent "0 sent".
  nativeReasons: string[];
}

// Profile scoping shared by both delivery paths: a subscription/token tied to
// the target profile, OR not tied to any profile (a "shared" family device), is
// in scope. When no profile is targeted, everything for the user is in scope.
function inProfileScope(
  rowProfileId: string | null,
  targetProfileId: string | null | undefined,
): boolean {
  if (!targetProfileId) return true;
  return rowProfileId === targetProfileId || rowProfileId == null;
}

/**
 * Send a push notification to all of a user's devices (and optional profile) —
 * both Web Push subscriptions and native APNs tokens. Dead destinations
 * (web 404/410, APNs BadDeviceToken/Unregistered) are pruned.
 *
 * Returns counts for visibility.
 */
export async function sendPushToUser(
  target: PushTarget,
  payload: PushPayload,
  category?: NotificationCategory,
): Promise<PushResult> {
  const [web, native] = await Promise.all([
    sendWebPush(target, payload, category),
    sendNativePush(target, payload, category),
  ]);
  return { ...web, ...native };
}

async function sendWebPush(
  target: PushTarget,
  payload: PushPayload,
  category?: NotificationCategory,
): Promise<{ sent: number; pruned: number; failed: number }> {
  await initPush();

  const all = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, target.userId));
  const subs: PushSubscriptionRow[] = all.filter(
    (s) =>
      inProfileScope(s.profileId, target.profileId) &&
      categoryEnabled(s.notificationPrefs, category),
  );

  if (subs.length === 0) {
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent++;
        await db
          .update(pushSubscriptions)
          .set({ lastSeenAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id));
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
          pruned++;
        } else {
          failed++;
          logger.warn(
            { err, endpoint: sub.endpoint.slice(0, 60), status },
            "Push delivery failed",
          );
        }
      }
    }),
  );

  return { sent, pruned, failed };
}

async function sendNativePush(
  target: PushTarget,
  payload: PushPayload,
  category?: NotificationCategory,
): Promise<{ nativeSent: number; nativePruned: number; nativeFailed: number; nativeConfigured: boolean; nativeReasons: string[] }> {
  if (!isApnsConfigured()) {
    logger.warn("Native push skipped — APNs not configured (missing one of APNS_KEY_P8/KEY_ID/TEAM_ID/BUNDLE_ID)");
    return { nativeSent: 0, nativePruned: 0, nativeFailed: 0, nativeConfigured: false, nativeReasons: [] };
  }

  const all = await db
    .select()
    .from(nativePushTokens)
    .where(eq(nativePushTokens.userId, target.userId));
  const rows: NativePushTokenRow[] = all.filter(
    (t) =>
      inProfileScope(t.profileId, target.profileId) &&
      categoryEnabled(t.notificationPrefs, category) &&
      // Deliberately native-only: a web device cannot schedule local
      // notifications, so web push stays the delivery path there.
      !(category === "healthReminder" && t.notificationPrefs?.healthReminderLocal === true),
  );
  if (rows.length === 0) {
    return { nativeSent: 0, nativePruned: 0, nativeFailed: 0, nativeConfigured: true, nativeReasons: [] };
  }

  const results = await sendApnsPush(
    rows.map((r) => r.token),
    {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      data: payload.data,
    },
  );

  let nativeSent = 0;
  let nativePruned = 0;
  let nativeFailed = 0;
  const toPrune: string[] = [];
  const toTouch: string[] = [];
  const nativeReasons: string[] = [];

  for (const r of results) {
    if (r.ok) {
      nativeSent++;
      toTouch.push(r.token);
    } else if (
      r.status === 410 ||
      r.reason === "Unregistered" ||
      r.reason === "BadDeviceToken" ||
      r.reason === "DeviceTokenNotForTopic"
    ) {
      // Token is permanently invalid — drop it so we stop trying.
      nativePruned++;
      toPrune.push(r.token);
      nativeReasons.push(`${r.status ?? "?"} ${r.reason ?? "invalid token"}`);
    } else {
      nativeFailed++;
      nativeReasons.push(`${r.status ?? "?"} ${r.reason ?? "unknown error"}`);
      logger.warn(
        { status: r.status, reason: r.reason, token: r.token.slice(0, 12) },
        "APNs delivery failed",
      );
    }
  }

  logger.info(
    { nativeSent, nativePruned, nativeFailed, reasons: nativeReasons, host: process.env.APNS_PRODUCTION === "true" ? "production" : "sandbox" },
    "APNs send outcome",
  );

  if (toPrune.length > 0) {
    await db
      .delete(nativePushTokens)
      .where(inArray(nativePushTokens.token, toPrune));
  }
  if (toTouch.length > 0) {
    await db
      .update(nativePushTokens)
      .set({ lastSeenAt: new Date() })
      .where(inArray(nativePushTokens.token, toTouch));
  }

  return { nativeSent, nativePruned, nativeFailed, nativeConfigured: true, nativeReasons };
}
