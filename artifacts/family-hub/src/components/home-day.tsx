import { useEffect, useRef, useState } from "react";
import { AlarmClock, Calendar, CalendarPlus, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Cloud, CloudRain, ListTodo, MoreVertical, Newspaper, Plus, RefreshCw, Snowflake, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Event, Meal } from "@workspace/shared-types";
import { choreProgress, choresForCount, completedActions, dinnerName, driverNamesFor, drivesOnHomeDay, eventsOnHomeDay, forecastFor, homeBirthdayLine, horizonBirthdays, horizonDatedTodos, horizonMail, horizonWithoutChecked, mailClockParts, mailKeyDates, mailOffCalendar, mailSpan, mailVisibleToKid, newsletterIssues, newsletterInitials, PLAN_HORIZON, PLAN_KEY_DATES, PLAN_NEWSLETTERS, PLAN_TODO_FOLD, planDateLabel, planTodoRows, plainEventDetail, schoolEmailNames, schoolHomeTitle, schoolSlipsHeldOnHome, snoozeUntil, sourceChipLabel, todosForHome, visibleForProfiles } from "@/lib/homeDay";
import { eventSourceChip } from "@/lib/upcoming";
import { appendPlace, eventClockLine, planEventTitle, pointsProfileId } from "@/lib/chatTools";
import { confirmDialog } from "@/lib/confirmDialog";
import { openEmailHref, schoolSaveTarget, slipQuote, slipSender, slipText } from "@/lib/slipMail";
import { clearInboxScan, readInboxScanOpen } from "@/lib/inboxScan";

type Person = { id: string; name: string; color?: string | null; school?: string | null; isChild?: boolean | null; role?: string | null; connected?: boolean };
type HomeEvent = Event & { calendarColor?: string | null; recurringEventId?: string | null };
type Props = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: Event[];
  selectedIds: string[];
  familyIds: string[];
  day: Date;
  kidName?: string | null;
  personId?: string | null;
  people?: Person[];
  onOpenChores: () => void;
  onAddTodo?: () => void;
  onEditTodo?: (chore: Chore) => void;
  onDeleteTodo?: (chore: Chore) => void;
  onOpenCalendar?: () => void;
  onOpenEvent?: (eventId: string) => void;
  onShiftDay?: (by: number) => void;
  onRefresh?: () => void;
};

const SNOOZE_KEY = "superhub_home_snooze";
const LOGO_INKS = ["#2F5E9E", "#C0392B", "#2E7355", "#5E8FAD", "#9A4E2A"];

function readSnooze(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function InboxScanBanner() {
  const [open, setOpen] = useState(() => readInboxScanOpen());
  const applied = useRef<number | null>(null);
  const { data: settings } = useQuery<{ scanInbox?: boolean | null }>({ queryKey: ["/api/calendar-settings"] });
  const { data: scan } = useQuery<{ running: boolean; finishedAt: number | null }>({
    queryKey: ["/api/ingest/scan-status"],
    enabled: open,
    refetchInterval: open ? 15000 : false,
  });
  useEffect(() => {
    const sync = () => setOpen(readInboxScanOpen());
    window.addEventListener("superhub-inbox-scan", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("superhub-inbox-scan", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (!scan?.finishedAt || scan.running) return;
    if (applied.current === scan.finishedAt) return;
    applied.current = scan.finishedAt;
    void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    clearInboxScan();
  }, [scan]);
  if (!open || settings?.scanInbox === false) return null;
  return (
    <section className="plan-card flex items-start gap-3" data-testid="inbox-scan-banner">
      <span className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#5E8FAD] border-t-transparent" aria-hidden="true" />
      <div>
        <p className="text-[15px] font-semibold">Scanning your inbox</p>
        <p className="text-sm text-[#6e6e78]">Today's to-dos, key dates, and newsletters update when the read finishes.</p>
      </div>
    </section>
  );
}

function logoInk(text: string): string {
  const sum = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
  return LOGO_INKS[sum % LOGO_INKS.length];
}

export function HomeDay({ chores, completions, events, selectedIds, familyIds, day, kidName, personId, people = [], onOpenChores, onAddTodo, onEditTodo, onDeleteTodo, onOpenCalendar, onOpenEvent, onShiftDay, onRefresh }: Props) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [showAllHorizon, setShowAllHorizon] = useState(false);
  const [showAllLetters, setShowAllLetters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kept, setKept] = useState<Record<string, string>>({});
  const [snooze, setSnooze] = useState<Record<string, number>>(readSnooze);
  const [sheet, setSheet] = useState<{ chore: Chore; mode: "actions" | "snooze" | "source" | "letter"; keyDate?: boolean } | null>(null);
  const [customSnooze, setCustomSnooze] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const hidden = (id: string) => (snooze[id] ?? 0) > Date.now();
  const snoozeItem = (id: string, until: number | null) => {
    if (until == null) return;
    const next = { ...snooze, [id]: until };
    setSnooze(next);
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    setSheet(null);
    setRevealed(null);
  };
  const now = new Date();
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const { data: calendarSettings } = useQuery<{ shareOriginals?: boolean | null; familyCalendarId?: string | null }>({
    queryKey: ["/api/calendar-settings"],
  });
  const { data: celebrations = [] } = useQuery<{ name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[]>({
    queryKey: ["/api/celebrations"],
  });
  const { data: meals = [] } = useQuery<Meal[]>({
    queryKey: ["/api/meals", dayKey, dayKey],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals?start=${dayKey}&end=${dayKey}`);
      return res.json();
    },
  });
  const { data: weather } = useQuery<{ high: number; low: number; condition: string; days?: { date: string; high: number; low: number; condition: string }[] }>({
    queryKey: ["/api/weather"],
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const muteSender = useMutation({
    mutationFn: async (address: string) => {
      await apiRequest("POST", "/api/ingest/mute", { address });
    },
  });
  const saveSchool = useMutation({
    mutationFn: async (offer: { profileId: string; school: string }) => {
      await apiRequest("POST", "/api/ingest/school", offer);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
    },
  });
  const dismissSlip = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("POST", "/api/ingest/not-relevant", { title });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
  });
  const profileFor = (choreId: string) => {
    const chore = chores.find((item) => item.id === choreId);
    return pointsProfileId(chore?.profileIds ?? [], selectedIds.join(",")) || completions.find((item) => item.choreId === choreId)?.profileId || "";
  };
  const complete = useMutation({
    mutationFn: async (choreId: string) => {
      const chore = chores.find((item) => item.id === choreId);
      const profileId = profileFor(choreId);
      if (!profileId) return;
      const at = new Date();
      const localDayStart = new Date(at);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("POST", "/api/chore-completions", {
        choreId,
        profileId,
        points: chore?.points ?? 0,
        completedAt: at.toISOString(),
        localDayStart: localDayStart.toISOString(),
      });
    },
    onSuccess: async (_data, choreId) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      const profileId = profileFor(choreId);
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });
  const undo = useMutation({
    mutationFn: async (choreId: string) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      await apiRequest("DELETE", `/api/chore-completions/${choreId}/${profileId}`);
    },
    onSuccess: async (_data, choreId) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      const profileId = profileFor(choreId);
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });
  const assign = useMutation({
    mutationFn: async (change: { choreId: string; profileIds: string[] }) => {
      await apiRequest("PATCH", `/api/chores/${change.choreId}`, { profileIds: change.profileIds });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    },
  });
  const removeTodo = useMutation({
    mutationFn: async (choreId: string) => {
      await apiRequest("DELETE", `/api/chores/${choreId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    },
  });
  const addToCalendar = useMutation({
    mutationFn: async (body: { choreId: string; title: string; description: string | null; start: Date; end: Date; allDay: boolean; profileIds: string[] }) => {
      const res = await apiRequest("POST", "/api/events", {
        title: body.title,
        description: body.description,
        startTime: body.start.toISOString(),
        endTime: body.end.toISOString(),
        isAllDay: body.allDay,
        profileIds: body.profileIds,
        source: "school",
        calendarId: calendarSettings?.familyCalendarId ?? null,
      });
      const created = await res.json() as { id?: string };
      return { choreId: body.choreId, eventId: created.id ?? "" };
    },
    onSuccess: async (created) => {
      if (created.eventId) setKept((current) => ({ ...current, [created.choreId]: created.eventId }));
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
  });
  const removeFromCalendar = useMutation({
    mutationFn: async (change: { choreId: string; eventId: string }) => {
      await apiRequest("DELETE", `/api/events/${change.eventId}`);
      return change.choreId;
    },
    onSuccess: async (choreId) => {
      setKept((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
  });

  const visibleChores = todosForHome(chores, selectedIds, familyIds).filter((todo) => !kidName || schoolEmailNames(todo, kidName));
  const stillOpen = visibleChores.filter((todo) => !completions.some((completion) => completion.choreId === todo.id));
  const homeEvents = visibleForProfiles(events, selectedIds).filter((event) => mailVisibleToKid(event, kidName ?? null));
  const letters = newsletterIssues(stillOpen, now).filter((row) => !hidden(row.id));
  const keyDates = mailKeyDates(
    stillOpen,
    homeEvents.filter((event) => !Object.values(kept).includes(event.id)),
    now,
  ).filter((row) => !hidden(row.id));
  const heldIds = new Set([...letters.map((row) => row.id), ...keyDates.map((row) => row.id)]);
  const todoRows = planTodoRows(visibleChores.filter((todo) => !heldIds.has(todo.id)), completions, day, now).filter((todo) => !hidden(todo.id));
  const progress = choreProgress(choresForCount(chores, selectedIds, familyIds), completions, day);
  const dinner = dinnerName(meals, day);
  const birthday = homeBirthdayLine(celebrations, day);
  const todayEvents = eventsOnHomeDay(
    visibleForProfiles(events, selectedIds),
    day,
    kidName ?? null,
    dinner,
    schoolSlipsHeldOnHome(todosForHome(chores, selectedIds, familyIds), completions, day),
  );
  const offCalendar = mailOffCalendar(stillOpen, homeEvents, day, now).filter((row) => !hidden(row.id));
  const drives = drivesOnHomeDay(events, day, selectedIds, kidName ?? null);
  const checkedSlips = todosForHome(chores, selectedIds, familyIds).filter((todo) => todo.category === "school_email" && completions.some((completion) => completion.choreId === todo.id));
  const horizon = horizonWithoutChecked(homeEvents, day, checkedSlips);
  const comingEvents = [
    ...horizonBirthdays(celebrations, day).map((row) => ({ key: row.id, title: row.title, startTime: row.startTime as Date | string, allDay: true, location: null as string | null, drivers: [] as string[], calendarName: null as string | null, color: "#5E8FAD", eventId: "" })),
    ...horizon.map((event) => {
      const colored = event as HomeEvent;
      const owner = people.find((person) => (event.profileIds ?? []).includes(person.id));
      return {
        key: event.id,
        title: event.title,
        startTime: event.startTime,
        allDay: event.isAllDay === true,
        location: event.location ?? null,
        drivers: driverNamesFor(event.drivingProfileIds, people),
        calendarName: event.calendarName ?? null,
        color: colored.calendarColor || owner?.color || "#5E8FAD",
        eventId: event.id,
      };
    }),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const laterMail = horizonMail(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const laterTodos = horizonDatedTodos(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  const earlier = completedActions(
    completions.filter((completion) => selectedIds.length === 0 || allSelected || (!!completion.profileId && selectedIds.includes(completion.profileId))),
    now,
  );
  const daysOut = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const todosTitle = daysOut === 0 ? "Today's To-dos" : daysOut === 1 ? "Tomorrow's To-dos" : `${day.toLocaleDateString("en-US", { weekday: "long" })}'s To-dos`;
  const scheduleTitle = daysOut === 0 ? "Today's Schedule" : "Schedule";
  const openTodos = todoRows.filter((todo) => !todo.done);
  const doneTodos = todoRows.filter((todo) => todo.done).sort((a, b) => {
    const at = (id: string) => completions
      .filter((completion) => completion.choreId === id && completion.completedAt)
      .reduce((latest, completion) => Math.max(latest, new Date(completion.completedAt ?? 0).getTime()), 0);
    return at(b.id) - at(a.id);
  });
  const folded = !showAllTodos && openTodos.length > PLAN_TODO_FOLD;
  const visibleTodos = folded ? openTodos.slice(0, PLAN_TODO_FOLD) : openTodos;
  const dayStamp = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  useEffect(() => {
    setShowAllTodos(false);
    setShowDoneTodos(false);
  }, [dayStamp]);
  const visibleKeys = showAllKeys ? keyDates : keyDates.slice(0, PLAN_KEY_DATES);
  const visibleLetters = showAllLetters ? letters : letters.slice(0, PLAN_NEWSLETTERS);
  const forecast = forecastFor(weather?.days, day) ?? (daysOut === 0 && weather ? { high: weather.high, low: weather.low, condition: weather.condition } : null);
  const drag = useRef<{ x: number; y: number; id: string } | null>(null);
  const hold = useRef<number | null>(null);
  const clearHold = () => {
    if (hold.current != null) window.clearTimeout(hold.current);
    hold.current = null;
  };

  const placeMail = (todo: Chore, start: Date, allDay: boolean) => {
    const clock = mailClockParts(`${todo.title}\n${todo.description ?? ""}`);
    const at = new Date(start);
    const end = new Date(start);
    if (!allDay && clock) {
      at.setHours(clock.hours, clock.minutes, 0, 0);
      end.setTime(at.getTime() + 60 * 60 * 1000);
    } else {
      at.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
      end.setHours(0, 0, 0, 0);
    }
    addToCalendar.mutate({
      choreId: todo.id,
      title: todo.title,
      description: plainEventDetail(todo.description),
      start: at,
      end,
      allDay,
      profileIds: todo.profileIds ?? [],
    });
  };
  const askMute = async (sender: string) => {
    const ok = await confirmDialog({
      title: `Mute ${sender}?`,
      description: `You won't see anything from ${sender}. You can unmute anytime in Settings.`,
      confirmLabel: "Mute",
    });
    if (ok) muteSender.mutate(sender);
  };
  const onDaySwipe = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== "day") return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    onShiftDay?.(dx < 0 ? 1 : -1);
  };

  return (
    <div className="flex flex-col gap-3.5" data-testid="home-day">
      <InboxScanBanner />
      <section
        className="plan-card flex items-center gap-1"
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, id: "day" }; }}
        onPointerUp={onDaySwipe}
        onPointerCancel={() => { drag.current = null; }}
      >
        <button type="button" aria-label="Previous day" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#6e6e78]" onClick={() => onShiftDay?.(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-semibold leading-tight tracking-tight">{day.toLocaleDateString("en-US", { weekday: "long" })}</div>
          <div className="text-sm text-[#6e6e78]">{day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
          {daysOut !== 0 && (
            <button type="button" className="mt-1 text-xs font-semibold text-[#5E8FAD]" onClick={() => onShiftDay?.(-daysOut)}>Today</button>
          )}
        </div>
        {forecast && <ForecastMark high={forecast.high} low={forecast.low} condition={forecast.condition} />}
        <button type="button" aria-label="Next day" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#6e6e78]" onClick={() => onShiftDay?.(1)}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </section>

      <section className="plan-card">
        <div className="mb-1 flex items-center gap-2.5">
          <ListTodo className="h-5 w-5 shrink-0 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">{todosTitle}</h2>
          {onAddTodo && (
            <button type="button" aria-label="Add a to-do" className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-border" onClick={onAddTodo}>
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        {visibleTodos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{daysOut === 0 ? "Nothing that needs you today." : "Nothing due this day."}</p>
        ) : (
          <ul className="flex flex-col">
            {visibleTodos.map((todo) => {
              const quote = slipQuote(todo.description);
              const title = todo.category === "school_email" ? schoolHomeTitle(todo.title, events, day, people) : todo.title;
              const sender = slipSender(todo.description);
              const whoId = (todo.profileIds ?? [])[0];
              const who = people.find((person) => person.id === whoId);
              return (
                <li key={todo.id} data-testid={`home-todo-${todo.id}`} className="border-t border-[#ececf0] first:border-t-0">
                  {revealed === todo.id && (
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" className="rounded-full bg-[#F1F1F4] px-3 py-1 text-xs font-medium" onClick={() => setSheet({ chore: todo, mode: "snooze" })}>Snooze</button>
                      <button type="button" className="rounded-full bg-[#F1F1F4] px-3 py-1 text-xs font-medium" onClick={() => todo.category === "school_email" ? dismissSlip.mutate(todo.title) : snoozeItem(todo.id, snoozeUntil("weekend", now))}>Not relevant</button>
                    </div>
                  )}
                  <div
                    className="flex items-start gap-3 py-3"
                    onPointerDown={(event) => {
                      drag.current = { x: event.clientX, y: event.clientY, id: todo.id };
                      clearHold();
                      hold.current = window.setTimeout(() => setSheet({ chore: todo, mode: "actions" }), 550);
                    }}
                    onPointerMove={(event) => {
                      if (!drag.current || drag.current.id !== todo.id) return;
                      if (Math.abs(event.clientX - drag.current.x) > 8 || Math.abs(event.clientY - drag.current.y) > 8) clearHold();
                    }}
                    onPointerUp={(event) => {
                      clearHold();
                      if (!drag.current || drag.current.id !== todo.id) return;
                      const dx = event.clientX - drag.current.x;
                      const dy = event.clientY - drag.current.y;
                      drag.current = null;
                      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
                      if (dx > 0) (todo.done ? undo : complete).mutate(todo.id);
                      else setRevealed(todo.id);
                    }}
                    onPointerCancel={clearHold}
                    onContextMenu={(event) => { event.preventDefault(); setSheet({ chore: todo, mode: "actions" }); }}
                  >
                    <button
                      type="button"
                      aria-label={todo.done ? `Mark ${title} not done` : `Check off ${title}`}
                      className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] ${todo.done ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-[#a0a0a8]"}`}
                      onClick={() => (todo.done ? undo : complete).mutate(todo.id)}
                    >
                      {todo.done && <Check className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button type="button" className="block w-full text-left" onClick={() => setSheet({ chore: todo, mode: "source" })}>
                        <div className={`text-[15px] font-medium leading-snug line-clamp-2 ${todo.done ? "text-[#a0a0a8] line-through" : ""}`}>{title}</div>
                        {quote && <div data-testid="home-todo-quote" className={`mt-1 text-sm leading-snug line-clamp-3 ${todo.done ? "text-[#a0a0a8] line-through" : "text-[#6e6e78]"}`}>{quote}</div>}
                      </button>
                      <div className="mt-2 flex items-center gap-2">
                        <span data-testid="home-todo-source" className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">
                          {sourceChipLabel(sender, todo.category === "school_email" ? "mail" : "todo")}
                        </span>
                        <AssigneeMenu people={people} personId={personId} who={who?.name} onPick={(ids) => assign.mutate({ choreId: todo.id, profileIds: ids })} />
                        <button type="button" aria-label={`More actions for ${title}`} className="grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]" onClick={() => setSheet({ chore: todo, mode: "actions" })}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {folded && (
          <button type="button" className="mt-1 text-sm font-semibold text-[#5E8FAD]" onClick={() => setShowAllTodos(true)}>
            Show {openTodos.length - visibleTodos.length} more
          </button>
        )}
        {doneTodos.length > 0 && (
          <div className="mt-1 border-t border-[#ececf0] pt-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              aria-expanded={showDoneTodos}
              aria-label={showDoneTodos ? `Hide ${doneTodos.length} done` : `Show ${doneTodos.length} done`}
              onClick={() => setShowDoneTodos((open) => !open)}
            >
              <span className="text-sm font-semibold text-[#5E8FAD]">{showDoneTodos ? "Hide done" : "Done"}</span>
              <span className="inline-flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#E7F1F6] px-1.5 text-xs font-semibold text-[#5E8FAD]">{doneTodos.length}</span>
              {showDoneTodos ? <ChevronUp className="ml-auto h-4 w-4 text-[#a0a0a8]" /> : <ChevronDown className="ml-auto h-4 w-4 text-[#a0a0a8]" />}
            </button>
            {showDoneTodos && (
              <ul className="flex flex-col">
                {doneTodos.map((todo) => {
                  const title = todo.category === "school_email" ? schoolHomeTitle(todo.title, events, day, people) : todo.title;
                  return (
                    <li key={todo.id} data-testid={`home-todo-done-${todo.id}`} className="border-t border-[#ececf0] first:border-t-0">
                      <div className="flex items-start gap-3 py-3">
                        <button
                          type="button"
                          aria-label={`Mark ${title} not done`}
                          className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#5E8FAD] bg-[#5E8FAD] text-white"
                          onClick={() => undo.mutate(todo.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSheet({ chore: todo, mode: "source" })}>
                          <div className="text-[15px] font-medium leading-snug line-clamp-2 text-[#a0a0a8] line-through">{title}</div>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="plan-card">
        <div className="mb-2 flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">Key Dates to Add</h2>
        </div>
        {visibleKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new dates to add.</p>
        ) : (
          <ul className="flex flex-col">
            {visibleKeys.map((row) => {
              const added = !!kept[row.id];
              const sender = slipSender(row.description);
              return (
                <li key={row.id} className="flex items-start gap-3 border-t border-[#ececf0] py-3 first:border-t-0">
                  <button
                    type="button"
                    aria-label={added ? `Remove ${row.title} from your calendar` : `Add ${row.title} to your calendar`}
                    className={`mt-0.5 grid h-[21px] w-[21px] shrink-0 place-items-center rounded-[5px] border-[1.5px] ${added ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-[#a0a0a8]"}`}
                    onClick={() => added ? removeFromCalendar.mutate({ choreId: row.id, eventId: kept[row.id] }) : placeMail(row, row.start, !row.time)}
                  >
                    {added && <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1" onContextMenu={(event) => { event.preventDefault(); setSheet({ chore: row, mode: "actions", keyDate: true }); }}>
                    <button type="button" className="block w-full text-left" onClick={() => setSheet({ chore: row, mode: "source", keyDate: true })}>
                      <div className="text-[15px] font-medium leading-snug">{row.title}</div>
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#6e6e78]">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" />{planDateLabel(row.start, row.end)}</span>
                      {row.time && <span className="inline-flex items-center gap-1"><AlarmClock className="h-3.5 w-3.5" aria-hidden="true" />{row.time}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex max-w-[70%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">{sourceChipLabel(sender, "mail")}</span>
                      <button type="button" aria-label={`More actions for ${row.title}`} className="ml-auto grid h-7 w-7 place-items-center text-[#6e6e78]" onClick={() => setSheet({ chore: row, mode: "actions", keyDate: true })}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {keyDates.length > PLAN_KEY_DATES && !showAllKeys && (
          <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAllKeys(true)}>View all</button>
        )}
      </section>

      <button type="button" data-testid="home-chore-count" onClick={onOpenChores} className="flex w-full items-center gap-2 plan-card text-left">
        <ClipboardList className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
        <span className="text-[17px] font-medium">Chores</span>
        <span className="ml-auto text-sm text-muted-foreground">{progress.done} of {progress.total}</span>
      </button>

      <section className="plan-card">
        <div className="mb-2 flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">School Newsletter</h2>
        </div>
        {visibleLetters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No school newsletters yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleLetters.map((letter) => (
              <li key={letter.id}>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-[#E7F1F6] px-3 py-2 text-left" onClick={() => setSheet({ chore: letter, mode: "letter" })}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-sm font-black" style={{ color: logoInk(newsletterInitials(letter.title)) }}>{newsletterInitials(letter.title)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{letter.title}</span>
                    <span className="mt-0.5 block text-xs text-[#6e6e78]">{letter.when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#1e1e24]" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {letters.length > PLAN_NEWSLETTERS && !showAllLetters && (
          <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAllLetters(true)}>View all</button>
        )}
      </section>

      <section className="plan-card" data-testid="home-today-events">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">{scheduleTitle}</h2>
          {onRefresh && (
            <button
              type="button"
              aria-label="Refresh calendars"
              className="ml-auto grid h-8 w-8 place-items-center"
              onClick={() => {
                setRefreshing(true);
                onRefresh();
                window.setTimeout(() => setRefreshing(false), 800);
              }}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
        {todayEvents.length === 0 && offCalendar.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the calendar.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todayEvents.map((event) => {
              const allDay = event.isAllDay === true;
              const title = planEventTitle(appendPlace(event.title, event.location), driverNamesFor(event.drivingProfileIds, people));
              const clock = eventClockLine("", event.startTime, false, allDay);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onOpenEvent?.(event.id)}
                    className={allDay
                      ? "flex w-full items-center justify-between rounded-xl border border-dashed border-[#5E8FAD] bg-[#E7F1F6] px-3 py-2 text-left text-sm"
                      : "block w-full rounded-xl bg-[#d5e6ef] px-3 py-2 text-left text-sm"}
                  >
                    <span className="font-medium">{title}</span>
                    {allDay ? <span className="text-muted-foreground">All day</span> : clock && <span className="mt-0.5 block text-muted-foreground">{clock}</span>}
                    {eventSourceChip(event.source) && (
                      <span data-testid="event-scan-chip" className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs">{eventSourceChip(event.source)}</span>
                    )}
                  </button>
                </li>
              );
            })}
            {offCalendar.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="block w-full rounded-xl bg-[#d5e6ef] px-3 py-2 text-left text-sm"
                  onClick={() => setSheet({ chore: row, mode: "source" })}
                  onContextMenu={(event) => { event.preventDefault(); placeMail(row, day, false); }}
                >
                  <span className="font-medium">{row.title}</span>
                  <span className="mt-0.5 block text-muted-foreground">{row.time} · Not on your calendar</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {dinner && <p data-testid="home-dinner" className="mt-3 text-sm">Dinner. {dinner}</p>}
        {birthday && <p data-testid="home-birthday" className="mt-1 text-sm">{birthday}</p>}
      </section>

      {drives.length > 0 && (
        <section data-testid="home-driving" className="plan-card">
          <h2 className="mb-2 text-[17px] font-medium">Driving</h2>
          <ul className="flex flex-col gap-1">
            {drives.map((event) => (
              <li key={event.id} className="text-sm">
                {appendPlace(eventClockLine(event.title, event.startTime, true, event.isAllDay === true), event.location)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-testid="home-horizon" className="plan-card">
        <div className="mb-1 flex items-center gap-2.5">
          <h2 className="text-[17px] font-medium">On the Horizon</h2>
        </div>
        {comingEvents.length === 0 && laterMail.length === 0 && laterTodos.length === 0 ? (
          <p className="text-sm text-muted-foreground">A quiet week ahead.</p>
        ) : (
          <ul className="flex flex-col">
            {(showAllHorizon ? comingEvents : comingEvents.slice(0, PLAN_HORIZON)).map((row) => (
              <li key={row.key} className="border-t border-[#ececf0] first:border-t-0">
                <button type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => row.eventId && onOpenEvent?.(row.eventId)}>
                  <span className="mt-1 h-9 w-1 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug">{planEventTitle(row.title, row.drivers)}</span>
                    <span className="mt-1 block text-xs text-[#6e6e78]">{planDateLabel(new Date(row.startTime), null)}{row.allDay ? "" : ` · ${new Date(row.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}</span>
                    {row.location && <span className="mt-1 block text-sm leading-snug text-[#6e6e78]">{row.location}</span>}
                    {row.calendarName && <span data-testid="event-scan-chip" className="mt-2 inline-flex max-w-full truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">Calendar: {row.calendarName}</span>}
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#a0a0a8]" aria-hidden="true" />
                </button>
              </li>
            ))}
            {laterTodos.map((row) => {
              const sender = slipSender(row.description);
              const who = people.find((person) => person.id === (row.profileIds ?? [])[0]);
              return (
                <li key={row.id} data-testid={`home-horizon-todo-${row.id}`} className="flex items-start gap-3 border-t border-[#ececf0] py-3">
                  <button type="button" aria-label={`Check off ${row.title}`} className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-[#a0a0a8]" onClick={() => complete.mutate(row.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug">{row.title}</div>
                    <div className="mt-1 text-xs text-[#6e6e78]">{planDateLabel(row.start, null)}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs">{sourceChipLabel(sender, row.category === "school_email" ? "mail" : "todo")}</span>
                      <AssigneeMenu people={people} personId={personId} who={who?.name} onPick={(ids) => assign.mutate({ choreId: row.id, profileIds: ids })} />
                    </div>
                  </div>
                </li>
              );
            })}
            {laterMail.map((row) => {
              const sender = slipSender(row.description);
              const who = people.find((person) => person.id === (row.profileIds ?? [])[0]);
              return (
                <li key={row.id} className="flex items-start gap-3 border-t border-[#ececf0] py-3">
                  <button type="button" aria-label={`Check off ${row.title}`} className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-[#a0a0a8]" onClick={() => complete.mutate(row.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug">{row.title}</div>
                    <div className="mt-1 text-xs text-[#6e6e78]">{planDateLabel(row.start, null)} · {row.time}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs">{sourceChipLabel(sender, "mail")}</span>
                      <AssigneeMenu people={people} personId={personId} who={who?.name} onPick={(ids) => assign.mutate({ choreId: row.id, profileIds: ids })} />
                      <button type="button" aria-label={`More actions for ${row.title}`} className="grid h-7 w-7 place-items-center text-[#6e6e78]" onClick={() => setSheet({ chore: row, mode: "actions" })}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {comingEvents.length > PLAN_HORIZON && !showAllHorizon && (
          <button type="button" className="mt-1 text-sm font-semibold text-[#5E8FAD]" onClick={() => setShowAllHorizon(true)}>Show {comingEvents.length - PLAN_HORIZON} more</button>
        )}
        {onOpenCalendar && (
          <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={onOpenCalendar}>View all</button>
        )}
      </section>

      <section className="plan-card">
        <button type="button" data-testid="home-earlier-toggle" className="flex w-full items-center gap-2 text-left" aria-expanded={earlierOpen} onClick={() => setEarlierOpen((open) => !open)}>
          <CheckCheck className="h-5 w-5 text-[#6e6e78]" aria-hidden="true" />
          <span className="text-[17px] font-medium">Completed Actions</span>
          <span className="ml-auto inline-flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#E7F1F6] px-1.5 text-xs font-semibold text-[#5E8FAD]">{earlier.length}</span>
          <ChevronRight className="h-4 w-4 text-[#a0a0a8]" aria-hidden="true" />
        </button>
        {earlierOpen && (
          <ul className="mt-2 flex flex-col gap-1">
            {earlier.map((completion) => (
              <li key={completion.id} data-testid="home-earlier-row" className="text-sm text-muted-foreground">
                {chores.find((chore) => chore.id === completion.choreId)?.title ?? "Done"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={!!sheet} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
          {sheet?.mode === "snooze" && (
            <>
              <SheetHeader><SheetTitle>Snooze</SheetTitle></SheetHeader>
              <div className="mt-3 flex flex-col">
                {(["tonight", "tomorrow", "weekend"] as const).map((which) => {
                  const until = snoozeUntil(which, now);
                  if (until == null) return null;
                  const label = which === "tonight" ? "Tonight" : which === "tomorrow" ? "Tomorrow morning" : "This weekend";
                  return (
                    <button key={which} type="button" className="flex items-center justify-between border-t border-[#ececf0] py-3 text-left first:border-t-0" onClick={() => snoozeItem(sheet.chore.id, until)}>
                      <span>{label}</span>
                      <span className="text-sm text-[#6e6e78]">{new Date(until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
                    </button>
                  );
                })}
                <label className="mt-2 flex flex-col gap-2 text-sm">
                  Pick a date and time
                  <input type="datetime-local" value={customSnooze} onChange={(event) => setCustomSnooze(event.target.value)} className="rounded-lg border border-border px-2 py-2" />
                </label>
                <button type="button" className="mt-2 font-semibold text-[#5E8FAD]" onClick={() => snoozeItem(sheet.chore.id, snoozeUntil("custom", now, customSnooze ? new Date(customSnooze) : undefined))}>Snooze until then</button>
              </div>
            </>
          )}
          {sheet?.mode === "source" && (
            <>
              <SheetHeader><SheetTitle>{sheet.chore.title}</SheetTitle></SheetHeader>
              <p className="mt-3 whitespace-pre-wrap text-sm text-[#6e6e78]">{slipText(sheet.chore.description) || "No note on this one."}</p>
              <SourceLink chore={sheet.chore} people={people} personId={personId} kidName={kidName} share={calendarSettings?.shareOriginals === true} />
            </>
          )}
          {sheet?.mode === "letter" && (
            <>
              <SheetHeader><SheetTitle>{sheet.chore.title}</SheetTitle></SheetHeader>
              <p className="mt-1 text-xs text-[#6e6e78]">{(sheet.chore.createdAt ? new Date(sheet.chore.createdAt) : now).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {(slipText(sheet.chore.description).split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean).slice(0, 6)).map((line) => (
                  <li key={line} className="text-sm leading-snug">{line}</li>
                ))}
              </ul>
              {mailSpan(`${sheet.chore.title}\n${sheet.chore.description ?? ""}`, now) && (
                <p className="mt-3 text-sm text-[#6e6e78]">Date in the letter: {planDateLabel(mailSpan(`${sheet.chore.title}\n${sheet.chore.description ?? ""}`, now)!.start, mailSpan(`${sheet.chore.title}\n${sheet.chore.description ?? ""}`, now)!.end)}</p>
              )}
            </>
          )}
          {sheet?.mode === "actions" && (
            <ActionList
              chore={sheet.chore}
              keyDate={!!sheet.keyDate}
              personId={personId}
              people={people}
              added={!!kept[sheet.chore.id]}
              onEdit={() => { setSheet(null); onEditTodo?.(sheet.chore); }}
              onSnooze={() => setSheet({ ...sheet, mode: "snooze" })}
              onClaim={() => { if (personId) assign.mutate({ choreId: sheet.chore.id, profileIds: [personId] }); setSheet(null); }}
              onSource={() => setSheet({ ...sheet, mode: "source" })}
              onMute={(sender) => { setSheet(null); void askMute(sender); }}
              onDismiss={() => { dismissSlip.mutate(sheet.chore.title); setSheet(null); }}
              onDelete={() => { setSheet(null); onDeleteTodo ? onDeleteTodo(sheet.chore) : removeTodo.mutate(sheet.chore.id); }}
              onCalendar={() => {
                const span = mailSpan(`${sheet.chore.title}\n${sheet.chore.description ?? ""}`, now);
                if (kept[sheet.chore.id]) removeFromCalendar.mutate({ choreId: sheet.chore.id, eventId: kept[sheet.chore.id] });
                else if (span) placeMail(sheet.chore, span.start, !span.time);
                setSheet(null);
              }}
              onSave={(offer) => { saveSchool.mutate(offer); setSheet(null); }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ForecastMark({ high, low, condition }: { high: number; low: number; condition: string }) {
  const Icon = condition === "clear" ? Sun : condition === "rain" ? CloudRain : condition === "snow" ? Snowflake : Cloud;
  return (
    <div className="flex shrink-0 items-center gap-1 text-sm" aria-label={`${condition}, high ${high} degrees, low ${low}`}>
      <span className="font-medium">{Math.round(high)}°</span>
      <span className="text-[#6e6e78]">{Math.round(low)}°</span>
      <Icon className="h-5 w-5 text-[#F5B400]" aria-hidden="true" />
    </div>
  );
}

function AssigneeMenu({ people, personId, who, onPick }: { people: Person[]; personId?: string | null; who?: string; onPick: (ids: string[]) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#E7F1F6] px-2.5 py-1 text-xs font-medium text-[#5E8FAD]">
          {who ?? "Assign"} <span aria-hidden="true">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {people.map((person) => (
          <DropdownMenuItem key={person.id} onClick={() => onPick([person.id])}>
            {person.name}{person.id === personId ? " (me)" : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onPick([])}>Unassigned</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceLink({ chore, people, personId, kidName, share }: { chore: Chore; people: Person[]; personId?: string | null; kidName?: string | null; share: boolean }) {
  const sender = slipSender(chore.description);
  const viewer = people.find((person) => person.id === personId);
  const href = openEmailHref(share, sender, { isChild: !!kidName, ownsAccount: viewer?.connected === true });
  if (!href) return null;
  return <a data-testid="home-todo-open-email" className="mt-3 inline-block text-sm font-semibold text-[#5E8FAD]" href={href}>Open email</a>;
}

function ActionList({ chore, keyDate, personId, people, added, onEdit, onSnooze, onClaim, onSource, onMute, onDismiss, onDelete, onCalendar, onSave }: {
  chore: Chore;
  keyDate: boolean;
  personId?: string | null;
  people: Person[];
  added: boolean;
  onEdit: () => void;
  onSnooze: () => void;
  onClaim: () => void;
  onSource: () => void;
  onMute: (sender: string) => void;
  onDismiss: () => void;
  onDelete: () => void;
  onCalendar: () => void;
  onSave: (offer: { profileId: string; school: string }) => void;
}) {
  const sender = slipSender(chore.description);
  const whoId = (chore.profileIds ?? [])[0];
  const offer = schoolSaveTarget(chore.title, chore.description, people, personId ?? null);
  const rows: { label: string; detail: string; onClick: () => void; danger?: boolean; testId?: string }[] = [
    { label: "Edit", detail: "Change the title, date, or who it's for.", onClick: onEdit },
    { label: "Snooze", detail: "Hide it until a time you pick. It comes back then.", onClick: onSnooze },
  ];
  if (!keyDate && personId && whoId !== personId) rows.push({ label: "I'll do it", detail: "Assign it to you so the other parent sees you took it.", onClick: onClaim });
  if (keyDate) rows.push({ label: added ? "Remove from calendar" : "Add to calendar", detail: added ? "Take this date back off the calendar." : "Put this date on the family calendar.", onClick: onCalendar });
  rows.push({ label: "View source", detail: "Read the note this came from.", onClick: onSource });
  if (sender) rows.push({ label: "Mute Sender", detail: "Hide this sender's open items and skip their future email.", onClick: () => onMute(sender), testId: "home-todo-mute" });
  if (chore.category === "school_email") rows.push({ label: "Not Relevant", detail: "Remove this and show fewer like it.", onClick: onDismiss, testId: "home-todo-not-relevant" });
  if (offer) rows.push({ label: `Save ${offer.school}`, detail: offer.profileId === personId ? "Remember this school." : `Remember this school for ${offer.name}.`, onClick: () => onSave(offer), testId: "home-todo-save-school" });
  rows.push({ label: keyDate ? "Delete Key Date" : "Delete Task", detail: "Remove this item only. Similar emails can still come back.", onClick: onDelete, danger: true });
  return (
    <div className="flex flex-col">
      <SheetHeader className="mb-2"><SheetTitle className="text-left">{chore.title}</SheetTitle></SheetHeader>
      {rows.map((row) => (
        <button key={row.label} type="button" data-testid={row.testId} className={`flex items-start gap-3 border-t border-[#ececf0] py-3 text-left ${row.danger ? "text-destructive" : ""}`} onClick={row.onClick}>
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span>
            <span className="block text-[15px]">{row.label}</span>
            <span className="mt-0.5 block text-xs text-[#6e6e78]">{row.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
