import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearTenantState } from "@/lib/clearTenantState";
import {
  ACCOUNT_SWITCH_CLEANUP_TIMEOUT_MS,
  isAccountSwitch,
  readLastAccountId,
  runAccountSwitchCleanup,
  writeLastAccountId,
} from "@/lib/tenantState";

// One cleanup per account, however many times the gate renders or remounts.
const inFlight = new Map<string, Promise<void>>();

/**
 * Hold the app back while the previous account's data is cleared off this
 * device. Returns true once it is safe to mount the app for `userId`.
 *
 * Runs BEFORE anything loads, so the new account loads exactly once. The old
 * version cleared after the app had mounted, which threw away the first load
 * and fetched everything again — and the clear-up could cancel the new
 * account's freshly scheduled medication reminders.
 */
export function useAccountSwitchGate(userId: string | null): boolean {
  const queryClient = useQueryClient();
  const [, rerender] = useState(0);
  const switching = !!userId && isAccountSwitch(readLastAccountId(), userId);

  useEffect(() => {
    if (!userId) return;
    if (!isAccountSwitch(readLastAccountId(), userId)) {
      if (readLastAccountId() !== userId) writeLastAccountId(userId);
      return;
    }
    let cancelled = false;
    let run = inFlight.get(userId);
    if (!run) {
      run = runAccountSwitchCleanup({
        cleanup: () => clearTenantState(queryClient, { preserveAuthUser: true }),
        recordAccount: () => writeLastAccountId(userId),
        timeoutMs: ACCOUNT_SWITCH_CLEANUP_TIMEOUT_MS,
      }).finally(() => inFlight.delete(userId));
      inFlight.set(userId, run);
    }
    void run.then(() => {
      if (!cancelled) rerender((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, queryClient]);

  return !switching;
}
