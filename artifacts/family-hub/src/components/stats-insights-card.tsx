import { useMemo, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import type { Profile, ChoreCompletion, Achievement, StarLedger, StarLedgerEvent } from "@workspace/shared-types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TrendingUp, Star, Sparkles } from "lucide-react";

// Purely additive, read-only "stars over time" card. It adapts to the current
// header selection: one specific person → that person's stats; a group or
// "All Family" → the combined stats for everyone in that set (there is only
// ever ONE card, not one per person). Nothing here changes how points are
// earned or spent. Star totals come from the /api/stars/ledger endpoint, whose
// `balance` mirrors getProfilePoints exactly (so it matches the star pill),
// plus /api/chore-completions and /api/achievements (both already cached
// elsewhere) for the activity stats.

const AMBER = "#f59e0b"; // matches the star iconography used across the app

// Two tiles per row (not three) — three-across left barely 90px per tile on a
// phone-width card, which clipped longer labels like "Earned all-time" mid-word.
// Labels here are also shortened themselves (the detail moves to the `sub`
// line) so nothing needs to truncate even at this width.
function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/40 rounded-xl p-2.5 min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        {icon}<span>{label}</span>
      </div>
      <div className="text-lg font-bold text-foreground truncate">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function formatChartDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Cumulative-balance line: starts at 0 before the first event, then follows the
// running total (up on earning, down on spending), out to today. For a group /
// All Family this is the combined family balance over time (all people's events
// merged and summed). Hand-rolled SVG (no chart lib) to keep the bundle flat,
// in the app's inline-SVG style. Supports both hover (mouse) and drag (touch) —
// a plain onPointerMove handles both without branching on pointer type: it only
// ever fires for mouse on true hover, and for touch only while a finger is
// actually down, which is exactly the "drag a finger along the line" behavior
// requested.
function BalanceChart({ events }: { events: StarLedgerEvent[] }) {
  const pts = useMemo(() => {
    if (events.length === 0) return [];
    const out: { t: number; v: number }[] = [];
    const first = new Date(events[0].at).getTime();
    out.push({ t: first, v: 0 });
    let run = 0;
    for (const e of events) {
      run += e.delta;
      out.push({ t: new Date(e.at).getTime(), v: run });
    }
    out.push({ t: Date.now(), v: run }); // flat to today
    return out;
  }, [events]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (pts.length < 2) return null;

  const W = 300, H = 96, padX = 6, padTop = 8, padBot = 10;
  const ts = pts.map(p => p.t), vs = pts.map(p => p.v);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const vMinRaw = Math.min(0, ...vs), vMaxRaw = Math.max(...vs);
  const vMin = vMinRaw, vMax = vMaxRaw === vMin ? vMin + 1 : vMaxRaw;
  const x = (t: number) => padX + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - vMin) / (vMax - vMin)) * (H - padTop - padBot);

  const line = pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const baseY = y(vMin);
  const area = `${padX},${baseY} ${line} ${(W - padX)},${baseY}`;
  const last = pts[pts.length - 1];
  // Small dots at every real data point, not just the endpoints — the more
  // literal reading of "some data points on the line." Skipped once there
  // are too many (a long, active history) since they'd just clutter a chart
  // this small; the interactive tooltip below is the real answer at that point.
  const showAllDots = pts.length <= 40;

  const findNearestIdx = (clientX: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(x(p.t) - relX);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    setHoverIdx(findNearestIdx(e.clientX));
  };
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    setHoverIdx(findNearestIdx(e.clientX));
  };
  const clearHover = () => setHoverIdx(null);

  const hover = hoverIdx !== null ? pts[hoverIdx] : null;
  // Clamp the tooltip's own horizontal position so it doesn't spill past the
  // chart's edges when the touched point is right at the start or end.
  const hoverPct = hover ? Math.min(92, Math.max(8, (x(hover.t) / W) * 100)) : 0;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none cursor-pointer"
        style={{ touchAction: "none" }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Stars balance over time — hover or drag a finger along the line to see the star count on any date"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearHover}
        onPointerLeave={clearHover}
        onPointerCancel={clearHover}
      >
        <polygon points={area} fill={AMBER} fillOpacity={0.12} />
        {vMin < 0 && <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />}
        <polyline points={line} fill="none" stroke={AMBER} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {showAllDots && pts.slice(1, -1).map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={2} fill={AMBER} fillOpacity={0.5} />
        ))}
        <circle cx={x(last.t)} cy={y(last.v)} r={3.5} fill={AMBER} />
        {hover && (
          <>
            <line
              x1={x(hover.t)} y1={padTop} x2={x(hover.t)} y2={H - padBot}
              stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2,2"
            />
            <circle cx={x(hover.t)} cy={y(hover.v)} r={4.5} fill="var(--card, white)" stroke={AMBER} strokeWidth={2} />
          </>
        )}
      </svg>

      {/* Floating tooltip — follows the touched/hovered point, clamped inside the card */}
      {hover && (
        <div
          className="absolute -top-1 -translate-x-1/2 -translate-y-full pointer-events-none rounded-lg border border-border bg-card px-2 py-1 shadow-md text-center whitespace-nowrap"
          style={{ left: `${hoverPct}%` }}
        >
          <div className="text-xs font-bold text-foreground leading-tight">⭐ {hover.v}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{formatChartDate(hover.t)}</div>
        </div>
      )}

      {/* Date reference points along the x-axis, so the line means something
          even without touching it. */}
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1 px-0.5">
        <span>{formatChartDate(pts[0].t)}</span>
        {pts.length > 2 && <span>{formatChartDate(pts[Math.floor((pts.length - 1) / 2)].t)}</span>}
        <span>{formatChartDate(last.t)}</span>
      </div>
    </div>
  );
}

// `profiles` is the resolved set to show: exactly one person → their stats; a
// group or All Family → everyone in the set, combined. `title` names the card
// for the current selection.
export function StatsInsightsCard({ profiles, title }: { profiles: Profile[]; title: string }) {
  const isFamily = profiles.length !== 1;

  // One ledger fetch per profile in the set; aggregate below. For a single
  // person this is exactly the old behavior.
  const ledgerQueries = useQueries({
    queries: profiles.map(p => ({
      queryKey: ["/api/stars/ledger", p.id],
      staleTime: 30_000,
    })),
  });

  // Reuse the app-wide caches (no extra network) for activity stats.
  const { data: completions = [] } = useQuery<ChoreCompletion[]>({ queryKey: ["/api/chore-completions"] });
  const { data: achievements = [] } = useQuery<Achievement[]>({ queryKey: ["/api/achievements"] });

  const isLoading = ledgerQueries.some(q => q.isLoading);
  const isFetching = ledgerQueries.some(q => q.isFetching);
  // If ANY profile's ledger failed/didn't load, an aggregate total would be
  // silently short — treat the whole card's star numbers as unavailable and
  // show the retry, rather than a wrong sum that looks real.
  const ledgerUnavailable = ledgerQueries.some(q => q.isError || (!q.isLoading && !q.data));
  const refetchAll = () => ledgerQueries.forEach(q => q.refetch());

  // Aggregate star totals + a merged, time-sorted event list for the chart.
  const agg = useMemo(() => {
    const ledgers = ledgerQueries.map(q => q.data).filter(Boolean) as StarLedger[];
    let totalEarned = 0, totalSpent = 0, balance = 0;
    const events: StarLedgerEvent[] = [];
    for (const l of ledgers) {
      totalEarned += l.totalEarned;
      totalSpent += l.totalSpent;
      balance += l.balance;
      events.push(...l.events);
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { totalEarned, totalSpent, balance, events };
    // ledgerQueries is a fresh array each render; key the memo on the loaded data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerQueries.map(q => q.dataUpdatedAt).join(",")]);

  const stats = useMemo(() => {
    const ids = new Set(profiles.map(p => p.id));
    const mine = completions.filter(c => ids.has(c.profileId) && c.completedAt);
    const total = mine.length;
    let avgPerDay = 0;
    if (total > 0) {
      const times = mine.map(c => new Date(c.completedAt!).getTime());
      const firstDay = new Date(Math.min(...times)); firstDay.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const spanDays = Math.max(1, Math.round((today.getTime() - firstDay.getTime()) / 86_400_000) + 1);
      avgPerDay = total / spanDays;
    }
    // "Perfect days" in the family view means days EVERYONE finished, not the
    // sum of each person's own perfect days — two kids perfecting the same
    // day must count once, not twice. Group by calendar day first, then only
    // count a day when every one of the viewed profiles appears in it.
    const perfectDayProfilesByDay = new Map<string, Set<string>>();
    for (const a of achievements) {
      if (a.type !== "perfect_day" || !ids.has(a.profileId) || !a.earnedAt) continue;
      const day = new Date(a.earnedAt).toDateString();
      if (!perfectDayProfilesByDay.has(day)) perfectDayProfilesByDay.set(day, new Set());
      perfectDayProfilesByDay.get(day)!.add(a.profileId);
    }
    const perfectDays = isFamily
      ? [...perfectDayProfilesByDay.values()].filter(profileSet => profiles.every(p => profileSet.has(p.id))).length
      : perfectDayProfilesByDay.size;
    return { total, avgPerDay, perfectDays };
  }, [completions, achievements, profiles, isFamily]);

  const hasHistory = agg.events.length > 0;
  const dash = "—";

  return (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden" data-testid="stats-insights-card">
      <CardHeader className="p-4 border-b border-border bg-[#F7EAD9]/70 dark:bg-[#2e2a24]">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">
          {isFamily ? "Stars earned and spent across the family" : "Stars earned and spent over time"}
        </p>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {ledgerUnavailable && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 text-destructive text-xs px-2.5 py-2">
                <span>Couldn't load star history — earned/balance shown below may be wrong.</span>
                <button
                  type="button"
                  onClick={refetchAll}
                  disabled={isFetching}
                  className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50"
                >
                  {isFetching ? "Retrying…" : "Retry"}
                </button>
              </div>
            )}
            {/* Stat tiles — two per row so labels have room; three-across
                clipped longer ones like "Earned all-time" mid-word. */}
            <div className="grid grid-cols-2 gap-2">
              <StatTile icon={<Star className="w-3 h-3 fill-amber-400 text-amber-400" />} label="Earned" value={ledgerUnavailable ? dash : `${agg.totalEarned}`} sub="all-time" />
              <StatTile icon={<Sparkles className="w-3 h-3 text-amber-500" />} label="Balance" value={ledgerUnavailable ? dash : `${agg.balance}`} sub="right now" />
              <StatTile icon={<span className="text-[11px] leading-none">⭐</span>} label="Spent" value={ledgerUnavailable ? dash : `${agg.totalSpent}`} sub="on rewards" />
              <StatTile icon={<TrendingUp className="w-3 h-3 text-amber-500" />} label="Chores/day" value={stats.avgPerDay.toFixed(stats.avgPerDay >= 10 ? 0 : 1)} sub={`${stats.total} done`} />
            </div>
            <StatTile icon={<span className="text-[11px] leading-none">🎉</span>} label="Perfect days" value={`${stats.perfectDays}`} sub={isFamily ? "days everyone finished" : "every chore done that day"} />

            {/* Balance-over-time chart */}
            {hasHistory ? (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  {isFamily ? "Family star balance over time" : "Star balance over time"}
                </p>
                <div className="rounded-xl bg-muted/30 p-2 text-muted-foreground">
                  <BalanceChart events={agg.events} />
                </div>
              </div>
            ) : !ledgerUnavailable ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                No star activity yet — complete a chore to start the story!
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
