import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Calendar3View } from "@/components/calendar3-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

/**
 * The phone month view's dots-and-tap grid (2026-09-15): one dot per person
 * who has something that day, how many things inside it, the day's total
 * underneath, and the tapped day's full list below the grid.
 *
 * A family of four with a real routine, because the whole point of the design
 * is what a BUSY month looks like — a fixture with one event a week would
 * render a grid of single dots and prove nothing about it.
 */
const baseProfiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "parent", isActive: true },
  { id: "mom", name: "Mom", initials: "M", color: "#a855f7", role: "parent", isActive: true },
  { id: "ava", name: "Ava", initials: "A", color: "#ef4444", role: "child", isActive: true },
  { id: "noah", name: "Noah", initials: "N", color: "#22c55e", role: "child", isActive: true },
];

/**
 * `&people=6` grows the family, for the one thing about this grid that only
 * breaks at a size this fixture's own family never reaches: how the dots stack
 * once there are more of them than fit on a row.
 */
const EXTRA = [
  { id: "liam", name: "Liam", initials: "L", color: "#f59e0b" },
  { id: "mia", name: "Mia", initials: "I", color: "#14b8a6" },
  { id: "eli", name: "Eli", initials: "E", color: "#8b5cf6" },
  { id: "zoe", name: "Zoe", initials: "Z", color: "#e11d48" },
  { id: "kai", name: "Kai", initials: "K", color: "#0ea5e9" },
];

const familySize = (() => {
  const n = Number(new URLSearchParams(location.search).get("people"));
  return Number.isFinite(n) && n >= 4 ? Math.min(n, 9) : 4;
})();

const profiles = [
  ...baseProfiles,
  ...EXTRA.slice(0, familySize - 4).map(p => ({ ...p, role: "child", isActive: true })),
];
const extraIds = profiles.slice(4).map(p => p.id);

const KIDS = ["ava", "noah"];
const ALL = ["dad", "mom", "ava", "noah"];

function at(day: Date, h: number, m: number): Date {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** The month around today, so the grid is full whenever the suite runs. */
function buildEvents() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const out: Record<string, unknown>[] = [];
  let n = 0;

  const push = (
    day: Date, h: number, m: number, mins: number, title: string,
    on: string[], driver: string | null,
  ) => {
    const s = at(day, h, m);
    const e = new Date(s.getTime() + mins * 60000);
    out.push({
      id: `m${n++}`, userId: "u1", title,
      startTime: s.toISOString(), endTime: e.toISOString(),
      description: null, location: null,
      profileIds: on, drivingProfileIds: driver ? [driver] : [],
      isAllDay: false, source: null, recurrenceType: null, recurrenceEndDate: null,
      calendarId: null, calendarName: null,
    });
  };

  for (let i = 0; i < 31; i++) {
    const day = new Date(first.getFullYear(), first.getMonth(), 1 + i);
    if (day.getMonth() !== first.getMonth()) break;
    const dow = day.getDay();

    if (dow === 0) {
      push(day, 9, 30, 75, "Church", ALL, null);
      push(day, 11, 45, 90, "Lunch at Grandma's", ALL, "dad");
    }
    if (dow >= 1 && dow <= 5) {
      const dadMorning = dow === 1 || dow === 3 || dow === 5;
      push(day, 7, 45, 30, "Drop-off", KIDS, dadMorning ? "dad" : "mom");
      push(day, 15, 15, 30, "Pick-up", KIDS, dadMorning ? "mom" : "dad");
    }
    if (dow === 1) push(day, 6, 30, 60, "Swim team", ["ava"], "dad");
    if (dow === 2) {
      push(day, 12, 15, 60, "Client lunch", ["dad"], null);
      push(day, 16, 30, 90, "Soccer practice", ["noah"], "dad");
      push(day, 19, 0, 90, "Book club", ["mom"], null);
    }
    if (dow === 3) {
      push(day, 6, 30, 60, "Swim team", ["ava"], "dad");
      push(day, 16, 15, 45, "Violin lesson", ["ava"], "dad");
      push(day, 18, 0, 90, "Scouts", ["noah"], "mom");
    }
    if (dow === 4) {
      push(day, 10, 0, 120, "Volunteering", ["mom"], null);
      push(day, 16, 30, 90, "Soccer practice", ["noah"], "dad");
    }
    if (dow >= 1 && dow <= 4) push(day, 18, 45, 60, "Family dinner", ALL, null);
    if (dow === 6) {
      push(day, 9, 0, 90, "Soccer game", ["noah"], "dad");
      push(day, 11, 0, 75, "Farmers market", ["mom", "ava"], "mom");
    }
  }

  // Every extra family member gets their own daily thing, so a bigger family
  // actually produces a bigger stack of dots rather than the same four.
  if (extraIds.length) {
    for (let i = 0; i < 31; i++) {
      const day = new Date(first.getFullYear(), first.getMonth(), 1 + i);
      if (day.getMonth() !== first.getMonth()) break;
      extraIds.forEach((id, k) => push(day, 17, k * 15, 45, "Practice", [id], "mom"));
    }
  }

  // `&busy=N` piles N extra events onto today, for the case where a day has
  // more than fits even with the sheet fully up — the sheet clamps at the top
  // of the grid and the list itself has to scroll from there.
  const busy = Number(new URLSearchParams(location.search).get("busy"));
  if (Number.isFinite(busy) && busy > 0) {
    const today = new Date();
    for (let i = 0; i < busy; i++) {
      push(today, 8 + Math.floor(i / 4), (i % 4) * 15, 30, `Extra thing ${i + 1}`, ["ava"], null);
    }
  }

  // Today gets a few one-offs so the agenda under the grid has something with
  // a driver, a solo event and a whole-family event in it.
  const today = new Date();
  push(today, 15, 15, 45, "Ava's orthodontist", ["ava"], "mom");
  push(today, 19, 30, 105, "Family movie night", ALL, null);
  return out;
}

const events = buildEvents();

export function setup(): void {
  try {
    // Only seed the DEFAULT. Overwriting it on every load would make the
    // fixture, not the app, decide which view renders — and a test that
    // reloads to check the choice persisted would fail against a working app.
    if (!localStorage.getItem("familyHub_calMonthStyle")) {
      localStorage.setItem("familyHub_calMonthStyle", "dots");
    }
    localStorage.setItem("familyHub_calViewMode", "month");
  } catch { /* private mode */ }
  installMockApi(baselineRoutes({ "/api/profiles": profiles, "/api/events": () => ok(events) }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Calendar3View
        selectedProfiles={[]}
        profiles={profiles as never}
        selectedDate={new Date()}
        onDateChange={() => {}}
      />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
