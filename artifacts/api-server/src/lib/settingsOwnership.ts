/**
 * Which per-family settings row a write should update.
 *
 * Extracted so the rule can be tested without a database, the way
 * `decideProfileIdCleanup` was pulled out of storage.ts's profile-delete
 * logic for the same reason. The bug this replaces — picking `rows[0]` and
 * stamping the caller's userId onto it — is invisible with one family in the
 * table and corrupting with two, which is precisely the shape of defect a
 * single-tenant production database can never surface.
 */
export function settingsRowForUser<T extends { id: string; userId: string | null }>(
  rows: T[],
  userId: string,
): T | undefined {
  // A row with no owner is pre-family-model debris. Never adopt it silently:
  // claiming it would hand one family whatever the other left behind.
  return rows.find((r) => r.userId === userId);
}

/**
 * Does a family have two-way calendar sync on?
 *
 * Extracted for the same reason as the function above: the rule is one
 * expression, and getting it wrong is silent.
 *
 * ⚠️ A MISSING ROW MEANS ENABLED, because that is what every other layer
 * already says:
 *   - the column is `boolean("two_way_sync_enabled").default(true)`;
 *   - the Settings toggle reads `twoWaySyncEnabled !== false`, so with no row
 *     it renders ON.
 * The server used to read `=== true`, so a family with no row saw the switch
 * ON while the server treated it as OFF and quietly dropped every event
 * before it reached Google. Reported 2026-09-28 as "I created an event and it
 * never showed up in Google Calendar", with the toggle visibly on.
 *
 * Two ways to have no row: a household whose row predates the family model
 * (its `user_id` is NULL, and `settingsRowForUser` deliberately refuses to
 * adopt it), and any new family that has never opened Calendar settings.
 *
 * This is NOT the same as the error case. An error still fails closed — see
 * isTwoWaySyncEnabled — because "the database is unreachable" is not evidence
 * of consent, whereas "no row" is a default we have already chosen three
 * times elsewhere.
 */
export function twoWaySyncFromSettings(
  settings: { twoWaySyncEnabled?: boolean | null } | undefined,
): boolean {
  return settings?.twoWaySyncEnabled !== false;
}
