import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { apiRequest } from "@/lib/queryClient";
import { setPendingCelebrationDeepLink, setPendingTabDeepLink } from "@/lib/pushDeepLink";
import { stageEveningPlan } from "@/components/chat-view";

/**
 * Native (Capacitor) notifications for the iOS app.
 *
 * Web builds use Web Push (see `lib/push.ts`); that API does not exist inside a
 * WKWebView, so native builds must use APNs via @capacitor/push-notifications for
 * remote pushes, plus @capacitor/local-notifications for on-device reminders.
 *
 * Everything here is a no-op / throws clearly on web so callers can branch on
 * `isNativeNotificationsSupported()`.
 *
 * BACKEND + XCODE FOLLOW-UPS (see MOBILE.md):
 *  - Backend must implement POST /api/push/register-native to store the APNs
 *    device token, and send via APNs (token-based p8 key) for remote pushes.
 *  - The "Push Notifications" capability + an APNs entitlement must be enabled in
 *    Xcode (one click) before remote push works on device.
 */

export function isNativeNotificationsSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Whether push notifications are already granted on this device — reads the
 * real OS permission state instead of a component-level flag that resets to
 * "not enabled" on every mount/remount, even on an already-registered device.
 */
export async function isNativePushEnabled(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const perm = await PushNotifications.checkPermissions();
  return perm.receive === "granted";
}

// ── Remote push (APNs) ──────────────────────────────────────────────────────

interface RegistrationOpts {
  profileId?: string | null;
  label?: string;
}

// The most recent enable request — read by the persistent 'registration'
// listener when the OS hands back a device token (which is asynchronous).
let pendingRegistration: RegistrationOpts | null = null;
let listenersReady = false;

// The in-flight enableNativePush() call, if any — resolved/rejected by the
// 'registration'/'registrationError' listeners below once the OS actually
// finishes (or fails) registering this device, rather than the moment
// PushNotifications.register() is merely called. Without this, a missing
// APNs entitlement (Xcode capability never enabled) or a failed save to our
// backend produced zero visible error — the caller had already resolved.
let pendingResolve: (() => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

// True while a launch-time token refresh is in flight. The 'registration'
// listener is shared with the explicit enable flow, and a refresh has no idea
// which profile/label this device was assigned to — so it must tell the server
// "just update the token", never re-send defaults that would clobber them.
let refreshInFlight = false;
// One refresh per app session is enough; the token can't change while running.
let refreshDone = false;
// The most recent APNs token the OS handed us this run. Kept so other modules
// (localHealthReminders.ts) can name THIS device to the backend without
// re-registering to find out what its token is.
let lastKnownToken: string | null = null;

/** This device's current APNs token, or null before registration completes. */
export function getNativePushToken(): string | null {
  return lastKnownToken;
}

/**
 * Wire up the persistent push listeners exactly once. Safe to call repeatedly
 * and safe to call at app boot. No-op on web.
 */
export async function initNativeNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || listenersReady) return;
  listenersReady = true;

  // OS returned an APNs device token → persist it on the backend.
  await PushNotifications.addListener("registration", async (token) => {
    lastKnownToken = token.value;
    const isRefresh = refreshInFlight;
    refreshInFlight = false;
    try {
      await apiRequest("POST", "/api/push/register-native", {
        token: token.value,
        platform: Capacitor.getPlatform(), // "ios"
        ...(isRefresh
          ? // Refresh: keep whatever profile/label this device already had.
            { refresh: true }
          : {
              profileId: pendingRegistration?.profileId ?? null,
              label: pendingRegistration?.label ?? "iPhone/iPad",
            }),
      });
      pendingResolve?.();
    } catch (err: any) {
      pendingReject?.(new Error(err?.message ?? "Failed to save this device's notification token."));
    } finally {
      pendingResolve = null;
      pendingReject = null;
    }
  });

  await PushNotifications.addListener("registrationError", (err) => {
    pendingReject?.(
      new Error(
        (err as any)?.error ??
          "This device didn't register with Apple's push service. Make sure the Push Notifications capability is enabled in the app build.",
      ),
    );
    pendingResolve = null;
    pendingReject = null;
  });

  // The user tapped a delivered push notification (app was backgrounded or
  // not running). Unlike web, there's no URL to navigate to — Capacitor
  // instead hands back the original payload's `data` object, which is where
  // routes.ts/lib/push.ts attach things like `{ kind, celebrationId }`.
  // Previously nothing listened for this at all, so tapping a notification
  // just opened the app to whatever screen it happened to launch on.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action?.notification?.data as { kind?: string; celebrationId?: string; body?: string } | undefined;
    if (data?.kind === "celebration-reminder" && data.celebrationId) {
      setPendingCelebrationDeepLink(data.celebrationId);
    } else if (data?.kind === "bedtime-reminder") {
      setPendingTabDeepLink({ tab: "chores" });
    } else if (data?.kind === "chore-assigned") {
      setPendingTabDeepLink({ tab: "chores" });
    } else if (data?.kind === "reward-redeemed") {
      setPendingTabDeepLink({ tab: "chores", subTab: "rewards" });
    } else if (data?.kind === "cashout-requested") {
      // Same as the Announcements "Go to Cash-Out Approvals" deep link —
      // lands on Rewards, then opens the PIN dialog for the approval card.
      setPendingTabDeepLink({ tab: "chores", subTab: "rewards", action: "parentControls" });
    } else if (data?.kind === "cashout-declined") {
      // Spotlights the requester's own Cash Out Stars card, same as Home's
      // Cash Out button — the balance they'll see there is the returned one.
      setPendingTabDeepLink({ tab: "chores", subTab: "rewards", action: "cashoutStars" });
    } else if (data?.kind === "wishlist-approved") {
      // Their suggested reward is now live in the catalog — go see it.
      setPendingTabDeepLink({ tab: "chores", subTab: "rewards" });
    } else if (data?.kind === "health-reminder") {
      setPendingTabDeepLink({ tab: "home", action: "healthReminders" });
    } else if (data?.kind === "shoutout") {
      setPendingTabDeepLink({ tab: "home", action: "praiseSection" });
    } else if (data?.kind === "note") {
      setPendingTabDeepLink({ tab: "home", action: "notesSection" });
    } else if (data?.kind === "evening-plan") {
      if (data.body) stageEveningPlan(data.body);
      setPendingTabDeepLink({ tab: "chat" });
    }
  });
}

/**
 * Re-send this device's CURRENT APNs token to the server, once per app run.
 *
 * Why this has to exist: an APNs device token is not permanent. It changes on
 * reinstall, on restore-from-backup, and on some iOS updates — and the only way
 * to learn the current one is to call register() and read the token the OS
 * hands back. Previously register() was only ever called from the "Enable
 * notifications" button, so the token was captured once and never again: after
 * any rotation the server kept pushing to a dead token forever, and the user
 * had no way to know (APNs returns 200 for a recently-retired token until its
 * feedback catches up, so every layer reports success while nothing arrives).
 *
 * Deliberately never prompts — it checks the existing permission and bails if
 * push was never granted, so this can run on every launch without nagging.
 * Must be called from an authenticated context: the token POST requires a
 * session.
 */
export async function refreshNativePushRegistration(): Promise<void> {
  if (!Capacitor.isNativePlatform() || refreshDone) return;
  refreshDone = true;
  try {
    await initNativeNotifications();
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") return;
    refreshInFlight = true;
    await PushNotifications.register();
  } catch {
    // Best effort — the explicit Enable flow is still there to surface errors.
    refreshInFlight = false;
  }
}

/**
 * Request permission and register this device for APNs push. Throws if the
 * user denies permission, if called on web, or if the device fails to
 * actually complete registration with Apple (or the token fails to save to
 * our backend) — waits for the real outcome instead of resolving as soon as
 * registration is merely requested.
 */
export async function enableNativePush(opts: RegistrationOpts = {}): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Native push is only available in the app");
  }
  await initNativeNotifications();

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") {
    throw new Error("Notifications permission was denied");
  }

  pendingRegistration = opts;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingResolve = null;
      pendingReject = null;
      reject(
        new Error(
          "This device didn't hear back from Apple's push service after 15 seconds. Make sure the Push Notifications capability is enabled in the app build, then try again.",
        ),
      );
    }, 15_000);
    pendingResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    pendingReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };
    PushNotifications.register().catch((err) => pendingReject?.(err));
  });
}

// ── Local (on-device) notifications ─────────────────────────────────────────

export interface LocalReminder {
  /** Stable numeric id so the reminder can be updated/cancelled later. */
  id: number;
  title: string;
  body: string;
  /** When to fire. */
  at: Date;
}

/** Request permission to show local notifications. Returns true if granted. */
export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await LocalNotifications.requestPermissions();
  return res.display === "granted";
}

/**
 * Make sure this device may show local notifications, asking only if iOS has
 * not already been asked.
 *
 * ⚠️ Nothing called `requestLocalNotificationPermission` before 2026-09-28, so
 * the health-reminder scheduler was calling `schedule()` having never
 * established permission. `LocalNotifications.schedule()` REJECTS in that
 * state rather than returning quietly, and the one caller invoked it as
 * `void syncLocalHealthReminders(...)` — an unhandled rejection that no one
 * saw. The visible result was the one reported: reminders arrived while the
 * app was open (those are the SERVER's push, which never got suppressed
 * because the suppression call sat after the throw) and never arrived once
 * the app was closed.
 *
 * Checking first matters: `requestPermissions` on an already-decided
 * permission is a no-op, but asking unprompted on a fresh install would put a
 * system dialog in front of someone who has not yet asked for reminders.
 */
export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    // "denied" is a settled answer — asking again does nothing on iOS, and
    // pretending otherwise would loop a dialog that never appears.
    if (current.display === "denied") return false;
    const res = await LocalNotifications.requestPermissions();
    return res.display === "granted";
  } catch {
    return false;
  }
}

/** Schedule (or replace) a one-off local reminder. No-op on web. */
export async function scheduleLocalReminder(reminder: LocalReminder): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: reminder.id,
        title: reminder.title,
        body: reminder.body,
        schedule: { at: reminder.at, allowWhileIdle: true },
      },
    ],
  });
}

/** Cancel a previously scheduled local reminder by id. No-op on web. */
export async function cancelLocalReminder(id: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id }] });
}


/**
 * Schedule several local notifications at once, replacing any with the same
 * id. Accepts either a one-off instant or a repeating calendar trigger — see
 * localHealthReminders.ts for why repeating matters.
 *
 * `allowWhileIdle` is what lets these fire with the device idle and the app
 * not running, which is the entire point.
 */
export async function scheduleLocalNotifications(
  plans: {
    id: number;
    title: string;
    body: string;
    at?: Date;
    on?: { hour: number; minute: number; weekday?: number; day?: number };
    repeats: boolean;
    reminderId?: string;
  }[],
): Promise<void> {
  if (!Capacitor.isNativePlatform() || plans.length === 0) return;
  await LocalNotifications.schedule({
    notifications: plans.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      // Carried so a TAP knows which reminder it belongs to. Without it the
      // app could only open at the front door: the notification named nothing,
      // so there was no profile to select and nothing to point at
      // (2026-09-29). Ids only — the notification text is deliberately generic
      // and this must not reintroduce the detail through the back door.
      extra: { kind: "health-reminder", reminderId: p.reminderId ?? null },
      schedule: p.at
        ? { at: p.at, allowWhileIdle: true }
        : { on: p.on, repeats: p.repeats, allowWhileIdle: true },
    })),
  });
}

/** Cancel local notifications by id. No-op on web or with an empty list. */
export async function cancelLocalNotifications(ids: number[]): Promise<void> {
  if (!Capacitor.isNativePlatform() || ids.length === 0) return;
  await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
}

/** Ids of every local notification iOS currently holds for this app. */
export async function pendingLocalNotificationIds(): Promise<number[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications.map((n) => n.id);
  } catch {
    return [];
  }
}

/**
 * What iOS is holding, WITH the trigger it intends to use.
 *
 * The count alone is not enough. On 2026-09-29 a device reported "1 planned,
 * 1 held by iOS" for a reminder set minutes ahead, and nothing arrived — a
 * pending notification whose trigger is for the wrong moment looks exactly
 * like a correct one until you read the trigger.
 */
export async function pendingLocalNotifications(): Promise<
  { id: number; title: string; schedule: unknown }[]
> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications.map((n) => ({
      id: n.id,
      title: n.title ?? "",
      schedule: (n as { schedule?: unknown }).schedule,
    }));
  } catch {
    return [];
  }
}

/**
 * What iOS has already SHOWN, as opposed to what it is still holding.
 *
 * This is the question no diagnostic has been able to answer: did the
 * notification fire and go unnoticed, or did it never fire at all? Those look
 * identical from the app, and they have completely different causes.
 */
export async function deliveredLocalNotificationIds(): Promise<number[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const delivered = await LocalNotifications.getDeliveredNotifications();
    return delivered.notifications.map((n) => n.id);
  } catch {
    return [];
  }
}

/** Delivered health reminders, with the reminder each one belongs to. */
export async function deliveredHealthReminderIds(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const delivered = await LocalNotifications.getDeliveredNotifications();
    return delivered.notifications
      .map((n) => (n as { extra?: { kind?: string; reminderId?: string } }).extra)
      .filter((e): e is { kind: string; reminderId: string } =>
        !!e && e.kind === "health-reminder" && typeof e.reminderId === "string")
      .map((e) => e.reminderId);
  } catch {
    return [];
  }
}

/**
 * Called when someone taps a local notification, including from a cold start.
 *
 * Nothing listened for this before, so tapping a medication reminder opened
 * the app and did nothing else — no profile selected, nothing highlighted
 * (2026-09-29). Remote pushes had a handler; the local ones that replaced them
 * did not.
 */
export function onLocalNotificationTap(
  handler: (extra: { kind?: string; reminderId?: string | null }) => void,
): void {
  if (!Capacitor.isNativePlatform()) return;
  void LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const extra = (action.notification as { extra?: Record<string, unknown> }).extra ?? {};
    handler(extra as { kind?: string; reminderId?: string | null });
  });
}

/**
 * Schedule a plain local notification a minute out, through the same plugin
 * call the reminders use.
 *
 * This is a bisect, not a feature. If this one arrives with the app force-quit
 * and a real reminder does not, delivery works and our scheduling is wrong; if
 * neither arrives, the fault is below us and no amount of planning logic will
 * fix it.
 */
export async function scheduleLocalDeliveryProbe(): Promise<{ id: number; at: Date } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (!(await ensureLocalNotificationPermission())) return null;
  const id = 999_111_222;
  const at = new Date(Date.now() + 60_000);
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: "Test reminder",
        body: "If you are reading this with the app closed, delivery works.",
        schedule: { at, allowWhileIdle: true },
      },
    ],
  });
  return { id, at };
}
