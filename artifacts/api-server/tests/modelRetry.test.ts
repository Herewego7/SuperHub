import assert from "node:assert/strict";
import test from "node:test";
import { answerLimitMs, retryDelayMs, retryPolicy, retryReason, withModelRetry } from "../src/ai/modelRetry.ts";
import { conditionText } from "../src/ai/weather.ts";
import { searchChunks } from "../src/ai/parity.ts";

test("a busy Google call is retried, and a normal failure is not", async () => {
  assert.equal(retryReason({ status: 429 }), "busy");
  assert.equal(retryReason({ status: "UNAVAILABLE" }), "busy");
  assert.equal(retryReason({ name: "TimeoutError" }), "noAnswer");
  assert.equal(retryReason(new Error("bad json")), undefined);
  assert.equal(retryPolicy("chat").tries, 3);
  assert.equal(retryPolicy("extract").tries, 6);
  assert.equal(answerLimitMs("chat"), 60_000);
  assert.equal(answerLimitMs("draft"), 30_000);
  assert.equal(answerLimitMs("newsletter"), 180_000);
  assert.equal(answerLimitMs("extract"), 90_000);
  assert.equal(retryDelayMs({ tries: 3, baseMs: 1_000, capMs: 4_000 }, 1, () => 0.5), 500);

  let tries = 0;
  const slept: number[] = [];
  const value = await withModelRetry("chat", async () => {
    tries += 1;
    if (tries < 3) throw Object.assign(new Error("busy"), { status: 429 });
    return "ok";
  }, { sleep: async (ms) => { slept.push(ms); }, random: () => 0 });
  assert.equal(value, "ok");
  assert.equal(tries, 3);
  assert.equal(slept.length, 2);

  await assert.rejects(
    () => withModelRetry("draft", async () => { throw new Error("nope"); }, { sleep: async () => undefined }),
    /nope/,
  );
});

test("rain has a name, and a letter is saved in pieces chat can search", () => {
  assert.equal(conditionText(61), "Rain");
  assert.equal(conditionText(0), "Clear");
  assert.equal(conditionText(95), "Thunderstorms");
  const chunks = searchChunks("a".repeat(4000));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1500);
  assert.equal(searchChunks("a".repeat(20_000)).length, 8);
});
