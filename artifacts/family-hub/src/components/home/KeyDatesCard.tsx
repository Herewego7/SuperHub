import { useState } from "react";
import { AnimatePresence, motion, useAnimationControls, type PanInfo } from "framer-motion";
import { AlarmClock, Calendar, CalendarPlus, Check, MoreVertical, Trash2, X } from "lucide-react";
import { PLAN_KEY_DATES, planDateLabel } from "@/lib/homeDay";
import { slipSender, slipSenderName } from "@/lib/slipMail";
import { HomeCard } from "./HomeCard";
import { SourceChip } from "./SourceChip";
import type { HomeModel } from "./useHomeDay";

/** How far left a card has to travel, or how fast, before letting go removes it. */
const SWIPE_AWAY_PX = 110;
const SWIPE_AWAY_SPEED = 600;

type KeyRow = HomeModel["visibleKeys"][number];

/**
 * Dates found in email that aren't on a calendar yet. Ticking boxes picks
 * dates; a bar then offers Add to calendar or Remove for all of them at once.
 * A card can also be swiped left to remove it.
 */
export function KeyDatesCard({ home }: { home: HomeModel }) {
  const { keyDates, visibleKeys, kept, showAllKeys, setShowAllKeys, placeMail, removeRow, reduced } = home;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const summary = keyDates.length === 0 ? "None to add" : keyDates.length === 1 ? "1 to add" : `${keyDates.length} to add`;
  const chosen = visibleKeys.filter((row) => picked.has(row.id));
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const addPicked = () => {
    chosen.forEach((row) => placeMail(row, row.start, !row.time));
    setPicked(new Set());
  };
  const removePicked = () => {
    chosen.forEach((row) => removeRow(row));
    setPicked(new Set());
  };
  return (
    <HomeCard id="keyDates" title="Key Dates to Add" summary={summary} collapsed={home.isCollapsed("keyDates")} onToggle={() => home.toggleCard("keyDates")}>
      {visibleKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No new dates to add.</p>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {visibleKeys.map((row) => (
              <KeyDateRow
                key={row.id}
                home={home}
                row={row}
                added={!!kept[row.id]}
                picked={picked.has(row.id)}
                onPick={() => toggle(row.id)}
                onRemove={() => {
                  setPicked((current) => {
                    const next = new Set(current);
                    next.delete(row.id);
                    return next;
                  });
                  removeRow(row);
                }}
                reduced={!!reduced}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {keyDates.length > PLAN_KEY_DATES && !showAllKeys && (
        <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAllKeys(true)}>View all</button>
      )}
      <AnimatePresence>
        {chosen.length > 0 && (
          <motion.div
            key="key-date-actions"
            data-testid="key-dates-actions"
            role="region"
            aria-label="Selected key dates"
            className="fixed inset-x-3 z-[60] mx-auto max-w-md rounded-2xl bg-[#1e1e24] p-3 text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
            style={{ bottom: "calc(6.75rem + env(safe-area-inset-bottom, 0px))" }}
            initial={reduced ? false : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="flex-1 font-medium">{chosen.length === 1 ? "1 date selected" : `${chosen.length} dates selected`}</span>
              <button type="button" aria-label="Clear selection" className="grid h-7 w-7 place-items-center rounded-full text-white/70" onClick={() => setPicked(new Set())}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" data-testid="key-dates-add" className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#5E8FAD] py-2.5 text-sm font-semibold" onClick={addPicked}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Add to calendar
              </button>
              <button type="button" data-testid="key-dates-remove" className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-sm font-semibold" onClick={removePicked}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </HomeCard>
  );
}

function KeyDateRow({ home, row, added, picked, onPick, onRemove, reduced }: {
  home: HomeModel;
  row: KeyRow;
  added: boolean;
  picked: boolean;
  onPick: () => void;
  onRemove: () => void;
  reduced: boolean;
}) {
  const { setSheet, removeFromCalendar, kept } = home;
  const card = useAnimationControls();
  const [swiping, setSwiping] = useState(false);
  const sender = slipSender(row.description);
  const settle = async (_event: unknown, info: PanInfo) => {
    setSwiping(false);
    if (info.offset.x < -SWIPE_AWAY_PX || info.velocity.x < -SWIPE_AWAY_SPEED) {
      // Off the left edge first, then the row folds away (the exit below).
      await card.start({ x: "-110%", transition: { duration: reduced ? 0 : 0.18, ease: "easeIn" } });
      onRemove();
      return;
    }
    void card.start({ x: 0, transition: { type: "spring", stiffness: 500, damping: 35 } });
  };
  return (
    <motion.li
      layout={reduced ? false : "position"}
      data-testid={`home-key-date-${row.id}`}
      className="relative overflow-hidden border-t border-[#ececf0] first:border-t-0"
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, transition: { duration: 0.22, ease: "easeOut" } }}
    >
      {/* What a left swipe uncovers. */}
      <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end gap-1.5 bg-[#D93025] pr-5 text-sm font-semibold text-white transition-opacity ${swiping ? "opacity-100" : "opacity-0"}`}>
        <Trash2 className="h-4 w-4" />
        Remove
      </div>
      <motion.div
        className="relative flex touch-pan-y items-start gap-3 bg-[#ffffff] py-3 dark:bg-[#1c1c21]"
        drag={reduced ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.9, right: 0 }}
        dragMomentum={false}
        animate={card}
        onDragStart={() => setSwiping(true)}
        onDragEnd={settle}
        onContextMenu={(event) => { event.preventDefault(); setSheet({ chore: row, mode: "actions", keyDate: true }); }}
      >
        {added ? (
          <button
            type="button"
            aria-label={`Remove ${row.title} from your calendar`}
            className="mt-0.5 grid h-[21px] w-[21px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-[#5E8FAD] bg-[#5E8FAD] text-white"
            onClick={() => removeFromCalendar.mutate({ choreId: row.id, eventId: kept[row.id] })}
          >
            <Calendar className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={picked}
            aria-label={`Select ${row.title}`}
            data-testid="key-date-pick"
            className={`mt-0.5 grid h-[21px] w-[21px] shrink-0 place-items-center rounded-[5px] border-[1.5px] ${picked ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-[#a0a0a8]"}`}
            onClick={onPick}
          >
            {picked && <Check className="h-3 w-3" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <button type="button" className="block w-full text-left" onClick={() => setSheet({ chore: row, mode: "source", keyDate: true })}>
            <div className="text-[15px] font-medium leading-snug">{row.title}</div>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#6e6e78]">
            <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" />{planDateLabel(row.start, row.end)}</span>
            {row.time && <span className="inline-flex items-center gap-1"><AlarmClock className="h-3.5 w-3.5" aria-hidden="true" />{row.time}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <SourceChip address={sender} name={slipSenderName(row.description)} kind="mail" />
            <button type="button" aria-label={`More actions for ${row.title}`} className="ml-auto grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]" onClick={() => setSheet({ chore: row, mode: "actions", keyDate: true })}>
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.li>
  );
}
