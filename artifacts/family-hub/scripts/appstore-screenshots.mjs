#!/usr/bin/env node
// App Store screenshots at Apple's exact required pixel sizes.
//
//   iPhone  1320 x 2868  (6.9" Pro Max)  = 440 x 956  logical @3x
//   iPad    2064 x 2752  (13")           = 1032 x 1376 logical @2x
//
// Rendered from the real app against the `marketingShots` fixture — a
// believable family on an ordinary day. Deliberately NOT screenshotInventory,
// which is a stress-test fixture full of deliberately absurd strings.
// Usage: SHOT_DIR=/path/to/out node scripts/appstore-screenshots.mjs
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = 5302;
const BASE = `http://localhost:${PORT}/tests/e2e/harness.html?scenario=marketingShots`;
const OUT = process.env.SHOT_DIR || "/tmp/appstore-shots";
mkdirSync(OUT, { recursive: true });

// The sandbox runs on UTC, so an unfrozen clock stamps whatever hour the
// render happened to run at — 2:11 AM on the first pass, which is not a time a
// family app gets opened. Frozen to a school-morning hour in a real timezone:
// the kids' chores are part-done, Mom has finished hers, and the day's events
// are all still ahead. Date.now() is fixed; timers still run, so the app boots
// and settles normally.
// ⚠️ The offset is not optional. A bare "2026-09-15T08:15:00" is parsed in the
// NODE process's zone (UTC here), which rendered as 3:15 AM in Chicago — the
// exact problem this constant exists to fix. Spell the offset out so the
// wall-clock time in TIMEZONE is what you asked for.
const SHOT_TIME = new Date("2026-09-15T08:15:00-05:00");
const TIMEZONE = "America/Chicago";

// ⚠️ App Store Connect has a slot per display size and rejects anything that
// isn't that slot's exact pixel size. 440x956@3x = 1320x2868 is the 6.9-inch
// slot (iPhone 16 Pro Max); 428x926@3x = 1284x2778 is the 6.7-inch one, which
// is what the upload asks for when the newer slot isn't being used.
const DEVICES = [
  { id: "iphone", width: 440, height: 956, scale: 3 },      // 1320 x 2868
  { id: "iphone67", width: 428, height: 926, scale: 3 },    // 1284 x 2778
  { id: "ipad", width: 1032, height: 1376, scale: 2 },      // 2064 x 2752
];

// `tab` switches first; `scroll` then scrolls the page by that many pixels
// (the profile circles shrink as you scroll, which is a look worth showing);
// `profile` taps a person's photo first, so not every shot is All Family.
const SHOTS = [
  { id: "1-home", tab: null },
  { id: "2-home-scrolled", tab: null, scroll: 700 },
  // The Achievements card sits well down Home and had never appeared in a shot.
  { id: "2b-home-achievements", tab: null, scrollToTestId: "achievements-card", scrollBack: 120, only: "ipad" },
  // `settleGone` waits for the filter to have actually taken effect. Filtering
  // to Ava removes Noah's soccer practice, but the row keeps its 76px of space
  // while it animates out — so a shot fired too early shows a hole in the card
  // where an invisible row still is.
  //
  // An earlier attempt waited for the text "247" (Ava's star total) and was
  // worthless: that number is also in the Stars card, so it matched instantly
  // and waited for nothing.
  { id: "3-home-one-person", tab: null, profile: "Ava", settleGone: "Soccer practice" },
  { id: "4-calendar-day", tab: "calendar-tab", scrollInner: 620 },
  // Month view on BOTH devices now. It used to be iPad-only because an iPhone
  // month cell is too narrow for an event title, so every chip collapsed to the
  // driver's name — the phone now shows the dots-and-tap grid instead, which is
  // built for exactly that width.
  { id: "5-calendar-month", tab: "calendar-tab", click: "Month" },
  // WORK WEEK, not Week: five columns instead of seven gives each day enough
  // width for the event title to survive alongside the driver chip and the
  // assignee avatars. At seven columns every title truncates to "Sch…".
  { id: "6-calendar-week", tab: "calendar-tab", click: "Work week", only: "ipad" },
  { id: "7-chores", tab: "chores-tab" },
  { id: "8-chores-scrolled", tab: "chores-tab", scroll: 600 },
  // The reward shelf sits further down the Chores tab.
  { id: "9-rewards", tab: "chores-tab", scrollTo: "Rewards", scrollBack: 230 },
  { id: "10-todos", tab: "todos-tab" },
  { id: "11-meals", tab: "meals-tab", clickTestId: "next-date-button" },
  // The grocery list and the saved-idea library are below the week grid.
  { id: "12-meals-grocery", tab: "meals-tab", clickTestId: "next-date-button", scrollTo: "This Week's Meals" },
  // The grocery list is a destination behind a button in the Meals toolbar,
  // not part of the tab itself — "12-meals-grocery" shows the planner the
  // list is built FROM, which is a different screen.
  { id: "14-grocery", tab: "meals-tab", clickTestId: "meals-open-grocery" },
  // Celebrations opens from the calendar toolbar, not a tab of its own.
  { id: "13-celebrations", tab: "calendar-tab", clickTestId: "open-celebrations-toolbar-button" },
];


async function waitForServer(url, timeoutMs = 40_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("dev server never came up");
}

const server = spawn("npx", ["vite", "--strictPort", "--port", String(PORT)], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), BASE_PATH: "/" }, stdio: "ignore",
});
try {
  await waitForServer(`http://localhost:${PORT}/tests/e2e/harness.html`);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  for (const d of DEVICES) {
    for (const shot of SHOTS) {
      if (shot.only && shot.only !== d.id) continue;
      // ONLY=<shot id fragment> runs a single shot, for debugging one picture
      // without re-rendering the other twenty-two.
      if (process.env.ONLY && !shot.id.includes(process.env.ONLY)) continue;
      if (process.env.ONLY_DEVICE && d.id !== process.env.ONLY_DEVICE) continue;
      // ⚠️ A FRESH PAGE per shot, not one page navigated twelve times.
      // Sharing a page produced cards that were populated in the DOM and blank
      // in the picture — the Chores list, the Stars card, the reward shelf —
      // from the seventh shot onward, while the identical sequence on a new
      // page rendered perfectly every time (2026-09-17). Whatever accumulates
      // across navigations under a frozen clock, a new page does not inherit
      // it, and a screenshot run is not worth the time it would take to find
      // out which of the several candidates it is.
      // ⚠️ A fresh CONTEXT per shot, not just a fresh page. localStorage lives
      // on the context, so shots taken later in a run inherited whatever the
      // earlier ones left behind — which is how the same shot came out clean
      // on its own and with a blank row-shaped gap in the Events card during a
      // full run (2026-09-17). Slower, and the only version that produces the
      // same picture every time.
      const ctx = await browser.newContext({
        viewport: { width: d.width, height: d.height },
        deviceScaleFactor: d.scale,
        isMobile: d.id.startsWith("iphone"),
        hasTouch: true,
        timezoneId: TIMEZONE,
      });
      const page = await ctx.newPage();
      await page.clock.setFixedTime(SHOT_TIME);
      await page.goto(BASE);
      // Generous on purpose. Cards fade their contents in, and a shot fired
      // mid-entrance catches them at opacity 0 — which produced a Stars card
      // that was correctly populated in the DOM and completely blank in the
      // picture (2026-09-15).
      await page.waitForTimeout(5500);

      if (shot.tab) {
        const el = page.locator(`[data-testid="${shot.tab}"]`);
        if (await el.count() === 0) { console.log(`skip ${d.id} ${shot.id}: no ${shot.tab}`); continue; }
        await el.first().click();
        await page.waitForTimeout(2600);
      }
      if (shot.profile) {
        const el = page.getByText(shot.profile, { exact: true }).first();
        if (await el.count() === 0) { console.log(`skip ${d.id} ${shot.id}: no ${shot.profile}`); continue; }
        await el.click();
        // Six seconds, not two. Filtering removes rows, and a removed row
        // animates out over longer than the text takes to disappear — the
        // Events card kept its blank gap through two earlier attempts to time
        // this precisely. Waiting it out is cheap and does not need to be
        // right about the animation's duration.
        await page.waitForTimeout(6000);
      }
      if (shot.settleGone) {
        await page.waitForFunction(
          `!document.body.innerText.includes(${JSON.stringify(shot.settleGone)})`,
          { timeout: 20_000 },
        ).catch(() => console.log(`  ⚠️  "${shot.settleGone}" never left the page`));
        // The text going is not the same as the SPACE going. A filtered-out row
        // keeps its height while it animates away, which is how the Events card
        // shipped with a blank gap where an invisible row still sat. Wait for
        // the card's own height to stop changing.
        await page.waitForFunction(`(() => {
          const card = document.querySelector('[data-testid="events-card"]')
            || [...document.querySelectorAll('div')].find(d => /View All \\d+ Events/.test(d.innerText || ""));
          if (!card) return true;
          const h = Math.round(card.getBoundingClientRect().height);
          const last = window.__lastCardH;
          window.__lastCardH = h;
          return last === h;
        })()`, { timeout: 15_000, polling: 500 })
          .catch(() => console.log("  ⚠️  the events card never settled"));
        await page.waitForTimeout(1500);
      }
      // `clickTestId`, repeated `times` — used to step the week forward so the
      // meal planner shows a week with no days already behind it. The app
      // greys out a past day and hides its meals, which is right in the app
      // and looks like an empty column in a screenshot.
      if (shot.clickTestId) {
        for (let n = 0; n < (shot.times ?? 1); n++) {
          const el = page.locator(`[data-testid="${shot.clickTestId}"]`).first();
          if (await el.count() > 0) { await el.click(); await page.waitForTimeout(900); }
        }
        await page.waitForTimeout(1200);
      }
      if (shot.click) {
        const el = page.getByRole("button", { name: shot.click, exact: true }).first();
        if (await el.count() > 0) { await el.click(); await page.waitForTimeout(2000); }
        else console.log(`  (no "${shot.click}" button on ${d.id})`);
      }
      if (shot.scrollInner) {
        // The calendar's time grid scrolls inside itself, not with the page —
        // the day view opens on the morning, and this family's day happens in
        // the afternoon.
        await page.evaluate(`(() => {
          const els = Array.from(document.querySelectorAll("div"))
            .filter(e => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
          const t = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
          if (t) t.scrollTop = ${shot.scrollInner};
        })()`);
        await page.waitForTimeout(1200);
      }
      // Scroll a named section into view. Steadier than a pixel offset, which
      // lands somewhere different on each device and drifts every time a card
      // above it changes height — the reward shelf shot came out showing Bonus
      // Chores that way.
      if (shot.scrollTo || shot.scrollToTestId) {
        await page.evaluate(`(() => {
          const want = ${JSON.stringify(shot.scrollTo ?? "")};
          const testId = ${JSON.stringify(shot.scrollToTestId ?? "")};
          const el = testId
            ? document.querySelector('[data-testid="' + testId + '"]')
            : [...document.querySelectorAll("h2, h3, [class*='CardTitle'], div")]
                .find(n => (n.textContent || "").trim() === want);
          if (!el) return;
          el.scrollIntoView({ block: "start" });
          // Back off by the sticky header's height, or the card's own title —
          // the thing that says WHICH card this is — ends up underneath it.
          const back = ${JSON.stringify(shot.scrollBack ?? 0)};
          if (back) {
            const sc = document.querySelector("#app-scroll-container") || document.scrollingElement;
            if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - back);
          }
        })()`);
        await page.waitForTimeout(1500);
      }
      if (shot.scroll) {
        // The app scrolls an inner container, not the window — window.scrollTo
        // here is a silent no-op that produced a "scrolled" shot identical to
        // the unscrolled one.
        await page.evaluate(`(() => {
          const el = document.getElementById("app-scroll-container");
          const target = (el && el.scrollHeight > el.clientHeight) ? el
            : (document.scrollingElement || document.documentElement);
          target.scrollTop = ${shot.scroll};
          return target.scrollTop;
        })()`);
        await page.waitForTimeout(1400);
      }
      if (process.env.DUMP) {
        console.log(JSON.stringify(await page.evaluate(`(() => [...document.querySelectorAll('[data-testid^="event-"]')].map(r => ({ id: r.getAttribute('data-testid'), top: Math.round(r.getBoundingClientRect().top), h: Math.round(r.getBoundingClientRect().height), op: getComputedStyle(r).opacity })))()`)));
      }
      const file = path.join(OUT, `${d.id}-${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log(`✅ ${file}`);
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); }
}
