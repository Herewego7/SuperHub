import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Event, Meal } from "@workspace/shared-types";
import { choreProgress, dinnerName, horizonEvents, todosForHome } from "@/lib/homeDay";

type Props = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: Event[];
  selectedIds: string[];
  familyIds: string[];
  day: Date;
  onOpenChores: () => void;
};

export function HomeDay({ chores, completions, events, selectedIds, familyIds, day, onOpenChores }: Props) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const { data: meals = [] } = useQuery<Meal[]>({
    queryKey: ["/api/meals", dayKey, dayKey],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals?start=${dayKey}&end=${dayKey}`);
      return res.json();
    },
  });

  const complete = useMutation({
    mutationFn: async (choreId: string) => {
      const profileId = chores.find((chore) => chore.id === choreId)?.profileIds[0];
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

  const todos = todosForHome(chores, selectedIds, familyIds);
  const progress = choreProgress(chores, completions, day);
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const todayEvents = events.filter((event) => {
    const at = new Date(event.startTime);
    return at >= start && at < end;
  });
  const horizon = horizonEvents(events, day);
  const dinner = dinnerName(meals, day);
  const earlier = completions.filter((completion) => {
    if (!completion.completedAt) return false;
    const at = new Date(completion.completedAt);
    return at >= start && at < end;
  });

  return (
    <div className="flex flex-col gap-4" data-testid="home-day">
      <section>
        <h2 className="font-display text-lg mb-2">To-dos</h2>
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todos.map((todo) => (
              <li key={todo.id} data-testid={`home-todo-${todo.id}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card px-3 py-2">
                <button
                  type="button"
                  aria-label={`Check off ${todo.title}`}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-[#5E8FAD]"
                  onClick={() => complete.mutate(todo.id)}
                />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{todo.title}</div>
                  {todo.description && <div className="text-sm text-muted-foreground">{todo.description}</div>}
                  <div className="mt-1 text-xs text-muted-foreground">To-do</div>
                </div>
              </li>
            ))}
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
              <li key={event.id} className="text-sm">{event.title}</li>
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
              <li key={event.id} className="text-sm">{event.title}</li>
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
