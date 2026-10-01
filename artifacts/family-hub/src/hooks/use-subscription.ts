import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { syncExistingEntitlementQuietly } from "@/lib/storeKitPurchase";
import { useAuth } from "./use-auth";

// Free-trial-then-subscribe (2026-08 launch plan). Mirrors the exact same
// EntitlementDecision shape the backend's getEntitlementDecision() returns —
// this hook is a thin read of that ONE choke point, never re-derives the
// decision client-side, so the UI and actual server-side enforcement can
// never disagree.
export interface EntitlementDecision {
  entitled: boolean;
  // "grace" is the week a household keeps access after the member who was
  // covering it leaves — see lib/familyEntitlement.ts on the server.
  reason: "enforcement_disabled" | "comped" | "trialing" | "apple_active" | "grace" | "expired" | "no_record";
  trialEndsAt: string | null;
  graceEndsAt?: string | null;
  isComped: boolean;
  /** Which member's state covers the household, when it isn't this account's. */
  grantedBy?: string | null;
  /** True when someone ELSE in the family is the reason this works. */
  coveredByFamily?: boolean;
  /** This login's own state, separate from the household's. */
  ownEntitlement?: {
    reason: "enforcement_disabled" | "comped" | "trialing" | "apple_active" | "expired" | "no_record";
    isComped: boolean;
    trialEndsAt: string | null;
  };
}

/** Days left in the post-departure grace window, or null when not in one. */
export function graceDaysLeft(status: EntitlementDecision | undefined): number | null {
  if (!status?.graceEndsAt || status.reason !== "grace") return null;
  const msLeft = new Date(status.graceEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

export function useSubscriptionStatus() {
  const { isAuthenticated } = useAuth();
  return useQuery<EntitlementDecision>({
    queryKey: ["/api/subscription/status"],
    enabled: isAuthenticated,
    // Fails open client-side too: while loading or on error, treat as
    // entitled rather than flashing a paywall before the real answer comes
    // back — the backend route itself is what actually enforces anything.
    staleTime: 5 * 60 * 1000,
  });
}

/** Days left in a trial, or null if there's no trial (comped/subscribed/none). */
export function trialDaysLeft(status: EntitlementDecision | undefined): number | null {
  if (!status?.trialEndsAt || status.reason !== "trialing") return null;
  const msLeft = new Date(status.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}


/**
 * Once per launch, link any subscription this Apple ID already owns to the
 * signed-in account.
 *
 * Without this the only thing that connected an existing purchase to an account
 * was someone tapping "Restore Purchases" — which nobody thinks to do after
 * subscribing from the App Store page, reinstalling, or signing in on a second
 * device. They had paid and were still looking at a paywall.
 *
 * Runs once per mount and only when signed in; a ref rather than state because
 * nothing renders from it and it must not cause a re-render. Silent by design —
 * see syncExistingEntitlementQuietly.
 */
export function useClaimExistingSubscription(): void {
  const { isAuthenticated } = useAuth();
  const ran = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || ran.current) return;
    ran.current = true;
    syncExistingEntitlementQuietly().then((linked) => {
      // Only invalidate when something actually changed — the common case is
      // "nothing to claim", and refetching entitlement on every launch for no
      // reason is just noise.
      if (linked) queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    });
  }, [isAuthenticated]);
}
