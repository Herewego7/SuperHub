import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, Clock, Pill, Stethoscope, RefreshCw, Settings } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@workspace/shared-types";

interface HealthReminderEvent {
  id: string;
  reminderId: string;
  profileId: string;
  scheduledAt: string;
  status: string;
  snoozeUntil: string | null;
}
interface ReminderLite {
  id: string;
  title: string;
  type: string;
  dose: string | null;
  location: string | null;
  notes: string | null;
  snoozeMinutes: number;
  profileId: string;
}

const TYPE_META: Record<string, { icon: typeof Pill; label: string }> = {
  medication: { icon: Pill, label: "Medication" },
  appointment: { icon: Stethoscope, label: "Appointment" },
  refill: { icon: RefreshCw, label: "Refill" },
  generic: { icon: Bell, label: "Reminder" },
};

interface Props {
  profiles: Profile[];
  /** Empty (or omitted) = "All Family"/no filter, shows every reminder.
      Otherwise only shows reminders for whichever profile(s) are selected —
      a med reminder for one kid shouldn't appear while a different person is
      the only one selected. */
  selectedProfiles?: string[];
  /** Opens everyone's reminders (add, edit, pause, delete) with this person
      first. */
  onManage?: (profileId: string) => void;
}

export function HealthReminderInbox({ profiles, selectedProfiles = [], onManage }: Props) {
  const { data: allEvents = [] } = useQuery<HealthReminderEvent[]>({
    queryKey: ["/api/health-reminder-events?unack=true"],
    refetchInterval: 30_000,
  });
  const events = selectedProfiles.length === 0
    ? allEvents
    : allEvents.filter((ev) => selectedProfiles.includes(ev.profileId));
  const { data: reminders = [] } = useQuery<ReminderLite[]>({
    queryKey: ["/api/health-reminders?includePaused=true"],
  });
  const { toast } = useToast();
  const reminderMap = new Map(reminders.map((r) => [r.id, r]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const [detailEvent, setDetailEvent] = useState<HealthReminderEvent | null>(null);

  const ack = useMutation({
    mutationFn: async ({ id, byProfileId }: { id: string; byProfileId: string | null }) => {
      const res = await apiRequest("POST", `/api/health-reminder-events/${id}/acknowledge`, { byProfileId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health-reminder-events?unack=true"] });
      setDetailEvent(null);
    },
    onError: (err: any) => toast({ title: "Couldn't mark it done", description: err?.message, variant: "destructive" }),
  });
  const snooze = useMutation({
    mutationFn: async ({ id, minutes }: { id: string; minutes: number }) => {
      const res = await apiRequest("POST", `/api/health-reminder-events/${id}/snooze`, { minutes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health-reminder-events?unack=true"] });
      setDetailEvent(null);
    },
    onError: (err: any) => toast({ title: "Couldn't snooze the reminder", description: err?.message, variant: "destructive" }),
  });

  if (events.length === 0) return null;

  const detailReminder = detailEvent ? reminderMap.get(detailEvent.reminderId) : undefined;
  const detailProfile = detailEvent ? profileMap.get(detailEvent.profileId) : undefined;
  const DetailIcon = detailReminder ? (TYPE_META[detailReminder.type] ?? TYPE_META.generic).icon : Bell;

  return (
    <Card id="health-reminder-inbox-card" className="border-rose-200/60 dark:border-rose-800/40">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-rose-600" />
          <div className="text-sm font-semibold">Health reminders to acknowledge</div>
          <Badge variant="secondary" className={onManage ? "" : "ml-auto"}>{events.length}</Badge>
          {onManage && (
            <button
              type="button"
              onClick={() => onManage(events[0].profileId)}
              aria-label="Manage health reminders"
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              data-testid="button-manage-health-reminders"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {events.map((ev) => {
          const r = reminderMap.get(ev.reminderId);
          const p = profileMap.get(ev.profileId);
          return (
            <div
              key={ev.id}
              className="rounded-md bg-background/60 border p-2.5 space-y-2"
              data-testid={`health-event-${ev.id}`}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setDetailEvent(ev)}
                data-testid={`button-detail-${ev.id}`}
              >
                <p className="text-sm font-medium">
                  {r?.title ?? "Reminder"}
                  {r?.dose ? <span className="text-muted-foreground"> · {r.dose}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p?.name ?? "—"} ·{" "}
                  {new Date(ev.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                  {ev.status === "snoozed" && ev.snoozeUntil ? (
                    <> · snoozed until {new Date(ev.snoozeUntil).toLocaleTimeString([], { timeStyle: "short" })}</>
                  ) : null}
                </p>
              </button>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => snooze.mutate({ id: ev.id, minutes: r?.snoozeMinutes ?? 15 })}
                  disabled={snooze.isPending}
                  data-testid={`button-snooze-${ev.id}`}
                >
                  <Clock className="w-3.5 h-3.5 mr-1.5" /> Snooze
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => ack.mutate({ id: ev.id, byProfileId: ev.profileId })}
                  disabled={ack.isPending}
                  data-testid={`button-ack-${ev.id}`}
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" /> Done
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Tapping a reminder's title/subtitle opens this — shows every field
          collected when the reminder was created (dose, location, notes),
          none of which fit on the compact row above. Same Snooze/Done
          actions available here too. */}
      <Dialog open={!!detailEvent} onOpenChange={(o) => { if (!o) setDetailEvent(null); }}>
        <DialogContent className="max-w-sm">
          {detailEvent && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DetailIcon className="w-4 h-4 text-rose-500" />
                  {detailReminder?.title ?? "Reminder"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {detailProfile?.name ?? "—"} ·{" "}
                  {new Date(detailEvent.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </p>
                {detailReminder?.dose && (
                  <p><span className="text-muted-foreground">Dose: </span>{detailReminder.dose}</p>
                )}
                {detailReminder?.location && (
                  <p><span className="text-muted-foreground">Where: </span>{detailReminder.location}</p>
                )}
                {detailReminder?.notes && (
                  <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Notes: </span>{detailReminder.notes}</p>
                )}
                {detailEvent.status === "snoozed" && detailEvent.snoozeUntil && (
                  <p className="text-muted-foreground">
                    Snoozed until {new Date(detailEvent.snoozeUntil).toLocaleTimeString([], { timeStyle: "short" })}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => snooze.mutate({ id: detailEvent.id, minutes: detailReminder?.snoozeMinutes ?? 15 })}
                  disabled={snooze.isPending}
                >
                  <Clock className="w-4 h-4 mr-1.5" /> Snooze
                </Button>
                <Button
                  onClick={() => ack.mutate({ id: detailEvent.id, byProfileId: detailEvent.profileId })}
                  disabled={ack.isPending}
                >
                  <Check className="w-4 h-4 mr-1.5" /> Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
