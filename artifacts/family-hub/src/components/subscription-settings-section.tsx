import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSubscriptionStatus, trialDaysLeft, graceDaysLeft } from "@/hooks/use-subscription";
import { openManageSubscriptionPage } from "@/lib/subscriptionLinks";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  isNativePurchaseAvailable,
  purchaseSubscription,
  restorePurchases,
  getSubscriptionProduct,
  type ProductInfo,
} from "@/lib/storeKitPurchase";
import { SubscriptionTerms } from "@/components/subscription-terms";

// Free-trial-then-subscribe (2026-08 launch plan). Reads the same
// EntitlementDecision the backend enforces from — never re-derives it — so
// this can never show something that disagrees with what's actually being
// enforced. Shown regardless of platform (web visitors can still see their
// status), but "Subscribe Now"/"Restore Purchases" (the actual native
// StoreKit purchase flow) only ever render on the iOS app — there's no web
// checkout for this app, per the plan's own "website just encourages the
// App Store" decision. Web visitors still see "Manage Subscription", which
// deep-links to Apple's own subscription-management page.
export function SubscriptionSettingsSection() {
  const { data: status, isLoading } = useSubscriptionStatus();
  const { user } = useAuth();
  const { toast } = useToast();
  const daysLeft = trialDaysLeft(status);
  const graceLeft = graceDaysLeft(status);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const native = isNativePurchaseAvailable();

  // The real, localized price straight from StoreKit rather than a number
  // typed in here — App Store Connect is the only place a price should live,
  // and a hardcoded one silently goes wrong in every other currency and the
  // moment the price changes.
  const [product, setProduct] = useState<ProductInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSubscriptionProduct().then((p) => { if (!cancelled) setProduct(p); });
    return () => { cancelled = true; };
  }, []);

  const handlePurchase = async () => {
    if (!user?.id || busy) return;
    setBusy("purchase");
    try {
      const result = await purchaseSubscription(user.id);
      if (result.status === "success") {
        toast({ title: result.entitled ? "You're subscribed!" : "Purchase recorded", description: result.entitled ? "Thanks for subscribing to Family Hub+." : "We're still confirming this with Apple — check back in a moment." });
        queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      } else if (result.status === "pending") {
        toast({ title: "Purchase pending", description: "This purchase needs approval (e.g. Ask to Buy) before it completes." });
      } else if (result.status === "cancelled") {
        // User backed out of the native sheet — no toast needed.
      } else {
        toast({ title: "Couldn't complete purchase", description: result.message, variant: "destructive" });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy("restore");
    try {
      const result = await restorePurchases();
      if (result.status === "success") {
        toast({ title: result.entitled ? "Subscription restored" : "Nothing to restore", description: result.entitled ? "Your existing subscription is now active on this device." : "No active subscription was found for this Apple ID." });
        queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      } else {
        toast({ title: "Couldn't restore purchases", description: (result as any).message, variant: "destructive" });
      }
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !status) {
    return <div className="text-sm text-muted-foreground">Loading subscription status…</div>;
  }

  let headline: string;
  let detail: string;
  switch (status.reason) {
    case "comped":
      if (status.coveredByFamily) {
        headline = "Covered by your family";
        detail = "Someone in your family has complimentary access, so everything is unlocked for everyone.";
      } else {
        headline = "You have free access";
        detail = "Your account has been given complimentary access — nothing to pay, ever.";
      }
      break;
    case "trialing":
      headline = daysLeft !== null && daysLeft <= 1 ? "Your free trial ends tomorrow" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial`;
      detail = "You won't be charged until your trial ends. Subscribe any time to keep everything running smoothly afterward.";
      break;
    case "apple_active":
      // The household may be covered by someone ELSE's subscription — saying
      // "you're subscribed" to a spouse who never bought anything sends them
      // looking for a charge on their card that isn't there.
      if (status.coveredByFamily) {
        headline = "Covered by your family's subscription";
        detail = "Someone in your family is subscribed, so everything is unlocked for everyone. Only they can change or cancel it.";
      } else {
        headline = "You're subscribed to Family Hub+";
        detail = "Manage your billing, change plans, or cancel any time from the App Store.";
      }
      break;
    case "grace":
      headline = graceLeft !== null && graceLeft <= 1
        ? "Your family's access ends tomorrow"
        : `Your family's access ends in ${graceLeft} days`;
      detail = "The member who was subscribed has left your family. Subscribe to keep Snap a Recipe, Import Recipe from URL, redeeming rewards, and cashing out stars. Everything you've already earned is safe either way.";
      break;
    case "expired":
      headline = "Your free trial has ended";
      detail = "Subscribe to keep using Snap a Recipe, Import Recipe from URL, redeeming rewards, and cashing out stars. Everything you've already earned is safe either way.";
      break;
    default:
      headline = "Subscription";
      detail = "";
  }

  // "Subscribe Now" only makes sense while there's genuinely nothing active
  // yet (trialing or expired) — once comped or already subscribed via
  // Apple, there's nothing new to purchase.
  // "grace" belongs here: a household whose payer just left is precisely the
  // case where someone needs to be able to buy. Anything covered by another
  // member is excluded — there is nothing for this account to purchase, and
  // offering it invites a second, duplicate subscription for one family.
  const canSubscribe =
    native &&
    !status.coveredByFamily &&
    (status.reason === "trialing" || status.reason === "expired" || status.reason === "grace");

  return (
    <div className="space-y-3" data-testid="subscription-settings-section">
      <div>
        <div className="font-medium text-foreground" data-testid="subscription-headline">{headline}</div>
        {detail && <p className="text-sm text-muted-foreground mt-1">{detail}</p>}
      </div>
      {/* App Review Guideline 3.1.2 requires the price, the billing period,
          that it auto-renews, and links to the terms and privacy policy to be
          visible AT the point of purchase — not buried in App Store Connect.
          Rendered above the button for exactly that reason. */}
      {canSubscribe && <SubscriptionTerms product={product} />}
      {/* Full-width rows, stacked — the shape every other control in Settings
          uses (the "Who is this device for?" select, Replay setup walkthrough,
          Sign out). These were `flex flex-wrap` with `size="sm"`, so they sat
          as small chips against a card built for full-width rows and read as
          a different kind of control (2026-09-30). Default size, not sm, so
          the height matches those neighbours too. */}
      <div className="grid gap-2">
        {canSubscribe && (
          <Button
            className="w-full"
            onClick={handlePurchase}
            disabled={busy !== null}
            data-testid="subscribe-now-button"
          >
            {busy === "purchase" ? "Subscribing…" : "Subscribe Now"}
          </Button>
        )}
        {/* ⚠️ "Restore Purchases" keeps its full label, deliberately. App
            Review requires a restore mechanism and that is the wording
            reviewers look for, so it is the last label in the app worth
            shortening to win a few pixels — which a two-up row briefly did
            (2026-09-30). Full width, like the primary above. */}
        {native ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleRestore}
            disabled={busy !== null}
            data-testid="restore-purchases-button"
          >
            {busy === "restore" ? "Restoring…" : "Restore Purchases"}
          </Button>
        ) : null}
      </div>
      {/* Manage subscription is NAVIGATION, not an action: it leaves the app
          for account.apple.com. Same full-width row as its neighbours so the
          section keeps one grid, but ghost rather than outline, so the button
          worth pressing is not competing with the way out. It stays a real
          button at full height rather than a text link — this is also the
          route to CANCELLING, and Apple takes a dim view of cancellation
          being hard to find. */}
      <Button
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={openManageSubscriptionPage}
        data-testid="manage-subscription-button"
      >
        Manage subscription
      </Button>
      {!native && (status.reason === "trialing" || status.reason === "expired") && (
        <p className="text-xs text-muted-foreground">
          Subscribing is only available in the iPhone/iPad app — open Family Hub+ on your device to subscribe.
        </p>
      )}
    </div>
  );
}
