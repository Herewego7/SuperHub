import express, { type Express } from "express";
import { stripObjectSignaturesIn } from "./lib/objectSigning";
import cors from "cors";
import pinoHttp from "pino-http";
import { initSentry, attachSentryErrorHandler } from "./lib/sentry";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import healthRouter from "./routes/health";
import { initPush } from "./lib/push";
import { startBedtimeReminderScheduler } from "./scheduler/bedtimeReminders";
import { startDailyBriefScheduler } from "./scheduler/dailyBrief";
import { startEveningPlanScheduler } from "./scheduler/eveningPlan";
import { startInboxScanScheduler } from "./scheduler/inboxScan";
import { startHealthReminderScheduler } from "./scheduler/healthReminders";
import { startWeeklyRecapScheduler } from "./scheduler/weeklyRecap";
import { startBehaviourTimerScheduler } from "./scheduler/behaviourTimers";
import { startCelebrationReminderScheduler } from "./scheduler/celebrationReminders";
import { startTrialReminderScheduler } from "./scheduler/trialReminders";

async function buildApp(): Promise<Express> {
  // A no-op until SENTRY_DSN is set — see lib/sentry.ts. Called first, so
  // it can catch anything that happens during the rest of app setup too.
  initSentry();

  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : null;
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // If no allowlist configured, allow all origins (dev mode)
        if (!allowedOrigins) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Recover the bare form of any uploaded-object path in the request body,
  // before any route sees it. Object paths leave the API signed (see
  // lib/objectSigning.ts) and an ordinary edit-form round trip would
  // otherwise persist a URL that expires in a week, leaving a permanently
  // broken image. Runs here, once, rather than in each of the handful of
  // routes that happen to write one — enumerating those by hand is how one
  // gets missed.
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") stripObjectSignaturesIn(req.body);
    next();
  });

  app.use("/api", healthRouter);

  // registerRoutes sets up auth middleware, auth routes, and all API routes
  await registerRoutes(app);

  // Must come after every route/controller (Sentry's own requirement) so it
  // only catches what nothing else already handled. No-op if Sentry isn't
  // configured.
  attachSentryErrorHandler(app);

  // Initialize web push (generates VAPID keypair on first boot) and start
  // the bedtime chore reminder scheduler.
  try {
    await initPush();
    // Each scheduler's first tick aligns to the next minute boundary, which
    // can fire within milliseconds of process start — right after a fresh
    // deploy/restart the DB connection pool hasn't finished establishing its
    // first connections yet, so every scheduler's first tick raced that
    // warm-up and logged a burst of "Connection terminated unexpectedly"
    // errors on every restart (confirmed in production logs, harmless —
    // the pool reconnects within seconds and subsequent ticks succeed — but
    // pure noise). A short one-time delay before scheduling any of them
    // gives the pool time to warm up without meaningfully changing when
    // reminders actually fire in steady state.
    setTimeout(() => {
      try {
        startBedtimeReminderScheduler();
        startDailyBriefScheduler();
        startEveningPlanScheduler();
        startInboxScanScheduler();
        startHealthReminderScheduler();
        startWeeklyRecapScheduler();
        startBehaviourTimerScheduler();
        startCelebrationReminderScheduler();
        startTrialReminderScheduler();
      } catch (err) {
        logger.error({ err }, "Failed to start schedulers");
      }
    }, 5000);
  } catch (err) {
    logger.error({ err }, "Failed to initialize push notifications");
  }

  return app;
}

export default buildApp;
