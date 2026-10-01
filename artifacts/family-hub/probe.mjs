import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const w of [390, 440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 956 }, isMobile: true, hasTouch: true, timezoneId: "America/Chicago" });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date("2026-09-15T08:15:00-05:00"));
  await p.goto("http://localhost:5299/tests/e2e/harness.html?scenario=marketingShots");
  await p.waitForTimeout(5000);
  await p.locator('[data-testid="calendar-tab"]').first().click();
  await p.waitForTimeout(2500);
  await p.getByRole("button", { name: "Month", exact: true }).first().click();
  await p.waitForTimeout(2500);
  const r = await p.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid^="month-event-"]'))
      .concat(Array.from(document.querySelectorAll('div.truncate.rounded')));
    const seen = [];
    for (const row of rows.slice(0, 40)) {
      const span = row.querySelector("span.truncate") || row;
      const cs = getComputedStyle(span);
      // how much of the text actually fits
      const full = (span.textContent || "").trim();
      seen.push({ full, w: Math.round(span.getBoundingClientRect().width),
                  scroll: span.scrollWidth, font: cs.fontSize });
    }
    return seen.slice(0, 5);
  })()`);
  console.log(w, JSON.stringify(r));
  await ctx.close();
}
await b.close();
