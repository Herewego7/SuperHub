// SYS-9: the whole audit was done at 390px. This captures the same screens at
// desktop width so the two-column / wide-layout branches actually get looked at.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 5312;
const BASE = `http://localhost:${PORT}/tests/e2e/harness.html`;
const OUT = "/tmp/desktop-audit";
mkdirSync(OUT, { recursive: true });

async function waitForServer(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("server never came up");
}

const server = spawn("npx", ["vite", "--strictPort", "--port", String(PORT)], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), BASE_PATH: "/" }, stdio: "ignore",
});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const findings = [];

/** Report any element whose content is wider than its box, or that spills its parent. */
async function overflowScan(page, label) {
  const bad = await page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push({ what: "PAGE", detail: `${doc.scrollWidth} > ${doc.clientWidth}` });
    document.querySelectorAll("*").forEach(el => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return;
      if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== "auto" && s.overflowX !== "scroll") {
        const t = (el.textContent || "").trim().slice(0, 40);
        if (t) out.push({ what: el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40), detail: `${el.scrollWidth}>${el.clientWidth} "${t}"` });
      }
    });
    return out.slice(0, 12);
  });
  if (bad.length) findings.push({ screen: label, bad });
}

try {
  await waitForServer(BASE);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", e => console.error("[pageerror]", e.message));
  await page.goto(`${BASE}?scenario=screenshotInventory`, { waitUntil: "commit" });
  await page.waitForSelector('[data-testid="settings-button"]', { timeout: 40000 });
  await page.waitForTimeout(1200);

  const tabs = [
    ["home", "home-tab"], ["calendar", "calendar-tab"], ["chores", "chores-tab"],
    ["todos", "todos-tab"], ["meals", "meals-tab"],
  ];
  for (const [name, testid] of tabs) {
    const el = page.locator(`[data-testid="${testid}"]`).first();
    if (await el.count()) {
      await el.click().catch(() => {});
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `${OUT}/desk-${name}.png`, fullPage: false });
    await overflowScan(page, name);
  }

  // Settings at desktop, a few sections expanded
  await page.click('[data-testid="settings-button"]');
  await page.waitForTimeout(800);
  const modal = page.locator('[data-testid="settings-modal"]');
  await page.screenshot({ path: `${OUT}/desk-settings.png` });
  await overflowScan(page, "settings");
  for (const label of ["Account & Family", "Display & Layout", "Sharing", "Notifications"]) {
    const h = modal.getByText(label, { exact: true }).first();
    try {
      await h.click({ timeout: 2000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/desk-settings-${label.toLowerCase().replace(/[^a-z]+/g, "-")}.png` });
      await overflowScan(page, `settings:${label}`);
      await h.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    } catch {}
  }
  console.log(JSON.stringify(findings, null, 1));
} finally {
  await browser.close();
  server.kill();
}
