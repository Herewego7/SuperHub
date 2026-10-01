/** A dinner written while the household switch is on. Breakfast and lunch stay off the calendar. */

export function dinnerEventInsert(
  meal: { date: string; slot: string; name: string },
  familyCalendarId: string | null | undefined,
  enabled: boolean,
): {
  title: string;
  startTime: Date;
  endTime: Date;
  profileIds: string[];
  drivingProfileIds: string[];
  calendarId: string | null;
  source: "meal";
} | null {
  if (!enabled || meal.slot !== "dinner" || !meal.name.trim()) return null;
  const start = new Date(`${meal.date}T18:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setHours(19, 0, 0, 0);
  const calendarId = familyCalendarId?.trim();
  return {
    title: meal.name.trim(),
    startTime: start,
    endTime: end,
    profileIds: [],
    drivingProfileIds: [],
    calendarId: !calendarId || calendarId === "none" ? null : calendarId,
    source: "meal",
  };
}

export function dinnerEventDay(start: Date | string): string {
  const at = new Date(start);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

type MealSpot = { date: string; slot: string; name: string };
type MealEvent = { id: string; title: string; source?: string | null; startTime: Date | string };

export function matchingDinnerEvents(meal: MealSpot, events: MealEvent[]): MealEvent[] {
  return events.filter((event) => event.source === "meal" && event.title === meal.name && dinnerEventDay(event.startTime) === meal.date);
}

/** While the switch is on, the calendar copy follows a rename, a move, or a delete. Off leaves existing copies alone. */
export function dinnerCalendarChange(
  previous: MealSpot | null,
  next: MealSpot | null,
  events: MealEvent[],
  familyCalendarId: string | null | undefined,
  enabled: boolean,
): { updateId: string | null; deleteIds: string[]; create: ReturnType<typeof dinnerEventInsert> } {
  const none = { updateId: null, deleteIds: [] as string[], create: null };
  if (!enabled) return none;
  const matches = previous && previous.slot === "dinner" ? matchingDinnerEvents(previous, events) : [];
  if (!next || next.slot !== "dinner") return { updateId: null, deleteIds: matches.map((event) => event.id), create: null };
  const event = dinnerEventInsert(next, familyCalendarId, true);
  if (matches.length === 0) return { updateId: null, deleteIds: [], create: event };
  return { updateId: matches[0].id, deleteIds: matches.slice(1).map((row) => row.id), create: event };
}
