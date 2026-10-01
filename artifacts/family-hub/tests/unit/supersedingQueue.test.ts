import { test } from "node:test";
import assert from "node:assert/strict";
import { createSupersedingQueue } from "../../src/lib/supersedingQueue.ts";

const SUPERSEDED = "superseded" as const;
const queue = () => createSupersedingQueue<string>(() => SUPERSEDED);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test("only the newest of a synchronous burst runs at all", async () => {
  // An effect that fires several times in a row queues several syncs before
  // any of them start. Running them in turn would mean iOS is handed stale
  // lists on the way to the current one, for no benefit.
  const ran: string[] = [];
  const q = queue();
  const results = await Promise.all(
    [1, 2, 3].map((n) => q.run(async () => { ran.push(String(n)); return String(n); })),
  );
  assert.deepEqual(ran, ["3"]);
  assert.deepEqual(results, [SUPERSEDED, SUPERSEDED, "3"]);
});

test("jobs never overlap", async () => {
  const order: string[] = [];
  const q = queue();
  const a = q.run(async () => {
    order.push("a:start");
    await new Promise((r) => setTimeout(r, 20));
    order.push("a:end");
    return "a";
  });
  // Nothing in between: with only two jobs the second is never superseded.
  await a;
  await q.run(async () => {
    order.push("b:start");
    order.push("b:end");
    return "b";
  });
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
});

test("a job queued behind another is dropped when a newer one arrives", async () => {
  // This is the exact shape of the medication-reminder bug: the STALE job is
  // the one still waiting its turn, and running it is what cancelled the
  // notification a fresher job had just scheduled.
  const ran: string[] = [];
  const q = queue();
  const gate = deferred();
  const started = deferred();

  const first = q.run(async () => {
    ran.push("first"); started.resolve(); await gate.promise; return "first";
  });
  // Wait until it is genuinely in flight. Queue everything synchronously
  // instead and even the first job is superseded before it begins — correct,
  // but not the situation that broke the reminders.
  await started.promise;
  const stale = q.run(async () => { ran.push("stale"); return "stale"; });   // old data
  const fresh = q.run(async () => { ran.push("fresh"); return "fresh"; });   // new data

  gate.resolve();
  assert.equal(await first, "first");
  assert.equal(await stale, SUPERSEDED, "the stale job must not run");
  assert.equal(await fresh, "fresh");
  assert.deepEqual(ran, ["first", "fresh"], "only the first and the newest job may touch anything");
});

test("the newest job always runs, however many pile up behind one", async () => {
  const ran: string[] = [];
  const q = queue();
  const gate = deferred();
  const started = deferred();

  const first = q.run(async () => {
    ran.push("0"); started.resolve(); await gate.promise; return "0";
  });
  await started.promise;
  const queued = [1, 2, 3, 4].map((n) => q.run(async () => { ran.push(String(n)); return String(n); }));

  gate.resolve();
  await first;
  const results = await Promise.all(queued);
  assert.deepEqual(results, [SUPERSEDED, SUPERSEDED, SUPERSEDED, "4"]);
  assert.deepEqual(ran, ["0", "4"]);
});

test("a thrown job does not wedge the queue", async () => {
  // Scheduling can reject — iOS refusing permission is the obvious case. If
  // that poisoned the chain, every later sync would be dropped and reminders
  // would stop updating entirely, which is worse than the failure itself.
  const q = queue();
  await assert.rejects(q.run(async () => { throw new Error("iOS said no"); }));
  assert.equal(await q.run(async () => "after"), "after");
});
