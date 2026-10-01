import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { MealsView } from "@/components/meals-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Dated relative to today on purpose. A hardcoded date silently stops
// rendering the moment the week rolls over — MealsView defaults its week
// anchor to the CURRENT week, so a fixed date falls off the grid and the test
// fails with a "can't find the meal" timeout that looks like an app bug.
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
    { id: "i2", mealId: "m1", item: "Ground beef", quantity: "1", displayOrder: 1 },
  ],
};

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/meals": [meal], "/api/saved-meals": [] }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <MealsView selectedDate={today} profiles={[] as any} />
    </QueryClientProvider>
  );
}
