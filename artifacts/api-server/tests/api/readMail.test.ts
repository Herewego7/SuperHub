import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/** The emails-already-read table: made on start when missing, kept per household, pruned (2026-10-21). */
describe("remembering read mail", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;
  let ben: TestFamily;

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
    ben = await api.createFamily("Ben");
  });
  after(async () => { await api?.close(); });

  test("the table is made when missing, rows are kept per family, repeats are ignored, and old rows pruned", async () => {
    const { pool } = await import("@workspace/db");
    const { ensureReadMailTable } = await import("../../src/db/repairSettings.ts");
    const { storage } = await import("../../src/storage.ts");
    await pool.query("DROP TABLE IF EXISTS read_mail");
    assert.deepEqual(await ensureReadMailTable((sql) => pool.query(sql)), ["added read_mail"]);
    assert.deepEqual(await ensureReadMailTable((sql) => pool.query(sql)), [], "a second start has nothing to do");

    await storage.rememberReadMail(ava.userId, [
      { ownerProfileId: ava.profileId, provider: "gmail", messageId: "m1" },
      { ownerProfileId: ava.profileId, provider: "gmail", messageId: "m2" },
    ]);
    await storage.rememberReadMail(ava.userId, [{ ownerProfileId: ava.profileId, provider: "gmail", messageId: "m1" }]);
    await storage.rememberReadMail(ben.userId, [{ ownerProfileId: ben.profileId, provider: "outlook", messageId: "b1" }]);
    const long = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const avas = await storage.getReadMail(ava.userId, long);
    assert.deepEqual(avas.map((row) => row.messageId).sort(), ["m1", "m2"], "a repeat is ignored, and Ben's mail isn't Ava's");

    await pool.query("UPDATE read_mail SET read_at = now() - interval '90 days' WHERE message_id = 'm2'");
    await storage.pruneReadMail(ava.userId, new Date(Date.now() - 75 * 24 * 60 * 60 * 1000));
    assert.deepEqual((await storage.getReadMail(ava.userId, long)).map((row) => row.messageId), ["m1"], "old rows are pruned");
    assert.equal((await storage.getReadMail(ben.userId, long)).length, 1, "another family's rows stay");
  });
});
