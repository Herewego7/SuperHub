#!/usr/bin/env node
// One-off, standalone Playwright script for a full-app visual inventory.
// NOT part of the permanent regression suite (that lives in tests/e2e/).
// This launches the app locally (via the existing mocked-backend E2E
// harness — this sandbox has no live database), logs in (the harness
// mounts FamilyHub directly with a mocked authenticated /api/auth/user,
// which is the same "already logged in" state the app reaches after a
// real login), walks every nav tab, and triggers every reachable
// modal/dialog/drawer it can find — including a rich-data scenario, a
// near-empty scenario (empty-list edge cases), a broken-calendar-sync
// scenario (error state), and a long-text edge case. Screenshots are
// written to the directory given by SCREENSHOT_DIR.
//
// Usage: SCREENSHOT_DIR=/path/to/out node scripts/screenshot-inventory.mjs

import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = 5301;
const BASE_URL = `http://localhost:${PORT}/tests/e2e/harness.html`;
const OUT_DIR = process.env.SCREENSHOT_DIR || "/tmp/screenshot-inventory";
mkdirSync(OUT_DIR, { recursive: true });

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

/** @type {{name: string, ok: boolean, note?: string}[]} */
const inventory = [];

function record(name, ok, note) {
  inventory.push({ name, ok, note });
  console.log(`${ok ? "✅" : "⚠️ "} ${name}${note ? ` — ${note}` : ""}`);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dev server didn't come up at ${url} within ${timeoutMs}ms`);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  return file;
}

/** Open a fresh scenario page (a "screen"/component/dialog mounted in isolation). */
async function openScenario(browser, scenario, viewport = MOBILE_VIEWPORT) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (err) => console.error(`  [pageerror in ${scenario}]`, err.message));
  await page.goto(`${BASE_URL}?scenario=${scenario}`, { waitUntil: "commit" });
  await page.waitForTimeout(1500);
  return page;
}

/** Best-effort click that never throws — logs and returns whether it found the element. */
async function tryClick(page, selector, opts = {}) {
  try {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: "visible", timeout: opts.timeout ?? 3000 });
    await loc.click({ force: opts.force ?? false });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Starting Vite dev server on port ${PORT}...`);
  const server = spawn("npx", ["vite", "--strictPort", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), BASE_PATH: "/" },
    stdio: "ignore",
  });

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  try {
    await waitForServer(`http://localhost:${PORT}/tests/e2e/harness.html`);
    console.log("Dev server is up.\n");

    // =========================================================================
    // PART 1 — Full app walkthrough (rich-data scenario): every nav tab, plus
    // every modal/dialog/drawer reachable from the running app itself.
    // =========================================================================
    console.log("=== Part 1: Full app — rich data (screenshotInventory scenario) ===");
    {
      const page = await openScenario(browser, "screenshotInventory");

      // Dismiss any startup pop-up (e.g. the "event starting soon" reminder)
      // that could otherwise cover the FAB/header for the rest of this run.
      for (let i = 0; i < 3; i++) {
        const dismissed = await tryClick(page, 'button:has-text("Dismiss")', { timeout: 1000 });
        if (!dismissed) break;
        await page.waitForTimeout(300);
      }

      // --- Home tab (default landing tab) ---
      await shot(page, "01-home-tab");
      record("Home tab", true);

      // --- Global "+" add menu ---
      if (await tryClick(page, '[data-testid="home-main-add-button"]')) {
        await page.waitForTimeout(400);
        await shot(page, "02-global-add-menu");
        record("Global '+' add menu", true);

        // Add event
        if (await tryClick(page, '[data-testid="menu-add-event"]')) {
          await page.waitForTimeout(600);
          await shot(page, "03-modal-add-event");
          record("Modal: Add Event", true);
          // Close via Escape
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } else record("Modal: Add Event", false, "menu item not found");
      } else {
        record("Global '+' add menu", false, "trigger not found");
      }

      // Reopen menu each time since it closes after an item click/escape
      const reopenMenu = async () => {
        await tryClick(page, '[data-testid="home-main-add-button"]');
        await page.waitForTimeout(400);
      };

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-snap-flyer"]')) {
        await page.waitForTimeout(600);
        await shot(page, "04-modal-snap-flyer");
        record("Modal: Snap a Flyer", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Snap a Flyer", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-add-health-reminder"]')) {
        await page.waitForTimeout(600);
        await shot(page, "05-modal-health-reminder-picker");
        record("Modal: Health Reminder picker", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Health Reminder picker", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-create-task"]')) {
        await page.waitForTimeout(600);
        await shot(page, "06-modal-create-task-picker");
        record("Modal: Create a Task (kind picker)", true);
        // Pick "Chore" kind if a card is present, then screenshot the form
        const choreCard = page.locator('[data-testid="kind-regular"]').first();
        try {
          await choreCard.click({ timeout: 2000 });
          await page.waitForTimeout(400);
          await shot(page, "06b-modal-create-task-chore-form");
          record("Modal: Create Task — Chore form", true);

          // Long-text edge case: type a very long name
          const nameInput = page.locator('input[placeholder*="name" i], input[data-testid*="name"]').first();
          if (await nameInput.count()) {
            await nameInput.fill(
              "A".repeat(20) + " " + "very long chore name ".repeat(15),
            );
            await page.waitForTimeout(200);
            await shot(page, "06c-edge-case-long-text-input");
            record("Edge case: long text input (Create Task name field)", true);
          }
        } catch {
          record("Modal: Create Task — Chore form", false, "kind card not clickable");
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Create a Task (kind picker)", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-add-todo"]')) {
        await page.waitForTimeout(600);
        await shot(page, "07-modal-add-todo");
        record("Modal: Add To-Do", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Add To-Do", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-adjust-stars"]')) {
        await page.waitForTimeout(600);
        await shot(page, "08-modal-adjust-stars-pin-gate");
        record("Modal: Add/Remove Stars (PIN gate)", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Add/Remove Stars (PIN gate)", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-add-note"]')) {
        await page.waitForTimeout(600);
        await shot(page, "09-modal-post-a-note");
        record("Modal: Post a Note", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Post a Note", false, "menu item not found");

      await reopenMenu();
      if (await tryClick(page, '[data-testid="menu-add-praise"]')) {
        await page.waitForTimeout(600);
        await shot(page, "10-modal-give-praise");
        record("Modal: Give Praise", true);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      } else record("Modal: Give Praise", false, "menu item not found");

      // --- Settings modal ---
      if (await tryClick(page, '[data-testid="settings-button"]')) {
        await page.waitForTimeout(700);
        await shot(page, "11-settings-modal-collapsed");
        record("Settings modal (collapsed sections)", true);

        // Expand a handful of representative sections by clicking their headers
        const sectionLabels = [
          "Account & Family",
          "Calendar",
          "Per-Person Settings",
          "Parent PIN & Permissions",
          "Rewards & Approvals",
          "Notifications",
          "Display & Layout",
          "Sharing",
        ];
        let idx = 12;
        const settingsModal = page.locator('[data-testid="settings-modal"]');
        for (const label of sectionLabels) {
          const header = settingsModal.getByText(label, { exact: true }).first();
          try {
            await header.click({ timeout: 2000 });
            await page.waitForTimeout(500);
            await shot(page, `${idx}-settings-section-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`);
            record(`Settings section: ${label}`, true);
            idx++;
            // collapse it again so the next one is easy to find/expand
            await header.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(200);
          } catch {
            record(`Settings section: ${label}`, false, "header not found");
          }
        }

        // KB Help panel (from inside Settings)
        if (await tryClick(page, '[data-testid="kb-help-button"]')) {
          await page.waitForTimeout(700);
          await shot(page, "20-kb-help-panel");
          record("Knowledge Base help panel", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(400);
        } else record("Knowledge Base help panel", false, "trigger not found");

        // Close settings
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
      } else {
        record("Settings modal", false, "trigger not found");
      }

      // --- Privacy screen ---
      if (await tryClick(page, '[data-testid="privacy-button"]')) {
        await page.waitForTimeout(700);
        await shot(page, "21-privacy-screen");
        record("Privacy Screen", true);
        await tryClick(page, '[data-testid="privacy-dismiss"]');
        await page.waitForTimeout(400);
      } else {
        record("Privacy Screen", false, "trigger not found");
      }

      // --- Calendar tab ---
      if (await tryClick(page, '[data-testid="calendar-tab"]')) {
        await page.waitForTimeout(700);
        await shot(page, "22-calendar-tab-week-view");
        record("Calendar tab", true);

        // Celebrations dialog from the Calendar toolbar
        if (await tryClick(page, '[data-testid="open-celebrations-toolbar-button"]')) {
          await page.waitForTimeout(600);
          await shot(page, "23-modal-celebrations");
          record("Modal: Celebrations (from Calendar toolbar)", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } else if (await tryClick(page, '[data-testid="open-celebrations-button"]')) {
          await page.waitForTimeout(600);
          await shot(page, "23-modal-celebrations");
          record("Modal: Celebrations (from Calendar toolbar)", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } else {
          record("Modal: Celebrations", false, "toolbar button not found");
        }

        // Try opening month view + clicking a day to open Add Event from a slot
        const monthBtn = page.getByText("Month", { exact: true }).first();
        try {
          await monthBtn.click({ timeout: 2000 });
          await page.waitForTimeout(500);
          await shot(page, "24-calendar-month-view");
          record("Calendar — Month view", true);
        } catch {
          record("Calendar — Month view", false, "view toggle not found");
        }
      } else {
        record("Calendar tab", false, "trigger not found");
      }

      // --- Chores tab ---
      if (await tryClick(page, '[data-testid="chores-tab"]')) {
        await page.waitForTimeout(700);
        await shot(page, "25-chores-tab");
        record("Chores tab", true);

        // Manage tasks drawer
        const manageBtn = page.getByRole("button", { name: /manage/i }).first();
        try {
          await manageBtn.click({ timeout: 2000 });
          await page.waitForTimeout(600);
          await shot(page, "26-drawer-manage-tasks");
          record("Drawer: Manage Tasks", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } catch {
          record("Drawer: Manage Tasks", false, "manage button not found");
        }

        // Customize Tasks Page
        const customizeBtn = page.getByText(/customize/i).first();
        try {
          await customizeBtn.click({ timeout: 2000 });
          await page.waitForTimeout(600);
          await shot(page, "27-modal-customize-tasks-page");
          record("Modal: Customize Tasks Page", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } catch {
          record("Modal: Customize Tasks Page", false, "customize button not found");
        }
      } else {
        record("Chores tab", false, "trigger not found");
      }

      // --- To-Dos tab ---
      if (await tryClick(page, '[data-testid="todos-tab"]')) {
        await page.waitForTimeout(700);
        await shot(page, "28-todos-tab");
        record("To-Dos tab", true);
      } else {
        record("To-Dos tab", false, "trigger not found");
      }

      // --- Meals tab ---
      if (await tryClick(page, '[data-testid="meals-tab"]')) {
        await page.waitForTimeout(700);
        await shot(page, "29-meals-tab");
        record("Meals tab", true);

        const groceryBtn = page.getByText(/grocery list/i).first();
        try {
          await groceryBtn.click({ timeout: 2000 });
          await page.waitForTimeout(600);
          await shot(page, "30-meals-grocery-list");
          record("Meals — Grocery List view", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } catch {
          record("Meals — Grocery List view", false, "grocery list button not found");
        }

        const browseBtn = page.locator('[data-testid="browse-meal-ideas-button"]').first();
        try {
          await browseBtn.click({ timeout: 2000 });
          await page.waitForTimeout(600);
          await shot(page, "31-modal-browse-meal-ideas");
          record("Modal: Browse Meal Ideas", true);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(300);
        } catch {
          record("Modal: Browse Meal Ideas", false, "browse-ideas button not found");
        }
      } else {
        record("Meals tab", false, "trigger not found");
      }

      await page.close();
    }

    // =========================================================================
    // PART 2 — Edge cases: empty-list state and error state, using the
    // near-empty and broken-calendar-sync scenarios already built for the
    // permanent regression suite.
    // =========================================================================
    console.log("\n=== Part 2: Edge cases ===");
    {
      const page = await openScenario(browser, "familyHub"); // near-empty default data
      await shot(page, "40-edge-case-home-empty-lists");
      record("Edge case: Home tab with empty/near-empty lists", true);

      await tryClick(page, '[data-testid="chores-tab"]');
      await page.waitForTimeout(600);
      await shot(page, "41-edge-case-chores-empty");
      record("Edge case: Chores tab, empty state", true);

      await tryClick(page, '[data-testid="meals-tab"]');
      await page.waitForTimeout(600);
      await shot(page, "42-edge-case-meals-empty");
      record("Edge case: Meals tab, empty state", true);

      await page.close();
    }

    {
      const page = await openScenario(browser, "homeCalendarSyncError");
      await shot(page, "43-edge-case-calendar-sync-error");
      record("Edge case: Home — calendar sync error / reconnect CTA", true);
      await page.close();
    }

    // =========================================================================
    // PART 3 — Standalone component/dialog scenarios (already built for the
    // permanent regression suite) — each one is effectively its own isolated
    // "screen" or popup, screenshotted directly without needing to navigate
    // the full app to reach it.
    // =========================================================================
    console.log("\n=== Part 3: Standalone dialog/component scenarios ===");
    const standaloneScenarios = [
      ["announcements", "50-standalone-announcements-banner"],
      ["announcementsFinishSetupRace", "51-standalone-announcements-finish-setup"],
      ["celebrationsDialog", "52-standalone-celebrations-dialog"],
      ["createTaskModal", "53-standalone-create-task-modal"],
      ["eventModal", "54-standalone-event-modal-edit"],
      ["eventModalLongDesc", "55-standalone-event-modal-long-description-edge-case"],
      ["eventAllDayFlow", "56-standalone-event-all-day-flow"],
      ["historyEntrySpotlight", "57-standalone-family-activity-history"],
      ["notificationsNative", "58-standalone-notifications-native-settings"],
      ["onboardingRenameProfile", "59-standalone-onboarding-add-family-members"],
      ["onboardingYouStepPersist", "60-standalone-onboarding-which-one-is-you"],
      ["onboardingTour", "61-standalone-onboarding-quick-tour"],
      ["parentPinChecklist", "62-standalone-parent-pin-checklist"],
      ["perPersonSettings", "63-standalone-per-person-settings"],
      ["personTodoList", "64-standalone-person-todo-list"],
      ["rewardsCashoutOnly", "65-standalone-rewards-cashout-only-mode"],
      ["sentryTestButton", "66-standalone-sentry-test-button-settings"],
      ["toastSwipe", "67-standalone-toast"],
      ["upgradeDialog", "68-standalone-upgrade-subscription-dialog"],
      ["choreSwipeRemove", "69-standalone-chore-swipe-to-remove"],
      ["todosDragReorder", "70-standalone-todos-drag-reorder"],
    ];
    for (const [scenario, filename] of standaloneScenarios) {
      try {
        const page = await openScenario(browser, scenario);
        await shot(page, filename);
        record(`Standalone scenario: ${scenario}`, true);
        await page.close();
      } catch (err) {
        record(`Standalone scenario: ${scenario}`, false, String(err).slice(0, 120));
      }
    }

    // Desktop-width pass of the main app for a couple of the widest screens
    console.log("\n=== Part 4: Desktop-width pass ===");
    {
      const page = await openScenario(browser, "screenshotInventory", DESKTOP_VIEWPORT);
      await shot(page, "80-desktop-home-tab");
      record("Desktop viewport: Home tab", true);
      await tryClick(page, '[data-testid="chores-tab"]');
      await page.waitForTimeout(600);
      await shot(page, "81-desktop-chores-tab");
      record("Desktop viewport: Chores tab", true);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${inventory.length} screenshot attempts, ${inventory.filter((i) => i.ok).length} succeeded, ${inventory.filter((i) => !i.ok).length} failed.`);
  console.log(`Screenshots written to: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
