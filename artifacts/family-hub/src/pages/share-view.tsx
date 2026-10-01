import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, Calendar, Sparkles } from "lucide-react";

interface ShareProfile {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
}
interface ShareEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  profileIds: string[];
}
interface ShareChore {
  id: string;
  title: string;
  profileIds: string[];
}
interface SharePayload {
  label: string | null;
  profiles: ShareProfile[];
  events: ShareEvent[];
  chores: ShareChore[];
  weekStart: string;
  weekEnd: string;
}

export default function ShareView() {
  const [, params] = useRoute("/share/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/public/share/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("This share link doesn't exist or was revoked.");
        if (r.status === 410) throw new Error("This share link has expired.");
        if (!r.ok) throw new Error("Couldn't load this family's week.");
        return r.json();
      })
      .then((d: SharePayload) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-6 text-center">
        <p className="text-foreground/80">{error ?? "Not available"}</p>
      </div>
    );
  }

  const profileMap = new Map(data.profiles.map((p) => [p.id, p]));
  const days: { key: string; label: string; date: Date; events: ShareEvent[] }[] = [];
  const start = new Date(data.weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dayKey = d.toISOString().slice(0, 10);
    days.push({
      key: dayKey,
      label: d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      date: d,
      events: [],
    });
  }
  for (const e of data.events) {
    if (!e.startTime) continue;
    const eDate = new Date(e.startTime);
    if (isNaN(eDate.getTime())) continue;
    const eKey = eDate.toISOString().slice(0, 10);
    const day = days.find((d) => d.key === eKey);
    if (day) day.events.push(e);
  }

  return (
    <div className="min-h-screen bg-amber-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="text-center">
          <Sparkles className="h-8 w-8 text-orange-500 mx-auto mb-2" />
          <h1 className="text-2xl font-bold text-foreground">
            {data.label ?? "Our family week"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">A read-only peek at this week.</p>
        </header>

        <section className="bg-white rounded-2xl border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" /> This week
          </h2>
          <ul className="space-y-3">
            {days.map((d) => (
              <li key={d.key}>
                <div className="text-xs font-semibold text-muted-foreground uppercase">{d.label}</div>
                {d.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground/70 ml-1">—</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {d.events.map((e) => {
                      const who = e.profileIds
                        .map((id) => profileMap.get(id)?.name)
                        .filter(Boolean)
                        .join(", ");
                      const time = e.isAllDay
                        ? "All day"
                        : new Date(e.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                      return (
                        <li key={e.id} className="text-sm text-foreground bg-amber-50 rounded-lg px-2 py-1.5">
                          <span className="font-medium">{e.title}</span>
                          <span className="text-muted-foreground"> · {time}</span>
                          {e.location ? <span className="text-muted-foreground"> · {e.location}</span> : null}
                          {who ? <div className="text-xs text-muted-foreground">{who}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        {data.chores.length > 0 && (
          <section className="bg-white rounded-2xl border border-border p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Chores in rotation</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.chores.slice(0, 20).map((c) => {
                const who = c.profileIds
                  .map((id) => profileMap.get(id)?.name)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <li key={c.id} className="text-sm bg-amber-50 rounded-lg px-2 py-1.5">
                    <span className="font-medium text-foreground">{c.title}</span>
                    {who ? <div className="text-xs text-muted-foreground">{who}</div> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Shared from Family Hub+. Read-only — viewers can't see details or change anything.
        </p>
      </div>
    </div>
  );
}
