/**
 * Which calendar assignments one family may see, and which rows a
 * reassignment is allowed to deactivate.
 *
 * `calendar_assignments` has no userId column — it hangs off `profileId` — so
 * both answers come from the profile's family. Extracted here so the rules can
 * be tested without a database: every case below needs two families, which is
 * exactly what production has none of.
 */

export interface ScopedAssignment {
  profileId: string;
  calendarId: string;
  calendarType: string;
  isActive: boolean | null;
}

/**
 * The family-wide view. Mirrors `getCalendarAssignmentsByUser`'s join.
 *
 * The route this replaces returned every family's rows — calendar names, real
 * email addresses and profile ids — to any signed-in caller who omitted the
 * `profileId` query parameter.
 */
export function assignmentsVisibleToFamily<T extends ScopedAssignment>(
  all: T[],
  profileFamily: Map<string, string>,
  userId: string,
): T[] {
  return all.filter((a) => a.isActive && profileFamily.get(a.profileId) === userId);
}

/**
 * One calendar, many people. The saved row keeps a single calendar id.
 * `profileId` is the first person, which is what the existing unique key uses.
 * `audienceProfileIds` is the full list.
 */
export function calendarIsWritable(
  assignments: { calendarId: string; watched?: boolean | null; isActive?: boolean | null }[],
  calendarId: string,
): boolean {
  const row = assignments.find((assignment) => assignment.calendarId === calendarId && assignment.isActive !== false);
  if (!row) return true;
  return row.watched !== false;
}

export function assignPeopleToCalendar(calendarId: string, profileIds: string[]) {
  const audienceProfileIds = [...new Set(profileIds.filter((id) => id.length > 0))];
  return {
    calendarId,
    profileId: audienceProfileIds[0] ?? "",
    audienceProfileIds,
  };
}

/**
 * Which rows a reassignment should deactivate.
 *
 * A calendar belongs to one profile at a time, so the previous owner's row has
 * to go — but ONLY within the same household. Calendar ids are not private:
 * two families can legitimately connect the same shared calendar (a school
 * calendar, a public holidays feed), and without the family scope one family's
 * assignment silently knocked out the other's.
 */
export function assignmentsToDeactivate<T extends ScopedAssignment>(
  all: T[],
  profileFamily: Map<string, string>,
  incoming: { profileId: string; calendarId: string; calendarType: string },
): T[] {
  const family = profileFamily.get(incoming.profileId);
  if (!family) return [];
  return all.filter(
    (a) =>
      a.isActive &&
      a.calendarId === incoming.calendarId &&
      a.calendarType === incoming.calendarType &&
      profileFamily.get(a.profileId) === family,
  );
}
