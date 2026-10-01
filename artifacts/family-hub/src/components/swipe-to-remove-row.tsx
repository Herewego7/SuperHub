import { useEffect, useRef, useState } from "react";
import { UserMinus } from "lucide-react";

interface SwipeToRemoveRowProps {
  /** Called once the user taps the revealed "Remove" action. */
  onRemove: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  removeLabel?: string;
}

const REVEAL_WIDTH = 92;
const DRAG_START_THRESHOLD = 8;

/**
 * Wraps a single list row so swiping it left reveals a "Remove" action
 * underneath — the row itself still handles its own tap (e.g. toggling a
 * chore complete); this only intercepts a genuinely horizontal drag, and
 * suppresses the wrapped row's own click for that one gesture so a swipe
 * never also fires whatever the row's tap does.
 */
export function SwipeToRemoveRow({ onRemove, disabled, children, removeLabel = "Remove" }: SwipeToRemoveRowProps) {
  const [dragX, setDragX] = useState(0); // 0 = closed, negative = revealed/dragging
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(null);
  const swipedRef = useRef(false);
  // overflow-hidden is only needed while the row is actually swiped open (or
  // sliding back): the Remove action lives INSIDE this box and is hidden by
  // opacity at rest, so nothing needs clipping until the content is
  // translated out from under it. Left on permanently it clips the check-off
  // hop (.animate-bounce, translateY(-6px)) against the row's own top edge,
  // which is flush with it — the Chores tab wraps every chore row in one of
  // these, so every row's bounce was cut off there. Same class of bug as the
  // Tasks card's collapsible sections on Home, which had to stop clipping
  // once their height animation settled.
  const [clipping, setClipping] = useState(false);
  useEffect(() => {
    if (dragX !== 0 || isDragging) {
      setClipping(true);
      return;
    }
    // A timer, not transitionend: releasing a drag exactly at 0 (or a
    // snap-back that never actually moves) fires no transition at all, and
    // the row would stay clipped forever. 260ms clears the 220ms snap.
    const t = setTimeout(() => setClipping(false), 260);
    return () => clearTimeout(t);
  }, [dragX, isDragging]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, base: dragX };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (!isDragging) {
      if (Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll — not a swipe, bail out for the rest of this gesture.
        startRef.current = null;
        return;
      }
      setIsDragging(true);
      swipedRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const next = Math.min(0, Math.max(-REVEAL_WIDTH, startRef.current.base + dx));
    setDragX(next);
  };

  const endDrag = () => {
    if (!isDragging) {
      startRef.current = null;
      return;
    }
    startRef.current = null;
    const snapTo = dragX < -REVEAL_WIDTH / 2 ? -REVEAL_WIDTH : 0;
    // Enabling the transition and changing dragX in the same render can let
    // the browser apply both in one paint, with nothing to interpolate from
    // — the row would just jump to its new position instead of animating.
    // A double rAF guarantees a frame with the transition already turned on
    // gets painted before dragX actually changes, so the snap genuinely
    // animates instead of appearing instant.
    setIsDragging(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setDragX(snapTo));
    });
  };

  return (
    <div className={`relative rounded-2xl ${clipping ? "overflow-hidden" : ""}`}>
      <div
        className="absolute inset-y-0 right-0 flex"
        aria-hidden={dragX === 0}
        // Explicit, unambiguous hiding — don't rely on the content sibling
        // below merely "painting over" this via DOM order + position
        // (CSS2.1 stacking rules put positioned elements and in-flow content
        // in the same paint group with DOM order deciding, which is
        // spec-correct and worked in every local/headless test run here —
        // but a user reported the Remove button staying visible at rest on
        // a real device regardless, which this local sandbox has no way to
        // reproduce or rule out browser-specific stacking quirks for).
        // Opacity + pointer-events, keyed directly off dragX, can't be
        // silently defeated by some other element's own background,
        // z-index, or stacking context the way the paint-order trick could
        // be — it's a hard, explicit "not visible, not interactive" rather
        // than "hopefully covered by whatever's on top."
        style={{
          opacity: dragX === 0 ? 0 : 1,
          pointerEvents: dragX === 0 ? "none" : "auto",
          transition: isDragging ? "none" : "opacity 220ms ease-out",
        }}
      >
        <button
          type="button"
          className="h-full flex flex-col items-center justify-center gap-0.5 text-destructive-foreground text-[11px] font-semibold rounded-r-2xl"
          style={{
            width: REVEAL_WIDTH,
            // Plain `bg-destructive/85` never renders here — this app's
            // theme colors are bare `var(--x)` strings (tailwind.config.ts),
            // which Tailwind can't apply an opacity MODIFIER to at all (it
            // needs an rgb()/hsl()-decomposed color for that), so the class
            // silently compiles to nothing anywhere it's used, confirmed by
            // grepping the production CSS bundle for zero matches. Wrapping
            // it in hsl(var(--x)) doesn't help either: --destructive is
            // ALREADY a full hsl(...) string once inside the
            // .hearth-theme.opaque-vars scope every screen in this app
            // renders under (see index.css), so hsl(var(--destructive)) is
            // an invalid double-wrap and is ALSO fully transparent. A
            // codebase-wide fix (making the SAME opacity-modifier syntax
            // work everywhere via this same color-mix() mechanism) was
            // tried and reverted — it fixed this button but broke several
            // OTHER surfaces relying on the previously-transparent behavior
            // (Settings' dialog backdrop turning solid black, chore row
            // borders vanishing) elsewhere in the app, which weren't safe to
            // fix blind at the same time. This inline style keeps the fix
            // scoped to just this one button until that broader work can be
            // done carefully, screen by screen.
            backgroundColor: "color-mix(in srgb, var(--destructive) 85%, transparent)",
          }}
          tabIndex={dragX === 0 ? -1 : 0}
          onClick={(e) => {
            e.stopPropagation();
            setDragX(0);
            onRemove();
          }}
          data-testid="button-swipe-remove"
        >
          <UserMinus className="w-4 h-4" />
          {removeLabel}
        </button>
      </div>
      {/* `relative` here (not just the wrapper above) matters, not just for
          style: an absolutely-positioned sibling paints ABOVE normal-flow
          content regardless of DOM order (CSS2.1's stacking rules put
          in-flow content and z-index:auto positioned elements in different,
          fixed paint groups) — without this, the red button above showed
          through on top of this row's content at rest, not just while
          dragging. Giving this div its own position (any position) puts it
          in the SAME paint group as the button, where DOM order decides —
          and since it comes later in the DOM, it correctly paints over the
          button and hides it until actually dragged out from under it. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="swipe-row"
        onClickCapture={(e) => {
          if (swipedRef.current) {
            e.stopPropagation();
            e.preventDefault();
            swipedRef.current = false;
          }
        }}
        className="relative"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? "none" : "transform 220ms ease-out",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
