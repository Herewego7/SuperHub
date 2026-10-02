import { useState, type ReactNode } from "react";
import { Calendar, CalendarPlus, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, ListTodo, MoreVertical, Newspaper, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Event, Meal } from "@workspace/shared-types";
import { choreProgress, choresForCount, dinnerName, driverNamesFor, drivesOnHomeDay, earlierForHome, eventsOnHomeDay, homeBirthdayLine, horizonBirthdays, horizonWithoutChecked, mailVisibleToKid, openTodos, plainEventDetail, schoolEmailNames, schoolHomeTitle, schoolSlipsHeldOnHome, todosForHome, visibleForProfiles } from "@/lib/homeDay";
import { eventSourceChip } from "@/lib/upcoming";
import { appendPlace, eventClockLine, planEventTitle, pointsProfileId } from "@/lib/chatTools";
import { openEmailHref, schoolSaveTarget, slipQuote, slipSender } from "@/lib/slipMail";

type Props = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: Event[];
  selectedIds: string[];
  familyIds: string[];
  day: Date;
  kidName?: string | null;
  personId?: string | null;
  people?: { id: string; name: string; color?: string | null; school?: string | null; isChild?: boolean | null; role?: string | null; connected?: boolean }[];
  onOpenChores: () => void;
  onAddTodo?: () => void;
  onEditTodo?: (chore: Chore) => void;
  onDeleteTodo?: (chore: Chore) => void;
  onOpenCalendar?: () => void;
  onOpenEvent?: (eventId: string) => void;
  onShiftDay?: (by: number) => void;
};

const SNOOZE_KEY = "superhub_home_snooze";

function readSnooze(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function snoozeMoment(which: "tonight" | "tomorrow" | "week"): number {
  const at = new Date();
  if (which === "tonight") {
    at.setHours(20, 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  } else if (which === "tomorrow") {
    at.setDate(at.getDate() + 1);
    at.setHours(8, 0, 0, 0);
  } else {
    at.setDate(at.getDate() + 7);
    at.setHours(8, 0, 0, 0);
  }
  return at.getTime();
}

function planWhen(start: Date | string, allDay: boolean): string {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return day;
  return `${day} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function HomeDay({ chores, completions, events, selectedIds, familyIds, day, kidName, personId, people = [], onOpenChores, onAddTodo, onEditTodo, onDeleteTodo, onOpenCalendar, onOpenEvent, onShiftDay }: Props) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [snooze, setSnooze] = useState<Record<string, number>>(readSnooze);
  const hidden = (id: string) => (snooze[id] ?? 0) > Date.now();
  const snoozeItem = (id: string, which: "tonight" | "tomorrow" | "week") => {
    const next = { ...snooze, [id]: snoozeMoment(which) };
    setSnooze(next);
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
  };
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const { data: calendarSettings } = useQuery<{ shareOriginals?: boolean | null }>({
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

  const complete = useMutation({
    mutationFn: async (choreId: string) => {
      const chore = chores.find((item) => item.id === choreId);
      const profileId = pointsProfileId(chore?.profileIds ?? [], selectedIds.join(","));
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
      const chore = chores.find((item) => item.id === choreId);
      const profileId = pointsProfileId(chore?.profileIds ?? [], selectedIds.join(","));
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });

  const open = openTodos(todosForHome(chores, selectedIds, familyIds), completions).filter((todo) => !kidName || schoolEmailNames(todo, kidName));
  const newsletters = open.filter((todo) => todo.category === "school_email" && !slipQuote(todo.description));
  const todos = open.filter((todo) => todo.category !== "school_email" || !!slipQuote(todo.description));
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
  const drives = drivesOnHomeDay(events, day, selectedIds, kidName ?? null);
  const checkedSlips = todosForHome(chores, selectedIds, familyIds).filter((todo) => todo.category === "school_email" && completions.some((completion) => completion.choreId === todo.id));
  const horizon = horizonWithoutChecked(
    visibleForProfiles(events, selectedIds).filter((event) => mailVisibleToKid(event, kidName ?? null)),
    day,
    checkedSlips,
  );
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

  const coming: { key: string; title: string; startTime: Date | string; allDay: boolean; source: string | null; location: string | null; drivers: string[]; calendarName: string | null; detail: string | null }[] = [
    ...horizonBirthdays(celebrations, day).map((row) => ({ key: row.id, title: row.title, startTime: row.startTime, allDay: true, source: null as string | null, location: null as string | null, drivers: [] as string[], calendarName: null as string | null, detail: null as string | null })),
    ...horizon.map((event) => ({ key: event.id, title: event.title, startTime: event.startTime, allDay: event.isAllDay === true, source: event.source ?? null, location: event.location ?? null, drivers: driverNamesFor(event.drivingProfileIds, people), calendarName: event.calendarName ?? null, detail: plainEventDetail(event.description) })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const earlier = earlierForHome(completions, selectedIds, familyIds, day);

  const keyDates = coming.filter((row) => row.allDay);
  const horizonRows = coming.filter((row) => !row.allDay);
  const daysOut = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) / 86400000);
  const todosTitle = daysOut === 0 ? "Today's To-dos" : daysOut === 1 ? "Tomorrow's To-dos" : `${day.toLocaleDateString("en-US", { weekday: "long" })}'s To-dos`;
  const scheduleTitle = daysOut === 0 ? "Today's Schedule" : "Schedule";
  const shownTodos = todos.filter((todo) => !hidden(todo.id));
  const folded = !showAllTodos && shownTodos.length > 5;
  const visibleTodos = folded ? shownTodos.slice(0, 5) : shownTodos;
  const shownKeyDates = keyDates.filter((row) => !hidden(row.key));

  return (
    <div className="flex flex-col gap-3.5" data-testid="home-day">
      <section className="plan-card flex items-center gap-1">
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
        {shownTodos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{daysOut === 0 ? "Nothing that needs you today." : "Nothing due this day."}</p>
        ) : (
          <ul className="flex flex-col">
            {visibleTodos.map((todo) => {
              const quote = slipQuote(todo.description);
              const title = todo.category === "school_email" ? schoolHomeTitle(todo.title, events, day, people) : todo.title;
              const sender = slipSender(todo.description);
              const offer = schoolSaveTarget(todo.title, todo.description, people, personId ?? null);
              const viewer = people.find((person) => person.id === personId);
              const emailHref = openEmailHref(calendarSettings?.shareOriginals === true, sender, {
                isChild: !!kidName,
                ownsAccount: viewer?.connected === true,
              });
              const whoId = (todo.profileIds ?? [])[0];
              const who = people.find((person) => person.id === whoId);
              return (
              <li key={todo.id} data-testid={`home-todo-${todo.id}`} className="flex items-start gap-3 border-t border-[#ececf0] py-3 first:border-t-0">
                <button
                  type="button"
                  aria-label={`Check off ${todo.title}`}
                  className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#a0a0a8]"
                  onClick={() => complete.mutate(todo.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug line-clamp-2">{title}</div>
                  {quote && <div data-testid="home-todo-quote" className="mt-1 text-sm leading-snug text-[#6e6e78] line-clamp-3">{quote}</div>}
                  <div className="mt-2 flex items-center gap-2">
                    <span data-testid="home-todo-source" className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">
                      {todo.category === "school_email" ? "Source: School email" : "To-do"}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#E7F1F6] px-2.5 py-1 text-xs font-medium text-[#5E8FAD]">
                          {who?.name ?? "Assign"} <span aria-hidden="true">▾</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {people.map((person) => (
                          <DropdownMenuItem key={person.id} onClick={() => assign.mutate({ choreId: todo.id, profileIds: [person.id] })}>
                            {person.name}{person.id === personId ? " (me)" : ""}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onClick={() => assign.mutate({ choreId: todo.id, profileIds: [] })}>Unassigned</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <RowMenu label={`More actions for ${title}`}>
                      <DropdownMenuItem onClick={() => onEditTodo?.(todo)}>Edit</DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Snooze</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => snoozeItem(todo.id, "tonight")}>Tonight</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => snoozeItem(todo.id, "tomorrow")}>Tomorrow</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => snoozeItem(todo.id, "week")}>Next week</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {personId && whoId !== personId && (
                        <DropdownMenuItem onClick={() => assign.mutate({ choreId: todo.id, profileIds: [personId] })}>I'll do it</DropdownMenuItem>
                      )}
                      {emailHref && <DropdownMenuItem asChild><a data-testid="home-todo-open-email" href={emailHref}>View source</a></DropdownMenuItem>}
                      {sender && <DropdownMenuItem data-testid="home-todo-mute" onClick={() => muteSender.mutate(sender)}>Mute sender</DropdownMenuItem>}
                      {todo.category === "school_email" && (
                        <DropdownMenuItem data-testid="home-todo-not-relevant" onClick={() => dismissSlip.mutate(todo.title)}>Not relevant</DropdownMenuItem>
                      )}
                      {offer && (
                        <DropdownMenuItem data-testid="home-todo-save-school" onClick={() => saveSchool.mutate(offer)}>
                          Save {offer.school}{offer.profileId === personId ? "" : ` for ${offer.name}`}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => onDeleteTodo ? onDeleteTodo(todo) : removeTodo.mutate(todo.id)}>Delete task</DropdownMenuItem>
                    </RowMenu>
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
        {folded && (
          <button type="button" className="mt-1 text-sm font-semibold text-[#5E8FAD]" onClick={() => setShowAllTodos(true)}>
            Show {shownTodos.length - visibleTodos.length} more
          </button>
        )}
      </section>

      <section className="plan-card">
        <div className="mb-2 flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">Key Dates to Add</h2>
        </div>
        {shownKeyDates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new dates to add.</p>
        ) : (
          <ul className="flex flex-col">
            {shownKeyDates.slice(0, 5).map((row) => {
              const title = planEventTitle(appendPlace(row.title, row.location), row.drivers);
              const source = row.calendarName ? `Calendar: ${row.calendarName}` : eventSourceChip(row.source) ? `Source: ${eventSourceChip(row.source)}` : null;
              return (
              <li key={row.key} className="flex items-start gap-3 border-t border-[#ececf0] py-3 first:border-t-0">
                <button
                  type="button"
                  aria-label={`Open ${row.title}`}
                  className="mt-0.5 h-[21px] w-[21px] shrink-0 rounded-[5px] border-[1.5px] border-[#a0a0a8]"
                  onClick={() => onOpenEvent?.(row.key)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug">{title}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-[#6e6e78]">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    {planWhen(row.startTime, row.allDay)}
                  </div>
                  {row.detail && <div className="mt-1 text-sm leading-snug text-[#6e6e78] line-clamp-3">{row.detail}</div>}
                  <div className="mt-2 flex items-center gap-2">
                    {source && <span className="inline-flex max-w-[70%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">{source}</span>}
                    <RowMenu label={`More actions for ${row.title}`}>
                      <DropdownMenuItem onClick={() => onOpenEvent?.(row.key)}>Edit</DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Snooze</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => snoozeItem(row.key, "tonight")}>Tonight</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => snoozeItem(row.key, "tomorrow")}>Tomorrow</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => snoozeItem(row.key, "week")}>Next week</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onClick={() => snoozeItem(row.key, "week")}>Not relevant</DropdownMenuItem>
                    </RowMenu>
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        type="button"
        data-testid="home-chore-count"
        onClick={onOpenChores}
        className="flex w-full items-center gap-2 plan-card text-left"
      >
        <ClipboardList className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
        <span className="text-[17px] font-medium">Chores</span>
        <span className="ml-auto text-sm text-muted-foreground">{progress.done} of {progress.total}</span>
      </button>

      <section className="plan-card">
        <div className="mb-2 flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">School Newsletter</h2>
        </div>
        {newsletters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No school newsletters yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {newsletters.slice(0, 3).map((todo) => {
              const sender = slipSender(todo.description);
              return (
              <li key={todo.id} className="rounded-xl bg-[#E7F1F6] px-3 py-2">
                <div className="text-sm font-medium">{todo.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <button type="button" className="underline" onClick={() => dismissSlip.mutate(todo.title)}>Not relevant</button>
                  {sender && <button type="button" className="underline" onClick={() => muteSender.mutate(sender)}>Mute sender</button>}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="plan-card" data-testid="home-today-events">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="text-[17px] font-medium">{scheduleTitle}</h2>
        </div>
        {todayEvents.length === 0 ? (
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
          </ul>
        )}
        {dinner && (
          <p data-testid="home-dinner" className="mt-3 text-sm">Dinner. {dinner}</p>
        )}
        {birthday && (
          <p data-testid="home-birthday" className="mt-1 text-sm">{birthday}</p>
        )}
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
        {horizonRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">A quiet week ahead.</p>
        ) : (
          <ul className="flex flex-col">
            {horizonRows.slice(0, 5).map((row, index) => {
              const source = row.calendarName ? `Calendar: ${row.calendarName}` : eventSourceChip(row.source) ? `Source: ${eventSourceChip(row.source)}` : null;
              const bar = ["#5E8FAD", "#2E8B57", "#C97B5F", "#8FA4B8"][index % 4];
              return (
              <li key={row.key} className="border-t border-[#ececf0] first:border-t-0">
                <button type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => onOpenEvent?.(row.key)}>
                  <span className="mt-1 h-9 w-1 shrink-0 rounded-full" style={{ background: bar }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug">{planEventTitle(row.title, row.drivers)}</span>
                    <span className="mt-1 block text-xs text-[#6e6e78]">{planWhen(row.startTime, row.allDay)}</span>
                    {row.location && <span className="mt-1 block text-sm leading-snug text-[#6e6e78]">{row.location}</span>}
                    {source && <span data-testid="event-scan-chip" className="mt-2 inline-flex max-w-full truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">{source}</span>}
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#a0a0a8]" aria-hidden="true" />
                </button>
              </li>
              );
            })}
          </ul>
        )}
        {onOpenCalendar && (
          <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={onOpenCalendar}>
            View all
          </button>
        )}
      </section>

      <section className="plan-card">
        <button
          type="button"
          data-testid="home-earlier-toggle"
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={earlierOpen}
          onClick={() => setEarlierOpen((open) => !open)}
        >
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
    </div>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className="grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]">
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
