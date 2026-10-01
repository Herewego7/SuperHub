import { useEffect, useRef } from "react";

/**
 * Swiping in from the left or right screen edge moves the given date
 * forward/backward by one day — a shortcut for the many screens where
 * flipping through days is the primary interaction (Home, Tasks, People,
 * Calendar's Day view). Only starts tracking a gesture that begins within
 * `edgeWidth` px of either edge, so it never fights normal horizontal
 * scrolling/dragging elsewhere on the page (e.g. the Meals grid, chore
 * drag-and-drop).
 */
export function useEdgeSwipeDateNav(
  onPrevDay: () => void,
  onNextDay: () => void,
  opts: { enabled?: boolean; edgeWidth?: number; threshold?: number } = {},
) {
  const { enabled = true, edgeWidth = 24, threshold = 60 } = opts;
  const startRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const fromLeftEdge = t.clientX <= edgeWidth;
      const fromRightEdge = t.clientX >= window.innerWidth - edgeWidth;
      // A touch starting on a draggable item (Meal Ideas cards, the To-Dos/
      // Manage-Chores reorder handles, etc.) is never a page-swipe gesture,
      // regardless of how close it is to the edge — those items' own
      // pointer-drag handlers own this gesture instead. Without this check,
      // starting a drag on a Meal Ideas card (which sits flush against the
      // left edge on phone widths) got misread as "swipe to the previous
      // week" the instant the finger moved, since this listener has no way
      // to know a drag was already in progress.
      const target = e.target as HTMLElement | null;
      const isDragSource = !!target?.closest('[draggable="true"]');
      startRef.current = {
        x: t.clientX,
        y: t.clientY,
        active: (fromLeftEdge || fromRightEdge) && !isDragSource,
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start?.active) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // Require the gesture to stay mostly horizontal so a diagonal
      // scroll-and-drift near the edge doesn't misfire as a day change.
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onPrevDay();
      else onNextDay();
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [enabled, edgeWidth, threshold, onPrevDay, onNextDay]);
}
