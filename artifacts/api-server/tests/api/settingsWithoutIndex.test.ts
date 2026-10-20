import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * The live database never got calendar_settings' one-row-per-user index, so
 * the settings upsert failed on every save: Stop emails, removing an inbox
 * item, and email filters all answered with an error (2026-10-20). Saving has
 * to work with or without the index.
 */
describe("settings save on a database without the unique index", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;
  let ben: TestFamily;

  before(async () => {
    api = await startApiHarness();
    const { pool } = await import("@workspace/db");
    await pool.query("DROP INDEX IF EXISTS calendar_settings_user_idx");
    await pool.query("DROP INDEX IF EXISTS location_settings_user_idx");
    ava = await api.createFamily("Ava");
    ben = await api.createFamily("Ben");
  });

  after(async () => {
    const { pool } = await import("@workspace/db");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS calendar_settings_user_idx ON calendar_settings (user_id)").catch(() => null);
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS location_settings_user_idx ON location_settings (user_id)").catch(() => null);
    await api?.close();
  });

  test("Stop emails and removing an item save, twice, and only for that family", async () => {
    const mute = await api.as(ava, "/api/ingest/mute", { method: "POST", body: JSON.stringify({ address: "news@shop.com" }) });
    assert.equal(mute.status, 200, await mute.text());
    const again = await api.as(ava, "/api/ingest/mute", { method: "POST", body: JSON.stringify({ address: "deals@shop.com" }) });
    assert.equal(again.status, 200, await again.text());
    const dismiss = await api.as(ava, "/api/ingest/not-relevant", { method: "POST", body: JSON.stringify({ title: "Spirit Day" }) });
    assert.equal(dismiss.status, 200, await dismiss.text());
    const mine = await api.json<{ mutedSenders: string[]; dismissedSlipKeys: string[] }>(ava, "/api/calendar-settings");
    assert.deepEqual(mine.mutedSenders, ["news@shop.com", "deals@shop.com"]);
    assert.deepEqual(mine.dismissedSlipKeys, ["spirit day"]);
    const theirs = await api.json<{ mutedSenders?: string[] }>(ben, "/api/calendar-settings");
    assert.deepEqual(theirs.mutedSenders ?? [], [], "another family's settings are untouched");
  });
});
