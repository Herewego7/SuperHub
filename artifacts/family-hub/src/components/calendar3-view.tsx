import { mailVisibleToKid, openTodos, todosForHome } from "@/lib/homeDay";
import { assignmentProfileIds, outlookEventProfileIds, withoutUnwatched } from "@/lib/outlookAttribution";
import { UPCOMING_KIND_LABELS, UPCOMING_KINDS, eventSourceChip, upcomingKindForMail, upcomingRows, type UpcomingKind } from "@/lib/upcoming";
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Profile, Event, InsertEvent, CalendarAssignment, Chore } from "@workspace/shared-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronLeft, ChevronRight, Plus, X, Settings, Car, PartyPopper, PanelLeft, Minus, AlertTriangle,
  Grip, LayoutList,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CelebrationsView } from "@/components/celebrations-view";
import { EventModal } from "@/components/event-modal";
import type { EventFormData } from "@/components/event-modal";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  isToday, addMonths, subMonths, startOfWeek, endOfWeek,
  addDays, subDays, addWeeks, subWeeks, isSameDay, parseISO,
  getHours, getMinutes, differenceInMinutes, startOfDay, set,
} from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useEdgeSwipeDateNav } from "@/lib/useEdgeSwipeDateNav";
import { hapticLight } from "@/lib/haptics";
import { eventTint } from "@/lib/eventTint";
import { confirmDialog, chooseDialog } from "@/lib/confirmDialog";
import { useParentGate } from "@/lib/parentGate";
import { parseGoogleEventDates, parseOutlookEventDates, icalDisplayEnd } from "@/lib/calendarDates";
import { applySavedEventToCache, removeEventFromCache, applyGoogleAssignmentToCache } from "@/lib/eventCache";
import { CalendarSettingsModal } from "@/components/calendar-settings-modal";
import { useCelebrationEvents, isCelebrationEventId } from "@/hooks/use-celebration-events";
import { useCelebrationSuggestion } from "@/hooks/use-celebration-suggestion";
import { DELETE_SERIES_BODY } from "@/lib/copy";
import { driverIdsOf, sameIds, driverIdsFromGoogleEvent } from "@/lib/eventDrivers";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOUR_HEIGHT = 64; // px per hour

// ── Email normalization ────────────────────────────────────────────────────────
// Gmail treats addresses as case-insensitive and ignores dots in the local part.
// Normalize before comparing so "John.Doe+tag@gmail.com" == "johndoe@gmail.com".
function normalizeGmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return null;
  const isGoogle = domain === "gmail.com" || domain === "googlemail.com";
  const cleanedLocal = isGoogle
    ? local.replace(/\./g, "").split("+")[0]
    : local.split("+")[0];
  return `${cleanedLocal}@${domain}`;
}

type ViewMode = "upcoming" | "day" | "workweek" | "week" | "month";

// ── Normalized event shape ────────────────────────────────────────────────────
interface Cal3Event {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  profileIds: string[];
  /** Drivers, as a set — see lib/eventDrivers.ts. */
  drivingProfileIds: string[];
  description?: string | null;
  location?: string | null;
  isAllDay: boolean;
  source: "local" | "google" | "outlook" | "ical";
  color: string;
  // raw originals for editing
  localId?: string;
  googleEventId?: string;
  googleProfileId?: string;
  googleCalendarId?: string;
  outlookCalendarId?: string | null;
  recurringEventId?: string | null;
  // Local recurrence (see api-server/src/lib/eventRecurrence.ts) — a
  // synthetic occurrence's `id` is not a real row; edits/deletes must
  // resolve back to the series' first occurrence.
  isRecurringInstance?: boolean;
  seriesId?: string;
  recurrenceType?: "daily" | "weekly" | "monthly" | "annually" | null;
  recurrenceEndDate?: string | null;
  recurrenceInterval?: number | null;
  daysOfWeek?: number[] | null;
}

// ── Helper: get profile color ─────────────────────────────────────────────────
// An event assigned to literally every real profile should show the "All
// Family" pseudo-profile's own color, not whichever real person happens to
// sort first in the profiles array (previously always "Dad" if he's first).
// Guarded on 2+ real profiles so a single-person household's own color isn't
// silently overridden by this rule.
function getProfileColor(profileIds: string[], profiles: Profile[]): string {
  const realProfiles = profiles.filter(p => !p.isAllFamilyProfile);
  const isEveryoneAssigned = realProfiles.length >= 2 && realProfiles.every(p => profileIds.includes(p.id));
  if (isEveryoneAssigned) {
    const allFamily = profiles.find(p => p.isAllFamilyProfile);
    if (allFamily?.color) return allFamily.color;
  }
  const first = profiles.find(p => profileIds.includes(p.id));
  return first?.color || "#6366f1";
}

// ── Helper: pick black or white text for a given background color (WCAG) ──────
function getContrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Relative luminance (WCAG 2.1)
  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  // White on dark (L < 0.35), black on light
  return L > 0.35 ? "#1a1a1a" : "#ffffff";
}

// ── Helper: position of an event within a bounded hour range ─────────────────
function clampMins(mins: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, mins));
}
function eventTopPct(date: Date, startHour: number, endHour: number): number {
  const rangeMins = (endHour - startHour) * 60;
  const mins = clampMins(getHours(date) * 60 + getMinutes(date), startHour * 60, endHour * 60);
  return (mins - startHour * 60) / rangeMins * 100;
}
function eventHeightPct(start: Date, end: Date, startHour: number, endHour: number): number {
  const rangeMins = (endHour - startHour) * 60;
  const s = clampMins(getHours(start) * 60 + getMinutes(start), startHour * 60, endHour * 60);
  const e = clampMins(getHours(end) * 60 + getMinutes(end), startHour * 60, endHour * 60);
  const mins = Math.max(30, e - s);
  return mins / rangeMins * 100;
}

// ── Overlap layout ────────────────────────────────────────────────────────────
interface LayoutEvent extends Cal3Event {
  colIndex: number;
  colCount: number;
}
function layoutOverlaps(events: Cal3Event[]): LayoutEvent[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => {
    const d = a.startTime.getTime() - b.startTime.getTime();
    if (d !== 0) return d;
    // Longer events first so columns pack predictably
    return b.endTime.getTime() - a.endTime.getTime();
  });

  const result: LayoutEvent[] = [];

  // Walk the events building "clusters": a maximal run of events that are
  // transitively connected by overlap. Every event in a cluster shares the
  // same column count, so N events overlapping at once → N equal columns.
  let cluster: Cal3Event[] = [];
  let clusterEnd = 0;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy column assignment within the cluster.
    const columns: Cal3Event[][] = [];
    const colOf = new Map<Cal3Event, number>();
    for (const ev of cluster) {
      let ci = columns.findIndex(col => col[col.length - 1].endTime <= ev.startTime);
      if (ci === -1) {
        ci = columns.length;
        columns.push([]);
      }
      columns[ci].push(ev);
      colOf.set(ev, ci);
    }
    const colCount = columns.length;
    for (const ev of cluster) {
      result.push({ ...ev, colIndex: colOf.get(ev)!, colCount });
    }
    cluster = [];
    clusterEnd = 0;
  };

  for (const ev of sorted) {
    if (cluster.length > 0 && ev.startTime.getTime() >= clusterEnd) {
      // No overlap with anything currently in the cluster → close it.
      flush();
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endTime.getTime());
  }
  flush();

  return result;
}

// ── Tiny mini-calendar ────────────────────────────────────────────────────────
function MiniCalendar({ date, onSelect, weekStartsOn = 0 }: { date: Date; onSelect: (d: Date) => void; weekStartsOn?: 0 | 1 }) {
  const [viewing, setViewing] = useState(() => startOfMonth(date));
  const days = eachDayOfInterval({ start: startOfWeek(viewing, { weekStartsOn }), end: endOfWeek(endOfMonth(viewing), { weekStartsOn }) });
  const dayLabels = weekStartsOn === 1
    ? ["M", "T", "W", "T", "F", "S", "S"]
    : ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setViewing(d => subMonths(d, 1))} className="p-2 rounded hover:bg-accent">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-semibold">{format(viewing, "MMMM yyyy")}</span>
        <button onClick={() => setViewing(d => addMonths(d, 1))} className="p-2 rounded hover:bg-accent">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {dayLabels.map((d, i) => (
          <span key={i} className="text-[10px] text-muted-foreground font-medium py-0.5">{d}</span>
        ))}
        {days.map(d => (
          <button
            key={d.toISOString()}
            onClick={() => onSelect(d)}
            className={`text-[11px] w-6 h-6 mx-auto rounded-full flex items-center justify-center transition-colors
              ${!isSameMonth(d, viewing) ? "text-muted-foreground/40" : ""}
              ${isSameDay(d, date) ? "bg-primary text-primary-foreground font-bold" : "hover:bg-accent"}
              ${isToday(d) && !isSameDay(d, date) ? "border border-primary text-primary font-semibold" : ""}
            `}
          >
            {format(d, "d")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Event block in time grid ──────────────────────────────────────────────────
// ── Who's driving ─────────────────────────────────────────────────────────────
// The same named pill the Events card on Home uses. The calendar showed a bare
// car icon, which says that SOMEONE is driving but not who — the one thing the
// chip exists to answer. The two were built separately and the named version
// only ever landed on Home (2026-09-12).
function EventDriverChip({
  ev, profiles, onClick, compact = false, iconOnly = false,
}: {
  ev: Cal3Event; profiles: Profile[];
  onClick?: (ev: Cal3Event) => void; compact?: boolean;
  /**
   * Drop the name and show the car alone. For the month grid, where a cell is
   * ~100px on a phone and the named pill took all of it — every chip read
   * "Dad" or "Mom" with the event title truncated away entirely, so the month
   * told you who was driving to something you could not identify
   * (2026-09-15). The name is still one tap away in day or week view, and in
   * the tooltip here.
   */
  iconOnly?: boolean;
}) {
  const drivers = ev.drivingProfileIds
    .map(id => profiles.find(p => p.id === id))
    .filter((p): p is Profile => !!p);
  const driver = drivers[0];
  if (!driver) return null;
  const names = drivers.map(d => d.name).join(", ");
  const label = `${names} ${drivers.length > 1 ? "are" : "is"} driving`;

  if (iconOnly) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full text-white flex-shrink-0 cursor-pointer hover:opacity-90 w-3.5 h-3.5"
        style={{ backgroundColor: driver.color }}
        title={label}
        aria-label={label}
        data-testid={`driver-indicator-${ev.id}`}
        onClick={(e) => { e.stopPropagation(); onClick?.(ev); }}
      >
        <Car className="w-2 h-2 flex-shrink-0" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-white font-medium flex-shrink-0 cursor-pointer hover:opacity-90 ${
        compact ? "text-[9px] px-1 py-0" : "text-[10px] px-1.5 py-0.5"
      }`}
      style={{ backgroundColor: driver.color }}
      title={label}
      data-testid={`driver-indicator-${ev.id}`}
      onClick={(e) => { e.stopPropagation(); onClick?.(ev); }}
    >
      <Car className={compact ? "w-2 h-2 flex-shrink-0" : "w-2.5 h-2.5 flex-shrink-0"} />
      <span className={compact ? "truncate max-w-[52px]" : "truncate max-w-[84px]"}>{names}</span>
    </span>
  );
}

// ── Who is on this event ──────────────────────────────────────────────────────
// The same overlapping initial chips the Events card on Home uses, so an event
// with several people reads the same way in both places. Only shown for two or
// more: a single-person event already says whose it is through the block's
// colour, and a chip there would be noise on every event in the grid.
function EventPeopleChips({
  profileIds, profiles, size = 16,
}: { profileIds: string[]; profiles: Profile[]; size?: number }) {
  const people = profileIds
    .map(id => profiles.find(p => p.id === id))
    .filter((p): p is Profile => !!p && !p.isAllFamilyProfile);
  if (people.length < 2) return null;
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return (
    <div
      className="flex -space-x-1 flex-shrink-0"
      title={people.map(p => p.name).join(", ")}
      data-testid="event-people-chips"
    >
      {shown.map(p => (
        <div
          key={p.id}
          className="rounded-full border border-white/80 flex items-center justify-center font-bold text-white leading-none"
          style={{ width: size, height: size, backgroundColor: p.color, fontSize: size * 0.55 }}
        >
          {p.initials?.[0] ?? p.name?.[0]}
        </div>
      ))}
      {extra > 0 && (
        <div
          className="rounded-full border border-white/80 flex items-center justify-center font-bold leading-none bg-black/55 text-white"
          style={{ width: size, height: size, fontSize: size * 0.5 }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

// Dragging an event to a new time. Snap is 15 minutes — finer reads as
// jittery on a phone and nobody schedules to the minute by dragging.
const DRAG_SNAP_MIN = 15;
// Touch needs a deliberate hold before a drag starts: the grid scrolls
// vertically, and an immediate drag would steal every scroll that happens to
// begin on top of an event. A mouse has no such ambiguity, so it drags at once.
const TOUCH_HOLD_MS = 350;
// Movement before the hold completes means the finger was scrolling.
const HOLD_CANCEL_PX = 8;

function TimeGridEvent({
  ev, dayStart, profiles, onClick, onDriverClick, startHour, endHour, hourHeight, onReschedule,
}: {
  ev: LayoutEvent; dayStart: Date; profiles: Profile[]; onClick: (ev: Cal3Event) => void;
  onDriverClick?: (ev: Cal3Event) => void;
  startHour: number; endHour: number; hourHeight: number;
  onReschedule?: (ev: Cal3Event, deltaMinutes: number) => void;
}) {
  const colW = 100 / ev.colCount;
  const left = ev.colIndex * colW;
  const width = colW - 1;

  // Only events this app owns can be moved by dragging.
  // Recurring occurrences drag too — the drop asks whether it means just that
  // one or the rest of the series. A Google/Outlook/iCal event still doesn't:
  // it belongs to the calendar it came from.
  const canDrag = !!onReschedule && ev.source === "local" && !ev.isAllDay;

  const rootRef = useRef<HTMLDivElement>(null);
  // WHERE THE BLOCK SITS, as a time rather than as an offset. Everything about
  // its position is derived from this one value.
  //
  // It used to be a translateY on top of a position computed from the server's
  // copy of the event, which produced the reported snap-back: on drop the
  // offset was cleared while the underlying event still held its OLD time, so
  // the block flew back to where it started and only moved to the dropped spot
  // when the save returned. Measured from the 2026-09-12 recording: dropped at
  // 2.60s, back at the original position by 2.75s, sat there ~500ms, arrived
  // at 3.25s.
  //
  // Deriving the position from a single time means the pending value and the
  // saved value describe the same place, so handing over from one to the other
  // is invisible — there is no frame where an offset and a fresh position are
  // both applied.
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  // The lifted look belongs to the GESTURE, not to the pending position: the
  // block keeps its dropped spot until the save lands, and leaving it ringed
  // and shadowed for that whole time reads as still being dragged.
  const [lifted, setLifted] = useState(false);
  const drag = useRef({ armed: false, startY: 0, moved: false, hold: 0 as unknown as ReturnType<typeof setTimeout> });
  // Set on drop so the click that follows a drag doesn't also open the event.
  const justDragged = useRef(false);

  const durationMs = ev.endTime.getTime() - ev.startTime.getTime();
  const displayStart = pendingStart ?? ev.startTime;
  const displayEnd = pendingStart ? new Date(pendingStart.getTime() + durationMs) : ev.endTime;

  // Non-passive, because preventDefault on a passive listener does nothing —
  // and preventing the touchmove is the only thing that stops the grid
  // scrolling under a drag that has already begun. `touch-action` is read when
  // the gesture starts, which is too early for a hold-then-drag.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || !canDrag) return;
    const onTouchMove = (e: TouchEvent) => { if (drag.current.armed) e.preventDefault(); };
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => node.removeEventListener("touchmove", onTouchMove);
  }, [canDrag]);

  const endDrag = async (commit: boolean) => {
    clearTimeout(drag.current.hold);
    const landed = pendingStart;
    const wasDragging = drag.current.armed && drag.current.moved;
    drag.current.armed = false;
    drag.current.moved = false;
    setLifted(false);
    if (wasDragging) {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 300);
    }
    const minutes = landed ? Math.round((landed.getTime() - ev.startTime.getTime()) / 60_000) : 0;
    if (commit && wasDragging && minutes) {
      // Hold the block where it was dropped until the save has been applied
      // (optimistically, so this resolves in a beat) or refused. Clearing
      // first is exactly what made it snap back.
      try {
        await onReschedule?.(ev, minutes);
      } finally {
        setPendingStart(null);
      }
    } else {
      setPendingStart(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canDrag || e.button > 0) return;
    drag.current.startY = e.clientY;
    drag.current.moved = false;
    drag.current.armed = false;
    if (e.pointerType === "mouse") {
      drag.current.armed = true;
      setLifted(true);
      rootRef.current?.setPointerCapture(e.pointerId);
    } else {
      drag.current.hold = setTimeout(() => {
        drag.current.armed = true;
        setLifted(true);
        rootRef.current?.setPointerCapture(e.pointerId);
        setPendingStart(new Date(ev.startTime));
        hapticLight();
      }, TOUCH_HOLD_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!canDrag) return;
    const dy = e.clientY - drag.current.startY;
    if (!drag.current.armed) {
      if (Math.abs(dy) > HOLD_CANCEL_PX) clearTimeout(drag.current.hold);
      return;
    }
    if (Math.abs(dy) > 2) drag.current.moved = true;
    const snapped = Math.round((dy / hourHeight) * 60 / DRAG_SNAP_MIN) * DRAG_SNAP_MIN;
    setPendingStart(new Date(ev.startTime.getTime() + snapped * 60_000));
  };

  const top = eventTopPct(displayStart, startHour, endHour);
  const height = eventHeightPct(displayStart, displayEnd, startHour, endHour);

  return (
    <div
      ref={rootRef}
      className={`absolute rounded-md px-1.5 py-0.5 text-xs overflow-hidden cursor-pointer hover:brightness-95 hover:shadow-md group border border-white/20 ${
        lifted ? "z-30 shadow-xl ring-2 ring-white/70 opacity-95" : "z-10 transition-all"
      }`}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 1.5)}%`,
        left: `${left}%`,
        width: `${width}%`,
        backgroundColor: ev.color,
        color: getContrastText(ev.color),
        minHeight: 22,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (justDragged.current) return;
        onClick(ev);
      }}
      data-testid={`time-grid-event-${ev.id}`}
    >
      <div className="font-semibold leading-tight truncate flex items-center gap-1">
        {/* Title first, then who's driving. The chip led the row, which put a
            name where the eye looks for the event (2026-09-13). */}
        <span className="truncate">{ev.title}</span>
        <EventDriverChip ev={ev} profiles={profiles} onClick={onDriverClick} />
        <span className="ml-auto pl-1">
          <EventPeopleChips profileIds={ev.profileIds} profiles={profiles} size={14} />
        </span>
      </div>
      {height > 3 && (
        <div className="opacity-80 text-[10px] leading-tight" data-testid={`event-time-${ev.id}`}>
          {format(displayStart, "h:mm a")} – {format(displayEnd, "h:mm a")}
        </div>
      )}
    </div>
  );
}

// ── Current time indicator ────────────────────────────────────────────────────
function CurrentTimeLine({ startHour, endHour }: { startHour: number; endHour: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowHour = getHours(now) + getMinutes(now) / 60;
  if (nowHour < startHour || nowHour > endHour) return null;
  const pct = eventTopPct(now, startHour, endHour);
  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${pct}%` }}
    >
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
        <div className="h-px flex-1 bg-red-500" />
      </div>
    </div>
  );
}

// ── Day column for week/day view ──────────────────────────────────────────────
interface DayColumnProps {
  day: Date;
  events: Cal3Event[];
  allDayEvents: Cal3Event[];
  profiles: Profile[];
  isCurrentDay: boolean;
  onSlotClick: (time: Date) => void;
  onEventClick: (ev: Cal3Event) => void;
  onDriverClick?: (ev: Cal3Event) => void;
  onReschedule?: (ev: Cal3Event, deltaMinutes: number) => void;
  startHour: number;
  endHour: number;
  hourHeight: number;
}

function DayColumn({ day, events, profiles, isCurrentDay, onSlotClick, onEventClick, onDriverClick, onReschedule, startHour, endHour, hourHeight }: DayColumnProps) {
  const rangeHours = endHour - startHour;
  const gridHours = Array.from({ length: rangeHours }, (_, i) => startHour + i);
  const timedEvents = events.filter(e => !e.isAllDay);
  const laid = layoutOverlaps(timedEvents);

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalPx = rangeHours * hourHeight;
    const fraction = y / totalPx;
    const minutesFromStart = Math.round(fraction * rangeHours * 60 / 30) * 30;
    const minutesFromMidnight = minutesFromStart + startHour * 60;
    const hours = Math.min(Math.floor(minutesFromMidnight / 60), endHour - 1);
    const minutes = minutesFromMidnight % 60;
    const clickTime = set(startOfDay(day), { hours, minutes });
    onSlotClick(clickTime);
  };

  return (
    <div
      className="relative flex-1 min-w-0 cursor-pointer select-none border-l border-[#b0bec8] dark:border-border bg-white dark:bg-card"
      style={{ height: rangeHours * hourHeight }}
      onClick={handleColumnClick}
    >
      {/* Hour lines */}
      {gridHours.map((h, i) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-[#2a2a2a]/10"
          style={{ top: i * hourHeight }}
        />
      ))}
      {/* Half-hour lines */}
      {gridHours.map((h, i) => (
        <div
          key={`h-${h}`}
          className="absolute left-0 right-0 border-t border-[#2a2a2a]/06 border-dashed"
          style={{ top: i * hourHeight + hourHeight / 2 }}
        />
      ))}
      {/* Today highlight */}
      {isCurrentDay && (
        <div className="absolute inset-0 bg-blue-50 dark:bg-blue-950/20 pointer-events-none" />
      )}
      {/* Events */}
      {laid.map(ev => (
        <TimeGridEvent
          key={ev.id}
          ev={ev}
          dayStart={startOfDay(day)}
          profiles={profiles}
          startHour={startHour}
          endHour={endHour}
          hourHeight={hourHeight}
          onClick={onEventClick}
          onDriverClick={onDriverClick}
          onReschedule={onReschedule}
        />
      ))}
      {/* Current time */}
      {isCurrentDay && <CurrentTimeLine startHour={startHour} endHour={endHour} />}
    </div>
  );
}

// ── Month cell ────────────────────────────────────────────────────────────────
function MonthCell({
  day, events, inMonth, onDayClick, onEventClick, onDriverClick, profiles, compact = false,
}: {
  day: Date; events: Cal3Event[]; inMonth: boolean;
  onDayClick: (d: Date) => void; onEventClick: (e: Cal3Event) => void;
  onDriverClick?: (e: Cal3Event) => void;
  profiles: Profile[];
  /**
   * Phone width. A month cell is a seventh of the screen — about 62px on a
   * 440px phone — and every pixel spent on anything but the title is a
   * character the title doesn't get. So on a phone the row is the title and
   * nothing else: no driver icon, tighter padding, a slightly smaller face.
   * That is the difference between "S…" and "School dro…".
   *
   * The driver icon stays at tablet width and up, where it costs 14px out of
   * ~190 rather than 14px out of 50.
   */
  compact?: boolean;
}) {
  const MAX_VISIBLE = 3;
  const visible = events.slice(0, MAX_VISIBLE);
  const overflow = events.slice(MAX_VISIBLE);
  const hidden = overflow.length;
  const [showOverflow, setShowOverflow] = useState(false);

  const eventRow = (ev: Cal3Event, testIdPrefix: string) => {
    return (
      <div
        key={ev.id}
        className={`rounded font-medium truncate cursor-pointer hover:opacity-90 transition-opacity flex items-center ${
          compact ? "text-[10px] px-1 py-0.5 gap-0" : "text-[11px] px-1.5 py-0.5 gap-1"
        }`}
        style={{ backgroundColor: ev.color, color: getContrastText(ev.color) }}
        onClick={e => { e.stopPropagation(); setShowOverflow(false); onEventClick(ev); }}
        data-testid={`${testIdPrefix}-${ev.id}`}
      >
        {/* flex-1 min-w-0 is the load-bearing part. Every chip beside this is
            flex-shrink-0, so without it the TITLE was the only thing that
            could give — and in a narrow month cell it gave all of it, leaving
            a row that showed the driver and nothing else. The title is the
            one thing a month view has to say. */}
        {/* Title only — no time. With the time in front, a 62px cell spent all
            of it on "7:4…" and the title never appeared at all: the month grid
            was a wall of clock fragments. The time is one tap away, and is
            always there in day and week view. */}
        <span className="truncate flex-1 min-w-0">{ev.title}</span>
        {/* Just the car, and nothing else. A month cell is ~44px wide on a
            390px phone: with the assignee avatars here as well there was
            literally nothing left for the title, which is the one thing this
            view has to show. The avatars are also the most redundant thing in
            the row — the block's own colour already says whose event it is —
            and they remain in day and week view, where there is room.
            Tap the chip to see who's driving. */}
        {!compact && (
          <span className="ml-auto pl-0.5 flex-shrink-0">
            <EventDriverChip
              ev={ev}
              profiles={profiles}
              iconOnly
              onClick={(clicked) => { setShowOverflow(false); onDriverClick?.(clicked); }}
            />
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={`min-h-[120px] ${compact ? "p-0.5" : "p-1"} border-b border-r transition-colors cursor-pointer group ${
        isToday(day)
          ? "border-2 border-primary bg-primary/10 dark:bg-primary/15 z-10 relative"
          : "border-[#b0bec8] dark:border-border"
      } ${
        !isToday(day) && (!inMonth ? "bg-[#dce8f2] dark:bg-[#1e2633]/30 opacity-60" : "bg-white dark:bg-card hover:bg-blue-50/40 dark:hover:bg-accent/20")
      }`}
      onClick={() => onDayClick(day)}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium transition-colors
            ${isToday(day)
              ? "bg-primary text-primary-foreground font-bold shadow-sm"
              : "text-foreground group-hover:bg-accent"
            }`}
        >
          {format(day, "d")}
        </span>
        {isToday(day) && (
          <span className="text-[10px] text-primary font-bold uppercase tracking-wide">Today</span>
        )}
      </div>
      <div className="space-y-0.5">
        {visible.map(ev => eventRow(ev, "month-event"))}
        {hidden > 0 && (
          <Popover open={showOverflow} onOpenChange={setShowOverflow}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground px-1 font-medium underline-offset-2 hover:underline"
                onClick={(e) => { e.stopPropagation(); setShowOverflow(true); }}
                data-testid={`month-overflow-${day.toISOString()}`}
              >
                +{hidden} more
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-64 p-2 space-y-1"
              onClick={(e) => e.stopPropagation()}
              align="start"
            >
              <p className="text-xs font-semibold text-foreground px-1 pb-1">
                {format(day, "EEEE, MMMM d")}
              </p>
              {overflow.map(ev => eventRow(ev, "month-overflow-event"))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

const MONTH_STYLE_KEY = "familyHub_calMonthStyle";

// ── Month, phone: dots and tap ────────────────────────────────────────────────
/**
 * The alternative phone month view (2026-09-15). The classic title-row cell
 * (`MonthCell` above) is untouched and still ships — this renders instead of it
 * only when the user turns it on, so both can be lived with before either is
 * chosen.
 *
 * WHY: a month cell on a phone is a seventh of the screen — ~44px at 390,
 * ~62px at 440 — which is about nine characters however the row is tuned. Even
 * after stripping the time, the avatars and the driver icon, the grid was
 * mostly ellipses. So this stops spending the cell on text: one dot per person
 * who has something that day, how many things they have inside it, and the
 * day's own total underneath. The grid answers "how busy, and whose"; the
 * tapped day answers everything else, in full, with nothing truncated.
 */

/** How many of the day's events each person is on OR driving. */
function dayLoadByPerson(events: Cal3Event[], people: Profile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ev of events) {
    // On it AND driving it is ONE commitment, not two — the number is how many
    // things are in your day, not how many roles you hold in them.
    const involved = new Set<string>([...ev.profileIds, ...ev.drivingProfileIds]);
    for (const p of people) {
      if (involved.has(p.id)) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * How to stack a day's dots. Four fit across a 390px phone's cell at full size
 * (4 x 11px + 3px of gap = 47px in ~55px), so up to four go on one row and
 * anything more splits into BALANCED rows of at most four: 5 is 3+2, 6 is 3+3,
 * 7 is 4+3, 8 is 4+4.
 *
 * Balanced, not wrapped. Letting them wrap naturally gives 4+1 and 4+2, which
 * read as a dot that fell off the end rather than as a deliberate block — and
 * the earlier alternative, shrinking the dot to 8px so six could stay on one
 * line, put a digit inside an 8px circle at a 6px face, which is not readable
 * on a phone. A second row costs ~12px of cell height; an unreadable number
 * costs the whole point of having one.
 *
 * Above eight, rows of at most four would stack three deep and eat the agenda
 * below, so there the dot does shrink — a nine-person household is far enough
 * outside what this app is for that the trade flips.
 */
function dotRows(count: number): number[] {
  if (count <= 4) return count > 0 ? [count] : [];
  const rows = Math.ceil(count / 4);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  // The fuller row goes first, so an odd count reads 3+2 rather than 2+3.
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

function dotSize(rowCount: number): { size: number; font: number } {
  return rowCount >= 3 ? { size: 9.5, font: 7 } : { size: 11, font: 8 };
}

/** Split a list into the row shape `dotRows` asked for. */
function chunkInto<T>(items: T[], shape: number[]): T[][] {
  const out: T[][] = [];
  let at = 0;
  for (const n of shape) { out.push(items.slice(at, at + n)); at += n; }
  return out;
}


function MonthDotsCell({
  day, events, inMonth, people, selected, onSelect,
}: {
  day: Date; events: Cal3Event[]; inMonth: boolean;
  /** Who gets a dot, in the profile row's own order, so a person sits in the
      same position every day and a column can be read down for one person. */
  people: Profile[];
  selected: boolean;
  onSelect: (d: Date) => void;
}) {
  const counts = dayLoadByPerson(events, people);
  const withSomething = people.filter(p => (counts.get(p.id) ?? 0) > 0);
  // This day's dots are laid out for THIS day's count, so a quiet day in a big
  // family still gets one tidy row. The space reserved below them is sized for
  // the whole FAMILY, so every cell in the grid is the same height whatever
  // each particular day holds.
  const shape = dotRows(withSomething.length);
  const reserved = dotRows(people.length);
  const { size, font } = dotSize(reserved.length);
  const pitch = size + 1;
  const total = events.length;
  const label = `${format(day, "MMMM d")}, ${
    total ? `${total} ${total === 1 ? "event" : "events"}: ` : ""
  }${
    withSomething.length
      ? withSomething.map(p => `${p.name} ${counts.get(p.id)}`).join(", ")
      : "nothing on"
  }`;

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-pressed={selected}
      aria-label={label}
      data-testid={`month-dots-cell-${format(day, "yyyy-MM-dd")}`}
      className={`min-h-[62px] px-0.5 pt-1 pb-1.5 border-b border-r transition-colors flex flex-col items-center gap-1 ${
        selected
          ? "border-2 border-primary bg-primary/10 dark:bg-primary/15 z-10 relative"
          : "border-[#b0bec8] dark:border-border"
      } ${
        !selected && (!inMonth
          ? "bg-[#dce8f2] dark:bg-[#1e2633]/30 opacity-60"
          : "bg-white dark:bg-card")
      }`}
    >
      <span
        className={`w-[21px] h-[21px] flex items-center justify-center rounded-full text-xs font-medium leading-none ${
          isToday(day)
            ? "bg-primary text-primary-foreground font-bold"
            : inMonth ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {format(day, "d")}
      </span>

      <span
        className="flex flex-col items-center gap-px"
        style={{ minHeight: reserved.length * pitch }}
      >
        {chunkInto(withSomething, shape).map((row, ri) => (
          <span key={ri} className="flex justify-center gap-px flex-nowrap">
            {row.map(p => {
              const n = counts.get(p.id) ?? 0;
              return (
                <span
                  key={p.id}
                  className="rounded-full text-white font-bold text-center flex-none tabular-nums"
                  style={{
                    width: size, height: size, lineHeight: `${size}px`,
                    fontSize: font, backgroundColor: p.color,
                  }}
                >
                  {n > 9 ? "9+" : n}
                </span>
              );
            })}
          </span>
        ))}
      </span>

      {/* In words, not a bare numeral: under four coloured digits, a lone "6"
          reads as a fifth person's count rather than the day's total. Three
          weight steps so the month shows its shape before anything is read. */}
      {total > 0 && (
        <span
          className={`text-[9px] leading-none tabular-nums whitespace-nowrap ${
            total >= 6 ? "text-foreground font-semibold"
              : total >= 3 ? "text-muted-foreground" : "text-muted-foreground/70"
          }`}
        >
          {total} {total === 1 ? "event" : "events"}
        </span>
      )}
    </button>
  );
}

/**
 * The tapped day's list, as a sheet that can be pulled up over the grid.
 *
 * WHY (reported 2026-09-15): at the default split the list shows about four
 * events and the rest are behind an inner scroll, so a four-event day and a
 * ten-event day look identical until you go looking. Letting the whole page
 * scroll instead was considered and rejected — the grid scrolling away takes
 * with it the thing the design exists for, which is seeing the rest of the
 * month while you read one day of it.
 *
 * So: two snap positions, and the reader picks. Down is the split (the grid
 * answers "how busy is the month"), up is the whole day (the list answers
 * "what is actually on"). Drag the grabber, or tap it to toggle.
 *
 * ⚠️ Pointer events, not a scroll handler: the grabber has `touch-action:
 * none` so a finger drag moves the sheet instead of scrolling the page, and
 * pointer capture keeps the gesture alive if the finger leaves the grabber
 * mid-drag. The list below keeps its own scrolling, untouched.
 */
const SHEET_FLICK_VELOCITY = 0.35; // px/ms — above this, direction wins over position
const SHEET_TAP_SLOP_PX = 4;       // below this, it was a tap, not a drag

function MonthAgendaSheet({
  collapsedTop, children,
}: {
  /** Where the sheet rests when down: the bottom of the month grid. */
  collapsedTop: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  /** Live position while a finger is down; null when the sheet is at rest. */
  const [dragTop, setDragTop] = useState<number | null>(null);
  const drag = useRef<{
    startY: number; startTop: number; lastY: number; lastT: number; v: number; moved: boolean;
  } | null>(null);

  /**
   * How tall the list actually is, measured, so the sheet can rise just far
   * enough to show it rather than always covering the whole grid.
   *
   * A three-event day lifting to full height left most of the screen blank
   * AND hid the month for no reason — the grid is the thing this view exists
   * for, so it should only be given up in exchange for something.
   */
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    if (!content) return;
    const measure = () => setContentHeight(content.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [content]);

  /** The box the sheet slides inside — its own offset parent. */
  const [sheetEl, setSheetEl] = useState<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  useEffect(() => {
    const box = sheetEl?.parentElement;
    if (!box) return;
    const measure = () => setContainerHeight(box.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [sheetEl]);

  // The grabber's own height counts, or the last row ends up underneath it.
  const HANDLE_PX = 32;
  /**
   * Just far enough to show the whole list, and no further — clamped to the
   * top of the month area for a day with more events than fit.
   */
  const needed = contentHeight + HANDLE_PX;
  const expandedTop = containerHeight > 0
    ? Math.min(collapsedTop, Math.max(0, containerHeight - needed))
    : 0;
  /**
   * Nothing to reveal — the list already fits in the collapsed sheet. The
   * grabber is hidden in that case rather than left as an affordance that
   * does nothing when pulled, which reads as broken.
   */
  const canExpand = expandedTop < collapsedTop - 8;

  const restingTop = expanded && canExpand ? expandedTop : collapsedTop;
  const top = dragTop ?? restingTop;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startY: e.clientY, startTop: restingTop,
      lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false,
    };
    setDragTop(restingTop);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > SHEET_TAP_SLOP_PX) d.moved = true;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragTop(Math.max(expandedTop, Math.min(collapsedTop, d.startTop + dy)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d) return;
    if (!d.moved) {
      // A tap toggles. Same target, whether or not the finger travelled.
      setDragTop(null);
      setExpanded(v => !v);
      hapticLight();
      return;
    }
    const landed = dragTop ?? restingTop;
    // A deliberate flick beats where it happened to end up — letting go
    // halfway while clearly moving upward should open it, not snap back.
    // Halfway between the two resting places, not halfway down the screen:
    // with a short list the sheet's whole travel may be 80px, and a fixed
    // midpoint would make it impossible to leave open.
    const midpoint = (expandedTop + collapsedTop) / 2;
    const next = Math.abs(d.v) > SHEET_FLICK_VELOCITY
      ? d.v < 0
      : landed < midpoint;
    setDragTop(null);
    setExpanded(next);
  };

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col bg-white dark:bg-card
        border-t-2 border-[#b0bec8] dark:border-border rounded-t-xl overflow-hidden
        ${dragTop === null ? "transition-[top] duration-200 ease-out" : ""}`}
      style={{
        top,
        // Only once it is actually lifted — a shadow under a sheet that is
        // sitting flush against the grid just reads as a smudge.
        boxShadow: top < collapsedTop ? "0 -8px 20px -14px rgba(0,0,0,.55)" : undefined,
      }}
      ref={setSheetEl}
      data-testid="month-agenda-sheet"
      data-expanded={expanded && canExpand ? "true" : "false"}
      data-can-expand={canExpand ? "true" : "false"}
    >
      <button
        type="button"
        hidden={!canExpand}
        className="flex-shrink-0 w-full flex items-center justify-center py-2 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse the day's events" : "Expand the day's events"}
        data-testid="month-agenda-handle"
      >
        {/* ⚠️ Inline colour, not `bg-muted-foreground/40`: an opacity
            modifier on a theme colour compiles to NO CSS in this project
            (see CLAUDE.md), which rendered the grabber invisible. */}
        <span
          className="w-9 h-1 rounded-full"
          style={{ backgroundColor: "rgba(120,130,145,.45)" }}
        />
      </button>
      <div className="flex-1 overflow-auto min-h-0" data-testid="month-agenda-scroll">
        <div ref={setContent}>{children}</div>
      </div>
    </div>
  );
}

/** The tapped day, under the grid: full titles, real times, nothing truncated. */
function MonthDayAgenda({
  day, events, profiles, onEventClick, onDriverClick, onOpenDay,
}: {
  day: Date; events: Cal3Event[]; profiles: Profile[];
  onEventClick: (e: Cal3Event) => void;
  onDriverClick: (e: Cal3Event) => void;
  onOpenDay: (d: Date) => void;
}) {
  const sorted = [...events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return (
    <div className="bg-white dark:bg-card">
      <div className="flex items-start justify-between px-3 pt-0.5 pb-1.5">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">
            {format(day, "EEEE, MMMM d")}
            {isToday(day) && <span className="text-primary font-semibold"> · Today</span>}
          </h3>
          {/* How many, said plainly. Without it, four events and ten look
              identical until the sheet is pulled up — the list simply ends
              at the fold with nothing to say there is more (2026-09-15).
              A second line rather than the same one: at 390px the date and
              "Open day" already fill that row edge to edge. */}
          {sorted.length > 0 && (
            <p className="text-[11px] text-muted-foreground leading-tight">
              {sorted.length} {sorted.length === 1 ? "event" : "events"}
            </p>
          )}
        </div>
        <button
          type="button"
          className="text-xs text-primary font-medium"
          onClick={() => onOpenDay(day)}
          data-testid="month-agenda-open-day"
        >
          Open day
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="px-3 pb-4 text-xs text-muted-foreground">Nothing on.</p>
      ) : (
        <ul className="px-2 pb-4 space-y-1">
          {sorted.map(ev => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => onEventClick(ev)}
                data-testid={`month-agenda-event-${ev.id}`}
                // Tinted with the event's own colour and a 4px bar, the same
                // treatment the Events card on Home gives its rows — this was
                // a grey list with a colour edge, which matched nothing else
                // in the app. Falls back to the grey when the colour isn't a
                // plain hex, rather than rendering an untinted row.
                className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 border-l-4 text-left ${
                  eventTint(ev.color) ? "" : "bg-muted/60 dark:bg-muted/30"
                }`}
                style={{ backgroundColor: eventTint(ev.color), borderLeftColor: ev.color }}
              >
                <span className="w-[58px] flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {ev.isAllDay ? "All day" : format(ev.startTime, "h:mm a")}
                </span>
                <span className="flex-1 min-w-0 text-[13px] font-semibold text-foreground truncate">
                  {ev.title}
                </span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <EventDriverChip
                    ev={ev}
                    profiles={profiles}
                    compact
                    onClick={onDriverClick}
                  />
                  <EventPeopleChips profileIds={ev.profileIds} profiles={profiles} size={15} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main Calendar 3 View ──────────────────────────────────────────────────────
export interface Calendar3ViewHandle {
  goPrev: () => void;
  goNext: () => void;
}

interface Calendar3ViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  selectedDate: Date;
  /** The persistent header date nav is the single source of truth for the
      currently-viewed date — Calendar used to keep its own separate,
      disconnected `currentDate` state (the header's arrows had no effect
      here at all). Calendar now just renders whatever date it's given and
      reports changes back up via this, instead of owning the date itself. */
  onDateChange: (date: Date) => void;
  /** When set, open the event modal for this event ID as soon as events load */
  pendingOpenEventId?: string | null;
  onPendingEventOpened?: () => void;
  /** Opens Settings' Calendar section, optionally auto-expanding a specific
   * profile's row — used by the sync-error banners below so tapping one
   * lands directly on the account that needs reconnecting instead of just
   * the app's default screen. */
  onOpenCalendarSettings?: (profileId?: string) => void;
}

export const Calendar3View = forwardRef<Calendar3ViewHandle, Calendar3ViewProps>(function Calendar3View(
  { selectedProfiles, profiles, selectedDate, onDateChange, pendingOpenEventId, onPendingEventOpened, onOpenCalendarSettings },
  ref,
) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const suggestCelebration = useCelebrationSuggestion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLDivElement>(null);
  const allDayRowRef = useRef<HTMLDivElement>(null);

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  /**
   * Which phone month view to draw (2026-09-15). Two complete month views now
   * exist — the classic title rows (`MonthCell`) and the dots-and-tap grid
   * (`MonthDotsCell` + `MonthDayAgenda`) — because a month cell on a phone is
   * too narrow for titles but the answer wasn't obvious enough to just swap.
   * Per-device, like the other calendar display preferences; tablet and
   * desktop are unaffected and always get the title rows.
   */
  const [monthStyle, setMonthStyle] = useState<"titles" | "dots">(() => {
    if (typeof window === "undefined") return "dots";
    return localStorage.getItem(MONTH_STYLE_KEY) === "titles" ? "titles" : "dots";
  });
  const chooseMonthStyle = useCallback((next: "titles" | "dots") => {
    setMonthStyle(next);
    try { localStorage.setItem(MONTH_STYLE_KEY, next); } catch { /* private mode */ }
  }, []);
  /** The day whose events the agenda is showing. Null = follow the date nav. */
  const [monthSelectedDay, setMonthSelectedDay] = useState<Date | null>(null);

  /**
   * The height of everything above the agenda sheet (switch bar + weekday
   * header + the month grid), which is where the sheet rests when it is down.
   * Measured rather than assumed: the grid is five or six rows depending on
   * the month, and the dots block is taller for a bigger family.
   *
   * ⚠️ A ref CALLBACK into state, not a ref + `useEffect([])` — the element
   * belongs to a branch that isn't mounted on first render, so a plain ref
   * would still be null when the effect ran (see CLAUDE.md).
   */
  const [monthGridEl, setMonthGridEl] = useState<HTMLDivElement | null>(null);
  const [monthGridHeight, setMonthGridHeight] = useState(0);
  useEffect(() => {
    if (!monthGridEl) return;
    const measure = () => setMonthGridHeight(monthGridEl.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(monthGridEl);
    return () => ro.disconnect();
  }, [monthGridEl]);
  const [isTablet, setIsTablet] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768 && window.innerWidth < 1024);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "week";
    const saved = localStorage.getItem("familyHub_calViewMode") as ViewMode | null;
    const known = ["upcoming", "day", "workweek", "week", "month"] as ViewMode[];
    const phone = window.innerWidth < 768;
    if (phone) {
      if (saved === "upcoming" || saved === "week" || saved === "month") return saved;
      return "upcoming";
    }
    if (saved && known.includes(saved)) return saved;
    return "week";
  });
  const [upcomingKind, setUpcomingKind] = useState<UpcomingKind>("all");
  // `currentDate` is just a local alias for the controlled `selectedDate`
  // prop — kept so the many existing reads below didn't need renaming.
  const currentDate = selectedDate;
  const setCurrentDate = onDateChange;
  const [showSidebar, setShowSidebar] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window === "undefined") return 0.75;
    const saved = localStorage.getItem("familyHub_calZoom");
    return saved ? Math.max(0.5, Math.min(2.0, parseFloat(saved))) : 0.75;
  });
  const hourHeight = HOUR_HEIGHT * zoomLevel;
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);
  const adjustZoom = useCallback((delta: number) => {
    setZoomLevel(prev => {
      const next = Math.max(0.5, Math.min(2.0, Math.round((prev + delta) * 4) / 4));
      localStorage.setItem("familyHub_calZoom", String(next));
      return next;
    });
  }, []);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Optional PIN gate for the calendar display settings (gear) — OFF by
  // default; families opt in via Settings → Rewards & Approvals.
  const { guard: guardParentAction, gateDialog: parentGateDialog } = useParentGate(profiles, selectedProfiles);
  const [showCelebrations, setShowCelebrations] = useState(false);

  // Sync padding-right on the header and all-day strip to match the body
  // scrollbar gutter width so all column borders stay aligned. We use direct
  // DOM writes (no setState) so there is no extra render cycle, and
  // useLayoutEffect so the correction is applied before the first paint.
  const gutterWidthRef = useRef(0);

  useLayoutEffect(() => {
    const body = scrollRef.current;
    if (!body) return;
    const sync = () => {
      const w = body.offsetWidth - body.clientWidth;
      gutterWidthRef.current = w;
      if (headerRowRef.current) headerRowRef.current.style.paddingRight = `${w}px`;
      if (allDayRowRef.current) allDayRowRef.current.style.paddingRight = `${w}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(body);
    return () => ro.disconnect();
  }, [viewMode]);
  const setViewModePersisted = useCallback((v: ViewMode) => {
    setViewMode(v);
    localStorage.setItem("familyHub_calViewMode", v);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── Pinch-to-zoom on the scrollable time grid ────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        startDist = Math.hypot(dx, dy);
        startZoom = zoomLevelRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (startDist > 0) {
          const ratio = dist / startDist;
          const next = Math.max(0.5, Math.min(2.0, Math.round(startZoom * ratio * 4) / 4));
          setZoomLevel(next);
          localStorage.setItem("familyHub_calZoom", String(next));
        }
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — uses ref, no stale closure

  // Event modal state (mirrors home-view.tsx)
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  // Holds a pending recurring-event assignment change while we ask the user whether
  // it should apply to just this occurrence or this and all following occurrences.
  const [recurringScope, setRecurringScope] = useState<null | { eventData: any }>(null);
  const [highlightDrivingField, setHighlightDrivingField] = useState(false);
  useEffect(() => {
    if (!showEventModal) setHighlightDrivingField(false);
  }, [showEventModal]);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);

  // Every event belongs to someone — default a new event to whoever's
  // currently filtered to (the header's selected profile), or everyone if
  // no single person is filtered to.
  const defaultProfileIds = useCallback((): string[] => {
    const realSelected = selectedProfiles.filter((id) => {
      const p = profiles.find((pr) => pr.id === id);
      return p && !p.isAllFamilyProfile;
    });
    if (realSelected.length > 0) return realSelected;
    return profiles.filter((p) => !p.isAllFamilyProfile).map((p) => p.id);
  }, [selectedProfiles, profiles]);

  /** Who gets a dot in the phone month grid, in the profile row's own order:
      whoever the header is filtered to, or the whole family for All Family. */
  const dotPeople = useMemo(() => {
    const real = profiles.filter(p => !p.isAllFamilyProfile);
    const picked = real.filter(p => selectedProfiles.includes(p.id));
    return picked.length > 0 ? picked : real;
  }, [profiles, selectedProfiles]);

  const [formData, setFormData] = useState<EventFormData>({
    title: "",
    description: "",
    location: "",
    profileIds: [],
    isAllDay: false,
    drivingProfileIds: [],
    recurrenceType: "none",
    recurrenceEndDate: null,
  });

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: localEvents = [] } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const { data: completions = [] } = useQuery<{ choreId: string }[]>({ queryKey: ["/api/chore-completions"] });
  const { data: calendarAssignments = [] } = useQuery<CalendarAssignment[]>({
    queryKey: ["/api/calendar-assignments"],
    retry: false,
  });
  const { data: calendarSettings } = useQuery<any>({ queryKey: ["/api/calendar-settings"] });
  const { data: googleAccounts = [] } = useQuery<{ profileId: string; email: string }[]>({
    queryKey: ["/api/google-calendar/accounts"],
    retry: false,
    staleTime: 300_000,
  });
  const googleAccountEmailMap = useMemo(
    () => new Map(
      googleAccounts
        .map(a => [normalizeGmail(a.email), a.profileId] as const)
        .filter((e): e is readonly [string, string] => e[0] !== null)
    ),
    [googleAccounts],
  );

  const displayStartHour: number = (calendarSettings as any)?.startHour ?? 8;
  const displayEndHour: number = (calendarSettings as any)?.endHour ?? 22;
  // Work Week always starts Monday regardless of this preference — it's a
  // fixed Mon-Fri view, not affected by the user's week-start choice.
  const weekStartsOn: 0 | 1 = (calendarSettings as any)?.weekStartsOn === 1 ? 1 : 0;

  const regularProfiles = useMemo(() => profiles.filter(p => !p.isAllFamilyProfile), [profiles]);

  const googleConnectedProfiles = useMemo(() => regularProfiles.filter(p => p.googleCalendarConnected), [regularProfiles]);
  const googleQueries = useQueries({
    queries: googleConnectedProfiles.map(p => ({
      queryKey: ["/api/google-calendar/events", p.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const googleSyncError = googleQueries.some(q => q.isError);
  // First profile whose connection is actually erroring — lets the banner
  // deep-link straight to that person's row in Settings instead of just the
  // Calendar section in general.
  const googleErrorProfileId = googleConnectedProfiles[googleQueries.findIndex(q => q.isError)]?.id;

  const outlookConnectedProfiles = useMemo(() => regularProfiles.filter(p => p.outlookCalendarConnected), [regularProfiles]);
  const outlookQueries = useQueries({
    queries: outlookConnectedProfiles.map(p => ({
      queryKey: ["/api/outlook-calendar/events", p.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      retry: false,
      staleTime: 60_000,
    })),
  });
  // Previously read nowhere — an expired/broken Outlook connection failed
  // silently and just rendered as "no events," indistinguishable from an
  // account with nothing scheduled. Google gets this exact banner already.
  const outlookSyncError = outlookQueries.some(q => q.isError);
  const outlookErrorProfileId = outlookConnectedProfiles[outlookQueries.findIndex(q => q.isError)]?.id;

  const icalConnectedProfiles = useMemo(() => regularProfiles.filter(p => p.icalConnected), [regularProfiles]);
  const icalQueries = useQueries({
    queries: icalConnectedProfiles.map(p => ({
      queryKey: ["/api/ical-calendar/events", p.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const icalSyncError = icalQueries.some(q => q.isError);

  // ── Normalize all events ────────────────────────────────────────────────────
  // Signatures keyed on each query's dataUpdatedAt: useQueries returns a new array
  // reference every render, which would otherwise invalidate the memo below on
  // every render and re-normalize thousands of events on each tab/profile switch.
  const googleDataSig = googleQueries.map(q => q.dataUpdatedAt ?? 0).join("|");
  const outlookDataSig = outlookQueries.map(q => q.dataUpdatedAt ?? 0).join("|");
  const icalDataSig = icalQueries.map(q => q.dataUpdatedAt ?? 0).join("|");
  const allEvents = useMemo<Cal3Event[]>(() => {
    const result: Cal3Event[] = [];

    // 1. Local events
    for (const e of localEvents) {
      if (!e.startTime || !e.endTime) continue;
      const pIds = (e.profileIds as string[] | null) ?? [];
      result.push({
        id: e.id,
        localId: e.id,
        title: e.title,
        startTime: new Date(e.startTime),
        endTime: new Date(e.endTime),
        profileIds: pIds,
        drivingProfileIds: driverIdsOf(e),
        description: e.description,
        location: e.location,
        isAllDay: e.isAllDay ?? false,
        source: "local",
        color: getProfileColor(pIds, profiles),
        isRecurringInstance: (e as any).isRecurringInstance ?? false,
        seriesId: (e as any).seriesId,
        recurrenceType: (e as any).recurrenceType ?? null,
        recurrenceEndDate: (e as any).recurrenceEndDate ?? null,
        recurrenceInterval: (e as any).recurrenceInterval ?? 1,
        daysOfWeek: (e as any).daysOfWeek ?? null,
      });
    }

    // 2. Google Calendar
    // Use iCalUID as the stable dedup key (same event across two calendars gets
    // different ge.id values but the same iCalUID). When the same event appears
    // on multiple family members' calendars, keep the copy whose creator email
    // matches a connected family account (Priority 2 win) over one that only
    // resolved via Priority 3/4.
    // resolveRank ranks how a copy's profile assignment was determined, so that
    // when the SAME occurrence appears on multiple calendars we keep the most
    // authoritative copy: an explicit manual assignment (3) must beat a
    // creator-email match (2), which beats any weaker fallback (1).
    type Resolved = { ge: any; pIds: string[]; resolveRank: number; pid: string };
    const bestByKey = new Map<string, Resolved>();

    googleQueries.forEach((q, i) => {
      const pid = googleConnectedProfiles[i]?.id;
      if (!pid) return;
      for (const ge of (q.data ?? []) as any[]) {
        // Dedup the SAME occurrence appearing on multiple calendars, while keeping
        // distinct occurrences of a recurring series separate. With singleEvents,
        // every occurrence shares one iCalUID, so we include the instance start in
        // the key — otherwise a whole recurring series collapses into a single
        // (earliest) event and current/future occurrences disappear.
        // The start must be NORMALIZED to a canonical instant: the same event on
        // two calendars can serialize its start differently (e.g. "...-07:00" vs
        // "...Z"); comparing raw strings would treat those as different and leak a
        // duplicate. Timed events key on epoch ms; all-day events on their date.
        const occurrenceStart = ge.start?.dateTime
          ? String(new Date(ge.start.dateTime).getTime())
          : (ge.start?.date || "");
        const key = `${ge.iCalUID || ge.id}::${occurrenceStart}`;
        let pIds: string[] = [];
        let resolveRank = 1;

        // Priority 1: explicit familyhub assignment (DB-backed override or stored
        // on the event). This is a deliberate user choice and outranks everything.
        const stored = ge.extendedProperties?.private?.["familyhub_profile_ids"];
        if (stored) { try { const p = JSON.parse(stored); if (Array.isArray(p) && p.length) { pIds = p; resolveRank = 3; } } catch { } }

        // Priority 2: creator/organizer email → connected account (normalized)
        if (!pIds.length) {
          const email = normalizeGmail(ge.creator?.email) ?? normalizeGmail(ge.organizer?.email);
          const p2 = email ? googleAccountEmailMap.get(email) : undefined;
          if (p2) { pIds = [p2]; resolveRank = 2; }
        }

        // Priority 3: match by the event's own google_calendar_id
        const gcalId = ge.extendedProperties?.private?.["google_calendar_id"];
        if (!pIds.length && gcalId) {
          const a = calendarAssignments.find((a: any) => a.calendarId === gcalId && a.calendarType === "google");
          if (a) pIds = assignmentProfileIds(a);
        }

        // Priority 4: fall back to the iterating profile
        if (!pIds.length) pIds = [pid];

        const existing = bestByKey.get(key);
        if (!existing || resolveRank > existing.resolveRank) {
          bestByKey.set(key, { ge, pIds, resolveRank, pid });
        }
      }
    });

    for (const { ge, pIds, pid } of bestByKey.values()) {
      const gcalId = ge.extendedProperties?.private?.["google_calendar_id"];
      // parseGoogleEventDates handles the all-day EXCLUSIVE end date — the
      // old inline parsing made every all-day event spill onto the next day.
      const { start, end } = parseGoogleEventDates(ge);

      const gcDrivingProfileIds = driverIdsFromGoogleEvent(ge);
      result.push({
        id: `google-${ge.id}`,
        googleEventId: ge.id,
        googleProfileId: pid,
        googleCalendarId: gcalId,
        recurringEventId: ge.recurringEventId ?? null,
        title: ge.summary || "Untitled",
        startTime: start,
        endTime: end,
        profileIds: pIds,
        drivingProfileIds: gcDrivingProfileIds,
        description: ge.description,
        location: ge.location,
        isAllDay: !ge.start?.dateTime,
        source: "google",
        color: getProfileColor(pIds, profiles),
      });
    }

    // 3. Outlook Calendar
    const outProfiles = regularProfiles.filter(p => p.outlookCalendarConnected);
    outlookQueries.forEach((q, i) => {
      const pid = outProfiles[i]?.id;
      if (!pid) return;
      const known = new Set(profiles.map(p => p.id));
      for (const oe of (q.data ?? []) as any[]) {
        const oPids = outlookEventProfileIds(oe, pid, calendarAssignments as any[], known);
        result.push({
          id: `outlook-${oe.id}`,
          title: oe.subject || "Untitled",
          ...(() => { const d = parseOutlookEventDates(oe); return { startTime: d.start, endTime: d.end }; })(),
          profileIds: oPids,
          drivingProfileIds: [], // Outlook has no driver concept
          description: oe.bodyPreview,
          location: oe.location?.displayName,
          isAllDay: oe.isAllDay ?? false,
          source: "outlook",
          outlookCalendarId: oe.calendar?.id ?? null,
          color: getProfileColor(oPids, profiles),
        });
      }
    });

    // 4. iCal (.ics URL) subscriptions — read-only, assigned to a single profile.
    icalQueries.forEach((q, i) => {
      const pid = icalConnectedProfiles[i]?.id;
      if (!pid) return;
      for (const ie of (q.data ?? []) as any[]) {
        result.push({
          id: `ical-${ie.id}`,
          title: ie.title || "Untitled",
          startTime: new Date(ie.start),
          endTime: icalDisplayEnd(ie.end, ie.isAllDay ?? false, new Date(ie.start)),
          profileIds: [pid],
          drivingProfileIds: [], // iCal feeds have no driver concept
          description: ie.description,
          location: ie.location,
          isAllDay: ie.isAllDay ?? false,
          source: "ical",
          // Prefer the feed's own color if set, else the profile color.
          color: ie.calendarColor || getProfileColor([pid], profiles),
        });
      }
    });

    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEvents, googleDataSig, outlookDataSig, icalDataSig, calendarAssignments, googleAccountEmailMap, profiles, regularProfiles]);

  // ── Synthetic celebration events ────────────────────────────────────────────
  const celebRangeStart = useMemo(
    () => new Date(currentDate.getFullYear(), currentDate.getMonth() - 6, 1),
    [currentDate],
  );
  const celebRangeEnd = useMemo(
    () => new Date(currentDate.getFullYear(), currentDate.getMonth() + 7, 0, 23, 59, 59),
    [currentDate],
  );
  const { data: celebrationEvents = [] } = useCelebrationEvents(celebRangeStart, celebRangeEnd);

  const allEventsWithCelebrations = useMemo<Cal3Event[]>(() => {
    // Celebrations are single-calendar-day markers, but the server sends
    // them as UTC-instant ISO strings (dayStart/dayEnd computed via the
    // server's own — effectively UTC — local time, per
    // /api/celebrations/calendar in routes.ts). Parsing those instants
    // directly with `new Date(...)` lets the BROWSER apply its own timezone
    // offset, shifting the boundaries away from local midnight-to-midnight —
    // for anyone west of UTC this spills the event across two grid cells
    // (e.g. an Aug 19 birthday showing on both Aug 19 and Aug 20). Same bug
    // class already fixed for Google/Outlook/iCal all-day events in
    // calendarDates.ts; the fix here is the same idea — read just the UTC
    // DATE portion (the calendar day the server actually intended) and build
    // fresh LOCAL midnight/end-of-day instants for it instead.
    const celebrations: Cal3Event[] = celebrationEvents.map(c => {
      const day = c.start.slice(0, 10); // "YYYY-MM-DD", always UTC per toISOString()
      return {
        id: c.id,
        title: `🎉 ${c.title}`,
        startTime: new Date(`${day}T00:00:00`),
        endTime: new Date(`${day}T23:59:59`),
        profileIds: c.profileId ? [c.profileId] : [],
        drivingProfileIds: [],
        description: null,
        location: null,
        isAllDay: true,
        source: "local",
        color: c.type === "birthday" ? "#ec4899" : c.type === "anniversary" ? "#f43f5e" : "#8b5cf6",
      };
    });
    return [...allEvents, ...celebrations];
  }, [allEvents, celebrationEvents]);

  // ── Filter by selected profiles ──────────────────────────────────────────────
  // Which calendars sync at all is now decided server-side (selectedCalendarIds,
  // set via Settings' "Manage" picker) — there's no separate client-side
  // enable/disable filter to apply here anymore.
  const visibleEvents = useMemo(() => {
    const pickedPeople = profiles.filter((profile) => !profile.isAllFamilyProfile && selectedProfiles.includes(profile.id));
    const kidName = pickedPeople.length === 1 && (pickedPeople[0].role === "child" || pickedPeople[0].isChild) ? pickedPeople[0].name : null;
    const picked = allEventsWithCelebrations.filter(e => {
      if (selectedProfiles.length === 0) return true;
      return e.profileIds.length === 0 ||
        e.profileIds.some(id => selectedProfiles.includes(id)) ||
        e.drivingProfileIds.some(id => selectedProfiles.includes(id));
    }).filter((event) => mailVisibleToKid(event, kidName));
    return withoutUnwatched(picked, calendarAssignments);
  }, [allEventsWithCelebrations, selectedProfiles, calendarAssignments, profiles]);

  const upcomingItems = useMemo(() => {
    const familyIds = profiles.filter((profile) => !profile.isAllFamilyProfile).map((profile) => profile.id);
    const picked = profiles.filter((profile) => !profile.isAllFamilyProfile && selectedProfiles.includes(profile.id));
    const kidName = picked.length === 1 && (picked[0].role === "child" || picked[0].isChild) ? picked[0].name : null;
    const todos = openTodos(todosForHome(chores, selectedProfiles, familyIds), completions).filter((todo) => mailVisibleToKid(todo, kidName)).map((todo) => ({
      id: todo.id,
      title: todo.title,
      startTime: currentDate,
      kind: upcomingKindForMail(todo.category),
      profileIds: todo.profileIds,
      source: null,
    }));
    const events = visibleEvents.filter((event) => mailVisibleToKid(event, kidName)).map((event) => (
      event.source === "school" ? { ...event, kind: "newsletter" as const } : event
    ));
    return [...events, ...todos];
  }, [chores, completions, currentDate, profiles, selectedProfiles, visibleEvents]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createEventMutation = useMutation({
    mutationFn: async (data: InsertEvent) => {
      const r = await apiRequest("POST", "/api/events", data);
      return r.json();
    },
    onSuccess: (saved) => {
      // Show it immediately, then reconcile — see lib/eventCache.ts.
      applySavedEventToCache(qc, saved);
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event created successfully!" });
      resetForm();
      // Strictly after the fact, and self-contained: offers to also track a
      // "…'s Birthday" event in Celebrations. Never blocks or alters the
      // save above (see use-celebration-suggestion.tsx).
      void suggestCelebration(saved);
    },
    onError: (error: any) => toast({ title: error?.message || "Failed to create event", variant: "destructive" }),
  });

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, eventData, scope, occurrenceStart }: {
      id: string; eventData: any;
      scope?: "series" | "occurrence" | "future"; occurrenceStart?: string;
    }) => {
      const r = await apiRequest("PATCH", `/api/events/${id}`, { ...eventData, scope, occurrenceStart });
      return r.json();
    },
    onSuccess: (saved) => {
      applySavedEventToCache(qc, saved);
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event updated successfully!" });
      resetForm();
    },
    onError: (error: any) => toast({ title: error?.message || "Failed to update event", variant: "destructive" }),
  });

  // Dragging an event to a new time. Separate from updateEventMutation because
  // that one closes the edit form on success — nothing is open here, and
  // resetting a form the user never opened would clear a half-typed one.
  const rescheduleEventMutation = useMutation({
    mutationFn: async ({ id, startTime, endTime, scope, occurrenceStart }: {
      id: string; startTime: string; endTime: string;
      scope?: "occurrence" | "future"; occurrenceStart?: string;
    }) => {
      const r = await apiRequest("PATCH", `/api/events/${id}`, { startTime, endTime, scope, occurrenceStart });
      return r.json();
    },
    // Move it in the cache before the round trip. Without this the block has
    // nowhere correct to go the moment the drag lets go — the event still
    // holds its old time until the server answers, which is the ~500ms
    // snap-back measured on 2026-09-12. Only the plain "move this event" case
    // is safe to predict: a detach or a series split changes which rows exist,
    // and guessing at that would show a shape the server never agreed to.
    onMutate: ({ id, startTime, endTime, scope }) => {
      if (scope) return;
      qc.setQueryData(["/api/events"], (prev: any) =>
        Array.isArray(prev)
          ? prev.map((e: any) => (e?.id === id ? { ...e, startTime, endTime } : e))
          : prev);
    },
    onSuccess: (saved) => {
      applySavedEventToCache(qc, saved);
      qc.invalidateQueries({ queryKey: ["/api/events"] });
    },
    onError: (error: any) => {
      // Put the event back where it was: the optimistic move above is the only
      // thing showing the new time, so leaving it there after a failed save
      // would show a time the server does not have.
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: error?.message || "Couldn't move the event", variant: "destructive" });
    },
  });

  const handleReschedule = useCallback(async (ev: Cal3Event, deltaMinutes: number) => {
    if (!deltaMinutes) return;
    const startTime = new Date(ev.startTime.getTime() + deltaMinutes * 60_000);
    const endTime = new Date(ev.endTime.getTime() + deltaMinutes * 60_000);
    const at = format(startTime, "h:mm a");

    // A one-off event just moves. Anything that repeats has to be asked about
    // — moving Tuesday's practice and silently moving every Tuesday after it
    // is the kind of thing people only notice a week later.
    if (!ev.recurrenceType) {
      // Awaited so the caller holds the block at the dropped spot until the
      // move is actually in the cache. onMutate puts it there almost at once;
      // awaiting also means a failure releases the block only after the
      // refetch has restored the truth, instead of flashing through a
      // position nothing agrees with.
      await rescheduleEventMutation.mutateAsync({
        id: ev.localId ?? ev.id, startTime: startTime.toISOString(), endTime: endTime.toISOString(),
      }).catch(() => {});
      toast({ title: `Moved to ${at}` });
      return;
    }

    const choice = await chooseDialog({
      title: `Move to ${at}?`,
      description: "This event repeats.",
      options: [
        { value: "occurrence", label: "This event only", description: "Just this one. The rest of the series stays where it is." },
        { value: "future", label: "This and all following", description: "Everything from this one onward moves. Earlier ones stay." },
      ],
      cancelLabel: "Don't move it",
    });
    if (!choice) {
      // Cancelled — the block is sitting at the dragged position optimistically,
      // so put it back rather than leaving it somewhere nothing agrees with.
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      return;
    }
    await rescheduleEventMutation.mutateAsync({
      id: ev.id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      scope: choice as "occurrence" | "future",
      occurrenceStart: ev.startTime.toISOString(),
    }).catch(() => {});
    // Say what just happened to the event's relationship with its series.
    // After "this event only" it is a standalone event, so dragging it again
    // asks nothing — correct, but baffling unless someone says so (reported
    // 2026-09-13 as "it won't ask again").
    toast({
      title: choice === "future" ? `This and all following moved to ${at}` : `Moved to ${at}`,
      description: choice === "occurrence"
        ? "This one is now a separate event, so it won't follow the series."
        : undefined,
    });
  }, [rescheduleEventMutation, toast, qc]);

  const deleteEventMutation = useMutation({
    mutationFn: async ({ id, scope, occurrenceStart }: {
      id: string; scope?: "series" | "occurrence" | "future"; occurrenceStart?: string;
    }) => {
      const q = scope && scope !== "series" && occurrenceStart
        ? `?scope=${scope}&occurrenceStart=${encodeURIComponent(occurrenceStart)}`
        : "";
      await apiRequest("DELETE", `/api/events/${id}${q}`);
      return { id, scope };
    },
    onSuccess: ({ id, scope }) => {
      // Only a whole-series delete removes the row. The narrowing scopes leave
      // it in place with one date excluded (or an earlier end), so dropping it
      // from the cache would hide a series that still exists until the next
      // refetch brought it back.
      if (!scope || scope === "series") removeEventFromCache(qc, id);
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: scope === "occurrence" ? "That one's deleted"
          : scope === "future" ? "This and all following deleted"
          : "Event deleted successfully!",
      });
      resetForm();
    },
    onError: (error: any) => toast({ title: error?.message || "Failed to delete event", variant: "destructive" }),
  });

  const updateGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId, eventData }: {
      profileId: string; calendarId: string; eventId: string; eventData: any;
    }) => {
      const r = await apiRequest("PATCH", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`, eventData);
      return { saved: await r.json(), eventId, eventData };
    },
    onSuccess: ({ eventId, eventData }) => {
      // Refetching a Google event means a round-trip all the way to Google, so
      // patch the assignment we just saved into the cache first.
      if (eventData?.profileIds !== undefined) {
        applyGoogleAssignmentToCache(qc, {
          eventId,
          recurringEventId: eventData.recurringEventId ?? null,
          applyToSeries: !!eventData.applyToSeries,
          occurrenceStart: eventData.occurrenceStart ?? null,
          profileIds: eventData.profileIds,
          drivingProfileIds: eventData.drivingProfileIds ?? [],
        });
      }
      qc.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
      toast({ title: "Google Calendar event updated successfully!" });
      resetForm();
    },
    onError: () => toast({ title: "Failed to update Google Calendar event", variant: "destructive" }),
  });

  const deleteGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId }: {
      profileId: string; calendarId: string; eventId: string;
    }) => {
      await apiRequest("DELETE", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
      toast({ title: "Google Calendar event deleted successfully!" });
      resetForm();
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to delete Google Calendar event", variant: "destructive" }),
  });

  // ── Scroll to start hour (or current time if within range) on load ──────────
  useEffect(() => {
    if (scrollRef.current && viewMode !== "month") {
      const now = new Date();
      const nowH = getHours(now) + getMinutes(now) / 60;
      // Scroll to current time if visible, otherwise scroll to display start
      const targetHour = (nowH >= displayStartHour && nowH <= displayEndHour) ? nowH : displayStartHour;
      const offsetFromGridStart = targetHour - displayStartHour;
      const px = offsetFromGridStart * hourHeight - 60;
      scrollRef.current.scrollTop = Math.max(0, px);
    }
  }, [viewMode, displayStartHour, displayEndHour, hourHeight]);

  // ── Date range for current view ─────────────────────────────────────────────
  const { viewStart, viewEnd, headerDays } = useMemo(() => {
    let start: Date, end: Date, days: Date[];
    if (viewMode === "day") {
      start = startOfDay(currentDate);
      end = start;
      days = [start];
    } else if (viewMode === "workweek") {
      start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Mon
      end = addDays(start, 4); // Fri
      days = eachDayOfInterval({ start, end });
    } else if (viewMode === "week") {
      start = startOfWeek(currentDate, { weekStartsOn });
      end = endOfWeek(currentDate, { weekStartsOn });
      days = eachDayOfInterval({ start, end });
    } else {
      // month
      start = startOfWeek(startOfMonth(currentDate), { weekStartsOn });
      end = endOfWeek(endOfMonth(currentDate), { weekStartsOn });
      days = eachDayOfInterval({ start, end });
    }
    return { viewStart: start, viewEnd: end, headerDays: days };
  }, [viewMode, currentDate, weekStartsOn]);

  // ── Navigate ───────────────────────────────────────────────────────────────
  const goNext = () => {
    if (viewMode === "day" || viewMode === "upcoming") setCurrentDate(addDays(currentDate, viewMode === "upcoming" ? 30 : 1));
    else if (viewMode === "workweek" || viewMode === "week") setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addMonths(currentDate, 1));
  };
  const goPrev = () => {
    if (viewMode === "day" || viewMode === "upcoming") setCurrentDate(subDays(currentDate, viewMode === "upcoming" ? 30 : 1));
    else if (viewMode === "workweek" || viewMode === "week") setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subMonths(currentDate, 1));
  };
  const goToday = () => setCurrentDate(new Date());
  // Swiping in from the screen edge moves by one unit of whatever's currently
  // shown (a day in Day view, a week in Week/Work Week, a month in Month).
  useEdgeSwipeDateNav(goPrev, goNext);

  // Exposes view-aware prev/next to the persistent header nav in
  // family-hub.tsx, so its single set of arrows steps by day/week/month
  // depending on Calendar's current view instead of always by a literal day.
  useImperativeHandle(ref, () => ({ goPrev, goNext }), [goPrev, goNext]);

  // ── Filter events for a day ─────────────────────────────────────────────────
  // An event belongs to EVERY day its start→end range touches, not just its
  // start day — a Jul 13–17 camp must show on the 14th, 15th, 16th, and 17th
  // too. An end that lands exactly on midnight is treated as belonging to the
  // previous day (an 8pm–12am event is a one-day event, not a two-day one).
  const effectiveEnd = (e: Cal3Event) => {
    const end = e.endTime.getTime();
    return end > e.startTime.getTime() && end === startOfDay(e.endTime).getTime()
      ? new Date(end - 1)
      : e.endTime;
  };
  const overlapsDay = useCallback((e: Cal3Event, day: Date) => {
    if (isSameDay(e.startTime, day)) return true;
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    return e.startTime < dayEnd && effectiveEnd(e) >= dayStart;
  }, []);
  // Multi-day TIMED events render as banners in the all-day strip (like
  // Google/Apple Calendar) rather than as a full-height column on each day —
  // the time grid's hour math only makes sense within a single day.
  const spansMultipleDays = (e: Cal3Event) => !isSameDay(e.startTime, effectiveEnd(e));

  const eventsForDay = useCallback((day: Date) =>
    visibleEvents.filter(e => overlapsDay(e, day)),
    [visibleEvents, overlapsDay]
  );

  const allDayEventsForDay = useCallback((day: Date) =>
    visibleEvents.filter(e => (e.isAllDay || spansMultipleDays(e)) && overlapsDay(e, day)),
    [visibleEvents, overlapsDay]
  );

  const timedEventsForDay = useCallback((day: Date) =>
    visibleEvents.filter(e => !e.isAllDay && !spansMultipleDays(e) && isSameDay(e.startTime, day)),
    [visibleEvents]
  );

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setFormData({ title: "", description: "", location: "", profileIds: defaultProfileIds(), isAllDay: false, drivingProfileIds: [], recurrenceType: "none", recurrenceEndDate: null, recurrenceInterval: 1, daysOfWeek: [] });
    setSelectedSlot(null);
    setSelectedEvent(null);
    setShowEventModal(false);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSlotClick = (time: Date) => {
    const end = new Date(time.getTime() + 60 * 60 * 1000);
    setSelectedEvent(null);
    setSelectedSlot({ start: time, end });
    setFormData({ title: "", description: "", location: "", profileIds: defaultProfileIds(), isAllDay: false, drivingProfileIds: [], recurrenceType: "none", recurrenceEndDate: null, recurrenceInterval: 1, daysOfWeek: [] });
    setShowEventModal(true);
  };

  const handleEventClick = (ev: Cal3Event) => {
    // Celebrations are read-only synthetic events; managed on the Celebrations page.
    if (isCelebrationEventId(ev.id)) {
      toast({
        title: "Managed in Celebrations",
        description: "Edit birthdays and anniversaries there.",
        action: (
          <ToastAction altText="Open Celebrations" onClick={() => setShowCelebrations(true)}>
            Open Celebrations
          </ToastAction>
        ),
      });
      return;
    }
    // Build a selectedEvent object shaped for EventModal
    // The series' own first occurrence, so the modal can say WHEN it began —
    // "go to the original" is useless advice for a series that started months
    // ago if nobody says which day that was (2026-09-13).
    const seriesStart = ev.seriesId
      ? allEvents.find(e => (e.localId ?? e.id) === ev.seriesId)?.startTime ?? null
      : null;
    setSelectedEvent({
      ...ev,
      seriesStartTime: seriesStart,
      id: ev.localId ?? ev.id,
      isGoogleCalendar: ev.source === "google",
      googleEventId: ev.googleEventId ?? null,
      googleProfileId: ev.googleProfileId ?? null,
      googleCalendarId: ev.googleCalendarId ?? null,
      googleCalendarName: null,
      recurringEventId: ev.recurringEventId ?? null,
      startTime: ev.startTime,
    });
    setFormData({
      title: ev.title,
      description: ev.description ?? "",
      location: ev.location ?? "",
      profileIds: ev.profileIds ?? [],
      isAllDay: ev.isAllDay,
      drivingProfileIds: ev.drivingProfileIds ?? [],
      recurrenceType: ev.recurrenceType ?? "none",
      recurrenceEndDate: ev.recurrenceEndDate ?? null,
      recurrenceInterval: ev.recurrenceInterval ?? 1,
      daysOfWeek: ev.daysOfWeek ?? [],
    });
    setSelectedSlot({ start: ev.startTime, end: ev.endTime });
    setShowEventModal(true);
  };

  // Open event modal when navigated here from an announcement "View Event" link
  useEffect(() => {
    if (!pendingOpenEventId || allEvents.length === 0) return;
    const ev = allEvents.find(
      (e) => e.localId === pendingOpenEventId || e.id === pendingOpenEventId
    );
    if (ev) {
      handleEventClick(ev);
      onPendingEventOpened?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenEventId, allEvents]);

  const submitGoogleEventUpdate = (eventData: any, applyToSeries: boolean) => {
    if (!selectedEvent) return;
    updateGoogleEventMutation.mutate({
      profileId: selectedEvent.googleProfileId,
      calendarId: selectedEvent.googleCalendarId,
      eventId: selectedEvent.googleEventId,
      eventData: { ...eventData, applyToSeries },
    });
  };

  const handleEditEventSubmit = async (_e: React.FormEvent) => {
    if (!selectedEvent) return;
    if (!formData.title.trim()) {
      toast({ title: "Please enter an event title", variant: "destructive" }); return;
    }
    if (!selectedSlot) {
      toast({ title: "Please select a time slot", variant: "destructive" }); return;
    }
    if (selectedEvent.isGoogleCalendar && selectedEvent.googleEventId) {
      const eventData: any = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        location: formData.location.trim() || null,
        start: selectedSlot.start,
        end: selectedSlot.end,
        // Driving an event implies attending it, so drivers are merged into the
        // assignee list on save. This is also what makes the event sync to each
        // driver's own calendar — the sync mirrors assignees, not drivers.
        profileIds: formData.profileIds,
        drivingProfileIds: formData.drivingProfileIds,
        recurringEventId: selectedEvent.recurringEventId ?? null,
        occurrenceStart: selectedEvent.startTime
          ? new Date(selectedEvent.startTime).toISOString()
          : null,
      };

      // Did the assignee (or driver) actually change? Only then is the
      // "this occurrence vs. the whole series" choice meaningful.
      const prevIds = [...(selectedEvent.profileIds ?? [])].sort();
      const nextIds = [...formData.profileIds].sort();
      const assignmentChanged =
        prevIds.length !== nextIds.length ||
        prevIds.some((id, i) => id !== nextIds[i]) ||
        !sameIds(selectedEvent.drivingProfileIds ?? [], formData.drivingProfileIds);

      if (selectedEvent.recurringEventId && assignmentChanged) {
        // Defer the save until the user picks a scope in the dialog.
        setRecurringScope({ eventData });
        return;
      }

      submitGoogleEventUpdate(eventData, false);
    } else {
      // A local event that repeats gets the same three-way question Google's
      // already had. Asked BEFORE the save, because the answer decides whether
      // this becomes a detached copy, a split, or a plain edit.
      let scope: "series" | "occurrence" | "future" = "series";
      if (selectedEvent.recurrenceType) {
        const choice = await chooseDialog({
          title: "This event repeats",
          description: "Which ones should this change apply to?",
          options: [
            { value: "occurrence", label: "This event only", description: "The rest of the series is left alone." },
            { value: "future", label: "This and all following", description: "Earlier ones stay as they are." },
            { value: "series", label: "The whole series", description: "Every occurrence, past and future." },
          ],
          cancelLabel: "Cancel",
        });
        if (!choice) return;
        scope = choice as typeof scope;
      }
      updateEventMutation.mutate({
        id: selectedEvent.id,
        scope,
        occurrenceStart: selectedEvent.startTime ? new Date(selectedEvent.startTime).toISOString() : undefined,
        eventData: {
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          location: formData.location.trim() || null,
          startTime: selectedSlot.start,
          endTime: selectedSlot.end,
          profileIds: formData.profileIds,
          isAllDay: formData.isAllDay,
          drivingProfileIds: formData.drivingProfileIds,
          calendarId: null,
          calendarName: null,
          recurrenceType: formData.recurrenceType === "none" ? null : formData.recurrenceType,
          recurrenceEndDate: formData.recurrenceEndDate ? new Date(formData.recurrenceEndDate) : null,
          recurrenceInterval: formData.recurrenceType === "none" ? 1 : (formData.recurrenceInterval ?? 1),
          // Only weekly carries ticked days; sending them for a monthly rule
          // would leave a stale BYDAY on the row if the type changed later.
          daysOfWeek: formData.recurrenceType === "weekly" && (formData.daysOfWeek?.length ?? 0) > 0
            ? formData.daysOfWeek : null,
        },
      });
    }
  };

  const handleAddEventSubmit = async (_e: React.FormEvent) => {
    if (!formData.title.trim()) {
      toast({ title: "Please enter an event title", variant: "destructive" }); return;
    }
    if (!selectedSlot) {
      toast({ title: "Please select a time slot", variant: "destructive" }); return;
    }
    createEventMutation.mutate({
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      location: formData.location.trim() || null,
      startTime: selectedSlot.start,
      endTime: selectedSlot.end,
      profileIds: formData.profileIds,
      isAllDay: formData.isAllDay,
      drivingProfileIds: formData.drivingProfileIds,
      calendarId: null,
      calendarName: null,
      recurrenceType: formData.recurrenceType === "none" ? null : formData.recurrenceType,
      recurrenceEndDate: formData.recurrenceEndDate ? new Date(formData.recurrenceEndDate) : null,
      recurrenceInterval: formData.recurrenceType === "none" ? 1 : (formData.recurrenceInterval ?? 1),
      daysOfWeek: formData.recurrenceType === "weekly" && (formData.daysOfWeek?.length ?? 0) > 0
        ? formData.daysOfWeek : null,
    } as InsertEvent);
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    if (selectedEvent.isGoogleCalendar && selectedEvent.googleEventId) {
      // Google events previously deleted with no barrier at all.
      if (!(await confirmDialog({ title: "Delete this event?", description: "It will also be removed from the connected Google Calendar.", confirmLabel: "Delete event" }))) return;
      deleteGoogleEventMutation.mutate({
        profileId: selectedEvent.googleProfileId,
        calendarId: selectedEvent.googleCalendarId,
        eventId: selectedEvent.googleEventId,
      });
    } else {
      const isPartOfSeries = selectedEvent.isRecurringInstance || !!selectedEvent.recurrenceType;
      if (isPartOfSeries) {
        // The same three choices editing offers. Deleting only ever removed
        // the whole series, so dropping one cancelled week meant losing the
        // rest of the year (reported 2026-09-13).
        const choice = await chooseDialog({
          title: "Delete this repeating event?",
          description: "Which ones should go?",
          options: [
            { value: "occurrence", label: "This event only", description: "The rest of the series stays." },
            { value: "future", label: "This and all following", description: "Earlier ones stay as they are." },
            { value: "series", label: "The whole series", description: "Every occurrence, past and future.", destructive: true },
          ],
          cancelLabel: "Keep it",
        });
        if (!choice) return;
        deleteEventMutation.mutate({
          id: selectedEvent.id,
          scope: choice as "series" | "occurrence" | "future",
          occurrenceStart: selectedEvent.startTime ? new Date(selectedEvent.startTime).toISOString() : undefined,
        });
        return;
      }
      if (!(await confirmDialog({ title: "Delete this event?", confirmLabel: "Delete event" }))) return;
      deleteEventMutation.mutate({ id: selectedEvent.id });
    }
  };

  // ── Render title ────────────────────────────────────────────────────────────
  const headerTitle = useMemo(() => {
    if (viewMode === "upcoming") return "Upcoming";
    if (viewMode === "day") return format(currentDate, "EEEE, MMMM d, yyyy");
    if (viewMode === "month") return format(currentDate, "MMMM yyyy");
    const start = viewMode === "workweek"
      ? startOfWeek(currentDate, { weekStartsOn: 1 })
      : startOfWeek(currentDate, { weekStartsOn });
    const end = viewMode === "workweek" ? addDays(start, 4) : endOfWeek(currentDate, { weekStartsOn });
    if (format(start, "MMMM yyyy") === format(end, "MMMM yyyy"))
      return `${format(start, "MMMM d")} – ${format(end, "d, yyyy")}`;
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }, [viewMode, currentDate, weekStartsOn]);

  // ── Mobile week strip days ──────────────────────────────────────────────────
  const weekDaysForStrip = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [currentDate, weekStartsOn]);

  // ── Sidebar content — shared between the inline desktop/tablet column and
  //    the mobile Sheet drawer below ──────────────────────────────────────────
  const sidebarContent = (
    <>
      <MiniCalendar
        date={currentDate}
        onSelect={d => { setCurrentDate(d); if (viewMode === "month") {} else setViewMode("day"); if (isMobile) setShowSidebar(false); }}
        weekStartsOn={weekStartsOn}
      />

      {/* Calendar legend */}
      {regularProfiles.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Calendars
          </p>
          <div className="space-y-1.5">
            {regularProfiles.map(p => (
              <div key={p.id} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-xs text-foreground truncate">{p.name}</span>
                {p.googleCalendarConnected && (
                  <span className="text-[9px] text-muted-foreground ml-auto">Google</span>
                )}
                {p.outlookCalendarConnected && (
                  <span className="text-[9px] text-muted-foreground ml-auto">Outlook</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Celebrations shortcut */}
      <button
        onClick={() => { setShowCelebrations(true); if (isMobile) setShowSidebar(false); }}
        className="flex items-center gap-2 w-full text-xs text-foreground hover:bg-accent/50 rounded-md px-2 py-1.5"
        data-testid="open-celebrations-button"
      >
        <PartyPopper className="w-3.5 h-3.5 text-violet-600" />
        Celebrations
      </button>
    </>
  );

  // ── All-day events strip ────────────────────────────────────────────────────
  const hasAllDay = headerDays.some(d => allDayEventsForDay(d).length > 0);

  // ── Time grid view ──────────────────────────────────────────────────────────
  const timeGridView = viewMode !== "month" && viewMode !== "upcoming";

  return (
    <TooltipProvider>
      <div className="flex flex-col h-[calc(100svh-172px)] bg-[#dce8f2] dark:bg-[#1e2633] rounded-xl border border-[#2a2a2a] dark:border-border shadow-sm overflow-hidden">

        {/* ── External-calendar sync-error banners ── */}
        {/* Tappable: takes you straight to Settings' Calendar section (and,
            when we know which profile is affected, auto-expands that
            person's row) instead of just naming where to go and leaving you
            to find it yourself. */}
        {googleSyncError && (
          <button
            type="button"
            onClick={() => onOpenCalendarSettings?.(googleErrorProfileId)}
            className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm flex-shrink-0 text-left hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
            data-testid="google-sync-error-banner"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Google Calendar couldn't sync. Tap to reconnect it in Settings.</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          </button>
        )}
        {outlookSyncError && (
          <button
            type="button"
            onClick={() => onOpenCalendarSettings?.(outlookErrorProfileId)}
            className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm flex-shrink-0 text-left hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
            data-testid="outlook-sync-error-banner"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Outlook Calendar couldn't sync. Tap to reconnect it in Settings.</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          </button>
        )}
        {icalSyncError && (
          <button
            type="button"
            onClick={() => onOpenCalendarSettings?.()}
            className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm flex-shrink-0 text-left hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
            data-testid="ical-sync-error-banner"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">A subscribed calendar feed couldn't load. Tap to check it in Settings.</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          </button>
        )}

        {/* ── Toolbar ── */}
        {/* Mobile gets a deliberate two-row layout instead of letting the
            single desktop row wrap unpredictably. That row packs 7 controls
            (sidebar, new event, title, view switcher, zoom, celebrations,
            settings) — on a phone-width screen there simply isn't room for
            all of them plus a readable month/year title, so `flex-wrap`
            left the title clipped to "Aug 2…" and orphaned whichever
            control didn't fit (the settings gear) onto its own line with no
            visual grouping. Splitting into two intentional rows guarantees
            the title always gets the full row width and every control lands
            somewhere deliberate, not wherever it happened to wrap to. */}
        {isMobile ? (
          <div className="border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] flex-shrink-0">
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSidebar(s => !s)}
                className="h-9 w-9 p-0 rounded-full shrink-0"
                title={showSidebar ? "Hide sidebar" : "Show sidebar"}
              >
                <PanelLeft className="w-4 h-4 text-muted-foreground" />
              </Button>
              {/* One month display, in the toolbar, in every view — Month
                  view used to hide this and show its own strip below the
                  toolbar instead, so the month moved between two places
                  depending on the view. The arrows here are view-aware
                  (goPrev/goNext step a day in Day view, a month in Month
                  view), which is what the removed strip provided. */}
              <button
                onClick={goPrev}
                className="p-1.5 rounded-full hover:bg-accent shrink-0"
                aria-label="Previous"
                data-testid="cal-toolbar-prev"
              >
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
              <h2 className="flex-1 text-base font-semibold text-foreground text-center truncate">
                {format(currentDate, "MMMM yyyy")}
              </h2>
              <button
                onClick={goNext}
                className="p-1.5 rounded-full hover:bg-accent shrink-0"
                aria-label="Next"
                data-testid="cal-toolbar-next"
              >
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              {/* h-9 w-9 p-0, not p-2: `size="sm"` fixes the height at h-9
                  (36px) while p-2 only narrows the width to 32px, so a
                  rounded-full icon button rendered as a visibly elongated
                  pill rather than a circle. */}
              <Button
                size="sm"
                onClick={() => {
                  const slot = new Date(currentDate);
                  slot.setHours(new Date().getHours(), 0, 0, 0);
                  handleSlotClick(slot);
                }}
                className="h-9 w-9 p-0 rounded-full shadow-sm shrink-0"
                title="New event"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex items-center rounded-lg border border-[#b0bec8] dark:border-border overflow-hidden bg-[#dce8f2] dark:bg-[#1e2633] shrink-0">
                {(["upcoming", "week", "month"] as ViewMode[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setViewModePersisted(v)}
                    aria-pressed={viewMode === v}
                    className={`px-2.5 py-1.5 text-xs border-r border-[#b0bec8] dark:border-border last:border-0 transition-colors ${
                      viewMode === v
                        ? "bg-primary text-primary-foreground font-bold shadow-sm"
                        : "font-medium hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === "upcoming" ? "Upcoming" : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              {timeGridView && (
                <div className="flex items-center rounded-lg border border-[#b0bec8] dark:border-border overflow-hidden bg-[#dce8f2] dark:bg-[#1e2633] shrink-0">
                  <button
                    onClick={() => adjustZoom(-0.25)}
                    disabled={zoomLevel <= 0.5}
                    className="px-2 py-1.5 hover:bg-accent disabled:opacity-40 transition-colors"
                    title="Zoom out"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => adjustZoom(0.25)}
                    disabled={zoomLevel >= 2.0}
                    className="px-2 py-1.5 hover:bg-accent disabled:opacity-40 transition-colors"
                    title="Zoom in"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Utilities grouped behind a divider so the row reads as
                  [view modes] · [zoom] | [utilities] rather than four icons
                  distributed by whatever space was left. Both carry real
                  labels — they're icon-only, and title= never shows on touch. */}
              <div className="flex items-center gap-1 ml-auto shrink-0 pl-1 border-l border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCelebrations(true)}
                  className="h-9 w-9 p-0 rounded-full"
                  title="Celebrations"
                  aria-label="Celebrations"
                  data-testid="open-celebrations-toolbar-button"
                >
                  <PartyPopper className="w-4 h-4 text-violet-500" />
                </Button>
                {/* Month view has two shapes on a phone — title rows, or one
                    dot per person with the day's list below. The switch lives
                    up here rather than inside either view so it is in the same
                    place whichever one you are looking at, and reachable
                    without scrolling the grid.

                    Shown only where it does something: month view, phone
                    width. A button that silently changed a screen you are not
                    on would be worse than no button.

                    The icon is the view you would GET, matching how the rest
                    of this toolbar reads — every other icon here names its
                    destination. */}
                {viewMode === "month" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => chooseMonthStyle(monthStyle === "dots" ? "titles" : "dots")}
                    className="h-9 w-9 p-0 rounded-full"
                    title={monthStyle === "dots" ? "Show event titles" : "Show dots"}
                    aria-label={monthStyle === "dots" ? "Show event titles" : "Show dots"}
                    data-testid="month-style-toggle"
                    data-mode={monthStyle}
                  >
                    {monthStyle === "dots"
                      ? <LayoutList className="w-4 h-4 text-muted-foreground" />
                      : <Grip className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => guardParentAction("calendarSettings", () => setShowSettingsModal(true))}
                  className="h-9 w-9 p-0 rounded-full"
                  title="Calendar Settings"
                  aria-label="Calendar settings"
                >
                  <Settings className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] flex-shrink-0 flex-wrap">
          {/* Sidebar toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSidebar(s => !s)}
            className="h-9 w-9 p-0 rounded-full"
            title={showSidebar ? "Hide sidebar" : "Show sidebar"}
          >
            <PanelLeft className="w-4 h-4 text-muted-foreground" />
          </Button>

          {/* New event */}
          <Button
            size="sm"
            onClick={() => {
              // Use the date currently being viewed (not always today) — keep
              // the current hour as the default start time either way.
              const slot = new Date(currentDate);
              slot.setHours(new Date().getHours(), 0, 0, 0);
              handleSlotClick(slot);
            }}
            className="gap-1.5 rounded-full px-4 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New event</span>
          </Button>

          {/* Date navigation lives in the persistent header nav above this
              card now (family-hub.tsx) — it drives this same selectedDate,
              stepping by whatever unit (day/week/month) this view's
              goPrev/goNext use, via the exposed ref handle. A second,
              disconnected set of arrows/Today here would just be a
              duplicate control. */}

          {/* Title — abbreviated on tablet, full on desktop (mobile has its
              own row above with the full month name). */}
          <h2 className="flex-1 text-base font-semibold text-foreground truncate min-w-[3.5rem]">
            {isTablet ? format(currentDate, "MMMM yyyy") : headerTitle}
          </h2>

          {/* View switcher — abbreviated on tablet, full on desktop */}
          <div className="flex items-center rounded-lg border border-[#b0bec8] dark:border-border overflow-hidden bg-[#dce8f2] dark:bg-[#1e2633]">
            {(["upcoming", "day", "workweek", "week", "month"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewModePersisted(v)}
                aria-pressed={viewMode === v}
                className={`px-2.5 py-1.5 text-xs border-r border-[#b0bec8] dark:border-border last:border-0 transition-colors ${
                  viewMode === v
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "font-medium hover:bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {isTablet
                  ? ({ upcoming: "Up", day: "Day", workweek: "W.Wk", week: "Week", month: "Mo" }[v])
                  : (v === "workweek" ? "Work week" : v === "upcoming" ? "Upcoming" : v.charAt(0).toUpperCase() + v.slice(1))
                }
              </button>
            ))}
          </div>

          {/* Zoom controls — hidden on Month view since there's no time grid
              there for zoom to affect. */}
          {!isTablet && timeGridView && (
            <div className="flex items-center rounded-lg border border-[#b0bec8] dark:border-border overflow-hidden bg-[#dce8f2] dark:bg-[#1e2633]">
              <button
                onClick={() => adjustZoom(-0.25)}
                disabled={zoomLevel <= 0.5}
                className="px-2 py-1.5 hover:bg-accent disabled:opacity-40 transition-colors"
                title="Zoom out"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="px-1.5 text-xs text-muted-foreground select-none w-10 text-center tabular-nums">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => adjustZoom(0.25)}
                disabled={zoomLevel >= 2.0}
                className="px-2 py-1.5 hover:bg-accent disabled:opacity-40 transition-colors"
                title="Zoom in"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Celebrations */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCelebrations(true)}
            className="h-9 w-9 p-0 rounded-full"
            title="Celebrations"
            data-testid="open-celebrations-toolbar-button"
          >
            <PartyPopper className="w-4 h-4 text-violet-500" />
          </Button>

          {/* Settings */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => guardParentAction("calendarSettings", () => setShowSettingsModal(true))}
            className="h-9 w-9 p-0 rounded-full"
            title="Calendar Settings"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
        )}

        {/* ── Mobile week strip (iOS-style, shown only on small screens) ── */}
        {isMobile && viewMode === "day" && (
          <div className="border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] px-1 py-2 flex-shrink-0">
            <div className="flex items-center">
              <button
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
                className="p-1.5 rounded-full hover:bg-accent flex-shrink-0"
              >
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>

              <div className="flex flex-1 justify-around">
                {weekDaysForStrip.map(day => {
                  const hasDot = visibleEvents.some(e => overlapsDay(e, day));
                  const isCurrent = isSameDay(day, currentDate);
                  const isTodayDay = isToday(day);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setCurrentDate(day)}
                      className="flex flex-col items-center gap-0.5 py-0.5 px-0.5"
                    >
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wide ${
                          isTodayDay ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {format(day, "EEEEE")}
                      </span>
                      <span
                        className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium transition-colors ${
                          isCurrent
                            ? "bg-primary text-primary-foreground font-bold"
                            : isTodayDay
                              ? "border-2 border-primary text-primary font-semibold"
                              : "text-foreground hover:bg-accent"
                        }`}
                      >
                        {format(day, "d")}
                      </span>
                      <div
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          hasDot
                            ? isCurrent
                              ? "bg-primary-foreground"
                              : "bg-primary"
                            : "bg-transparent"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
                className="p-1.5 rounded-full hover:bg-accent flex-shrink-0"
              >
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}


        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar — inline column on desktop/tablet, slide-in Sheet drawer
              on mobile (an inline flex column would be too wide for a phone
              screen; previously it was just disabled outright on mobile,
              so the toggle button did nothing when tapped). */}
          {showSidebar && !isMobile && (
            <div className="w-56 flex-shrink-0 border-r border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] p-3 space-y-4 overflow-y-auto">
              {sidebarContent}
            </div>
          )}

          {isMobile && (
            <Sheet open={showSidebar} onOpenChange={setShowSidebar}>
              {/* The sheet's own close X is absolutely positioned at
                  top: calc(1rem + safe-area) / right: 1rem, so on a notched
                  phone it lands right on the mini calendar's next-month caret
                  (both sit at the top-right).
                  ⚠️ A `pt-*` CLASS cannot fix this: SheetContent sets
                  `paddingTop: env(safe-area-inset-top)` as an INLINE style, and
                  inline wins over any class for the same property — an earlier
                  `pt-10` here was silently inert, which is why the caret stayed
                  jammed under the X. A caller's own `style` is merged after the
                  safe-area one, so the clearance has to be expressed there and
                  has to re-add the inset itself.
                  2.75rem = the X's own 1rem offset + its 1rem box + ~0.75rem gap. */}
              <SheetContent
                side="left"
                className="w-64 p-3 space-y-4 overflow-y-auto"
                style={{ paddingTop: "calc(2.75rem + env(safe-area-inset-top, 0px))" }}
              >
                <SheetHeader>
                  <SheetTitle className="text-sm">Calendar</SheetTitle>
                </SheetHeader>
                {sidebarContent}
              </SheetContent>
            </Sheet>
          )}

          {/* Main calendar area */}
          <div className="flex-1 flex flex-col min-w-0">
            {viewMode === "upcoming" && (
              <div data-testid="upcoming-agenda" className="flex-1 overflow-y-auto bg-white dark:bg-card">
                <div className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-border">
                  {UPCOMING_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      data-testid={`upcoming-kind-${kind}`}
                      aria-pressed={upcomingKind === kind}
                      onClick={() => setUpcomingKind(kind)}
                      className="shrink-0 rounded-full px-3 py-1 text-xs"
                      style={upcomingKind === kind ? { background: "#5E8FAD", color: "white" } : undefined}
                    >
                      {UPCOMING_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
                <ul className="flex flex-col">
                  {upcomingRows(upcomingItems, upcomingKind, currentDate).map((event) => (
                    <li key={event.id} className="border-b border-border px-3 py-2 text-sm">
                      <div className="text-xs text-muted-foreground">{format(event.startTime, "EEE, MMM d")}</div>
                      <span>{event.title}</span>
                      {eventSourceChip(event.source) && (
                        <span data-testid="event-scan-chip" className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{eventSourceChip(event.source)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Month view ── */}
            {/* Two month views coexist deliberately (2026-09-15): the classic
                title rows, and the phone-only dots-and-tap grid. Neither was
                deleted — the toggle below picks, per device. */}
            {viewMode === "month" && isMobile && monthStyle === "dots" && (
              // The grid and the sheet overlap, so they can't be flex siblings:
              // the sheet is absolutely positioned and slides up OVER the grid.
              <div className="flex-1 relative overflow-hidden min-h-0 bg-white dark:bg-card">
               <div ref={setMonthGridEl} className="absolute inset-x-0 top-0">
                {/* Said once for the whole grid rather than captioned into
                    thirty cells: the dots and the total count different things
                    and will not add up (a family dinner is one event and four
                    people's evening), so the grid has to say which is which
                    somewhere. The way back to titles is the toolbar button
                    above, not a link in here. */}
                <div className="px-3 py-1.5 border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] flex-shrink-0">
                  <span className="text-[9px] leading-tight text-muted-foreground">
                    One dot per person, with their own event count · the day's total is below
                  </span>
                </div>
                <div className="grid grid-cols-7 border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] flex-shrink-0">
                  {(weekStartsOn === 1
                    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                  ).map(d => (
                    <div key={d} className="py-1.5 text-center text-[11px] font-semibold text-muted-foreground border-r border-[#b0bec8] dark:border-border last:border-0">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 flex-shrink-0">
                  {headerDays.map(day => (
                    <MonthDotsCell
                      key={day.toISOString()}
                      day={day}
                      events={eventsForDay(day)}
                      inMonth={isSameMonth(day, currentDate)}
                      people={dotPeople}
                      selected={isSameDay(day, monthSelectedDay ?? currentDate)}
                      onSelect={d => { hapticLight(); setMonthSelectedDay(d); }}
                    />
                  ))}
                </div>
               </div>
                {/* Held back for one frame until the grid has been measured —
                    a sheet resting at top:0 before then covers the whole
                    month, which is a visible flash on every open. */}
                {monthGridHeight > 0 && (
                  <MonthAgendaSheet collapsedTop={monthGridHeight}>
                    <MonthDayAgenda
                      day={monthSelectedDay ?? currentDate}
                      events={eventsForDay(monthSelectedDay ?? currentDate)}
                      profiles={profiles}
                      onEventClick={handleEventClick}
                      onDriverClick={(ev) => { setHighlightDrivingField(true); handleEventClick(ev); }}
                      onOpenDay={d => { setCurrentDate(d); setViewMode("day"); }}
                    />
                  </MonthAgendaSheet>
                )}
              </div>
            )}

            {viewMode === "month" && !(isMobile && monthStyle === "dots") && (
              <div className="flex-1 overflow-auto">
                {/* Day headers */}
                <div className="grid grid-cols-7 border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] sticky top-0 z-10">
                  {(weekStartsOn === 1
                    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                  ).map(d => (
                    <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground border-r border-[#b0bec8] dark:border-border last:border-0">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {headerDays.map(day => (
                    <MonthCell
                      key={day.toISOString()}
                      day={day}
                      events={eventsForDay(day)}
                      inMonth={isSameMonth(day, currentDate)}
                      onDayClick={d => { setCurrentDate(d); setViewMode("day"); }}
                      onEventClick={handleEventClick}
                      onDriverClick={(ev) => { setHighlightDrivingField(true); handleEventClick(ev); }}
                      profiles={profiles}
                      compact={isMobile}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Time grid view (day / workweek / week) ── */}
            {timeGridView && (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Column headers */}
                <div
                  ref={headerRowRef}
                  className="flex border-b border-[#b0bec8] dark:border-border bg-[#dce8f2] dark:bg-[#1e2633] flex-shrink-0"
                >
                  {/* Gutter */}
                  <div className="w-14 flex-shrink-0" />
                  {headerDays.map(day => (
                    <div
                      key={day.toISOString()}
                      className="flex-1 py-2 text-center border-l border-[#b0bec8] dark:border-border cursor-pointer hover:bg-[#e3d8c6]/30 transition-colors"
                      onClick={() => { setCurrentDate(day); setViewMode("day"); }}
                    >
                      <div className="text-[11px] text-muted-foreground font-medium">
                        {format(day, "EEE")}
                      </div>
                      <div
                        className={`w-8 h-8 mx-auto flex items-center justify-center rounded-full text-sm font-bold mt-0.5 transition-colors ${
                          isSameDay(day, currentDate)
                            ? "bg-primary text-primary-foreground"
                            : isToday(day)
                              ? "border-2 border-primary text-primary"
                              : "text-foreground hover:bg-accent"
                        }`}
                      >
                        {format(day, "d")}
                      </div>
                    </div>
                  ))}
                </div>

                {/* All-day events strip */}
                {hasAllDay && (
                  <div
                    ref={(el) => {
                      (allDayRowRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                      if (el) el.style.paddingRight = `${gutterWidthRef.current}px`;
                    }}
                    className="flex border-b border-[#b0bec8] dark:border-border flex-shrink-0 bg-[#dce8f2] dark:bg-[#1e2633]/40"
                  >
                    <div className="w-14 flex-shrink-0 flex items-center justify-end pr-2">
                      <span className="text-[9px] text-muted-foreground uppercase font-semibold">All day</span>
                    </div>
                    {headerDays.map(day => {
                      const adEvs = allDayEventsForDay(day);
                      return (
                        <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-[#b0bec8] dark:border-border min-h-[28px] p-0.5 space-y-0.5">
                          {adEvs.map(ev => {
                            return (
                              <div
                                key={ev.id}
                                className="text-[10px] px-1.5 py-0.5 rounded font-medium truncate cursor-pointer hover:opacity-90 flex items-center gap-1"
                                style={{ backgroundColor: ev.color, color: getContrastText(ev.color) }}
                                onClick={() => handleEventClick(ev)}
                                data-testid={`allday-event-${ev.id}`}
                              >
                                <span className="truncate min-w-0">{ev.title}</span>
                                <EventDriverChip
                                  ev={ev}
                                  profiles={profiles}
                                  compact
                                  onClick={(clicked) => { setHighlightDrivingField(true); handleEventClick(clicked); }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Scrollable time grid — height capped to content so no blank
                    space appears at the bottom when zoom is small */}
                <div
                  ref={scrollRef}
                  className="overflow-y-auto overflow-x-hidden"
                  style={{
                    scrollbarGutter: "stable",
                    maxHeight: `${(displayEndHour - displayStartHour) * hourHeight}px`,
                  }}
                >
                  <div className="flex">
                    {/* Time gutter */}
                    {(() => {
                      // +1 so the end-hour label (e.g. "10 PM") is included
                      const gutterHours = Array.from(
                        { length: displayEndHour - displayStartHour + 1 },
                        (_, i) => displayStartHour + i
                      );
                      const containerHeight = (displayEndHour - displayStartHour) * hourHeight;
                      return (
                        <div className="w-14 flex-shrink-0 relative" style={{ height: containerHeight }}>
                          {gutterHours.map((h, i) => {
                            // Clamp so the first label isn't cut off above the container
                            // and the last label isn't cut off below it
                            const rawTop = i * hourHeight - 7;
                            const top = Math.max(2, Math.min(containerHeight - 14, rawTop));
                            return (
                              <div
                                key={h}
                                className="absolute right-2 text-[10px] text-muted-foreground select-none"
                                style={{ top }}
                              >
                                {format(set(new Date(), { hours: h % 24, minutes: 0 }), "h a")}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Day columns */}
                    <div className="flex flex-1 relative">
                      {headerDays.map(day => (
                        <DayColumn
                          key={day.toISOString()}
                          day={day}
                          events={timedEventsForDay(day)}
                          allDayEvents={allDayEventsForDay(day)}
                          profiles={profiles}
                          isCurrentDay={isToday(day)}
                          onSlotClick={handleSlotClick}
                          onEventClick={handleEventClick}
                          onDriverClick={(ev) => { setHighlightDrivingField(true); handleEventClick(ev); }}
                          onReschedule={handleReschedule}
                          startHour={displayStartHour}
                          endHour={displayEndHour}
                          hourHeight={hourHeight}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Event modal (shared with Today tab) ── */}
      <EventModal
        isOpen={showEventModal}
        onClose={resetForm}
        highlightDrivingField={highlightDrivingField}
        onSubmit={async () => {
          if (selectedEvent) {
            await handleEditEventSubmit({} as React.FormEvent);
          } else {
            await handleAddEventSubmit({} as React.FormEvent);
          }
        }}
        onDelete={selectedEvent ? handleDeleteEvent : undefined}
        isEditing={!!selectedEvent}
        profiles={profiles}
        formData={formData}
        setFormData={setFormData}
        selectedSlot={selectedSlot}
        setSelectedSlot={setSelectedSlot}
        selectedEvent={selectedEvent}
        isSubmitting={createEventMutation.isPending || updateEventMutation.isPending || updateGoogleEventMutation.isPending}
        isDeleting={deleteEventMutation.isPending || deleteGoogleEventMutation.isPending}
        resetForm={resetForm}
        testIdPrefix="cal3-event"
      />

      {/* ── Recurring event: assignment scope chooser ── */}
      <Dialog open={!!recurringScope} onOpenChange={(open) => { if (!open) setRecurringScope(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change assignee for…</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is a repeating event. Who should this change apply to?
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              data-testid="recurring-scope-this"
              variant="outline"
              onClick={() => {
                if (recurringScope) submitGoogleEventUpdate(recurringScope.eventData, false);
                setRecurringScope(null);
              }}
            >
              This event only
            </Button>
            <Button
              data-testid="recurring-scope-following"
              onClick={() => {
                if (recurringScope) submitGoogleEventUpdate(recurringScope.eventData, true);
                setRecurringScope(null);
              }}
            >
              This and all following events
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Calendar settings dialog ── */}
      <CalendarSettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
      />
      {parentGateDialog}

      {/* ── Celebrations dialog ── */}
      <Dialog open={showCelebrations} onOpenChange={setShowCelebrations}>
        {/* w-[calc(100vw-2rem)] caps the dialog to the phone's actual
            viewport width — max-w-3xl alone isn't enough: DialogContent is a
            CSS grid, and a grid track's minimum width is set by the widest
            non-shrinking content inside it, which can silently blow the
            dialog past its max-width and run cards off the right edge. */}
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-3xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Celebrations</DialogTitle>
          </DialogHeader>
          {/* allEvents (not allEventsWithCelebrations) — the scan must review
              real calendar entries, never the app's own synthetic celebration
              rows. It already covers local + Google + Outlook + iCal. */}
          <CelebrationsView scanEvents={allEvents} />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
});
