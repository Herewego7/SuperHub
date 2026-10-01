import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { createScrollLock } from "@/lib/scrollLockCore";

/**
 * Turn WKWebView's own keyboard scroll-to-reveal off while a dialog is open.
 *
 * WHY THIS EXISTS — measured frame by frame from a device recording
 * (2026-09-11, adding ingredients, 60fps):
 *
 *   t=3.550  Return pressed
 *   t=3.667  the dialog starts gliding upward — 17ms after the keypress
 *   t=3.833  its top edge has travelled off the top of the screen
 *   t=3.933  it snaps back to rest in a SINGLE frame
 *
 * The glide starts essentially on the keypress and animates over ~165ms. No
 * app code runs in that window — our own focus handler is on a timer and fires
 * at +320ms, which is what produced the single-frame snap at the end. So the
 * lurch is not ours to fix in JavaScript: it is WKWebView's UIScrollView
 * scrolling the whole document to reveal the new first responder, which drags
 * every `position: fixed` element (the dialog included) along with it.
 *
 * That reveal cannot be cancelled from the web side. `preventDefault` doesn't
 * reach it, and fighting it with a scroll of our own is what produced the snap.
 * Disabling the WebView's scroll view removes the mechanism outright, which is
 * why native iOS forms don't behave this way.
 *
 * SAFE BECAUSE it is scoped to "a dialog is open":
 * - Radix's modal Dialog already installs react-remove-scroll, so the document
 *   behind the dialog is scroll-locked anyway — there is nothing the user can
 *   scroll that this takes away.
 * - Only the WebView's OWN scroll view is disabled. Elements with their own
 *   `overflow: auto` — which is what every dialog's content actually scrolls
 *   with — are composited separately and keep scrolling normally.
 * - Ref-counted, so a dialog opened on top of another (a confirm over a form)
 *   doesn't re-enable scrolling underneath the one still open.
 * - A no-op off-native and off-iOS: `setScroll` is an iOS-only method.
 *
 * If dialog content ever stops scrolling on a device, this is the first thing
 * to suspect — `release()` everywhere and the app returns to its old behaviour.
 */

// The logic lives in scrollLockCore.ts, where it can be tested without a
// device. Only the wiring to the native plugin is here.
const core = createScrollLock(
  (disabled) => Keyboard.setScroll({ isDisabled: disabled }),
  supported,
);

function supported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * Put the WebView's scrolling back ON, unconditionally. Call once at boot.
 *
 * ⚠️ The lock is NATIVE state — `Keyboard.setScroll` flips the WKWebView's own
 * UIScrollView — while the lock's bookkeeping is JAVASCRIPT state. A page
 * reload wipes the JavaScript and leaves the native setting exactly as it was.
 * So a reload taken while a dialog held the lock left scrolling switched off
 * for the rest of the app's life — and unrecoverably, because after the reload
 * the bookkeeping believes scrolling is already on and never re-enables it.
 *
 * That is not hypothetical. Sign-out ends in a reload (lib/logoutSequence.ts)
 * and is always taken from the "Are you sure?" dialog, so every sign-out left
 * the login screen unable to scroll, with the keyboard covering the password
 * field and the Log In button out of reach until the app was force-quit
 * (2026-09-30). Resetting at boot fixes that and any other way the native
 * setting can outlive the JavaScript that set it.
 */
export function resetWebviewScroll(): void {
  core.reset();
}

/** Take a lock. Returns a release function; calling it twice is harmless. */
export function lockWebviewScroll(): () => void {
  return core.lock();
}
