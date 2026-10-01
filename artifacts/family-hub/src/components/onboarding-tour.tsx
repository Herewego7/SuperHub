import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Star, Check, Calendar, StickyNote, HeartPulse, ChevronRight, ListTodo, Camera, CheckSquare, Home, UtensilsCrossed, ChevronLeft } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Animated feature tour ("Quick Tour") — a small set of self-contained,
// looping demos that simulate someone using a feature (a tap indicator moves,
// taps, and the UI responds), in the spirit of Apple's Tips app. These are
// CSS/JS-driven mock UIs rather than GIFs so they stay crisp, theme-aware, and
// weightless. All names/data are obviously-fake samples.
// ─────────────────────────────────────────────────────────────────────────────

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Cycle 0..numPhases-1 on a timer, looping. With reduced motion, park on the
// last phase (the "result" state) so the demo is still legible, just static.
function usePhaseLoop(numPhases: number, ms: number) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setPhase(numPhases - 1); return; }
    setPhase(0);
    const id = setInterval(() => setPhase(p => (p + 1) % numPhases), ms);
    return () => clearInterval(id);
  }, [numPhases, ms]);
  return phase;
}

// A soft touch indicator that glides to (x,y) (percentages of the frame) and
// pulses a ripple when `tapping`.
function TapCursor({ x, y, tapping }: { x: number; y: number; tapping: boolean }) {
  return (
    <div
      className="pointer-events-none absolute z-30 transition-all duration-500 ease-out"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
      aria-hidden
    >
      {tapping && (
        <span className="absolute inset-0 -m-3 rounded-full bg-primary/30 animate-ping" style={{ width: 40, height: 40, left: -8, top: -8 }} />
      )}
      <span className={cn(
        "block rounded-full border-2 border-white/90 bg-foreground/45 shadow-lg transition-transform duration-150",
        tapping ? "scale-90" : "scale-100",
      )} style={{ width: 26, height: 26 }} />
    </div>
  );
}

// Phone-ish frame that every demo lives inside.
function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[280px] aspect-[9/13.5] rounded-[26px] border border-border bg-background shadow-inner overflow-hidden select-none">
      {children}
    </div>
  );
}

const FAKE = [
  // "AF", not a star: the real All Family avatar shows initials, and a tour
  // that teaches a different UI than the one you land in is worse than no
  // tour. Same reason the demo's date reads like the real header's.
  { id: "all", name: "All Family", color: "#8b8f98", initials: "AF" },
  { id: "mom", name: "Mom", color: "#ec4899", initials: "M" },
  { id: "dad", name: "Dad", color: "#38bdf8", initials: "D" },
  { id: "ava", name: "Ava", color: "#a855f7", initials: "A" },
  { id: "leo", name: "Leo", color: "#22c55e", initials: "L" },
];

// Static (non-interactive) family avatar row — every real screen in the app
// always shows this at the top, on every tab, so any demo that doesn't
// include it reads as a cropped fragment rather than the actual app. "All"
// stays highlighted throughout, since these two demos aren't about profile
// selection (ProfileBarDemo, above, is the one that animates this same row).
function MiniFamilyBarStatic() {
  return (
    <div className="px-3 pt-2 pb-2 border-b border-border bg-card/70" data-testid="mini-family-bar">
      <div className="flex gap-2 justify-between">
        {FAKE.map((p, i) => (
          <div key={p.id} className="flex flex-col items-center gap-1" style={{ width: "18%" }}>
            <span className={cn(
              "rounded-full flex items-center justify-center text-white text-[10px] font-bold",
              i === 0 ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "",
            )} style={{ width: 26, height: 26, background: `linear-gradient(135deg, ${p.color}, ${p.color}bb)` }}>
              {p.initials}
            </span>
            <span className="text-[8px] text-muted-foreground truncate max-w-full">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Static date-nav row — every real screen also shows this right under the
// family bar (a centered "‹ date ›" with a "Today" subtitle underneath).
function MiniDateNavRow() {
  return (
    <div className="flex items-center justify-center gap-2 py-1.5 border-b border-border bg-card/70">
      <ChevronLeft className="w-2.5 h-2.5 text-muted-foreground" />
      <div className="text-center leading-tight">
        <p className="text-[8px] font-medium text-foreground">Aug 27, 2026</p>
        <p className="text-[6.5px] text-muted-foreground">Today</p>
      </div>
      <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />
    </div>
  );
}

const MINI_TABS = [
  { id: "home", icon: Home, label: "Home" },
  { id: "calendar", icon: Calendar, label: "Cal" },
  { id: "chores", icon: ListTodo, label: "Chores" },
  { id: "todos", icon: CheckSquare, label: "To-Dos" },
  { id: "meals", icon: UtensilsCrossed, label: "Meals" },
] as const;

// Static tab-pill row — matches the app's real nav (Home / Cal / Chores /
// To-Dos / Meals) so a demo's active tab is visible alongside the others,
// not just implied.
function MiniTabRow({ active }: { active: (typeof MINI_TABS)[number]["id"] }) {
  return (
    <div className="flex items-center justify-center gap-1 px-1.5 py-1.5 border-b border-border bg-card/40">
      {MINI_TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <span
            key={t.id}
            className={cn(
              "flex items-center gap-0.5 rounded-full px-1.5 py-1 text-[6.5px] font-medium whitespace-nowrap",
              isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="w-2 h-2" />
            {t.label}
          </span>
        );
      })}
    </div>
  );
}

// The full app chrome (status bar hint, family bar, date-nav, tab pills)
// every demo below sits under — this is what makes a demo read as "the real
// app," tabs and all, instead of a cropped fragment with no navigation.
function MiniAppChrome({ active }: { active: (typeof MINI_TABS)[number]["id"] }) {
  return (
    <>
      <div className="h-4 bg-accent/40" />
      <MiniFamilyBarStatic />
      <MiniDateNavRow />
      <MiniTabRow active={active} />
    </>
  );
}

// ── Demo 1: the family bar (selecting a profile) ─────────────────────────────
function ProfileBarDemo() {
  // 0 idle · 1 move to Ava · 2 tap+select · 3 hold result
  const phase = usePhaseLoop(4, 1400);
  const selectedIdx = phase >= 2 ? 3 : -1; // Ava = index 3
  // Tap cursor target: rest below, then onto Ava's avatar (~% positions).
  const avaX = 12 + 3 * 19; // avatars spread across the row
  const cur = phase === 0 ? { x: 50, y: 92 } : { x: avaX, y: 20 };
  const tapping = phase === 2;

  return (
    <DemoFrame>
      {/* status bar hint */}
      <div className="h-6 bg-accent/40" />
      {/* family bar */}
      <div className="px-3 pt-2 pb-3 border-b border-border bg-card/70">
        <div className="flex gap-2 justify-between">
          {FAKE.map((p, i) => {
            const on = i === selectedIdx;
            return (
              <div key={p.id} className="flex flex-col items-center gap-1" style={{ width: "18%" }}>
                <span className={cn(
                  "rounded-full flex items-center justify-center text-white text-[11px] font-bold transition-all duration-300",
                  on ? "ring-[3px] ring-primary ring-offset-2 ring-offset-card scale-105" : "",
                )} style={{ width: 34, height: 34, background: `linear-gradient(135deg, ${p.color}, ${p.color}bb)` }}>
                  {p.initials}
                </span>
                <span className="text-[9px] text-muted-foreground truncate max-w-full">{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      <MiniDateNavRow />
      <MiniTabRow active="home" />
      {/* Body reacting to the selection — this is the part that used to just
          fade the SAME "Make bed / Feed the dog / Homework" list in and out,
          which never actually demonstrated the filtering "All" is supposed to
          show. It now genuinely swaps content: a mixed, everyone's-tasks list
          before tapping Ava, replaced by Ava's own list once she's selected —
          same list of {5} rows either way so nothing jumps in height. */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            {selectedIdx >= 0 ? "Ava's day" : "Everyone's day"}
          </span>
          <span className={cn(
            "inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950 rounded-full px-2 py-0.5 transition-transform duration-300",
            selectedIdx >= 0 ? "scale-100" : "scale-0",
          )}>
            <Star className="w-3 h-3 fill-current" /> 12
          </span>
        </div>
        {(selectedIdx >= 0
          ? [
              { name: null, task: "Make bed" },
              { name: null, task: "Feed the dog" },
              { name: null, task: "Homework" },
            ]
          : [
              { name: "Mom", task: "Grocery run" },
              { name: "Dad", task: "Take out trash" },
              { name: "Ava", task: "Make bed" },
              { name: "Leo", task: "Feed the dog" },
            ]
        ).map((row, i) => (
          <div key={`${selectedIdx >= 0}-${i}`} className={cn(
            "flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 transition-all duration-300",
          )} style={{ transitionDelay: `${i * 50}ms` }}>
            <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/50 shrink-0" />
            {row.name && (
              <span className="text-[9px] font-bold text-muted-foreground shrink-0">{row.name}</span>
            )}
            <span className="text-[11px] text-foreground truncate">{row.task}</span>
          </div>
        ))}
      </div>
      <TapCursor x={cur.x} y={cur.y} tapping={tapping} />
    </DemoFrame>
  );
}

// ── Demo 2: the floating + button ────────────────────────────────────────────
// Mirrors the REAL "+" menu exactly (same 4 labeled groups, same items, same
// order — see the DropdownMenu in family-hub.tsx) rather than a generic
// stand-in, so this demo never drifts out of sync with what's actually there.
function PlusButtonDemo() {
  // 0 idle · 1 move to + · 2 tap (open) · 3 hold menu · 4 highlight "Create Chore"
  const phase = usePhaseLoop(5, 1500);
  const open = phase >= 2;
  const highlight = phase >= 4;
  const cur = phase === 0 ? { x: 50, y: 34 }
    : phase === 1 || phase === 2 ? { x: 84, y: 92 }
    : { x: 30, y: 56 }; // drift up over the menu
  const tapping = phase === 2;

  const groups: { label: string; items: { icon: React.ReactNode; label: string; hot?: boolean }[] }[] = [
    {
      label: "Calendar",
      items: [
        { icon: <Calendar className="w-3 h-3 text-primary" />, label: "Add event" },
        { icon: <Camera className="w-3 h-3 text-muted-foreground" />, label: "Snap a flyer" },
      ],
    },
    {
      label: "Tasks",
      items: [
        { icon: <ListTodo className="w-3 h-3 text-orange-500" />, label: "Create Chore", hot: true },
        { icon: <span className="text-[10px]">🌱</span>, label: "Create Inspiration" },
        { icon: <CheckSquare className="w-3 h-3 text-sky-500" />, label: "Add a to-do" },
      ],
    },
    {
      label: "Family",
      items: [
        { icon: <StickyNote className="w-3 h-3 text-amber-500" />, label: "Post a note" },
        { icon: <span className="text-[10px]">👏</span>, label: "Give praise" },
      ],
    },
    {
      label: "Health",
      items: [
        { icon: <span className="text-[10px]">💊</span>, label: "Health reminder" },
      ],
    },
  ];

  return (
    <DemoFrame>
      <MiniAppChrome active="home" />
      <div className="p-3 space-y-2 opacity-60">
        <div className="h-12 rounded-xl bg-card border border-border" />
        <div className="h-12 rounded-xl bg-card border border-border" />
      </div>
      {/* pop-up menu */}
      <div className={cn(
        "absolute right-3 bottom-16 w-[74%] rounded-2xl border border-border bg-card shadow-xl p-1.5 origin-bottom-right transition-all duration-300 z-20",
        open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-90 translate-y-2 pointer-events-none",
      )}>
        {groups.map((g, gi) => (
          <div key={g.label}>
            {gi > 0 && <div className="my-1 h-px bg-border" />}
            <p className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-0.5">{g.label}</p>
            {g.items.map(it => (
              <div key={it.label} className={cn(
                "flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors",
                highlight && it.hot ? "bg-primary/10" : "",
              )}>
                {it.icon}
                <span className={cn("text-[10px]", highlight && it.hot ? "font-bold text-primary" : "text-foreground")}>{it.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* floating + */}
      <div className="absolute right-3 bottom-3 z-10">
        <div className={cn("w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transition-transform duration-150", tapping ? "scale-90" : "scale-100")}>
          <Plus className="w-6 h-6" />
        </div>
      </div>
      <TapCursor x={cur.x} y={cur.y} tapping={tapping} />
    </DemoFrame>
  );
}

// ── Demo 3: the Tasks tab (chores + to-dos + rewards) ────────────────────────
function TasksDemo() {
  // 0 idle · 1 move to a chore checkbox · 2 tap (check) · 3 star flies to
  // counter · 4 move to the To-Dos tab pill · 5 tap it (switches tabs) ·
  // 6 hold on the To-Dos tab's own content — so the demo actually shows both
  // tabs the tip talks about, not just Chores.
  const phase = usePhaseLoop(7, 1300);
  const checked = phase >= 2;
  const flying = phase === 3;
  const onTodos = phase >= 5;
  const todoTapping = phase === 5;
  // Chore-checkbox position measured directly against the real rendered
  // checkbox (not hand-guessed). The To-Dos tab pill's position is estimated
  // the same way ProfileBarDemo estimates an avatar's x (item index 3 of 5,
  // evenly spread) — good enough for a stylized demo, not meant to be
  // pixel-exact.
  const cur =
    phase === 0 ? { x: 50, y: 3 }
    : phase <= 3 ? { x: 13, y: 47 }
    : { x: 69, y: 18 }; // the "To-Dos" tab pill
  const tapping = phase === 2 || todoTapping;

  return (
    <DemoFrame>
      <MiniAppChrome active={onTodos ? "todos" : "chores"} />
      {onTodos ? (
        <>
          <div className="flex items-center justify-between px-3 h-8 border-b border-border bg-card/70">
            <span className="text-xs font-bold text-foreground">To-Dos</span>
            <span className="text-[10px] text-muted-foreground">1 left</span>
          </div>
          <div className="p-2.5 space-y-2">
            <div className="rounded-xl border border-border bg-card p-2">
              <p className="text-[10px] font-bold text-sky-500 uppercase tracking-wide mb-1.5">☑️ To-Dos</p>
              <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/50 shrink-0" />
                <span className="text-[11px] text-foreground">📚 Read a book</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 mt-1.5">
                <span className="w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
                <span className="text-[11px] line-through text-muted-foreground">🎒 Pack backpack</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 h-8 border-b border-border bg-card/70">
            <span className="text-xs font-bold text-foreground">Chores</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
              <Star className={cn("w-3 h-3 fill-current transition-transform", flying ? "scale-125" : "scale-100")} /> {checked ? 14 : 12}
            </span>
          </div>
          <div className="p-2.5 space-y-2">
            {/* Chores card — trimmed to just what the tip talks about (a regular
                chore and a target chore); the Bonus/Rewards mini-cards and the
                old "To-Dos live elsewhere" disclaimer line were cut for less
                on-screen text, per explicit feedback. */}
            <div className="rounded-xl border border-border bg-card p-2">
              <p className="text-[10px] font-bold text-orange-500 uppercase tracking-wide mb-1.5">🧹 Chores</p>
              <div className="relative flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                <span data-testid="checkbox-target" className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center transition-colors duration-200",
                  checked ? "bg-green-500 text-white" : "border-2 border-muted-foreground/50",
                )}>
                  {checked && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </span>
                <span className={cn("text-[11px]", checked ? "line-through text-muted-foreground" : "text-foreground")}>🛏️ Make bed</span>
                <span className="ml-auto text-[10px] text-amber-500 font-bold">⭐ 2</span>
                {/* flying star */}
                <span className={cn(
                  "absolute left-2 text-xs transition-all duration-700 ease-out",
                  flying ? "opacity-0 -translate-y-24 translate-x-40" : "opacity-0 translate-y-0",
                )} style={{ opacity: flying ? 1 : 0 }}>⭐</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 mt-1.5">
                <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/50" />
                <span className="text-[11px] text-foreground">🎯 Read 3× this week</span>
                <span className="ml-auto text-[9px] text-violet-500 font-semibold">Target</span>
              </div>
            </div>
          </div>
        </>
      )}
      <TapCursor x={cur.x} y={cur.y} tapping={tapping} />
    </DemoFrame>
  );
}

interface Tip {
  key: string;
  title: string;
  body: string;
  Demo: () => React.ReactElement;
}

const TIPS: Tip[] = [
  {
    key: "family-bar",
    title: "Tap a photo to focus on one person",
    body: "Tap a photo to filter to one person; tap “All” for everyone.",
    Demo: ProfileBarDemo,
  },
  {
    key: "plus",
    title: "The + button creates anything",
    body: "Tap the purple + to add an event, chore, note or reminder.",
    Demo: PlusButtonDemo,
  },
  {
    key: "tasks",
    title: "Chores and To-Dos each get their own tab",
    body: "Chores holds regular, target and bonus chores plus Rewards. To-Dos is for one-offs.",
    Demo: TasksDemo,
  },
];

export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const tip = TIPS[i];
  const last = i === TIPS.length - 1;
  const Demo = tip.Demo;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Quick tour</p>
        <h2 className="text-2xl font-bold text-foreground">A few things worth knowing</h2>
      </div>

      {/* Animated demo — remount on tip change so the loop restarts cleanly. */}
      <div key={tip.key} className="rounded-2xl bg-accent/30 border border-border p-4">
        <Demo />
      </div>

      <div className="text-center px-1">
        <h3 className="text-lg font-bold text-foreground mb-1.5 text-balance">{tip.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{tip.body}</p>
      </div>

      {/* dots */}
      <div className="flex items-center justify-center gap-1.5">
        {TIPS.map((t, idx) => (
          <button
            key={t.key}
            onClick={() => setI(idx)}
            aria-label={`Go to tip ${idx + 1}`}
            className={cn("h-2 rounded-full transition-all", idx === i ? "w-6 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/40")}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        {!last ? (
          <>
            {/* Was text-muted-foreground on a light ground — too low-contrast
                to read as an available action next to a filled Next button. */}
            <Button variant="ghost" className="underline underline-offset-2" onClick={onDone}>Skip tour</Button>
            <Button className="flex-1" onClick={() => setI(i + 1)} data-testid="tour-next">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </>
        ) : (
          <Button size="lg" className="w-full" onClick={onDone} data-testid="tour-done">
            Got it
          </Button>
        )}
      </div>
    </div>
  );
}
