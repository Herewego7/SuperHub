import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // ⚠️ EVERY plugin that lives in this app target must be registered
        // here. Capacitor only discovers plugins that come from npm packages;
        // app-local ones do not exist to JavaScript until this line runs, and
        // the only symptom is "'X' plugin is not implemented on ios" — at the
        // moment someone taps the button.
        //
        // Only WebAuthPlugin was ever registered. AppleSignInPlugin and
        // StoreKitPurchasePlugin were each added with their Swift file and
        // their Xcode entry but never this line, so Sign in with Apple and
        // in-app purchase had never worked on a device (found 2026-09-30,
        // when Restore Purchases reported the plugin missing). Both would
        // have failed App Review. A unit test now fails if a plugin class in
        // this folder is not registered below — see pluginRegistration.test.ts.
        bridge?.registerPluginInstance(WebAuthPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(StoreKitPurchasePlugin())

        // Capacitor's default WKWebView scroll view leaves horizontal bounce
        // enabled — the app has no real horizontal content, so any touch
        // drag with an x-component made every screen (and every modal on top
        // of it) rubber-band a few px sideways, reading as "pop-ups can be
        // swiped slightly to the right." This is a UIScrollView-level elastic
        // bounce, one layer below the DOM, so no CSS touch-action rule can
        // suppress it — it has to be disabled here.
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }
}
