import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { hasCelebratedAllDone, markCelebratedAllDone, clearCelebratedAllDone } from "@/lib/allDoneCelebration";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { revealFieldAboveKeyboard } from "@/lib/keyboardFieldReveal";
import { motion, AnimatePresence } from "framer-motion";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { objectUrl } from "@/lib/apiBase";
import type { Profile, Chore, ChoreCompletion } from "@workspace/shared-types";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Plus, Check, ChevronDown, ChevronUp, History, Trash2, X, Pencil, GripVertical, ArrowUpDown, CheckSquare, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useParentGate } from "@/lib/parentGate";
import { confirmDialog } from "@/lib/confirmDialog";

// Dedicated To-Dos tab — deliberately simpler than ChoresView. To-dos are
// one-off (non-recurring) items, so completion here is TERMINAL: a to-do is
// either active (no completion) or done (has one). Checking one off keeps it
// in place (still checked-off, in its original position) for a 30s grace
// window — matching the same recency hold used for chores elsewhere in the
// app — then it animates down into a "Done today" strip. Once the calendar day
// rolls over, it drops out of both and only lives in the completed-history
// drawer.
//
// ONE CARD PER PERSON: viewing All Family renders a separate card for each
// person rather than one merged list, so a big family's to-dos stay readable.
//
// SUB-TO-DOS (one level, never more): any to-do can hold a short list under it
// ("Packing for the trip" → the packing items). The two levels check off
// INDEPENDENTLY — ticking the top one means "I'm done with this", not
// "everything under it happened", so anything skipped stays visibly unchecked
// underneath and the count badge turns amber. Nothing to set up: a to-do
// becomes a list the moment something goes under it. Deleting a parent takes
// its children with it, behind a confirmation naming the count.

interface TodosViewProps {
  profiles: Profile[];
  selectedProfiles: string[];
  /** Opens the unified "New to-do" form (several at once, several people). */
  onAddTodo?: () => void;
}

/** A top-level to-do for one person, with its sub-to-dos (never nested deeper). */
export interface TodoNode {
  todo: Chore;
  profileId: string;
  completion: ChoreCompletion | null;
  children: { todo: Chore; completion: ChoreCompletion | null }[];
}

type SortMode = "manual" | "alpha";
const SORT_STORAGE_KEY = "familyHub_todosSort";
const DONE_DELAY_MS = 30_000;

/** How far sideways before a drag stops being "reorder" and becomes "re-file". */
const INDENT_PX = 44;
/** Visual resting offset of a sub-to-do row (ml-7 = 1.75rem = 28px). */
const INDENT_SHIFT = 28;

/**
 * What releasing the drag right now would do. Held in a ref as well as state:
 * the pointer listeners are bound once per drag, so reading the state variable
 * inside pointerup would see a stale value.
 */
type DragIntent =
  | { kind: "move" }
  | { kind: "indent"; parentId: string; parentTitle: string }
  | { kind: "outdent" }
  | { kind: "blocked"; reason: string };

function loadSortMode(): SortMode {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === "alpha" ? "alpha" : "manual";
  } catch {
    return "manual";
  }
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A row's React identity, which is deliberately NOT its id.
 *
 * A new to-do is shown optimistically under a temporary id and then merged
 * with the server's row, which changes the id. Keyed by id, that reads to
 * AnimatePresence as one row leaving and a different one arriving — so the row
 * cross-faded with itself about a third of a second after it appeared: "it
 * disappears for a split second then re-appears in the same correct place"
 * (2026-09-14, with a recording; measured as ~230ms of two overlapping
 * half-opacity copies).
 *
 * The alias is recorded once, when the server's row replaces the optimistic
 * one, and outlives any later refetch — a row arriving fresh from the server
 * resolves to the same key it has had all along, so there is no second flash
 * whenever something else invalidates the list.
 */
const rowKeyAliases = new Map<string, string>();

export function aliasRowKey(serverId: string, clientId: string): void {
  // Bounded: one entry per to-do created in this session, and nothing here is
  // worth keeping once the list has turned over many times.
  if (rowKeyAliases.size > 200) rowKeyAliases.delete(rowKeyAliases.keys().next().value as string);
  rowKeyAliases.set(serverId, clientId);
}

export function rowKey(c: { id: string }): string {
  return rowKeyAliases.get(c.id) ?? c.id;
}

function Avatar({ profile, size = 24 }: { profile: Profile; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0 overflow-hidden"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` }}
      title={profile.name}
    >
      {profile.photoUrl ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full object-cover" /> : profile.initials}
    </span>
  );
}

interface PersonTodoCardProps {
  /** Start closed — used for people with nothing on their list when someone
   *  else does have items, so empty cards don't fill the screen. */
  startCollapsed?: boolean;
  profile: Profile;
  /** Every top-level to-do for THIS person (with children attached). */
  nodes: TodoNode[];
  sortMode: SortMode;
  nowMs: number;
  creating: boolean;
  isLoading: boolean;
  onCreate: (title: string, profileId: string) => void;
  onCreateUnder: (title: string, parent: Chore) => void;
  onComplete: (choreId: string, profileId: string) => void;
  onUncomplete: (choreId: string, profileId: string, completedAt: Date) => void;
  onRename: (choreId: string, title: string) => void;
  onDeleteNode: (node: TodoNode) => void;
  /** Delete an OPEN to-do (or sub-to-do) by id, with a confirmation. */
  onDeleteRow?: (choreId: string) => void;
  onReorder: (orderedParentIds: string[]) => void;
  /** Drag-right: file a top-level to-do under the one above it. */
  onIndent: (child: Chore, parent: Chore) => void;
  /** Drag-left: pull a sub-to-do back out to its own top-level row. */
  onOutdent: (child: Chore) => void;
  /** Fired when a drag tried to reorder while A–Z sorting is on, so the tab
   *  can point at the sort control that's overriding it. */
  onReorderBlocked?: () => void;
  guard: (action: () => void) => void;
}

// Module scope on purpose: declaring this inside TodosView's render body would
// give it a new component identity every render, remounting every card (and
// dropping focus / dismissing the iOS keyboard mid-typing) — the same bug
// already fixed for SettingsSection, DayToggle and ChoreForm elsewhere.
/** How many top-level to-dos the Tasks-card version shows before "Show all". */
const EMBEDDED_TODO_LIMIT = 4;

export function PersonTodoCard({
  startCollapsed = false,
  /**
   * Render just the list — no Card wrapper, header bar or collapse of its own.
   * Used when this sits INSIDE another card (the Tasks card's To-Dos section),
   * where a full nested card read as a foreign object and doubled up the
   * collapse control.
   */
  embedded = false,
  /** Inside Home's Tasks card, that card already has ONE Done section of its
   *  own — a second one nested in this section made two in a single card.
   *  Completed to-dos are folded into the card's own Done list instead. */
  hideDone = false,
  profile, nodes, sortMode, nowMs, creating, isLoading,
  onCreate, onCreateUnder, onComplete, onUncomplete, onRename, onDeleteNode, onDeleteRow, onReorder,
  onIndent, onOutdent, onReorderBlocked, guard,
}: PersonTodoCardProps & { embedded?: boolean; hideDone?: boolean }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [showDone, setShowDone] = useState(false);
  // Embedded in the Tasks card, an unbounded to-do list would push Chores,
  // Target Chores, Inspiration and Notes far off the screen. Show a few and
  // let the rest be opened in place. Deliberately NOT a max-height scroll box:
  // a nested scrollable inside a card inside a page is exactly the pattern
  // that keeps breaking touch scrolling on iOS in this app.
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  // The ONE row currently being worked on — the only row that shows the
  // "Add a to-do under this" button. Tapping elsewhere clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const subInputRef = useRef<HTMLInputElement>(null);
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set());

  const [dragId, setDragId] = useState<string | null>(null);
  // Follows the pointer as a portalled card, matching the Customize Home /
  // Tasks Page dialogs. To-Dos previously just faded the original row in
  // place, which reads as "disabled" rather than "you're carrying this".
  // Portalled to document.body so no ancestor transform can trap it.
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  // The same live preview localOrder gives the top-level list, for a sub-to-do
  // being dragged among its siblings. Keyed by parent, because only one
  // parent's children are ever being dragged at a time.
  //
  // WHY IT EXISTS (2026-09-14): a child drag showed a ghost under the finger
  // and nothing else — the rows never moved, so there was no way to see where
  // the row would land until you let go. Reported as "it either moves to the
  // top of the list, or doesn't move", which is what aiming blind looks like
  // when the drop lands somewhere other than where the ghost is. The top-level
  // list never had this problem precisely BECAUSE it previews: you watch the
  // gap open and adjust until it's right. This gives children the same.
  const [childOrder, setChildOrder] = useState<{ parentId: string; ids: string[] } | null>(null);
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);
  const dragRef = useRef<
    { id: string; order: string[]; startX: number; isChild: boolean; parentId?: string; blockedByAlpha?: boolean } | null
  >(null);
  const intentRef = useRef<DragIntent | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const setIntent = (i: DragIntent | null) => { intentRef.current = i; setDragIntent(i); };

  const now = new Date(nowMs);

  // A to-do's completion is PERMANENT (it's a one-time item, not a daily
  // recurrence) — completing one never reverts it back to active, no matter
  // how much time passes. What DOES change nightly is visibility: Done only
  // shows what was completed TODAY. Once local midnight passes, yesterday's
  // completions quietly stop appearing here — still fully recorded (points,
  // streaks, Family Activity all keep them permanently), just not piling up
  // in this card forever. A to-do completed on an earlier day satisfies
  // neither bucket below and simply isn't rendered in the main list at all;
  // it's still reachable via the "Completed to-dos" history dialog.
  const isInGracePeriod = (completedAt: string | Date) =>
    isSameLocalDay(new Date(completedAt), now) && nowMs - new Date(completedAt).getTime() < DONE_DELAY_MS;

  const topSection = useMemo(() => nodes.filter(n => {
    if (!n.completion?.completedAt) return true;
    return isInGracePeriod(n.completion.completedAt);
  }), [nodes, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneItems = useMemo(() => nodes
    .filter(n =>
      !!n.completion?.completedAt &&
      !isInGracePeriod(n.completion.completedAt) &&
      isSameLocalDay(new Date(n.completion.completedAt), now))
    .sort((a, b) => new Date(b.completion!.completedAt || 0).getTime() - new Date(a.completion!.completedAt || 0).getTime()),
    [nodes, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept to 30 days. This list is append-only otherwise, so a family that uses
  // to-dos daily would scroll a year of them by next summer. The completions
  // themselves aren't deleted — this is the drawer's own window, so nothing is
  // destroyed by a display rule, and anything older stays in Family Activity.
  //
  // This window is also why the drawer does NOT ask the server for archived
  // to-dos (GET /api/chores?includeArchived=1). The server archives a to-do
  // once its completion is 30 days old — exactly when this drawer stops
  // showing it — so fetching them would be a second request for rows this
  // window immediately discards.
  const HISTORY_DAYS = 30;
  const history = useMemo(() => {
    const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    return nodes
      .filter(n => n.completion && new Date(n.completion.completedAt || 0).getTime() >= cutoff)
      .sort((a, b) => new Date(b.completion!.completedAt || 0).getTime() - new Date(a.completion!.completedAt || 0).getTime());
  }, [nodes]);

  const orderedTop = useMemo(() => {
    let base: TodoNode[];
    if (sortMode === "alpha") {
      base = [...topSection].sort((a, b) => a.todo.title.localeCompare(b.todo.title));
    } else if (localOrder) {
      const byId = new Map(topSection.map(n => [n.todo.id, n]));
      const out = localOrder.map(id => byId.get(id)).filter(Boolean) as TodoNode[];
      for (const n of topSection) if (!localOrder.includes(n.todo.id)) out.push(n);
      base = out;
    } else {
      base = topSection;
    }
    // Checking off a to-do sinks it to the bottom of the checklist right
    // away — not just once its grace period ends and it moves into the
    // separate "Done" section below. Still within the same list a
    // completed item is momentarily part of (topSection includes it for a
    // beat so the checkmark itself is visible before it's swept away).
    // .sort() is stable, so this only moves completed items past
    // incomplete ones without otherwise disturbing either group's order.
    return [...base].sort((a, b) => (a.completion ? 1 : 0) - (b.completion ? 1 : 0));
  }, [topSection, sortMode, localOrder]);

  const draggableIds = useMemo(
    () => orderedTop.filter(n => !n.completion).map(n => n.todo.id),
    [orderedTop],
  );
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.todo.id, n])), [nodes]);
  // Reordering needs manual sort (there's no order to rearrange under A–Z) and
  // something to reorder against. Re-filing is structural, not positional, so
  // it stays available in both sort modes — hence the two separate flags.
  // Counted against the rows actually ON SCREEN, not just the incomplete
  // ones. Keying this to draggableIds meant checking one to-do off dropped a
  // two-row list to one "draggable" row and every handle in the list vanished
  // — which reads as the app breaking, not as a rule. A completed row still
  // holds a position you can file under or reorder around.
  const reorderableCount = orderedTop.length;
  const canReorder = sortMode === "manual" && reorderableCount > 1;
  const canIndent = reorderableCount > 1;

  useEffect(() => {
    if (!dragId) return;

    // Shared by the top-level list and by a sub-to-do reordering among its
    // siblings — both are "move this id within st.order by cursor position".
    const reorderWithinOrder = (st: NonNullable<typeof dragRef.current>, e: PointerEvent) => {
      let insertIdx = 0;
      for (const id of st.order) {
        if (id === st.id) continue;
        const el = rowRefs.current.get(id);
        // A row we cannot measure must abort the pass, NOT be skipped. Skipping
        // counts it as "not above the cursor", so a pass that measures nothing
        // returns 0 — indistinguishable from "drop it at the very top", which
        // is exactly what a mis-measured drag looked like on a device.
        // Leaving the order alone is always recoverable; a confident wrong
        // answer is not.
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (e.clientY > r.top + r.height / 2) insertIdx++;
      }
      const fromIdx = st.order.indexOf(st.id);
      if (fromIdx < 0 || insertIdx === fromIdx) return;
      const next = [...st.order];
      next.splice(fromIdx, 1);
      next.splice(insertIdx, 0, st.id);
      st.order = next;
      if (st.isChild) {
        if (st.parentId) setChildOrder({ parentId: st.parentId, ids: next });
      } else {
        setLocalOrder(next);
      }
    };

    const process = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;

      // A sub-to-do can go one of two ways: far enough left and it comes back
      // out to its own row; otherwise it reorders among its siblings, using
      // the same midpoint rule as the top-level list below.
      if (st.isChild) {
        if (dx <= -INDENT_PX) { setIntent({ kind: "outdent" }); return; }
        setIntent({ kind: "move" });
        if (sortMode !== "manual") {
          if (dragRef.current) dragRef.current.blockedByAlpha = true;
          return;
        }
        reorderWithinOrder(st, e);
        return;
      }

      // Dragged far enough right to mean "put this under the one above".
      if (dx >= INDENT_PX) {
        const idx = st.order.indexOf(st.id);
        if (idx <= 0) {
          setIntent({ kind: "blocked", reason: "Nothing above it" });
        } else if ((nodeById.get(st.id)?.children.length ?? 0) > 0) {
          // One level only — the DRAGGED item already has its own sub-
          // to-dos, so nesting it under something else would make a
          // grandchild. The server rejects this too; catching it here
          // means a clear label instead of an error toast.
          setIntent({ kind: "blocked", reason: "Can't nest — it already has sub-to-dos." });
        } else {
          const parentId = st.order[idx - 1];
          setIntent({
            kind: "indent",
            parentId,
            parentTitle: nodeById.get(parentId)?.todo.title ?? "",
          });
        }
        return;
      }

      setIntent({ kind: "move" });
      if (sortMode !== "manual") {
        // A–Z is doing the ordering, so this drag can't. Flagged rather than
        // acted on here: firing mid-gesture would fight the drag, so the tab
        // is nudged toward the sort control once the finger lifts.
        if (dragRef.current) dragRef.current.blockedByAlpha = true;
        return;
      }

      // Insertion index = how many OTHER rows' midpoints currently sit
      // above the cursor — a plain, monotonic function of cursor position
      // (not "is the cursor anywhere inside this row's full rect"), so a
      // swap only actually happens once a row's midpoint is genuinely
      // crossed. The earlier full-rect check had no such dead zone: hovering
      // right at the boundary between two rows — especially a to-do WITH
      // sub-to-dos, whose own row is a different height than a plain one —
      // could flip the detected target back and forth on tiny pointer
      // jitter, each flip re-triggering the list's layout animation, which
      // is what actually looked like the reported "vibrating" text.
      reorderWithinOrder(st, e);
    };

    // Throttled to one recompute per animation frame — a raw pointermove
    // can fire far more often than the screen repaints, and running the
    // full rect-measuring pass (getBoundingClientRect for every row) on
    // each one was doing redundant layout work between paints, which is
    // the other half of "isn't very smooth."
    let rafId: number | null = null;
    let pendingEvent: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      setGhostPos({ x: e.clientX + 12, y: e.clientY - 18 });
      pendingEvent = e;
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pendingEvent) process(pendingEvent);
      });
    };
    const onUp = () => {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      const st = dragRef.current;
      const intent = intentRef.current;
      if (st && intent) {
        const self = nodeById.get(st.id);
        if (intent.kind === "indent") {
          const parent = nodeById.get(intent.parentId);
          if (self && parent) onIndent(self.todo, parent.todo);
        } else if (intent.kind === "outdent") {
          // A child isn't a top-level node, so find it under its parent.
          const child = nodes
            .flatMap(n => n.children)
            .find(k => k.todo.id === st.id);
          if (child) onOutdent(child.todo);
        } else if (intent.kind === "move") {
          if (sortMode === "manual") {
            // Only persist an order when the drag actually WAS a reorder —
            // otherwise a re-file would also fire a pointless order write.
            onReorder(st.order);
          } else if (st.blockedByAlpha) {
            onReorderBlocked?.();
          }
        }
      }
      dragRef.current = null;
      intentRef.current = null;
      setDragId(null);
      setGhostPos(null);
      setLocalOrder(null);
      setChildOrder(null);
      setDragIntent(null);
    };
    // A drag that leaves the handle passes over ordinary text, and
    // preventDefault on the initial pointerdown doesn't stop the browser
    // starting a selection there — which showed up as an I-beam and a swathe
    // of highlighted text mid-drag. Selection is suppressed document-wide for
    // exactly as long as the drag lasts, then restored.
    const prevUserSelect = document.body.style.userSelect;
    const prevWebkitUserSelect = document.body.style.webkitUserSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    document.body.style.cursor = "grabbing";

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.webkitUserSelect = prevWebkitUserSelect;
      document.body.style.cursor = prevCursor;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [dragId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tapping anywhere that isn't a to-do row (or its inline controls) puts the
  // card back to rest, so the contextual button never lingers.
  useEffect(() => {
    if (selectedId === null && addingUnder === null) return;
    const onDocClick = (e: MouseEvent) => {
      // e.composedPath(), NOT e.target.closest() — clicking "Add a to-do
      // under this" sets addingUnder synchronously inside its own onClick,
      // which React commits (swapping that button out for the sub-input)
      // before this native document listener runs later in the same
      // bubble phase. By then the original <button> has been unmounted, so
      // its .closest() lookup walks a detached node with no parent chain
      // and always misses — this handler would then treat its own click as
      // "outside" and immediately clear the state the click just set.
      // composedPath() is captured at dispatch time, before any of that,
      // so it still reflects the real ancestry regardless of what React
      // does to the DOM in response to an earlier listener in the same event.
      const path = e.composedPath();
      const insideInteractive = path.some(
        (el) => el instanceof HTMLElement && el.hasAttribute("data-todo-interactive"),
      );
      if (insideInteractive) return;
      setSelectedId(null);
      setAddingUnder(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedId(null); setAddingUnder(null); }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [selectedId, addingUnder]);

  const startDrag = (e: React.PointerEvent, id: string, isChild: boolean) => {
    e.preventDefault();
    // A sub-to-do reorders among its OWN siblings; a top-level row among the
    // top-level rows. Dragging a child used to carry the top-level order,
    // which is why its drop had to be ignored entirely — the preview looked
    // right and then nothing moved.
    const parentNode = isChild ? nodes.find(n => n.children.some(k => k.todo.id === id)) : undefined;
    const siblings = parentNode ? parentNode.children.map(k => k.todo.id) : null;
    const order = siblings && siblings.length > 0 ? siblings : [...draggableIds];
    dragRef.current = { id, order, startX: e.clientX, isChild, parentId: parentNode?.todo.id };
    intentRef.current = { kind: "move" };
    setDragId(id);
    setGhostPos({ x: e.clientX + 12, y: e.clientY - 18 });
    setDragIntent({ kind: "move" });
    setLocalOrder(isChild ? null : [...draggableIds]);
    setChildOrder(parentNode ? { parentId: parentNode.todo.id, ids: order } : null);
  };

  // Both of these fields are focused BY US, not by the user's tap, so iOS does
  // its scroll-to-reveal before the keyboard exists and leaves the field
  // underneath it (reported 2026-09-14 for "Add a to-do under this", which sits
  // at the very bottom of the list and is therefore always covered). The reveal
  // helper waits for the keyboard itself.
  useEffect(() => {
    if (!adding) return;
    addInputRef.current?.focus();
    return revealFieldAboveKeyboard(addInputRef.current);
  }, [adding]);
  useEffect(() => {
    if (!addingUnder) return;
    subInputRef.current?.focus();
    return revealFieldAboveKeyboard(subInputRef.current);
  }, [addingUnder]);

  const openAdd = () => guard(() => { setNewTitle(""); setAdding(true); });
  const submitAdd = () => {
    const title = newTitle.trim();
    if (!title) { setAdding(false); return; }
    onCreate(title, profile.id);
    setNewTitle("");
    addInputRef.current?.focus();
  };

  const submitSub = (parent: Chore) => {
    const title = subTitle.trim();
    if (!title) return;
    onCreateUnder(title, parent);
    setSubTitle("");             // stays open so a list goes in fast
    subInputRef.current?.focus();
  };

  const startEdit = (chore: Chore) =>
    guard(() => { setEditingId(chore.id); setEditTitle(chore.title); });
  const submitEdit = (id: string, original: string) => {
    const title = editTitle.trim();
    if (title && title !== original) onRename(id, title);
    setEditingId(null);
  };

  const openCount = nodes.filter(n => !n.completion).length;

  const renderRow = (
    chore: Chore,
    profileId: string,
    completion: ChoreCompletion | null,
    opts: { isChild: boolean; node?: TodoNode },
  ) => {
    const isDone = !!completion;
    const editing = editingId === chore.id;
    const node = opts.node;
    const isSel = !opts.isChild && selectedId === chore.id;
    const kids = node?.children ?? [];
    const kidsDone = kids.filter(k => !!k.completion).length;
    // Done, but items were left unchecked underneath — surfaced in amber so
    // you can see what you skipped without expanding anything.
    const leftOver = isDone && kids.length > 0 && kidsDone < kids.length;
    const folded = node ? foldedGroups.has(chore.id) : false;
    // Children get a handle too — dragging left is the only way back out of a
    // list, so without it the indent gesture would be a one-way trap.
    const rowDraggable = isDone
      ? false
      : opts.isChild
        ? true
        : (canReorder || canIndent);

    const intent = dragId === chore.id ? dragIntent : null;
    // Slide the row to exactly where it would land, so the gesture previews
    // its own result rather than relying on the label alone.
    const previewX = intent?.kind === "indent" ? INDENT_SHIFT
      : intent?.kind === "outdent" ? -INDENT_SHIFT
      : 0;

    return (
      <motion.li
        key={rowKey(chore)}
        // Children are measured too — reordering sub-to-dos among their
        // siblings needs their rects, and ids are unique across the list.
        ref={(el: HTMLLIElement | null) => {
          if (el) rowRefs.current.set(chore.id, el);
          else rowRefs.current.delete(chore.id);
        }}
        layout
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1, x: previewX }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}
        data-todo-interactive
        className={cn(
          "flex flex-col rounded-lg border px-3 py-2.5 group transition-colors select-none",
          // Children were "ml-7 border-border/50 bg-transparent" — but an
          // opacity-modifier utility on a theme colour compiles to nothing in
          // this app (see SYS-1), so that lighter border never rendered and a
          // child was an identical box to its parent, 28px to the right.
          // border-muted is a solid token, so the difference is real.
          // Children were "border-border/50 bg-transparent" — an
          // opacity-modifier utility on a theme colour compiles to nothing in
          // this app (SYS-1), so that lighter border never rendered and a
          // child was an identical bordered box to its parent, 28px right.
          // Dropping the border entirely (rather than tinting it, which is
          // what silently failed) makes a child a plain row hanging off the
          // guide line — a difference that can't depend on a token resolving.
          opts.isChild && "ml-7 py-2 border-transparent bg-transparent",
          !opts.isChild && (isDone ? "border-border/60 bg-muted/30" : "border-border"),
          isSel && "border-primary ring-2 ring-primary/25",
          dragId === chore.id && "opacity-40",
          intent && intent.kind !== "move" && (
            intent.kind === "blocked"
              ? "border-amber-400 ring-2 ring-amber-300/40"
              : "border-primary ring-2 ring-primary/40"
          ),
        )}
        data-testid={isDone ? "todo-done-row" : "todo-row"}
      >
        <div className="flex items-start gap-3 w-full">
        {/* Checking a row off removes its handle (there is no reordering a
            completed row), but removing the ELEMENT slid everything after it
            left by the handle's width — so a done row's checkbox no longer
            lined up with its neighbours', and a done SUB-to-do lost the indent
            that said it was a sub-to-do at all. Reported as "the checkbox moves
            over and is aligned with the main to-dos, which causes confusion".
            The space stays; only the grip goes. */}
        {!rowDraggable && !isDone ? null : !rowDraggable ? (
          <span aria-hidden className="flex items-center justify-center p-2 -m-2 -ml-2 mt-0 shrink-0 invisible">
            <GripVertical className={opts.isChild ? "w-3.5 h-3.5" : "w-4 h-4"} />
          </span>
        ) : null}
        {rowDraggable && (
          // Pointer events, NOT the HTML5 draggable attribute: iOS Safari /
          // WKWebView doesn't implement HTML5 drag-and-drop, so a `draggable`
          // row just text-selects on touch. Same pointer pattern the
          // Customize Home/Tasks Page dialogs already use on touch.
          <span
            onPointerDown={e => startDrag(e, chore.id, opts.isChild)}
            className={cn(
              // p-2 with a matching negative margin: the icon is 14-16px,
              // which is far under a comfortable touch target, and "I had to
              // try several times to grab it" is exactly what that feels
              // like. The padding grows the hit area to ~32px without moving
              // anything else on the row.
              "flex items-center justify-center p-2 -m-2 -ml-2 mt-0 shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground",
              // A–Z is ordering the list, so a top-level handle can no longer
              // reorder (it still files a row under the one above). Dimmed
              // rather than hidden or disabled: the gesture it CAN still do is
              // real, and a handle at full strength was reading as a promise
              // to reorder that the list then silently refused.
              sortMode === "alpha" && !opts.isChild && "opacity-40",
            )}
            style={{ touchAction: "none" }}
            title={opts.isChild
              ? "Drag left to pull this back out on its own"
              : canReorder
                ? "Drag to reorder · drag right to file under the one above"
                : "Drag right to file under the one above"}
            data-testid={opts.isChild ? "todo-child-drag-handle" : "todo-drag-handle"}
          >
            <GripVertical className={opts.isChild ? "w-3.5 h-3.5" : "w-4 h-4"} />
          </span>
        )}

        {isDone ? (
          <button
            onClick={() => onUncomplete(chore.id, profileId, new Date(completion!.completedAt || new Date()))}
            className={cn(
              "rounded-full bg-green-500 border-2 border-green-500 flex items-center justify-center shrink-0 mt-0.5",
              opts.isChild ? "w-5 h-5" : "w-6 h-6",
            )}
            aria-label={`Un-check ${chore.title}`}
            data-testid="todo-uncheck"
          >
            <Check className={opts.isChild ? "w-3 h-3 text-white" : "w-3.5 h-3.5 text-white"} />
          </button>
        ) : (
          <button
            onClick={() => onComplete(chore.id, profileId)}
            className={cn(
              "rounded-full border-2 border-muted-foreground/40 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-950/40 shrink-0 transition-colors mt-0.5",
              opts.isChild ? "w-5 h-5" : "w-6 h-6",
            )}
            aria-label={`Complete ${chore.title}`}
            data-testid="todo-complete"
          />
        )}

        {editing ? (
          <Input
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); submitEdit(chore.id, chore.title); }
              if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={() => submitEdit(chore.id, chore.title)}
            className="flex-1 h-8"
            data-testid="todo-edit-input"
          />
        ) : (
          // Tapping the title selects the row (revealing its one action);
          // renaming is the pencil. break-words so a long to-do wraps onto as
          // many lines as it needs instead of being cut off.
          <button
            className={cn(
              "flex-1 min-w-0 text-left break-words",
              opts.isChild ? "text-[13px]" : "text-sm font-medium",
              isDone && "text-muted-foreground line-through",
            )}
            onClick={() => setSelectedId(opts.isChild ? (node?.todo.id ?? null) : (isSel ? null : chore.id))}
            data-testid="todo-title"
          >
            {chore.title}
          </button>
        )}

        {!opts.isChild && kids.length > 0 && (
          <span
            className={cn(
              "text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0 mt-0.5 tabular-nums",
              leftOver
                ? "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400"
                : "bg-primary/10 text-primary",
            )}
            title={leftOver ? `${kids.length - kidsDone} left unchecked` : undefined}
          >
            {kidsDone}/{kids.length}
          </span>
        )}

        {!opts.isChild && kids.length > 0 && (
          <button
            onClick={() => setFoldedGroups(prev => {
              const next = new Set(prev);
              if (next.has(chore.id)) next.delete(chore.id); else next.add(chore.id);
              return next;
            })}
            className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
            aria-expanded={!folded}
            aria-label={`${folded ? "Expand" : "Collapse"} ${chore.title}`}
          >
            {folded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        )}

        {!editing && (
          <button
            onClick={() => startEdit(chore)}
            className="opacity-60 sm:opacity-0 group-hover:opacity-100 mt-0.5 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
            aria-label={`Rename ${chore.title}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Deleting an OPEN to-do. There was no way to do it: the bin only
            existed in the completed drawer, so getting rid of something you
            never intended to do meant ticking it off first — which records a
            completion, and claims you did it (reported 2026-09-13). Sub-to-dos
            get the same control; a parent's confirmation says how many go with
            it. */}
        {!editing && onDeleteRow && (
          <button
            onClick={() => onDeleteRow(chore.id)}
            className="opacity-60 sm:opacity-0 group-hover:opacity-100 mt-0.5 text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
            aria-label={`Delete ${chore.title}`}
            data-testid={opts.isChild ? "todo-child-delete" : "todo-delete"}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        </div>

        {/* Says what letting go right now would do — the gesture is invisible
            otherwise, and a blocked drop needs a reason, not just nothing
            happening. On its OWN line (not squeezed into the row alongside
            the title): sharing that row meant the badge's width could push
            the title onto an extra line, which — combined with this row's
            layout animation — made the whole row visibly wobble as the
            badge flickered in and out near the drag threshold. A row that
            already has children is worse off here since its kids-count +
            fold-chevron badges already eat into the title's width, leaving
            less room before a wrap-toggle kicks in — matching the "vibrates
            near a to-do with sub-to-dos" report exactly. Full text, no
            truncation, so a longer reason like "Already has to-dos under
            it" is always fully readable instead of getting clipped. */}
        {intent && intent.kind !== "move" && (
          <div
            className={cn(
              "mt-1.5 text-[11px] font-semibold rounded-md px-2 py-1 w-fit max-w-full",
              intent.kind === "blocked"
                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                : "bg-primary text-primary-foreground",
            )}
            data-testid="todo-drag-intent"
          >
            {intent.kind === "indent"
              ? `Will move under "${intent.parentTitle}"`
              : intent.kind === "outdent"
                ? "Will move out on its own"
                : intent.reason}
          </div>
        )}
      </motion.li>
    );
  };

  const renderNode = (node: TodoNode) => {
    const folded = foldedGroups.has(node.todo.id);
    const isSel = selectedId === node.todo.id;
    // While one of this parent's children is being dragged, show the order the
    // drop would produce. Any child the preview doesn't name still renders, at
    // the end — a preview built from a stale list must never make a row vanish.
    const kids = childOrder && childOrder.parentId === node.todo.id
      ? (() => {
          const byId = new Map(node.children.map(k => [k.todo.id, k]));
          const out = childOrder.ids.map(id => byId.get(id)).filter(Boolean) as typeof node.children;
          for (const k of node.children) if (!childOrder.ids.includes(k.todo.id)) out.push(k);
          return out;
        })()
      : node.children;
    return (
      <div key={rowKey(node.todo)} className="space-y-1.5">
        <ul className="space-y-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {renderRow(node.todo, node.profileId, node.completion, { isChild: false, node })}
          </AnimatePresence>
        </ul>

        {!folded && kids.length > 0 && (
          // Guide line down the indent, so children read as attached to the
          // parent above rather than as free-standing rows that happen to
          // start further right.
          <div className="relative">
            {/* Drawn with border-l, not a bg-colour: `bg-border` produces no
                background in this project (verified in a browser — it
                computes to transparent), while `border-border` resolves
                correctly, which is what every card in the app already uses. */}
            <span aria-hidden="true" className="absolute left-[13px] top-0 bottom-1.5 border-l border-border" data-testid="todo-nesting-guide" />
            <ul className="space-y-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {kids.map(kid => renderRow(kid.todo, node.profileId, kid.completion, { isChild: true, node }))}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {/* The single contextual action — only on the row you tapped. */}
        {isSel && (
          addingUnder === node.todo.id ? (
            <div className="ml-7 flex items-center gap-2" data-todo-interactive>
              <Input
                ref={subInputRef}
                value={subTitle}
                onChange={e => setSubTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); submitSub(node.todo); }
                  if (e.key === "Escape") { setAddingUnder(null); setSubTitle(""); }
                }}
                placeholder={`New to-do under “${node.todo.title.length > 24 ? node.todo.title.slice(0, 24) + "…" : node.todo.title}”`}
                className="flex-1 h-8"
                // Same fix as the top-level Add field above — this is also
                // focused programmatically, so it needs to explicitly leave
                // room for the sticky header on iOS's native focus-scroll.
                style={{ scrollMarginTop: "calc(6rem + env(safe-area-inset-top, 0px))" }}
                data-testid="todo-sub-input"
              />
              <Button size="sm" onClick={() => submitSub(node.todo)} disabled={!subTitle.trim() || creating}>Add</Button>
            </div>
          ) : (
            <div className="ml-7" data-todo-interactive>
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => guard(() => { setSubTitle(""); setAddingUnder(node.todo.id); })}
                data-testid="todo-add-under"
              >
                <Plus className="w-3.5 h-3.5" />
                Add a to-do under this
              </Button>
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <>
      {embedded ? (
        // Inside the Tasks card: just the list. Section header, collapse and
        // add button all come from the TaskSection wrapping this.
        <div className="space-y-4">
            {adding && (
              <div className="rounded-xl border border-primary/40 bg-primary/[0.03] p-3 space-y-2" data-todo-interactive data-testid="todos-add-row">
                <div className="flex items-center gap-2">
                  <Input
                    ref={addInputRef}
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); submitAdd(); }
                      if (e.key === "Escape") setAdding(false);
                    }}
                    placeholder={`Add a to-do for ${profile.name}…`}
                    className="flex-1"
                    // This field is focused programmatically (line ~372), not
                    // via the `autoFocus` prop — iOS's native "scroll the
                    // newly-focused field into view" then has nothing telling
                    // it to leave room for the sticky header above, and can
                    // land the page at a scroll position where the header/
                    // notch-cover strip ends up overlapping real content (the
                    // same class of bug already fixed once for Grocery List's
                    // "Add item" field).
                    style={{ scrollMarginTop: "calc(6rem + env(safe-area-inset-top, 0px))" }}
                    data-testid="todos-add-input"
                  />
                  <Button size="sm" onClick={submitAdd} disabled={!newTitle.trim() || creating}>Add</Button>
                  <Button size="sm" variant="ghost" className="px-2" onClick={() => setAdding(false)} aria-label="Close add"><X className="w-4 h-4" /></Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Enter adds another. Tap or drag right to nest.</p>
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="todos-loading">
                <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                Loading…
              </div>
            ) : orderedTop.length === 0 && (hideDone || doneItems.length === 0) ? (
              <div className="text-center py-8">
                {/* "scheduled ... today" contradicted this very card's own subtitle,
                    which says to-dos are one-off tasks not tied to a schedule.
                    That wording was copied from the chores card, which genuinely
                    is day-scoped. */}
                <p className="text-muted-foreground text-sm mb-3">Nothing on {profile.name}'s to-do list</p>
                {!adding && <Button size="sm" onClick={openAdd}><Plus className="w-3.5 h-3.5 mr-1.5" />Add a to-do</Button>}
              </div>
            ) : (
              <>
                {orderedTop.length > 0 && (
                  <div className="space-y-1.5">
                    {(showAllTodos ? orderedTop : orderedTop.slice(0, EMBEDDED_TODO_LIMIT)).map(renderNode)}
                    {orderedTop.length > EMBEDDED_TODO_LIMIT && (
                      // Plain muted text with no icon read as a caption
                      // rather than a control, so a longer list looked
                      // simply truncated with no way to see the rest.
                      <button
                        type="button"
                        onClick={() => setShowAllTodos(v => !v)}
                        aria-expanded={showAllTodos}
                        className="w-full flex items-center justify-center gap-1 text-xs font-medium text-primary hover:underline py-2"
                        data-testid="todos-show-all"
                      >
                        {showAllTodos
                          ? <>Show fewer <ChevronUp className="w-3.5 h-3.5" /></>
                          : <>{`Show all ${orderedTop.length} to-dos`} <ChevronDown className="w-3.5 h-3.5" /></>}
                      </button>
                    )}
                  </div>
                )}

                {/* Collapsed "Done" section, same pattern as the Chores/Home
                    cards. A to-do checked off here stays put in the list above
                    for DONE_DELAY_MS first (so an accidental tap is easy to
                    undo), then animates down into this drawer. */}
                {!hideDone && doneItems.length > 0 && (
                  <div className="pt-1">
                    <button
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                      onClick={() => setShowDone(v => !v)}
                      aria-expanded={showDone}
                      data-testid="todos-done-toggle"
                    >
                      {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Done ({doneItems.length})
                    </button>
                    <AnimatePresence initial={false} mode="popLayout">
                      {showDone && (
                        <motion.div
                          key="todos-done"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 space-y-1.5">{doneItems.map(renderNode)}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
        </div>
      ) : (
      <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <CardHeader className="p-4 border-b border-border bg-[#D9E3EC]/70 dark:bg-[#232a30]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar profile={profile} size={28} />
              <h3 className="text-lg font-semibold text-foreground truncate">{profile.name}'s To-Dos</h3>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title={`Add a to-do for ${profile.name}`} aria-label={`Add a to-do for ${profile.name}`} onClick={openAdd} data-testid="todos-add">
                <Plus className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Completed to-dos" aria-label="See completed to-dos" onClick={() => setHistoryOpen(true)} data-testid="todos-history">
                <History className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title={collapsed ? "Expand" : "Collapse"} aria-label={collapsed ? "Expand this list" : "Collapse this list"} onClick={() => setCollapsed(c => !c)} data-testid="todos-collapse">
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {openCount === 0 ? "All clear" : `${openCount} open`} · one-off tasks, not tied to a schedule
          </p>
        </CardHeader>

        {!collapsed && (
          <CardContent className="p-4 space-y-4">
            {adding && (
              <div className="rounded-xl border border-primary/40 bg-primary/[0.03] p-3 space-y-2" data-todo-interactive data-testid="todos-add-row">
                <div className="flex items-center gap-2">
                  <Input
                    ref={addInputRef}
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); submitAdd(); }
                      if (e.key === "Escape") setAdding(false);
                    }}
                    placeholder={`Add a to-do for ${profile.name}…`}
                    className="flex-1"
                    // This field is focused programmatically (line ~372), not
                    // via the `autoFocus` prop — iOS's native "scroll the
                    // newly-focused field into view" then has nothing telling
                    // it to leave room for the sticky header above, and can
                    // land the page at a scroll position where the header/
                    // notch-cover strip ends up overlapping real content (the
                    // same class of bug already fixed once for Grocery List's
                    // "Add item" field).
                    style={{ scrollMarginTop: "calc(6rem + env(safe-area-inset-top, 0px))" }}
                    data-testid="todos-add-input"
                  />
                  <Button size="sm" onClick={submitAdd} disabled={!newTitle.trim() || creating}>Add</Button>
                  <Button size="sm" variant="ghost" className="px-2" onClick={() => setAdding(false)} aria-label="Close add"><X className="w-4 h-4" /></Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Enter adds another. Tap or drag right to nest.</p>
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="todos-loading">
                <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                Loading…
              </div>
            ) : orderedTop.length === 0 && doneItems.length === 0 ? (
              <div className="text-center py-8">
                {/* "scheduled ... today" contradicted this very card's own subtitle,
                    which says to-dos are one-off tasks not tied to a schedule.
                    That wording was copied from the chores card, which genuinely
                    is day-scoped. */}
                <p className="text-muted-foreground text-sm mb-3">Nothing on {profile.name}'s to-do list</p>
                {!adding && <Button size="sm" onClick={openAdd}><Plus className="w-3.5 h-3.5 mr-1.5" />Add a to-do</Button>}
              </div>
            ) : (
              <>
                {orderedTop.length > 0 && (
                  <div className="space-y-1.5">{orderedTop.map(renderNode)}</div>
                )}

                {/* Collapsed "Done" section, same pattern as the Chores/Home
                    cards. A to-do checked off here stays put in the list above
                    for DONE_DELAY_MS first (so an accidental tap is easy to
                    undo), then animates down into this drawer. */}
                {doneItems.length > 0 && (
                  <div className="pt-1">
                    <button
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                      onClick={() => setShowDone(v => !v)}
                      aria-expanded={showDone}
                      data-testid="todos-done-toggle"
                    >
                      {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Done ({doneItems.length})
                    </button>
                    <AnimatePresence initial={false} mode="popLayout">
                      {showDone && (
                        <motion.div
                          key="todos-done"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 space-y-1.5">{doneItems.map(renderNode)}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="p-0 flex flex-col gap-0" style={{ width: "100%", maxWidth: "min(100vw, 440px)" }}>
          <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0 pr-12">
            <SheetTitle className="text-lg font-bold leading-tight">{profile.name}'s completed to-dos</SheetTitle>
            <p className="text-xs text-muted-foreground mt-0.5">A record of finished to-dos from the past 30 days. Delete any to clear them out earlier.</p>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
                <p className="text-muted-foreground text-sm">Nothing completed yet.</p>
              </div>
            ) : (
              <ul>
                {history.map(node => {
                  const when = node.completion?.completedAt ? new Date(node.completion.completedAt) : null;
                  return (
                    <li key={`h-${node.completion!.id}`} className="px-4 py-3 border-b border-border/60">
                      <div className="flex items-start gap-3">
                        <Check className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium break-words">{node.todo.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {when ? when.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
                          </p>
                        </div>
                        {/* Put it back: undoing a completion is the same
                            mutation the list's own checkbox already uses, so
                            this adds no new write path — it deletes the
                            completion row and the to-do reappears where it
                            was. A parent's sub-to-dos keep their own
                            completions; they're independent items. */}
                        <button
                          onClick={() => onUncomplete(
                            node.todo.id,
                            profile.id,
                            new Date(node.completion!.completedAt || new Date()),
                          )}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                          aria-label={`Put ${node.todo.title} back on the list`}
                          title="Put back on the list"
                          data-testid="todo-history-restore"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteNode(node)}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
                          aria-label={`Delete ${node.todo.title}`}
                          data-testid="todo-history-delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Sub-to-dos listed, not just counted — the row said
                          "2 to-dos under it" and then didn't say which. Same
                          indent + left rule the main list uses for children. */}
                      {node.children.length > 0 && (
                        <ul className="mt-2 ml-7 pl-3 border-l-2 border-border space-y-1">
                          {node.children.map(child => (
                            <li key={`hc-${child.todo.id}`} className="flex items-center gap-2" data-testid="todo-history-child">
                              {child.completion
                                ? <Check className="w-3 h-3 text-green-500 shrink-0" />
                                : <span className="w-3 h-3 rounded-full border border-muted-foreground/40 shrink-0" />}
                              <span className={cn(
                                "text-xs break-words",
                                child.completion ? "text-muted-foreground line-through" : "text-foreground",
                              )}>
                                {child.todo.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Drag ghost — same treatment as the Customize Home / Tasks Page
          dialogs: a card that follows the pointer, portalled to document.body
          so no ancestor transform can trap it. */}
      {dragId && ghostPos && (() => {
        const dragged = [...nodes, ...nodes.flatMap(n => n.children)].find(n => n.todo.id === dragId);
        if (!dragged) return null;
        return createPortal(
          <div
            style={{ position: "fixed", left: ghostPos.x, top: ghostPos.y, pointerEvents: "none", zIndex: 9999, maxWidth: 260 }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary bg-card shadow-2xl opacity-95 rotate-1"
          >
            <GripVertical className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{dragged.todo.title}</span>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}

// Every mutation + drag-handler a to-do list needs (create/rename/delete/
// complete/uncomplete/reparent/reorder), extracted so both the dedicated
// To-Dos tab AND Home/People's PersonCard (people-view.tsx) share the exact
// same behavior rather than two copies that could quietly drift apart —
// this is the whole point of "same functionality," not just similar-looking
// UI. `selectedProfileIds` feeds `useParentGate`'s kid-context detection;
// pass the real header selection on the To-Dos tab, or a single profile's
// own id when used from a per-person card that's already scoped to them.
export function useTodoMutations(profiles: Profile[], selectedProfileIds: string[]) {
  const { toast } = useToast();
  const { guard: guardParentAction, gateDialog } = useParentGate(profiles, selectedProfileIds);
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });

  const realProfiles = useMemo(
    () => profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false),
    [profiles],
  );

  const createTodo = useMutation({
    mutationFn: async (data: { title: string; profileIds: string[]; parentChoreId?: string }) => {
      const res = await apiRequest("POST", "/api/chores", {
        title: data.title,
        taskType: "todo",
        points: 0,
        profileIds: data.profileIds,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        recurrenceType: "daily",
        isActive: true,
        ...(data.parentChoreId ? { parentChoreId: data.parentChoreId } : {}),
      });
      return res.json();
    },
    // Show the row immediately instead of waiting for the round trip and a
    // full re-fetch of every chore — typing a to-do and watching a beat of
    // nothing is the whole complaint ("it takes a moment for the items to
    // show up"). The server's own row replaces this one on success, so the
    // real id, displayOrder and any server-side defaults still win.
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chores"] });
      const prev = queryClient.getQueryData<Chore[]>(["/api/chores"]);
      const tempId = `temp-todo-${Date.now()}`;
      const optimistic = {
        id: tempId,
        title: data.title,
        taskType: "todo",
        points: 0,
        profileIds: data.profileIds,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        recurrenceType: "daily",
        isActive: true,
        isBonus: false,
        targetCount: 0,
        endDate: null,
        description: null,
        parentChoreId: data.parentChoreId ?? null,
        // Sort AFTER its own siblings, not after every chore in the family.
        // This used to be the total chore count, which is unrelated to where
        // the row belongs and put a brand-new sub-to-do in a position nothing
        // else agreed with — the "it goes to the correct spot, then moves down
        // to a spot that doesn't make sense" report (2026-09-11).
        displayOrder: (() => {
          const siblings = (prev ?? []).filter(c =>
            ((c as any).parentChoreId ?? null) === (data.parentChoreId ?? null) &&
            c.taskType === "todo");
          return siblings.reduce((m, c) => Math.max(m, ((c as any).displayOrder as number) ?? 0), 0) + 1;
        })(),
      } as unknown as Chore;
      queryClient.setQueryData<Chore[]>(["/api/chores"], (old = []) => [...old, optimistic]);
      return { prev, tempId };
    },
    onSuccess: (created: Chore, _v, ctx) => {
      queryClient.setQueryData<Chore[]>(["/api/chores"], (old = []) =>
        // MERGE over the optimistic row rather than replacing it: anything the
        // POST response omits (profileIds in particular) would otherwise become
        // undefined and drop the row out of its person's list until the next
        // refetch put it back — a row vanishing and reappearing elsewhere.
        old.map(c => (c.id === ctx?.tempId ? ({ ...c, ...(created ?? {}) } as Chore) : c)));
      // Keep the row's React identity across the id swap — see rowKey().
      if (created?.id && ctx?.tempId) aliasRowKey(created.id, ctx.tempId);
      // Deliberately NO invalidateQueries here. The swap above already holds
      // the authoritative row, and refetching immediately re-sorted the list a
      // second time — the "moves back" half of the same report. Same reasoning
      // as complete.onSuccess, which stopped invalidating for the check-off
      // flicker.
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/chores"], ctx.prev);
      toast({ title: "Couldn't add the to-do", description: err?.message, variant: "destructive" });
    },
  });

  const renameTodo = useMutation({
    mutationFn: async (data: { id: string; title: string }) => {
      const res = await apiRequest("PATCH", `/api/chores/${data.id}`, { title: data.title });
      return res.json();
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["/api/chores"] }); },
    onError: (err: any) => toast({ title: "Couldn't save the change", description: err?.message, variant: "destructive" }),
  });

  // Deleting one person's copy must not remove it for everyone else it's
  // assigned to: drop their completion, then detach them from profileIds —
  // deleting the row outright only once they were the last assignee. When the
  // row does go, the server also removes any sub-to-dos filed under it.
  const deleteTodo = useMutation({
    mutationFn: async (v: { todo: Chore; profileId: string; completedAt: Date }) => {
      const dateParam = v.completedAt.toISOString().split("T")[0];
      const localDayStart = new Date(v.completedAt); localDayStart.setHours(0, 0, 0, 0);
      await apiRequest(
        "DELETE",
        `/api/chore-completions/${v.todo.id}/${v.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`,
      );
      const remaining = ((v.todo.profileIds ?? []) as string[]).filter(id => id !== v.profileId);
      if (remaining.length === 0) {
        await apiRequest("DELETE", `/api/chores/${v.todo.id}`);
      } else {
        await apiRequest("PATCH", `/api/chores/${v.todo.id}`, { profileIds: remaining });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
    },
    onError: (err: any) => toast({ title: "Couldn't delete the to-do", description: err?.message, variant: "destructive" }),
  });

  const complete = useMutation({
    mutationFn: async (v: { choreId: string; profileId: string }) => {
      const at = new Date();
      const localDayStart = new Date(at); localDayStart.setHours(0, 0, 0, 0);
      const res = await apiRequest("POST", "/api/chore-completions", {
        choreId: v.choreId, profileId: v.profileId, points: 0,
        completedAt: at.toISOString(), localDayStart: localDayStart.toISOString(),
      });
      return res.json();
    },
    onMutate: async (v) => {
      hapticLight();
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      const tempId = `temp-${Date.now()}`;
      const temp = { id: tempId, choreId: v.choreId, profileId: v.profileId, completedAt: new Date(), points: 0 } as ChoreCompletion;
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) => [...old, temp]);
      return { prev, tempId };
    },
    // Swap the optimistic row for the server's own, rather than invalidating
    // and refetching the whole list. The refetch was a read-after-write race:
    // if it came back before the completion was visible, the row flipped back
    // to unchecked for a beat — and because a completed row sinks to the
    // bottom of the list immediately, it visibly slid down past its
    // neighbours and then climbed back. That is the "it went down under a
    // different one and then moved back up, like it was confused" report.
    // The POST response IS the authoritative row, so there is nothing a
    // refetch could add here. `uncomplete` below already worked this way.
    onSuccess: (created: ChoreCompletion, v, ctx) => {
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.map(c => (c.id === ctx?.tempId ? (created ?? c) : c)));
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/chore-completions"], ctx.prev);
      toast({ title: "Couldn't complete the to-do", description: err?.message, variant: "destructive" });
    },
  });

  const uncomplete = useMutation({
    mutationFn: async (v: { choreId: string; profileId: string; completedAt: Date }) => {
      const dateParam = v.completedAt.toISOString().split("T")[0];
      const localDayStart = new Date(v.completedAt); localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("DELETE", `/api/chore-completions/${v.choreId}/${v.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`);
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.filter(c => !(c.choreId === v.choreId && c.profileId === v.profileId)));
      return { prev };
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] }); },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/chore-completions"], ctx.prev);
      toast({ title: "Couldn't un-check the to-do", description: err?.message, variant: "destructive" });
    },
  });

  // Re-filing a to-do (drag right to nest, drag left to pull back out). The
  // server independently enforces the one-level rule, ownership and
  // self-reference — this is the happy path, not the guard.
  const reparent = useMutation({
    mutationFn: async (v: { child: Chore; parentId: string | null; profileIds?: string[] }) => {
      await apiRequest("PATCH", `/api/chores/${v.child.id}`, {
        parentChoreId: v.parentId,
        ...(v.profileIds ? { profileIds: v.profileIds } : {}),
      });
    },
    onMutate: async (v) => {
      // Optimistic: a drag should land instantly, not after a round-trip.
      await queryClient.cancelQueries({ queryKey: ["/api/chores"] });
      const prev = queryClient.getQueryData<Chore[]>(["/api/chores"]);
      queryClient.setQueryData<Chore[]>(["/api/chores"], (old = []) =>
        old.map(c => c.id === v.child.id
          ? ({ ...c, parentChoreId: v.parentId, ...(v.profileIds ? { profileIds: v.profileIds } : {}) } as Chore)
          : c));
      return { prev };
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/chores"], ctx.prev);
      toast({ title: "Couldn't move the to-do", description: err?.message, variant: "destructive" });
    },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ["/api/chores"] }); },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => { await apiRequest("POST", "/api/chores/reorder", { orderedIds }); },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      toast({ title: "Couldn't save the new order", description: err?.message, variant: "destructive" });
    },
  });

  // A card hands back the new order for ITS person's top-level to-dos. Those
  // ids are slotted back into the positions they already occupy in the global
  // chore order, so one person's reorder never disturbs anyone else's — and
  // sub-to-dos, other people's to-dos and regular chores all stay put.
  const handleReorder = (orderedParentIds: string[]) => {
    const inSet = new Set(orderedParentIds);
    let k = 0;
    const fullOrder = chores.map(c => (inSet.has(c.id) ? orderedParentIds[k++] : c.id));
    queryClient.setQueryData<Chore[]>(["/api/chores"], (old = []) => {
      const byId = new Map(old.map(c => [c.id, c]));
      return fullOrder.map(id => byId.get(id)!).filter(Boolean);
    });
    reorderMutation.mutate(fullOrder);
  };

  // A sub-to-do belongs to whoever owns the list above it (the same rule
  // onCreateUnder uses), so nesting adopts the parent's people. When that would
  // actually take it off someone's list, say so first rather than silently
  // dropping their copy.
  const handleIndent = (child: Chore, parent: Chore) => {
    guardParentAction("createTodo", async () => {
      const childIds = (child.profileIds ?? []) as string[];
      const parentIds = (parent.profileIds ?? []) as string[];
      const dropped = childIds.filter(id => !parentIds.includes(id));
      if (dropped.length > 0) {
        const names = dropped
          .map(id => realProfiles.find(p => p.id === id)?.name ?? "someone")
          .join(", ");
        const ok = await confirmDialog({
          title: `Put "${child.title}" under "${parent.title}"?`,
          description: `A to-do filed under another one is assigned to the same people, so this takes it off ${names}'s list.`,
          confirmLabel: "Move it",
        });
        if (!ok) return;
      }
      reparent.mutate({ child, parentId: parent.id, profileIds: parentIds });
    });
  };

  // Pulling back out keeps the people it currently has — it already belongs to
  // the person whose card it was sitting in.
  const handleOutdent = (child: Chore) => {
    guardParentAction("createTodo", () => { reparent.mutate({ child, parentId: null }); });
  };

  /**
   * Delete a to-do that is still OPEN.
   *
   * Deliberately separate from `deleteTodo`, which starts by deleting the
   * completion row — an open to-do has none, so that call would be a wasted
   * round trip against a row that doesn't exist. This only touches the chore
   * itself: gone entirely when nobody else is assigned, otherwise just dropped
   * from this person's list.
   */
  const deleteOpenTodo = useMutation({
    mutationFn: async (v: { todo: Chore; profileId: string }) => {
      const remaining = ((v.todo.profileIds ?? []) as string[]).filter(id => id !== v.profileId);
      if (remaining.length === 0) {
        await apiRequest("DELETE", `/api/chores/${v.todo.id}`);
      } else {
        await apiRequest("PATCH", `/api/chores/${v.todo.id}`, { profileIds: remaining });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
    },
    onError: (err: any) => toast({ title: "Couldn't delete the to-do", description: err?.message, variant: "destructive" }),
  });

  const askDeleteOpen = (todo: Chore, profileId: string, kidCount: number) => {
    const sharedWithOthers = ((todo.profileIds ?? []) as string[]).length > 1;
    guardParentAction("createTodo", async () => {
      const description = sharedWithOthers
        ? "Others assigned keep their copy."
        : kidCount > 0
          // The server removes a parent's children with it, so say how many
          // rather than letting them disappear without warning.
          ? `This also deletes the ${kidCount} to-do${kidCount === 1 ? "" : "s"} filed under it.`
          : "This removes the to-do for good.";
      const title = kidCount > 0 && !sharedWithOthers
        ? `Delete "${todo.title}" and the ${kidCount} to-do${kidCount === 1 ? "" : "s"} under it?`
        : `Delete "${todo.title}"?`;
      if (await confirmDialog({ title, description, confirmLabel: "Delete" })) {
        deleteOpenTodo.mutate({ todo, profileId });
      }
    });
  };

  const askDelete = (node: TodoNode) => {
    const sharedWithOthers = ((node.todo.profileIds ?? []) as string[]).length > 1;
    const kidCount = node.children.length;
    guardParentAction("createTodo", async () => {
      const description = sharedWithOthers
        ? "Others assigned keep their copy."
        : kidCount > 0
          // Deleting the parent takes its sub-to-dos with it (server-side),
          // so say exactly how many rather than letting them vanish silently.
          ? `This also deletes the ${kidCount} to-do${kidCount === 1 ? "" : "s"} filed under it.`
          : "This removes the to-do for good.";
      const title = kidCount > 0 && !sharedWithOthers
        ? `Delete "${node.todo.title}" and the ${kidCount} to-do${kidCount === 1 ? "" : "s"} under it?`
        : `Delete "${node.todo.title}"?`;
      if (await confirmDialog({ title, description, confirmLabel: "Delete" })) {
        deleteTodo.mutate({
          todo: node.todo,
          profileId: node.profileId,
          completedAt: new Date(node.completion!.completedAt || new Date()),
        });
      }
    });
  };

  return {
    createTodo, renameTodo, deleteTodo, deleteOpenTodo, complete, uncomplete, reparent, reorderMutation,
    handleReorder, handleIndent, handleOutdent, askDelete, askDeleteOpen, guardParentAction, gateDialog,
  };
}

/** Single-profile version of TodosView's own `nodesByProfile` builder — for
 * a caller (PersonCard) that already knows which one profile it's showing,
 * rather than needing every profile's lists at once. */
export function buildTodoNodesForProfile(chores: Chore[], completions: ChoreCompletion[], profileId: string): TodoNode[] {
  const todoChores = chores.filter(c => c.taskType === "todo" && c.isActive !== false);
  const parentTodos = todoChores.filter(c => !(c as any).parentChoreId);
  const childrenByParent = new Map<string, Chore[]>();
  for (const c of todoChores) {
    const pid = (c as any).parentChoreId as string | null | undefined;
    if (!pid) continue;
    const arr = childrenByParent.get(pid);
    if (arr) arr.push(c); else childrenByParent.set(pid, [c]);
  }
  const completionByPair = new Map<string, ChoreCompletion>();
  for (const c of completions) {
    if (!c.profileId) continue;
    const key = `${c.choreId}:${c.profileId}`;
    const prev = completionByPair.get(key);
    if (!prev || (c.completedAt && prev.completedAt && new Date(c.completedAt) > new Date(prev.completedAt))) {
      completionByPair.set(key, c);
    }
  }
  const out: TodoNode[] = [];
  for (const todo of parentTodos) {
    if (!((todo.profileIds ?? []) as string[]).includes(profileId)) continue;
    out.push({
      todo,
      profileId,
      completion: completionByPair.get(`${todo.id}:${profileId}`) ?? null,
      children: (childrenByParent.get(todo.id) ?? [])
        .map(kid => ({ todo: kid, completion: completionByPair.get(`${kid.id}:${profileId}`) ?? null }))
        .sort((a, b) => (a.completion ? 1 : 0) - (b.completion ? 1 : 0)),
    });
  }
  return out;
}

export function TodosView({ profiles, selectedProfiles, onAddTodo }: TodosViewProps) {
  const {
    createTodo, renameTodo, complete, uncomplete,
    handleReorder, handleIndent, handleOutdent, askDelete, askDeleteOpen, guardParentAction, gateDialog,
  } = useTodoMutations(profiles, selectedProfiles);

  const { data: chores = [], isLoading: choresLoading } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const { data: completions = [], isLoading: completionsLoading } = useQuery<ChoreCompletion[]>({ queryKey: ["/api/chore-completions"] });
  const isLoading = choresLoading || completionsLoading;

  const [sortMode, setSortModeState] = useState<SortMode>(loadSortMode);
  // Set for ~1.4s after a drag that A–Z refused, to draw the eye to the
  // control actually doing the ordering. Deliberately not a message: the
  // answer to "why won't this move?" is a button, so point at the button.
  const [sortNudge, setSortNudge] = useState(false);
  const sortRowRef = useRef<HTMLDivElement>(null);
  const nudgeSort = () => {
    // The sort control sits above the cards, so on a long list it can easily
    // be off-screen by the time someone drags a row near the bottom —
    // flashing something nobody can see would be no signal at all.
    sortRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setSortNudge(true);
  };
  useEffect(() => {
    if (!sortNudge) return;
    const t = setTimeout(() => setSortNudge(false), 1400);
    return () => clearTimeout(t);
  }, [sortNudge]);
  const setSortMode = (m: SortMode) => {
    setSortModeState(m);
    try { localStorage.setItem(SORT_STORAGE_KEY, m); } catch { /* non-fatal */ }
  };

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const realProfiles = useMemo(
    () => profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false),
    [profiles],
  );

  const visibleProfiles = useMemo(() => {
    const sel = selectedProfiles.filter(id => realProfiles.some(p => p.id === id));
    return sel.length > 0 ? realProfiles.filter(p => sel.includes(p.id)) : realProfiles;
  }, [realProfiles, selectedProfiles]);

  const completionByPair = useMemo(() => {
    const m = new Map<string, ChoreCompletion>();
    for (const c of completions) {
      if (!c.profileId) continue;
      const key = `${c.choreId}:${c.profileId}`;
      const prev = m.get(key);
      if (!prev || (c.completedAt && prev.completedAt && new Date(c.completedAt) > new Date(prev.completedAt))) {
        m.set(key, c);
      }
    }
    return m;
  }, [completions]);

  const todoChores = useMemo(
    () => chores.filter(c => c.taskType === "todo" && c.isActive !== false),
    [chores],
  );
  const parentTodos = useMemo(() => todoChores.filter(c => !(c as any).parentChoreId), [todoChores]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Chore[]>();
    for (const c of todoChores) {
      const pid = (c as any).parentChoreId as string | null | undefined;
      if (!pid) continue;
      const arr = m.get(pid);
      if (arr) arr.push(c); else m.set(pid, [c]);
    }
    return m;
  }, [todoChores]);

  // Top-level to-dos per person, each with its sub-to-dos attached. Children
  // inherit the parent's people at creation time, so they're completable by
  // the same person the parent belongs to.
  const nodesByProfile = useMemo(() => {
    const out = new Map<string, TodoNode[]>();
    for (const p of visibleProfiles) out.set(p.id, []);
    for (const todo of parentTodos) {
      for (const pid of (todo.profileIds ?? []) as string[]) {
        const bucket = out.get(pid);
        if (!bucket) continue;
        bucket.push({
          todo,
          profileId: pid,
          completion: completionByPair.get(`${todo.id}:${pid}`) ?? null,
          // Checking off a sub-to-do sinks it to the bottom of its own
          // parent's list instead of leaving it wherever it happened to be
          // — .sort() is stable (spec-guaranteed since ES2019), so this only
          // moves completed items past incomplete ones, without otherwise
          // reordering either group relative to itself.
          children: (childrenByParent.get(todo.id) ?? [])
            .map(kid => ({
              todo: kid,
              completion: completionByPair.get(`${kid.id}:${pid}`) ?? null,
            }))
            .sort((a, b) => (a.completion ? 1 : 0) - (b.completion ? 1 : 0)),
        });
      }
    }
    return out;
  }, [parentTodos, childrenByParent, visibleProfiles, completionByPair]);


  // Fires when the LAST of a profile's to-dos is checked off, on the To-Dos
  // tab — the one place to-dos are actually listed. Home keeps its own
  // celebration for finishing all the CHORES; the two are separate occasions
  // and dedup independently ("todos" vs "chores"), so finishing one never
  // silences the other.
  const fireTodoConfetti = () => {
    hapticSuccess();
    confetti({ particleCount: 120, spread: 80, origin: { x: 0.5, y: 0.55 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 45, gravity: 0.9, ticks: 200 });
    setTimeout(() => confetti({ particleCount: 60, angle: 60,  spread: 55, origin: { x: 0, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], startVelocity: 50, ticks: 180 }), 150);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'], startVelocity: 50, ticks: 180 }), 300);
  };

  const celebrateIfAllTodosDone = (profileId: string, justCompletedId: string) => {
    const nodes = nodesByProfile.get(profileId) ?? [];
    // EVERY row counts — parents included. This was briefly relaxed so that a
    // parent used purely as a heading did not hold the list back, but that
    // made the celebration fire while a genuine, visibly-unticked to-do was
    // still sitting there (reported 2026-09-12: two top-level to-dos and one
    // sub-to-do, ticking one top-level and the sub fired it).
    //
    // A parent is its own row with its own circle, so it has to be ticked
    // like anything else — taken literally from "it should not send confetti
    // until ALL to-dos (main and sub to dos) are complete".
    const all: { id: string; done: boolean }[] = [];
    for (const n of nodes) {
      all.push({ id: n.todo.id, done: !!n.completion });
      for (const kid of n.children) all.push({ id: kid.todo.id, done: !!kid.completion });
    }
    if (all.length === 0) return;
    const stillOpen = all.filter(t => t.id !== justCompletedId && !t.done);
    if (stillOpen.length > 0) return;
    const today = new Date();
    if (hasCelebratedAllDone(profileId, today, "todos")) return;
    markCelebratedAllDone(profileId, today, "todos");
    setTimeout(fireTodoConfetti, 400);
  };

  return (
    <>
      <div className="space-y-4">
        {visibleProfiles.length > 0 && (
          <div
            ref={sortRowRef}
            className={cn(
              "flex items-center justify-end gap-1.5 rounded-lg px-1.5 py-1 transition-shadow",
              sortNudge && "ring-2 ring-primary animate-pulse",
            )}
            data-testid="todos-sort-row"
          >
            {onAddTodo && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5 mr-auto"
                onClick={onAddTodo}
                data-testid="todos-add-multi"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add to-dos
              </Button>
            )}
            <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground mr-0.5">Sort</span>
            <Button
              size="sm"
              variant={sortMode === "manual" ? "default" : "outline"}
              className="h-7 text-xs px-2.5"
              onClick={() => setSortMode("manual")}
              data-testid="todos-sort-manual"
            >
              Manual
            </Button>
            <Button
              size="sm"
              variant={sortMode === "alpha" ? "default" : "outline"}
              className="h-7 text-xs px-2.5"
              onClick={() => setSortMode("alpha")}
              data-testid="todos-sort-alpha"
            >
              A–Z
            </Button>
          </div>
        )}

        {/* Profiles with nothing on their list collapse by default rather
            than each taking a full card's height — a family of five was
            scrolling past several empty cards to reach any content. Their
            card still renders (with its add button); it just starts closed.
            Only applies when at least one other person HAS something, so a
            family with no to-dos at all still sees a real empty state. */}
        {visibleProfiles.map(profile => (
          <PersonTodoCard
            key={profile.id}
            profile={profile}
            nodes={nodesByProfile.get(profile.id) ?? []}
            startCollapsed={
              (nodesByProfile.get(profile.id) ?? []).length === 0 &&
              visibleProfiles.some(o => (nodesByProfile.get(o.id) ?? []).length > 0)
            }
            sortMode={sortMode}
            nowMs={nowMs}
            creating={createTodo.isPending}
            isLoading={isLoading}
            onReorderBlocked={nudgeSort}
            onCreate={(title, profileId) => createTodo.mutate({ title, profileIds: [profileId] })}
            // A sub-to-do inherits its parent's people — it belongs to whoever
            // owns the list above it, so a group never splits across cards.
            onCreateUnder={(title, parent) => createTodo.mutate({
              title,
              profileIds: ((parent.profileIds ?? []) as string[]),
              parentChoreId: parent.id,
            })}
            onComplete={(choreId, profileId) => {
              complete.mutate({ choreId, profileId });
              celebrateIfAllTodosDone(profileId, choreId);
            }}
            onUncomplete={(choreId, profileId, completedAt) => {
              // Re-arm the celebration: the list isn't finished any more.
              clearCelebratedAllDone(profileId, new Date(), "todos");
              uncomplete.mutate({ choreId, profileId, completedAt });
            }}
            onRename={(id, title) => renameTodo.mutate({ id, title })}
            onDeleteNode={askDelete}
            onDeleteRow={(choreId) => {
              // Resolve the row from this profile's own tree, so a sub-to-do
              // is deleted as itself rather than as its parent.
              const nodes = nodesByProfile.get(profile.id) ?? [];
              const parent = nodes.find(n => n.todo.id === choreId);
              if (parent) { askDeleteOpen(parent.todo, profile.id, parent.children.length); return; }
              for (const n of nodes) {
                const kid = n.children.find(k => k.todo.id === choreId);
                if (kid) { askDeleteOpen(kid.todo, profile.id, 0); return; }
              }
            }}
            onReorder={handleReorder}
            onIndent={handleIndent}
            onOutdent={handleOutdent}
            guard={(action) => guardParentAction("createTodo", action)}
          />
        ))}

        {visibleProfiles.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Add someone in Settings → People to start tracking to-dos.
          </p>
        )}
      </div>
      {gateDialog}
    </>
  );
}

/**
 * A single self-contained PersonTodoCard for callers that already know
 * which one profile they're showing (PersonCard on Home/People, rather than
 * the dedicated To-Dos tab's own per-profile loop) — nesting, drag-to-file-
 * under, add-under, delete-with-children, all identical to the To-Dos tab,
 * since it's built from the exact same `PersonTodoCard` + `useTodoMutations`
 * + `buildTodoNodesForProfile` those use.
 *
 * Deliberately does its OWN `/api/chores`/`/api/chore-completions` fetch
 * (cached/shared — no extra network cost, same query keys everything else
 * already uses) rather than reusing whatever `chores` prop the embedding
 * card already has: PersonCard's own copy is pre-filtered for its flat
 * chore rendering (e.g. Home's already strips out same-day-completed
 * chores before it ever reaches PersonCard), which would silently break
 * the sub-to-do/Done grouping here if reused directly.
 */
export function PersonTodoList({ profile, allProfiles, embedded = false, hideDone = false, onVisibleCountChange }: {
  profile: Profile;
  allProfiles: Profile[];
  embedded?: boolean;
  hideDone?: boolean;
  /** Lets the card above hide this section's header entirely when there's
   *  nothing to put under it. */
  onVisibleCountChange?: (n: number) => void;
}) {
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const { data: completions = [] } = useQuery<ChoreCompletion[]>({ queryKey: ["/api/chore-completions"] });
  const {
    createTodo, renameTodo, complete, uncomplete,
    handleReorder, handleIndent, handleOutdent, askDelete, askDeleteOpen, guardParentAction, gateDialog,
  } = useTodoMutations(allProfiles, [profile.id]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nodes = useMemo(() => buildTodoNodesForProfile(chores, completions, profile.id), [chores, completions, profile.id]);

  // What this section would actually show: everything still open, plus
  // anything finished TODAY. A to-do completed on an earlier day is
  // permanent but no longer displayed (it's in Family Activity), so a person
  // whose whole list is old completions has nothing to show here.
  // hideDone (Home's Tasks card, which keeps its own Done list) means the
  // finished-today rows aren't rendered here at all — so they must not count
  // toward "is there anything to show", or Home shows a To-Dos header over
  // nothing for a person whose whole list is already done.
  const visibleCount = useMemo(() => nodes.filter(n => {
    const at = n.completion?.completedAt;
    if (!at) return true;
    if (hideDone) return false;
    return isSameLocalDay(new Date(at), new Date(nowMs));
  }).length, [nodes, nowMs, hideDone]);

  useEffect(() => { onVisibleCountChange?.(visibleCount); }, [visibleCount, onVisibleCountChange]);

  // Nothing to show: render nothing at all rather than a header over an empty
  // state. The card above hides its section header to match, so a person with
  // no to-dos simply has no To-Dos section.
  if (embedded && visibleCount === 0) return <>{gateDialog}</>;

  return (
    <>
      <PersonTodoCard
        embedded={embedded}
        hideDone={hideDone}
        profile={profile}
        nodes={nodes}
        // No page-level Manual/A–Z toggle here — that's a To-Dos-tab-only
        // control, not part of what "same functionality" was about.
        sortMode="manual"
        nowMs={nowMs}
        creating={createTodo.isPending}
        isLoading={false}
        onCreate={(title, profileId) => createTodo.mutate({ title, profileIds: [profileId] })}
        onCreateUnder={(title, parent) => createTodo.mutate({
          title,
          profileIds: ((parent.profileIds ?? []) as string[]),
          parentChoreId: parent.id,
        })}
        onComplete={(choreId, profileId) => complete.mutate({ choreId, profileId })}
        onUncomplete={(choreId, profileId, completedAt) => uncomplete.mutate({ choreId, profileId, completedAt })}
        onRename={(id, title) => renameTodo.mutate({ id, title })}
        onDeleteNode={askDelete}
        onDeleteRow={(choreId) => {
          const parent = nodes.find(n => n.todo.id === choreId);
          if (parent) { askDeleteOpen(parent.todo, profile.id, parent.children.length); return; }
          for (const n of nodes) {
            const kid = n.children.find(k => k.todo.id === choreId);
            if (kid) { askDeleteOpen(kid.todo, profile.id, 0); return; }
          }
        }}
        onReorder={handleReorder}
        onIndent={handleIndent}
        onOutdent={handleOutdent}
        guard={(action) => guardParentAction("createTodo", action)}
      />
      {gateDialog}
    </>
  );
}
