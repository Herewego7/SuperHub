import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pill } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Profile } from "@workspace/shared-types";

type Schedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "monthly"; time: string; dayOfMonth: number };

interface HealthReminder {
  id: string;
  profileId: string;
  type: "medication" | "appointment" | "refill" | "generic";
  title: string;
  scheduleJson: Schedule;
  isPaused: boolean;
  startsAt: string;
  endsAt: string | null;
}

interface Props {
  selectedProfiles: string[];
  profiles: Profile[];
}

function localParts(d: Date, tz: string): { date: string; dow: number; dom: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const dom = Number(get("day"));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get("weekday")] ?? new Date(date).getDay();
  return { date, dow, dom };
}

function isDueToday(s: Schedule, now: Date, tz: string): { due: boolean; time?: string } {
  const today = localParts(now, tz);
  switch (s.kind) {
    case "once": {
      const at = new Date(s.at);
      const atParts = localParts(at, tz);
      return atParts.date === today.date
        ? { due: true, time: at.toLocaleTimeString([], { timeStyle: "short", timeZone: tz }) }
        : { due: false };
    }
    case "daily":
      return { due: true, time: s.time };
    case "weekly":
      return s.days.includes(today.dow) ? { due: true, time: s.time } : { due: false };
    case "monthly":
      return s.dayOfMonth === today.dom ? { due: true, time: s.time } : { due: false };
  }
}

export function HealthTodayCard({ selectedProfiles, profiles }: Props) {
  const { data: reminders = [] } = useQuery<HealthReminder[]>({
    queryKey: ["/api/health-reminders"],
  });
  const { data: locationSettings } = useQuery<{ timezone?: string } | null>({
    queryKey: ["/api/location-settings"],
  });
  const tz = locationSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const visibleProfileIds = useMemo(() => {
    const real = profiles.filter((p) => !p.isAllFamilyProfile);
    if (selectedProfiles.length === 0) return new Set(real.map((p) => p.id));
    return new Set(real.filter((p) => selectedProfiles.includes(p.id)).map((p) => p.id));
  }, [profiles, selectedProfiles]);

  const today = useMemo(() => {
    const now = new Date();
    type Row = { id: string; title: string; profileName: string; profileColor: string; time?: string };
    const rows: Row[] = [];
    for (const r of reminders) {
      if (r.isPaused) continue;
      if (!visibleProfileIds.has(r.profileId)) continue;
      if (r.endsAt && new Date(r.endsAt) < now) continue;
      const { due, time } = isDueToday(r.scheduleJson, now, tz);
      if (!due) continue;
      const p = profiles.find((x) => x.id === r.profileId);
      rows.push({
        id: r.id,
        title: r.title,
        profileName: p?.name ?? "—",
        profileColor: p?.color ?? "#888",
        time,
      });
    }
    return rows.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  }, [reminders, visibleProfileIds, profiles, tz]);

  if (today.length === 0) return null;

  return (
    <Card className="bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30 border-rose-200/60 dark:border-rose-800/40">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Pill className="h-5 w-5 text-rose-600" />
          <div className="text-sm font-semibold">Health reminders today</div>
          <Badge variant="secondary" className="ml-auto">{today.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {today.slice(0, 6).map((row) => (
          <div key={row.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs w-12 text-muted-foreground">{row.time ?? "—"}</span>
            <span className="truncate flex-1">{row.title}</span>
            <span className="text-xs flex items-center gap-1">
              <span style={{ color: row.profileColor }}>●</span>
              {row.profileName}
            </span>
          </div>
        ))}
        {today.length > 6 && (
          <p className="text-xs text-muted-foreground">+{today.length - 6} more</p>
        )}
      </CardContent>
    </Card>
  );
}
