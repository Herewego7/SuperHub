import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes } from "../mockApi";

// One-off, richly-populated scenario built specifically for a full-app
// visual inventory pass (screenshotting every tab/modal). Not part of the
// permanent regression suite — deliberately loaded with data across every
// feature area (multiple profiles incl. a kid, chores of every kind, a
// multi-day event, a celebration, health reminders, notes/praise, meals,
// rewards, wishlist items, achievements, a pending cash-out, an invite, a
// long-text chore/note, and a broken calendar sync) so most screens have
// real content to screenshot rather than an empty state.

const LONG_TEXT =
  "This is a deliberately very long piece of text meant to stress-test wrapping, truncation, and overflow behavior across cards, dialogs, and list rows throughout the app — repeated repeated repeated repeated repeated repeated repeated text to make sure it really is long enough to wrap multiple lines in a narrow phone-width container.";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const todayAt = (h: number, m = 0) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
};

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": {
        id: "u1",
        email: "test@test.com",
        onboardingCompletedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      "/api/profiles": [
        { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#888" },
        { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", googleCalendarConnected: true },
        { id: "mom", name: "Mom", initials: "M", color: "#a855f7", role: "adult" },
        {
          id: "kid1",
          name: "Ava",
          initials: "A",
          color: "#ef4444",
          role: "child",
          isChild: true,
        },
        {
          id: "kid2",
          name: LONG_TEXT.slice(0, 40),
          initials: "L",
          color: "#22c55e",
          role: "child",
        },
      ],
      "/api/chores": [
        {
          id: "c1", title: "Make bed", icon: "🛏️", points: 2, taskType: "chore",
          profileIds: ["kid1"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], isActive: true,
          isBonus: false, targetCount: 0, description: null, displayOrder: 1,
        },
        {
          id: "c2", title: "Read for 20 minutes", icon: "📚", points: 3, taskType: "chore",
          profileIds: ["kid1"], daysOfWeek: [], isActive: true, isBonus: false,
          targetCount: 3, recurrenceType: "weekly", description: null, displayOrder: 2,
        },
        {
          id: "c3", title: "Clean out the garage", icon: "🧹", points: 15, taskType: "chore",
          profileIds: [], daysOfWeek: [], isActive: true, isBonus: true,
          targetCount: 0, description: "Sweep, organize tools, and take out any trash.",
          displayOrder: 3,
        },
        {
          id: "c4", title: LONG_TEXT.slice(0, 60), icon: "✅", points: 0, taskType: "todo",
          profileIds: ["kid1"], daysOfWeek: [], isActive: true, isBonus: false,
          targetCount: 0, description: null, displayOrder: 4,
        },
        {
          id: "c5", title: "Pack backpack", icon: "🎒", points: 0, taskType: "todo",
          profileIds: ["kid2"], daysOfWeek: [], isActive: true, isBonus: false,
          targetCount: 0, description: null, displayOrder: 5,
        },
        {
          id: "c6", title: "Memory verse", icon: "📖", points: 2, taskType: "memory_verse",
          profileIds: ["kid1"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], isActive: true,
          isBonus: false, targetCount: 0,
          description: "For God so loved the world... (John 3:16)", displayOrder: 6,
        },
      ],
      "/api/chore-completions": [
        { id: "cc1", choreId: "c1", profileId: "kid1", completedAt: iso(todayAt(7, 30)), points: 2 },
      ],
      "/api/events": [
        {
          // Deliberately far from "now" (not just later today) so this never
          // coincidentally lands inside the in-app "event starting soon"
          // pop-up's 15-minute window regardless of what time this script runs.
          id: "e1", title: "Soccer practice", startTime: iso(new Date(now.getTime() + 5 * 3600000)), endTime: iso(new Date(now.getTime() + 6.5 * 3600000)),
          isAllDay: false, profileIds: ["kid1"], location: "City Park", description: LONG_TEXT,
        },
        {
          id: "e2", title: "Family camping trip", startTime: iso(new Date(now.getTime())), endTime: iso(new Date(now.getTime() + 4 * 86400000)),
          isAllDay: true, profileIds: ["dad", "mom", "kid1", "kid2"], location: null, description: null,
        },
      ],
      "/api/celebrations": [
        {
          id: "cel-1", userId: "u1", name: "Ava", monthDay: "08-30", year: 2015,
          type: "birthday", customLabel: null, profileId: "kid1", profileIds: ["kid1"],
          notes: "Loves dinosaurs and chocolate cake.", showYear: true,
          nextOccurrence: iso(new Date(now.getFullYear(), 7, 30)),
          daysUntil: 8, ageThisYear: 11, giftIdeas: [{ id: "g1", text: "New bike" }], photos: [],
        },
        {
          id: "cel-2", userId: "u1", name: "Mom & Dad", monthDay: "06-12", year: 2008,
          type: "anniversary", customLabel: null, profileId: null, profileIds: [],
          notes: null, showYear: true, nextOccurrence: iso(new Date(now.getFullYear() + 1, 5, 12)),
          daysUntil: 300, ageThisYear: 18, giftIdeas: [], photos: [],
        },
      ],
      "/api/celebrations/calendar": [],
      "/api/health-reminder-events?unack=true": [
        { id: "ev1", reminderId: "r1", profileId: "kid1", scheduledAt: iso(now), firedAt: iso(now), acknowledgedAt: null },
      ],
      "/api/health-reminders?includePaused=true": [
        { id: "r1", profileId: "kid1", title: "Allergy medicine", type: "medication", dose: "1 tsp", location: "Kitchen counter", notes: "Give with food.", isPaused: false },
      ],
      "/api/health-reminders": [
        { id: "r1", profileId: "kid1", title: "Allergy medicine", type: "medication", dose: "1 tsp", isPaused: false },
      ],
      "/api/shoutouts": [
        { id: "s1", fromProfileId: "dad", toProfileId: "kid1", message: "Great job cleaning your room today! 🎉", createdAt: iso(now), seenAt: null },
      ],
      "/api/daily-content": [
        { id: "n1", type: "note", title: "Reminder", assignments: [{ profileId: "kid1" }] },
      ],
      "/api/rewards": [
        { id: "rw1", title: "Extra screen time", pointsCost: 20, scopeProfileId: null, isActive: true },
        { id: "rw2", title: LONG_TEXT.slice(0, 50), pointsCost: 50, scopeProfileId: "kid1", isActive: true },
      ],
      "/api/wishlist-items": [
        { id: "w1", profileId: "kid1", title: "New video game", status: "pending", createdAt: iso(now) },
      ],
      "/api/wallet/pending": [
        { id: "tx1", profileId: "kid1", points: 40, cents: 320, status: "pending", createdAt: iso(now) },
      ],
      "/api/points": { points: 42, balance: 42 },
      "/api/streaks": { streak: 5 },
      "/api/achievements": [
        { id: "a1", type: "streak_3", earnedAt: iso(now), profileId: "kid1" },
      ],
      "/api/family": { family: { name: "The Test Family" }, members: [{ id: "u1", email: "test@test.com" }] },
      "/api/family/invites": [
        { id: "inv1", code: "ABCD1234", email: null, role: "child", createdAt: iso(now), expiresAt: iso(new Date(now.getTime() + 5 * 86400000)) },
      ],
      "/api/location-settings": { city: "Farmington", state: "MN", timezone: "America/Chicago" },
      "/api/saved-meals": [
        { id: "sm1", name: "Spaghetti & Meatballs", notes: "Family favorite", ingredients: [{ item: "Spaghetti", quantity: "1 lb", displayOrder: 1 }] },
      ],
      "/api/meals": [
        { id: "m1", name: "Tacos", date: iso(now).slice(0, 10), slot: "dinner", notes: null, ingredients: [] },
      ],
      "/api/grocery-items": [
        { id: "gi1", name: "Milk", quantity: "1 gallon", isChecked: false, category: null },
        { id: "gi2", name: "Eggs", quantity: "1 dozen", isChecked: true, category: "Dairy & Eggs" },
      ],
      "/api/grocery-staples": [
        { id: "st1", name: "Bread", quantity: "1 loaf" },
      ],
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
