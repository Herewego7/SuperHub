import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, addWeeks, startOfWeek } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Trash2,
  ShoppingCart,
  X,
  Check,
  Sparkles,
  Pencil,
  GripVertical,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  Copy,
  Minus,
  BookOpen,
  Clock,
  Baby,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Meal, MealIngredient, GroceryItem, GroceryStaple, SavedMeal, SavedMealIngredient } from "@workspace/shared-types";
import { MEAL_IDEAS, CUISINES, MEAL_TYPES, PREP_TIME_BUCKETS, prepTimeBucket, toSavedMealPayload, type MealIdea, type Cuisine, type MealType } from "@/lib/mealIdeasDatabase";
import { confirmDialog } from "@/lib/confirmDialog";
import { showUpgradeDialog } from "@/lib/upgradeDialog";
import { ObjectUploader } from "@/components/ObjectUploader";
import { objectUrl } from "@/lib/apiBase";
import { mergeGroceryQuantities } from "@workspace/shared-types";
import { Link2, ListChecks, Loader2, Camera, Image as ImageIcon } from "lucide-react";

// A parent typing "allrecipes.com/..." shouldn't have to know to prepend a
// scheme — the server's zod validator requires one (z.string().url()), so
// add https:// if it's missing before it ever reaches the request.
function normalizeRecipeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

type MealSlot = "breakfast" | "lunch" | "dinner";

type SavedMealWithIngredients = SavedMeal & { ingredients: SavedMealIngredient[] };

const SLOTS: { key: MealSlot; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

type MealWithIngredients = Meal & { ingredients: MealIngredient[] };

// What's currently being dragged onto the weekly grid: either a saved meal
// idea (dropping creates a new planned meal) or an already-planned meal
// (dropping moves it to the new day/slot).
type DragPayload =
  | { kind: "saved"; meal: SavedMealWithIngredients }
  | { kind: "planned"; meal: MealWithIngredients };

interface IngredientInput {
  quantity: string;
  item: string;
}

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

interface MealsViewProps {
  /** Lifted to family-hub.tsx so the app's global "Back" pill (which pops
   * tab-navigation history) can close the Grocery List first instead of
   * popping straight past it to whatever tab was active before Meals. */
  showGrocery?: boolean;
  onShowGroceryChange?: (show: boolean) => void;
  /** Lifted to family-hub.tsx so the persistent header date-nav (buttons +
   * edge-swipe) can drive Meals' week, stepping by a whole week instead of
   * a day — Meals no longer has its own Prev/Next/This-Week toolbar. */
  weekAnchor?: Date;
  onWeekAnchorChange?: (d: Date) => void;
}

export function MealsView({ showGrocery: showGroceryProp, onShowGroceryChange, weekAnchor: weekAnchorProp, onWeekAnchorChange }: MealsViewProps = {}) {
  const [showGroceryLocal, setShowGroceryLocal] = useState(false);
  const showGrocery = showGroceryProp ?? showGroceryLocal;
  const setShowGrocery = onShowGroceryChange ?? setShowGroceryLocal;
  const [weekAnchorLocal, setWeekAnchorLocal] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const weekAnchor = weekAnchorProp ?? weekAnchorLocal;
  const setWeekAnchor = onWeekAnchorChange ?? setWeekAnchorLocal;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)),
    [weekAnchor],
  );
  const weekStartIso = isoDate(weekAnchor);
  const weekEndIso = isoDate(addDays(weekAnchor, 6));

  return (
    <div className="space-y-6" data-testid="meals-view">
      {!showGrocery ? (
        <MealPlanView
          weekAnchor={weekAnchor}
          setWeekAnchor={setWeekAnchor}
          weekDays={weekDays}
          weekStartIso={weekStartIso}
          weekEndIso={weekEndIso}
          onOpenGrocery={() => setShowGrocery(true)}
        />
      ) : (
        <GroceryListView
          weekStartIso={weekStartIso}
          weekEndIso={weekEndIso}
          weekLabel={`${format(weekAnchor, "MMM d")} – ${format(addDays(weekAnchor, 6), "MMM d, yyyy")}`}
          onBack={() => setShowGrocery(false)}
        />
      )}
    </div>
  );
}

// ============== MEAL PLAN ==============

interface MealPlanViewProps {
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  weekDays: Date[];
  weekStartIso: string;
  weekEndIso: string;
  onOpenGrocery: () => void;
}

function MealPlanView({ weekAnchor, setWeekAnchor, weekDays, weekStartIso, weekEndIso, onOpenGrocery }: MealPlanViewProps) {
  const { data: calendarSettings } = useQuery<{ familyCalendarId?: string | null; mealsOnCalendar?: boolean | null }>({ queryKey: ["/api/calendar-settings"] });
  const mealsOnCalendar = calendarSettings?.mealsOnCalendar === true;
  useEffect(() => {
    if (!mealsOnCalendar) return;
    let cancelled = false;
    void apiRequest("PATCH", "/api/calendar-settings/meals-on-calendar", {
      enabled: true,
      start: weekStartIso,
      end: weekEndIso,
    }).then(() => {
      if (!cancelled) void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    });
    return () => {
      cancelled = true;
    };
  }, [mealsOnCalendar, weekStartIso, weekEndIso]);
  const [editingMeal, setEditingMeal] = useState<MealWithIngredients | null>(null);
  const [creatingFor, setCreatingFor] = useState<{ date: string; slot: MealSlot } | null>(null);

  // Saved-meal repository: drag a saved idea onto a cell to plan it.
  // Planned meals already on the grid can also be dragged to a different
  // day/slot, using the same drag machinery (see DragPayload above).
  const [editingSavedMeal, setEditingSavedMeal] = useState<SavedMealWithIngredients | null>(null);
  const [creatingSavedMeal, setCreatingSavedMeal] = useState(false);
  // Snap-a-Recipe hands its OCR result here; SavedMealModal then opens
  // pre-filled so the user reviews/edits before anything is saved.
  const [snappedRecipe, setSnappedRecipe] = useState<
    { name: string; notes: string; ingredients: IngredientInput[]; directions?: string } | null
  >(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // Tracks whether the in-flight native HTML5 drag actually landed on a valid
  // cell's onDrop — checked (not React state, which can lag behind the native
  // drop→dragend event pair) from onDragEnd to tell "dropped on a cell" apart
  // from "dropped outside the whole table."
  const nativeDragDroppedRef = useRef(false);
  // After dropping a saved meal we ask which ingredients to add to the grocery list
  const [groceryPrompt, setGroceryPrompt] = useState<MealWithIngredients | null>(null);

  // Today's column should be the first thing visible next to the sticky
  // Breakfast/Lunch/Dinner label column, not buried wherever it falls in the
  // Sun–Sat order — a parent opening Meals almost always wants today first,
  // with earlier days in the same week reachable by scrolling back. Only
  // applies when the displayed week actually contains today (todayColRef
  // never gets attached otherwise, so the effect below no-ops for other weeks).
  const weekGridScrollRef = useRef<HTMLDivElement>(null);
  const todayColRef = useRef<HTMLDivElement | null>(null);
  const todayIso = isoDate(new Date());

  useLayoutEffect(() => {
    const container = weekGridScrollRef.current;
    const todayEl = todayColRef.current;
    if (!container || !todayEl) return;
    // Matches the "100px" sticky label column in grid-cols-[100px_repeat(7,…)]
    // below — today's column should land flush against it, not underneath it.
    const STICKY_LABEL_WIDTH = 100;
    const containerRect = container.getBoundingClientRect();
    const todayRect = todayEl.getBoundingClientRect();
    container.scrollLeft += todayRect.left - containerRect.left - STICKY_LABEL_WIDTH;
  }, [weekAnchor]);

  const { toast } = useToast();

  const { data: meals = [], isLoading, isError, refetch: refetchMeals } = useQuery<MealWithIngredients[]>({
    queryKey: ["/api/meals", weekStartIso, weekEndIso],
    queryFn: async () => {
      // Use apiRequest (not raw fetch) so the call resolves to the real backend
      // origin and carries the auth token on native (Capacitor) builds. A raw
      // relative fetch hits capacitor://localhost unauthenticated, so meals come
      // back empty and newly-added meals never appear on the iOS app.
      const res = await apiRequest("GET", `/api/meals?start=${weekStartIso}&end=${weekEndIso}`);
      return res.json();
    },
  });

  const mealsKey = ["/api/meals", weekStartIso, weekEndIso] as const;

  const createFromSavedMutation = useMutation<
    MealWithIngredients,
    Error,
    { saved: SavedMealWithIngredients; date: string; slot: MealSlot },
    { tempId: string }
  >({
    mutationFn: async ({ saved, date, slot }) => {
      const res = await apiRequest("POST", "/api/meals", {
        date,
        slot,
        name: saved.name,
        notes: saved.notes ?? null,
        recipeUrl: saved.recipeUrl ?? null,
        directions: saved.directions ?? null,
        sourceName: saved.sourceName ?? null,
        importedAt: saved.importedAt ?? null,
        ingredients: saved.ingredients.map((i, idx) => ({
          item: i.item,
          quantity: i.quantity ?? null,
          displayOrder: idx,
        })),
      });
      return res.json();
    },
    // Optimistically drop the meal into the cell so it appears instantly,
    // without waiting for the server round trip.
    onMutate: async ({ saved, date, slot }) => {
      await queryClient.cancelQueries({ queryKey: mealsKey });
      const tempId = `temp-${Date.now()}`;
      const optimistic = {
        id: tempId,
        userId: "",
        date,
        slot,
        name: saved.name,
        notes: saved.notes ?? null,
        recipeUrl: saved.recipeUrl ?? null,
        directions: saved.directions ?? null,
        sourceName: saved.sourceName ?? null,
        importedAt: saved.importedAt ?? null,
        createdAt: null,
        ingredients: saved.ingredients.map((i, idx) => ({
          id: `${tempId}-${idx}`,
          mealId: tempId,
          item: i.item,
          quantity: i.quantity ?? null,
          displayOrder: idx,
        })),
      } as MealWithIngredients;
      queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) => [...(old ?? []), optimistic]);
      return { tempId };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) =>
          (old ?? []).filter((m) => m.id !== ctx.tempId),
        );
      }
      toast({ title: "Failed to add meal", variant: "destructive" });
    },
    onSuccess: (created, _vars, ctx) => {
      // Swap the temporary meal for the real one returned by the server
      queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) =>
        (old ?? []).map((m) => (m.id === ctx?.tempId ? created : m)),
      );
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/aggregate", weekStartIso, weekEndIso] });
      // Family History synthesizes "meal_planned" live from the meals table —
      // invalidate so a just-planned meal shows up immediately, not after its
      // 30s staleTime happens to lapse.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      if (created.ingredients && created.ingredients.length > 0) {
        setGroceryPrompt(created);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mealsKey });
    },
  });

  // Move an already-planned meal to a different day/slot by dragging it.
  const moveMealMutation = useMutation<
    MealWithIngredients,
    Error,
    { meal: MealWithIngredients; date: string; slot: MealSlot },
    { previous?: MealWithIngredients[] }
  >({
    mutationFn: async ({ meal, date, slot }) => {
      const res = await apiRequest("PATCH", `/api/meals/${meal.id}`, { date, slot });
      return res.json();
    },
    onMutate: async ({ meal, date, slot }) => {
      await queryClient.cancelQueries({ queryKey: mealsKey });
      const previous = queryClient.getQueryData<MealWithIngredients[]>(mealsKey);
      queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) =>
        (old ?? []).map((m) => (m.id === meal.id ? { ...m, date, slot } : m)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(mealsKey, ctx.previous);
      toast({ title: "Failed to move meal", variant: "destructive" });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) =>
        (old ?? []).map((m) => (m.id === updated.id ? updated : m)),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mealsKey });
    },
  });

  // Re-creates a meal exactly as it was, for the "Undo" toast action below —
  // a fresh row with a new id, but same date/slot/name/notes/ingredients.
  const restoreMealMutation = useMutation({
    mutationFn: async (meal: MealWithIngredients) => {
      const res = await apiRequest("POST", "/api/meals", {
        date: meal.date,
        slot: meal.slot,
        name: meal.name,
        notes: meal.notes ?? null,
        recipeUrl: meal.recipeUrl ?? null,
        directions: meal.directions ?? null,
        sourceName: meal.sourceName ?? null,
        importedAt: meal.importedAt ?? null,
        ingredients: meal.ingredients.map((i, idx) => ({
          item: i.item,
          quantity: i.quantity ?? null,
          displayOrder: idx,
        })),
      });
      return res.json();
    },
    onSuccess: (created: MealWithIngredients) => {
      queryClient.invalidateQueries({ queryKey: mealsKey });
      // Family History synthesizes "meal_planned" live from the meals table.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Meal restored" });
      if (created.ingredients && created.ingredients.length > 0) {
        setGroceryPrompt(created);
      }
    },
    onError: () => toast({ title: "Couldn't restore meal", variant: "destructive" }),
  });

  // Dragging a planned meal out of the table entirely (dropped anywhere that
  // isn't a meal cell) removes it as a planned meal for that day.
  const removeMealMutation = useMutation<
    void,
    Error,
    MealWithIngredients,
    { previous?: MealWithIngredients[] }
  >({
    mutationFn: async (meal) => {
      await apiRequest("DELETE", `/api/meals/${meal.id}`);
    },
    onMutate: async (meal) => {
      await queryClient.cancelQueries({ queryKey: mealsKey });
      const previous = queryClient.getQueryData<MealWithIngredients[]>(mealsKey);
      queryClient.setQueryData<MealWithIngredients[]>(mealsKey, (old) =>
        (old ?? []).filter((m) => m.id !== meal.id),
      );
      return { previous };
    },
    onSuccess: (_data, meal) => {
      toast({
        title: `Removed "${meal.name}"`,
        description: `No longer planned for ${format(new Date(meal.date + "T00:00:00"), "EEE, MMM d")}.`,
        action: (
          <ToastAction altText="Undo" onClick={() => restoreMealMutation.mutate(meal)}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(mealsKey, ctx.previous);
      toast({ title: "Failed to remove meal", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mealsKey });
    },
  });

  // Copies every meal on the currently-viewed week onto the following week —
  // each becomes its own independent meal row (same as "Repeat weekly"),
  // not a linked series.
  const duplicateWeekMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        meals.map(async (m) => {
          const offsetDays = Math.round(
            (new Date(`${m.date}T00:00:00`).getTime() - weekAnchor.getTime()) / (24 * 60 * 60 * 1000),
          );
          const newDate = isoDate(addDays(addWeeks(weekAnchor, 1), offsetDays));
          const res = await apiRequest("POST", "/api/meals", {
            date: newDate,
            slot: m.slot,
            name: m.name,
            notes: m.notes ?? null,
            recipeUrl: m.recipeUrl ?? null,
            directions: m.directions ?? null,
            sourceName: m.sourceName ?? null,
            importedAt: m.importedAt ?? null,
            ingredients: m.ingredients.map((i, idx) => ({
              item: i.item,
              quantity: i.quantity ?? null,
              displayOrder: idx,
            })),
          });
          return res.json() as Promise<MealWithIngredients>;
        }),
      );
      const created = results.filter((r): r is PromiseFulfilledResult<MealWithIngredients> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.length - created.length;
      if (created.length === 0 && meals.length > 0) {
        throw new Error("Couldn't duplicate any meals. Please try again.");
      }
      return { created, failed };
    },
    onSuccess: ({ created, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      // Family History synthesizes "meal_planned" live from the meals table.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      if (failed > 0) {
        toast({ title: `Duplicated ${created.length} of ${created.length + failed} meals`, description: "The rest failed to save — try duplicating the week again.", variant: "destructive" });
      } else {
        toast({ title: `Duplicated ${created.length} meal${created.length === 1 ? "" : "s"} to next week` });
      }
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to duplicate week", variant: "destructive" }),
  });

  const handleDropPayload = (date: string, slot: MealSlot) => {
    const payload = dragPayload;
    nativeDragDroppedRef.current = true;
    setDragOverCell(null);
    setDragPayload(null);
    if (!payload) return;
    if (payload.kind === "saved") {
      createFromSavedMutation.mutate({ saved: payload.meal, date, slot });
    } else if (payload.meal.date !== date || payload.meal.slot !== slot) {
      moveMealMutation.mutate({ meal: payload.meal, date, slot });
    }
  };

  // ── Pointer-based drag (works on touch + mouse) ─────────────────────────
  // HTML5 drag-and-drop never fires on iOS, so we drive the drag ourselves
  // with Pointer Events: a floating "ghost" follows the finger/cursor, cells
  // highlight as it passes over them, and releasing drops the meal. The same
  // machinery handles both a saved idea (create) and an already-planned meal
  // (move) — they only differ in what handleDropPayload does on release.
  const [dragGhost, setDragGhost] = useState<
    { payload: DragPayload; x: number; y: number } | null
  >(null);
  const dragRef = useRef<
    (DragPayload & {
      startX: number; startY: number; active: boolean; pointerId: number;
      // Horizontal-gesture overrides: one of these is set when the card lives
      // in a scrollable context where horizontal swipe should not start a drag.
      scrollContainer?: HTMLElement; // collapsed ideas row — JS-scroll on horiz move
      scrollStartLeft?: number;
      onSwipeMove?: (dx: number) => void; // expanded ideas grid — live-follow drag offset
      onSwipeEnd?: (dx: number) => void; // expanded ideas grid — commit/settle on release
      mode?: "drag" | "scroll" | "swipe"; // "scroll"/"swipe" = horizontal gesture, suppress drag
      holdTimer?: ReturnType<typeof setTimeout>;
      // Last few scroll samples, for the release-momentum fling below.
      lastX?: number;
      lastT?: number;
      velocity?: number;
    }) | null
  >(null);

  // How long a finger has to rest on a card before it's "picked up".
  // Without this, dragging a meal to a DIFFERENT DAY — which is inherently a
  // sideways movement, since days are columns — was indistinguishable from
  // swiping the grid sideways to browse, so it read as "I can't grab it".
  // A press-and-hold is unambiguous in a way a direction heuristic can't be,
  // and it's the same gesture iOS itself uses to pick things up.
  const HOLD_TO_DRAG_MS = 220;
  const HOLD_MOVE_TOLERANCE = 10;

  const cancelHold = () => {
    const st = dragRef.current;
    if (st?.holdTimer) { clearTimeout(st.holdTimer); st.holdTimer = undefined; }
  };

  // Inertia after a horizontal fling on the collapsed ideas row. The row is
  // JS-scrolled (touch-action: none, so the browser's own momentum never
  // applies), which is why letting go used to stop it dead.
  // A meal dropped off the grid disappears; this is the little puff of air
  // that shows it going, rendered at the point the finger let go.
  const [puff, setPuff] = useState<{ x: number; y: number; id: number } | null>(null);
  useEffect(() => {
    if (!puff) return;
    const t = setTimeout(() => setPuff(null), 500);
    return () => clearTimeout(t);
  }, [puff]);

  const flingRef = useRef<number | null>(null);
  const stopFling = () => {
    if (flingRef.current !== null) { cancelAnimationFrame(flingRef.current); flingRef.current = null; }
  };
  const startFling = (el: HTMLElement, velocity: number) => {
    // px/ms; below this a fling is indistinguishable from letting go still.
    if (Math.abs(velocity) < 0.05) return;
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      el.scrollLeft -= v * dt;
      v *= Math.pow(0.995, dt); // ~exponential decay, framerate-independent
      if (Math.abs(v) > 0.02 && el.scrollLeft > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth) {
        flingRef.current = requestAnimationFrame(step);
      } else {
        flingRef.current = null;
      }
    };
    flingRef.current = requestAnimationFrame(step);
  };

  const cellAtPoint = (x: number, y: number): { date: string; slot: MealSlot } | null => {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest("[data-meal-cell]") as HTMLElement | null;
    const raw = cell?.getAttribute("data-meal-cell");
    if (!raw) return null;
    const [date, slot] = raw.split("|");
    return { date, slot: slot as MealSlot };
  };

  const onDragPointerMove = (e: PointerEvent) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;

    // Already committed to JS-scroll mode: update container scrollLeft, and
    // keep a running velocity so releasing can carry on with momentum.
    if (st.mode === "scroll" && st.scrollContainer) {
      const dx = e.clientX - st.startX;
      st.scrollContainer.scrollLeft = (st.scrollStartLeft ?? 0) - dx;
      const now = performance.now();
      if (st.lastT !== undefined && st.lastX !== undefined) {
        const dt = now - st.lastT;
        if (dt > 0) {
          const instant = (e.clientX - st.lastX) / dt;
          // Smoothed so one stuttery final sample can't define the fling.
          st.velocity = st.velocity === undefined ? instant : st.velocity * 0.7 + instant * 0.3;
        }
      }
      st.lastX = e.clientX;
      st.lastT = now;
      return;
    }

    // Already committed to a page-swipe: keep reporting the live offset so
    // the grid can visually follow the finger instead of jumping the page
    // the instant a horizontal gesture is detected.
    if (st.mode === "swipe" && st.onSwipeMove) {
      st.onSwipeMove(e.clientX - st.startX);
      return;
    }

    if (!st.active) {
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (Math.hypot(dx, dy) < 6) return;

      // Moved for real before the hold fired — this is a swipe/scroll, not a
      // pick-up. (Past the tolerance only; a little jitter while holding
      // still shouldn't cancel it.)
      if (Math.hypot(dx, dy) > HOLD_MOVE_TOLERANCE) cancelHold();

      const isHorizontal = Math.abs(dx) > Math.abs(dy);

      // Horizontal swipe on expanded ideas grid → start live-following drag;
      // the actual page change (if any) happens on release, once we know
      // how far the gesture went.
      if (isHorizontal && st.onSwipeMove) {
        st.mode = "swipe";
        st.onSwipeMove(dx);
        return;
      }

      // Horizontal swipe on collapsed scrollable row → JS-scroll the row.
      if (isHorizontal && st.scrollContainer) {
        st.mode = "scroll";
        st.scrollStartLeft = st.scrollContainer.scrollLeft;
        st.scrollContainer.scrollLeft -= dx; // apply first increment immediately
        return;
      }

      // Vertical (or uncontexted) movement → normal drag activation.
      st.active = true;
      setDragPayload(st as DragPayload); // arms cell highlighting
    }
    setDragGhost({ payload: st as DragPayload, x: e.clientX, y: e.clientY });
    const cell = cellAtPoint(e.clientX, e.clientY);
    setDragOverCell(cell ? `${cell.date}__${cell.slot}` : null);
  };

  const onDragPointerUp = (e: PointerEvent) => {
    const st = dragRef.current;
    cancelHold();
    window.removeEventListener("pointermove", onDragPointerMove);
    window.removeEventListener("pointerup", onDragPointerUp);
    window.removeEventListener("pointercancel", onDragPointerUp);
    dragRef.current = null;
    setDragGhost(null);
    if (st?.mode === "scroll") {
      // Was a scroll gesture — not a drop. Carry the fling on rather than
      // stopping dead the instant the finger lifts.
      if (st.scrollContainer && st.velocity) startFling(st.scrollContainer, st.velocity);
      setDragOverCell(null);
      setDragPayload(null);
      return;
    }
    if (st?.mode === "swipe") {
      // Hand off the final offset so the page grid can animate to its
      // settled position (either the new page, or back where it started).
      st.onSwipeEnd?.(e.clientX - st.startX);
      setDragOverCell(null);
      setDragPayload(null);
      return;
    }
    if (st?.active) {
      const cell = cellAtPoint(e.clientX, e.clientY);
      // Drop directly with the dragged payload (avoid relying on async state).
      if (cell) {
        if (st.kind === "saved") {
          createFromSavedMutation.mutate({ saved: st.meal, date: cell.date, slot: cell.slot });
        } else if (st.meal.date !== cell.date || st.meal.slot !== cell.slot) {
          moveMealMutation.mutate({ meal: st.meal, date: cell.date, slot: cell.slot });
        }
      } else if (st.kind === "planned") {
        // Dropped outside the whole table — remove it as a planned meal.
        // Puff first, at the point it was let go, so the card visibly goes
        // somewhere instead of just ceasing to exist.
        setPuff({ x: e.clientX, y: e.clientY, id: Date.now() });
        removeMealMutation.mutate(st.meal);
      }
    }
    setDragOverCell(null);
    setDragPayload(null);
  };

  const startMealDrag = (
    e: React.PointerEvent,
    payload: DragPayload,
    opts?: { scrollContainer?: HTMLElement; onSwipeMove?: (dx: number) => void; onSwipeEnd?: (dx: number) => void },
  ) => {
    // Mouse uses the native HTML5 drag (unchanged on desktop); we only drive
    // touch/pen here, where HTML5 drag-and-drop doesn't work.
    if (e.pointerType === "mouse") return;
    stopFling();
    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = {
      ...payload,
      startX, startY,
      active: false, pointerId: e.pointerId,
      scrollContainer: opts?.scrollContainer,
      onSwipeMove: opts?.onSwipeMove,
      onSwipeEnd: opts?.onSwipeEnd,
    };
    // Press and hold → pick the card up, whatever direction it then moves.
    dragRef.current.holdTimer = setTimeout(() => {
      const st = dragRef.current;
      if (!st || st.mode || st.active) return; // already a scroll/swipe, or already dragging
      st.mode = "drag";
      st.active = true;
      setDragPayload(st as DragPayload);
      setDragGhost({ payload: st as DragPayload, x: startX, y: startY });
      try { navigator.vibrate?.(8); } catch { /* not supported */ }
    }, HOLD_TO_DRAG_MS);
    window.addEventListener("pointermove", onDragPointerMove);
    window.addEventListener("pointerup", onDragPointerUp);
    window.addEventListener("pointercancel", onDragPointerUp);
  };

  const mealsByCell = useMemo(() => {
    const map = new Map<string, MealWithIngredients[]>();
    for (const m of meals) {
      const key = `${m.date}__${m.slot}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [meals]);

  return (
    <div className="space-y-4">
      {/* Week nav (Prev/Next/This Week) AND the week-range label both now live
          in the app's persistent header nav (family-hub.tsx), which already
          shows this same weekAnchor as its center label. Grocery List moved
          into the Meal Ideas card's own icon-button row below; Duplicate
          Week moved into the weekly grid card's own small header — neither
          needs its own standalone toolbar row anymore. */}

      {/* Meal-idea repository */}
      {/* Grocery List lives in the tab's own toolbar rather than inside the
          Meal Ideas card. It's a tab-level destination, not a meal-ideas
          action — and inside that card it became the most prominent control
          on an empty Meals tab, outranking anything to do with adding a meal. */}
      <div className="flex items-center justify-end gap-3 mb-3">
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          Put dinners on the calendar
          <Switch
            checked={mealsOnCalendar}
            data-testid="meals-on-calendar"
            onCheckedChange={(checked) => {
              const on = !!checked;
              queryClient.setQueryData(["/api/calendar-settings"], (old: { mealsOnCalendar?: boolean } | undefined) => ({ ...old, mealsOnCalendar: on }));
              void apiRequest("PATCH", "/api/calendar-settings/meals-on-calendar", { enabled: on }).then(() => {
                void queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
              });
            }}
          />
        </label>
        <Button
          variant="default" size="default"
          className="shrink-0 gap-2 h-10 rounded-full"
          onClick={onOpenGrocery}
          data-testid="meals-open-grocery"
        >
          <ShoppingCart className="w-4 h-4" />
          Grocery List
        </Button>
      </div>

      <SavedMealsPanel
        onImported={setEditingSavedMeal}
        onSnapped={setSnappedRecipe}
        draggedId={dragPayload?.kind === "saved" ? dragPayload.meal.id : null}
        onCreate={() => setCreatingSavedMeal(true)}
        onEdit={(sm) => setEditingSavedMeal(sm)}
        onDragStartMeal={(sm) => setDragPayload({ kind: "saved", meal: sm })}
        onDragEndMeal={() => { setDragPayload(null); setDragOverCell(null); }}
        onPointerDownMeal={(e, sm, opts) => startMealDrag(e, { kind: "saved", meal: sm }, opts)}
      />

      {/* Weekly grid */}
      {/* overflow-x-auto lives on the inner div, NOT Card, so the Card itself
          has default overflow:visible — if overflow-x is set on the Card, CSS
          forces overflow-y to auto too, turning it into a vertical scroll
          container that traps scroll events and prevents the sticky header
          from collapsing on the Meals tab. */}
      <Card>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">This Week's Meals</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            onClick={async () => {
              if (meals.length === 0) return;
              if (await confirmDialog({ title: `Duplicate all ${meals.length} meal${meals.length === 1 ? "" : "s"} from this week onto next week?`, confirmLabel: "Duplicate", destructive: false })) {
                duplicateWeekMutation.mutate();
              }
            }}
            disabled={meals.length === 0 || duplicateWeekMutation.isPending}
            title="Duplicate this week to next week"
            aria-label="Copy this week's meals to next week"
            data-testid="meals-duplicate-week"
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <div className="overflow-x-auto" ref={weekGridScrollRef}>
        {/* Must be at least the grid's own intrinsic width (100px label +
            7 x 150px days = 1150px). At 840px the grid CONTENT overflowed the
            element's box, so the header strip's background stopped painting
            partway through Thursday and Fri/Sat had none at all. */}
        <div className="min-w-[1150px]">
          {/* Colored header strip, matching the pastel CardHeader treatment
              every other card in the app uses (family-hub.tsx's Tasks/
              Rewards/Trophies/Bonus/To-Dos cards). */}
          <div className="grid grid-cols-[100px_repeat(7,minmax(150px,1fr))] bg-[#D9E3DC]/60 dark:bg-[#2a2e2b]">
            <div className="sticky left-0 z-10 px-3 py-2 text-xs font-semibold text-muted-foreground bg-[#D9E3DC]/60 dark:bg-[#2a2e2b] border-b border-border" />
            {weekDays.map((d) => {
              const dIso = isoDate(d);
              const isToday = dIso === todayIso;
              return (
                <div
                  key={dIso}
                  ref={isToday ? todayColRef : undefined}
                  className={`px-2 py-2.5 text-center border-l border-b border-border ${isToday ? "bg-primary/10" : ""}`}
                >
                  <div className="text-sm font-semibold text-foreground">
                    {format(d, "EEE")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(d, "MMM d")}
                  </div>
                </div>
              );
            })}
          </div>

          {SLOTS.map((slot, slotIndex) => {
            const isLastSlot = slotIndex === SLOTS.length - 1;
            return (
            <div
              key={slot.key}
              className="grid grid-cols-[100px_repeat(7,minmax(150px,1fr))]"
            >
              <div className={`sticky left-0 z-10 px-3 py-3 text-sm font-semibold text-foreground sticky-slot-label flex items-center border-r border-border ${isLastSlot ? "" : "border-b"}`}>
                {slot.label}
              </div>
              {weekDays.map((d) => {
                const dateIso = isoDate(d);
                const cellKey = `${dateIso}__${slot.key}`;
                const cellMeals = mealsByCell.get(cellKey) || [];
                const isDropTarget = dragPayload !== null;
                const isDragOver = dragOverCell === cellKey;
                return (
                  <div
                    key={`${dateIso}-${slot.key}`}
                    className={`px-2 py-2.5 border-l border-border min-h-24 flex flex-col gap-2 transition-colors ${isLastSlot ? "" : "border-b"} ${
                      isDragOver
                        ? "bg-orange-100 dark:bg-orange-950/50 ring-2 ring-inset ring-orange-400"
                        : isDropTarget
                        ? "bg-orange-50/50 dark:bg-orange-950/20"
                        : ""
                    }`}
                    data-testid={`meal-cell-${dateIso}-${slot.key}`}
                    data-meal-cell={`${dateIso}|${slot.key}`}
                    // Desktop HTML5 drag still works as a fallback; touch is
                    // handled by the pointer-drag logic above.
                    onDragOver={(e) => {
                      if (!dragPayload) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = dragPayload.kind === "saved" ? "copy" : "move";
                      if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropPayload(dateIso, slot.key);
                    }}
                  >
                    {cellMeals.map((meal) => (
                      <div
                        key={meal.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingMeal(meal)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEditingMeal(meal); }}
                        // A plain <div> here, not a <button> — Chrome's native HTML5
                        // drag-and-drop is unreliable on draggable <button> elements
                        // (the button's own mousedown/focus handling can swallow the
                        // gesture before dragstart fires), which is why this card
                        // couldn't be dragged while the div-based Meal Ideas cards could.
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", meal.id);
                          nativeDragDroppedRef.current = false;
                          setDragPayload({ kind: "planned", meal });
                        }}
                        onDragEnd={() => {
                          // Ended without landing on a cell's onDrop → dropped
                          // outside the whole table, so remove it as planned.
                          if (!nativeDragDroppedRef.current) {
                            removeMealMutation.mutate(meal);
                          }
                          setDragPayload(null);
                          setDragOverCell(null);
                        }}
                        onPointerDown={(e) => startMealDrag(e, { kind: "planned", meal }, {
                          scrollContainer: weekGridScrollRef.current ?? undefined,
                        })}
                        style={{ touchAction: "none" }}
                        className={`text-left text-sm px-2.5 py-2 rounded-md bg-orange-100 dark:bg-orange-950/40 text-orange-900 dark:text-orange-100 hover:bg-orange-200 dark:hover:bg-orange-900/60 transition-colors cursor-grab active:cursor-grabbing ${
                          dragPayload?.kind === "planned" && dragPayload.meal.id === meal.id ? "opacity-60" : ""
                        }`}
                        data-testid={`meal-${meal.id}`}
                      >
                        <div className="font-medium break-words leading-snug">{meal.name}</div>
                        {meal.ingredients.length > 0 && (
                          <div className="text-[11px] text-orange-700/80 dark:text-orange-300/80">
                            {meal.ingredients.length} ingredient
                            {meal.ingredients.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setCreatingFor({ date: dateIso, slot: slot.key })}
                      className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground py-1 rounded-md border border-dashed border-border hover:border-foreground/40 transition-colors"
                      data-testid={`add-meal-${dateIso}-${slot.key}`}
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                );
              })}
            </div>
          );
          })}
        </div>
        </div>
      </Card>

      {isLoading && (
        <div className="text-center text-sm text-muted-foreground">Loading meals…</div>
      )}
      {isError && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          <span>Couldn't load this week's meals — connection problem.</span>
          <Button size="sm" variant="outline" onClick={() => refetchMeals()}>Retry</Button>
        </div>
      )}

      {/* Modal */}
      {(creatingFor || editingMeal) && (
        <MealModal
          meal={editingMeal}
          creatingFor={creatingFor}
          weekStartIso={weekStartIso}
          weekEndIso={weekEndIso}
          onClose={() => {
            setEditingMeal(null);
            setCreatingFor(null);
          }}
          onCreated={setGroceryPrompt}
        />
      )}

      {/* Saved-meal (idea) editor */}
      {(creatingSavedMeal || editingSavedMeal || snappedRecipe) && (
        <SavedMealModal
          savedMeal={editingSavedMeal}
          initialData={snappedRecipe}
          onClose={() => {
            setEditingSavedMeal(null);
            setCreatingSavedMeal(false);
            setSnappedRecipe(null);
          }}
        />
      )}

      {/* Grocery prompt after dropping a saved meal */}
      {groceryPrompt && (
        <GroceryPromptDialog
          meal={groceryPrompt}
          onClose={() => setGroceryPrompt(null)}
        />
      )}

      {/* Floating drag preview (the "lifted" card) that follows the finger on
          touch. pointer-events-none so it never blocks elementFromPoint hit
          testing of the cell underneath. */}
      {dragGhost && (
        <div
          className="pointer-events-none fixed z-[100] w-40 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/90 p-2 shadow-2xl"
          style={{
            left: dragGhost.x,
            top: dragGhost.y,
            transform: "translate(-50%, -110%) rotate(-3deg) scale(1.05)",
          }}
        >
          <span className="text-xs font-medium text-orange-900 dark:text-orange-100 break-words leading-tight">
            {dragGhost.payload.meal.name}
          </span>
        </div>
      )}

      {/* Puff of air where a meal was dropped off the grid — three little
          rings expanding and fading, so removal reads as the card going
          somewhere rather than silently blinking out. */}
      {puff && (
        <div
          key={puff.id}
          className="pointer-events-none fixed z-[100]"
          style={{ left: puff.x, top: puff.y, transform: "translate(-50%, -50%)" }}
          data-testid="meal-remove-puff"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute rounded-full border-2 border-orange-300/70 dark:border-orange-400/60"
              style={{
                left: 0, top: 0, width: 18, height: 18,
                transform: "translate(-50%, -50%)",
                animation: `meal-puff 480ms ease-out ${i * 70}ms both`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============== SAVED-MEAL REPOSITORY PANEL ==============

type MealDragOpts = { scrollContainer?: HTMLElement; onSwipeMove?: (dx: number) => void; onSwipeEnd?: (dx: number) => void };

interface SavedMealsPanelProps {
  /** Called with the freshly-imported idea so the parent can open it. */
  onImported: (sm: SavedMealWithIngredients) => void;
  /** Called with a photo-extracted recipe so the parent can open it for review. */
  onSnapped: (data: { name: string; notes: string; ingredients: IngredientInput[]; directions?: string }) => void;
  draggedId: string | null;
  onCreate: () => void;
  onEdit: (sm: SavedMealWithIngredients) => void;
  onDragStartMeal: (sm: SavedMealWithIngredients) => void;
  onDragEndMeal: () => void;
  onPointerDownMeal: (e: React.PointerEvent, sm: SavedMealWithIngredients, opts?: MealDragOpts) => void;
}

function SavedMealsPanel({ draggedId, onCreate, onEdit, onImported, onSnapped, onDragStartMeal, onDragEndMeal, onPointerDownMeal }: SavedMealsPanelProps) {
  const [showImport, setShowImport] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const { data: savedMeals = [], isLoading, isError, refetch: refetchSavedMeals } = useQuery<SavedMealWithIngredients[]>({
    queryKey: ["/api/saved-meals"],
  });
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [showBrowse, setShowBrowse] = useState(false);
  const scrollRowRef = useRef<HTMLDivElement>(null);

  // Live-follow swipe transition for the expanded grid: swipeX tracks the
  // grid's current transform offset (px) — it follows the finger 1:1 while
  // dragging, then animates to a settled position (either the adjacent
  // page, fully off-screen, or back to 0) on release. swipeAnimating gates
  // whether that settle motion uses a CSS transition or jumps instantly —
  // it must be off while the finger is still moving (so the drag itself
  // never feels laggy) and on only for the brief post-release settle.
  const [swipeX, setSwipeX] = useState(0);
  const [swipeAnimating, setSwipeAnimating] = useState(false);
  const gridWrapRef = useRef<HTMLDivElement>(null);

  const filteredMeals = search.trim()
    ? savedMeals.filter((sm) => sm.name.toLowerCase().includes(search.trim().toLowerCase()))
    : savedMeals;

  const PAGE_SIZE = 8; // 2 cols x 4 rows on phone, fits without taking over the screen
  const pageCount = Math.max(1, Math.ceil(filteredMeals.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageMeals = filteredMeals.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleSwipeMove = (dx: number) => {
    // Resist dragging past an edge that has no page to go to, instead of
    // letting the grid float away with nothing to settle back from.
    const dir = dx < 0 ? "left" : "right";
    const canGo = dir === "left" ? safePage < pageCount - 1 : safePage > 0;
    setSwipeAnimating(false);
    setSwipeX(canGo ? dx : dx / 3);
  };

  const handleSwipeEnd = (dx: number) => {
    const width = gridWrapRef.current?.offsetWidth || 320;
    const threshold = Math.min(90, width * 0.22);
    const dir = dx < 0 ? "left" : "right";
    const canGo = dir === "left" ? safePage < pageCount - 1 : safePage > 0;
    if (canGo && Math.abs(dx) > threshold) {
      // Finish the swipe: carry the grid the rest of the way off-screen,
      // then swap to the new page (rendered off-screen on the opposite
      // side) and slide it in — a real slide transition, not a jump-cut.
      setSwipeAnimating(true);
      setSwipeX(dir === "left" ? -width : width);
      window.setTimeout(() => {
        setPage((p) => Math.min(pageCount - 1, Math.max(0, p + (dir === "left" ? 1 : -1))));
        setSwipeAnimating(false);
        setSwipeX(dir === "left" ? width : -width);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setSwipeAnimating(true);
            setSwipeX(0);
          });
        });
      }, 180);
    } else {
      // Didn't clear the threshold (or there's no page that way) — spring
      // back to where it started.
      setSwipeAnimating(true);
      setSwipeX(0);
    }
  };

  return (
    <Card className="overflow-hidden p-0" data-testid="saved-meals-panel">
      {/* Colored header strip, matching every other card's CardHeader
          treatment elsewhere in the app (Tasks/Rewards/Trophies/etc) —
          always a single row (title left, buttons right), never stacking or
          wrapping on mobile, so the expand button always lands in the exact
          same top-right spot every other card's does. Grocery List used to
          live in this row too — with 5 other buttons already competing for
          space here, it either wrapped unpredictably or got squeezed down to
          the same small icon-button treatment as everything else, which is
          the opposite of "easy to find". It now gets its own prominent,
          stand-alone button in the card body below instead. */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border bg-[#F4E9D8]/70 dark:bg-[#2e2823]">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-foreground shrink-0" />
            Meal Ideas
          </h3>
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            Drag a saved meal onto a day to plan it
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost" size="sm"
            className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            onClick={onCreate}
            data-testid="add-saved-meal-button"
            title="Add a meal idea"
          >
            <Plus className="w-4 h-4" />
          </Button>
          {/* Browse / Import / Snap were three more unlabelled icons in a row
              that already had five, with glyphs (a book, a chain link, a
              camera) that don't say what they do. Collapsed into one labelled
              menu: the header keeps "+ Add" and the expand toggle, and every
              other way to add a meal is named in words one tap away. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost" size="sm"
                className="h-8 px-2 gap-1 rounded-full text-xs hover:bg-black/10 dark:hover:bg-white/10"
                data-testid="more-ways-to-add-button"
              >
                More ways to add
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowBrowse(true)} data-testid="browse-meal-ideas-button">
                <BookOpen className="w-4 h-4 mr-2" /> Browse built-in ideas
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImport(true)} data-testid="import-recipe-button">
                <Link2 className="w-4 h-4 mr-2" /> Import from a link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSnap(true)} data-testid="snap-recipe-button">
                <Camera className="w-4 h-4 mr-2" /> Snap a recipe photo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Isolated from the feature-button cluster above (matching how every
              other card's header keeps its own expand/collapse as the one
              distinct control at the far right, not just another icon in the
              row) with a divider so it reads as the card-level toggle. */}
          <Button
            variant="ghost" size="sm"
            className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ml-1 pl-1 border-l border-border"
            onClick={() => { setExpanded((v) => !v); setPage(0); }}
            data-testid="toggle-expand-saved-meals"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <div className="p-3">



      {showBrowse && <BrowseMealIdeasDialog onClose={() => setShowBrowse(false)} />}

      {showImport && (
        <ImportRecipeDialog
          onClose={() => setShowImport(false)}
          onImported={(sm) => { setShowImport(false); onImported(sm); }}
        />
      )}

      {showSnap && (
        <SnapRecipeSheet
          onClose={() => setShowSnap(false)}
          onExtracted={(data) => { setShowSnap(false); onSnapped(data); }}
        />
      )}

      {savedMeals.length > 6 && (
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search meal ideas…"
          className="h-8 text-sm mb-2"
          data-testid="search-saved-meals"
        />
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-3 text-center">Loading…</p>
      ) : isError ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
          <span>Couldn't load your Meal Ideas — this is a connection problem, not missing data.</span>
          <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => refetchSavedMeals()}>Retry</Button>
        </div>
      ) : savedMeals.length === 0 ? (
        /* Empty state now offers the action, matching the Chores tab's
           ("No chores or to-dos yet" + "Add a Chore"). Previously Meals was
           the one empty state in the app that described the gap without
           giving you a way to close it. */
        <div className="py-5 text-center">
          <p className="text-xs text-muted-foreground mb-3">
            No saved meals yet.
          </p>
          <Button size="sm" onClick={onCreate} className="gap-1.5" data-testid="meals-empty-add">
            <Plus className="w-4 h-4" /> Add a meal idea
          </Button>
        </div>
      ) : filteredMeals.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">
          No meal ideas match "{search}".
        </p>
      ) : expanded ? (
        <div>
          <div className="overflow-hidden">
            <div
              ref={gridWrapRef}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
              style={{
                transform: `translateX(${swipeX}px)`,
                transition: swipeAnimating ? "transform 200ms ease-out" : "none",
              }}
            >
              {pageMeals.map((sm) => (
                <SavedMealCard
                  key={sm.id}
                  sm={sm}
                  draggedId={draggedId}
                  onEdit={onEdit}
                  onDragStartMeal={onDragStartMeal}
                  onDragEndMeal={onDragEndMeal}
                  onPointerDownMeal={onPointerDownMeal}
                  dragOpts={{ onSwipeMove: handleSwipeMove, onSwipeEnd: handleSwipeEnd }}
                  className="w-full"
                />
              ))}
            </div>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                data-testid="saved-meals-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: pageCount }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    aria-label={`Page ${i + 1}`}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === safePage ? "bg-orange-500" : "bg-orange-200 dark:bg-orange-900/60"
                    }`}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage === pageCount - 1}
                data-testid="saved-meals-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRowRef} className="flex gap-2 overflow-x-auto pb-1">
          {filteredMeals.map((sm) => (
            <SavedMealCard
              key={sm.id}
              sm={sm}
              draggedId={draggedId}
              onEdit={onEdit}
              onDragStartMeal={onDragStartMeal}
              onDragEndMeal={onDragEndMeal}
              onPointerDownMeal={onPointerDownMeal}
              dragOpts={{ scrollContainer: scrollRowRef.current ?? undefined }}
              className="w-40 shrink-0"
            />
          ))}
        </div>
      )}
      </div>
    </Card>
  );
}

// Browse the built-in meal-idea database — searchable/filterable by cuisine,
// meal type, prep time, and kid-friendliness. Picking one saves it as a real
// SavedMeal for the family (same shape a hand-typed "Add idea" produces),
// so it immediately behaves like any other saved meal (draggable onto the
// grid, editable, etc.). The blank "Add idea" flow is untouched by this.
function BrowseMealIdeasDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [cuisine, setCuisine] = useState<Cuisine | "all">("all");
  const [mealType, setMealType] = useState<MealType | "all">("all");
  const [prepBucket, setPrepBucket] = useState<"quick" | "medium" | "long" | "all">("all");
  const [kidFriendlyOnly, setKidFriendlyOnly] = useState(false);
  // Opens the existing create-meal-idea form, pre-filled with the picked
  // idea's name/ingredients — reusing that form (rather than saving
  // silently) lets the user adjust quantities/items before it becomes a
  // real saved meal, and doubles as the "add" action the button below opens.
  const [prefillIdea, setPrefillIdea] = useState<MealIdea | null>(null);
  // Adding several ideas in a row used to mean reopening Browse each time:
  // the create form closed the whole stack. Closing it now just returns
  // here, and there's no ambiguity about "how did I get to this form" —
  // this dialog owns its own prefill state, and the blank "Add idea" button
  // opens a completely separate SavedMealModal instance elsewhere.
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Tapping a row (not the + button) opens a read-only detail view — the
  // list row only ever showed the name + first 3 ingredients, with no way
  // to see the rest before committing to add it.
  const [detailIdea, setDetailIdea] = useState<MealIdea | null>(null);
  // 200 ideas is a long way back to the filters. The scroll container is the
  // shared Dialog's own Content box (role="dialog"), not anything this
  // component renders — see the list's comment below about why there's no
  // nested scroller here.
  const listRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  // ⚠️ Keyed on `listMounted`, NOT []. Radix renders DialogContent through
  // Portal + Presence, so on an []-effect's single run listRef.current is
  // still null — the effect bailed at the guard and no scroll listener was
  // ever attached, which is why the button never appeared. Same trap as
  // ui/dialog.tsx's keyboard handler and settings-modal's sticky header.
  const [listMounted, setListMounted] = useState(false);
  useEffect(() => {
    const el = listRef.current?.closest('[role="dialog"]') as HTMLElement | null;
    if (!el) return;
    const onScroll = () => setShowBackToTop(el.scrollTop > 400);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [listMounted]);
  const scrollBackToTop = () => {
    const el = listRef.current?.closest('[role="dialog"]') as HTMLElement | null;
    el?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The check mark used to live only in `addedIds`, so it reverted to a plus
  // the next time Browse was opened and there was no way to see which ideas
  // were already in your Meal Ideas. Matching the family's real saved meals
  // by name makes it survive; `addedIds` still covers the same visit (and an
  // idea saved under a different name than the one listed here).
  // Shares the cache with the panel's own query — no extra request.
  const { data: savedMeals = [] } = useQuery<SavedMeal[]>({ queryKey: ["/api/saved-meals"] });
  const savedNames = useMemo(
    () => new Set(savedMeals.map((m) => m.name.trim().toLowerCase())),
    [savedMeals],
  );
  const isAdded = (idea: MealIdea) =>
    addedIds.has(idea.id) || savedNames.has(idea.name.trim().toLowerCase());

  const q = search.trim().toLowerCase();
  const filtered = MEAL_IDEAS.filter((idea) => {
    if (cuisine !== "all" && idea.cuisine !== cuisine) return false;
    if (mealType !== "all" && idea.mealType !== mealType) return false;
    if (prepBucket !== "all" && prepTimeBucket(idea.prepMinutes) !== prepBucket) return false;
    if (kidFriendlyOnly && !idea.kidFriendly) return false;
    if (q) {
      const haystack = `${idea.name} ${idea.ingredients.join(" ")}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (prefillIdea) {
    const payload = toSavedMealPayload(prefillIdea);
    return (
      <SavedMealModal
        savedMeal={null}
        initialData={{
          name: payload.name,
          notes: payload.notes,
          directions: payload.directions,
          ingredients: payload.ingredients.map((i) => ({ quantity: i.quantity ?? "", item: i.item })),
        }}
        onSaved={() => setAddedIds((prev) => new Set(prev).add(prefillIdea.id))}
        onClose={() => setPrefillIdea(null)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* w-[calc(100vw-2rem)] caps the dialog to the phone's actual viewport
          width — max-w-2xl alone isn't enough on its own: DialogContent is a
          CSS grid, and a grid track's minimum width is set by the widest
          non-shrinking content inside it (here, the filter row's fixed-width
          selects), which can silently blow the dialog past its max-width
          instead of wrapping. min-w-0 on the direct child below is the
          other half of that fix — without it, the child's intrinsic content
          width propagates up into the grid track regardless of the cap. */}
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl" data-testid="browse-meal-ideas-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-orange-500 shrink-0" />
            Browse Meal Ideas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ingredient…"
            data-testid="browse-meal-search"
            autoFocus
          />

          <div className="flex flex-wrap gap-2">
            <Select value={cuisine} onValueChange={(v) => setCuisine(v as Cuisine | "all")}>
              <SelectTrigger className="w-[7.5rem] h-8 text-xs" data-testid="browse-cuisine-filter"><SelectValue placeholder="Cuisine" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any cuisine</SelectItem>
                {CUISINES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={mealType} onValueChange={(v) => setMealType(v as MealType | "all")}>
              <SelectTrigger className="w-[6.5rem] h-8 text-xs" data-testid="browse-mealtype-filter"><SelectValue placeholder="Meal type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                {MEAL_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={prepBucket} onValueChange={(v) => setPrepBucket(v as typeof prepBucket)}>
              <SelectTrigger className="w-[8.5rem] h-8 text-xs" data-testid="browse-preptime-filter"><SelectValue placeholder="Prep time" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any prep time</SelectItem>
                {PREP_TIME_BUCKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setKidFriendlyOnly((v) => !v)}
              className={`h-8 px-2.5 rounded-md border text-xs font-medium flex items-center gap-1 transition-colors shrink-0 ${
                kidFriendlyOnly ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-accent"
              }`}
              data-testid="browse-kidfriendly-filter"
            >
              <Baby className="w-3.5 h-3.5" />
              Kid-friendly
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            {filtered.length} idea{filtered.length === 1 ? "" : "s"} found
          </p>

          {/* No nested overflow-y-auto here — the shared Dialog's own outer
              scroll container (ui/dialog.tsx) is the one intended scroll
              owner. A second, nested scrollable ancestor here defeats iOS's
              scroll-lock ancestor walk, which is exactly the "top of screen
              looks weird / can't scroll" bug from Bulk Add Chores etc. */}
          <div
            className="space-y-2"
            ref={(node) => { listRef.current = node; if (node) setListMounted(true); }}
          >
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No meals match those filters.</p>
            ) : (
              filtered.map((idea) => (
                <div
                  key={idea.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailIdea(idea)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailIdea(idea); } }}
                  className="flex items-start gap-2 p-2.5 rounded-lg border border-border hover:bg-accent/30 transition-colors cursor-pointer"
                  data-testid={`meal-idea-${idea.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm break-words">{idea.name}</span>
                      {idea.kidFriendly && <Baby className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                      <span className="shrink-0">{idea.cuisine}</span>
                      <span className="shrink-0">•</span>
                      <span className="flex items-center gap-0.5 shrink-0"><Clock className="w-3 h-3" />{idea.prepMinutes} min</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                      {idea.ingredients.slice(0, 3).join(", ")}{idea.ingredients.length > 3 ? "…" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isAdded(idea) ? "outline" : "default"}
                    onClick={(e) => { e.stopPropagation(); setPrefillIdea(idea); }}
                    className="shrink-0"
                    aria-label={isAdded(idea) ? `${idea.name} is already in your Meal Ideas — add again` : `Add ${idea.name}`}
                    data-testid={`add-meal-idea-${idea.id}`}
                  >
                    {isAdded(idea) ? <Check className="w-4 h-4 text-emerald-500" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* h-0 so this sticky row adds no height of its own to the dialog's
            grid; only rendered once you're actually a few screens down. */}
        {showBackToTop && (
          <div className="sticky bottom-2 h-0 flex justify-end pointer-events-none">
            <Button
              size="sm"
              variant="secondary"
              onClick={scrollBackToTop}
              // An explicit edge so the pill reads as a button against the
              // list behind it: darker than its own fill in light mode,
              // lighter in dark. Palette colours rather than a theme token
              // with an opacity modifier — those compile to no CSS at all in
              // this project (SYS-1), which is exactly how an edge goes
              // missing without anyone noticing.
              className="pointer-events-auto shadow-md -translate-y-full border border-slate-400 dark:border-slate-300"
              aria-label="Back to top"
              data-testid="browse-back-to-top"
            >
              <ChevronUp className="w-4 h-4 mr-1" />
              Top
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {/* Read-only detail view — a nested Dialog on top of this one, same
          pattern already used elsewhere in this file (Snap a Recipe's photo
          preview); Radix handles a Dialog nested inside an already-open one
          correctly with no special-casing needed. */}
      {detailIdea && (
        <Dialog open onOpenChange={(o) => !o && setDetailIdea(null)}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-md" data-testid="meal-idea-detail-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-6">
                <span className="break-words">{detailIdea.name}</span>
                {detailIdea.kidFriendly && <Baby className="w-4 h-4 text-emerald-500 shrink-0" />}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                <span>{detailIdea.cuisine}</span>
                <span>•</span>
                <span>{MEAL_TYPES.find((t) => t.value === detailIdea.mealType)?.label ?? detailIdea.mealType}</span>
                <span>•</span>
                <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{detailIdea.prepMinutes} min</span>
                {detailIdea.kidFriendly && <span className="text-emerald-600 dark:text-emerald-400">Kid-friendly</span>}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Ingredients
                </p>
                <ul className="space-y-1">
                  {detailIdea.ingredients.map((line, i) => (
                    <li key={i} className="text-sm flex items-start gap-1.5">
                      <span className="text-muted-foreground">•</span>
                      <span className="break-words">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Directions
                </p>
                <ol className="space-y-1.5 list-decimal list-inside">
                  {detailIdea.directions.split("\n").map((line, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      {line.replace(/^\s*\d+\.\s*/, "")}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailIdea(null)}>Close</Button>
              <Button onClick={() => { setPrefillIdea(detailIdea); setDetailIdea(null); }}>
                <Plus className="w-4 h-4 mr-1" /> Add to Meal Ideas
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

interface SavedMealCardProps {
  sm: SavedMealWithIngredients;
  draggedId: string | null;
  onEdit: (sm: SavedMealWithIngredients) => void;
  onDragStartMeal: (sm: SavedMealWithIngredients) => void;
  onDragEndMeal: () => void;
  onPointerDownMeal: (e: React.PointerEvent, sm: SavedMealWithIngredients, opts?: MealDragOpts) => void;
  dragOpts?: MealDragOpts;
  className?: string;
}

function SavedMealCard({ sm, draggedId, onEdit, onDragStartMeal, onDragEndMeal, onPointerDownMeal, dragOpts, className = "" }: SavedMealCardProps) {
  const { toast } = useToast();

  // Lets a saved meal idea's ingredients go straight onto the grocery list
  // without first planning it onto the calendar — previously the only way
  // to reach the grocery-list prompt was via createFromSavedMutation, which
  // only fires when the idea is actually dropped onto a day.
  const addToGroceryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/grocery-items/bulk", {
        items: sm.ingredients.map((i) => ({
          name: i.item,
          quantity: i.quantity ?? null,
          sourceMealIds: [],
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
      toast({
        title: `Added ${sm.ingredients.length} ingredient${sm.ingredients.length === 1 ? "" : "s"} to your grocery list`,
      });
    },
    onError: () => toast({ title: "Failed to add to grocery list", variant: "destructive" }),
  });

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", sm.id);
        onDragStartMeal(sm);
      }}
      onDragEnd={onDragEndMeal}
      onPointerDown={(e) => onPointerDownMeal(e, sm, dragOpts)}
      // none: keep all pointer events in JS so our direction-detection logic
      // decides whether this gesture is a drag (vertical) or a swipe/scroll
      // (horizontal).  The parent passes opts that tell us what to do.
      style={{ touchAction: "none" }}
      className={`group rounded-lg border bg-orange-50 dark:bg-orange-950/30 p-2 cursor-grab active:cursor-grabbing transition-all ${
        draggedId === sm.id
          ? "border-orange-400 ring-2 ring-orange-400 ring-offset-1 opacity-60"
          : "border-orange-200 dark:border-orange-900/50"
      } ${className}`}
      data-testid={`saved-meal-${sm.id}`}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
        <span className="text-xs font-medium text-orange-900 dark:text-orange-100 flex-1 break-words leading-tight">
          {sm.name}
        </span>
        {/* Own group with padding and a real gap: these were 12px icons sitting
            flush against each other, so the cart and the pencil were easy to
            mis-tap on a phone. */}
        <div className="flex items-center gap-1.5 shrink-0 -mr-1">
        {sm.recipeUrl && (
          <a
            href={sm.recipeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-orange-500 hover:text-orange-700 shrink-0 p-1"
            title="Open recipe link"
            data-testid={`recipe-link-${sm.id}`}
          >
            <Link2 className="w-3.5 h-3.5" />
          </a>
        )}
        {sm.ingredients.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); addToGroceryMutation.mutate(); }}
            disabled={addToGroceryMutation.isPending}
            className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-orange-500 hover:text-orange-700 shrink-0 disabled:opacity-40 p-1"
            title="Add ingredients to grocery list"
            data-testid={`add-to-grocery-${sm.id}`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(sm); }}
          className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-orange-500 hover:text-orange-700 shrink-0 p-1"
          title="Edit idea"
          data-testid={`edit-saved-meal-${sm.id}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        </div>
      </div>
      <div className="text-[10px] text-orange-700/80 dark:text-orange-300/80 pl-4 mt-0.5">
        {sm.ingredients.length} ingredient{sm.ingredients.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// ============== SNAP A RECIPE (photos) ==============

const MAX_RECIPE_PHOTOS = 5;

interface ExtractedRecipeResult {
  name: string;
  ingredients: { quantity: string | null; item: string }[];
  directions: string | null;
  notes: string | null;
  warning: string | null;
  imageCount: number;
}

/**
 * Photograph a recipe (cookbook page, handwritten card, clipping) and turn it
 * into a Meal Idea.
 *
 * Multiple photos go in ONE request as ordered pages of a single recipe — a
 * long recipe rarely fits in one frame, and letting the model stitch them
 * itself is what makes continuation across pages work (see recipeExtract.ts).
 * Photos are downscaled client-side before upload; several full-resolution
 * phone photos would be far too large both for the database and the request.
 *
 * The result is handed to SavedMealModal pre-filled rather than saved
 * outright, so OCR output always gets a human check before it lands.
 */
function SnapRecipeSheet({
  onClose,
  onExtracted,
}: {
  onClose: () => void;
  onExtracted: (data: { name: string; notes: string; ingredients: IngredientInput[]; directions?: string }) => void;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  // Tapping a thumbnail opens it full-size — the list thumbnails are only
  // 48x48px, nowhere near big enough to tell pages apart (e.g. two similar-
  // looking handwritten cards), which matters here specifically because
  // getting the order right is what the reorder arrows exist for.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { toast } = useToast();

  const addPhotos = (results: { objectPath: string }[]) => {
    setPhotos((prev) => {
      const merged = [...prev, ...results.map((r) => r.objectPath)];
      if (merged.length > MAX_RECIPE_PHOTOS) {
        toast({
          title: `Up to ${MAX_RECIPE_PHOTOS} photos`,
          description: "Extra photos weren't added.",
        });
      }
      return merged.slice(0, MAX_RECIPE_PHOTOS);
    });
  };

  // Order is sent to the model as the reading order of the recipe (see
  // recipeExtract.ts's prompt — it's told to trust this order, not guess at
  // one), so photos taken out of sequence need a way to be fixed before
  // extraction, not just removed and retaken.
  const movePhoto = (idx: number, direction: -1 | 1) => {
    setPhotos((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/saved-meals/extract-photos", { imageURLs: photos });
      return res.json() as Promise<ExtractedRecipeResult>;
    },
    onSuccess: (r) => {
      if (r.warning) {
        toast({ title: "Read it, with a caveat", description: r.warning });
      }
      onExtracted({
        name: r.name,
        notes: r.notes ?? "",
        directions: r.directions ?? "",
        ingredients: r.ingredients.length
          ? r.ingredients.map((i) => ({ quantity: i.quantity ?? "1", item: i.item }))
          : [{ quantity: "1", item: "" }],
      });
    },
    onError: (err: any) => {
      if (err?.code === "subscription_required") {
        showUpgradeDialog();
        return;
      }
      toast({
        title: "Couldn't read that recipe",
        description: err?.message ?? "Try again with clearer, straight-on photos.",
        variant: "destructive",
      });
    },
  });

  const full = photos.length >= MAX_RECIPE_PHOTOS;

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && !extractMutation.isPending && onClose()}>
      <DialogContent className="max-w-md" data-testid="snap-recipe-sheet">
        <DialogHeader>
          <DialogTitle>Snap a recipe</DialogTitle>
          <DialogDescription>
            Photograph a cookbook page, recipe card, or clipping. Add several photos if
            the recipe runs long — they'll be read together as one recipe, in order.
          </DialogDescription>
        </DialogHeader>

        {extractMutation.isPending ? (
          <div className="py-10 text-center space-y-3">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">Reading the recipe…</p>
            <p className="text-xs text-muted-foreground">
              {photos.length > 1 ? `Combining ${photos.length} photos` : "This takes a few seconds"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {photos.length > 0 && (
              <ul className="space-y-2" data-testid="snap-recipe-photo-list">
                {photos.map((p, idx) => (
                  <li key={`${p}-${idx}`} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(idx)}
                      className="shrink-0 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`View photo ${idx + 1} full size`}
                      data-testid={`snap-recipe-photo-thumb-${idx}`}
                    >
                      <img
                        src={objectUrl(p)}
                        alt=""
                        className="w-12 h-12 object-cover bg-muted"
                      />
                    </button>
                    <span className="text-xs text-muted-foreground flex-1 min-w-0">
                      Photo {idx + 1}
                      {idx === 0 && photos.length > 1 && " (first page)"}
                    </span>
                    {photos.length > 1 && (
                      <div className="flex flex-col shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-6 text-muted-foreground disabled:opacity-30"
                          onClick={() => movePhoto(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move photo ${idx + 1} up`}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-6 text-muted-foreground disabled:opacity-30"
                          onClick={() => movePhoto(idx, 1)}
                          disabled={idx === photos.length - 1}
                          aria-label={`Move photo ${idx + 1} down`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remove photo ${idx + 1}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {!full && (
              <div className="flex flex-col gap-2">
                <ObjectUploader
                  accept="image/*"
                  capture="environment"
                  maxNumberOfFiles={MAX_RECIPE_PHOTOS}
                  maxFileSize={20 * 1024 * 1024}
                  downscaleTo={1600}
                  onCompleteMany={addPhotos}
                  buttonClassName="w-full justify-center bg-primary text-primary-foreground hover:bg-primary/90 h-12 rounded-xl"
                >
                  <span className="inline-flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    {photos.length === 0 ? "Take a photo" : "Take another photo"}
                  </span>
                </ObjectUploader>

                <ObjectUploader
                  accept="image/*"
                  maxNumberOfFiles={MAX_RECIPE_PHOTOS}
                  maxFileSize={20 * 1024 * 1024}
                  downscaleTo={1600}
                  onCompleteMany={addPhotos}
                  buttonClassName="w-full justify-center bg-card border border-border hover:bg-accent text-foreground h-12 rounded-xl"
                >
                  <span className="inline-flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    Choose from photos
                  </span>
                </ObjectUploader>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              {photos.length === 0
                ? `Up to ${MAX_RECIPE_PHOTOS} photos. You'll get to review everything before it saves.`
                : `${photos.length} of ${MAX_RECIPE_PHOTOS} photos added${full ? " (limit reached)" : ""}. Order matters — use the arrows to fix it if a photo's out of place.`}
            </p>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={extractMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => extractMutation.mutate()}
            disabled={photos.length === 0 || extractMutation.isPending}
            data-testid="snap-recipe-extract"
          >
            {extractMutation.isPending ? "Reading…" : "Read recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* Full-size preview — the list thumbnails are 48px, too small to tell
          similar-looking pages apart, which is exactly when getting the
          order right (the reorder arrows above) actually matters. */}
      {previewIndex !== null && photos[previewIndex] && (
        <Dialog open onOpenChange={(o) => !o && setPreviewIndex(null)}>
          <DialogContent className="max-w-lg p-2" data-testid="snap-recipe-photo-preview">
            <DialogHeader className="px-2 pt-1">
              <DialogTitle className="text-sm font-normal text-muted-foreground">
                Photo {previewIndex + 1} of {photos.length}
                {previewIndex === 0 && photos.length > 1 && " · first page"}
              </DialogTitle>
            </DialogHeader>
            <img
              src={objectUrl(photos[previewIndex])}
              alt={`Photo ${previewIndex + 1} of the recipe, full size`}
              className="w-full max-h-[70vh] object-contain rounded-lg bg-muted"
            />
            {photos.length > 1 && (
              <div className="flex items-center justify-between px-2 pb-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
                  disabled={previewIndex === 0}
                  data-testid="snap-recipe-preview-prev"
                >
                  ← Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
                  disabled={previewIndex === photos.length - 1}
                  data-testid="snap-recipe-preview-next"
                >
                  Next →
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ============== IMPORT RECIPE FROM URL ==============

/**
 * Paste a recipe link, get it saved into Meal Ideas.
 *
 * The server does the work (SSRF-hardened fetch + schema.org/Recipe parse,
 * with an AI fallback for pages without structured data) — this is just the
 * input, the error surface, and the hand-off to the created idea.
 */
function ImportRecipeDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (sm: SavedMealWithIngredients) => void;
}) {
  const [url, setUrl] = useState("");
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/saved-meals/import-url", { url: url.trim() });
      return res.json() as Promise<SavedMealWithIngredients & { method?: string }>;
    },
    onSuccess: async (created) => {
      // Await the refetch before handing off, so the Meal Ideas list already
      // contains the new idea by the time it opens — otherwise the user can
      // close the recipe and briefly not see it in the list behind.
      await queryClient.invalidateQueries({ queryKey: ["/api/saved-meals"] });
      toast({
        title: `Saved "${created.name}" to Meal Ideas`,
        description:
          created.method === "ai"
            ? "We read this one from the page text — worth a quick check."
            : "Opening it now so you can review it.",
      });
      onImported(created);
    },
    onError: (err: any) => {
      if (err?.code === "subscription_required") {
        showUpgradeDialog();
        return;
      }
      toast({
        // "site_blocked" (see recipeImport.ts) means the SITE refused the
        // request, not that anything here failed — a different title makes
        // that distinction obvious at a glance instead of reading as a bug
        // in the import feature itself.
        title: err?.code === "site_blocked" ? "That site can't be read automatically" : "Couldn't import that recipe",
        description: err?.message ?? "Try the direct recipe link, or add it manually.",
        variant: "destructive",
      });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || importMutation.isPending) return;
    importMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !importMutation.isPending && onClose()}>
      <DialogContent className="max-w-md" data-testid="import-recipe-dialog">
        <DialogHeader>
          <DialogTitle>Import a recipe</DialogTitle>
          <DialogDescription>
            Paste a link to a recipe and we'll pull in the ingredients and directions,
            then save it to your Meal Ideas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-recipe-url">Link to a recipe page</Label>
            <div className="relative">
              <Input
                id="import-recipe-url"
                type="url"
                inputMode="url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                /* Deliberately not a real site: naming one reads as "this one
                   works", and whether a given site allows automated reading can
                   change without notice (allrecipes.com, the old example here,
                   answers us with a 402). */
                placeholder="e.g. example.com/best-chili-recipe"
                disabled={importMutation.isPending}
                className={url ? "pr-9" : undefined}
                data-testid="import-recipe-url-input"
              />
              {/* A link that turns out to be blocked has to be swapped for
                  another one — selecting a long URL by hand on a phone to
                  delete it is the worst part of retrying. */}
              {url && !importMutation.isPending && (
                <button
                  type="button"
                  onClick={() => setUrl("")}
                  aria-label="Clear link"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  data-testid="clear-import-url"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Works with most recipe sites. Some don't allow it — you can always add
              the recipe by hand.
            </p>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={importMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || importMutation.isPending} data-testid="import-recipe-submit">
              {importMutation.isPending ? "Importing…" : "Import recipe"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============== MEAL MODAL ==============

interface MealModalProps {
  meal: MealWithIngredients | null;
  creatingFor: { date: string; slot: MealSlot } | null;
  weekStartIso: string;
  weekEndIso: string;
  onClose: () => void;
  /** Called with the newly-created meal so the caller can offer to add its
      ingredients to the grocery list — mirrors the same prompt already shown
      when dragging a saved meal idea onto the calendar. */
  onCreated?: (created: MealWithIngredients) => void;
}

// A plain count with +/- stepper buttons instead of a free-typed field —
// used for grocery-list/staple quantities and recipe ingredient counts.
// Always keeps the underlying value as a numeric string ("1", "2", ...),
// defaulting to "1" rather than blank.
// A grocery quantity is free text ("2", "2 cups", "1 lb"), but QtyStepper is
// numeric-only. Splitting it lets the +/- buttons drive just the number while
// the unit survives the round-trip — before this, editing "2 cups" showed a
// stepper sitting at 1 and saving wrote the unit away entirely.
function splitQuantity(raw: string | null | undefined): { num: string; unit: string } {
  const text = (raw ?? "").trim();
  const m = text.match(/^(\d+)\s*(.*)$/);
  if (!m) return { num: text ? "1" : "1", unit: text };
  return { num: m[1], unit: m[2].trim() };
}

function joinQuantity(num: string, unit: string): string {
  const n = String(Math.max(1, parseInt(num, 10) || 1));
  return unit.trim() ? `${n} ${unit.trim()}` : n;
}

function QtyStepper({
  value,
  onChange,
  testId,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  /** Fires on Enter, with the key event already preventDefault'd — these
      steppers live inside a <form>, so left alone Enter would submit the
      whole meal instead of moving to the next ingredient. */
  onEnter?: () => void;
}) {
  const num = Math.max(1, parseInt(value, 10) || 1);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => onChange(String(Math.max(1, num - 1)))}
        aria-label="Decrease quantity"
      >
        <Minus className="w-3.5 h-3.5" />
      </Button>
      <Input
        type="number"
        min={1}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
        value={num}
        onChange={(e) => onChange(String(Math.max(1, parseInt(e.target.value, 10) || 1)))}
        className="w-12 text-center px-1"
        data-testid={testId}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => onChange(String(num + 1))}
        aria-label="Increase quantity"
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// Shared by MealModal (a planned meal) and SavedMealModal (a reusable "Meal
// Idea") — both need the same ingredient-row editor (add/remove/update an
// {quantity, item} list), previously copy-pasted identically in both. Name,
// notes, and each modal's own extra fields (date/slot/repeat for MealModal)
// stay local since they're trivial and their layout order differs slightly
// between the two forms.
function IngredientListEditor({
  testIdPrefix,
  ingredients,
  onIngredientsChange,
  ingredientPlaceholder,
}: {
  testIdPrefix: string;
  ingredients: IngredientInput[];
  onIngredientsChange: (next: IngredientInput[]) => void;
  ingredientPlaceholder: string;
}) {
  const updateIngredient = (idx: number, patch: Partial<IngredientInput>) =>
    onIngredientsChange(ingredients.map((ing, i) => (i === idx ? { ...ing, ...patch } : ing)));
  const itemInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addIngredientRow = () => {
    onIngredientsChange([...ingredients, { quantity: "1", item: "" }]);
    // Quantity already defaults to 1 (no typing needed) — put the cursor
    // straight into the new row's item name field instead.
    //
    // Focus is ALL we do here. ui/dialog.tsx's focusin handler already scrolls
    // the focused field into view with room reserved beneath it; a second
    // scrollIntoView from here aimed at a different element with a different
    // margin, so the two fought on every Enter and the list visibly juddered.
    setTimeout(() => itemInputRefs.current[ingredients.length]?.focus(), 0);
  };
  const removeIngredientRow = (idx: number) =>
    onIngredientsChange(ingredients.length > 1 ? ingredients.filter((_, i) => i !== idx) : ingredients);

  // Enter, from either field in a row, moves to the next ingredient's item
  // field instead of submitting the whole meal (the default behavior for
  // Enter inside any <input> in a <form>) — or, on the last row, adds a new
  // one, so entering several ingredients in a row never needs a tap on "Add
  // ingredient" in between.
  const focusNextOrAdd = (idx: number) => {
    if (idx === ingredients.length - 1) {
      addIngredientRow();
    } else {
      itemInputRefs.current[idx + 1]?.focus();
    }
  };

  return (
    <div className="space-y-2">
      <Label>Ingredients</Label>
      <div className="space-y-2">
        {ingredients.map((ing, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 min-w-0"
            data-ingredient-row
            data-testid={`${testIdPrefix}-ingredient-row-${idx}`}
          >
            <QtyStepper
              value={ing.quantity}
              onChange={(v) => updateIngredient(idx, { quantity: v })}
              testId={`${testIdPrefix}-ingredient-qty-${idx}`}
              onEnter={() => itemInputRefs.current[idx]?.focus()}
            />
            <Input
              ref={(el) => { itemInputRefs.current[idx] = el; }}
              value={ing.item}
              onChange={(e) => updateIngredient(idx, { item: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusNextOrAdd(idx);
                }
              }}
              placeholder={ingredientPlaceholder}
              className="flex-1 min-w-0"
              data-testid={`${testIdPrefix}-ingredient-item-${idx}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeIngredientRow(idx)}
              className="text-muted-foreground hover:text-destructive"
              disabled={ingredients.length === 1}
              data-testid={`${testIdPrefix}-remove-ingredient-${idx}`}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addIngredientRow}
        className="w-full"
        data-testid={`${testIdPrefix}-add-ingredient-row`}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add ingredient
      </Button>
    </div>
  );
}

function MealModal({ meal, creatingFor, weekStartIso, weekEndIso, onClose, onCreated }: MealModalProps) {
  const isEdit = !!meal;
  const initialDate = meal?.date ?? creatingFor?.date ?? "";
  const initialSlot = (meal?.slot ?? creatingFor?.slot ?? "breakfast") as MealSlot;

  const [name, setName] = useState(meal?.name ?? "");
  const [date, setDate] = useState(initialDate);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [notes, setNotes] = useState(meal?.notes ?? "");
  const [recipeUrl, setRecipeUrl] = useState(meal?.recipeUrl ?? "");
  const [directions, setDirections] = useState(meal?.directions ?? "");
  const [ingredients, setIngredients] = useState<IngredientInput[]>(
    meal?.ingredients?.length
      ? meal.ingredients.map((i) => ({ quantity: i.quantity ?? "", item: i.item }))
      : [{ quantity: "1", item: "" }],
  );
  // "Repeat weekly" only applies when creating — each occurrence is a fully
  // independent meal row (no shared series/link), so editing one afterward
  // never affects the others. Simple materialize-ahead, not true recurrence.
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(4);

  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return (
          k === "/api/meals" ||
          k === "/api/grocery-list/aggregate" ||
          k === "/api/grocery-items"
        );
      },
    });
    // Family History synthesizes "meal_planned" entries live from the meals
    // table (no separate write path) — the cache for that read needs
    // invalidating too, or a just-planned meal won't show up there until its
    // 30s staleTime happens to lapse.
    queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const cleanedIngredients = ingredients
        .filter((i) => i.item.trim())
        .map((i, idx) => ({
          item: i.item.trim(),
          quantity: i.quantity.trim() || null,
          displayOrder: idx,
        }));
      const occurrences = repeatWeekly ? Math.max(1, Math.min(26, repeatWeeks)) : 1;
      const results = await Promise.allSettled(
        Array.from({ length: occurrences }, (_, i) => i).map(async (i) => {
          const occurrenceDate = i === 0 ? date : isoDate(addWeeks(new Date(`${date}T00:00:00`), i));
          const res = await apiRequest("POST", "/api/meals", {
            date: occurrenceDate,
            slot,
            name: name.trim(),
            notes: notes.trim() || null,
            recipeUrl: normalizeRecipeUrl(recipeUrl),
            directions: directions.trim() || null,
            ingredients: cleanedIngredients,
          });
          return res.json() as Promise<MealWithIngredients>;
        }),
      );
      const created = results.filter((r): r is PromiseFulfilledResult<MealWithIngredients> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.length - created.length;
      if (created.length === 0) {
        throw new Error(`Couldn't add ${occurrences > 1 ? "any of the meals" : "the meal"}. Please try again.`);
      }
      return { created, failed };
    },
    onSuccess: ({ created, failed }: { created: MealWithIngredients[]; failed: number }) => {
      invalidate();
      if (failed > 0) {
        toast({ title: `Added ${created.length} of ${created.length + failed} weeks`, description: "The rest failed to save — try repeating just those weeks again.", variant: "destructive" });
      } else {
        toast({ title: created.length > 1 ? `Meal added for ${created.length} weeks` : "Meal added" });
      }
      onClose();
      const first = created[0];
      if (first?.ingredients && first.ingredients.length > 0) {
        onCreated?.(first);
      }
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to add meal", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const cleanedIngredients = ingredients
        .filter((i) => i.item.trim())
        .map((i, idx) => ({
          item: i.item.trim(),
          quantity: i.quantity.trim() || null,
          displayOrder: idx,
        }));
      const res = await apiRequest("PATCH", `/api/meals/${meal!.id}`, {
        date,
        slot,
        name: name.trim(),
        notes: notes.trim() || null,
        recipeUrl: normalizeRecipeUrl(recipeUrl),
        directions: directions.trim() || null,
        ingredients: cleanedIngredients,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Meal updated" });
      onClose();
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to update meal", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/meals/${meal!.id}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Meal deleted" });
      onClose();
    },
    onError: () => toast({ title: "Failed to delete meal", variant: "destructive" }),
  });

  // Save the current meal into the reusable idea repository (doesn't close the modal)
  const saveToIdeasMutation = useMutation({
    mutationFn: async () => {
      const cleanedIngredients = ingredients
        .filter((i) => i.item.trim())
        .map((i, idx) => ({ item: i.item.trim(), quantity: i.quantity.trim() || null, displayOrder: idx }));
      await apiRequest("POST", "/api/saved-meals", {
        name: name.trim(),
        notes: notes.trim() || null,
        recipeUrl: normalizeRecipeUrl(recipeUrl),
        directions: directions.trim() || null,
        sourceName: meal?.sourceName ?? null,
        importedAt: meal?.importedAt ?? null,
        ingredients: cleanedIngredients,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-meals"] });
      toast({ title: "Saved to Meal Ideas" });
    },
    onError: (err: any) => toast({
      title: "Failed to save idea",
      description: err?.message,
      variant: "destructive",
    }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Please enter a meal name", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Please pick a date", variant: "destructive" });
      return;
    }
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || saveToIdeasMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="meal-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Meal" : "Add Meal"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meal-name">Name</Label>
            <Input
              id="meal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spaghetti & meatballs"
              data-testid="meal-name-input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2 min-w-0">
              <Label htmlFor="meal-date">Date</Label>
              {/* appearance-none: a native date input carries its own minimum
                  rendered width that w-full/min-w-0 can't shrink, so on a
                  phone it overhung the right edge of every other field in
                  the form. Stripping the native chrome lets it size to the
                  column like everything else. */}
              <Input
                id="meal-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-w-0 appearance-none"
                data-testid="meal-date-input"
              />
            </div>
            <div className="space-y-2 min-w-0">
              <Label htmlFor="meal-slot">Slot</Label>
              <select
                id="meal-slot"
                value={slot}
                onChange={(e) => setSlot(e.target.value as MealSlot)}
                className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="meal-slot-input"
              >
                {SLOTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <IngredientListEditor
            testIdPrefix="meal"
            ingredients={ingredients}
            onIngredientsChange={setIngredients}
            ingredientPlaceholder="Item (e.g. Tomatoes)"
          />

          {/* Both optional and independent — a recipe found online, your own
              typed-out steps, both, or neither. Carried over automatically
              when this meal is saved to (or created from) a Meal Idea. */}
          <div className="space-y-2">
            <Label htmlFor="meal-recipe-url" className="flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Recipe link (optional)
            </Label>
            <Input
              id="meal-recipe-url"
              type="url"
              inputMode="url"
              value={recipeUrl}
              onChange={(e) => setRecipeUrl(e.target.value)}
              placeholder="e.g. allrecipes.com/recipe/…"
              data-testid="meal-recipe-url-input"
            />
            {/* Two fields in this tab said "Recipe link" and did different
                things. This one just stores a link to open later; the one in
                "Import from a link" actually reads the page and fills in a
                new meal idea for you. */}
            <p className="text-xs text-muted-foreground">
              Saved with this meal so you can open it while cooking. It isn't read or copied in.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meal-directions" className="flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5" /> Directions (optional)
            </Label>
            <Textarea
              id="meal-directions"
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder={"1. Preheat oven to 400°F\n2. …"}
              rows={3}
              data-testid="meal-directions-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="meal-notes">Notes (optional)</Label>
            <Textarea
              id="meal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tips, substitutions, prep notes…"
              rows={2}
              data-testid="meal-notes-input"
            />
          </div>

          {!isEdit && (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="meal-repeat-weekly"
                  checked={repeatWeekly}
                  onCheckedChange={(v) => setRepeatWeekly(v === true)}
                  data-testid="meal-repeat-weekly-checkbox"
                />
                <Label htmlFor="meal-repeat-weekly" className="cursor-pointer text-sm">
                  Repeat weekly
                </Label>
              </div>
              {repeatWeekly && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-xs text-muted-foreground">For</span>
                  <Input
                    type="number"
                    min={1}
                    max={26}
                    value={repeatWeeks}
                    onChange={(e) => setRepeatWeeks(Math.max(1, Math.min(26, parseInt(e.target.value) || 1)))}
                    className="w-16 h-8"
                    data-testid="meal-repeat-weeks-input"
                  />
                  <span className="text-xs text-muted-foreground">weeks (creates {repeatWeeks} separate meals — editing one later won't change the others)</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            {isEdit ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => { if (await confirmDialog({ title: "Delete this meal from the plan?" })) deleteMutation.mutate(); }}
                disabled={isPending}
                // Was ghost: no border, so beside a bordered Cancel and a
                // filled Save it read as a stray text link rather than a button.
                className="text-destructive hover:text-destructive"
                data-testid="delete-meal-button"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            {/* "Save to ideas" was a ghost-variant button, so it read as plain
                text with no visible affordance until it was actually pressed.
                Now a real (if smaller) outline button, paired with Cancel on
                one row so it's not competing for width with the primary
                submit action — which spans the full width of that row on its
                own line below, matching the emphasis a submit button should
                have over a secondary "also save this as a reusable idea"
                action. */}
            {/* Both the same size, splitting the row evenly. They were a
                default-size Cancel next to a size="sm" Save to Ideas pushed
                apart by justify-between, which read as two mismatched
                buttons with an arbitrary gap between them. */}
            <div className="flex flex-col gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveToIdeasMutation.mutate()}
                  disabled={isPending || !name.trim()}
                  title="Save to your reusable Meal Ideas"
                  className="flex-1"
                  data-testid="save-to-ideas-button"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Save to Ideas
                </Button>
              </div>
              <Button type="submit" disabled={isPending} data-testid="save-meal-button" className="w-full">
                {isEdit ? "Save changes" : "Add meal"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============== SAVED-MEAL MODAL ==============

interface SavedMealModalProps {
  savedMeal: SavedMealWithIngredients | null;
  /** Seeds a brand-new (savedMeal === null) form with a browsed MealIdea's
      or a photo-extracted recipe's fields, so both reuse this same create
      form (pre-filled, still fully editable) instead of silently saving
      whatever was read. `directions` is optional because Browse Meal Ideas
      has none — only Snap a Recipe supplies it. */
  initialData?: {
    name: string;
    notes: string;
    ingredients: IngredientInput[];
    directions?: string;
  } | null;
  onClose: () => void;
  /** Fires only on a successful save (not on cancel/close) — Browse Meal
      Ideas uses it to mark that idea as added when it returns to the list. */
  onSaved?: () => void;
}

function SavedMealModal({ savedMeal, initialData, onClose, onSaved }: SavedMealModalProps) {
  const isEdit = !!savedMeal;
  const [name, setName] = useState(savedMeal?.name ?? initialData?.name ?? "");
  const [notes, setNotes] = useState(savedMeal?.notes ?? initialData?.notes ?? "");
  const [recipeUrl, setRecipeUrl] = useState(savedMeal?.recipeUrl ?? "");
  const [directions, setDirections] = useState(savedMeal?.directions ?? initialData?.directions ?? "");
  const [ingredients, setIngredients] = useState<IngredientInput[]>(
    savedMeal?.ingredients?.length
      ? savedMeal.ingredients.map((i) => ({ quantity: i.quantity ?? "", item: i.item }))
      : initialData?.ingredients?.length
      ? initialData.ingredients
      : [{ quantity: "1", item: "" }],
  );
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/saved-meals"] });

  const cleanedIngredients = () =>
    ingredients
      .filter((i) => i.item.trim())
      .map((i, idx) => ({ item: i.item.trim(), quantity: i.quantity.trim() || null, displayOrder: idx }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        notes: notes.trim() || null,
        recipeUrl: normalizeRecipeUrl(recipeUrl),
        directions: directions.trim() || null,
        ingredients: cleanedIngredients(),
      };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/saved-meals/${savedMeal!.id}`, body)
        : await apiRequest("POST", "/api/saved-meals", body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: isEdit ? "Idea updated" : "Idea saved" });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => toast({
      title: "Failed to save idea",
      description: err?.message,
      variant: "destructive",
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/saved-meals/${savedMeal!.id}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Idea deleted" });
      onClose();
    },
    onError: () => toast({ title: "Failed to delete idea", variant: "destructive" }),
  });

  const isPending = saveMutation.isPending || deleteMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Please enter a meal name", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="saved-meal-modal">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Meal Idea" : "New Meal Idea"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="saved-meal-name">Name</Label>
            <Input
              id="saved-meal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Taco Tuesday"
              data-testid="saved-meal-name-input"
            />
          </div>

          <IngredientListEditor
            testIdPrefix="saved-meal"
            ingredients={ingredients}
            onIngredientsChange={setIngredients}
            ingredientPlaceholder="Item (e.g. Ground beef)"
          />

          <div className="space-y-2">
            <Label htmlFor="saved-meal-recipe-url" className="flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Recipe link (optional)
            </Label>
            <Input
              id="saved-meal-recipe-url"
              type="url"
              inputMode="url"
              value={recipeUrl}
              onChange={(e) => setRecipeUrl(e.target.value)}
              placeholder="e.g. allrecipes.com/recipe/…"
              data-testid="saved-meal-recipe-url-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="saved-meal-directions" className="flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5" /> Directions (optional)
            </Label>
            <Textarea
              id="saved-meal-directions"
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder={"1. Preheat oven to 400°F\n2. …"}
              rows={3}
              data-testid="saved-meal-directions-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="saved-meal-notes">Notes (optional)</Label>
            <Textarea
              id="saved-meal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tips, substitutions, prep notes…"
              rows={2}
            />
          </div>

          {/* Credit the site an imported recipe came from. Only rendered for
              imported recipes (sourceName is null for anything hand-typed),
              and deliberately at the very bottom, below the recipe itself.
              The date matters because a site can change its recipe after we
              pulled it — this says which version you have. */}
          {savedMeal?.sourceName && (
            <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-0.5" data-testid="recipe-attribution">
              <p>
                Recipe from{" "}
                {savedMeal.recipeUrl ? (
                  <a
                    href={savedMeal.recipeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 break-all"
                    data-testid="recipe-attribution-link"
                  >
                    {savedMeal.sourceName}
                  </a>
                ) : (
                  <span className="font-medium">{savedMeal.sourceName}</span>
                )}
                {savedMeal.importedAt && (
                  <> · imported {format(new Date(savedMeal.importedAt), "MMM d, yyyy")}</>
                )}
              </p>
              {savedMeal.recipeUrl && (
                <p className="break-all opacity-80">{savedMeal.recipeUrl}</p>
              )}
            </div>
          )}

          {/* Same shape as Edit Event: Delete and Cancel share a row, the
              primary save runs full width beneath them. */}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <div className="flex gap-2 w-full">
              {isEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => { if (await confirmDialog({ title: "Delete this meal idea?", description: "Its saved ingredients go with it." })) deleteMutation.mutate(); }}
                  disabled={isPending}
                  className="flex-1 text-destructive hover:text-destructive"
                  data-testid="delete-saved-meal-button"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
                Cancel
              </Button>
            </div>
            <Button type="submit" disabled={isPending} data-testid="save-saved-meal-button" className="w-full">
              {isEdit ? "Save changes" : "Save idea"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============== GROCERY PROMPT (after dropping a saved meal) ==============

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}


interface GroceryPromptDialogProps {
  meal: MealWithIngredients;
  onClose: () => void;
}

function GroceryPromptDialog({ meal, onClose }: GroceryPromptDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(meal.ingredients.map((i) => i.id)),
  );
  const { toast } = useToast();

  const { data: currentItems = [] } = useQuery<GroceryItem[]>({
    queryKey: ["/api/grocery-items"],
  });

  // Build a case-insensitive name → existing item map
  const existingMap = useMemo(() => {
    const map = new Map<string, GroceryItem>();
    for (const item of currentItems) {
      map.set(normalizeName(item.name), item);
    }
    return map;
  }, [currentItems]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const chosen = meal.ingredients.filter((i) => selected.has(i.id));
      const toCreate = chosen.filter((i) => !existingMap.has(normalizeName(i.item)));
      const toUpdate = chosen.filter((i) => existingMap.has(normalizeName(i.item)));

      const ops: Promise<unknown>[] = [];

      if (toCreate.length > 0) {
        ops.push(
          apiRequest("POST", "/api/grocery-items/bulk", {
            items: toCreate.map((i) => ({
              name: i.item,
              quantity: i.quantity ?? null,
              sourceMealIds: [meal.id],
            })),
          }),
        );
      }

      for (const ing of toUpdate) {
        const existing = existingMap.get(normalizeName(ing.item))!;
        ops.push(
          apiRequest("PATCH", `/api/grocery-items/${existing.id}`, {
            quantity: mergeGroceryQuantities(existing.quantity, ing.quantity),
          }),
        );
      }

      await Promise.all(ops);
      return { created: toCreate.length, updated: toUpdate.length };
    },
    onSuccess: ({ created, updated }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} item${created === 1 ? "" : "s"} added`);
      if (updated > 0) parts.push(`${updated} already in list — quantity updated`);
      toast({ title: parts.join(" · ") || "Nothing to add" });
      onClose();
    },
    onError: () => toast({ title: "Failed to update grocery list", variant: "destructive" }),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allSelected = selected.size === meal.ingredients.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(meal.ingredients.map((i) => i.id)));

  const duplicateCount = meal.ingredients.filter(
    (i) => selected.has(i.id) && existingMap.has(normalizeName(i.item)),
  ).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="grocery-prompt-dialog">
        <DialogHeader>
          <DialogTitle>Add ingredients to grocery list?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-1">
          From <span className="font-medium text-foreground">{meal.name}</span>. Pick what you need.
        </p>

        <div className="flex items-center justify-between border-b border-border pb-2">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-primary hover:underline"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
        </div>

        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {meal.ingredients.map((ing) => {
            const inList = existingMap.has(normalizeName(ing.item));
            return (
              <li
                key={ing.id}
                className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 cursor-pointer"
                onClick={() => toggle(ing.id)}
                data-testid={`grocery-prompt-item-${ing.id}`}
              >
                <Checkbox checked={selected.has(ing.id)} onCheckedChange={() => toggle(ing.id)} />
                <span className="text-sm font-medium flex-1">{ing.item}</span>
                {ing.quantity && (
                  <span className="text-xs text-muted-foreground">({ing.quantity})</span>
                )}
                {inList && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 shrink-0">
                    In list
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {duplicateCount > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
            {duplicateCount === 1
              ? "1 item already listed — quantity will update."
              : `${duplicateCount} items are already in your list — adding them again will update their quantities.`}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={addMutation.isPending}>
            Skip
          </Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || selected.size === 0}
            data-testid="grocery-prompt-confirm"
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add {selected.size > 0 ? selected.size : ""} to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== GROCERY LIST ==============

// Keyword-based aisle grouping — purely a display concern (nothing is
// persisted), computed fresh from each item's name every render so it works
// retroactively for every item already on the list, no migration needed.
// Ordered the way a typical grocery store is laid out; first keyword match
// wins, so more specific keywords should come before generic ones.
const AISLE_KEYWORDS: { aisle: string; keywords: string[] }[] = [
  { aisle: "Produce", keywords: [
    "apple", "banana", "orange", "lettuce", "spinach", "kale", "carrot", "potato",
    "onion", "garlic", "tomato", "cucumber", "pepper", "broccoli", "cauliflower",
    "celery", "mushroom", "avocado", "lemon", "lime", "grape", "berry", "berries",
    "melon", "peach", "pear", "plum", "corn", "cilantro", "parsley", "basil", "herb",
  ] },
  { aisle: "Meat & Seafood", keywords: [
    "chicken", "beef", "pork", "turkey", "bacon", "sausage", "ham", "steak",
    "fish", "salmon", "shrimp", "tilapia", "tuna", "meat",
  ] },
  { aisle: "Dairy & Eggs", keywords: [
    "milk", "cheese", "yogurt", "butter", "cream", "egg",
  ] },
  { aisle: "Bakery", keywords: [
    "bread", "bagel", "bun", "roll", "tortilla", "muffin", "croissant", "pita",
  ] },
  { aisle: "Frozen", keywords: [
    "frozen", "ice cream", "popsicle", "waffle",
  ] },
  { aisle: "Beverages", keywords: [
    "juice", "soda", "water", "coffee", "tea", "wine", "beer", "lemonade",
  ] },
  { aisle: "Household", keywords: [
    "paper towel", "toilet paper", "soap", "detergent", "foil", "plastic wrap",
    "trash bag", "napkin", "cleaner", "sponge", "batteries",
  ] },
  { aisle: "Pantry", keywords: [
    "rice", "pasta", "noodle", "flour", "sugar", "oil", "vinegar", "sauce",
    "beans", "cereal", "oats", "oatmeal", "canned", "can of", "soup", "spice",
    "salt", "peanut butter", "jelly", "jam", "cracker", "chip", "snack", "nut",
    "honey", "syrup", "ketchup", "mustard", "mayo",
  ] },
];

function categorizeGroceryItem(name: string): string {
  const lower = name.toLowerCase();
  for (const { aisle, keywords } of AISLE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return aisle;
  }
  return "Other";
}

const AISLE_ORDER = [...AISLE_KEYWORDS.map((a) => a.aisle), "Other"];

interface GroceryListViewProps {
  weekStartIso: string;
  weekEndIso: string;
  weekLabel: string;
  onBack: () => void;
}

interface AggregatedIngredient {
  name: string;
  quantity: string | null;
  sourceMealIds: string[];
}

interface MergedGroceryRow {
  key: string;
  name: string;
  quantity: string | null;
  isChecked: boolean;
  fromMeals: boolean;
  manual: boolean;
  persistedId: string | null;
  sourceMealIds: string[];
  aisle: string;
}

function GroceryListView({ weekStartIso, weekEndIso, weekLabel, onBack }: GroceryListViewProps) {
  const [newItemName, setNewItemName] = useState("");
  const [newItemQty, setNewItemQty] = useState("1");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const { data: aggregated = [], isLoading: aggLoading } = useQuery<AggregatedIngredient[]>({
    queryKey: ["/api/grocery-list/aggregate", weekStartIso, weekEndIso],
    queryFn: async () => {
      // Was a raw relative fetch() — on the Capacitor iOS build the webview
      // runs at capacitor://localhost, so a relative path resolves against the
      // local bundle instead of the real backend, and it carried no bearer
      // token either. apiRequest resolves the real origin and attaches auth,
      // same as every other request in the app.
      const res = await apiRequest("GET", `/api/grocery-list/aggregate?start=${weekStartIso}&end=${weekEndIso}`);
      return res.json();
    },
  });

  const { data: persisted = [], isLoading: persLoading } = useQuery<GroceryItem[]>({
    queryKey: ["/api/grocery-items"],
  });

  const isLoading = aggLoading || persLoading;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/grocery-list/aggregate", weekStartIso, weekEndIso],
    });
  };

  const togglePersistedMutation = useMutation({
    mutationFn: async ({ id, isChecked }: { id: string; isChecked: boolean }) => {
      const res = await apiRequest("PATCH", `/api/grocery-items/${id}`, { isChecked });
      return res.json();
    },
    // Without this, the checkbox/strikethrough had nothing to show until the
    // PATCH round-trip finished — by then the row had already recomputed
    // straight into "Got It", so checking an item looked like it just
    // vanished instead of visibly checking off first. Flip it in the cache
    // immediately so the tap registers right away.
    onMutate: async ({ id, isChecked }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/grocery-items"] });
      const prev = queryClient.getQueryData<GroceryItem[]>(["/api/grocery-items"]);
      queryClient.setQueryData<GroceryItem[]>(["/api/grocery-items"], (old = []) =>
        old.map((item) => (item.id === id ? { ...item, isChecked } : item)));
      return { prev };
    },
    onSuccess: invalidateAll,
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/grocery-items"], ctx.prev);
      toast({ title: "Couldn't update item", description: err?.message, variant: "destructive" });
    },
  });

  // Checking an item off shows the checkmark + strikethrough in place first,
  // THEN the row moves down into "Got It" a beat later — moving it in the
  // very same instant the box fills in read as the row just disappearing
  // before the tap visibly registered. Keyed by the same name-based `key`
  // `merged` already uses, which stays stable across an aggregated row
  // becoming a real persisted one.
  const CHECK_MOVE_DELAY_MS = 550;
  const [pendingCheckIds, setPendingCheckIds] = useState<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => { pendingTimersRef.current.forEach((t) => clearTimeout(t)); }, []);

  const upsertCheckedMutation = useMutation<
    GroceryItem,
    Error,
    { name: string; quantity: string | null; sourceMealIds: string[] },
    { prev: GroceryItem[] | undefined }
  >({
    mutationFn: async ({ name, quantity, sourceMealIds }) => {
      const res = await apiRequest("POST", "/api/grocery-items", {
        name,
        quantity,
        isChecked: true,
        sourceMealIds,
      });
      return res.json();
    },
    // Same reasoning as togglePersistedMutation's onMutate above — this is
    // the check-off path for a row that only exists as an aggregated meal
    // ingredient so far (no grocery_items row yet). Without an optimistic
    // insert here, checking one of THESE off would show no checkmark at all
    // until the POST round-trip finished, defeating the pendingCheckIds
    // hold above (it would sit there unchecked-looking for half a second,
    // then jump straight to Got It on refetch).
    onMutate: async ({ name, quantity, sourceMealIds }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/grocery-items"] });
      const prev = queryClient.getQueryData<GroceryItem[]>(["/api/grocery-items"]);
      const temp: GroceryItem = {
        id: `temp-${Date.now()}`,
        userId: "",
        name,
        quantity: quantity ?? null,
        isChecked: true,
        sourceMealIds,
        createdAt: null,
        category: null,
      };
      queryClient.setQueryData<GroceryItem[]>(["/api/grocery-items"], (old = []) => [...old, temp]);
      return { prev };
    },
    onSuccess: invalidateAll,
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/grocery-items"], ctx.prev);
      toast({ title: "Couldn't add item", description: err?.message, variant: "destructive" });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/grocery-items/${id}`);
    },
    onSuccess: invalidateAll,
    onError: (err: any) => toast({ title: "Couldn't remove item", description: err?.message, variant: "destructive" }),
  });

  // An aggregated (not-yet-persisted) row has no id to PATCH — creating a
  // real grocery_items row is what gives the manual aisle override somewhere
  // to live, same reasoning as upsertCheckedMutation above for checking one
  // off directly.
  const setCategoryMutation = useMutation<
    GroceryItem,
    Error,
    { row: MergedGroceryRow; category: string }
  >({
    mutationFn: async ({ row, category }) => {
      if (row.persistedId) {
        const res = await apiRequest("PATCH", `/api/grocery-items/${row.persistedId}`, { category });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/grocery-items", {
        name: row.name,
        quantity: row.quantity,
        isChecked: false,
        sourceMealIds: row.sourceMealIds,
        category,
      });
      return res.json();
    },
    onSuccess: invalidateAll,
    onError: (err: any) => toast({ title: "Couldn't set aisle", description: err?.message, variant: "destructive" }),
  });

  // Same "promote on interaction" pattern as setCategoryMutation above — an
  // item still only live from a meal's own ingredient list (no persisted
  // grocery_items row yet) gets one created here, carrying its sourceMealIds
  // forward, so an edit made before ever checking or re-aisling it doesn't
  // get silently lost the next time the meal's ingredients are re-aggregated.
  const editItemMutation = useMutation<
    GroceryItem,
    Error,
    { row: MergedGroceryRow; name: string; quantity: string | null }
  >({
    mutationFn: async ({ row, name, quantity }) => {
      if (row.persistedId) {
        const res = await apiRequest("PATCH", `/api/grocery-items/${row.persistedId}`, { name, quantity });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/grocery-items", {
        name,
        quantity,
        isChecked: row.isChecked,
        sourceMealIds: row.sourceMealIds,
        category: row.aisle,
      });
      return res.json();
    },
    onSuccess: invalidateAll,
    onError: (err: any) => toast({ title: "Couldn't save changes", description: err?.message, variant: "destructive" }),
  });

  const addItemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/grocery-items", {
        name: newItemName.trim(),
        quantity: newItemQty.trim() || null,
        isChecked: false,
        sourceMealIds: [],
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setNewItemName("");
      setNewItemQty("1");
      nameInputRef.current?.focus();
    },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  const clearCheckedMutation = useMutation<{ removed: number }, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/grocery-items/clear-checked", {});
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      toast({ title: `Cleared ${data.removed} checked item${data.removed === 1 ? "" : "s"}` });
    },
    onError: (err: any) => toast({ title: "Couldn't clear checked items", description: err?.message, variant: "destructive" }),
  });

  const startNewListMutation = useMutation<GroceryItem[], Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/grocery-items/regenerate", {
        start: weekStartIso,
        end: weekEndIso,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Started a fresh list from this week's meals" });
    },
    onError: () => toast({ title: "Failed to start new list", variant: "destructive" }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    addItemMutation.mutate();
  };

  const merged = useMemo<MergedGroceryRow[]>(() => {
    const rowsByKey = new Map<string, MergedGroceryRow>();
    const gone = new Set(
      persisted.filter((item) => item.alreadyHave).map((item) => item.name.trim().toLowerCase()),
    );

    for (const agg of aggregated) {
      const key = agg.name.trim().toLowerCase();
      if (!key || gone.has(key)) continue;
      rowsByKey.set(key, {
        key,
        name: agg.name,
        quantity: agg.quantity,
        isChecked: false,
        fromMeals: true,
        manual: false,
        persistedId: null,
        sourceMealIds: agg.sourceMealIds ?? [],
        aisle: categorizeGroceryItem(agg.name),
      });
    }

    for (const item of persisted) {
      const key = item.name.trim().toLowerCase();
      if (!key || gone.has(key)) continue;
      const existing = rowsByKey.get(key);
      if (existing) {
        existing.persistedId = item.id;
        existing.isChecked = !!item.isChecked;
        if (!existing.quantity && item.quantity) existing.quantity = item.quantity;
        if (item.category) existing.aisle = item.category;
      } else {
        rowsByKey.set(key, {
          key,
          name: item.name,
          quantity: item.quantity ?? null,
          isChecked: !!item.isChecked,
          fromMeals: false,
          manual: true,
          persistedId: item.id,
          sourceMealIds: Array.isArray(item.sourceMealIds) ? item.sourceMealIds : [],
          aisle: item.category || categorizeGroceryItem(item.name),
        });
      }
    }

    return Array.from(rowsByKey.values()).sort((a, b) => {
      const ac = a.isChecked ? 1 : 0;
      const bc = b.isChecked ? 1 : 0;
      if (ac !== bc) return ac - bc;
      if (!a.isChecked) {
        const ai = AISLE_ORDER.indexOf(a.aisle);
        const bi = AISLE_ORDER.indexOf(b.aisle);
        if (ai !== bi) return ai - bi;
      }
      return a.name.localeCompare(b.name);
    });
  }, [aggregated, persisted]);

  const checkedCount = merged.filter((r) => r.isChecked).length;

  // Section the shopping (unchecked) rows by aisle, in AISLE_ORDER — `merged`
  // is already sorted that way, so this is just a grouping pass, not a sort.
  // Checked items stay their own flat section at the end, same as before —
  // except a row still holding its brief post-check pause (pendingCheckIds)
  // stays put in its aisle group, checked-looking, until the hold clears.
  const sections = useMemo(() => {
    const groups: { aisle: string; rows: MergedGroceryRow[] }[] = [];
    for (const row of merged) {
      if (row.isChecked && !pendingCheckIds.has(row.key)) continue;
      const last = groups[groups.length - 1];
      if (last && last.aisle === row.aisle) last.rows.push(row);
      else groups.push({ aisle: row.aisle, rows: [row] });
    }
    const checkedRows = merged.filter((r) => r.isChecked && !pendingCheckIds.has(r.key));
    return { groups, checkedRows };
  }, [merged, pendingCheckIds]);

  const handleToggle = (row: MergedGroceryRow, checked: boolean) => {
    const existingTimer = pendingTimersRef.current.get(row.key);
    if (existingTimer) { clearTimeout(existingTimer); pendingTimersRef.current.delete(row.key); }

    if (checked) {
      setPendingCheckIds((prev) => new Set(prev).add(row.key));
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(row.key);
        setPendingCheckIds((prev) => {
          if (!prev.has(row.key)) return prev;
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });
      }, CHECK_MOVE_DELAY_MS);
      pendingTimersRef.current.set(row.key, timer);
    } else {
      // Unchecking (e.g. from "Got It") clears any pending hold so a stale
      // timer can't fire later and do nothing useful.
      setPendingCheckIds((prev) => {
        if (!prev.has(row.key)) return prev;
        const next = new Set(prev);
        next.delete(row.key);
        return next;
      });
    }

    if (row.persistedId) {
      togglePersistedMutation.mutate({ id: row.persistedId, isChecked: checked });
      return;
    }
    if (checked) {
      upsertCheckedMutation.mutate({
        name: row.name,
        quantity: row.quantity,
        sourceMealIds: row.sourceMealIds,
      });
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Card className="p-4 space-y-3">
        {/* One row, never wrapping. Both list actions used to sit here as
            labelled buttons — roughly 280px of them — which wrapped to a
            second line at phone width and left the title stranded beside a
            gap. They're an overflow menu now: the header stays a clean
            back / title / actions row, and "Clear checked" stops taking a
            third of the width for something used once a shop.
            "Start new list" wipes the list while "Clear checked" only tidies
            it, so the destructive one stays visually separated and confirms
            before running. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={onBack} className="p-1.5 rounded-full -ml-1 shrink-0" title="Back to Meal Plan" aria-label="Back to meal plan">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate">Grocery List</h3>
              <p className="text-xs text-muted-foreground">
                {merged.length} item{merged.length === 1 ? "" : "s"} · {checkedCount} checked
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 rounded-full shrink-0"
                aria-label="Grocery list actions"
                data-testid="grocery-actions-menu"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={clearCheckedMutation.isPending || checkedCount === 0}
                onClick={() => clearCheckedMutation.mutate()}
                data-testid="clear-checked-button"
              >
                <Check className="w-4 h-4 mr-2" />
                Clear checked{checkedCount > 0 ? ` (${checkedCount})` : ""}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={startNewListMutation.isPending}
                onClick={async () => { if (await confirmDialog({ title: "Clear the grocery list and start a new one?", confirmLabel: "Start new list" })) startNewListMutation.mutate(); }}
                data-testid="start-new-list-button"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Start new list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Was a static "Live from meals: {weekLabel}" no matter what — even
            with zero meals planned that week, which read as if the app were
            actively pulling something in when it wasn't. Now says so
            honestly, and only claims "live" once an ingredient is actually
            contributing to the list. */}
        <p className="text-xs text-muted-foreground">
          {aggregated.length > 0
            ? `Live from meals: ${weekLabel}. Add manual extras below.`
            : `Nothing from this week's meals (${weekLabel}) is on the list yet — plan some with ingredients and they'll show up here automatically, or add items manually below.`}
        </p>
      </Card>

      <GroceryStaplesSection />

      <Card className="p-4">
        <form onSubmit={handleAdd} className="flex items-center gap-2 mb-4" data-testid="add-grocery-form">
          <QtyStepper value={newItemQty} onChange={setNewItemQty} testId="new-grocery-qty" />
          <Input
            ref={nameInputRef}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Add item"
            className="flex-1"
            style={{ scrollMarginTop: "calc(6rem + env(safe-area-inset-top, 0px))" }}
            data-testid="new-grocery-name"
          />
          <Button type="submit" size="sm" disabled={!newItemName.trim() || addItemMutation.isPending}>
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : merged.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Your list is empty. Add items above, or plan meals for the week and pull their ingredients in.
          </p>
        ) : (
          <div className="space-y-4">
            {sections.groups.map((group) => (
              <div key={group.aisle}>
                {/* Aisle headers are what you scan a shopping list by, so
                    they get real contrast (foreground, bolder, a rule under
                    them) instead of the muted 11px caption they were — that
                    read as secondary to the items it was organising. */}
                <p className="text-xs font-bold uppercase tracking-wide text-foreground px-2 mb-1.5 pb-1 border-b border-border">
                  {group.aisle}
                </p>
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {group.rows.map((row) => (
                      <GroceryRow
                        key={row.key}
                        row={row}
                        onToggle={(checked) => handleToggle(row, checked)}
                        onDelete={row.persistedId ? async () => { if (await confirmDialog({ title: `Remove "${row.name}" from the list?`, confirmLabel: "Remove" })) deleteItemMutation.mutate(row.persistedId!); } : undefined}
                        onSetAisle={(aisle) => setCategoryMutation.mutate({ row, category: aisle })}
                        onEdit={(name, quantity) => editItemMutation.mutate({ row, name, quantity })}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            ))}
            {sections.checkedRows.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-foreground px-2 mb-1.5 pb-1 border-b border-border">
                  Got It ✓
                </p>
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {sections.checkedRows.map((row) => (
                      <GroceryRow
                        key={row.key}
                        row={row}
                        onToggle={(checked) => handleToggle(row, checked)}
                        onDelete={row.persistedId ? async () => { if (await confirmDialog({ title: `Remove "${row.name}" from the list?`, confirmLabel: "Remove" })) deleteItemMutation.mutate(row.persistedId!); } : undefined}
                        onSetAisle={(aisle) => setCategoryMutation.mutate({ row, category: aisle })}
                        onEdit={(name, quantity) => editItemMutation.mutate({ row, name, quantity })}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Recurring "always want this on the list" items — separate from the
// active list so clearing/regenerating it (Start new list) never touches
// these definitions. Collapsed by default since most shopping trips don't
// need to touch it.
function GroceryStaplesSection() {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const { toast } = useToast();

  const { data: staples = [], isLoading } = useQuery<GroceryStaple[]>({
    queryKey: ["/api/grocery-staples"],
    enabled: expanded,
  });

  const invalidateStaples = () => queryClient.invalidateQueries({ queryKey: ["/api/grocery-staples"] });

  const addStapleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/grocery-staples", {
        name: name.trim(),
        quantity: qty.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateStaples();
      setName("");
      setQty("1");
    },
    onError: () => toast({ title: "Couldn't add item", variant: "destructive" }),
  });

  const editStapleMutation = useMutation({
    mutationFn: async ({ id, name, quantity }: { id: string; name: string; quantity: string | null }) => {
      const res = await apiRequest("PATCH", `/api/grocery-staples/${id}`, { name, quantity });
      return res.json();
    },
    onSuccess: invalidateStaples,
    onError: (err: any) => toast({ title: "Couldn't save changes", description: err?.message, variant: "destructive" }),
  });

  const deleteStapleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/grocery-staples/${id}`);
    },
    onSuccess: invalidateStaples,
    onError: (err: any) => toast({ title: "Couldn't remove item", description: err?.message, variant: "destructive" }),
  });

  const addToListMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/grocery-staples/${id}/add-to-list`, {});
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
      const staple = staples.find((s) => s.id === id);
      toast({ title: `Added "${staple?.name ?? "item"}" to your list` });
    },
    onError: () => toast({ title: "Failed to add to list", variant: "destructive" }),
  });

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full"
        data-testid="toggle-staples-section"
      >
        <div className="text-left">
          <h4 className="font-semibold text-foreground text-sm">Frequently Purchased Items</h4>
          <p className="text-xs text-muted-foreground">Items you always want on the list — add them any time.</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) addStapleMutation.mutate(); }}
            className="flex items-center gap-2"
            data-testid="add-staple-form"
          >
            <QtyStepper value={qty} onChange={setQty} testId="new-staple-qty" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item (e.g. milk)"
              className="flex-1 min-w-0"
              style={{ scrollMarginTop: "calc(6rem + env(safe-area-inset-top, 0px))" }}
              data-testid="new-staple-name"
            />
            <Button type="submit" size="sm" disabled={!name.trim() || addStapleMutation.isPending}>
              <Plus className="w-4 h-4" />
            </Button>
          </form>

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-2">Loading…</p>
          ) : staples.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">Things you buy every week — add to any list in one tap.</p>
          ) : (
            <ul className="space-y-1">
              {staples.map((s) => (
                <StapleRow
                  key={s.id}
                  staple={s}
                  onEdit={(name, quantity) => editStapleMutation.mutate({ id: s.id, name, quantity })}
                  onAddToList={() => addToListMutation.mutate(s.id)}
                  addToListPending={addToListMutation.isPending}
                  onDelete={async () => { if (await confirmDialog({ title: `Remove "${s.name}" from frequently purchased items?`, confirmLabel: "Remove" })) deleteStapleMutation.mutate(s.id); }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function StapleRow({
  staple,
  onEdit,
  onAddToList,
  addToListPending,
  onDelete,
}: {
  staple: GroceryStaple;
  onEdit: (name: string, quantity: string | null) => void;
  onAddToList: () => void;
  addToListPending: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(staple.name);
  const [editQtyNum, setEditQtyNum] = useState("1");
  const [editQtyUnit, setEditQtyUnit] = useState("");
  const armedRef = useRef(false);
  const rowTestId = `staple-${staple.id}`;

  const startEdit = () => {
    const { num, unit } = splitQuantity(staple.quantity);
    setEditName(staple.name);
    setEditQtyNum(num);
    setEditQtyUnit(unit);
    armedRef.current = false;
    setEditing(true);
  };

  const saveEdit = () => {
    const trimmed = editName.trim();
    if (!trimmed) { setEditing(false); return; }
    const nextQty = staple.quantity === null && !editQtyUnit ? null : joinQuantity(editQtyNum, editQtyUnit);
    if (trimmed !== staple.name || nextQty !== staple.quantity) {
      onEdit(trimmed, nextQty);
    }
    setEditing(false);
  };

  // Blur must only count as "done editing" when focus leaves the whole row.
  // Putting onBlur on the name input alone meant tapping the +/- steppers or
  // the check button (both inside the row) blurred the field first, closing
  // edit mode before their own click could land — the reported "pressing +
  // or - exits and doesn't adjust the quantity."
  // Deferred rather than reading e.relatedTarget: React also fires blur when
  // the currently-focused node is simply unmounted (clicking the pencil
  // removes it as edit mode opens), and that blur carries relatedTarget:
  // null — indistinguishable from a real tap outside. Checking
  // document.activeElement on the next tick instead lets focus settle first,
  // so opening the editor doesn't immediately close it again.
  const handleRowBlur = () => {
    // Only treat blur as "done" once focus has actually landed inside the row
    // (onFocus arms it). Opening the editor unmounts the pencil button that
    // was focused, and React reports that as a blur with relatedTarget: null
    // — arming on focus first is what tells a real tap-outside apart from it.
    if (!armedRef.current) return;
    window.setTimeout(() => {
      // Resolved from the DOM rather than a React ref: motion.li doesn't
      // reliably hand back the underlying node here, and a null ref would
      // silently read as "focus left the row" — closing the editor on the
      // very interaction (+/-, the check button) that should keep it open.
      if (document.activeElement?.closest(`[data-testid="${rowTestId}"]`)) return;
      saveEdit();
    }, 0);
  };

  if (editing) {
    return (
      <li onFocus={() => { armedRef.current = true; }} onBlur={handleRowBlur} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/40" data-testid={`staple-${staple.id}`}>
        <QtyStepper value={editQtyNum} onChange={setEditQtyNum} testId={`edit-staple-qty-${staple.id}`} />
        <Input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          className="flex-1 min-w-0 h-8"
          data-testid={`edit-staple-name-${staple.id}`}
        />
        <Button type="button" variant="ghost" size="icon" onClick={saveEdit} className="h-7 w-7 text-muted-foreground hover:text-foreground" data-testid={`save-staple-edit-${staple.id}`}>
          <Check className="w-4 h-4" />
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 group" data-testid={`staple-${staple.id}`}>
      <div className="flex-1 min-w-0 text-sm cursor-pointer" onClick={startEdit} data-testid={`staple-name-${staple.id}`}>
        <span className="font-medium">{staple.name}</span>
        {staple.quantity && <span className="text-xs text-muted-foreground ml-2">({staple.quantity})</span>}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={startEdit}
        className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
        data-testid={`edit-staple-${staple.id}`}
      >
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs shrink-0"
        onClick={onAddToList}
        disabled={addToListPending}
        data-testid={`add-staple-to-list-${staple.id}`}
      >
        Add to list
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label={`Remove ${staple.name} from frequently purchased items`}
        title={`Remove ${staple.name}`}
        className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
        data-testid={`delete-staple-${staple.id}`}
      >
        <X className="w-4 h-4" />
      </Button>
    </li>
  );
}

function GroceryRow({
  row,
  onToggle,
  onDelete,
  onSetAisle,
  onEdit,
}: {
  row: MergedGroceryRow;
  onToggle: (checked: boolean) => void;
  onDelete?: () => void;
  onSetAisle?: (aisle: string) => void;
  onEdit?: (name: string, quantity: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(row.name);
  const [editQtyNum, setEditQtyNum] = useState("1");
  const [editQtyUnit, setEditQtyUnit] = useState("");
  const armedRef = useRef(false);
  const rowTestId = `grocery-item-${row.key}`;

  const startEdit = () => {
    const { num, unit } = splitQuantity(row.quantity);
    setEditName(row.name);
    setEditQtyNum(num);
    setEditQtyUnit(unit);
    armedRef.current = false;
    setEditing(true);
  };

  const saveEdit = () => {
    const trimmed = editName.trim();
    if (!trimmed) { setEditing(false); return; }
    // A row that genuinely had no quantity keeps having none unless the
    // stepper was actually touched — otherwise merely opening the editor
    // would stamp "1" onto every unquantified item.
    const nextQty = row.quantity === null && !editQtyUnit && editQtyNum === "1" ? null : joinQuantity(editQtyNum, editQtyUnit);
    if (trimmed !== row.name || nextQty !== row.quantity) {
      onEdit?.(trimmed, nextQty);
    }
    setEditing(false);
  };

  // See StapleRow: blur only ends editing when focus leaves the entire row,
  // so the +/- steppers and the check button can't cancel it out from under
  // themselves.
  const handleRowBlur = () => {
    // Only treat blur as "done" once focus has actually landed inside the row
    // (onFocus arms it). Opening the editor unmounts the pencil button that
    // was focused, and React reports that as a blur with relatedTarget: null
    // — arming on focus first is what tells a real tap-outside apart from it.
    if (!armedRef.current) return;
    window.setTimeout(() => {
      // Resolved from the DOM rather than a React ref: motion.li doesn't
      // reliably hand back the underlying node here, and a null ref would
      // silently read as "focus left the row" — closing the editor on the
      // very interaction (+/-, the check button) that should keep it open.
      if (document.activeElement?.closest(`[data-testid="${rowTestId}"]`)) return;
      saveEdit();
    }, 0);
  };

  if (editing) {
    return (
      <motion.li
        layout
        layoutId={row.key}
        onFocus={() => { armedRef.current = true; }}
        onBlur={handleRowBlur}
        className="flex items-center gap-2 py-2 px-2 rounded-md bg-muted/40"
        data-testid={`grocery-item-${row.key}`}
      >
        <QtyStepper value={editQtyNum} onChange={setEditQtyNum} testId={`edit-grocery-qty-${row.key}`} />
        <Input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          className="flex-1 min-w-0 h-8"
          data-testid={`edit-grocery-name-${row.key}`}
        />
        <Button type="button" variant="ghost" size="icon" onClick={saveEdit} className="h-7 w-7 text-muted-foreground hover:text-foreground" data-testid={`save-grocery-edit-${row.key}`}>
          <Check className="w-4 h-4" />
        </Button>
      </motion.li>
    );
  }

  return (
    <motion.li
      layout
      layoutId={row.key}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ layout: { duration: 0.3, ease: "easeOut" }, opacity: { duration: 0.2 } }}
      className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors group"
      data-testid={`grocery-item-${row.key}`}
    >
      <Checkbox
        checked={row.isChecked}
        onCheckedChange={(v) => onToggle(v === true)}
        data-testid={`grocery-checkbox-${row.key}`}
      />
      <div
        className={`flex-1 min-w-0 ${row.isChecked ? "line-through text-muted-foreground" : ""} ${onEdit ? "cursor-pointer" : ""}`}
        onClick={onEdit ? startEdit : undefined}
        data-testid={`grocery-name-${row.key}`}
      >
        <span className="text-sm font-medium">{row.name}</span>
        {row.quantity && (
          <span className="text-xs text-muted-foreground ml-2">({row.quantity})</span>
        )}
        {row.fromMeals && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-2 px-1.5 py-0.5 rounded bg-muted">
            meals
          </span>
        )}
      </div>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={startEdit}
          className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
          data-testid={`edit-grocery-${row.key}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      )}
      {onSetAisle && (
        <Select value={row.aisle} onValueChange={onSetAisle}>
          <SelectTrigger
            className="h-7 w-auto max-w-[5.5rem] sm:max-w-none truncate text-[11px] px-2 opacity-60 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 gap-1 border-none bg-transparent text-muted-foreground"
            data-testid={`aisle-select-${row.key}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AISLE_ORDER.map((aisle) => (
              <SelectItem key={aisle} value={aisle} className="text-xs">
                {aisle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {onDelete && row.manual && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label={`Remove ${row.name} from the grocery list`}
          title={`Remove ${row.name}`}
          className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive h-7 w-7"
          data-testid={`delete-grocery-${row.key}`}
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </motion.li>
  );
}
