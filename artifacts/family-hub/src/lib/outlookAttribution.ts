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
    if (a && (!knownProfileIds || knownProfileIds.has(a.profileId))) return [a.profileId];
  }
  return [connectedProfileId];
}
