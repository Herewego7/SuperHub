import pino from "pino";
import { captureFromLog } from "./sentry";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  // Forwards every existing `logger.error({ err }, ...)` /
  // `req.log.error({ error }, ...)` call already used throughout this
  // codebase's ~20+ try/catch blocks to Sentry (a no-op if SENTRY_DSN isn't
  // set — see lib/sentry.ts), without needing a separate
  // Sentry.captureException() bolted onto each call site individually.
  // Child loggers (req.log, created via pino-http's logger.child(...))
  // inherit hooks from this parent instance, so this covers request-scoped
  // logging too, not just the top-level logger.
  hooks: {
    logMethod(inputArgs, method, level) {
      if (level >= 50 /* error */ && inputArgs.length > 0) {
        const first = inputArgs[0];
        const err = first && typeof first === "object" ? (first as Record<string, unknown>).err ?? (first as Record<string, unknown>).error : undefined;
        if (err) captureFromLog(err);
      }
      return method.apply(this, inputArgs as Parameters<typeof method>);
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
