import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { driverNamesFor } from "@/lib/homeDay";
import { eventSourceChip } from "@/lib/upcoming";
import { appendPlace, planEventTitle } from "@/lib/chatTools";
import { eventStrip } from "@/lib/eventColor";
import { EventRow } from "@/components/event-row";
import { HomeCard } from "./HomeCard";
import type { HomeModel } from "./useHomeDay";

const clockOf = (at: Date | string) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function ScheduleCard({ home }: { home: HomeModel }) {
  const { day, people, onOpenEvent, onOpenCalendar, onRefresh, calendarStatus, onOpenCalendarSettings } = home.props;
  const { todayEvents, offCalendar, dinner, birthday, daysOut, now, placeMail, setSheet, colorPeople } = home;
  const [refreshing, setRefreshing] = useState(false);
  const timed = todayEvents
    .filter((event) => event.isAllDay !== true)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const next = daysOut === 0 ? timed.find((event) => new Date(event.endTime ?? event.startTime) > now) : timed[0];
  const count = todayEvents.length + offCalendar.length;
  const summary = next
    ? `${daysOut === 0 ? "Next" : "First"}: ${clockOf(next.startTime)} ${next.title}`
    : count > 0 ? (count === 1 ? "1 event" : `${count} events`) : "Nothing on the calendar";
  return (
    <HomeCard
      id="schedule"
      testId="home-today-events"
      title={home.scheduleTitle}
      summary={summary}
      collapsed={home.isCollapsed("schedule")}
      onToggle={() => home.toggleCard("schedule")}
      actions={onRefresh && (
        <button
          type="button"
          aria-label="Refresh calendars"
          className="grid h-8 w-8 shrink-0 place-items-center"
          onClick={() => {
            setRefreshing(true);
            onRefresh();
            window.setTimeout(() => setRefreshing(false), 800);
          }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      )}
    >
      {/* A connection that expired still reads as connected; only the failed
          fetch says so, and without this line the day just looks empty. */}
      {!!calendarStatus?.failing.length && (
        <button
          type="button"
          onClick={onOpenCalendarSettings}
          className="mb-2 block text-left text-xs text-destructive underline decoration-dotted"
          data-testid="calendar-sync-error-cta"
        >
          {calendarStatus.failing.join(" and ")} couldn't sync
        </button>
      )}
      {todayEvents.length === 0 && offCalendar.length === 0 ? (
        calendarStatus && !calendarStatus.connected ? (
          <button type="button" onClick={onOpenCalendarSettings} className="text-left text-sm font-medium text-[#5E8FAD]" data-testid="connect-calendar-cta">
            Connect a calendar to see your events here
          </button>
        ) : calendarStatus?.failing.length ? (
          <button type="button" onClick={onOpenCalendarSettings} className="text-left text-sm font-medium text-destructive" data-testid="calendar-needs-reconnect-cta">
            Reconnect {calendarStatus.failing.join(" and ")} to see your events again
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing on the calendar.</p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {todayEvents.map((event) => {
            const chip = eventSourceChip(event.source, event.description);
            return (
              <li key={event.id}>
                <EventRow
                  testId="home-event"
                  colors={eventStrip(event, colorPeople)}
                  tinted
                  time={event.isAllDay === true ? "All day" : clockOf(event.startTime)}
                  title={planEventTitle(appendPlace(event.title, event.location), driverNamesFor(event.drivingProfileIds, people))}
                  chips={chip && <span data-testid="event-scan-chip" className="mt-1 inline-block rounded-full bg-white/70 px-2 py-0.5 text-xs">{chip}</span>}
                  onClick={() => onOpenEvent?.(event.id)}
                />
              </li>
            );
          })}
          {offCalendar.map((row) => (
            <li key={row.id}>
              <EventRow
                testId="home-off-calendar"
                colors={eventStrip({ profileIds: row.profileIds }, colorPeople)}
                dashed
                time={row.time}
                title={row.title}
                detail="Not on your calendar"
                onClick={() => setSheet({ chore: row, mode: "source" })}
                onContextMenu={(event) => { event.preventDefault(); placeMail(row, day, false); }}
              />
            </li>
          ))}
        </ul>
      )}
      {onOpenCalendar && (
        <button type="button" data-testid="home-open-calendar" className="mt-3 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={onOpenCalendar}>
          Open in Calendar
        </button>
      )}
      {dinner && <p data-testid="home-dinner" className="mt-3 text-sm">Dinner. {dinner}</p>}
      {birthday && <p data-testid="home-birthday" className="mt-1 text-sm">{birthday}</p>}
    </HomeCard>
  );
}
