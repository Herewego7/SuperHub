/**
 * Decides whether a just-replaced/cleared photo field's OLD value should be
 * deleted from object storage. Extracted into its own pure, exported
 * function so it can be unit-tested without a database — see
 * `cleanupReplacedPhoto` in objectStorage.ts, which is the thin,
 * side-effecting wrapper that actually calls `deleteObjectByPath` when this
 * returns true.
 *
 * Every upload in this app is base64 in a Postgres row (see objectStorage.ts's
 * own module comment) — there is no real object-storage bucket, so an
 * orphaned row is pure wasted database storage, not just an unreferenced
 * file sitting in cheap blob storage. Profile photos, celebration photos,
 * and wishlist item photos can all be replaced or cleared; without this,
 * every edit left the previous photo behind forever.
 */
export function shouldDeleteOldPhoto(
  oldPath: string | null | undefined,
  newPath: string | null | undefined,
): boolean {
  if (!oldPath) return false; // nothing to clean up
  if (oldPath === newPath) return false; // unchanged — the "old" value is still in use
  return true;
}
