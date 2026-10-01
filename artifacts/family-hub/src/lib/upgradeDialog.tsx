import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X } from "lucide-react";
import { isNativePurchaseAvailable, getSubscriptionProduct, type ProductInfo } from "./storeKitPurchase";
import { SubscriptionTerms } from "@/components/subscription-terms";

// Free-trial-then-subscribe (2026-08 launch plan): the shared "Upgrade to
// continue" prompt every gated action shows once its trial has genuinely
// ended. Mirrors confirmDialog.tsx's imperative pattern exactly (a single
// module-level handler + a host component mounted once near the app root) —
// so any mutation's onError can just do:
//
//   onError: (err: any) => {
//     if (err?.code === "subscription_required") { showUpgradeDialog(); return; }
//     toast({ title: err?.message, variant: "destructive" });
//   }
//
// <UpgradeDialogHost /> must be mounted once (family-hub.tsx, alongside
// <ConfirmDialogHost />). Falls back to a plain toast-free window.alert if
// somehow unmounted (isolated harnesses/tests) so a caller never silently
// no-ops.

type Handler = () => void;
let activeHandler: Handler | null = null;

export function showUpgradeDialog(): void {
  if (activeHandler) {
    activeHandler();
    return;
  }
  window.alert("Your free trial has ended. Subscribe in Settings to keep using this feature.");
}

export function UpgradeDialogHost({ onManageSubscription }: { onManageSubscription?: () => void }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSubscriptionProduct().then((p) => { if (!cancelled) setProduct(p); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    activeHandler = () => setOpen(true);
    return () => {
      activeHandler = null;
    };
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-sm relative">
        <AlertDialogHeader>
          <AlertDialogTitle>Your free trial has ended</AlertDialogTitle>
          <AlertDialogDescription>
            Subscribe to keep using this feature. Your stars and history stay safe.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* This dialog's primary button reads "Subscribe Now" on native, so
            treat it as a point of purchase and state the terms here too
            (Guideline 3.1.2) rather than only on the screen it routes to. */}
        {isNativePurchaseAvailable() && <SubscriptionTerms product={product} />}
        {/* Every other dialog in the app has an X; this one didn't, with
            nothing signalling why. Dismissing still also works via "Not now". */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="upgrade-dialog-close"
        >
          <X className="h-4 w-4" />
        </button>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="upgrade-dialog-dismiss">Not now</AlertDialogCancel>
          <AlertDialogAction
            data-testid="upgrade-dialog-manage"
            onClick={() => {
              setOpen(false);
              // Routes to Settings → Subscription either way — that's now
              // where the real "Subscribe Now" button lives (native only)
              // alongside "Manage Subscription" (always available). Just
              // the label here reflects which action someone's actually
              // about to take, so it doesn't read as "leave the app" on
              // native when there's a real in-app purchase button waiting.
              onManageSubscription?.();
            }}
          >
            {/* "See subscription options" on web, not "Manage Subscription":
                this dialog only ever shows to someone whose trial has ended,
                so there is nothing yet to manage. Native keeps "Subscribe
                Now" because there's a real in-app purchase button waiting. */}
            {isNativePurchaseAvailable() ? "Subscribe Now" : "See subscription options"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
