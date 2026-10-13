import { AlarmClock, Calendar, Check, MoreVertical } from "lucide-react";
import { PLAN_KEY_DATES, planDateLabel, sourceChipLabel } from "@/lib/homeDay";
import { slipSender } from "@/lib/slipMail";
import { HomeCard } from "./HomeCard";
import type { HomeModel } from "./useHomeDay";

export function KeyDatesCard({ home }: { home: HomeModel }) {
  const { keyDates, visibleKeys, kept, showAllKeys, setShowAllKeys, setSheet, placeMail, removeFromCalendar } = home;
  const summary = keyDates.length === 0 ? "None to add" : keyDates.length === 1 ? "1 to add" : `${keyDates.length} to add`;
  return (
    <HomeCard id="keyDates" title="Key Dates to Add" summary={summary} collapsed={home.isCollapsed("keyDates")} onToggle={() => home.toggleCard("keyDates")}>
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
    </HomeCard>
  );
}
