// iOS WKWebView (the Capacitor app, and Safari on iPad) is inconsistent about
// which element is actually the scrolling container — it can be the page's
// main scroll div, document.documentElement, document.body, or the window
// itself depending on context. A plain `element.scrollIntoView()` only
// scrolls whichever single ancestor the browser picks, which on iPad
// reliably produces a "landed halfway down" result instead of reaching the
// intended spot. These helpers instead compute the target offset once and
// apply it to every possible scroll source, so whichever one is real gets it.
export const APP_SCROLL_CONTAINER_ID = "app-scroll-container";
const APP_STICKY_HEADER_ID = "app-sticky-header";

// The sticky header's real height varies a lot (profile row + stars pill +
// date-nav row + tab-pill row, some of which wrap/hide depending on tab and
// screen width) — a fixed guessed offset can under-shoot it, landing a
// scroll target's top edge behind the header rather than below it. Reading
// the header's own live height keeps any `robustScrollIntoView` call
// correct regardless of which combination of rows is currently showing.
export function stickyHeaderOffset(extraPx = 16): number {
  const header = document.getElementById(APP_STICKY_HEADER_ID);
  return (header?.getBoundingClientRect().height ?? 80) + extraPx;
}

type Scrollable = { scrollTo(opts: ScrollToOptions): void };

function allScrollTargets(): Scrollable[] {
  const container = document.getElementById(APP_SCROLL_CONTAINER_ID);
  const candidates: (Scrollable | null)[] = [container, document.documentElement, document.body, window];
  return candidates.filter((t): t is Scrollable => !!t);
}

export function robustScrollToTop(behavior: ScrollBehavior = "smooth") {
  for (const target of allScrollTargets()) {
    target.scrollTo({ top: 0, behavior });
  }
}

/**
 * Resolves once an element with this id is in the DOM, or after `timeoutMs`
 * (resolves false). Several cards render `null` until their own query
 * resolves — HealthReminderInbox and the Announcements sections both do — so
 * a push tap that cold-launches the app runs its scroll/spotlight before the
 * target exists, and both of those silently no-op on a missing element.
 */
// Polled with setTimeout rather than requestAnimationFrame: the caller that
// matters is a push notification tapped from a COLD launch, and iOS throttles
// (or entirely pauses) rAF while a webview is still coming to the foreground —
// so an rAF loop can burn the whole wall-clock timeout in a handful of frames
// and give up before the target ever renders, which looks identical to the
// spotlight silently not firing. 10s because a cold launch has to finish auth
// and its first queries before the card this waits for exists at all.
export function waitForElement(elementId: string, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (document.getElementById(elementId)) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Find the element that actually scrolls this one.
 *
 * The old approach applied the same absolute scrollTop to the app container,
 * documentElement, body AND window at once, on the theory that only one of
 * them would be real. When more than one IS real they both move, and the
 * element lands roughly twice as far up as intended — which is how a tapped
 * medication push left the reminder card's top edge behind the sticky header
 * (reported 2026-09-11 with a screenshot). Walking up to the nearest ancestor
 * that can actually scroll picks exactly one, so the arithmetic is honest.
 */
export function nearestScroller(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(cs.overflowY);
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  const container = document.getElementById(APP_SCROLL_CONTAINER_ID);
  if (container && container.scrollHeight > container.clientHeight + 1) return container;
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  return root.scrollHeight > root.clientHeight + 1 ? root : null;
}

// How close is close enough. Chasing sub-pixel differences just produces
// another scroll on the next pass.
const SCROLL_TOLERANCE_PX = 4;
// Room left under a revealed card so it doesn't sit flush on the bottom edge.
const REVEAL_BOTTOM_GAP_PX = 16;
// Corrective passes. A push tap cold-launches the app, so the cards ABOVE the
// target (announcements, events, tasks) are still resolving their own queries
// and changing height for a second or so after the first scroll lands —
// a single scroll is correct at the instant it runs and wrong shortly after.
const CORRECTION_DELAYS_MS = [120, 320, 700, 1200];

function placeOnce(elementId: string, offsetPx: number, behavior: ScrollBehavior): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const scroller = nearestScroller(el);
  if (!scroller) return;

  const isRoot = scroller === document.scrollingElement || scroller === document.documentElement;
  const viewTop = isRoot ? 0 : scroller.getBoundingClientRect().top;
  const viewBottom = isRoot
    ? (window.visualViewport?.height ?? window.innerHeight)
    : scroller.getBoundingClientRect().bottom;

  const elRect = el.getBoundingClientRect();
  const available = viewBottom - (viewTop + offsetPx) - REVEAL_BOTTOM_GAP_PX;

  // Put the top just below whatever is pinned over it. When the card also
  // fits, that alone leaves the whole of it visible; when it doesn't fit,
  // the top is the end worth showing — it carries the card's own heading.
  let delta = elRect.top - (viewTop + offsetPx);
  if (elRect.height <= available) {
    // If it already sits below the header but runs off the bottom, bring the
    // bottom up instead of dragging the top back to the header.
    const overflowBelow = elRect.bottom + REVEAL_BOTTOM_GAP_PX - viewBottom;
    if (delta > 0 && overflowBelow > 0) delta = Math.min(delta, overflowBelow);
  }
  if (Math.abs(delta) < SCROLL_TOLERANCE_PX) return;

  const max = scroller.scrollHeight - scroller.clientHeight;
  const next = Math.max(0, Math.min(max, scroller.scrollTop + delta));
  if (Math.abs(next - scroller.scrollTop) < SCROLL_TOLERANCE_PX) return;
  scroller.scrollTo({ top: next, behavior });
}

/**
 * Scrolls so the element with `elementId` sits `offsetPx` below the top of
 * whatever is scrolling it, fully visible when it fits.
 *
 * Runs once, then corrects a few times over the next second. Both matter: the
 * first pass is what the user sees moving, and the corrections are what keep
 * it right while the cards above it are still loading and changing height.
 * Corrections are instant rather than smooth — they are small, and animating
 * them would read as the screen drifting on its own.
 */
export function robustScrollIntoView(elementId: string, offsetPx = 0, behavior: ScrollBehavior = "smooth") {
  requestAnimationFrame(() => {
    placeOnce(elementId, offsetPx, behavior);
    for (const ms of CORRECTION_DELAYS_MS) {
      setTimeout(() => placeOnce(elementId, offsetPx, "auto"), ms);
    }
  });
}
