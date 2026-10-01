import { getTableColumns, type SQL } from "drizzle-orm";
import { db, profiles, type InsertProfile, type Profile } from "@workspace/db";

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
  return /column ["']facts["'] does not exist/i.test(texts.join(" "));
}

function columnsWithoutFacts() {
  const columns = getTableColumns(profiles);
  const { facts: _facts, ...rest } = columns;
  return rest;
}

function withEmptyFacts(row: Record<string, unknown>): Profile {
  return { ...row, facts: [] } as Profile;
}

export async function loadProfiles(where?: SQL): Promise<Profile[]> {
  try {
    return where ? await db.select().from(profiles).where(where) : await db.select().from(profiles);
  } catch (error) {
    if (!factsColumnMissing(error)) throw error;
    const columns = columnsWithoutFacts();
    const rows = where ? await db.select(columns).from(profiles).where(where) : await db.select(columns).from(profiles);
    return rows.map((row) => withEmptyFacts(row));
  }
}

export async function insertProfileRow(values: InsertProfile): Promise<Profile> {
  try {
    const [profile] = await db.insert(profiles).values(values).returning();
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
    const [profile] = await db.update(profiles).set(values).where(where).returning();
    return profile;
  } catch (error) {
    if (!factsColumnMissing(error)) throw error;
    if (values.facts) throw error;
    const { facts: _facts, ...rest } = values;
    const [profile] = await db.update(profiles).set(rest).where(where).returning(columnsWithoutFacts());
    return profile ? withEmptyFacts(profile) : undefined;
  }
}
