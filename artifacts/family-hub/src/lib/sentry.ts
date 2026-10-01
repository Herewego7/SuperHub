import * as Sentry from "@sentry/react";

// Crash/error monitoring — a completely no-op module until VITE_SENTRY_DSN
// is actually configured (a project doesn't exist yet as of when this was
// wired up; the user will paste in the real DSN once they've created a
// Sentry account/project, at which point this activates with zero further
// code changes — just setting the env var).
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export const sentryEnabled = !!dsn;

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // MODE is "production" for a real build, "development" for the dev
    // server — so local testing never pollutes the real error stream.
    environment: import.meta.env.MODE,
    // __APP_VERSION__ isn't defined; falls back to undefined (Sentry just
    // won't group by release) rather than needing a build-time version
    // string wired up as a separate task.
    integrations: [Sentry.browserTracingIntegration()],
    // Low sample rate — this is a small family app, not a high-traffic
    // service; a low rate keeps the free tier's event quota for what
    // actually matters (errors, which are always captured at 100%) rather
    // than being eaten by routine performance traces.
    tracesSampleRate: 0.05,
  });
}

// Re-exported so main.tsx doesn't need its own @sentry/react import just to
// wrap the app in an error boundary.
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// One-off verification helper for the "send test error to Sentry" Settings
// button (2026-08-24) — a harmless, clearly-labeled captured exception, not
// a real crash. No-op if Sentry isn't configured (mirrors every other
// function in this file).
export function captureTestError(): void {
  if (!dsn) return;
  Sentry.captureException(new Error("Sentry test error — manually triggered from Settings, safe to ignore"));
}
