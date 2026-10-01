import { Capacitor } from "@capacitor/core";

/**
 * iPad WKWebView bug workaround: after the app is backgrounded and resumed
 * (most reliably reproduced via Split View/Slide Over, which UIRequiresFullScreen
 * now disables — but has also been seen after a plain background/foreground
 * cycle), the webview's layout can get stuck rendering at a stale viewport
 * size, squishing the app into the left portion of the screen. Forcing a
 * reflow on resume — nudging the root element's size and firing a resize
 * event — makes the webview recompute its actual bounds.
 */
export function initNativeResumeFix(): void {
  if (!Capacitor.isNativePlatform()) return;

  const forceReflow = () => {
    const root = document.documentElement;
    const previousMinHeight = root.style.minHeight;
    // Toggling a layout-affecting style forces WKWebView to recompute bounds
    // against the window's actual current size rather than a stale cached one.
    root.style.minHeight = "calc(100% + 1px)";
    requestAnimationFrame(() => {
      root.style.minHeight = previousMinHeight;
      window.dispatchEvent(new Event("resize"));
    });
  };

  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("resume", forceReflow);
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) forceReflow();
      });
    })
    .catch((err) => {
      console.warn("Failed to register native resume listener", err);
    });
}
