import { useState } from "react";
import { Calendar, CalendarPlus, CheckCheck, ClipboardList, ListTodo, Newspaper, Plus } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Event, Meal } from "@workspace/shared-types";
import { choreProgress, choresForCount, dinnerName, driverNamesFor, drivesOnHomeDay, earlierForHome, eventsOnHomeDay, homeBirthdayLine, horizonBirthdays, horizonWithoutChecked, mailVisibleToKid, openTodos, schoolEmailNames, schoolHomeTitle, schoolSlipsHeldOnHome, todosForHome, visibleForProfiles } from "@/lib/homeDay";
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
  people?: { id: string; name: string; school?: string | null; isChild?: boolean | null; role?: string | null; connected?: boolean }[];
  onOpenChores: () => void;
  onAddTodo?: () => void;
  onOpenCalendar?: () => void;
  onOpenEvent?: (eventId: string) => void;
};

export function HomeDay({ chores, completions, events, selectedIds, familyIds, day, kidName, personId, people = [], onOpenChores, onAddTodo, onOpenCalendar, onOpenEvent }: Props) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [showAllTodos, setShowAllTodos] = useState(false);
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
  const coming: { key: string; title: string; startTime: Date | string; allDay: boolean; source: string | null; location: string | null; drivers: string[] }[] = [
    ...horizonBirthdays(celebrations, day).map((row) => ({ key: row.id, title: row.title, startTime: row.startTime, allDay: true, source: null as string | null, location: null as string | null, drivers: [] as string[] })),
    ...horizon.map((event) => ({ key: event.id, title: event.title, startTime: event.startTime, allDay: event.isAllDay === true, source: event.source ?? null, location: event.location ?? null, drivers: driverNamesFor(event.drivingProfileIds, people) })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const earlier = earlierForHome(completions, selectedIds, familyIds, day);

  const keyDates = coming.filter((row) => row.allDay);
  const horizonRows = coming.filter((row) => !row.allDay);
  const daysOut = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) / 86400000);
  const todosTitle = daysOut === 0 ? "Today's To-dos" : daysOut === 1 ? "Tomorrow's To-dos" : `${day.toLocaleDateString("en-US", { weekday: "long" })}'s To-dos`;
  const scheduleTitle = daysOut === 0 ? "Today's Schedule" : "Schedule";
  const folded = !showAllTodos && todos.length > 5;
  const visibleTodos = folded ? todos.slice(0, 5) : todos;
  const namesFor = (ids: string[]) => ids.map((id) => people.find((person) => person.id === id)?.name).filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-3" data-testid="home-day">
      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="text-2xl font-display leading-tight">{day.toLocaleDateString("en-US", { weekday: "long" })}</div>
        <div className="text-sm text-muted-foreground">{day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
      </section>

      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="font-display text-lg">{todosTitle}</h2>
          {onAddTodo && (
            <button type="button" aria-label="Add a to-do" className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-border" onClick={onAddTodo}>
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        {todos.length === 0 ? (
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
              const who = namesFor(todo.profileIds ?? []);
              return (
              <li key={todo.id} data-testid={`home-todo-${todo.id}`} className="flex items-start gap-3 border-t border-border py-3 first:border-t-0">
                <button
                  type="button"
                  aria-label={`Check off ${todo.title}`}
                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-[#5E8FAD]"
                  onClick={() => complete.mutate(todo.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug line-clamp-2">{title}</div>
                  {quote && <div data-testid="home-todo-quote" className="mt-1 text-sm leading-snug text-muted-foreground line-clamp-3">{quote}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {todo.category === "school_email" ? (
                      <span data-testid="home-todo-source" className="inline-block rounded-full bg-muted px-2 py-0.5">Source: School email</span>
                    ) : (
                      <span className="inline-block rounded-full bg-muted px-2 py-0.5">To-do</span>
                    )}
                    {who && <span className="inline-block rounded-full bg-[#E7F1F6] px-2 py-0.5 text-[#5E8FAD]">{who}</span>}
                    {todo.category === "school_email" && (
                      <>
                        <button type="button" data-testid="home-todo-not-relevant" className="underline" onClick={() => dismissSlip.mutate(todo.title)}>
                          Not relevant
                        </button>
                        {sender && (
                          <button type="button" data-testid="home-todo-mute" className="underline" onClick={() => muteSender.mutate(sender)}>
                            Mute sender
                          </button>
                        )}
                        {emailHref && (
                          <a data-testid="home-todo-open-email" className="underline" href={emailHref}>Open email</a>
                        )}
                        {offer && (
                          <button type="button" data-testid="home-todo-save-school" className="underline" onClick={() => saveSchool.mutate(offer)}>
                            Save {offer.school}{offer.profileId === personId ? "" : ` for ${offer.name}`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
        {folded && (
          <button type="button" className="mt-1 text-sm font-semibold text-[#5E8FAD]" onClick={() => setShowAllTodos(true)}>
            Show {todos.length - visibleTodos.length} more
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="font-display text-lg">Key Dates to Add</h2>
        </div>
        {keyDates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new dates to add.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {keyDates.slice(0, 5).map((row) => (
              <li key={row.key} className="text-sm">
                <div className="font-medium">{planEventTitle(appendPlace(row.title, row.location), row.drivers)}</div>
                <div className="mt-0.5 text-muted-foreground">{eventClockLine(row.title, row.startTime, true, true).replace(`${row.title}, `, "")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        data-testid="home-chore-count"
        onClick={onOpenChores}
        className="flex w-full items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-left"
      >
        <ClipboardList className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
        <span className="font-display text-lg">Chores</span>
        <span className="ml-auto text-sm text-muted-foreground">{progress.done} of {progress.total}</span>
      </button>

      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="font-display text-lg">School Newsletter</h2>
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

      <section className="rounded-2xl border border-border bg-card px-4 py-3" data-testid="home-today-events">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
          <h2 className="font-display text-lg">{scheduleTitle}</h2>
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
        <section data-testid="home-driving" className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 font-display text-lg">Driving</h2>
          <ul className="flex flex-col gap-1">
            {drives.map((event) => (
              <li key={event.id} className="text-sm">
                {appendPlace(eventClockLine(event.title, event.startTime, true, event.isAllDay === true), event.location)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-testid="home-horizon" className="rounded-2xl border border-border bg-card px-4 py-3">
        <h2 className="mb-2 font-display text-lg">On the Horizon</h2>
        {horizonRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">A quiet week ahead.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {horizonRows.slice(0, 5).map((row) => (
              <li key={row.key} className="text-sm">
                <div className="font-medium">{planEventTitle(appendPlace(row.title, row.location), row.drivers)}</div>
                <div className="text-muted-foreground">{eventClockLine("", row.startTime, true, row.allDay)}</div>
                {eventSourceChip(row.source) && (
                  <span data-testid="event-scan-chip" className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">{eventSourceChip(row.source)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {onOpenCalendar && (
          <button type="button" className="mt-3 rounded-full bg-muted px-3 py-1 text-sm font-semibold" onClick={onOpenCalendar}>
            View all
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <button
          type="button"
          data-testid="home-earlier-toggle"
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={earlierOpen}
          onClick={() => setEarlierOpen((open) => !open)}
        >
          <CheckCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="font-display text-lg">Completed Actions</span>
          <span className="ml-auto rounded-full bg-[#5E8FAD] px-2 py-0.5 text-xs font-semibold text-white">{earlier.length}</span>
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
