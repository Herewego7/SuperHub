/**
 * Clearing one household's state off this device.
 *
 * The decision of WHAT counts as tenant-scoped lives in tenantState.ts, which
 * is deliberately import-free so it can be unit tested — a wrong answer there
 * either leaks the previous family's data or resets a shared iPad's display
 * preferences, and both deserve a test.
 */

import type { QueryClient } from "@tanstack/react-query";
import { clearSignedObjectUrlCache } from "@/lib/signedObjectUrl";
import { cancelLocalNotifications, pendingLocalNotificationIds } from "@/lib/nativeNotifications";
import { tenantScopedKeysIn } from "@/lib/tenantState";

/**
 * Remove every trace of the current household from this device.
 *
 * Call BEFORE the sign-out completes and before any new identity becomes
 * active. Each step is independently guarded: a failure in one must not stop
 * the others, because a half-cleared device is the exact state this exists to
 * prevent.
 */
export async function clearTenantState(
  queryClient: QueryClient,
  opts: { preserveAuthUser?: boolean } = {},
): Promise<void> {
  // 1. The previous family's scheduled medication reminders. FIRST, because
  //    it is the only one with a consequence outside the app: iOS fires these
  //    with no app involvement, so without this a stranger's dose reminder
  //    keeps going off on this phone indefinitely.
  try {
    const ids = await pendingLocalNotificationIds();
    if (ids.length > 0) await cancelLocalNotifications(ids);
  } catch {
    /* web, or notifications unavailable */
  }

  // 2. Signed URLs for the previous family's uploads, valid for days.
  try {
    clearSignedObjectUrlCache();
  } catch {
    /* nothing to clear */
  }

  // 3. Their data. clear() rather than invalidate: invalidation keeps the
  //    cached payload and merely marks it stale, so it still renders while
  //    the refetch is in flight — which is precisely the leak.
  //
  //    preserveAuthUser: an account switch runs this AFTER the new account is
  //    signed in. Clearing the user too would refetch it, flash a spinner and
  //    remount the app — keep the signed-in user, drop everything else.
  try {
    if (opts.preserveAuthUser) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/user" });
      queryClient.getMutationCache().clear();
    } else {
      queryClient.clear();
    }
  } catch {
    /* nothing to clear */
  }

  // 4. Their tenant-scoped localStorage, leaving device preferences alone.
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    // Collected first: removing while iterating by index skips entries.
    for (const key of tenantScopedKeysIn(keys)) localStorage.removeItem(key);
  } catch {
    /* private mode / blocked storage */
  }
}
