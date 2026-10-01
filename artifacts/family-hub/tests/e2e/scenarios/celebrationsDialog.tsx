import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CelebrationsView } from "@/components/celebrations-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
  { id: "mom", name: "Mom", initials: "M", color: "#ec4899" },
] as any;

// Mirrors the exact reported screenshot's data shape: several birthdays, one
// anniversary with a linked profile and an "18-year anniversary" style
// custom-length subtitle, and countdown badges of varying label lengths.
// One name is deliberately a single long unbroken (no-space) string — this
// is what actually reproduces the reported bug: without min-w-0 on each
// celebration Card (a grid ITEM), one un-wrappable long name drives that
// whole grid COLUMN's min width up, pushing every card — and the dialog
// itself — off the right edge, not just the long-named one.
const celebrations = [
  { id: "c1", userId: "u1", name: "Kelsey Giles", monthDay: "08-25", year: 1989, type: "birthday", customLabel: null, profileId: null, profileIds: null, notes: null, showYear: true, nextOccurrence: "2026-08-25T00:00:00.000Z", daysUntil: 1, ageThisYear: 37, giftIdeas: [], photos: [] },
  { id: "c2", userId: "u1", name: "Ben Freitag", monthDay: "08-26", year: null, type: "birthday", customLabel: null, profileId: null, profileIds: null, notes: null, showYear: true, nextOccurrence: "2026-08-26T00:00:00.000Z", daysUntil: 2, ageThisYear: null, giftIdeas: [], photos: [] },
  { id: "c3", userId: "u1", name: "Chad-and-Nay-Wedding-Anniversary-Celebration-Extravaganza-Unbreakable", monthDay: "08-29", year: 2008, type: "anniversary", customLabel: null, profileId: "dad", profileIds: ["dad"], notes: null, showYear: true, nextOccurrence: "2026-08-29T00:00:00.000Z", daysUntil: 5, ageThisYear: 18, giftIdeas: [{ id: "g1", isChecked: false }, { id: "g2", isChecked: false }], photos: [] },
  { id: "c4", userId: "u1", name: "Sam Giles", monthDay: "09-11", year: null, type: "birthday", customLabel: null, profileId: null, profileIds: null, notes: null, showYear: true, nextOccurrence: "2026-09-11T00:00:00.000Z", daysUntil: 18, ageThisYear: null, giftIdeas: [], photos: [] },
  { id: "c5", userId: "u1", name: "Rachel", monthDay: "10-02", year: null, type: "birthday", customLabel: null, profileId: null, profileIds: null, notes: null, showYear: true, nextOccurrence: "2026-10-02T00:00:00.000Z", daysUntil: 39, ageThisYear: null, giftIdeas: [], photos: [] },
];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/celebrations": celebrations,
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dialog open onOpenChange={() => {}}>
        {/* Mirrors calendar3-view.tsx's real Celebrations dialog exactly. */}
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-3xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Celebrations</DialogTitle>
          </DialogHeader>
          <CelebrationsView />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>
  );
}
