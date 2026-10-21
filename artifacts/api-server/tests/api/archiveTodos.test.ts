import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * The archive sweep's cutoff went into SQL in the server's local time, so off
 * UTC it was hours off (2026-10-21). Run with TZ set away from UTC.
 */
describe("archiving old finished to-dos", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
  });
  after(async () => { await api?.close(); });

  test("a to-do finished just before the cutoff is archived, one finished just after is not", async () => {
    const { storage } = await import("../../src/storage.ts");
    const { pool } = await import("@workspace/db");
    const make = async (title: string) => (await api.json<{ id: string }>(ava, "/api/chores", {
      method: "POST",
      body: JSON.stringify({ title, taskType: "todo", points: 0, daysOfWeek: [], profileIds: [ava.profileId] }),
    })).id;
    const before = await make("Finished before");
    const after = await make("Finished after");
    const cutoff = new Date(Date.UTC(2026, 8, 1, 12, 0, 0));
    for (const [id, at] of [[before, new Date(cutoff.getTime() - 60 * 60_000)], [after, new Date(cutoff.getTime() + 60 * 60_000)]] as const) {
      await api.json(ava, "/api/chore-completions", {
        method: "POST",
        body: JSON.stringify({ choreId: id, profileId: ava.profileId, points: 0, completedAt: at.toISOString() }),
      });
      // Stored the way the column keeps time: UTC wall clock.
      await pool.query("UPDATE chore_completions SET completed_at = $1::timestamptz AT TIME ZONE 'UTC' WHERE chore_id = $2", [at.toISOString(), id]);
    }
    await storage.archiveOldCompletedTodos(ava.userId, cutoff);
    const rows = await storage.getChoresByUser(ava.userId);
    assert.ok(rows.find((row) => row.id === before)?.archivedAt, "finished an hour before the cutoff: archived");
    assert.equal(rows.find((row) => row.id === after)?.archivedAt ?? null, null, "finished an hour after: kept");
  });
});
