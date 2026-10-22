import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/** Food preferences on profiles (2026-10-22), on a live database that may not have the column yet. */
describe("profile food", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
  });
  after(async () => {
    const { pool } = await import("@workspace/db");
    const { ensureProfileFood } = await import("../../src/db/repairSettings.ts");
    await ensureProfileFood((sql) => pool.query(sql)).catch(() => null);
    await api?.close();
  });

  test("startup adds the column, and food saves", async () => {
    const { pool } = await import("@workspace/db");
    const { ensureProfileFood } = await import("../../src/db/repairSettings.ts");
    await pool.query("ALTER TABLE profiles DROP COLUMN IF EXISTS food");
    assert.deepEqual(await ensureProfileFood((sql) => pool.query(sql)), ["added profiles.food"]);
    assert.deepEqual(await ensureProfileFood((sql) => pool.query(sql)), []);

    const saved = await api.as(ava, `/api/profiles/${ava.profileId}`, { method: "PATCH", body: JSON.stringify({ food: ["Loves tacos", "Peanut allergy"] }) });
    assert.equal(saved.status, 200, await saved.text());
    const people = await api.json<{ id: string; food?: string[] }[]>(ava, "/api/profiles");
    assert.deepEqual(people.find((person) => person.id === ava.profileId)?.food, ["Loves tacos", "Peanut allergy"]);
  });

  test("a profile read that finds the column missing adds it and still loads", async () => {
    const { pool } = await import("@workspace/db");
    await pool.query("ALTER TABLE profiles DROP COLUMN IF EXISTS food");
    const people = await api.as(ava, "/api/profiles");
    assert.equal(people.status, 200, await people.clone().text());
    const { rows } = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'food'");
    assert.equal(rows.length, 1);
  });
});
