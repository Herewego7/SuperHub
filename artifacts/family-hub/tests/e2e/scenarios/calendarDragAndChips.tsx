import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Calendar3View } from "@/components/calendar3-view";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "p1", name: "Mom", initials: "M", color: "#ec4899", role: "parent", isActive: true },
  { id: "p2", name: "Dad", initials: "D", color: "#3b82f6", role: "parent", isActive: true },
  { id: "p3", name: "Ava", initials: "A", color: "#22c55e", role: "child", isActive: true },
] as any;

// Fixed to TODAY at 10:00 so the event lands in the day view's visible hours
// whenever the suite runs.
const start = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d; })();
const end = (() => { const d = new Date(start); d.setHours(11, 0, 0, 0); return d; })();

// A plain event, plus a weekly one already expanded into an occurrence the way
// the server sends it (`<id>::occ::<n>` + isRecurringInstance) so the drag can
// be asked the scope question.
const rStart = (() => { const d = new Date(start); d.setHours(14, 0, 0, 0); return d; })();
const rEnd = (() => { const d = new Date(start); d.setHours(15, 0, 0, 0); return d; })();

const events = [
  {
    id: "e1", userId: "u1", title: "Swim practice",
    startTime: start.toISOString(), endTime: end.toISOString(),
    description: null, location: null,
    profileIds: ["p1", "p2", "p3"], drivingProfileIds: ["p2"],
    isAllDay: false, source: null, recurrenceType: null, recurrenceEndDate: null,
    calendarId: null, calendarName: null,
  },
  {
    id: "e2::occ::3", userId: "u1", title: "Piano lesson",
    startTime: rStart.toISOString(), endTime: rEnd.toISOString(),
    description: null, location: null,
    profileIds: ["p3"], drivingProfileIds: [],
    isAllDay: false, source: null,
    recurrenceType: "weekly", recurrenceEndDate: null,
    recurrenceInterval: 1, daysOfWeek: [1, 3],
    isRecurringInstance: true, seriesId: "e2",
    calendarId: null, calendarName: null,
  },
];

(window as unknown as { __lastEventPatch?: unknown }).__lastEventPatch = undefined;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/events": async (url: string, opts?: RequestInit) => {
        if (opts?.method === "PATCH") {
          const body = JSON.parse(opts.body as string);
          (window as unknown as { __lastEventPatch?: unknown }).__lastEventPatch = body;
          // A deliberate half-second, matching the round trip measured on a
          // real device. An instant mock would hide the snap-back entirely —
          // the whole bug lives in the window between letting go and the
          // server answering.
          await new Promise(r => setTimeout(r, 500));
          // ⚠️ The change has to STICK. A mock that echoes the patch but keeps
          // serving the original list from GET makes every later refetch undo
          // the move — which looks exactly like an app bug and sent one
          // investigation down the wrong path entirely.
          const id = url.split("/").pop()!;
          const i = events.findIndex(e => e.id === id);
          if (i >= 0) events[i] = { ...events[i], ...body };
          return ok(events[i] ?? { ...events[0], ...body });
        }
        return ok(events);
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Calendar3View
        selectedProfiles={[]}
        profiles={profiles}
        selectedDate={new Date()}
        onDateChange={() => {}}
      />
      <ConfirmDialogHost />
    </QueryClientProvider>
  );
}
