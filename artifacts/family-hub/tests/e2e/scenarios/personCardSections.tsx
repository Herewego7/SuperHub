import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PersonCard } from "@/components/people-view";
import { installMockApi, baselineRoutes } from "../mockApi";

const profile = { id: "kid", name: "Jett", initials: "J", color: "#22c55e" } as any;

const today = new Date();
const dow = today.getDay();

// A person's card with several sections side by side — used to compare the
// section HEADINGS against one another (their glyph must be the same colour
// as the heading text beside it), as well as the overflow behaviour the
// fixture was originally written for.
//
// Two regular chores due today, so the Chores section renders real rows —
// the top one is what gets clipped when the section keeps overflow-hidden.
const chores = [
  { id: "c1", userId: "u1", title: "Make bed", taskType: "chore", isBonus: false,
    profileIds: ["kid"], daysOfWeek: [dow], recurrenceType: "weekly", targetCount: 0,
    points: 2, isActive: true, icon: "🛏️", description: null, endDate: null, displayOrder: 0 },
  { id: "c2", userId: "u1", title: "Feed the dog", taskType: "chore", isBonus: false,
    profileIds: ["kid"], daysOfWeek: [dow], recurrenceType: "weekly", targetCount: 0,
    points: 2, isActive: true, icon: "🐕", description: null, endDate: null, displayOrder: 1 },
] as any;

const healthReminders = [
  { id: "h1", userId: "u1", profileId: "kid", title: "Allergy tablet", type: "medication",
    scheduleJson: { kind: "daily", time: "08:00" }, isPaused: false, notes: null, dosage: "1 tablet" },
] as any;

export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/chores": chores,
    "/api/chore-completions": [],
    "/api/health-reminders": healthReminders,
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ padding: 12 }}>
        <PersonCard
          profile={profile}
          allProfiles={[profile]}
          selectedDate={today}
          events={[] as any}
          chores={chores}
          choreCompletions={[] as any}
          dailyContent={[] as any}
          dailyAssignments={[] as any}
          dailyCompletions={[] as any}
          showEvents={false}
          showNotes={false}
          showPastEvents={false}
        />
      </div>
    </QueryClientProvider>
  );
}
