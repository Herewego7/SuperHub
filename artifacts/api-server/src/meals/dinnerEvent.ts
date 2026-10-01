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
