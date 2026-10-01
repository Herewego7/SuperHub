import { nearestScroller, stickyHeaderOffset } from "./scroll";

/**
 * Keep a PROGRAMMATICALLY focused field above the software keyboard.
 *
 * WHY THIS EXISTS (reported 2026-09-14, with a recording — To-Dos tab, tapping
 * "Add a to-do under this" near the bottom of the list): the new input renders,
 * `.focus()` is called on it, the keyboard slides up, and the field is left
 * underneath it. Nothing scrolls until the user either drags the page or starts
 * typing — typing is what finally triggers WebKit's own reveal.
 *
 * The reason it doesn't happen by itself is ORDERING. WKWebView scrolls to
 * reveal the first responder at the moment focus moves, and at that moment the
 * keyboard is not up yet: the field is genuinely on screen, so there is nothing
 * to reveal and it correctly does nothing. By the time the keyboard has taken
 * the bottom half of the screen, the focus event is long over. A user-initiated
 * tap doesn't show this because the tap and the keyboard belong to the same
 * gesture; a `.focus()` call fired from a React effect does.
 *
 * So this waits for the keyboard instead of for focus: it runs a pass on a few
 * timers AND on every `visualViewport` resize for a short window, which is the
 * event the keyboard actually fires. Passes are idempotent — once the field
 * sits above the keyboard with a gap, each subsequent pass returns having done
 * nothing, so overlapping triggers cost nothing and cannot oscillate.
 *
 * ⚠️ Deliberately NOT `scrollIntoView`: that scrolls every scrollable ancestor
 * including the document, which is the page-moving primitive behind several
 * past "it scrolled somewhere strange" reports. This walks to the ONE element
 * that actually scrolls this field and adjusts its `scrollTop` by a measured
 * delta.
 *
 * ⚠️ Dialogs do NOT use this — `ui/dialog.tsx` has its own `placeFocusedField`
 * against the dialog's own scroll container, plus a WebView scroll lock. This
 * is for fields that live in the PAGE, where neither applies.
 */

// Room left under the field so it doesn't sit flush on the keyboard's edge.
// One line of context under the caret reads as "there is more form here".
const GAP_PX = 12;
// Below this, a correction is not worth the pixels it moves.
const TOLERANCE_PX = 4;
// The keyboard animates over ~250-300ms and can be preceded by a predictive
// bar appearing/disappearing, so the window runs a little past it.
const PASS_DELAYS_MS = [0, 60, 180, 340, 520, 800];
const LISTEN_MS = 1400;
// visualViewport fires resize continuously while the keyboard animates. Acting
// on every one of those frames is the documented way to make a page lurch (see
// CLAUDE.md) — coalesce and act on the settled value.
const RESIZE_DEBOUNCE_MS = 60;

/** Bottom edge of the area the user can actually see, in client coordinates. */
function visibleBottom(): number {
  const vv = window.visualViewport;
  return vv ? vv.offsetTop + vv.height : window.innerHeight;
}

function revealOnce(el: HTMLElement): void {
  if (!el.isConnected) return;
  const scroller = nearestScroller(el);
  if (!scroller) return;

  const isRoot =
    scroller === document.scrollingElement ||
    scroller === document.documentElement ||
    scroller === document.body;
  const sRect = isRoot ? null : scroller.getBoundingClientRect();

  // The field has to end up between these two lines. The top one clears the
  // app's sticky header, whose height varies by tab and wrapping — read it
  // live rather than guessing a constant.
  const topLimit = isRoot ? stickyHeaderOffset(8) : Math.max(sRect!.top, 0);
  const bottomLimit = isRoot ? visibleBottom() : Math.min(sRect!.bottom, visibleBottom());

  const rect = el.getBoundingClientRect();

  let delta = rect.bottom + GAP_PX - bottomLimit; // > 0 → hidden by the keyboard
  if (delta > 0) {
    // Never scroll so far that the field's own top disappears behind the
    // header: being able to see what you are typing beats the gap below it.
    const room = rect.top - topLimit;
    if (delta > room) delta = room;
    if (delta <= 0) return;
  } else {
    const above = topLimit - rect.top; // > 0 → hidden behind the header
    if (above <= 0) return;
    delta = -above;
  }

  if (Math.abs(delta) < TOLERANCE_PX) return;

  const max = scroller.scrollHeight - scroller.clientHeight;
  const next = Math.max(0, Math.min(max, scroller.scrollTop + delta));
  if (Math.abs(next - scroller.scrollTop) < TOLERANCE_PX) return;
  // Instant, not smooth. The keyboard is sliding up over the same moment, so
  // an instant landing is hidden by its motion, whereas a smooth scroll adds
  // its own ~300ms of visible travel on top — which is what past reports
  // described as juddering.
  scroller.scrollTop = next;
}

/**
 * Call straight after focusing a field yourself. Returns a cancel function;
 * calling it is optional (everything self-cancels after `LISTEN_MS`).
 */
export function revealFieldAboveKeyboard(el: HTMLElement | null | undefined): () => void {
  if (!el) return () => {};

  const timers: ReturnType<typeof setTimeout>[] = [];
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const run = () => { if (!done) revealOnce(el); };

  const onResize = () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, RESIZE_DEBOUNCE_MS);
  };

  const cancel = () => {
    if (done) return;
    done = true;
    for (const t of timers) clearTimeout(t);
    clearTimeout(debounce);
    window.visualViewport?.removeEventListener("resize", onResize);
  };

  for (const ms of PASS_DELAYS_MS) timers.push(setTimeout(run, ms));
  window.visualViewport?.addEventListener("resize", onResize);
  timers.push(setTimeout(cancel, LISTEN_MS));

  return cancel;
}
