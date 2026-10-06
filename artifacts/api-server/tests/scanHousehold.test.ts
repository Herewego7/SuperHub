import assert from "node:assert/strict";
import test from "node:test";
import { INBOX_INITIAL_DAYS, INBOX_RECENT_DAYS } from "../src/ingest/parse.ts";
import { scanConnectedInboxes, type InboxScanDeps } from "../src/ingest/scanHousehold.ts";
import { emptyTally, lastInboxRead, SCAN_BEAT_MS, SCAN_LOCK_MS } from "../src/ingest/scanProgress.ts";

type Outcome = { needsReconnect?: boolean; mailProblem?: "scope" | "unavailable" | null };

const readResult = (outcome: Outcome = {}) => ({
  todos: [],
  events: [],
  scanOff: false,
  connected: 2,
  needsReconnect: false,
  mailProblem: null,
  ...outcome,
});

function deps(over: Partial<InboxScanDeps> = {}): InboxScanDeps {
  return {
    claim: async () => true,
    beat: async () => {},
    finish: async () => {},
    read: async () => readResult(),
    ...over,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// One parent's mail was read and the other's couldn't be. Home waits for "finished"
// before it refreshes, so a read that never says so leaves the banner spinning all day.
test("a full read reports done when one mailbox couldn't be opened", async () => {
  const blocked: Record<string, Outcome> = {
    "calendar-only": { mailProblem: "scope" },
    "sign-in expired": { needsReconnect: true },
  };
  for (const [label, outcome] of Object.entries(blocked)) {
    const userId = `blocked-${label}`;
    const finished: string[] = [];
    await scanConnectedInboxes(userId, INBOX_INITIAL_DAYS, deps({
      finish: async (id) => { finished.push(id); },
      read: async () => readResult(outcome),
    }));
    assert.deepEqual(finished, [userId], `a ${label} mailbox left the read unfinished`);
  }
});

// Downloading a month of mail can outlast the lock, and a lock that looks abandoned
// lets the scheduled job start a second copy of the same read.
test("a full read keeps its lock fresh while it downloads, then lets go", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const beats: number[] = [];
  let endRead!: () => void;
  const reading = new Promise<void>((resolve) => { endRead = resolve; });
  const run = scanConnectedInboxes("slow-download", INBOX_INITIAL_DAYS, deps({
    beat: async () => { beats.push(Date.now()); },
    read: async () => {
      await reading;
      return readResult();
    },
  }));
  await settle();
  let fresh = Date.now();
  for (let minute = 1; minute <= 30; minute++) {
    t.mock.timers.tick(60_000);
    fresh = beats.at(-1) ?? fresh;
    assert.ok(Date.now() - fresh < SCAN_LOCK_MS, `the lock went stale ${minute} minutes into the read`);
  }
  endRead();
  await run;
  const count = beats.length;
  t.mock.timers.tick(SCAN_LOCK_MS);
  assert.equal(beats.length, count, "the lock kept refreshing after the read finished");
});

// A refresh that lands after "finished" makes the lock look held again, and the next
// Scan now is turned away for ten minutes.
test("a read is marked finished only after its last lock refresh lands", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log: string[] = [];
  let landBeat!: () => void;
  let endRead!: () => void;
  const reading = new Promise<void>((resolve) => { endRead = resolve; });
  const run = scanConnectedInboxes("late-beat", INBOX_INITIAL_DAYS, deps({
    beat: () => new Promise<void>((resolve) => {
      log.push("beat sent");
      landBeat = () => {
        log.push("beat landed");
        resolve();
      };
    }),
    finish: async () => { log.push("finished"); },
    read: async () => {
      await reading;
      return readResult();
    },
  }));
  await settle();
  t.mock.timers.tick(SCAN_BEAT_MS);
  endRead();
  await settle();
  assert.deepEqual(log, ["beat sent"], "the read was marked finished before its last refresh landed");
  landBeat();
  await run;
  assert.deepEqual(log, ["beat sent", "beat landed", "finished"]);
});

// A read that adds nothing looks the same on Home whatever the cause. The summary says
// which mailboxes were read, how many emails each had, and what became of them.
test("a full read leaves a summary of what it read", async () => {
  const tally = { ...emptyTally(40, "vertex"), skipped: 2, triageSaidNo: 30, readSaidNo: 4, readFailed: 1, nothingNew: 1, used: 2 };
  const mailboxes = [{ address: "dad@example.com", emails: 40 }, { address: "mom@example.com", emails: 0, problem: "scope" }];
  await scanConnectedInboxes("summary", INBOX_INITIAL_DAYS, deps({
    read: async () => ({ ...readResult({ mailProblem: "scope" }), todos: [{}, {}], events: [{}], mailboxes, tally }),
  }));
  const summary = lastInboxRead("summary");
  assert.ok(summary, "the read left no summary");
  assert.deepEqual(summary.mailboxes, mailboxes);
  assert.equal(summary.reader, "vertex");
  assert.equal(summary.triageSaidNo, 30);
  assert.equal(summary.todos, 2);
  assert.equal(summary.events, 1);
});

// The half-hourly check reads two days, and would bury the month-long read's result.
test("the regular check keeps the last full read's summary", async () => {
  await scanConnectedInboxes("kept", INBOX_INITIAL_DAYS, deps({ read: async () => ({ ...readResult(), tally: emptyTally(40, "vertex") }) }));
  await scanConnectedInboxes("kept", INBOX_RECENT_DAYS, deps({ read: async () => ({ ...readResult(), tally: emptyTally(3, "vertex") }) }));
  assert.equal(lastInboxRead("kept")?.emails, 40, "the regular check replaced the full read's summary");
});
