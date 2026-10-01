import { useEffect } from "react";
import { useSpotlight } from "@/lib/spotlight";

/**
 * Deterministic fixture for the spotlight's sticky-header clamp.
 *
 * Reported after the cold-launch fix landed: the spotlight found the right
 * card, but its lit hole cut up across the nav. Reproducing that through the
 * real app means racing a scroll against the overlay's own per-frame
 * re-measure, which reads a one-frame-stale overlay and judges the wrong
 * thing. Here the card simply IS under the header from the start — the exact
 * geometry the clamp exists for — with nothing moving.
 */
export function setup() {
  // No API calls in this fixture; the harness still requires the export.
}

export function Component() {
  const { spotlight, spotlightOverlay } = useSpotlight();
  useEffect(() => {
    spotlight("clamp-target");
  }, [spotlight]);

  return (
    <div>
      <header
        id="app-sticky-header"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 200,
          background: "#fff",
          zIndex: 50,
        }}
      >
        nav
      </header>
      {/* Top 120px — genuinely behind the 200px header. */}
      <div
        id="clamp-target"
        style={{ position: "fixed", top: 120, left: 16, width: 300, height: 400 }}
      >
        card
      </div>
      {spotlightOverlay}
    </div>
  );
}
