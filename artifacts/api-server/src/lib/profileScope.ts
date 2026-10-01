/**
 * Which profile IDs a household is allowed to name in a write.
 *
 * Profile UUIDs are NOT secrets — family-share responses deliberately include
 * them — so "you would have to guess it" is not a defence. Event writes
 * accepted any id: one household could create an event assigned to another's
 * profile, and two-way sync would then load that profile's Google/Outlook
 * tokens and push the event into a stranger's real calendar.
 *
 * Pure so the rule is testable without a database; the caller supplies the
 * household's own profile ids.
 */

/** IDs named in a write that do NOT belong to the household. Empty = fine. */
export function foreignProfileIds(
  named: readonly unknown[] | null | undefined,
  ownProfileIds: readonly string[],
): string[] {
  if (!named) return [];
  const own = new Set(ownProfileIds);
  const foreign: string[] = [];
  for (const id of named) {
    // A non-string is not this family's profile either. Rejecting rather than
    // ignoring it keeps "we validated every entry" literally true.
    if (typeof id !== "string" || !own.has(id)) foreign.push(String(id));
  }
  return foreign;
}

/**
 * Every profile id a single event write can name, from the several shapes the
 * routes accept — assignees plus drivers, old single-driver field and new
 * list alike. Collected in one place so a new field cannot be added to the
 * write path and quietly skip validation.
 */
export function profileIdsNamedByEventWrite(body: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  if (Array.isArray(body.profileIds)) out.push(...body.profileIds);
  if (Array.isArray(body.drivingProfileIds)) out.push(...body.drivingProfileIds);
  if (typeof body.drivingProfileId === "string" && body.drivingProfileId) {
    out.push(body.drivingProfileId);
  }
  return out;
}
