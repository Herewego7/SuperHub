import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import {
  syncLocalHealthReminders,
  type PlannableReminder,
} from "@/lib/localHealthReminders";
import { onLocalNotificationTap } from "@/lib/nativeNotifications";
import { setPendingTabDeepLink } from "@/lib/pushDeepLink";

interface Profile {
  id: string;
  name: string;
}

interface HealthReminderRow {
  id: string;
  profileId: string;
  title: string;
  type?: string | null;
  dose?: string | null;
  isPaused?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  scheduleJson: PlannableReminder["scheduleJson"];
}

/**
 * Keeps this device's on-device medication reminders in step with the
 * family's reminders, so they still fire when the server is asleep — see
 * lib/localHealthReminders.ts for why that is the normal case, not an edge.
 *
 * Runs on every change to the reminder list rather than only at launch: a
 * reminder added or paused on this device should take effect immediately, not
 * at the next cold start.
 */
export function useLocalHealthReminders(profiles: Profile[]): void {
  const native = Capacitor.isNativePlatform();
  // The tap listener is registered once and must still see the CURRENT
  // reminders when it fires, which can be hours later.
  const remindersRef = useRef<HealthReminderRow[]>([]);

  // No profileId filter — this device schedules for the WHOLE family, since a
  // shared iPad is the common case and per-profile push targeting doesn't
  // exist for a notification the OS fires on its own.
  const { data: reminders } = useQuery<HealthReminderRow[]>({
    queryKey: ["/api/health-reminders"],
    enabled: native,
  });

  // Tapping the notification has to land somewhere useful. Nothing listened
  // for a LOCAL notification tap before, so a tapped medication reminder just
  // opened the app: no profile selected, nothing spotlighted, and the reminder
  // itself only reachable at the bottom of the Tasks card (2026-09-29).
  // Registered once, not per reminder-list change — the listener outlives any
  // particular set of reminders.
  useEffect(() => {
    if (!native) return;
    onLocalNotificationTap((extra) => {
      if (extra?.kind !== "health-reminder") return;
      const reminder = remindersRef.current.find((r) => r.id === extra.reminderId);
      setPendingTabDeepLink({
        tab: "home",
        action: "healthReminders",
        // Without the profile, Home's card filters the reminder out whenever
        // somebody else is selected — the 2026-09-14 bug, reached by a
        // different road.
        profileId: reminder?.profileId,
      });
    });
  }, [native]);

  useEffect(() => {
    if (!native || !reminders) return;
    const nameById = new Map(profiles.map((p) => [p.id, p.name]));
    const plannable: PlannableReminder[] = reminders.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      dose: r.dose,
      isPaused: r.isPaused,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      scheduleJson: r.scheduleJson,
      profileName: nameById.get(r.profileId) ?? null,
    }));
    remindersRef.current = reminders;
    void syncLocalHealthReminders(plannable);
  }, [native, reminders, profiles]);
}
