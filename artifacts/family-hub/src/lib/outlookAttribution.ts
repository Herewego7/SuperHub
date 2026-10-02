/**
 * Who an Outlook event belongs to.
 *
 * Settings → Calendar lets a family set "Assign to:" on each Outlook calendar,
 * but until 2026-09-30 both the Home and Calendar views ignored it and gave
 * every Outlook event to the person whose account it came from. The server
 * already tags each event with the calendar it was read from; this uses it.
 *
 * Import-free on purpose, so it can be unit tested.
 */
export interface AssignmentLike {
  calendarId: string;
  calendarType: string;
  profileId: string;
  audienceProfileIds?: string[] | null;
  watched?: boolean | null;
  isActive?: boolean | null;
}

export function assignmentProfileIds(assignment: Pick<AssignmentLike, "profileId" | "audienceProfileIds">): string[] {
  const audience = (assignment.audienceProfileIds ?? []).filter((id) => id.length > 0);
  return audience.length > 0 ? audience : [assignment.profileId];
}

export function outlookEventProfileIds(
  event: { calendar?: { id?: string } | null },
  connectedProfileId: string,
  assignments: readonly AssignmentLike[],
  knownProfileIds?: ReadonlySet<string>,
): string[] {
  const calendarId = event.calendar?.id;
  if (calendarId) {
    const a = assignments.find((x) => x.calendarType === "outlook" && x.calendarId === calendarId);
    // A deleted person leaves a stale assignment behind; don't hand the
    // event to someone who no longer exists.
    if (a) {
      const people = assignmentProfileIds(a).filter((id) => !knownProfileIds || knownProfileIds.has(id));
      if (people.length > 0) return people;
    }
  }
  return [connectedProfileId];
}

export function withoutUnwatched<T extends { googleCalendarId?: string | null; outlookCalendarId?: string | null }>(
  events: T[],
  assignments: readonly Pick<AssignmentLike, "calendarId" | "watched" | "isActive">[],
): T[] {
  const off = new Set(
    assignments.filter((assignment) => assignment.isActive !== false && assignment.watched === false).map((assignment) => assignment.calendarId),
  );
  if (off.size === 0) return events;
  return events.filter((event) => {
    const id = event.googleCalendarId || event.outlookCalendarId;
    return !id || !off.has(id);
  });
}
