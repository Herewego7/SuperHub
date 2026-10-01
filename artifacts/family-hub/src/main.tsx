import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./hooks/use-theme";
import { initNativeNotifications } from "./lib/nativeNotifications";
import { initNativeAuth } from "./lib/nativeAuth";
import { initNativeResumeFix } from "./lib/nativeResume";
import { resetWebviewScroll } from "./lib/webviewScrollLock";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";

// A no-op until VITE_SENTRY_DSN is configured — see lib/sentry.ts. Called
// first, before anything else can throw.
initSentry();

initTheme();

// Work around an iPad WKWebView bug where resuming from background can leave
// the app squished into the left portion of the screen. No-op on the web.
initNativeResumeFix();

// Native scroll lock is iOS state, not JavaScript state, so it survives a
// reload. Sign-out reloads from inside a dialog that holds it, which left the
// login screen unable to scroll. Always start from scrolling ON. No-op on web.
resetWebviewScroll();

// Wire up native (Capacitor) push listeners once at boot. No-op on the web.
void initNativeNotifications();

// Load any stored auth token and register the OAuth deep-link listener. No-op on web.
void initNativeAuth();

// Sentry.ErrorBoundary itself renders `children` unwrapped when Sentry
// isn't initialized (no-DSN case) — safe to always mount, not conditional
// on sentryEnabled. Previously there was no top-level error boundary at
// all: an uncaught render error meant a blank white screen with no
// recovery path, which is exactly the class of bug the manual smoke-test
// checklist calls out to watch for.
createRoot(document.getElementById("root")!).render(
  <SentryErrorBoundary
    fallback={({ resetError }) => (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-sm text-center space-y-3">
          <div className="text-4xl">😕</div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Family Hub+ hit an unexpected error. Try reloading — if it keeps
            happening, let us know what you were doing when it occurred.
          </p>
          <button
            type="button"
            onClick={() => {
              resetError();
              window.location.reload();
            }}
            className="mt-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Reload
          </button>
        </div>
      </div>
    )}
  >
    <App />
  </SentryErrorBoundary>,
);

// Register the service worker for PWA + web push. The SW lives at the root of
// the artifact's BASE_URL so its scope covers the whole app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Check for an updated service worker on every load so a device that
        // was running an old build (common with iOS home-screen PWAs) doesn't
        // stay stuck on stale JavaScript.
        reg.update().catch(() => {});
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // A new SW has installed while an old one still controls the page.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Service worker registration failed", err);
      });

    // When the controlling SW changes (new version took over), reload once so
    // the page runs the latest build instead of the cached one.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
