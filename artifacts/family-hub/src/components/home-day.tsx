import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Event, Meal } from "@workspace/shared-types";
import { choreProgress, choresForCount, dinnerName, earlierForHome, eventsOnHomeDay, horizonEvents, mailVisibleToKid, openTodos, schoolEmailNames, todosForHome, visibleForProfiles } from "@/lib/homeDay";
import { eventSourceChip } from "@/lib/upcoming";
import { eventClockLine } from "@/lib/chatTools";
import { openEmailHref, schoolFromSlip, slipQuote, slipSender } from "@/lib/slipMail";

type Props = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: Event[];
  selectedIds: string[];
  familyIds: string[];
  day: Date;
  kidName?: string | null;
  personId?: string | null;
  personSchool?: string | null;
  onOpenChores: () => void;
};

export function HomeDay({ chores, completions, events, selectedIds, familyIds, day, kidName, personId, personSchool, onOpenChores }: Props) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const { data: calendarSettings } = useQuery<{ shareOriginals?: boolean | null }>({
    queryKey: ["/api/calendar-settings"],
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
    mutationFn: async (school: string) => {
      if (!personId) return;
      await apiRequest("POST", "/api/ingest/school", { profileId: personId, school });
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
      const profileId = chore?.profileIds[0] ?? selectedIds[0];
      if (!profileId) return;
      const at = new Date();
      const localDayStart = new Date(at);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("POST", "/api/chore-completions", {
        choreId,
        profileId,
        points: 0,
        completedAt: at.toISOString(),
        localDayStart: localDayStart.toISOString(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
    },
  });

  const todos = openTodos(todosForHome(chores, selectedIds, familyIds), completions).filter((todo) => !kidName || schoolEmailNames(todo, kidName));
  const progress = choreProgress(choresForCount(chores, selectedIds, familyIds), completions, day);
  const dinner = dinnerName(meals, day);
  const todayEvents = eventsOnHomeDay(visibleForProfiles(events, selectedIds), day, kidName, dinner);
  const horizon = visibleForProfiles(horizonEvents(events, day), selectedIds).filter((event) => mailVisibleToKid(event, kidName));
  const earlier = earlierForHome(completions, selectedIds, familyIds, day);

  return (
    <div className="flex flex-col gap-4" data-testid="home-day">
      <section>
        <h2 className="font-display text-lg mb-2">To-dos</h2>
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todos.map((todo) => {
              const quote = slipQuote(todo.description);
              const sender = slipSender(todo.description);
              const school = schoolFromSlip(todo.title, todo.description);
              const offerSchool = Boolean(school && personId && !personSchool);
              const emailHref = openEmailHref(calendarSettings?.shareOriginals === true, sender);
              return (
              <li key={todo.id} data-testid={`home-todo-${todo.id}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card px-3 py-2">
                <button
                  type="button"
                  aria-label={`Check off ${todo.title}`}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-[#5E8FAD]"
                  onClick={() => complete.mutate(todo.id)}
                />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{todo.title}</div>
                  {quote && <div data-testid="home-todo-quote" className="text-sm text-muted-foreground">{quote}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {todo.category === "school_email" ? (
                      <>
                        <span data-testid="home-todo-source" className="inline-block rounded-full bg-muted px-2 py-0.5">School email</span>
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
                        {offerSchool && (
                          <button type="button" data-testid="home-todo-save-school" className="underline" onClick={() => saveSchool.mutate(school)}>
                            Save {school}
                          </button>
                        )}
                      </>
                    ) : (
                      "To-do"
                    )}
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
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-3 text-left"
      >
        <span className="font-medium">Chores</span>
        <span className="text-sm text-muted-foreground">{progress.done} of {progress.total}</span>
      </button>

      <section data-testid="home-today-events">
        <h2 className="font-display text-lg mb-2">Today</h2>
        {todayEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {todayEvents.slice(0, 6).map((event) => (
              <li key={event.id} className="text-sm">
                {eventClockLine(event.title, event.startTime, false, event.isAllDay === true)}
                {eventSourceChip(event.source) && (
                  <span data-testid="event-scan-chip" className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{eventSourceChip(event.source)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="home-horizon">
        <h2 className="font-display text-lg mb-2">On the Horizon</h2>
        {horizon.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in the next week.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {horizon.slice(0, 5).map((event) => (
              <li key={event.id} className="text-sm">
                {eventClockLine(event.title, event.startTime, true, event.isAllDay === true)}
                {eventSourceChip(event.source) && (
                  <span data-testid="event-scan-chip" className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{eventSourceChip(event.source)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dinner && (
        <p data-testid="home-dinner" className="text-sm">
          Dinner. {dinner}
        </p>
      )}

      <section>
        <button
          type="button"
          data-testid="home-earlier-toggle"
          className="text-sm font-medium text-muted-foreground"
          aria-expanded={earlierOpen}
          onClick={() => setEarlierOpen((open) => !open)}
        >
          Earlier today
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
