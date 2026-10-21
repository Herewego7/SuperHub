import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApiHarness, apiTestsEnabled, type ApiHarness, type TestFamily } from "./harness.ts";

/**
 * Asking for one person's completions on a day returned every family's
 * completions for that day: a second .where() replaced the profile filter
 * (2026-10-21).
 */
describe("daily content completions across households", { skip: !apiTestsEnabled() && "TEST_DATABASE_URL is not set" }, () => {
  let api: ApiHarness;
  let ava: TestFamily;
  let ben: TestFamily;

  before(async () => {
    api = await startApiHarness();
    ava = await api.createFamily("Ava");
    ben = await api.createFamily("Ben");
  });
  after(async () => { await api?.close(); });

  test("one person's day holds only their own completions", async () => {
    const { storage } = await import("../../src/storage.ts");
    const day = new Date();
    for (const who of [ava, ben]) {
      const content = await storage.createDailyContent({ userId: who.userId, type: "mission", title: `${who.email} mission`, content: "Be kind." });
      await storage.createDailyContentCompletion({ contentId: content.id, profileId: who.profileId, completedAt: day });
    }
    const date = day.toISOString().slice(0, 10);
    const rows = await api.json<{ profileId: string }[]>(ava, `/api/daily-content-completions?profileId=${ava.profileId}&date=${date}`);
    assert.ok(rows.length > 0, "Ava's completion is there");
    assert.deepEqual([...new Set(rows.map((row) => row.profileId))], [ava.profileId], "and nobody else's");
  });
});
