import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Briefly darkens the whole screen except one target element, to call
// attention to it without navigating anywhere — useful on tablet/desktop
// where scrolling a card into view isn't enough on its own, since several
// cards can already be visible at once with nothing to distinguish "this is
// the one that matters right now."
//
// Implementation notes (read before changing):
// - Rendered as a small `fixed`-positioned div — sized/positioned to match
//   the target's own rect — portalled to <body>, NOT as a box-shadow
//   directly on the target itself. `<main>` in family-hub.tsx has
//   `overflow-x-hidden` unconditionally, and several Home card wrappers
//   have their own `overflow-hidden`, which would clip a shadow attached to
//   the target. Because this div is a sibling of <body>'s other children —
//   not a descendant of the target's own clipping ancestors — its shadow
//   isn't clipped by any of that. The dim layer IS that div's own
//   `box-shadow: 0 0 0 9999px <color>` (a huge solid spread with no blur),
//   and the div's own `border-radius` gives the hole genuinely round
//   corners for free — far simpler, and better-looking, than approximating
//   an arc with a clip-path polygon (an earlier version of this file did
//   that, and the chamfered corners it produced didn't match the cards'
//   real rounded corners).
// - The cutout is recomputed on scroll/resize via requestAnimationFrame
//   (not a scroll listener doing layout work directly) so it stays glued to
//   the target's real position, including inside the app's own custom
//   scroll container (APP_SCROLL_CONTAINER_ID).
// - Refuses to fire while a dialog/sheet/alertdialog OTHER than the one
//   hosting the target is open. Several call sites live inside a Settings/
//   drawer dialog themselves (Tab Order & Visibility, Customize Tasks
//   Page's card list, Family Activity's entry list) — the target is always
//   inside an already-open dialog there, so refusing on "any dialog open at
//   all" would make the spotlight a permanent no-op at exactly the sites
//   that need it most. What actually matters is whether some UNRELATED
//   overlay (a confirm dialog, a PIN prompt) is stacked on top of/beside
//   the target, which really would make dimming around it confusing.
// - z-[80]: above the sticky header (z-50) and the notch-cover strip
//   (z-[45]), below every real full-screen takeover in this app (Privacy
//   Screen z-[999]+, onboarding replay z-[2000], KB panel z-[2100]).

const HOLD_MS = 1800;
// How long spotlight() will wait for a not-yet-mounted target before giving
// up. Long enough to cover a cold launch's first data round-trip; short
// enough that a genuinely absent target still no-ops promptly.
// Matched to scroll.ts's waitForElement, and for the same reason: a cold
// launch from a tapped push has to finish auth and its first queries before
// the card this waits for exists at all. 4s was not enough for that.
const WAIT_FOR_TARGET_MS = 10000;
const FADE_MS = 220;

function blockingModalOpen(target: HTMLElement): boolean {
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
  for (const d of Array.from(dialogs)) {
    if (d.contains(target)) continue;
    // Only a dialog that is actually ON SCREEN blocks. A closed-but-still-
    // mounted one (mid-exit animation, or any overlay kept in the DOM) has no
    // box, and treating it as blocking made the spotlight a silent no-op with
    // nothing visibly in the way — indistinguishable from the feature being
    // broken.
    if ((d as HTMLElement).getClientRects().length === 0) continue;
    return true;
  }
  return false;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

type SpotlightState = {
  rect: DOMRect;
  phase: "in" | "hold" | "out";
};

function SpotlightOverlay({
  targetId,
  dimHeader,
  onDone,
}: {
  targetId: string;
  dimHeader: boolean;
  onDone: () => void;
}) {
  const [state, setState] = useState<SpotlightState | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) {
      onDone();
      return;
    }

    const reduced = prefersReducedMotion();
    let cancelled = false;

    const track = () => {
      if (cancelled) return;
      const node = document.getElementById(targetId);
      if (node) {
        const rect = node.getBoundingClientRect();
        setState((prev) => (prev ? { ...prev, rect } : { rect, phase: "in" }));
      }
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);

    setState({ rect: el.getBoundingClientRect(), phase: reduced ? "hold" : "in" });

    const schedule = (ms: number, fn: () => void) => {
      const id = window.setTimeout(fn, ms);
      timersRef.current.push(id);
    };

    if (!reduced) {
      schedule(FADE_MS, () => setState((prev) => (prev ? { ...prev, phase: "hold" } : prev)));
    }
    schedule((reduced ? 0 : FADE_MS) + HOLD_MS, () =>
      setState((prev) => (prev ? { ...prev, phase: "out" } : prev)),
    );
    schedule((reduced ? 0 : FADE_MS) + HOLD_MS + (reduced ? 0 : FADE_MS), () => onDone());

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
      // Release the global "one at a time" lock on ANY unmount, not just a
      // natural finish — if the host component (e.g. HomeView) unmounts
      // mid-cycle because the user switched tabs, the scheduled onDone()
      // timer above never gets to fire, and without this the lock would
      // stay held for the rest of the page's life (only a hard refresh
      // would ever clear it, since the lock is a module-level variable that
      // outlives any one component's mount). Idempotent — a normal finish
      // already called onDone() itself, so this is a harmless no-op then.
      onDone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  if (!state) return null;

  const { rect, phase } = state;
  const pad = 8;
  // Matches the app's own `rounded-2xl` card radius (see e.g. the Tasks
  // card in home-view.tsx) so the lit hole's corners read as the same
  // shape as the card itself, not a different, more-angular cutout.
  const radius = 16;
  const x = Math.max(0, rect.left - pad);
  const w = rect.width + pad * 2;

  // Never cut the hole up into the sticky header. The target is scrolled to
  // sit below it, but that scroll and this measurement don't always settle in
  // the same frame — on a cold launch (a tapped push notification) the card
  // can still be partly behind the header when the hole is first drawn, and a
  // lit strip across the nav reads as the spotlight landing on the wrong
  // thing. Clamping here fixes it for every call site at once, rather than
  // relying on each one's scroll having finished first.
  const headerBottom =
    document.getElementById("app-sticky-header")?.getBoundingClientRect().bottom ?? 0;
  const y = Math.max(0, headerBottom, rect.top - pad);
  const h = Math.max(0, rect.bottom + pad - y);
  const r = Math.min(radius, w / 2, h / 2);

  const opacity = phase === "in" ? 0 : phase === "out" ? 0 : 1;

  // The dim layer is this div's own box-shadow, spread far past the edge
  // of the viewport in every direction — since the overlay's z-index (80)
  // sits above the sticky header (z-50), the header/nav is covered by that
  // spread just like everything else outside the hole, with no extra logic
  // needed. `dimHeader` exists as an explicit opt so a future call site
  // could request an UN-dimmed header instead — not needed by the current
  // rollout, so there's nothing further to branch on yet; kept as a named
  // option per the approved plan rather than removed, in case that changes.
  void dimHeader;

  return (
    <div
      aria-hidden="true"
      // The hole's geometry IS the behaviour — what it frames and how much of
      // the screen it dims — so it needs to be measurable from a test.
      data-testid="spotlight-hole"
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: 80,
        pointerEvents: "none",
        borderRadius: r,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        opacity,
        transition: prefersReducedMotion() ? "none" : `opacity ${FADE_MS}ms ease`,
      }}
    />
  );
}

let activeSpotlightCleanup: (() => void) | null = null;

/**
 * Returns a `spotlight(targetId)` function. Call it to briefly dim the
 * screen except the element with that id. Safe to call repeatedly; a call
 * while one is already active or while any dialog is open is a no-op.
 */
export function useSpotlight(opts: { dimHeader?: boolean } = {}) {
  const dimHeader = opts.dimHeader ?? true;
  const [portalTarget] = useState(() => {
    let el = document.getElementById("spotlight-portal-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "spotlight-portal-root";
      document.body.appendChild(el);
    }
    return el;
  });
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Whether the global lock below is currently held by THIS hook.
  const ownsLockRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
      // Release the global "one at a time" lock if we still hold it. The lock
      // is taken the moment a target is found, but the overlay that normally
      // releases it only mounts on the next render — so a host that unmounts
      // in between (a tab switch while a push is still resolving) would leave
      // it held for the life of the page, making EVERY later spotlight a
      // silent no-op.
      if (ownsLockRef.current) {
        ownsLockRef.current = false;
        activeSpotlightCleanup = null;
      }
    },
    [],
  );

  const spotlight = useCallback((targetId: string) => {
    if (activeSpotlightCleanup) return; // one at a time, globally

    // Wait for the target to exist rather than giving up the instant it
    // doesn't. Several targets are cards that render `null` until their own
    // query resolves — HealthReminderInbox returns null while it has no
    // events, and the Announcements praise/notes sections likewise. Tapping a
    // push COLD-LAUNCHES the app, so every query starts at once and the card
    // simply isn't in the DOM yet when the caller's fixed timeout fires. The
    // old code's `if (!el) return` made that a silent no-op — the reported
    // "tapped the medication notification, nothing was spotlighted", while
    // birthday/cash-out (whose targets don't depend on a query resolving into
    // a conditionally-rendered card) worked fine.
    // ⚠️ setTimeout, NOT requestAnimationFrame. iOS throttles (or entirely
    // pauses) rAF while a webview is still coming to the foreground, so an rAF
    // loop burns its whole wall-clock budget in a handful of frames and gives
    // up before the target ever renders — which looks exactly like the
    // spotlight silently not firing. scroll.ts's waitForElement was moved off
    // rAF for precisely this reason and this copy was missed; the tapped
    // medication push is the one caller that always hits it (2026-09-13).
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        // Give up eventually: a genuinely absent target (e.g. the Cash Out
        // card in rewards_only mode) must still no-op rather than spin.
        if (Date.now() - start < WAIT_FOR_TARGET_MS) {
          timer = setTimeout(attempt, 50);
        }
        return;
      }
      // Keep waiting rather than abandoning: on a cold launch an unrelated
      // overlay can still be on its way out while the card underneath is
      // already there, and giving up on the first look meant losing the
      // spotlight to a dialog that was about to disappear anyway.
      if (blockingModalOpen(el)) {
        if (Date.now() - start < WAIT_FOR_TARGET_MS) timer = setTimeout(attempt, 50);
        return;
      }
      if (activeSpotlightCleanup) return; // another one started while waiting

      ownsLockRef.current = true;
      activeSpotlightCleanup = () => {
        activeSpotlightCleanup = null;
        ownsLockRef.current = false;
        if (timer) clearTimeout(timer);
        if (mountedRef.current) setActiveTargetId(null);
      };
      setActiveTargetId(targetId);
    };
    attempt();
  }, []);

  const overlay = activeTargetId
    ? createPortal(
        <SpotlightOverlay
          targetId={activeTargetId}
          dimHeader={dimHeader}
          onDone={() => activeSpotlightCleanup?.()}
        />,
        portalTarget,
      )
    : null;

  return { spotlight, spotlightOverlay: overlay };
}
