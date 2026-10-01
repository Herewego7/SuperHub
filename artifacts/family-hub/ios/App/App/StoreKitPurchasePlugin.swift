import Capacitor
import StoreKit

/**
 * StoreKitPurchasePlugin — wraps StoreKit 2's async purchase API for the
 * free-trial-then-subscribe launch plan (see CLAUDE.md's "Free-trial-then-
 * subscribe entitlement system" entry for the full backend/UI context this
 * plugs into).
 *
 * Custom (app-local) plugin, same reasoning as AppleSignInPlugin.swift right
 * next to this file: StoreKit 2's own async API needs no third-party
 * dependency at all (no community plugin, no Package.swift version to go
 * stale) — Apple ships it directly in the OS SDK.
 *
 * ⚠️ ONE THING ONLY YOU CAN DO: `productId` below MUST exactly match a
 * subscription product you create in App Store Connect (App → Subscriptions
 * → your subscription group → + → the Product ID field). Nothing here can
 * work until that product exists there — StoreKit will just report "no
 * products found" for an unrecognized id. If you pick a different id than
 * the placeholder below, update it here to match exactly.
 *
 * The `appAccountToken` StoreKit accepts at purchase time is set to the
 * signed-in account's own userId (a real UUID — every account in this app
 * gets one via `randomUUID()` at signup, see localAuthRoutes.ts) — this is
 * what lets the backend's App Store Server Notifications webhook match a
 * renewal/cancellation event back to the right account even before the
 * client ever calls `/api/subscription/verify` again (see
 * subscriptionEntitlement.ts's `findUserIdByOriginalTransactionId` fallback,
 * and the "webhook race" note in CLAUDE.md's "Still open" list — this is
 * exactly the fix that was expected to make that race moot).
 */
@objc(StoreKitPurchasePlugin)
public class StoreKitPurchasePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPurchasePlugin"
    public let jsName = "StoreKitPurchase"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise)
    ]

    // ⚠️ Must exactly match the Product ID configured in App Store Connect.
    static let productId = "com.hubforfamilies.app.premium.monthly"

    @objc func getProduct(_ call: CAPPluginCall) {
        Task {
            do {
                let products = try await Product.products(for: [Self.productId])
                guard let product = products.first else {
                    call.reject("Product not found — confirm \(Self.productId) exists and is Ready to Submit in App Store Connect.")
                    return
                }
                call.resolve([
                    "id": product.id,
                    "displayName": product.displayName,
                    "description": product.description,
                    "displayPrice": product.displayPrice
                ])
            } catch {
                call.reject("Failed to load product: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        let accountId = call.getString("appAccountToken")

        Task {
            do {
                let products = try await Product.products(for: [Self.productId])
                guard let product = products.first else {
                    call.reject("Product not found — confirm \(Self.productId) exists and is Ready to Submit in App Store Connect.")
                    return
                }

                var options: Set<Product.PurchaseOption> = []
                if let accountId, let uuid = UUID(uuidString: accountId) {
                    options.insert(.appAccountToken(uuid))
                }

                let result = try await product.purchase(options: options)

                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // Always finish the transaction — StoreKit keeps
                        // re-delivering it via Transaction.updates otherwise,
                        // which would surface as a repeated "purchase"
                        // prompt on next launch.
                        await transaction.finish()
                        call.resolve([
                            "status": "success",
                            "transactionId": String(transaction.id)
                        ])
                    case .unverified(_, let error):
                        call.reject("Purchase could not be verified: \(error.localizedDescription)")
                    }
                case .userCancelled:
                    call.reject("USER_CANCELLED")
                case .pending:
                    // e.g. Ask to Buy (a family member needs a parent's
                    // approval) — not an error, but nothing to confirm yet.
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.reject("Unknown purchase result")
                }
            } catch {
                call.reject("Purchase failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        // ⚠️ `sync` defaults to TRUE, and only the Restore Purchases button
        // should ever pass it that way. Apple: call AppStore.sync() "only in
        // response to an explicit user action". It forces a round trip to the
        // App Store, can take a long time, and can put an Apple ID password
        // prompt in front of someone who never asked for one.
        //
        // This used to run on EVERY launch, unconditionally, from the quiet
        // "link any subscription this Apple ID owns" check (2026-09-30). The
        // launch check now passes sync: false and reads the entitlements the
        // device already has — which is what that check actually needs.
        // Two-argument form deliberately: it is the one this project already
        // compiles (WebAuthPlugin's "ephemeral"), and this file cannot be
        // compiled anywhere but Xcode.
        let shouldSync = call.getBool("sync", true)
        Task {
            do {
                // Reconciles StoreKit's local transaction state with Apple's
                // servers — needed on e.g. a fresh install/reinstall where
                // Transaction.currentEntitlements might not yet reflect an
                // existing subscription. That is precisely why a person
                // tapping Restore Purchases wants it, and why nothing else does.
                if shouldSync {
                    try await AppStore.sync()
                }

                for await result in Transaction.currentEntitlements {
                    guard case .verified(let transaction) = result else { continue }
                    if transaction.productID == Self.productId {
                        call.resolve([
                            "status": "restored",
                            "transactionId": String(transaction.id)
                        ])
                        return
                    }
                }
                call.resolve(["status": "none"])
            } catch {
                call.reject("Restore failed: \(error.localizedDescription)")
            }
        }
    }
}
