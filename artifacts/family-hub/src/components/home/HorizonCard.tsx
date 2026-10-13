import { MoreVertical } from "lucide-react";
import { PLAN_HORIZON, planDateLabel, sourceChipLabel } from "@/lib/homeDay";
import { planEventTitle } from "@/lib/chatTools";
import { slipSender } from "@/lib/slipMail";
import { eventStrip } from "@/lib/eventColor";
import { EventRow } from "@/components/event-row";
import { HomeCard } from "./HomeCard";
import { PersonChips } from "./PersonChips";
import type { HomeModel } from "./useHomeDay";

export function HorizonCard({ home }: { home: HomeModel }) {
  const { onOpenEvent, onOpenCalendar } = home.props;
  const { comingEvents, laterMail, laterTodos, showAllHorizon, setShowAllHorizon, complete, assign, setSheet } = home;
  const first = [
    ...comingEvents.map((row) => ({ title: row.title, at: new Date(row.startTime) })),
    ...laterTodos.map((row) => ({ title: row.title, at: row.start })),
    ...laterMail.map((row) => ({ title: row.title, at: row.start })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const summary = first ? `Next: ${planDateLabel(first.at, null)} · ${first.title}` : "A quiet week ahead";
  return (
    <HomeCard id="horizon" testId="home-horizon" title="On the Horizon" summary={summary} collapsed={home.isCollapsed("horizon")} onToggle={() => home.toggleCard("horizon")}>
      {comingEvents.length === 0 && laterMail.length === 0 && laterTodos.length === 0 ? (
        <p className="text-sm text-muted-foreground">A quiet week ahead.</p>
      ) : (
        <ul className="flex flex-col">
          {(showAllHorizon ? comingEvents : comingEvents.slice(0, PLAN_HORIZON)).map((row) => (
            <li key={row.key}>
              <EventRow
                testId="home-horizon-event"
                colors={row.profileIds.length > 0 ? eventStrip(row, home.colorPeople) : [row.color]}
                time={(
                  <>
                    {planDateLabel(new Date(row.startTime), null)}
                    {!row.allDay && <span className="block">{new Date(row.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
                  </>
                )}
                title={planEventTitle(row.title, row.drivers)}
                detail={row.location}
                chips={row.calendarName && <span data-testid="event-scan-chip" className="mt-2 inline-flex max-w-full truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">Calendar: {row.calendarName}</span>}
                onClick={row.eventId ? () => onOpenEvent?.(row.eventId) : undefined}
              />
            </li>
          ))}
          {laterTodos.map((row) => {
            const sender = slipSender(row.description);
            return (
              <li key={row.id} data-testid={`home-horizon-todo-${row.id}`} className="flex items-start gap-3 border-t border-[#ececf0] py-3">
                <button type="button" aria-label={`Check off ${row.title}`} className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-[#a0a0a8]" onClick={() => complete.mutate(row.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug">{row.title}</div>
                  <div className="mt-1 text-xs text-[#6e6e78]">{planDateLabel(row.start, null)}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs">{sourceChipLabel(sender, row.category === "school_email" ? "mail" : "todo")}</span>
                    <PersonChips home={home} profileIds={row.profileIds} title={row.title} onPick={(ids) => assign.mutate({ choreId: row.id, profileIds: ids })} />
                  </div>
                </div>
              </li>
            );
          })}
          {laterMail.map((row) => {
            const sender = slipSender(row.description);
            return (
              <li key={row.id} className="flex items-start gap-3 border-t border-[#ececf0] py-3">
                <button type="button" aria-label={`Check off ${row.title}`} className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-[#a0a0a8]" onClick={() => complete.mutate(row.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug">{row.title}</div>
                  <div className="mt-1 text-xs text-[#6e6e78]">{planDateLabel(row.start, null)} · {row.time}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs">{sourceChipLabel(sender, "mail")}</span>
                    <PersonChips home={home} profileIds={row.profileIds} title={row.title} onPick={(ids) => assign.mutate({ choreId: row.id, profileIds: ids })} />
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
    </HomeCard>
  );
}
