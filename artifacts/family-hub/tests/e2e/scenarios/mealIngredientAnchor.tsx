import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { MealsView } from "@/components/meals-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Reproduces the reported ingredient-list judder, which only happens with the
// software keyboard up. A headless browser has no keyboard, so visualViewport
// is replaced with a stand-in that reports a shrunken visible area — the same
// signal iOS gives — and ui/dialog.tsx reacts to it exactly as it does on a
// real device.
const KEYBOARD_PX = 300;

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const meal = {
  id: "m1",
  userId: "u1",
  name: "Spaghetti & meatballs",
  date: todayIso,
  slot: "dinner",
  notes: null,
  recipeUrl: null,
  directions: null,
  sourceName: null,
  importedAt: null,
  ingredients: [
    { id: "i1", mealId: "m1", item: "Spaghetti", quantity: "1", displayOrder: 0 },
  ],
};

// iOS reports a large, short-lived offsetTop while the keyboard animates.
// The stand-in exposes a hook so a test can reproduce that spike exactly.
declare global { interface Window { __vvSpike?: (px: number) => void } }

export function setup(): void {
  const listeners = new Set<() => void>();
  let offsetTop = 0;
  const fake = {
    get height() { return window.innerHeight - KEYBOARD_PX; },
    get width() { return window.innerWidth; },
    get offsetTop() { return offsetTop; },
    get offsetLeft() { return 0; },
    get pageTop() { return 0; },
    get pageLeft() { return 0; },
    get scale() { return 1; },
    addEventListener: (_t: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_t: string, fn: () => void) => { listeners.delete(fn); },
  };
  Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
  window.__vvSpike = (px: number) => {
    offsetTop = px;
    for (const fn of listeners) fn();
  };
  installMockApi(baselineRoutes({ "/api/meals": [meal], "/api/saved-meals": [] }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <MealsView selectedDate={today} profiles={[] as any} />
    </QueryClientProvider>
  );
}
