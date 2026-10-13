import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, ChevronDown, ChevronUp, MoreVertical, Plus } from "lucide-react";
import type { Chore } from "@workspace/shared-types";
import { schoolHomeTitle, sourceChipLabel } from "@/lib/homeDay";
import { slipQuote, slipSender } from "@/lib/slipMail";
import { HomeCard } from "./HomeCard";
import { PersonChips } from "./PersonChips";
import type { HomeModel } from "./useHomeDay";

const REVEAL_PX = 172;
const SWIPE_PX = 56;
const LONG_PRESS_MS = 550;
const TICKED = "#34A853";

type Exit = "done" | "away";
const ROW: Variants = {
  exit: (kind: Exit) => kind === "done"
    ? { opacity: 0, y: 12, transition: { duration: 0.3, ease: "easeOut" } }
    : { x: "-100%", opacity: 0, transition: { duration: 0.25, ease: "easeIn" } },
};
const INSTANT: Variants = { exit: { opacity: 0, transition: { duration: 0 } } };

export function TodosCard({ home }: { home: HomeModel }) {
  const { onAddTodo } = home.props;
  const { openTodos, doneTodos, visibleTodos, folded, daysOut, showDoneTodos, setShowAllTodos, setShowDoneTodos, reduced } = home;
  const summary = openTodos.length > 0 ? `${openTodos.length} open` : doneTodos.length > 0 ? "All done" : "Nothing today";
  const scope = `${daysOut}|${home.props.selectedIds.join(",")}`;
  const beat = useDoneBeat(doneTodos.length, scope, !showDoneTodos && !reduced);
  return (
    <HomeCard
      id="todos"
      title={home.todosTitle}
      summary={summary}
      collapsed={home.isCollapsed("todos")}
      onToggle={() => home.toggleCard("todos")}
      actions={onAddTodo && (
        <button type="button" aria-label="Add a to-do" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border" onClick={onAddTodo}>
          <Plus className="h-4 w-4" />
        </button>
      )}
    >
      <ClearedNote home={home} />
      <ul key={scope} className="flex flex-col">
        <AnimatePresence initial={false}>
          {visibleTodos.map((todo) => <TodoRow key={todo.id} home={home} todo={todo} />)}
        </AnimatePresence>
      </ul>
      {visibleTodos.length === 0 && (
        <motion.p
          className="text-sm text-muted-foreground"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.3 }}
        >
          {daysOut === 0 ? "Nothing that needs you today." : "Nothing due this day."}
        </motion.p>
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
            <DoneCount count={doneTodos.length} beat={beat} />
            {showDoneTodos ? <ChevronUp className="ml-auto h-4 w-4 text-[#a0a0a8]" /> : <ChevronDown className="ml-auto h-4 w-4 text-[#a0a0a8]" />}
          </button>
          {showDoneTodos && <DoneList home={home} />}
        </div>
      )}
    </HomeCard>
  );
}

/** Counts check-offs landing in Done. Switching day or person is not one. */
function useDoneBeat(count: number, scope: string, pulse: boolean): number {
  const last = useRef({ count, scope });
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (scope === last.current.scope && count > last.current.count && pulse) setBeat((current) => current + 1);
    last.current = { count, scope };
  }, [count, scope, pulse]);
  return beat;
}

/** The Done count, which pulses when something new lands in it. */
function DoneCount({ count, beat }: { count: number; beat: number }) {
  return (
    <motion.span
      key={beat}
      data-testid="home-todo-done-count"
      className="inline-flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#E7F1F6] px-1.5 text-xs font-semibold text-[#5E8FAD]"
      initial={beat > 0 ? { scale: 1.35 } : false}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 14 }}
    >
      {count}
    </motion.span>
  );
}

type Row = HomeModel["visibleTodos"][number];

function TodoRow({ home, todo }: { home: HomeModel; todo: Row }) {
  const { events, day, people } = home.props;
  const { revealed, setRevealed, setSheet, reduced, checkOff, uncheck, removeRow } = home;
  const isMail = todo.category === "school_email";
  const title = isMail ? schoolHomeTitle(todo.title, events, day, people) : todo.title;
  const quote = slipQuote(todo.description);
  const sender = slipSender(todo.description);
  const open = revealed === todo.id;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const hold = useRef<number | null>(null);
  const clearHold = () => {
    if (hold.current != null) window.clearTimeout(hold.current);
    hold.current = null;
  };
  const toggle = () => (todo.done ? uncheck : checkOff)(todo.id);
  return (
    <motion.li
      layout={reduced ? false : "position"}
      custom={(todo.done ? "done" : "away") satisfies Exit}
      variants={reduced ? INSTANT : ROW}
      exit="exit"
      data-testid={`home-todo-${todo.id}`}
      className="relative overflow-hidden border-t border-[#ececf0] first:border-t-0"
    >
      {open && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-1" data-testid="home-todo-swipe-actions">
          <button type="button" className="rounded-full bg-[#F1F1F4] px-3.5 py-2 text-xs font-medium" onClick={() => setSheet({ chore: todo, mode: "snooze" })}>Snooze</button>
          <button type="button" className="rounded-full bg-[#D93025] px-3.5 py-2 text-xs font-medium text-white" onClick={() => removeRow(todo)}>{isMail ? "Remove" : "Delete"}</button>
        </div>
      )}
      <motion.div
        className="relative flex items-start gap-3 bg-[#ffffff] py-3 dark:bg-[#1c1c21]"
        animate={{ x: open ? -REVEAL_PX : 0 }}
        transition={reduced ? { duration: 0 } : { type: "tween", duration: 0.2, ease: "easeOut" }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          swiped.current = false;
          clearHold();
          hold.current = window.setTimeout(() => setSheet({ chore: todo, mode: "actions" }), LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          if (Math.abs(event.clientX - drag.current.x) > 8 || Math.abs(event.clientY - drag.current.y) > 8) clearHold();
        }}
        onPointerUp={(event) => {
          clearHold();
          if (!drag.current) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current = null;
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
          swiped.current = true;
          if (dx < 0) setRevealed(todo.id);
          else if (open) setRevealed(null);
          else toggle();
        }}
        onPointerCancel={clearHold}
        onClickCapture={(event) => {
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => { event.preventDefault(); setSheet({ chore: todo, mode: "actions" }); }}
      >
        <button
          type="button"
          aria-label={todo.done ? `Mark ${title} not done` : `Check off ${title}`}
          data-testid="home-todo-check"
          className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-white"
          style={todo.done ? { borderColor: TICKED, backgroundColor: TICKED } : { borderColor: "#a0a0a8" }}
          onClick={toggle}
        >
          {todo.done && (
            <motion.span initial={reduced ? false : { scale: 0.3 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => (open ? setRevealed(null) : setSheet({ chore: todo, mode: "source" }))}
          >
            <div className={`text-[15px] font-medium leading-snug line-clamp-2 ${todo.done ? "text-[#a0a0a8] line-through" : ""}`}>{title}</div>
            {quote && <div data-testid="home-todo-quote" className={`mt-1 text-sm leading-snug line-clamp-3 ${todo.done ? "text-[#a0a0a8] line-through" : "text-[#6e6e78]"}`}>{quote}</div>}
          </button>
          <div className="mt-2 flex items-center gap-2">
            <span data-testid="home-todo-source" className="inline-flex min-w-0 max-w-[55%] truncate rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80">
              {sourceChipLabel(sender, isMail ? "mail" : "todo")}
            </span>
            <PersonChips home={home} profileIds={todo.profileIds} title={title} onPick={(ids) => home.reassign(todo, ids)} sender={todo.category === "school_email" ? sender : null} />
            <button type="button" aria-label={`More actions for ${title}`} className="grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]" onClick={() => setSheet({ chore: todo, mode: "actions" })}>
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.li>
  );
}

function DoneList({ home }: { home: HomeModel }) {
  const { events, day, people } = home.props;
  const { doneTodos, uncheck, setSheet } = home;
  return (
    <ul className="flex flex-col">
      {doneTodos.map((todo: Chore) => {
        const title = todo.category === "school_email" ? schoolHomeTitle(todo.title, events, day, people) : todo.title;
        return (
          <li key={todo.id} data-testid={`home-done-${todo.id}`} className="border-t border-[#ececf0] first:border-t-0">
            <div className="flex items-start gap-3 py-3">
              <button
                type="button"
                aria-label={`Mark ${title} not done`}
                className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-white"
                style={{ borderColor: TICKED, backgroundColor: TICKED }}
                onClick={() => uncheck(todo.id)}
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
  );
}

/** "Cleared 3 past-due to-dos" so old items never vanish without a word. */
function ClearedNote({ home }: { home: HomeModel }) {
  const { cleared, ackCleared, setSheet } = home;
  const [open, setOpen] = useState(false);
  if (cleared.length === 0) return null;
  const count = cleared.length === 1 ? "1 past-due to-do" : `${cleared.length} past-due to-dos`;
  const day = (at: Date) => at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div data-testid="home-cleared-todos" className="mb-2 rounded-xl bg-[#F1F1F4] px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Check className="h-4 w-4 shrink-0 text-[#5E8FAD]" aria-hidden="true" />
        <span className="min-w-0 flex-1">Cleared {count} that {cleared.length === 1 ? "was" : "were"} due before yesterday.</span>
        <button type="button" className="shrink-0 font-semibold text-[#5E8FAD]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </button>
        <button type="button" data-testid="home-cleared-ok" className="shrink-0 font-semibold text-[#5E8FAD]" onClick={ackCleared}>OK</button>
      </div>
      {open && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-[#e3e3e8] pt-2">
          {cleared.map((todo) => (
            <li key={todo.id}>
              <button type="button" className="flex w-full items-baseline gap-2 text-left" onClick={() => setSheet({ chore: todo as Chore, mode: "source" })}>
                <span className="min-w-0 flex-1 truncate">{todo.title}</span>
                <span className="shrink-0 text-xs text-[#6e6e78]">Due {day(todo.due)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
