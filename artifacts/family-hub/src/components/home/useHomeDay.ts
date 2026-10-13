import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Meal } from "@workspace/shared-types";
import type { FamilyEvent } from "@/lib/familyEvents";
import { recentShoutoutsQuery, type DailyContentAssignment, type DailyContentItem, type Shoutout } from "@/components/recent-shoutouts-card";
import { type NewsletterGroup, choreProgress, choresForCount, completedActions, dinnerName, driverNamesFor, drivesOnHomeDay, eventsOnHomeDay, forecastFor, forPeople, homeBirthdayLine, horizonBirthdays, horizonDatedTodos, horizonMail, horizonWithoutChecked, mailClockParts, mailKeyDates, mailOffCalendar, mailVisibleToKid, clearedTodos, newsletterGroups, newsletterRowIds, notesForHome, PLAN_KEY_DATES, PLAN_NEWSLETTERS, PLAN_TODO_FOLD, planTodoRows, plainEventDetail, praiseForHome, schoolEmailNames, schoolSlipsHeldOnHome, todosForHome } from "@/lib/homeDay";
import { pointsProfileId } from "@/lib/chatTools";
import { confirmDialog } from "@/lib/confirmDialog";
import { hapticLight } from "@/lib/haptics";
import { slipSender, slipSenderName } from "@/lib/slipMail";
import { readCollapsed, saveCollapsed, type CardConfig, type HomeCardId } from "./registry";

export type Person = { id: string; name: string; color?: string | null; school?: string | null; isChild?: boolean | null; role?: string | null; connected?: boolean };

export type HomeDayProps = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: FamilyEvent[];
  /** This device's card order and on/off, from Customize Home Page. */
  cards?: CardConfig[];
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
  /** `failing` names each source whose events could not be fetched. */
  calendarStatus?: { connected: boolean; failing: string[] };
  onOpenCalendarSettings?: () => void;
  familyProfileId?: string | null;
  /** The All Family profile's color, for anything that is for everyone. */
  familyColor?: string | null;
  /** Bumped to open Completed Actions, for a praise or note push. */
  openEarlierKey?: number;
};

export type Letters = NewsletterGroup<Chore>;
export type SheetState = { chore: Chore; mode: "actions" | "snooze" | "source" | "letter" | "issues"; keyDate?: boolean; letters?: Letters };

const SNOOZE_KEY = "superhub_home_snooze";
const TICK_MS = 60_000;
/** How long a ticked to-do stays in place, green, before it moves into Done. */
export const CHECK_HOLD_MS = 600;
const CHORES_KEY = ["/api/chores"];

function readSnooze(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useHomeDay(props: HomeDayProps) {
  const { chores, completions, events, selectedIds, familyIds, day, kidName, people = [], familyProfileId = null, familyColor = null, openEarlierKey = 0, onDeleteTodo } = props;
  const reduced = useReducedMotion() === true;
  const [earlierOpen, setEarlierOpen] = useState(false);
  useEffect(() => {
    if (openEarlierKey) setEarlierOpen(true);
  }, [openEarlierKey]);
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [showAllHorizon, setShowAllHorizon] = useState(false);
  const [showAllLetters, setShowAllLetters] = useState(false);
  const [kept, setKept] = useState<Record<string, string>>({});
  const [snooze, setSnooze] = useState<Record<string, number>>(readSnooze);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [holding, setHolding] = useState<Set<string>>(() => new Set());
  const holdTimers = useRef(new Map<string, number>());
  useEffect(() => () => holdTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const release = (id: string) => {
    const timer = holdTimers.current.get(id);
    if (timer != null) window.clearTimeout(timer);
    holdTimers.current.delete(id);
    setHolding((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const isCollapsed = (id: HomeCardId) => collapsed.has(id);
  const toggleCard = (id: HomeCardId) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveCollapsed(next);
  };
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
  const { data: calendarSettings } = useQuery<{ shareOriginals?: boolean | null; familyCalendarId?: string | null; mutedNewsletters?: string[] | null }>({
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
  const { data: praiseList = [] } = useQuery<Shoutout[]>(recentShoutoutsQuery);
  const { data: dailyContent = [] } = useQuery<DailyContentItem[]>({ queryKey: ["/api/daily-content"] });
  const { data: contentAssignments = [] } = useQuery<DailyContentAssignment[]>({ queryKey: ["/api/daily-content-assignments"] });

  // Rows leave the list the moment they're acted on, so they can slide away;
  // the server's answer then confirms it, or the list is put back.
  const dropChores = async (keep: (chore: Chore) => boolean) => {
    await queryClient.cancelQueries({ queryKey: CHORES_KEY });
    const prev = queryClient.getQueryData<Chore[]>(CHORES_KEY);
    queryClient.setQueryData<Chore[]>(CHORES_KEY, (old = []) => old.filter(keep));
    return { prev };
  };
  const restoreChores = (context?: { prev?: Chore[] }) => {
    if (context?.prev) queryClient.setQueryData(CHORES_KEY, context.prev);
  };
  const settleInbox = async () => {
    await queryClient.invalidateQueries({ queryKey: CHORES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
  };
  const stopEmails = useMutation({
    mutationFn: async (address: string) => {
      await apiRequest("POST", "/api/ingest/mute", { address });
    },
    onMutate: (address) => {
      const from = address.toLowerCase();
      const done = new Set(completions.map((completion) => completion.choreId));
      return dropChores((chore) => !(chore.category === "school_email" && !done.has(chore.id) && slipSender(chore.description)?.toLowerCase() === from));
    },
    onError: (_error, _address, context) => restoreChores(context),
    onSettled: async () => {
      await settleInbox();
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
    },
  });
  const hideLetters = useMutation({
    mutationFn: async (letters: Letters) => {
      await apiRequest("POST", "/api/ingest/newsletter/hide", { address: letters.sender, name: letters.muteName });
    },
    onMutate: (letters) => {
      const ids = new Set(letters.issues.map((issue) => issue.id));
      return dropChores((chore) => !ids.has(chore.id));
    },
    onError: (_error, _letters, context) => restoreChores(context),
    onSettled: async () => {
      await settleInbox();
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
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
  const removeItem = useMutation({
    mutationFn: async (chore: Chore) => {
      await apiRequest("POST", "/api/ingest/not-relevant", { title: chore.title });
    },
    onMutate: (chore) => dropChores((item) => item.id !== chore.id),
    onError: (_error, _chore, context) => restoreChores(context),
    onSettled: settleInbox,
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
    onMutate: async (choreId) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      hapticLight();
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      const points = chores.find((item) => item.id === choreId)?.points ?? 0;
      const temp = { id: `temp-${Date.now()}`, choreId, profileId, points, completedAt: new Date() } as ChoreCompletion;
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) => [...old, temp]);
      return { prev };
    },
    onError: (_error, _choreId, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/chore-completions"], context.prev);
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
    onMutate: async (choreId) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.filter((item) => !(item.choreId === choreId && item.profileId === profileId)));
      return { prev };
    },
    onError: (_error, _choreId, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/chore-completions"], context.prev);
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
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: CHORES_KEY });
      const prev = queryClient.getQueryData<Chore[]>(CHORES_KEY);
      queryClient.setQueryData<Chore[]>(CHORES_KEY, (old = []) =>
        old.map((chore) => (chore.id === change.choreId ? { ...chore, profileIds: change.profileIds } : chore)));
      return { prev };
    },
    onError: (_error, _change, context) => restoreChores(context),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: CHORES_KEY });
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

  const visibleChores = todosForHome(chores, selectedIds, familyIds, familyProfileId).filter((todo) => !kidName || schoolEmailNames(todo, kidName));
  const stillOpen = visibleChores.filter((todo) => !completions.some((completion) => completion.choreId === todo.id));
  const homeEvents = forPeople(events, selectedIds, familyIds, familyProfileId).filter((event) => mailVisibleToKid(event, kidName ?? null));
  const newsletters = newsletterGroups(stillOpen, now, calendarSettings?.mutedNewsletters ?? [])
    .map((letters) => ({ ...letters, issues: letters.issues.filter((issue) => !hidden(issue.id)) }))
    .filter((letters) => letters.issues.length > 0);
  const keyDates = mailKeyDates(
    stillOpen,
    homeEvents.filter((event) => !Object.values(kept).includes(event.id)),
    now,
  ).filter((row) => !hidden(row.id));
  const heldIds = new Set([...newsletterRowIds(visibleChores, now), ...keyDates.map((row) => row.id)]);
  const todoRows = planTodoRows(visibleChores.filter((todo) => !heldIds.has(todo.id)), completions, day, now).filter((todo) => !hidden(todo.id));
  const progress = choreProgress(choresForCount(chores, selectedIds, familyIds), completions, day);
  const dinner = dinnerName(meals, day);
  const birthday = homeBirthdayLine(celebrations, day);
  const todayEvents = eventsOnHomeDay(
    forPeople(events, selectedIds, familyIds, familyProfileId),
    day,
    kidName ?? null,
    dinner,
    schoolSlipsHeldOnHome(todosForHome(chores, selectedIds, familyIds, familyProfileId), completions, day),
  );
  const offCalendar = mailOffCalendar(stillOpen, homeEvents, day, now).filter((row) => !hidden(row.id));
  const drives = drivesOnHomeDay(events, day, selectedIds, kidName ?? null);
  const checkedSlips = todosForHome(chores, selectedIds, familyIds, familyProfileId).filter((todo) => todo.category === "school_email" && completions.some((completion) => completion.choreId === todo.id));
  const horizon = horizonWithoutChecked(homeEvents, day, checkedSlips);
  const comingEvents = [
    ...horizonBirthdays(celebrations, day).map((row) => ({ key: row.id, title: row.title, startTime: row.startTime as Date | string, allDay: true, location: null as string | null, drivers: [] as string[], calendarName: null as string | null, color: "#5E8FAD", eventId: "", profileIds: [] as string[], calendarColor: null as string | null })),
    ...horizon.map((event) => ({
      key: event.id,
      title: event.title,
      startTime: event.startTime,
      allDay: event.isAllDay === true,
      location: event.location ?? null,
      drivers: driverNamesFor(event.drivingProfileIds, people),
      calendarName: event.calendarName ?? null,
      color: event.color,
      eventId: event.id,
      profileIds: event.profileIds,
      calendarColor: event.calendarColor ?? null,
    })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const laterMail = horizonMail(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const laterTodos = horizonDatedTodos(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  const earlier = completedActions(
    completions.filter((completion) => selectedIds.length === 0 || allSelected || (!!completion.profileId && selectedIds.includes(completion.profileId))),
    now,
  );
  const everyone = selectedIds.length === 0 || allSelected;
  const praise = praiseForHome(praiseList, selectedIds, everyone, now);
  const notes = notesForHome(dailyContent, contentAssignments, selectedIds, everyone, familyProfileId, now);
  const earlierRows = [
    ...earlier.map((completion) => ({ kind: "done" as const, id: completion.id, at: new Date(completion.completedAt ?? 0), choreId: completion.choreId })),
    ...praise,
    ...notes,
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name;
  const daysOut = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const todosTitle = daysOut === 0 ? "Today's To-dos" : daysOut === 1 ? "Tomorrow's To-dos" : `${day.toLocaleDateString("en-US", { weekday: "long" })}'s To-dos`;
  const scheduleTitle = daysOut === 0 ? "Today's Schedule" : "Schedule";
  const openTodos = todoRows.filter((todo) => !todo.done || holding.has(todo.id));
  const doneTodos = todoRows.filter((todo) => todo.done && !holding.has(todo.id)).sort((a, b) => {
    const at = (id: string) => completions
      .filter((completion) => completion.choreId === id && completion.completedAt)
      .reduce((latest, completion) => Math.max(latest, new Date(completion.completedAt ?? 0).getTime()), 0);
    return at(b.id) - at(a.id);
  });
  // To-dos past due before yesterday leave the list. The ones the person
  // hasn't been told about yet are counted in a note at the top of the card.
  const [clearedSeen, setClearedSeen] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CLEARED_SEEN_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const cleared = daysOut === 0
    ? clearedTodos(visibleChores.filter((todo) => !heldIds.has(todo.id)), completions, now).filter((todo) => !hidden(todo.id) && !clearedSeen.includes(todo.id))
    : [];
  const ackCleared = () => {
    const next = [...new Set([...clearedSeen, ...cleared.map((todo) => todo.id)])].slice(-200);
    setClearedSeen(next);
    try { localStorage.setItem(CLEARED_SEEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const folded = !showAllTodos && openTodos.length > PLAN_TODO_FOLD;
  const visibleTodos = folded ? openTodos.slice(0, PLAN_TODO_FOLD) : openTodos;
  const dayStamp = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  useEffect(() => {
    setShowAllTodos(false);
    setShowDoneTodos(false);
  }, [dayStamp]);
  const visibleKeys = showAllKeys ? keyDates : keyDates.slice(0, PLAN_KEY_DATES);
  const visibleNewsletters = showAllLetters ? newsletters : newsletters.slice(0, PLAN_NEWSLETTERS);
  const forecast = forecastFor(weather?.days, day) ?? (daysOut === 0 && weather ? { high: weather.high, low: weather.low, condition: weather.condition } : null);

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
  const askStopEmails = async (chore: Chore) => {
    const address = slipSender(chore.description);
    if (!address) return;
    const name = slipSenderName(chore.description) ?? address;
    const ok = await confirmDialog({
      title: `Stop emails from ${name}?`,
      description: `Their open items leave Home now, and their future email is skipped. You can undo this in Settings.`,
      confirmLabel: "Stop emails",
    });
    if (ok) stopEmails.mutate(address);
  };
  const askHideLetters = async (letters: Letters) => {
    if (!letters.sender) return;
    const ok = await confirmDialog({
      title: `Stop showing ${letters.name}?`,
      description: "Its issues leave Home now, and new ones are skipped. You can undo this in Settings.",
      confirmLabel: "Stop showing",
    });
    if (ok) hideLetters.mutate(letters);
  };
  /** An inbox item is removed for good; a to-do someone made is deleted the usual way. */
  const removeRow = (chore: Chore) => {
    setRevealed(null);
    setSheet(null);
    if (chore.category === "school_email") removeItem.mutate(chore);
    else if (onDeleteTodo) onDeleteTodo(chore);
    else removeTodo.mutate(chore.id);
  };
  const checkOff = (id: string) => {
    complete.mutate(id);
    if (reduced) return;
    release(id);
    setHolding((current) => new Set(current).add(id));
    holdTimers.current.set(id, window.setTimeout(() => release(id), CHECK_HOLD_MS));
  };
  const uncheck = (id: string) => {
    release(id);
    undo.mutate(id);
  };
  const colorPeople = [
    ...people,
    ...(familyProfileId ? [{ id: familyProfileId, name: "Everyone", color: familyColor, isAllFamilyProfile: true }] : []),
  ];

  return {
    props: { ...props, people, familyProfileId, familyColor },
    reduced,
    colorPeople,
    now,
    daysOut,
    todosTitle,
    scheduleTitle,
    calendarSettings,
    isCollapsed,
    toggleCard,
    earlierOpen, setEarlierOpen,
    showAllTodos, setShowAllTodos,
    showDoneTodos, setShowDoneTodos,
    showAllKeys, setShowAllKeys,
    showAllHorizon, setShowAllHorizon,
    showAllLetters, setShowAllLetters,
    kept,
    sheet, setSheet,
    revealed, setRevealed,
    snoozeItem,
    checkOff, uncheck, removeRow, askStopEmails,
    saveSchool, complete, undo, assign, removeTodo, removeItem, stopEmails, addToCalendar, removeFromCalendar,
    newsletters, visibleNewsletters, hideLetters, askHideLetters,
    keyDates, visibleKeys,
    openTodos, doneTodos, folded, visibleTodos,
    cleared, ackCleared,
    progress,
    dinner, birthday,
    todayEvents, offCalendar,
    drives,
    comingEvents, laterMail, laterTodos,
    earlierRows, praise, notes, nameOf,
    forecast,
    placeMail,
  };
}

export type HomeModel = ReturnType<typeof useHomeDay>;

const CLEARED_SEEN_KEY = "superhub_cleared_todos_seen";
