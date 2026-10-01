// Full-app visual tour: signs up a brand-new account, walks the entire
// onboarding wizard, then visits every nav tab, the Settings modal (every
// section), the global "+" quick-create menu and its dialogs, and a few
// edge-case states (empty lists, a validation error, a long text input).
// Screenshots go to e2e/screenshots/ (gitignored) and a plain-text inventory
// is printed at the end.
//
// This drives the REAL app (real signup, real Postgres, real session) — not
// a mock — against the local stack started by e2e/run-local-stack.mjs (see
// e2e/README.md for prerequisites and one-shot run instructions).
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL = process.env.TOUR_URL || "https://127.0.0.1:8443";
const SS_DIR = path.join(__dirname, "screenshots");
const runId = process.env.RUN_ID || String(Math.floor(Math.random() * 1e9));
const EMAIL = `apptour_${runId}@example.com`;

// The sandbox this was built in routes ALL outbound HTTPS through an agent
// proxy, which Chromium picks up from the environment and then fails to
// tunnel local-only (127.0.0.1) traffic through. Harmless to strip generally
// — everything this tour hits is local.
const cleanEnv = { ...process.env };
for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) delete cleanEnv[k];

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, env: cleanEnv, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("replit.com") && !m.text().includes("401")) {
    console.log("  [console error]", m.text());
  }
});
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("replit.com")) console.log("  [http error]", r.status(), r.url());
});

const inventory = [];
async function shot(label, note = "") {
  await page.waitForTimeout(400);
  const file = path.join(SS_DIR, `${String(inventory.length + 1).padStart(2, "0")}_${label}.png`);
  await page.screenshot({ path: file });
  inventory.push({ label, file, note });
  console.log(`[shot] ${label}${note ? " — " + note : ""}`);
}

try {
  // ── Landing: login screen ──
  await page.goto(URL, { waitUntil: "load" });
  await shot("landing_login", "default landing screen (email/password login)");

  // ── Landing: signup screen ──
  await page.getByTestId("link-switch-to-signup").click();
  await shot("landing_signup", "toggled to Sign Up form");

  // Edge case: submit with every field empty -> native validation error state
  await page.getByTestId("button-submit-auth").click();
  await page.waitForTimeout(400);
  await shot("landing_signup_empty_error", "submit with all fields empty (error/validation state)");

  // Real signup
  await page.getByTestId("input-display-name").fill("Tour Parent");
  await page.getByTestId("input-email").fill(EMAIL);
  await page.getByTestId("input-password").fill("TourPass123!");
  await page.getByTestId("button-submit-auth").click();
  await page.waitForTimeout(1200);
  await shot("onboarding_welcome", "Onboarding step 1 — Welcome");

  // ── Onboarding: Create my family -> Add family members ──
  await page.getByText("Create my family").click();
  await shot("onboarding_add_members", "Step 2 — Add family members (name prefilled from signup)");

  await page.getByText("Add Person").click();
  await page.waitForTimeout(600);
  await shot("onboarding_add_members_after_add", "after adding the first person");

  await page.getByText("Continue with 1 member").click();
  await page.waitForTimeout(500);
  await shot("onboarding_which_one_is_you", "Step 3 — Which one is you?");

  // The only profile is pre-selected; Continue with no email/photo entered.
  // NOTE: this reproducibly 500s server-side ("No values to set" — an empty
  // PATCH body) and surfaces a "Couldn't save profile" error toast, but the
  // wizard proceeds anyway. See e2e/README.md's Findings section.
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.waitForTimeout(700);
  await shot("onboarding_you_continue_result", "after Continue (see README: known 'Couldn't save profile' toast)");

  // Each "Skip" click leaves the step it was clicked ON, landing on the next
  // one — so this first click leaves "which one is you" and lands on
  // Location (its own onboarding-status PATCH names the step you just left,
  // e.g. {"step":"profile","action":"skip"} lands you on Location).
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.waitForTimeout(800);
  await shot("onboarding_location", "Step 4 — Your location");

  await page.getByRole("button", { name: "Skip", exact: true }).click(); // leaves Location, lands on Rewards
  await page.waitForTimeout(800);
  await shot("onboarding_rewards", "Step 5 — Rewards & Approvals");

  await page.getByRole("button", { name: "Skip", exact: true }).click(); // leaves Rewards, lands on Invite
  await page.waitForTimeout(800);

  // Wait for the heading rather than a fixed delay, since a slow request can
  // otherwise still be in-flight when the next click fires.
  await page.getByRole("heading", { name: "Invite the rest of your family" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "I'll do this later", exact: true }).click();
  await page.waitForTimeout(700);
  await shot("onboarding_invite", "Step 6 — Invite the rest of your family");

  await shot("onboarding_tour", "Step 7 — Quick Tour");
  await page.getByRole("button", { name: "Skip tour", exact: true }).click();
  await page.waitForTimeout(500);
  await shot("onboarding_done", "Final step — You're all set");

  await page.getByRole("button", { name: "Get Started", exact: true }).click();
  await page.waitForTimeout(1200);
  await shot("main_app_home", "Landed in the main app — Home tab");

  // ── Main app: every nav tab reachable without further setup ──
  for (const t of [
    { testid: "home-tab", label: "home" },
    { testid: "calendar-tab", label: "calendar" },
    { testid: "chores-tab", label: "chores" },
    { testid: "meals-tab", label: "meals" },
  ]) {
    await page.getByTestId(t.testid).click({ force: true });
    await page.waitForTimeout(700);
    await shot(`tab_${t.label}`, `${t.label} tab (empty-state, brand-new account)`);
  }

  // To-Dos and Behavior are hidden from the nav by default for a new account
  // (a one-time localStorage migration default, same as CLAUDE.md documents
  // for Behavior) — enable both via Settings so every tab is reachable.
  await page.getByTestId("home-tab").click({ force: true });
  await page.waitForTimeout(400);
  await page.getByTestId("settings-button").click();
  await page.waitForTimeout(500);
  await shot("settings_default", "Settings modal, default state");

  for (const s of ["account", "sharing", "calendar", "appearance", "rewards", "perperson", "notifications"]) {
    await page.locator(`[data-section-id="${s}"] button`).first().click();
    await page.waitForTimeout(500);
    await shot(`settings_${s}`, `Settings → ${s} section expanded`);
  }

  // Sections are a single-open accordion — re-open "appearance" (its own
  // checkboxes are what we need next) since walking the list above closed it.
  await page.locator('[data-section-id="appearance"] button').first().click();
  await page.waitForTimeout(500);
  for (const tabId of ["todos", "behaviour"]) {
    await page.getByTestId(`tab-visibility-${tabId}`).click({ force: true });
    await page.waitForTimeout(300);
  }
  await shot("settings_tabs_enabled", "To-Dos + Behavior tabs enabled via checkboxes");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  for (const t of [{ testid: "todos-tab", label: "todos" }, { testid: "behaviour-tab", label: "behaviour" }]) {
    await page.getByTestId(t.testid).click({ force: true });
    await page.waitForTimeout(700);
    await shot(`tab_${t.label}`, `${t.label} tab (empty-state, brand-new account)`);
  }

  await page.getByTestId("home-tab").click({ force: true });
  await page.waitForTimeout(400);

  // ── Global "+" quick-create menu and its dialogs ──
  await page.getByTestId("home-main-add-button").click();
  await page.waitForTimeout(500);
  await shot("global_add_menu", "Global + quick-create menu (4 labeled sections)");

  await page.getByTestId("menu-create-task").click();
  await page.waitForTimeout(500);
  await shot("dialog_create_task_picker", "Create a task — kind picker");

  await page.getByTestId("kind-regular").click();
  await page.waitForTimeout(500);
  await shot("dialog_create_task_form", "Create a task — Regular chore form");

  // Edge case: a deliberately long title, to check input/layout behavior.
  // A bare <input> (no type attribute) still needs the ":not([type])" half —
  // the CSS attribute selector only matches an explicitly-present attribute.
  await page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first().fill(
    "This is a deliberately very long chore title used to check text wrapping and layout overflow behavior in the create task dialog form field",
  );
  await page.waitForTimeout(300);
  await shot("dialog_create_task_long_title", "Create a task — long title in the Name field");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  for (const menuId of ["menu-add-event", "menu-add-todo", "menu-snap-flyer"]) {
    await page.getByTestId("home-main-add-button").click();
    await page.waitForTimeout(400);
    await page.getByTestId(menuId).click();
    await page.waitForTimeout(600);
    await shot(`dialog_${menuId.replace("menu-", "")}`, `${menuId} dialog`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  // ── Family History drawer, empty state ──
  // The Add To-Do quick-create navigates to the To-Dos tab as part of
  // opening (by design), so explicitly return Home first rather than assume
  // we're still there.
  await page.getByTestId("home-tab").click({ force: true });
  await page.waitForTimeout(400);
  await page.getByTestId("activity-card").click();
  await page.waitForTimeout(600);
  await shot("drawer_family_history_empty", "Family History drawer — empty state, new account");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── Chores tab revisited: confirm its own empty state + Add Chore CTA ──
  await page.getByTestId("chores-tab").click({ force: true });
  await page.waitForTimeout(600);
  await shot("tab_chores_empty_state", "Chores tab empty state (no chores or to-dos yet)");
} catch (err) {
  console.log("FATAL:", err.message);
  await shot("FATAL_STATE", "run stopped early — see error above");
}

console.log("\n=== SCREENSHOT INVENTORY ===");
for (const i of inventory) console.log(`${path.basename(i.file)}  —  ${i.note}`);
console.log(`\n${inventory.length} screenshots written to ${SS_DIR}`);

await browser.close();
