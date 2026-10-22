import { getTableColumns, type SQL } from "drizzle-orm";
import { db, pool, profiles, type InsertProfile, type Profile } from "@workspace/db";

/**
 * Profile columns added after the live database last took schema changes.
 * Startup adds them; until it has, reads and writes carry on without them
 * instead of failing every profile query.
 */
const LATE_COLUMNS = ["facts", "food"] as const;

export function factsColumnMissing(error: unknown): boolean {
  const seen = new Set<unknown>();
  const texts: string[] = [];
  let current: unknown = error;
  while (current && !seen.has(current) && texts.length < 6) {
    seen.add(current);
    if (typeof current === "string") texts.push(current);
    else if (current instanceof Error) texts.push(current.message);
    else if (typeof current === "object" && "message" in current) texts.push(String((current as { message: unknown }).message));
    current = typeof current === "object" && current && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  // Postgres names it either way: column "food" of relation "profiles", or
  // column profiles.food when the query qualifies it.
  return /column (?:["']?\w+["']?\.)?["']?(?:facts|food)["']?(?: of relation ["'][^"']+["'])? does not exist/i.test(texts.join(" "));
}

function columnsWithoutFacts() {
  const columns: Record<string, unknown> = { ...getTableColumns(profiles) };
  for (const name of LATE_COLUMNS) delete columns[name];
  return columns as Omit<ReturnType<typeof getTableColumns<typeof profiles>>, (typeof LATE_COLUMNS)[number]>;
}

function withEmptyFacts(row: Record<string, unknown>): Profile {
  return { ...row, facts: [], food: [] } as unknown as Profile;
}

/**
 * Adds the late columns the moment a query finds one missing, so the query can
 * simply run again. An insert names every column, so leaving one out was never
 * possible there: creating the All Family profile failed (2026-10-22).
 */
async function addLateColumns(): Promise<boolean> {
  try {
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS facts text[] NOT NULL DEFAULT '{}'::text[]");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS food text[] NOT NULL DEFAULT '{}'::text[]");
    return true;
  } catch {
    return false;
  }
}

/** Runs a profile query; if a late column is missing, adds it and runs it once more. */
async function healing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!factsColumnMissing(error) || !(await addLateColumns())) throw error;
    return run();
  }
}

export async function loadProfiles(where?: SQL): Promise<Profile[]> {
  try {
    return await healing(() => (where ? db.select().from(profiles).where(where) : db.select().from(profiles)));
  } catch (error) {
    if (!factsColumnMissing(error)) throw error;
    const columns = columnsWithoutFacts();
    const rows = where ? await db.select(columns).from(profiles).where(where) : await db.select(columns).from(profiles);
    return rows.map((row) => withEmptyFacts(row));
  }
}

export async function insertProfileRow(values: InsertProfile): Promise<Profile> {
  try {
    const [profile] = await healing(() => db.insert(profiles).values(values).returning());
    return profile;
  } catch (error) {
    if (!factsColumnMissing(error)) throw error;
    const [profile] = await db.insert(profiles).values(values).returning(columnsWithoutFacts());
    return withEmptyFacts(profile);
  }
}

export async function updateProfileRow(
  values: Partial<InsertProfile>,
  where: SQL,
): Promise<Profile | undefined> {
  try {
    const [profile] = await healing(() => db.update(profiles).set(values).where(where).returning());
    return profile;
  } catch (error) {
    if (!factsColumnMissing(error)) throw error;
    if (values.facts || values.food) throw error;
    const { facts: _facts, food: _food, ...rest } = values;
    const [profile] = await db.update(profiles).set(rest).where(where).returning(columnsWithoutFacts());
    return profile ? withEmptyFacts(profile) : undefined;
  }
}
