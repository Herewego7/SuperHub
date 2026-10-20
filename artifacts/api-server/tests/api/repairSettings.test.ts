import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * The published database missed schema changes after 2026-10-01, so every
 * settings read failed ("column missing?") and fell back to defaults. On
 * start, the server adds what's missing (2026-10-20).
 */
describe("repairing an out-of-date settings table", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
    const mute = await api.as(ava, "/api/ingest/mute", { method: "POST", body: JSON.stringify({ address: "news@shop.com" }) });
    assert.equal(mute.status, 200);
  });

  after(async () => {
    const { pool } = await import("@workspace/db");
    const { repairSettingsTables } = await import("../../src/db/repairSettings.ts");
    await repairSettingsTables((sql) => pool.query(sql)).catch(() => null);
    await api?.close();
  });

  test("missing columns and the index are added back, and saved settings read again", async () => {
    const { pool } = await import("@workspace/db");
    const { repairSettingsTables } = await import("../../src/db/repairSettings.ts");
    await pool.query("DROP INDEX IF EXISTS calendar_settings_user_idx");
    await pool.query("ALTER TABLE calendar_settings DROP COLUMN muted_newsletters, DROP COLUMN inbox_scan_requested_at, DROP COLUMN inbox_scan_started_at, DROP COLUMN inbox_scan_finished_at");
    const broken = await api.json<{ mutedSenders?: string[] }>(ava, "/api/calendar-settings");
    assert.deepEqual(broken.mutedSenders ?? [], [], "an out-of-date table reads as defaults");

    const done = await repairSettingsTables((sql) => pool.query(sql));
    assert.ok(done.includes("added calendar_settings.muted_newsletters"), done.join("; "));
    assert.ok(done.includes("added calendar_settings_user_idx"), done.join("; "));
    assert.deepEqual(await repairSettingsTables((sql) => pool.query(sql)), [], "a second run has nothing to do");

    const fixed = await api.json<{ mutedSenders: string[]; mutedNewsletters: string[] }>(ava, "/api/calendar-settings");
    assert.deepEqual(fixed.mutedSenders, ["news@shop.com"], "what was saved before reads again");
    assert.deepEqual(fixed.mutedNewsletters, []);
    const dismiss = await api.as(ava, "/api/ingest/not-relevant", { method: "POST", body: JSON.stringify({ title: "Spirit Day" }) });
    assert.equal(dismiss.status, 200, await dismiss.text());
  });

  test("the index is left off when a user has two rows", async () => {
    const { pool } = await import("@workspace/db");
    const { repairSettingsTables } = await import("../../src/db/repairSettings.ts");
    await pool.query("DROP INDEX IF EXISTS calendar_settings_user_idx");
    await pool.query(`INSERT INTO calendar_settings (user_id) VALUES ('${ava.userId}')`);
    const done = await repairSettingsTables((sql) => pool.query(sql));
    assert.ok(done.some((line) => line.startsWith("left calendar_settings_user_idx off")), done.join("; "));
    await pool.query(`DELETE FROM calendar_settings WHERE user_id = '${ava.userId}' AND muted_senders = '[]'::jsonb`);
  });
});
