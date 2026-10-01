import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ChoreIcon } from "@/components/customChoreIcons";
import { objectUrl } from "@/lib/apiBase";
import { Chore, Profile } from "@workspace/shared-types";
import { deriveTaskKind, TaskKind } from "@/components/create-task-modal";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Edit, Trash2, Star, Target, X, UserX, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/lib/confirmDialog";

const DAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const CATEGORY_COLORS: Record<string, string> = {
  cleaning: "#3b82f6",
  kitchen: "#f97316",
  laundry: "#a855f7",
  outdoor: "#22c55e",
  pet: "#f59e0b",
  personal: "#ec4899",
  general: "#6b7280",
};

interface ChoreManagementDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chores: Chore[];
  profiles: Profile[];
  onEdit: (chore: Chore) => void;
  onDelete: (choreId: string) => void;
  onAddChore: () => void;
  /** Display wording — the To-Dos card passes "Manage To-Dos"/"to-do" so the
   * same drawer reads correctly for either item kind. */
  title?: string;
  noun?: string;
}

// Every task shares one drawer now, classified by kind (via the same
// deriveTaskKind the create/edit modal uses, so they never disagree).
// "Unassigned" is a separate cross-cutting STATUS (any non-bonus task with no
// one assigned) — bonus chores with an empty list mean "everyone", not
// unassigned.
type FilterKey = TaskKind | "unassigned";
function isUnassignedTask(c: Chore): boolean {
  return deriveTaskKind(c) !== "bonus" && ((c.profileIds ?? []) as string[]).length === 0;
}
const KIND_FILTERS: { key: TaskKind; label: string; badge: string; badgeClass: string; stripe: string }[] = [
  { key: "regular", label: "Regular", badge: "Regular", badgeClass: "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400", stripe: "#3b82f6" },
  { key: "target", label: "Target", badge: "Target", badgeClass: "bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400", stripe: "#8b5cf6" },
  { key: "bonus", label: "Bonus", badge: "Bonus", badgeClass: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400", stripe: "#f59e0b" },
  { key: "todo", label: "To-dos", badge: "To-do", badgeClass: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400", stripe: "#64748b" },
  { key: "inspiration", label: "Inspiration", badge: "Inspiration", badgeClass: "bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400", stripe: "#0d9488" },
];
const KIND_BY_KEY = Object.fromEntries(KIND_FILTERS.map(f => [f.key, f])) as Record<TaskKind, typeof KIND_FILTERS[number]>;

// Default grouping order for the unfiltered list — per explicit request:
// Chore, Target Chore, Bonus Chore, then To-Dos. Inspiration isn't part of
// that requested sequence but is still a kind this drawer manages, so it
// gets its own trailing section rather than being dropped.
const TASK_KIND_ORDER: TaskKind[] = ["regular", "target", "bonus", "todo", "inspiration"];
const SECTION_LABELS: Record<TaskKind, string> = {
  regular: "Chores",
  target: "Target Chores",
  bonus: "Bonus Chores",
  todo: "To-Dos",
  inspiration: "Inspiration",
};

function scheduleLabel(chore: Chore): string {
  const kind = deriveTaskKind(chore);
  if (kind === "bonus") {
    const ft = (chore as any).bonusFrequencyType ?? "unlimited";
    if (ft === "unlimited") return "Anytime";
    return `${(chore as any).bonusFrequencyCount ?? 1}× / ${(chore as any).bonusFrequencyPeriod ?? "wk"}`;
  }
  if (kind === "todo" || kind === "inspiration") return kind === "todo" ? "To-do" : "Reflect";
  if (chore.targetCount && chore.targetCount > 0) {
    return `${chore.targetCount}× / ${chore.recurrenceType === "monthly" ? "mo" : "wk"}`;
  }
  const days = (chore.daysOfWeek ?? []) as number[];
  if (days.length === 7) return "Every day";
  if (days.length === 5 && days.includes(1) && !days.includes(0)) return "Weekdays";
  if (days.length === 2 && (days.includes(0) || days.includes(6))) return "Weekends";
  if (days.length > 0 && days.length <= 3) return days.sort((a, b) => a - b).map(d => DAYS_SHORT[d]).join(" ");
  if (days.length > 0) return `${days.length} days/wk`;
  return "—";
}

export function ChoreManagementDrawer({
  open,
  onOpenChange,
  chores,
  profiles,
  onEdit,
  onDelete,
  onAddChore,
  title = "Manage Chores",
  noun = "chore",
}: ChoreManagementDrawerProps) {
  const [search, setSearch] = useState("");
  const [filterProfileId, setFilterProfileId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FilterKey | "all">("all");
  // Pointer-based drag (not HTML5 draggable) — draggable never fires on
  // iOS/WKWebView, the app's primary platform; todos-view.tsx documents and
  // uses this same window-pointermove/pointerup pattern for exactly that reason.
  const [dragId, setDragId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const dragStateRef = useRef<{ id: string; kind: TaskKind; order: string[]; initial: string[] } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // Drag-and-drop only makes sense against the family's real, full order —
  // disabled while a search/profile/type filter is narrowing the list, since
  // dropping a chore "between" two currently-visible rows wouldn't have a
  // well-defined position among the hidden ones.
  const isFiltered = !!search || !!filterProfileId || typeFilter !== "all";

  // Which kind chips to offer, and their counts — computed from the full list so
  // a family sees e.g. "Target (3)" and only the kinds actually present, plus a
  // cross-cutting Unassigned count.
  const kindCounts = useMemo(() => {
    const counts: Record<TaskKind, number> = { regular: 0, target: 0, bonus: 0, todo: 0, inspiration: 0 };
    let unassigned = 0;
    for (const c of chores) { counts[deriveTaskKind(c)]++; if (isUnassignedTask(c)) unassigned++; }
    return { counts, unassigned };
  }, [chores]);
  const presentKinds = KIND_FILTERS.filter(t => kindCounts.counts[t.key] > 0);
  // Only worth a filter row when there's more than one kind (or an unassigned to surface).
  const showTypeFilter = presentKinds.length > 1 || kindCounts.unassigned > 0;

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest("POST", "/api/chores/reorder", { orderedIds });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    },
  });

  const filtered = useMemo(() => {
    const matches = chores.filter(c => {
      if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterProfileId && !(c.profileIds ?? []).includes(filterProfileId)) return false;
      if (typeFilter !== "all") {
        if (typeFilter === "unassigned") { if (!isUnassignedTask(c)) return false; }
        else if (deriveTaskKind(c) !== typeFilter) return false;
      }
      return true;
    });
    // Unfiltered: keep the server's displayOrder (already sorted that way by
    // getChoresByUser) so drag-and-drop has a stable order to reorder — grouped
    // into per-kind sections below, not shown flat.
    // Filtered: alphabetical is more useful for finding something specific.
    return isFiltered ? [...matches].sort((a, b) => a.title.localeCompare(b.title)) : matches;
  }, [chores, search, filterProfileId, typeFilter, isFiltered]);

  // Default (unfiltered) view: always grouped into sections by kind, in the
  // fixed order Chore → Target Chore → Bonus Chore → To-Dos → Inspiration —
  // this grouping is automatic and not itself reorderable. Within a section,
  // items keep their existing relative displayOrder (stable partition), and
  // can be dragged into a custom order — see handleChoreDrop below, which
  // only permits reordering within one kind at a time.
  const groupedSections = useMemo(() => {
    if (isFiltered) return [];
    const groups: Record<TaskKind, Chore[]> = { regular: [], target: [], bonus: [], todo: [], inspiration: [] };
    for (const c of chores) groups[deriveTaskKind(c)].push(c);
    return TASK_KIND_ORDER.map(kind => ({ kind, items: groups[kind] })).filter(g => g.items.length > 0);
  }, [chores, isFiltered]);

  const commitGroupOrder = (kind: TaskKind, reorderedGroup: string[]) => {
    // Rebuild the full displayOrder list kind-major (fixed section order),
    // substituting the just-reordered group for its kind — this keeps the
    // automatic by-type grouping intact while persisting the new intra-kind
    // order the user dragged into place.
    const fullOrder: string[] = [];
    for (const k of TASK_KIND_ORDER) {
      fullOrder.push(...(k === kind ? reorderedGroup : chores.filter(c => deriveTaskKind(c) === k).map(c => c.id)));
    }
    queryClient.setQueryData<Chore[]>(["/api/chores"], (old = []) => {
      const byId = new Map(old.map(c => [c.id, c]));
      return fullOrder.map(id => byId.get(id)!).filter(Boolean);
    });
    reorderMutation.mutate(fullOrder);
  };

  const startDrag = (e: React.PointerEvent, chore: Chore) => {
    if (isFiltered) return;
    const kind = deriveTaskKind(chore);
    const order = chores.filter(c => deriveTaskKind(c) === kind).map(c => c.id);
    if (order.length < 2) return;
    e.preventDefault();
    dragStateRef.current = { id: chore.id, kind, order: [...order], initial: [...order] };
    setDragId(chore.id);
    setLocalOrder(order);
  };

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      let targetId: string | null = null;
      for (const id of st.order) {
        if (id === st.id) continue;
        const el = rowRefs.current.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { targetId = id; break; }
      }
      if (!targetId) return;
      const from = st.order.indexOf(st.id);
      const to = st.order.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...st.order];
      next.splice(from, 1);
      next.splice(to, 0, st.id);
      st.order = next;
      setLocalOrder(next);
    };
    const onUp = () => {
      const st = dragStateRef.current;
      if (st && st.order.join(",") !== st.initial.join(",")) {
        commitGroupOrder(st.kind, st.order);
      }
      dragStateRef.current = null;
      setDragId(null);
      setLocalOrder(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  // Shared row renderer for both the grouped (default) sections and the flat
  // filtered list. `dragEnabled` is false whenever filtered, or for a
  // single-item section — nothing meaningful to reorder against.
  const renderChoreRow = (chore: Chore, dragEnabled: boolean) => {
    const choreProfiles = (chore.profileIds ?? [])
      .map(id => profiles.find(p => p.id === id))
      .filter(Boolean) as Profile[];
    const kind = deriveTaskKind(chore);
    const kindMeta = KIND_BY_KEY[kind];
    // Use the kind's stripe colour so the list scans by kind; fall
    // back to the category colour only if somehow unknown.
    const catColor = kindMeta?.stripe ?? (CATEGORY_COLORS[chore.category ?? "general"] ?? CATEGORY_COLORS.general);
    const isUnassigned = isUnassignedTask(chore);
    const isBonusEveryone = kind === "bonus" && ((chore.profileIds ?? []) as string[]).length === 0;

    const canDrag = !isFiltered && dragEnabled;
    return (
      <li
        key={chore.id}
        ref={(el) => {
          if (el) rowRefs.current.set(chore.id, el);
          else rowRefs.current.delete(chore.id);
        }}
        className={cn(
          "flex flex-col border-b border-border/60 transition-colors",
          dragId === chore.id && "opacity-40",
        )}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors" style={{ minHeight: 60 }}>
          {/* Drag handle — only shown when the list is in its real,
              reorderable order (no active search/filter). Pointer-based (not
              HTML5 draggable), which never fires on iOS/WKWebView. */}
          {canDrag && (
            <span
              className="flex items-center justify-center -ml-1 p-1.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none"
              title="Drag to reorder"
              onPointerDown={(e) => startDrag(e, chore)}
            >
              <GripVertical className="w-4 h-4" />
            </span>
          )}
          {/* Category stripe */}
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ backgroundColor: catColor }}
          />

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {chore.icon && (
                <ChoreIcon icon={chore.icon} className="w-4 h-4" />
              )}
              <span className="font-semibold text-sm text-foreground truncate max-w-[160px] sm:max-w-[200px]">
                {chore.title}
              </span>
              {/* Kind badge comes FIRST, before the schedule. It's the one
                  badge every row has, so leading with it keeps it in the same
                  place down the list; the schedule label's width varies a lot
                  ("Daily" vs "3× / wk"), and when it led, a long one pushed
                  the kind badge onto a second line on that row alone. */}
              {kindMeta && (
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0", kindMeta.badgeClass)}>
                  {kindMeta.badge}
                </span>
              )}
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0">
                {scheduleLabel(chore)}
              </span>
              {isUnassigned && (
                <span className="text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 whitespace-nowrap shrink-0">
                  <UserX className="w-2.5 h-2.5" />
                  Unassigned
                </span>
              )}
              {isBonusEveryone && (
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">Everyone</span>
              )}
              {!chore.isActive && (
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                  inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {/* Assignee avatars (assigned chores only) */}
              {choreProfiles.length > 0 && (
                <div className="flex -space-x-1">
                  {choreProfiles.slice(0, 5).map(p => (
                    <div
                      key={p.id}
                      className="w-5 h-5 rounded-full border-2 border-background flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${p.color}, ${p.color}90)`,
                      }}
                      title={p.name}
                    >
                      {p.photoUrl ? (
                        <img
                          src={objectUrl(p.photoUrl)}
                          alt={p.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        p.initials
                      )}
                    </div>
                  ))}
                  {choreProfiles.length > 5 && (
                    <div className="w-5 h-5 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                      +{choreProfiles.length - 5}
                    </div>
                  )}
                </div>
              )}
              {/* Points — to-dos and inspiration items are defined as never
                  earning stars, so a stray "⭐ 0" here would be misleading. */}
              {kind !== "todo" && kind !== "inspiration" && (
                <div className="flex items-center gap-0.5 text-yellow-500">
                  <Star className="w-3 h-3 fill-current" />
                  <span className="text-xs font-semibold">{chore.points ?? 0}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => onEdit(chore)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              title={`Edit ${kindMeta?.label.toLowerCase().replace(/s$/, "") ?? noun}`}
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={async () => {
                if (await confirmDialog({ title: `Delete "${chore.title}"?` })) onDelete(chore.id);
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-colors text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label={`Delete ${kindMeta?.label.toLowerCase().replace(/s$/, "") ?? noun}`}
              title={`Delete ${kindMeta?.label.toLowerCase().replace(/s$/, "") ?? noun}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col gap-0"
        style={{ width: "100%", maxWidth: "min(100vw, 480px)" }}
        onInteractOutside={(e) => {
          // Tapping into a dialog that opens ON TOP of this drawer (the edit
          // modal, the delete confirmation, or the Parent PIN prompt) registers
          // as an "interact outside" and would otherwise dismiss the drawer,
          // dumping the user on the bare Tasks tab. Ignore those; a real
          // backdrop tap (target not inside another dialog) still closes it.
          const t = (e.detail as any)?.originalEvent?.target as Element | null;
          if (t && t.closest('[role="dialog"],[role="alertdialog"]')) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border flex-shrink-0 pr-12">
          <div className="flex-1 min-w-0">
            <SheetTitle className="text-lg font-bold leading-tight">{title}</SheetTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{chores.length} {noun}{chores.length !== 1 ? "s" : ""} total</p>
          </div>
          <Button
            size="sm"
            className="gap-1.5 rounded-full shrink-0"
            onClick={() => {
              onOpenChange(false);
              setTimeout(onAddChore, 150);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>

        {/* Search + profile filter */}
        <div className="px-4 py-3 space-y-2.5 border-b border-border flex-shrink-0 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={`Search ${noun}s…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm bg-background"
            />
          </div>
          {profiles.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterProfileId(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filterProfileId === null
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                All
              </button>
              {profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    setFilterProfileId(filterProfileId === p.id ? null : p.id);
                    // A person filter and "Unassigned" can never both match
                    // anything (unassigned means no profileIds at all), so
                    // picking a person here clears that filter too — same
                    // reasoning as the Unassigned chip clearing this one.
                    if (typeFilter === "unassigned") setTypeFilter("all");
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    filterProfileId === p.id
                      ? "text-white"
                      : "bg-background border border-border text-muted-foreground hover:bg-accent"
                  }`}
                  style={filterProfileId === p.id ? { backgroundColor: p.color } : {}}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {/* Kind filter (Regular / Target / Bonus / To-dos / Inspiration) plus
              a cross-cutting Unassigned status chip. Shown only for kinds
              actually present, and only when there's more than one thing to
              filter, so it stays relevant. */}
          {showTypeFilter && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setTypeFilter("all")}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  typeFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                All types
              </button>
              {presentKinds.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTypeFilter(typeFilter === t.key ? "all" : t.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    typeFilter === t.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border border-border text-muted-foreground hover:bg-accent"
                  }`}
                  data-testid={`type-filter-${t.key}`}
                >
                  {t.label} ({kindCounts.counts[t.key]})
                </button>
              ))}
              {/* Placed last, not alongside the kind chips it's cross-cutting
                  with — "unassigned" describes WHO a chore is (or isn't) for,
                  not what kind of chore it is. Selecting it also clears any
                  active person filter: an unassigned chore has no profileIds
                  by definition, so the two filters together always produced
                  zero results (a real dead-end reported by a user) — this
                  makes that combination impossible instead of just confusing. */}
              {kindCounts.unassigned > 0 && (
                <button
                  onClick={() => {
                    const next = typeFilter === "unassigned" ? "all" : "unassigned";
                    setTypeFilter(next);
                    if (next === "unassigned") setFilterProfileId(null);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border border-dashed transition-colors ${
                    typeFilter === "unassigned"
                      ? "bg-amber-500 border-amber-500 text-white"
                      : "bg-background border-border text-muted-foreground hover:bg-accent"
                  }`}
                  data-testid="type-filter-unassigned"
                >
                  ⚠️ Unassigned ({kindCounts.unassigned})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chore list */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-16">
              {chores.length === 0 ? (
                <>
                  <p className="text-muted-foreground text-sm">No {noun}s yet.</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      setTimeout(onAddChore, 150);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Add your first {noun}
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">No {noun}s match your filters.</p>
              )}
            </div>
          ) : isFiltered ? (
            <ul>{filtered.map(chore => renderChoreRow(chore, false))}</ul>
          ) : (
            groupedSections.map(section => {
              // While actively dragging within this kind's group, render the
              // live in-progress order instead of the section's static order.
              const displayItems = (dragStateRef.current?.kind === section.kind && localOrder)
                ? (localOrder.map(id => section.items.find(c => c.id === id)).filter(Boolean) as Chore[])
                : section.items;
              return (
                <div key={section.kind}>
                  <div className="sticky top-0 z-[1] bg-muted/70 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground border-y border-border/60">
                    {SECTION_LABELS[section.kind]} ({section.items.length})
                  </div>
                  <ul>{displayItems.map(chore => renderChoreRow(chore, section.items.length > 1))}</ul>
                </div>
              );
            })
          )}
        </div>

        {/* Footer count when filtered */}
        {isFiltered ? (
          <div className="px-4 py-2 border-t border-border bg-muted/20 flex-shrink-0">
            <p className="text-xs text-muted-foreground text-center">
              Showing {filtered.length} of {chores.length} {noun}s
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
