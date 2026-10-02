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
export function eventsOnWatchedCalendars<T extends { googleCalendarId?: string | null; outlookCalendarId?: string | null }>(
  events: T[],
  assignments: { calendarId: string; watched?: boolean | null; isActive?: boolean | null }[],
): T[] {
  const off = new Set(
    assignments
      .filter((assignment) => assignment.isActive !== false && assignment.watched === false)
      .map((assignment) => assignment.calendarId),
  );
  if (off.size === 0) return events;
  return events.filter((event) => {
    const id = event.googleCalendarId || event.outlookCalendarId;
    return !id || !off.has(id);
  });
}

/** A new event with a family calendar is written once, on the account that connected it. */
export function familyCalendarWriter(
  calendarId: string | null | undefined,
  assignments: { profileId: string; calendarId: string; calendarType: string; isActive?: boolean | null }[],
): { profileId: string; provider: "google" | "outlook" } | null {
  const id = calendarId?.trim();
  if (!id || id === "none") return null;
  const row = assignments.find((assignment) => assignment.calendarId === id && assignment.isActive !== false);
  if (!row || (row.calendarType !== "google" && row.calendarType !== "outlook")) return null;
  return { profileId: row.profileId, provider: row.calendarType };
}

type CalendarAccount = {
  profileId: string;
  provider: "google" | "outlook";
  isActive?: boolean | null;
  calendarIds?: string[] | null;
  writeCalendarId?: string | null;
};

/** The account that can write this calendar. "Who it's for" may be a child, and a child has no connection. */
export function calendarTokenOwner(
  calendarId: string,
  provider: "google" | "outlook",
  owners: CalendarAccount[],
  fallbackProfileId = "",
): string | null {
  const same = owners.filter((owner) => owner.provider === provider && owner.isActive !== false);
  const write = same.find((owner) => owner.writeCalendarId === calendarId);
  if (write) return write.profileId;
  const listed = same.find((owner) => owner.calendarIds?.includes(calendarId));
  if (listed) return listed.profileId;
  const open = same.filter((owner) => owner.calendarIds == null);
  if (open.length === 1) return open[0].profileId;
  return fallbackProfileId || null;
}

export function familyCalendarAccount(
  calendarId: string | null | undefined,
  assignments: { profileId: string; calendarId: string; calendarType: string; isActive?: boolean | null }[],
  owners: CalendarAccount[],
): { profileId: string; provider: "google" | "outlook" } | null {
  const id = calendarId?.trim();
  if (!id || id === "none") return null;
  const hinted = familyCalendarWriter(id, assignments);
  const providers = hinted ? [hinted.provider] : (["google", "outlook"] as const);
  for (const provider of providers) {
    const profileId = calendarTokenOwner(id, provider, owners, hinted?.provider === provider ? hinted.profileId : "");
    if (profileId) return { profileId, provider };
  }
  return hinted;
}

export function familyCalendarCreates<T extends { profileId: string; provider: string }>(
  creates: T[],
  writer: { profileId: string; provider: "google" | "outlook" } | null,
): T[] {
  if (!writer) return creates;
  return creates.filter((item) => item.profileId === writer.profileId && item.provider === writer.provider);
}

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
