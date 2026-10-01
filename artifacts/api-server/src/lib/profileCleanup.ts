/**
 * Decides what deleteProfile (storage.ts) should do to a single chore/event
 * row's `profileIds` array when a profile is being deleted. Extracted into
 * its own pure, exported function specifically so it can be unit-tested in
 * isolation — this exact decision was the site of a real, shipped bug
 * (2026-08-20): filtering the deleted profile's id out of an ALREADY-EMPTY
 * array (an open bonus chore's normal "everyone can claim it" state, not
 * "unassigned") is still empty, which the old inline code mistook for "now
 * orphaned, delete it" — wrongly deleting shared chores that were never
 * scoped to the profile being deleted, and that other profiles may have
 * already completed (triggering a foreign-key violation from their
 * chore_completions rows and failing the whole profile delete).
 *
 * The fix: only act on a row if the profile being removed actually appears
 * in its ORIGINAL profileIds. Everything else (already-open/shared rows,
 * rows solely assigned to other profiles) is left completely untouched.
 */
export type ProfileIdCleanupDecision =
  | { action: "skip" }
  | { action: "delete" }
  | { action: "update"; profileIds: string[] };

export function decideProfileIdCleanup(
  originalProfileIds: string[] | null | undefined,
  profileIdBeingRemoved: string,
): ProfileIdCleanupDecision {
  const original = originalProfileIds || [];
  if (!original.includes(profileIdBeingRemoved)) return { action: "skip" };
  const updated = original.filter((pid) => pid !== profileIdBeingRemoved);
  return updated.length === 0 ? { action: "delete" } : { action: "update", profileIds: updated };
}
