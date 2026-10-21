/**
 * Brings the live database's calendar_settings table up to what the code
 * expects, on every start.
 *
 * The published database stopped taking schema changes around 2026-10-01: it
 * never got the one-row-per-user index, and later columns (inbox scan times,
 * hidden newsletters) were missing. Every settings read failed and fell back
 * to defaults, and every save failed, so stopped senders, removed items and
 * email filters never stuck (2026-10-20).
 *
 * Only additive steps: a missing column is added with the default the schema
 * gives it, and the unique index is added only when no user has two rows.
 * Nothing is changed or removed.
 */

type Query = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;

/** Every calendar_settings column after id and user_id, as the schema declares it. */
export const SETTINGS_COLUMNS: [name: string, definition: string][] = [
  ["start_hour", "integer DEFAULT 8"],
  ["end_hour", "integer DEFAULT 22"],
  ["week_starts_on", "integer DEFAULT 0"],
  ["two_way_sync_enabled", "boolean DEFAULT true"],
  ["family_calendar_id", "text"],
  ["family_calendar_profile_id", "text"],
  ["family_calendar_provider", "text"],
  ["scan_inbox", "boolean NOT NULL DEFAULT true"],
  ["inbox_scan_requested_at", "timestamp"],
  ["inbox_scan_started_at", "timestamp"],
  ["inbox_scan_finished_at", "timestamp"],
  ["share_originals", "boolean NOT NULL DEFAULT false"],
  ["meals_on_calendar", "boolean NOT NULL DEFAULT false"],
  ["muted_senders", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ["muted_newsletters", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ["dismissed_slip_keys", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ["plan_sent_keys", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ["created_at", "timestamp DEFAULT now()"],
  ["updated_at", "timestamp DEFAULT now()"],
];

/** What it did, for the log. */
export async function repairSettingsTables(query: Query): Promise<string[]> {
  const done: string[] = [];
  const existing = new Set(
    (await query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'calendar_settings'"))
      .rows.map((row) => String(row.column_name)),
  );
  if (existing.size === 0) return done;
  for (const [name, definition] of SETTINGS_COLUMNS) {
    if (existing.has(name)) continue;
    await query(`ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
    done.push(`added calendar_settings.${name}`);
  }
  for (const table of ["calendar_settings", "location_settings"]) {
    const index = `${table}_user_idx`;
    const has = await query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = '${index}'`);
    if (has.rows.length > 0) continue;
    const doubled = await query(`SELECT user_id FROM ${table} WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1 LIMIT 1`).catch(() => null);
    if (!doubled) continue;
    if (doubled.rows.length > 0) {
      done.push(`left ${index} off: a user has more than one ${table} row`);
      continue;
    }
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${table} (user_id)`);
    done.push(`added ${index}`);
  }
  return done;
}

/**
 * The emails-already-read table (2026-10-21), created here because the live
 * database doesn't reliably take schema pushes. New, so it can't hold rows
 * that would block its unique index.
 */
export async function ensureReadMailTable(query: Query): Promise<string[]> {
  const has = await query("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'read_mail'");
  const done: string[] = [];
  if (has.rows.length === 0) {
    await query(`CREATE TABLE IF NOT EXISTS read_mail (
      user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_profile_id varchar NOT NULL,
      provider text NOT NULL,
      message_id text NOT NULL,
      read_at timestamp NOT NULL DEFAULT now()
    )`);
    done.push("added read_mail");
  }
  await query("CREATE UNIQUE INDEX IF NOT EXISTS read_mail_message_idx ON read_mail (owner_profile_id, provider, message_id)");
  await query("CREATE INDEX IF NOT EXISTS read_mail_user_idx ON read_mail (user_id)");
  return done;
}
