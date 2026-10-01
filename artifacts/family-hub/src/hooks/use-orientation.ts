import { useEffect, useState } from "react";

/**
 * Whether the screen is taller than it is wide, for choosing a background
 * crop (see `lib/backgroundImage.ts`).
 *
 * ⚠️ Measured from the viewport, not from `screen.orientation`. A full-screen
 * background has to match the BOX it fills: a resizable browser window, an
 * iPad in Split View, or a Stage Manager window can all be portrait-shaped on
 * a landscape device, and the picture should follow the window.
 */
export function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState(
    () => typeof window !== "undefined" && window.innerHeight >= window.innerWidth,
  );

  useEffect(() => {
    const measure = () => setPortrait(window.innerHeight >= window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    // iOS fires this without always firing resize first.
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return portrait;
}
