import { registerPlugin, Capacitor } from "@capacitor/core";
import { apiRequest } from "./queryClient";

// Free-trial-then-subscribe (2026-08 launch plan) — the native purchase
// half. Wraps StoreKitPurchasePlugin.swift (ios/App/App/) via the standard
// registerPlugin bridge, same pattern as webAuth.ts/appleSignIn.ts.

interface StoreKitPurchasePlugin {
  getProduct(): Promise<{ id: string; displayName: string; description: string; displayPrice: string }>;
  purchase(options: { appAccountToken?: string }): Promise<{ status: "success" | "pending"; transactionId?: string }>;
  /**
   * `sync` (default true) forces AppStore.sync(): a round trip to Apple that
   * can be slow and can prompt for an Apple ID password. Only an explicit
   * Restore Purchases tap should do that — see the Swift side.
   */
  restorePurchases(options?: { sync?: boolean }): Promise<{ status: "restored" | "none"; transactionId?: string }>;
}

const StoreKitPurchase = registerPlugin<StoreKitPurchasePlugin>("StoreKitPurchase");

/** Native purchase is only meaningful on the iOS app — there's no web checkout. */
export function isNativePurchaseAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export interface ProductInfo {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
}

/** Fetches the subscription's real price/name from Apple, for display before purchasing. */
export async function getSubscriptionProduct(): Promise<ProductInfo | null> {
  if (!isNativePurchaseAvailable()) return null;
  try {
    return await StoreKitPurchase.getProduct();
  } catch {
    return null;
  }
}

export type PurchaseResult =
  | { status: "success"; entitled: boolean }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Runs the full purchase round-trip: native StoreKit purchase sheet →
 * (on success) tell the backend via the existing /api/subscription/verify
 * route, which asks Apple's App Store Server API for the account's real
 * current state and persists it. `appAccountToken` is the signed-in
 * account's own userId (a real UUID, see subscriptionEntitlement.ts) so a
 * later webhook event can be matched back to this account even before this
 * verify call — see StoreKitPurchasePlugin.swift's own doc comment.
 */
export async function purchaseSubscription(accountId: string): Promise<PurchaseResult> {
  if (!isNativePurchaseAvailable()) {
    return { status: "error", message: "Subscribing is only available in the iPhone/iPad app." };
  }
  try {
    const result = await StoreKitPurchase.purchase({ appAccountToken: accountId });
    if (result.status === "pending") return { status: "pending" };
    if (!result.transactionId) return { status: "error", message: "Purchase completed but no transaction id was returned." };
    const res = await apiRequest("POST", "/api/subscription/verify", { transactionId: result.transactionId });
    const decision = await res.json();
    return { status: "success", entitled: !!decision.entitled };
  } catch (err: any) {
    if (err?.message === "USER_CANCELLED") return { status: "cancelled" };
    return { status: "error", message: err?.message ?? "Purchase failed. Please try again." };
  }
}

/** "Restore Purchases" — for a reinstall, a new device, or after a failed verify. */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isNativePurchaseAvailable()) {
    return { status: "error", message: "Restoring purchases is only available in the iPhone/iPad app." };
  }
  try {
    const result = await StoreKitPurchase.restorePurchases();
    if (result.status === "none" || !result.transactionId) {
      return { status: "error", message: "No previous purchase was found for this Apple ID." };
    }
    const res = await apiRequest("POST", "/api/subscription/verify", { transactionId: result.transactionId });
    const decision = await res.json();
    return { status: "success", entitled: !!decision.entitled };
  } catch (err: any) {
    return { status: "error", message: err?.message ?? "Restore failed. Please try again." };
  }
}

/**
 * Claim, silently, any subscription this Apple ID already owns.
 *
 * Streamlined Purchasing lets someone subscribe straight from the App Store
 * product page, without the app ever running — so no `appAccountToken` is set
 * and the server has nothing to match the transaction to. Until this existed,
 * the only thing that linked such a purchase to an account was the person
 * happening to tap "Restore Purchases" in Settings; before that they had paid
 * and were still locked out. The same gap applied to a reinstall or a second
 * device.
 *
 * Deliberately quiet: no toasts, no thrown errors. "No purchase found" is the
 * normal answer for almost everyone, and a network blip on launch must never
 * surface as a failure — the button in Settings is still there for anyone who
 * needs to force it.
 *
 * Returns whether anything was actually linked, so the caller can refresh the
 * entitlement it already holds instead of guessing.
 */
export async function syncExistingEntitlementQuietly(): Promise<boolean> {
  if (!isNativePurchaseAvailable()) return false;
  try {
    // sync: false — this runs automatically on every launch, and Apple's rule
    // is that AppStore.sync() is for an explicit user action only. Forcing it
    // here made every launch wait on the App Store, and could put an Apple ID
    // password prompt in front of someone who had only opened the app —
    // including an App Review tester (2026-09-30). The device's own current
    // entitlements are what this check needs; the Restore Purchases button
    // still does the full sync when someone asks for it.
    const result = await StoreKitPurchase.restorePurchases({ sync: false });
    if (result.status === "none" || !result.transactionId) return false;
    await apiRequest("POST", "/api/subscription/verify", { transactionId: result.transactionId });
    return true;
  } catch {
    return false;
  }
}
