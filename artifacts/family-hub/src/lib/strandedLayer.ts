/**
 * A way out of a Radix menu or list that has locked the page on iPhone.
 *
 * While a modal layer is open (a Select's list, a modal menu), Radix sets
 * `pointer-events: none` on <body>, blocks page scrolling, and closes the
 * layer on a tap outside, but for a touch it waits for that tap's click.
 * iOS sends no click for a tap on blank page, and none at all for a swipe.
 * With every element ignoring touches, the only thing left to touch is
 * <html>, so the layer never closed and the app sat frozen until it was
 * force-quit (2026-10-22).
 *
 * So: a touch that ends on <html> or <body> while the body is switched off
 * presses Escape, which closes the topmost layer exactly as a tap outside
 * would. If the body is still switched off a moment later with nothing open
 * (Radix can leave it behind), it is switched back on.
 */
const OPEN_LAYER = '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function initStrandedLayerEscape(doc: Document = document): void {
  doc.addEventListener(
    "touchend",
    (event) => {
      if (doc.body.style.pointerEvents !== "none") return;
      if (event.target !== doc.documentElement && event.target !== doc.body) return;
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        if (doc.body.style.pointerEvents === "none" && !doc.querySelector(OPEN_LAYER)) doc.body.style.pointerEvents = "";
      }, 400);
    },
    { capture: true, passive: true },
  );
}
