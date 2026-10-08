// The setup chat's script, walked answer by answer with a fake server. Each
// walk asserts the exact requests sent, in order: the chat is meant to save
// exactly what the old setup buttons saved, so the request list IS the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  progress,
  resumeState,
  startState,
  summary,
  view,
  type Answer,
  type Deps,
  type Person,
  type SetupContext,
  type SetupState,
} from "../../src/lib/setupChat/script";
import { clearSession, loadSession, saveSession, serializeSession } from "../../src/lib/setupChat/session";
import { deviceTimezone } from "../../src/lib/regions";

const PIN_FEATURES = [
  { key: "createChore", label: "Creating & managing chores" },
  { key: "createBonusChore", label: "Creating & managing bonus chores" },
  { key: "createReward", label: "Creating & managing rewards" },
  { key: "calendarSettings", label: "Calendar display settings" },
  { key: "createTodo", label: "Creating & managing to-dos" },
  { key: "settings", label: "Opening Settings" },
];
const PIN_DEFAULTS = ["createChore", "createBonusChore", "createReward", "calendarSettings"];

type Call = [string, string, unknown];

function setup(over: Partial<SetupContext> = {}) {
  const calls: Call[] = [];
  let nextId = 1;
  const ctx: SetupContext = {
    user: { id: "u1", email: "chad@example.com", firstName: "Chad", displayName: "Chad Giles" },
    profiles: [],
    location: null,
    rewards: {
      hasParentPin: false,
      pinGatedFeatures: [],
      redemptionMode: "both",
      pointsMode: "per_chore",
      centsPerPoint: 8,
      completionBonusPoints: 10,
      currencySymbol: "$",
    },
    inviteRole: null,
    pinFeatures: PIN_FEATURES,
    pinDefaults: PIN_DEFAULTS,
    ...over,
  };
  const d: Deps = {
    ctx,
    request: async (method, url, body) => {
      calls.push([method, url, body]);
      if (method === "POST" && url === "/api/profiles") return { id: `p${nextId++}`, ...(body as object) };
      if (method === "POST" && url === "/api/family/invites") return { code: "K7M2QX9P" };
      return {};
    },
    invalidate: () => {},
  };
  return { ctx, d, calls };
}

/** Plays answers in order: a string is typed, { tap } taps an answer. */
async function play(s: SetupState, d: Deps, ...answers: Array<string | { tap: string } | Answer>) {
  let after: string | undefined;
  for (const a of answers) {
    const input: Answer = typeof a === "string" ? { kind: "text", text: a } : "tap" in a ? { kind: "choice", id: a.tap } : a;
    const out = await answer(s, input, d);
    s = out.state;
    after = out.after;
  }
  return { s, after };
}

const mark = (step: string, action: "done" | "skip"): Call => ["PATCH", "/api/onboarding-status", { step, action }];
const lastBot = (s: SetupState) => [...s.transcript].reverse().find((e) => e.kind === "bot") as { text: string } | undefined;

test("a new family, start to finish, sends exactly what the setup buttons sent", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  assert.equal(s.q, "welcome");
  assert.deepEqual(progress(s).labels, ["You", "Family", "Location", "Calendars", "Rewards", "Invite", "Done"]);

  ({ s } = await play(s, d, "1"));
  assert.equal(s.q, "you-name");
  ({ s } = await play(s, d, { tap: "yes" }, "not now", "1"));
  assert.equal(s.q, "family-names");
  ({ s } = await play(s, d, "Sarah, Ava and Noah"));
  assert.equal(s.q, "family-role");
  ({ s } = await play(s, d, "mom", "kid", "2"));
  assert.equal(s.q, "family-review");
  ({ s } = await play(s, d, "looks good", "minneapolis mn"));
  assert.equal(s.q, "location-confirm");
  ({ s } = await play(s, d, "yes", "not now"));
  assert.equal(s.q, "rewards-earn");
  ({ s } = await play(s, d, "1", "both", "10"));
  assert.equal(s.q, "pin-ask");
  ({ s } = await play(s, d, "yes", "1234", "1234"));
  assert.equal(s.q, "pin-locks");
  ({ s } = await play(s, d, "sounds good", "2", "that's everyone"));
  assert.equal(s.q, "done");
  const end = await play(s, d, "open superhub");
  assert.equal(end.after, "finish");

  assert.deepEqual(calls, [
    ["POST", "/api/profiles", { name: "Chad", color: "#5E8FAD", initials: "C", role: "adult" }],
    ["PATCH", "/api/profiles/p1", { email: "chad@example.com" }],
    mark("profile", "done"),
    ["POST", "/api/profiles", { name: "Sarah", color: "#E07B6A", initials: "S", role: "adult" }],
    ["POST", "/api/profiles", { name: "Ava", color: "#6DB98A", initials: "A", role: "child" }],
    ["POST", "/api/profiles", { name: "Noah", color: "#A67BB9", initials: "N", role: "child" }],
    ["PUT", "/api/location-settings", { city: "Minneapolis", state: "MN", country: "United States", latitude: 0, longitude: 0, timezone: deviceTimezone() }],
    mark("location", "done"),
    mark("calendar", "skip"),
    ["PUT", "/api/reward-settings", { redemptionMode: "both", pointsMode: "per_chore", centsPerPoint: 10 }],
    mark("rewards", "done"),
    ["PUT", "/api/reward-settings", { pinGatedFeatures: PIN_DEFAULTS, parentPin: "1234" }],
    ["POST", "/api/family/invites", {}],
    mark("invite", "done"),
    ["POST", "/api/auth/complete-onboarding", undefined],
  ]);
});

test("someone joining a family picks themselves and saves only their own part", async () => {
  const family: Person[] = [
    { id: "chad", name: "Chad", color: "#5E8FAD", role: "adult", email: "chad@example.com" },
    { id: "sarah", name: "Sarah", color: "#E07B6A", role: "adult" },
    { id: "ava", name: "Ava", color: "#6DB98A", role: "child" },
  ];
  const { d, calls } = setup({
    user: { id: "u2", email: "sarah@example.com", firstName: "Sarah", displayName: "Sarah Giles" },
    profiles: family,
    location: { city: "Minneapolis", state: "MN", country: "United States", timezone: "America/Chicago" },
    inviteRole: "parent",
  });
  let s = startState("joiner", d);
  assert.equal(s.q, "you-pick");
  assert.deepEqual(progress(s).labels, ["You", "Location", "Calendars", "Done"]);
  const sarah = view(s, d.ctx).options.find((o) => o.id === "p:sarah");
  assert.equal(sarah?.hint, "Same name as your account");

  ({ s } = await play(s, d, "sarah", "3", "1"));
  // Location was already saved, so the chat says so and moves on.
  assert.equal(s.q, "calendar");
  ({ s } = await play(s, d, "not now"));
  assert.equal(s.q, "done");
  const end = await play(s, d, { tap: "open" });
  assert.equal(end.after, "finish");

  assert.deepEqual(calls, [
    ["PATCH", "/api/profiles/sarah", { email: "sarah@example.com" }],
    mark("profile", "done"),
    mark("location", "done"),
    mark("calendar", "skip"),
    ["POST", "/api/auth/complete-onboarding", undefined],
  ]);
});

test("a joiner who isn't on the list is added with the next unused color and their invite's role", async () => {
  const { d, calls } = setup({
    user: { id: "u3", email: "ava@example.com", firstName: "Ava", displayName: "Ava" },
    profiles: [
      { id: "chad", name: "Chad", color: "#5E8FAD" },
      { id: "sarah", name: "Sarah", color: "#E07B6A" },
    ],
    inviteRole: "child",
  });
  let s = startState("joiner", d);
  ({ s } = await play(s, d, "I'm not on the list", { tap: "account" }));
  assert.equal(s.q, "you-photo");
  assert.deepEqual(calls[0], ["POST", "/api/profiles", { name: "Ava", color: "#6DB98A", initials: "A", role: "child" }]);
});

test("a replay keeps what's right, never marks anything skipped, and closes without finishing setup", async () => {
  const { d, calls } = setup({
    profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com", photoUrl: "/objects/chad.jpg" }],
    location: { city: "Minneapolis", state: "MN", country: "United States", timezone: "America/Chicago" },
  });
  let s = startState("replay", d, "you");
  assert.equal(s.q, "you-keep");
  ({ s } = await play(s, d, "keep it", "keep it", "skip"));
  assert.equal(s.q, "rewards-keep");
  ({ s } = await play(s, d, "keep", "not now", "not now"));
  assert.equal(s.q, "done");
  const end = await play(s, d, "back to superhub");
  assert.equal(end.after, "close");

  assert.ok(!calls.some(([, , body]) => (body as { action?: string } | undefined)?.action === "skip"), "a replay marked a step skipped");
  assert.deepEqual(calls, [
    mark("profile", "done"),
    mark("location", "done"),
    mark("rewards", "done"),
    ["PUT", "/api/reward-settings", { pinGatedFeatures: [] }],
  ]);
});

test("a replay from a reminder starts at that chapter", async () => {
  const { d } = setup();
  assert.equal(startState("replay", d, "rewards").q, "rewards-keep");
  assert.equal(startState("replay", d, "invite").q, "invite-how");
  assert.equal(startState("replay", d, "calendar").q, "calendar");
});

test("the PIN is never saved to the device, and a resumed chat asks for it again", async () => {
  const { d } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "keep", "yes", "4826"));
  assert.equal(s.q, "pin-confirm");
  assert.equal(s.pinFirst, "4826");
  assert.ok(!JSON.stringify(s.transcript).includes("4826"), "the PIN showed in the chat");
  assert.ok(!serializeSession("fresh", s).includes("4826"), "the PIN was written to the saved session");

  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  saveSession("u1", "fresh", { ...s, mode: "fresh" }, fake);
  const loaded = loadSession("u1", fake);
  assert.equal(loaded?.mode, "fresh");
  const resumed = resumeState(loaded!.state!);
  assert.equal(resumed.q, "pin-enter");
});

test("PINs that don't match start over without saving", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "keep", "yes", "1234", "4321"));
  assert.equal(s.q, "pin-enter");
  assert.match(lastBot(s)!.text, /didn't match/);
  assert.ok(!calls.some(([, , body]) => body && typeof body === "object" && "parentPin" in body));
});

test("choosing what the PIN locks saves the chosen list", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "keep", "yes", "1234", "1234", "choose what it locks", "1, 5", { kind: "toggle", key: "settings" }, { tap: "save" }));
  assert.equal(s.q, "invite-how");
  assert.deepEqual(calls.at(-1), ["PUT", "/api/reward-settings", { pinGatedFeatures: ["createBonusChore", "createReward", "calendarSettings", "createTodo", "settings"] }]);
});

test("a family that already has a PIN isn't asked to set one", async () => {
  const { d, ctx } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  ctx.rewards = { ...ctx.rewards!, hasParentPin: true };
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "keep"));
  assert.equal(s.q, "invite-how");
  assert.ok(s.transcript.some((e) => e.kind === "bot" && /already have a Parent PIN/.test(e.text)));
});

test("finishing the day with a bonus, spent on rewards only, saves no cash-out rate", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "change it", "for finishing the day", "15", "spend on rewards"));
  assert.equal(s.q, "pin-ask");
  assert.deepEqual(calls[0], ["PUT", "/api/reward-settings", { redemptionMode: "rewards_only", pointsMode: "per_completion", completionBonusPoints: 15 }]);
});

test("a typed number is a star amount, not an answer number, on amount questions", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "rewards");
  ({ s } = await play(s, d, "change it", "1", "cash out", "2"));
  assert.deepEqual(calls[0], ["PUT", "/api/reward-settings", { redemptionMode: "cashout_only", pointsMode: "per_chore", centsPerPoint: 50 }]);
});

test("a city without a state asks for the state, then saves both", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "location");
  assert.equal(s.q, "location-city");
  ({ s } = await play(s, d, "Kansas City"));
  assert.equal(s.q, "location-region");
  ({ s } = await play(s, d, "missouri"));
  assert.equal(s.q, "location-confirm");
  assert.deepEqual(calls[0], ["PUT", "/api/location-settings", { city: "Kansas City", state: "MO", country: "United States", latitude: 0, longitude: 0, timezone: deviceTimezone() }]);
});

test("an email typed at the invite question goes straight to who it's for", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "invite");
  ({ s } = await play(s, d, "grandma@example.com", "grown-up"));
  assert.equal(s.q, "invite-more");
  assert.deepEqual(calls, [["POST", "/api/family/invites", { email: "grandma@example.com", role: "parent" }]]);
  assert.ok(s.transcript.some((e) => e.kind === "code" && e.code === "K7M2QX9P"));
});

test("joining with a code confirms first, then joins", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "2", "k7m2 qx9p"));
  assert.equal(s.q, "join-confirm");
  assert.equal(calls.length, 0);
  const end = await play(s, d, { tap: "join" });
  assert.equal(end.after, "joined");
  assert.deepEqual(calls, [["POST", "/api/family/join", { code: "K7M2QX9P" }]]);
});

test("a typed photo answer points at the button rather than pretending to open the camera", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "1", { tap: "yes" }));
  calls.length = 0;
  ({ s } = await play(s, d, "1"));
  assert.equal(s.q, "you-photo");
  assert.match(lastBot(s)!.text, /Tap \*\*Take a photo\*\*/);
  assert.equal(calls.length, 0);
});

test("a photo from the picker saves to that person and moves on", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "1", { tap: "yes" }, { kind: "photo", profileId: "p1", photoUrl: "/objects/me.jpg" }));
  assert.equal(s.q, "you-email");
  assert.deepEqual(calls.at(-1), ["PATCH", "/api/profiles/p1", { photoUrl: "/objects/me.jpg" }]);
});

test("names run together are checked before anyone is added", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "1", { tap: "yes" }, "not now", "skip", "Mary Kate"));
  assert.equal(s.q, "family-split");
  ({ s } = await play(s, d, "one person", "kid"));
  assert.equal(s.q, "family-review");
  assert.deepEqual(calls.at(-1), ["POST", "/api/profiles", { name: "Mary Kate", color: "#E07B6A", initials: "MK", role: "child" }]);
});

test("a name already in the family isn't added twice", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "1", { tap: "yes" }, "not now", "skip", "chad and sarah"));
  assert.equal(s.q, "family-role");
  assert.deepEqual(s.pendingNames, ["Sarah"]);
  assert.ok(s.transcript.some((e) => e.kind === "bot" && /\*\*Chad\*\* is already in your family/.test(e.text)));
  assert.equal(calls.filter(([m, u]) => m === "POST" && u === "/api/profiles").length, 1);
});

test("fixing a name renames the profile", async () => {
  const { d, calls } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "1", { tap: "yes" }, "not now", "skip", "Sara", "grown-up", "fix a name", "sara", "Sarah"));
  assert.equal(s.q, "family-review");
  assert.deepEqual(calls.at(-1), ["PATCH", "/api/profiles/p2", { name: "Sarah", initials: "S" }]);
});

test("a fresh setup picked up again finds the profile already made instead of adding another", async () => {
  const { d, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD" }] });
  const s = startState("fresh", d);
  assert.equal(s.q, "you-photo");
  assert.equal(s.meId, "chad");
  assert.equal(calls.length, 0);
});

test("the calendar question offers 'I'm done' once anyone has connected", async () => {
  const { d, ctx, calls } = setup({ profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }] });
  let s = startState("replay", d, "calendar");
  assert.deepEqual(view(s, ctx).options.map((o) => o.id), ["skip"]);
  ctx.profiles = [{ ...ctx.profiles[0], googleCalendarConnected: true }];
  assert.deepEqual(view(s, ctx).options.map((o) => o.id), ["done"]);
  ({ s } = await play(s, d, "done"));
  assert.deepEqual(calls, [mark("calendar", "done")]);
  assert.equal(summary(s, ctx).rows.find((r) => r.id === "calendar")?.text, "Chad's Google calendar");
});

test("a Change link on the summary comes back to the summary", async () => {
  const { d } = setup({
    profiles: [{ id: "chad", name: "Chad", color: "#5E8FAD", email: "chad@example.com" }],
    location: { city: "Minneapolis", state: "MN", country: "United States" },
  });
  let s = startState("replay", d, "invite");
  ({ s } = await play(s, d, "not now"));
  assert.equal(s.q, "done");
  ({ s } = await play(s, d, { tap: "change:location" }, "St. Paul MN", "yes"));
  assert.equal(s.q, "done");
  assert.equal(summary(s, d.ctx).rows.find((r) => r.id === "location")?.text, "St. Paul, MN");
});

test("an answer that matches nothing gets a nudge and stays on the question", async () => {
  const { d } = setup();
  let s = startState("fresh", d);
  ({ s } = await play(s, d, "banana"));
  assert.equal(s.q, "welcome");
  assert.equal(lastBot(s)!.text, "Tap an answer, or type its number.");
});

test("a saved session is ignored after a version change, and cleared on finish", () => {
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  store.set("superhub_setup_chat_u1", JSON.stringify({ version: 0, mode: "fresh", state: null }));
  assert.equal(loadSession("u1", fake), null);
  saveSession("u1", "joiner", null, fake);
  assert.deepEqual(loadSession("u1", fake), { mode: "joiner", state: null });
  clearSession("u1", fake);
  assert.equal(loadSession("u1", fake), null);
  saveSession("u1", "replay", null, fake);
  assert.equal(loadSession("u1", fake), null, "a replay was saved");
});
