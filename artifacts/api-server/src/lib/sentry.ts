import * as Sentry from "@sentry/node";
import type { Express } from "express";

// Crash/error monitoring — a completely no-op module until SENTRY_DSN is
// actually set. Errors reach Sentry two ways once configured:
//   1. Anything that reaches Express's own error-handling chain (an
//      uncaught throw in middleware, or next(err)) — via
//      attachExpressErrorHandler, called after registerRoutes().
//   2. Every existing `logger.error(...)`/`req.log.error(...)` call
//      already used throughout this codebase's own try/catch blocks — via
//      a pino hook (see lib/logger.ts), so ~20+ existing catch sites don't
//      each need a separate Sentry.captureException() call bolted on.
// Sentry's Node SDK also installs its own uncaughtException/
// unhandledRejection handlers by default once initSentry() runs.
const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = !!dsn;

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Low sample rate — a small family app, not a high-traffic service;
    // errors are always captured at 100% regardless of this setting, which
    // only controls performance-trace volume against the free-tier quota.
    tracesSampleRate: 0.05,
  });
}

/** Call once, AFTER all routes are registered (Sentry's own requirement —
 * its error handler must sit after every route/controller so it only
 * catches what nothing else handled, and before any other custom error
 * middleware). No-op if Sentry isn't configured. */
export function attachSentryErrorHandler(app: Express): void {
  if (!dsn) return;
  Sentry.setupExpressErrorHandler(app);
}

/** Used by the pino logger hook — forwards an `err`/`error` field from a
 * logger.error(...) call to Sentry, if configured. Never throws. */
export function captureFromLog(err: unknown): void {
  if (!dsn) return;
  try {
    Sentry.captureException(err);
  } catch {
    // Never let error reporting itself take down the process.
  }
}
