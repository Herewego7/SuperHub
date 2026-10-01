import type { ProductInfo } from "@/lib/storeKitPurchase";

/**
 * The subscription disclosure Apple requires wherever a purchase is offered
 * (App Review Guideline 3.1.2): what it's called, what it costs, how long a
 * period is, that it renews by itself, how to stop it, and links to the terms
 * and the privacy policy.
 *
 * Shared by Settings → Subscription and the upgrade dialog so the two can't
 * drift apart — a paywall that says less than the other is exactly the kind of
 * thing that comes back as a rejection.
 *
 * `product` comes from StoreKit, so the price and name are Apple's own,
 * localized to the viewer's storefront. Until it resolves (or on the web,
 * where there is no StoreKit) the wording stays honest rather than inventing a
 * number: the period and renewal terms are still stated, the price is left to
 * the App Store sheet that appears next.
 */
export function SubscriptionTerms({ product }: { product: ProductInfo | null }) {
  const name = product?.displayName || "Family Hub+ Premium";
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground space-y-1.5">
      <p className="text-foreground font-medium text-sm">
        {name}
        {product?.displayPrice ? ` — ${product.displayPrice} per month` : " — billed monthly"}
      </p>
      <p>
        Your free trial runs for 14 days. After it ends the subscription renews
        automatically each month {product?.displayPrice ? `at ${product.displayPrice}` : "at the price shown at checkout"},
        charged to your Apple Account, until you cancel.
      </p>
      <p>
        Cancel any time from Settings → Apple Account → Subscriptions on your
        device, at least 24 hours before the next renewal. Cancelling stops
        future charges; the current period is not refunded.
      </p>
      <p className="pt-0.5">
        <a href="/terms" className="underline underline-offset-2 hover:text-foreground" data-testid="link-terms">Terms of Use</a>
        {" · "}
        <a href="/privacy" className="underline underline-offset-2 hover:text-foreground" data-testid="link-privacy">Privacy Policy</a>
      </p>
    </div>
  );
}
