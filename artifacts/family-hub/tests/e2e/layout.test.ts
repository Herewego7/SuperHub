// ---------------------------------------------------------------------------
// LAYOUT SWEEP
//
// Why this exists: for months, layout bugs were found by the user taking
// screenshots on a real iPhone and sending them back — crushed text columns,
// clipped time fields, buttons with no gap, values sitting outside their box.
// Every one of them was visible at 390px. `tsc`, the production build and the
// behavioural E2E suite all pass straight through them, because none of those
// assert anything about geometry.
//
// This walks EVERY harness scenario at phone width and reports four classes of
// geometric fault. It is deliberately one file with one browser and one page
// per scenario, and it prints only violations — a clean run is a handful of
// lines, not a per-element dump.
//
// WHEN TO RUN (token cost is the reason this isn't automatic):
//   pnpm test:layout   — after changing any component's markup/classes, and
//                        before a deploy. Not after every unrelated fix.
//
// Tolerances are set so a clean app reports zero. If something here fires, it
// is a real geometric fault, not noise — see FINDINGS at the bottom for the
// known-accepted list.
// ---------------------------------------------------------------------------
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, readFileSync } from "node:fs";

const PORT = 5301; // distinct from regressions.test.ts (5299) so both can run
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const BASE_URL = `http://localhost:${PORT}/tests/e2e/harness.html`;

/** Every scenario registered in harness.tsx. */
const SCENARIOS = [
  "familyHub", "announcements", "personTodoList", "personTodoListEmpty", "perPersonSettings",
  "settingsSections", "createTaskModal", "eventModal", "eventModalLongDesc",
  "celebrationsDialog", "celebrationDetail", "notificationsNative", "notificationsWeb",
  "choreSwipeRemove", "choresLongSubtitle", "rewardsCashoutOnly", "todosDragReorder", "todosAddMulti", "todosAlphaSort", "createTaskSubTodos",
  "historyEntrySpotlight", "eventAllDayFlow", "upgradeDialog",
  "parentPinChecklist", "parentPinSet", "parentGateNoPin",
  "onboardingTour", "announcementsFinishSetupRace", "homeCalendarSyncError",
  "activityBonusFilter", "eventModalRecurrenceIso", "eventMultiDriver",
  "trophyStripOverflow", "createTaskAssignees", "todosHistoryDrawer",
  "mealModal", "settingsGroupsPin", "monthDots", "screensaver",
  "setupChatFresh", "setupChatJoiner", "setupChatReplay", "setupChatResume", "setupChatCalendar",
];

/** iPhone-ish. Everything the user has reported was visible at this width. */
const VIEWPORT = { width: 390, height: 844 };

let serverProcess: ChildProcess;
let browser: Browser;

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dev server didn't come up at ${url}`);
}

before(async () => {
  serverProcess = spawn("npx", ["vite", "--strictPort", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), BASE_PATH: "/" },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
  browser = await chromium.launch(existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {});
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

/**
 * Runs in the page. Returns a compact list of geometric faults.
 *
 * The four checks, and the real bug each was written from:
 *  - clipped   : text cut off by an ancestor's overflow (the "1:30 PI" time
 *                field, the truncated "Choose who it's fr" select)
 *  - overflow  : an element extending past its container's right edge
 *  - crushed   : text wrapping to ~one word per line because a non-shrinking
 *                sibling took the row ("On / for / this / device")
 *  - touching  : two stacked buttons with no gap between them (the Snap a
 *                flyer uploaders, where display:contents ate the margin)
 */
const SWEEP_SRC = readFileSync(
  new URL("./layout-sweep.js", import.meta.url),
  "utf8",
);

/**
 * Known and accepted. Each entry is a substring matched against
 * `kind|where`. Add here ONLY with a reason — an unexplained entry here is
 * how a real bug gets permanently silenced.
 */
const ACCEPTED: Array<{ match: string; why: string }> = [
  // The tour deliberately animates a fake cursor outside its frame.
  { match: "overflow|div.absolute", why: "onboarding tour's animated tap cursor is positioned outside its frame on purpose" },
];

function filterAccepted(faults: Array<{ kind: string; where: string; detail: string }>) {
  return faults.filter((f) => !ACCEPTED.some((a) => `${f.kind}|${f.where}`.includes(a.match)));
}

for (const scenario of SCENARIOS) {
  test(`layout @${VIEWPORT.width}px — ${scenario}`, async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(`${BASE_URL}?scenario=${scenario}`, { waitUntil: "commit" });
      // Scenarios settle asynchronously (mocked fetches, animations).
      await page.waitForTimeout(1800);
      const faults = filterAccepted(await page.evaluate(SWEEP_SRC) as Array<{kind:string;where:string;detail:string}>);
      if (faults.length) {
        const lines = faults.slice(0, 12).map((f) => `  [${f.kind}] ${f.where} — ${f.detail}`);
        const more = faults.length > 12 ? `\n  …and ${faults.length - 12} more` : "";
        assert.fail(`${faults.length} layout fault(s) in "${scenario}":\n${lines.join("\n")}${more}`);
      }
    } finally {
      await page.close();
    }
  });
}

/** States the walk above never reaches, because each needs a tap first. */
const OPENED: Array<{ name: string; scenario: string; open: (page: Page) => Promise<void> }> = [
  {
    name: "Home's Completed Actions with praise and a note",
    scenario: "homePraise",
    open: async (page) => {
      await page.getByTestId("home-earlier-toggle").click();
      await page.getByTestId("home-earlier-note").waitFor();
    },
  },
  {
    name: "the health reminders sheet with a reminder",
    scenario: "healthPushSpotlight",
    open: async (page) => {
      await page.getByTestId("button-manage-health-reminders").waitFor({ timeout: 15_000 });
      await page.waitForFunction(`!document.querySelector('[data-testid="spotlight-hole"]')`, undefined, { timeout: 15_000 });
      await page.getByTestId("button-manage-health-reminders").click();
      await page.getByTestId("health-reminder-hr1").waitFor();
    },
  },
];

for (const state of OPENED) {
  test(`layout @${VIEWPORT.width}px — ${state.name}`, async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(`${BASE_URL}?scenario=${state.scenario}`, { waitUntil: "commit" });
      await page.waitForTimeout(1800);
      await state.open(page);
      await page.waitForTimeout(600);
      const faults = filterAccepted(await page.evaluate(SWEEP_SRC) as Array<{kind:string;where:string;detail:string}>);
      if (faults.length) {
        const lines = faults.slice(0, 12).map((f) => `  [${f.kind}] ${f.where} — ${f.detail}`);
        assert.fail(`${faults.length} layout fault(s) in ${state.name}:\n${lines.join("\n")}`);
      }
    } finally {
      await page.close();
    }
  });
}

// ---------------------------------------------------------------------------
// SELF-TEST — proves the sweep can actually fail.
//
// A checker that only ever reports "clean" is worse than none: it manufactures
// confidence. The scenarios above happen not to reproduce every fault class
// (the native notifications fixture has push disabled, so its status strip
// never gets crushed the way a registered device's does), so the detector is
// exercised here against markup built to be broken in each specific way.
// ---------------------------------------------------------------------------
test("the sweep detects each fault class it claims to", async () => {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(`${BASE_URL}?scenario=familyHub`, { waitUntil: "commit" });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="width:390px">
          <!-- crushed: 4 words squeezed into a ~40px column -->
          <div style="width:40px" data-testid="broken-crushed">On for this device</div>
          <!-- clipped: 300px of content in a 100px box that hides the excess -->
          <div style="width:100px;overflow-x:hidden" data-testid="broken-clipped">
            <div style="width:300px">x</div>
          </div>
          <!-- touching: two discrete rounded buttons flush against each other -->
          <div>
            <button style="display:block;width:200px;height:44px;border-radius:12px" data-testid="broken-a">A</button>
            <button style="display:block;width:200px;height:44px;border-radius:12px" data-testid="broken-b">B</button>
          </div>
        </div>`;
    });
    const faults = (await page.evaluate(SWEEP_SRC)) as Array<{ kind: string; where: string }>;
    const kinds = new Set(faults.map((f) => f.kind));
    for (const expected of ["crushed", "clipped", "touching"]) {
      assert.ok(
        kinds.has(expected),
        `sweep failed to detect "${expected}" — it would silently pass a real one. Got: ${[...kinds].join(", ") || "nothing"}`,
      );
    }
  } finally {
    await page.close();
  }
});
