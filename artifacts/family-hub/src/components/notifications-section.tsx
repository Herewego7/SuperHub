import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CalendarClock, Loader2, Trash2, ChevronDown, ChevronUp, Radio, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  getCurrentSubscription,
  getCurrentDeviceSubscription,
  isPushSupported,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/push";
import {
  enableNativePush,
  isNativeNotificationsSupported,
  isNativePushEnabled,
  pendingLocalNotifications,
  scheduleLocalDeliveryProbe,
} from "@/lib/nativeNotifications";
import {
  getLastLocalHealthSync,
  resyncLocalHealthReminders,
  probeLocalHealthPipeline,
  type LocalHealthSyncResult,
} from "@/lib/localHealthReminders";
import { readHealthLog, formatHealthLog, clearHealthLog } from "@/lib/localHealthLog";
import { getEventRemindersEnabled, saveEventRemindersEnabled } from "@/lib/eventReminders";
import { confirmDialog } from "@/lib/confirmDialog";
import type { Profile } from "@workspace/shared-types";
import { PerPersonSettingsSection } from "@/components/per-person-settings";

interface DeviceSub {
  id: string;
  profileId: string | null;
  label: string | null;
  userAgent: string | null;
  endpoint: string;
  createdAt: string;
  lastSeenAt: string;
}

// Matches NotificationCategory in api-server/src/lib/push.ts. Kept as a
// literal list here for the same reason it's duplicated server-side in
// routes/push.ts's zod schema — the frontend needs concrete labels, not just
// a type.
const NOTIFICATION_CATEGORIES: Array<{ key: string; label: string; description: string }> = [
  { key: "rewardRedeemed", label: "Reward redeemed", description: "When a kid redeems a reward" },
  { key: "choreAssigned", label: "Chore assigned to you", description: "When a chore is assigned to this device's profile" },
  { key: "cashoutRequested", label: "Cash-out requested", description: "When a kid asks to cash out stars" },
  { key: "inviteAccepted", label: "Family invite accepted", description: "When someone you invited joins the family" },
  { key: "notePosted", label: "Note posted", description: "When a family member posts a note assigned to you" },
  { key: "weeklyRecap", label: "Weekly recap", description: "The weekly recap digest, if enabled below" },
  // "behaviourTimer" deliberately omitted from this list — the Behavior
  // Board tab is hidden from the app entirely for now, so its notification
  // type is hidden here too. The category still exists and still fires
  // server-side (lib/push.ts); this only removes the opt-out checkbox.
  { key: "celebrationReminder", label: "Celebration reminders", description: "30-day and 7-day heads-up before birthdays and anniversaries" },
];

// The /api/push/test response — web and native (APNs) are counted separately.
interface PushTestResult {
  sent: number;         // web push subscriptions delivered to
  pruned: number;
  failed: number;
  nativeSent: number;   // native APNs tokens (the iOS app) delivered to
  nativePruned: number; // tokens Apple said are permanently invalid (removed)
  nativeFailed: number; // tokens Apple rejected for another reason
  nativeConfigured: boolean; // whether the SERVER has APNs credentials at all
  nativeReasons: string[];   // e.g. ["403 InvalidProviderToken"]
}

// Turn the raw push-test result into a clear message about the NATIVE (phone)
// outcome specifically — the old toast only reported the WEB count (`sent`),
// which made a failed phone push look like a success.
function describeNativeTest(d: PushTestResult): { title: string; description: string; variant?: "destructive" } {
  if (!d.nativeConfigured) {
    return { title: "Server can't send phone pushes", description: "APNs isn't configured on the server (missing APNS_KEY_P8 / KEY_ID / TEAM_ID / BUNDLE_ID).", variant: "destructive" };
  }
  // Partial failure must NOT read as success. An account can easily have a
  // stale token from an older build alongside the current one; when the stale
  // one is accepted and the real device is rejected, reporting only the
  // accepted count says "it worked" while the phone gets nothing — which is
  // exactly how a wrong-environment rejection stayed hidden.
  if (d.nativeSent > 0 && d.nativeFailed > 0) {
    return {
      title: "Only some devices got it",
      description: `Accepted for ${d.nativeSent}, rejected for ${d.nativeFailed} — ${d.nativeReasons.join(", ")}. If this phone didn't get it, the rejected one is probably this device.`,
      variant: "destructive",
    };
  }
  if (d.nativeSent > 0) {
    return { title: "Test notification sent", description: `Apple accepted it for ${d.nativeSent} device(s). It should appear shortly.` };
  }
  if (d.nativePruned > 0) {
    return { title: "This device's token was rejected", description: `Apple: ${d.nativeReasons.join(", ") || "invalid token"}. Tap Enable again to re-register.`, variant: "destructive" };
  }
  if (d.nativeReasons.some((r) => r.includes("ProviderTokenSigningFailed"))) {
    return { title: "Server can't sign the APNs key", description: "The device is registered, but the server couldn't build the Apple auth token — APNS_KEY_P8 is malformed, or APNS_KEY_ID / APNS_TEAM_ID is wrong. Re-paste the .p8 key exactly (including the BEGIN/END lines).", variant: "destructive" };
  }
  if (d.nativeFailed > 0) {
    return { title: "Apple rejected the push", description: `Reason: ${d.nativeReasons.join(", ")}. (BadEnvironmentKeyInToken / BadDeviceToken = wrong APNs environment — set APNS_PRODUCTION=true for TestFlight/App Store builds; 403 InvalidProviderToken = bad p8 key/ID/team.)`, variant: "destructive" };
  }
  return { title: "No phone registered", description: "No iOS device token is registered for this account yet — tap Enable on the device first.", variant: "destructive" };
}

/**
 * On-screen pop-up shown 15 minutes before a (non-all-day) event starts.
 * This is purely client-side (localStorage), not a push notification, so it
 * works regardless of push support. It IS per-device — localStorage always is
 * — which is why it belongs in the "On this device" group; the old comment
 * here said the opposite, and that is why it ended up in its own card.
 */
function EventReminderToggle() {
  const [enabled, setEnabled] = useState(getEventRemindersEnabled());

  return (
    // Matches the alert rows it sits above exactly — same geometry, same
    // control. It used to be a full bordered card with an icon and a bold
    // title, which made it read as its own feature rather than the first
    // item in the list. The "on-screen" tag carries the one way it really
    // does differ: this is an in-app pop-up saved to localStorage, not a
    // push preference saved per device.
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 list-none">
      <div>
        <div className="text-sm flex items-center gap-1.5">
          Event reminders
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground border rounded px-1 py-0.5">
            on-screen
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          A pop-up 15 minutes before an event starts. Not for all-day events.
        </div>
      </div>
      <input
        type="checkbox"
        className="h-4 w-4 flex-shrink-0"
        checked={enabled}
        onChange={(e) => {
          setEnabled(e.target.checked);
          saveEventRemindersEnabled(e.target.checked);
        }}
        data-testid="toggle-event-reminders"
      />
    </li>
  );
}

/**
 * Native (Capacitor) notifications panel. Inside the iOS app there is no Web Push
 * / service worker, so we register for APNs via @capacitor/push-notifications.
 */
interface NativeDevice {
  id: string;
  token: string;
  label: string | null;
  profileId: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  notificationPrefs?: Record<string, boolean> | null;
}

function NativeNotificationsPanel({ profiles }: { profiles: Profile[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>("__all__");
  const [nativeDevicesOpen, setNativeDevicesOpen] = useState(false);

  // Reads the real OS permission state on mount instead of assuming "not
  // enabled" — a component remount (tab switch, Settings reopen) previously
  // reset this to false even on a device that had already granted push.
  useEffect(() => {
    let cancelled = false;
    isNativePushEnabled()
      .then((granted) => {
        if (!cancelled) setEnabled(granted);
      })
      // A rejected permission check (a plugin-bridge race, or — as hit while
      // testing this component — no real native bridge at all) previously
      // became an unhandled promise rejection with no fallback; "not
      // enabled" (the pre-existing initial state) is the only sane default.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const enable = useMutation({
    mutationFn: async () => {
      await enableNativePush({
        profileId: selectedProfile === "__all__" ? null : selectedProfile,
        label: "iPhone/iPad",
      });
    },
    onSuccess: () => {
      setEnabled(true);
      toast({ title: "Notifications enabled on this device" });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not enable notifications",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Every phone/tablet registered on this account. Worth showing: a token
  // rotates on reinstall/restore, which registers a NEW row and leaves the old
  // one behind — so "sent to 2 devices" after a couple of reinstalls is normal
  // and, until now, there was no way to see or clear the leftovers from inside
  // the app (the web-push device list below never renders here, and lists a
  // different table anyway).
  const nativeDevices = useQuery<NativeDevice[]>({
    queryKey: ["/api/push/native-tokens"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/push/native-tokens");
      return res.json();
    },
  });

  const removeDevice = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/push/native-tokens/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/push/native-tokens"] });
      toast({ title: "Device removed" });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't remove the device", description: err.message, variant: "destructive" }),
  });

  // There's no stable client-side identifier for "this exact device" among
  // native tokens (unlike web push's endpoint-based lookup) — the most
  // recently active registration is the best available proxy, since opening
  // the app refreshes this device's own row on every launch.
  const thisNativeDevice = (nativeDevices.data ?? []).length === 0
    ? null
    : [...(nativeDevices.data ?? [])].sort((a, b) =>
        new Date(b.lastSeenAt ?? b.createdAt ?? 0).getTime() - new Date(a.lastSeenAt ?? a.createdAt ?? 0).getTime(),
      )[0];

  const setNativeNotificationPref = useMutation({
    mutationFn: async ({ deviceId, key, value }: { deviceId: string; key: string; value: boolean }) => {
      const current = thisNativeDevice?.notificationPrefs ?? {};
      const res = await apiRequest("PATCH", `/api/push/native-tokens/${deviceId}`, {
        notificationPrefs: { ...current, [key]: value },
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/push/native-tokens"] }),
    onError: (err: Error) =>
      toast({ title: "Couldn't save that preference", description: err.message, variant: "destructive" }),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/push/test", {});
      return res.json() as Promise<PushTestResult>;
    },
    onSuccess: (data: PushTestResult) => {
      // Report the NATIVE (phone) result — this panel is the iOS app.
      toast(describeNativeTest(data));
      // A send prunes tokens Apple reports as dead, so the list can change.
      qc.invalidateQueries({ queryKey: ["/api/push/native-tokens"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not send test notification",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const realProfiles = profiles.filter((p) => !p.isAllFamilyProfile);
  const catsOn = thisNativeDevice
    ? NOTIFICATION_CATEGORIES.filter((c) => thisNativeDevice.notificationPrefs?.[c.key] !== false).length
    : 0;
  const scheduled = realProfiles.filter(
    (p) => p.bedtimeCutoff || (p as { dailyBriefTime?: string }).dailyBriefTime || (p as { weeklyRecapTime?: string }).weeklyRecapTime,
  ).length;

  return (
    <div className="space-y-3">
      <StatusStrip
        on={enabled}
        title={enabled ? "On for this device" : "Off for this device"}
        detail={enabled ? "This device is registered for notifications" : "Not enabled yet"}
        actions={
          <div className="flex gap-2 flex-shrink-0">
            {enabled && (
              <Button variant="outline" size="sm" onClick={() => sendTest.mutate()} disabled={sendTest.isPending} data-testid="button-test-native-push">
                {sendTest.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Test
              </Button>
            )}
            <Button
              size="sm"
              variant={enabled ? "outline" : "default"}
              onClick={() => enable.mutate()}
              disabled={enable.isPending}
              data-testid="button-enable-native-push"
            >
              {enable.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bell className="h-4 w-4 mr-1" />}
              {enable.isPending ? "Registering…" : enabled ? "Re-register" : "Enable"}
            </Button>
          </div>
        }
      >
        {!enabled && (
          <div className="space-y-2">
            <Label className="text-xs">Who is this device for?</Label>
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger data-testid="select-native-device-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Everyone in the family</SelectItem>
                {realProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This device gets reminders for whoever you pick, plus anything sent to "Everyone".
            </p>
          </div>
        )}
      </StatusStrip>

      <MedicationScheduleStatus />
      <div className="flex justify-end"><RecheckMedicationSchedule /></div>
      <LocalNotificationProbe />

      <div className="rounded-lg border overflow-hidden">
        <SettingRow
          icon={<SlidersHorizontal className="w-4 h-4" />}
          label="Alerts"
          value={enabled && thisNativeDevice ? `${catsOn} of ${NOTIFICATION_CATEGORIES.length} on` : undefined}
          testId="alerts"
        >
          <p className="text-xs text-muted-foreground">
            What this device shows you. Only affects this device.
            {(nativeDevices.data?.length ?? 0) > 1 && " Applies to the one most recently opened."}
          </p>
          <ul className="space-y-1">
            <EventReminderToggle />
            {enabled && thisNativeDevice &&
              NOTIFICATION_CATEGORIES.map((cat) => {
                const catEnabled = thisNativeDevice.notificationPrefs?.[cat.key] !== false;
                return (
                  <li key={cat.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div>
                      <div className="text-sm">{cat.label}</div>
                      <div className="text-xs text-muted-foreground">{cat.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={catEnabled}
                      onChange={(e) =>
                        setNativeNotificationPref.mutate({ deviceId: thisNativeDevice.id, key: cat.key, value: e.target.checked })
                      }
                      data-testid={`native-notification-pref-${cat.key}`}
                    />
                  </li>
                );
              })}
          </ul>
        </SettingRow>

        <SettingRow
          icon={<CalendarClock className="w-4 h-4" />}
          label="Schedules"
          value={realProfiles.length ? `${scheduled} of ${realProfiles.length} set` : undefined}
          testId="schedules"
        >
          <PerPersonSettingsSection profiles={profiles} sections="reminders" />
        </SettingRow>

        {/* Registered phones/tablets. Reinstalls leave stale entries behind,
            which is why a test can report more devices than you own. */}
        <SettingRow
          icon={<Radio className="w-4 h-4" />}
          label="Devices"
          value={nativeDevices.data ? `${nativeDevices.data.length} registered` : undefined}
          testId="devices"
        >
          <p className="text-xs text-muted-foreground">
            Reinstalling leaves an old entry behind. Removing a stale one is safe — it
            re-adds itself on next open.
          </p>
          {(nativeDevices.data?.length ?? 0) === 0 && (
            <div className="text-xs text-muted-foreground">
              No devices yet — tap Enable on each device you want notified.
            </div>
          )}
          <ul className="space-y-1.5">
            {nativeDevices.data?.map((d) => {
              const who = profiles.find((p) => p.id === d.profileId);
              const seen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
              return (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">
                      {d.label ?? "iPhone/iPad"}
                      {who && <span className="text-muted-foreground"> · {who.name}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {seen ? `Last used ${seen.toLocaleDateString()}` : "Never used"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive"
                    disabled={removeDevice.isPending}
                    onClick={async () => {
                      if (await confirmDialog({
                        title: "Remove this device from notifications?",
                        description: "It will stop getting pushes until the app is opened on it again.",
                        confirmLabel: "Remove",
                      })) removeDevice.mutate(d.id);
                    }}
                    data-testid={`button-remove-native-device-${d.id}`}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </SettingRow>
      </div>
    </div>
  );
}

// Groups the notification sub-features into labeled, individually collapsible
// sections instead of stacked blocks with no structure — "Push setup"
// (getting reminders flowing to a device at all) and "Notification types"
// (which alert categories fire, the least-used and most technical group —
// collapsed by default). The per-person time-based settings (bedtime, daily
// brief, weekly recap) moved to their own "Per-Person Settings" section.
/**
 * One uniform row in the Notifications list: icon, label, a summary of the
 * current value, and a drawer. Replaces the old NotificationGroup, which was
 * a nested accordion — the section used to stack three collapsible levels
 * (section -> "On this device" -> "Notification types" -> the controls), with
 * three different container styles between them. Every row here is a peer, so
 * nothing is more than one tap from the section.
 *
 * The `value` is what makes the list scannable without opening anything; it's
 * always derived from data this section already fetches.
 */
function SettingRow({
  icon,
  label,
  value,
  testId,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  /** Stable id for tests — never derived from the label, so renaming copy
   *  can't silently break a test (which has happened twice here). */
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left border-b last:border-b-0 hover-elevate"
        data-testid={`notification-row-${testId}`}
        aria-expanded={open}
      >
        <span className="text-muted-foreground flex-shrink-0">{icon}</span>
        <span className="flex-1 min-w-0 text-sm font-medium">{label}</span>
        {value != null && (
          <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{value}</span>
        )}
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3.5 pb-4 pt-1 space-y-3 border-b last:border-b-0" data-testid={`notification-drawer-${testId}`}>
          {children}
        </div>
      )}
    </>
  );
}

/**
 * Whether iOS is actually holding this device's medication reminders.
 *
 * ⚠️ This exists because the failure it reports is otherwise completely
 * silent. On 2026-09-28 a device test found reminders arriving while the app
 * was open and never once it was closed: scheduling had been rejecting for
 * want of notification permission, nothing surfaced the rejection, and the
 * only symptom was a dose that never got announced — hours later, with
 * nothing on screen to connect it to.
 *
 * It reports what iOS CONFIRMS it is holding, not what the app asked for.
 * Those are different numbers whenever something is wrong, and the difference
 * is the whole point.
 *
 * Hoisted to module scope deliberately — a component declared inside another
 * component's render body remounts on every keystroke, which in this very
 * file's search box was a real bug.
 */
function MedicationScheduleStatus() {
  const [sync, setSync] = useState<LocalHealthSyncResult | null>(() => getLastLocalHealthSync());

  useEffect(() => {
    // The sync runs from a hook elsewhere, on its own schedule, so poll rather
    // than trying to subscribe: this panel is open for seconds at a time and
    // a stale reading here would be worse than a slightly late one.
    const t = setInterval(() => setSync(getLastLocalHealthSync()), 1500);
    return () => clearInterval(t);
  }, []);

  // On the web there is no such thing as a device schedule, so there is
  // nothing truthful to say.
  if (!isNativeNotificationsSupported() || sync?.reason === "not_native") return null;

  // ⚠️ ALWAYS render something on a device, even "nothing to schedule".
  // The first version of this returned null both when everything was fine
  // with no reminders set AND when the feature was absent from the build —
  // so an empty space meant two opposite things, and the very first attempt
  // to use it (2026-09-28) could not tell them apart. A status line that is
  // sometimes invisible is not a status line.
  if (!sync) {
    return (
      <p className="text-xs text-muted-foreground px-1" data-testid="medication-schedule-status">
        Medication reminders: <span className="text-foreground font-medium">checking…</span> If this
        does not change within a few seconds, reminders are not being handed to iOS at all.
      </p>
    );
  }

  if (sync.ok && sync.scheduled > 0) {
    return (
      <p className="text-xs text-muted-foreground px-1" data-testid="medication-schedule-status">
        Medication reminders: <span className="text-foreground font-medium">{sync.scheduled} scheduled on this device</span>.
        These fire from iOS itself, so they still arrive with the app closed.
      </p>
    );
  }

  if (sync.ok) {
    return (
      <p className="text-xs text-muted-foreground px-1" data-testid="medication-schedule-status">
        Medication reminders:{" "}
        <span className="text-foreground font-medium">
          {sync.seen === 0 ? "none set" : `${sync.seen} found, none schedulable`}
        </span>
        , so there is nothing for this device to schedule.
        {sync.seen > 0 && " Every one is paused, ended, or set in the past."}
      </p>
    );
  }

  const why =
    sync.reason === "no_permission"
      ? "This device has not allowed notifications, so iOS refused the schedule. Turn notifications on for SuperHub in iPhone Settings, then reopen this screen."
      : sync.reason === "not_all_pending"
        ? `iOS is only holding ${sync.scheduled} of them. The rest were refused.`
        : `Scheduling failed${sync.detail ? `: ${sync.detail}` : ""}.`;

  return (
    <div
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
      data-testid="medication-schedule-status"
    >
      <p className="text-xs font-medium text-destructive">Medication reminders are not scheduled on this device</p>
      <p className="text-xs text-muted-foreground mt-1">
        {why} Until this is fixed they only arrive while the app is open.
      </p>
      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
        {sync.seen} reminder{sync.seen === 1 ? "" : "s"} &middot; {sync.planned} planned &middot;{" "}
        {sync.scheduled} held by iOS
      </p>
    </div>
  );
}

/**
 * Re-runs the device sync on demand and reports what happened.
 *
 * Waiting for the next natural sync means guessing about timing on top of
 * whatever is already wrong, which is how two device tests in a row came back
 * inconclusive.
 */
function RecheckMedicationSchedule() {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  if (!isNativeNotificationsSupported()) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      data-testid="button-recheck-medication-schedule"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await resyncLocalHealthReminders();
          toast({
            title: r.ok && r.scheduled > 0 ? "Scheduled on this device" : "Not scheduled",
            description:
              r.reason === "no_permission"
                ? "iOS refused: notifications are not allowed for SuperHub."
                : `${r.seen} reminder(s), ${r.planned} planned, ${r.scheduled} held by iOS.` +
                  (r.detail ? ` ${r.detail}` : ""),
            variant: r.ok && r.scheduled > 0 ? undefined : "destructive",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
      Re-check reminders
    </Button>
  );
}

/**
 * Shows the trigger iOS is actually holding, and can schedule a bare probe a
 * minute out.
 *
 * "1 held by iOS" turned out not to mean the reminder would arrive: a pending
 * notification aimed at the wrong moment is indistinguishable from a correct
 * one until the trigger itself is read. The probe separates the two halves —
 * if it arrives with the app closed and a reminder does not, delivery is fine
 * and the scheduling is wrong.
 */
function LocalNotificationProbe() {
  const [pending, setPending] = useState<{ id: number; title: string; schedule: unknown }[] | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  if (!isNativeNotificationsSupported()) return null;

  return (
    <div className="rounded-lg border px-3 py-2 space-y-2" data-testid="local-notification-probe">
      <p className="text-xs text-muted-foreground">
        Diagnostics for medication reminders not arriving.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="button-show-pending-notifications"
          onClick={async () => setPending(await pendingLocalNotifications())}
        >
          Show what iOS is holding
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          data-testid="button-local-delivery-probe"
          onClick={async () => {
            setBusy(true);
            try {
              const r = await scheduleLocalDeliveryProbe();
              toast({
                title: r ? "Test scheduled" : "Could not schedule",
                description: r
                  ? `Due at ${r.at.toLocaleTimeString()}. Close the app completely and wait.`
                  : "iOS refused it — notifications are not allowed for SuperHub.",
                variant: r ? undefined : "destructive",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Test in 60 seconds
        </Button>
        {/* The distance is now the only variable left: the same pipeline fires
            reliably at 60 seconds and not at the minutes-ahead a real reminder
            uses. Three buttons rather than one so the threshold can be found
            in a single build instead of one rebuild per guess. */}
        {[1, 5, 15].map((mins) => (
          <Button
            key={mins}
            variant="outline"
            size="sm"
            disabled={busy}
            data-testid={`button-pipeline-probe-${mins}`}
            onClick={async () => {
              setBusy(true);
              try {
                const { result, firesAt } = await probeLocalHealthPipeline(mins);
                toast({
                  title: result.scheduled > 0 ? `Scheduled for ${mins} min` : "Failed to schedule",
                  description:
                    `Due at ${firesAt.toLocaleTimeString()} — ${result.scheduled} held by iOS. ` +
                    "Close the app completely and wait. This clears your real reminders until the app is next opened.",
                  variant: result.scheduled > 0 ? undefined : "destructive",
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Pipeline: {mins} min
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {/* The log is the point of this build. It records what happened while
            nobody was watching, which is the one thing no previous diagnostic
            could report: every earlier check re-ran the sync first, and the
            re-run re-scheduled whatever was missing. */}
        <Button
          variant="outline"
          size="sm"
          data-testid="button-show-health-log"
          onClick={() => setLog(formatHealthLog(readHealthLog()))}
        >
          Show the log
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-copy-health-log"
          onClick={async () => {
            const text = formatHealthLog(readHealthLog());
            try {
              await navigator.clipboard.writeText(text);
              toast({ title: "Log copied" });
            } catch {
              setLog(text);
              toast({ title: "Could not copy", description: "Shown below instead." });
            }
          }}
        >
          Copy the log
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-clear-health-log"
          onClick={() => { clearHealthLog(); setLog("Cleared."); }}
        >
          Clear
        </Button>
      </div>
      {pending && (
        <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-56 overflow-auto">
          {pending.length === 0 ? "iOS is holding nothing." : JSON.stringify(pending, null, 1)}
        </pre>
      )}
      {log && (
        <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-72 overflow-auto">
          {log}
        </pre>
      )}
    </div>
  );
}

/**
 * The one thing that has to be true before anything else in this section
 * matters: is this device registered at all. Always visible, above the rows —
 * it used to be the third card down, inside a collapsed group.
 */
function StatusStrip({
  on,
  title,
  detail,
  actions,
  children,
}: {
  on: boolean;
  title: string;
  detail: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3.5 space-y-3">
      {/* Stacks on a phone. Side by side, two non-shrinking buttons ("Test" +
          "Re-register") left the text about 120px, which wrapped the title one
          word per line. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${on ? "bg-green-600 dark:bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">{detail}</div>
          </div>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function NotificationsSection({ profiles }: { profiles: Profile[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const supported = isPushSupported();
  const [hasSubOnDevice, setHasSubOnDevice] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    supported ? Notification.permission : "unsupported",
  );
  const [selectedProfile, setSelectedProfile] = useState<string>("__all__");
  // Collapsed by default — most people never need this list once a device's
  // notifications are working, so it stays out of the way until wanted.
  const [devicesOpen, setDevicesOpen] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void getCurrentSubscription().then((s) => setHasSubOnDevice(!!s));
  }, [supported]);

  const devicesQ = useQuery<DeviceSub[]>({
    queryKey: ["/api/push/subscriptions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/push/subscriptions");
      return res.json();
    },
    enabled: supported,
  });

  // Which subscription row is THIS browser/device, so category toggles below
  // update the right one (see getCurrentDeviceSubscription's doc comment for
  // why this can't just reuse subscribeThisDevice's upsert).
  const currentDeviceQ = useQuery({
    queryKey: ["/api/push/subscriptions/current-device"],
    queryFn: getCurrentDeviceSubscription,
    enabled: supported && hasSubOnDevice,
  });

  const setNotificationPref = useMutation({
    mutationFn: async ({ deviceId, key, value }: { deviceId: string; key: string; value: boolean }) => {
      const current = currentDeviceQ.data?.notificationPrefs ?? {};
      const res = await apiRequest("PATCH", `/api/push/subscriptions/${deviceId}`, {
        notificationPrefs: { ...current, [key]: value },
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/push/subscriptions/current-device"] });
      toast({ title: "Preference saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't update preference", description: err.message, variant: "destructive" });
    },
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      await subscribeThisDevice({
        profileId: selectedProfile === "__all__" ? null : selectedProfile,
      });
    },
    onSuccess: () => {
      setHasSubOnDevice(true);
      setPermission(Notification.permission);
      qc.invalidateQueries({ queryKey: ["/api/push/subscriptions"] });
      toast({ title: "Notifications enabled on this device" });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not enable notifications",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const unsubscribe = useMutation({
    mutationFn: async () => {
      await unsubscribeThisDevice();
    },
    onSuccess: () => {
      setHasSubOnDevice(false);
      qc.invalidateQueries({ queryKey: ["/api/push/subscriptions"] });
      toast({ title: "Notifications disabled on this device" });
    },
    onError: (err: any) => toast({ title: "Couldn't disable notifications", description: err?.message, variant: "destructive" }),
  });

  const removeDevice = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/push/subscriptions/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/push/subscriptions"] });
      toast({ title: "Device removed" });
    },
    onError: (err: any) => toast({ title: "Couldn't remove the device", description: err?.message, variant: "destructive" }),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/push/test", {});
      return res.json();
    },
    onSuccess: (data: { sent: number; pruned: number; failed: number }) => {
      if (data.sent > 0) {
        // The push service accepted it — but "accepted" isn't "displayed". If
        // nothing appears, the notification is almost always being suppressed
        // by the OS, not lost in transit.
        toast({
          title: "Test notification sent",
          description:
            "Your browser's push service accepted it. If it doesn't appear, check your OS notification settings for this browser (e.g. macOS System Settings → Notifications) and that Do Not Disturb / Focus is off.",
        });
      } else if (data.failed > 0) {
        toast({
          title: "The push service rejected the test",
          description: "This browser's subscription may be stale — turn notifications off and back on for this device, then try again.",
          variant: "destructive",
        });
      } else {
        // sent === 0 && failed === 0 → nothing to send to.
        toast({
          title: "No subscription on this device",
          description: "This browser isn't registered for notifications. Turn notifications on for this device first, then send a test.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => toast({ title: "Couldn't send the test", description: err?.message, variant: "destructive" }),
  });

  // Inside the native iOS app there is no Web Push; use the APNs-based panel.
  if (isNativeNotificationsSupported()) {
    return (
      <div className="space-y-3">
        {/* Native iOS uses APNs, so registration/test/device-list live in the
            panel. It renders the same StatusStrip + rows shape as the web
            branch below, so the two can't drift apart visually. */}
        <NativeNotificationsPanel profiles={profiles} />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border p-3.5 text-sm text-muted-foreground">
          This browser can't receive push notifications. Open the app in Chrome,
          Edge, Firefox, or Safari (iOS 16.4+) to enable them.
        </div>
        <div className="rounded-lg border overflow-hidden">
          {/* Only the two rows that still mean something without push: the
              on-screen pop-up, and the per-person times (which fire on
              whatever devices ARE registered elsewhere). */}
          <SettingRow icon={<SlidersHorizontal className="w-4 h-4" />} label="Alerts" testId="alerts">
            <ul className="space-y-1"><EventReminderToggle /></ul>
          </SettingRow>
          <SettingRow icon={<CalendarClock className="w-4 h-4" />} label="Schedules" testId="schedules">
            <PerPersonSettingsSection profiles={profiles} sections="reminders" />
          </SettingRow>
        </div>
      </div>
    );
  }

  const catsOn = currentDeviceQ.data
    ? NOTIFICATION_CATEGORIES.filter((c) => currentDeviceQ.data?.notificationPrefs?.[c.key] !== false).length
    : 0;
  const realProfiles = profiles.filter((p) => !p.isAllFamilyProfile);
  const scheduled = realProfiles.filter(
    (p) => p.bedtimeCutoff || (p as { dailyBriefTime?: string }).dailyBriefTime || (p as { weeklyRecapTime?: string }).weeklyRecapTime,
  ).length;

  return (
    <div className="space-y-3">
      <StatusStrip
        on={hasSubOnDevice}
        title={hasSubOnDevice ? "On for this device" : "Off for this device"}
        detail={
          permission === "denied"
            ? "Blocked — allow notifications for this site in your browser settings"
            : hasSubOnDevice
            ? "This device is registered for notifications"
            : "Not enabled yet"
        }
        actions={
          hasSubOnDevice ? (
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={() => sendTest.mutate()} disabled={sendTest.isPending} data-testid="button-test-push">
                {sendTest.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Test
              </Button>
              <Button variant="outline" size="sm" onClick={() => unsubscribe.mutate()} disabled={unsubscribe.isPending} data-testid="button-disable-push">
                {unsubscribe.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4 mr-1" />}
                Turn off
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => subscribe.mutate()} disabled={subscribe.isPending} data-testid="button-enable-push" className="flex-shrink-0">
              {subscribe.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bell className="h-4 w-4 mr-1" />}
              Enable
            </Button>
          )
        }
      >
        {!hasSubOnDevice && (
          <div className="space-y-2">
            <Label className="text-xs">Who is this device for?</Label>
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger data-testid="select-device-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Everyone in the family</SelectItem>
                {realProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Reminders go only to devices linked to that profile, plus any "Everyone" devices.
            </p>
          </div>
        )}
      </StatusStrip>

      <div className="rounded-lg border overflow-hidden">
        {/* Alerts — the notification types, plus Event reminders, which is an
            on-screen pop-up rather than a push. It sat above this list looking
            like a push setting; the tag next to it is what marks the
            difference now. */}
        <SettingRow
          icon={<SlidersHorizontal className="w-4 h-4" />}
          label="Alerts"
          value={hasSubOnDevice && currentDeviceQ.data ? `${catsOn} of ${NOTIFICATION_CATEGORIES.length} on` : undefined}
          testId="alerts"
        >
          <p className="text-xs text-muted-foreground">
            What this device shows you. Only affects this device.
          </p>
          <ul className="space-y-1">
            <EventReminderToggle />
            {hasSubOnDevice && currentDeviceQ.data &&
              NOTIFICATION_CATEGORIES.map((cat) => {
                const enabled = currentDeviceQ.data?.notificationPrefs?.[cat.key] !== false;
                return (
                  <li key={cat.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div>
                      <div className="text-sm">{cat.label}</div>
                      <div className="text-xs text-muted-foreground">{cat.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={enabled}
                      onChange={(e) =>
                        setNotificationPref.mutate({ deviceId: currentDeviceQ.data!.id, key: cat.key, value: e.target.checked })
                      }
                      data-testid={`notification-pref-${cat.key}`}
                    />
                  </li>
                );
              })}
          </ul>
        </SettingRow>

        <SettingRow
          icon={<CalendarClock className="w-4 h-4" />}
          label="Schedules"
          value={realProfiles.length ? `${scheduled} of ${realProfiles.length} set` : undefined}
          testId="schedules"
        >
          <PerPersonSettingsSection profiles={profiles} sections="reminders" />
        </SettingRow>

        <SettingRow
          icon={<Radio className="w-4 h-4" />}
          label="Devices"
          value={devicesQ.data ? `${devicesQ.data.length} registered` : undefined}
          testId="devices"
        >
          {devicesQ.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {devicesQ.isError && <div className="text-xs text-destructive">Couldn't load devices. Try again.</div>}
          {devicesQ.data && devicesQ.data.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No devices yet — tap Enable on each device you want notified.
            </div>
          )}
          <ul className="space-y-2">
            {devicesQ.data?.map((d) => {
              const profile = profiles.find((p) => p.id === d.profileId);
              return (
                <li key={d.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {d.label ?? "Device"}
                      {profile ? <span className="text-muted-foreground font-normal"> · {profile.name}</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{d.userAgent ?? d.endpoint}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => { if (await confirmDialog({ title: "Remove this device from notifications?", confirmLabel: "Remove" })) removeDevice.mutate(d.id); }}
                    disabled={removeDevice.isPending}
                    aria-label="Remove this device from notifications"
                    title="Remove this device from notifications"
                    data-testid={`button-remove-device-${d.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </SettingRow>
      </div>
    </div>
  );
}
