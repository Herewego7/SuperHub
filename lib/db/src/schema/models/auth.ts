import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  displayName: varchar("display_name"),
  profileImageUrl: varchar("profile_image_url"),
  // How this account authenticates. 'replit' covers legacy/internal accounts
  // created via Replit OIDC; 'email' and 'apple' are the public-facing methods.
  authProvider: varchar("auth_provider").notNull().default("replit"),
  // scrypt hash in "salt:hash" hex form; only set for authProvider === 'email'.
  passwordHash: varchar("password_hash"),
  // Apple's stable per-team user identifier ("sub" claim); only set for
  // authProvider === 'apple'. Unique so a returning Apple user is found by it
  // even if Apple withholds the email on subsequent sign-ins.
  appleUserId: varchar("apple_user_id").unique(),
  // Marks when THIS account (not the family) finished — or was force-passed
  // through — the first-run onboarding wizard. Defaults to now() so the
  // migration backfills every pre-existing account as already onboarded;
  // every genuinely new-account creation path explicitly overrides this to
  // null so the wizard actually shows for them. Deliberately separate from
  // the family-level `onboarding_status` table, which tracks per-family
  // skippable steps (location/rewards/invite) for the reminder banner, not
  // per-account "has this login ever seen the wizard at all."
  onboardingCompletedAt: timestamp("onboarding_completed_at").default(sql`now()`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Password-reset tokens for email/password accounts.
// (IMPORTANT) The raw token is only ever emailed to the user — never stored.
// tokenHash is a SHA-256 hex digest of the raw token, so a DB leak alone
// doesn't hand out usable reset links. One row per outstanding request; a new
// forgot-password request replaces (deletes) any prior rows for that user, so
// only the most recently requested link works.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("IDX_password_reset_user").on(table.userId)]
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

/**
 * One in-flight calendar OAuth connection.
 *
 * Replaces an HMAC-signed state blob whose single-use protection lived in a
 * process-local Map — which Replit Autoscale forgets whenever it recycles the
 * container, reopening a replay window, and which a second instance would
 * never share.
 *
 * The token handed to Google or Outlook is opaque randomness; only its SHA-256
 * hash is stored, the same way password reset tokens work here. Single use is
 * an atomic UPDATE ... WHERE consumed_at IS NULL, so exactly one caller can
 * ever win — a guarantee no in-memory structure can make across processes.
 */
export const oauthTransactions = pgTable(
  "oauth_transactions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** SHA-256 of the opaque state. The raw value is never stored. */
    stateHash: varchar("state_hash").notNull().unique(),
    /** "google" | "outlook" — a state minted for one must not work on the other. */
    provider: varchar("provider").notNull(),
    /**
     * The LOGIN account that began the flow, not the family owner. Checked
     * again on the callback: someone removed from the family between starting
     * and finishing must not be able to complete it.
     */
    accountUserId: varchar("account_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The household, which is what profiles.userId holds. */
    familyOwnerUserId: varchar("family_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: varchar("profile_id").notNull(),
    /**
     * "web" | "native". An ENUM, not a URL: the redirect target used to travel
     * from the client and get written into window.location, so an allowlist
     * was the only thing between it and an open redirect. The server now
     * derives the target from this plus the provider, and nothing a client
     * sends can influence it.
     */
    redirectMode: varchar("redirect_mode").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set by the atomic consume. Non-null means already used. */
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("IDX_oauth_tx_expires").on(table.expiresAt),
    index("IDX_oauth_tx_account").on(table.accountUserId),
  ]
);

export type OAuthTransaction = typeof oauthTransactions.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Backlog of "couldn't find my answer in the Knowledge Base" questions,
// submitted from the KB's search-miss "Ask us" form. This table is NOT where
// KB articles live (those are code, see family-hub/src/kb/articles) — it's
// purely a submissions log so duplicate questions can be spotted and turned
// into new articles. `searchQuery` (what they searched before asking) and
// `appContext` (tab/platform/app version) are optional context to help write
// the eventual article; `answeredAt` is set manually once a reply is sent.
export const kbQuestions = pgTable(
  "kb_questions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    searchQuery: text("search_query"),
    appContext: text("app_context"),
    answeredAt: timestamp("answered_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("IDX_kb_questions_user").on(table.userId)]
);

export type KbQuestion = typeof kbQuestions.$inferSelect;
export type InsertKbQuestion = typeof kbQuestions.$inferInsert;

// One row per login account (userId), tracking the free-trial-then-subscribe
// launch (2026-08). isComped defaults to TRUE — same "the migration backfills
// every pre-existing account as already-onboarded" idiom `users.
// onboardingCompletedAt` already uses above — so every account that exists
// BEFORE this ships is automatically, atomically grandfathered as
// permanently-free the moment the migration runs, with no separate follow-up
// step that could leave a window where an existing family could be gated.
// Every genuinely new signup path explicitly sets isComped: false and stamps
// trialStartedAt/trialEndsAt instead.
//
// Deliberately NOT a single "status" enum kept in sync by hand — isEntitled()
// (lib/subscriptionEntitlement.ts, api-server) derives the answer fresh from
// these raw facts every time, so there's no separate cached field that could
// silently drift out of sync with the trial dates / comp flag / Apple's own
// subscription state.
export const entitlements = pgTable(
  "entitlements",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),

    // Comp override — always wins over trial/subscription state, both
    // directions (a comped account is never gated; comped:false with no
    // trial/subscription is gated). compedReason/compedBy are free text for
    // your own record-keeping (e.g. "friend", "press", "pre-launch user"),
    // never shown to the account itself.
    isComped: boolean("is_comped").notNull().default(true),
    compedReason: text("comped_reason"),
    compedBy: text("comped_by"),

    // App-side trial clock (Option A from the 2026-08-24 plan) — stamped
    // once, at genuine account creation, never re-stamped on later logins.
    trialStartedAt: timestamp("trial_started_at"),
    trialEndsAt: timestamp("trial_ends_at"),

    // Raw facts from Apple's App Store Server API / Server Notifications V2 —
    // kept as-received rather than reinterpreted, so a future bug in our own
    // derivation logic can be fixed without needing to re-fetch from Apple.
    appleOriginalTransactionId: varchar("apple_original_transaction_id").unique(),
    appleProductId: varchar("apple_product_id"),
    // Apple's own subscription status string, e.g. "ACTIVE" / "EXPIRED" /
    // "IN_BILLING_RETRY_PERIOD" / "IN_GRACE_PERIOD" / "REVOKED". Trusted
    // directly for the grace-period case rather than re-deriving it from
    // appleExpiresAt ourselves — Apple's own state already accounts for
    // billing retries correctly.
    appleSubscriptionState: varchar("apple_subscription_state"),
    appleExpiresAt: timestamp("apple_expires_at"),
    appleAutoRenewStatus: boolean("apple_auto_renew_status"),

    // Persisted dedup for the 3 trial-reminder pushes (7d/2d/1d-left) — same
    // "persisted, not in-memory" reasoning as celebrationReminders'
    // reminder30SentYear/reminder7SentYear: this scheduler ticks continuously,
    // so an in-memory-only dedup would double-send across a process restart.
    trial7dReminderSentAt: timestamp("trial_7d_reminder_sent_at"),
    trial2dReminderSentAt: timestamp("trial_2d_reminder_sent_at"),
    trial1dReminderSentAt: timestamp("trial_1d_reminder_sent_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("IDX_entitlements_user").on(table.userId)]
);

export type Entitlement = typeof entitlements.$inferSelect;
export type InsertEntitlement = typeof entitlements.$inferInsert;
