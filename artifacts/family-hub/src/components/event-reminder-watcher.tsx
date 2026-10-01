import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getEventRemindersEnabled } from "@/lib/eventReminders";
import type { Event, Profile } from "@workspace/shared-types";

const REMINDER_MINUTES = 15;
const CHECK_INTERVAL_MS = 20_000;
const SHOWN_KEY = "familyHub_eventReminderShown";
const SHOWN_TTL_MS = 24 * 60 * 60 * 1000;

function loadShown(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - SHOWN_TTL_MS;
    const pruned: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && ts >= cutoff) pruned[id] = ts;
    }
    return pruned;
  } catch {
    return {};
  }
}

function markShown(id: string) {
  const shown = loadShown();
  shown[id] = Date.now();
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {}
}

interface Props {
  profiles: Profile[];
}

// Mounted once, unconditionally of the active tab, so a reminder can pop up
// no matter which part of the app the family is looking at.
export function EventReminderWatcher({ profiles }: Props) {
  const { data: events = [] } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    refetchInterval: 5 * 60_000,
  });
  const [queue, setQueue] = useState<Event[]>([]);
  const shownRef = useRef<Set<string>>(new Set(Object.keys(loadShown())));

  useEffect(() => {
    const check = () => {
      if (!getEventRemindersEnabled()) return;
      const now = Date.now();
      const due = events.filter((e) => {
        if (e.isAllDay) return false;
        if (shownRef.current.has(e.id)) return false;
        const msUntil = new Date(e.startTime).getTime() - now;
        return msUntil > 0 && msUntil <= REMINDER_MINUTES * 60_000;
      });
      if (due.length > 0) {
        due.forEach((e) => {
          shownRef.current.add(e.id);
          markShown(e.id);
        });
        setQueue((prev) => [...prev, ...due]);
      }
    };
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [events]);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const current = queue[0];
  const dismiss = () => setQueue((prev) => prev.slice(1));

  if (!current) return null;

  const assignedNames = (current.profileIds ?? [])
    .map((id) => profileMap.get(id)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="max-w-sm" data-testid="event-reminder-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            Starting in {REMINDER_MINUTES} minutes
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <p className="text-base font-semibold">{current.title}</p>
          <p className="text-sm text-muted-foreground">
            {format(new Date(current.startTime), "h:mm a")}
            {assignedNames ? ` • ${assignedNames}` : ""}
          </p>
          {current.location && (
            <p className="text-sm text-muted-foreground">{current.location}</p>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button onClick={dismiss} data-testid="event-reminder-dismiss">
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
