import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { MealsView } from "@/components/meals-view";
import { installMockApi, baselineRoutes } from "../mockApi";

// Regression coverage for the 2026-09-06 report: "when I press the + or -
// button to add more or less quantity of it, it exits and doesn't adjust the
// quantity. Also, when I edit the text for an item, it exits and doesn't
// actually adjust it."
//
// Root cause was onBlur={saveEdit} on the name input alone: the +/- steppers
// and the check button all live inside the same row, so tapping any of them
// blurred the name field FIRST, which closed edit mode (with the pre-click
// quantity) before their own click could land.

const item = {
  id: "g1",
  userId: "u1",
  name: "Beef",
  quantity: "2 lb",
  isChecked: false,
  category: null,
  sourceMealIds: [],
};

// Records what the PATCH actually sent, so the test asserts on the real
// request body rather than on optimistic UI.
(window as any).__groceryPatches = [];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/meals": [],
      "/api/saved-meals": [],
      "/api/grocery-items/aggregate": [],
      "/api/grocery-items": (_url: string, opts: RequestInit | undefined) => {
        if (opts?.method === "PATCH") {
          const body = JSON.parse((opts.body as string) || "{}");
          (window as any).__groceryPatches.push(body);
          Object.assign(item, body);
          return new Response(JSON.stringify(item), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([item]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      "/api/grocery-staples": [],
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <MealsView showGrocery selectedDate={new Date("2026-09-06T12:00:00")} profiles={[] as any} />
    </QueryClientProvider>
  );
}
