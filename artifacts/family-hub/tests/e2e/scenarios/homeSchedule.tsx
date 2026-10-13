import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Today's calendar for a family of four: Ava's practice, a night for both
// parents, a family movie, and a time that is only in Dad's email. Dad has a
// dentist appointment tomorrow.
const profiles = [
  { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#7c5cbf" },
  { id: "mom", name: "Mom", initials: "M", color: "#e07a5f", role: "adult" },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
];

function at(daysAhead: number, hour: number): Date {
  const when = new Date();
  when.setDate(when.getDate() + daysAhead);
  when.setHours(hour, 0, 0, 0);
  return when;
}

const event = (id: string, title: string, start: Date, hours: number, profileIds: string[]) => ({
  id, userId: "u1", title,
  startTime: start.toISOString(), endTime: new Date(start.getTime() + hours * 3_600_000).toISOString(),
  description: null, location: null, profileIds, drivingProfileIds: [],
  isAllDay: false, source: null, recurrenceType: null, recurrenceEndDate: null, calendarId: null, calendarName: null,
});

const events = [
  event("soccer", "Soccer practice", at(0, 17), 1, ["kid1"]),
  event("pt", "Parent-teacher night", at(0, 18), 1, ["mom", "dad"]),
  event("movie", "Family movie night", at(0, 19), 2, ["all"]),
  event("dentist", "Dentist", at(1, 10), 1, ["dad"]),
];

const chores = [
  {
    id: "pic", userId: "u1", title: "Picture day", icon: "✅", points: 0, isActive: true, isBonus: false,
    targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null, endDate: null, parentChoreId: null,
    category: "school_email", profileIds: ["dad"], displayOrder: 0, createdAt: new Date().toISOString(),
    description: `From: office@school.org\nPlan: todo\nRef: pic\nSender: Front Office\nSent: ${new Date().toISOString()}\nMail: gmail:dad:m9\nPhotos start at 8:30 AM in the gym.`,
  },
];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": profiles,
      "/api/events": () => ok(events),
      "/api/chores": () => ok(chores),
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
