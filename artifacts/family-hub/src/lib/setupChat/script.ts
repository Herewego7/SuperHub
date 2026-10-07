// The setup chat's script: every question, the answers it offers, what it
// understands when someone types instead, and what each answer saves. It is
// scripted rather than AI, so replies are instant and free, and every save
// goes through ./saves with the same request the old setup buttons sent.
//
// Pure apart from the injected `request`: the chat screen renders `view()`
// and hands each tap or typed reply to `answer()`.
import {
  NO_WORDS,
  YES_WORDS,
  joinNames,
  matchChoice,
  normalize,
  parseAmount,
  parseEmail,
  parseInviteCode,
  parseLocation,
  parseNames,
  parseNumberList,
  parsePin,
  parseRegion,
  tidyName,
  type Region,
} from "./parse";
import * as saves from "./saves";
import type { SaveDeps, InviteeRole } from "./saves";
import { countryFromName, type CountryCode } from "../regions";
import type { SkippableStep } from "../onboardingSteps";

export type Mode = "fresh" | "joiner" | "replay";
export type ChapterId = "you" | "family" | "location" | "calendar" | "rewards" | "invite" | "done";

export const CHAPTERS: Record<Mode, ChapterId[]> = {
  fresh: ["you", "family", "location", "calendar", "rewards", "invite", "done"],
  joiner: ["you", "location", "calendar", "done"],
  replay: ["you", "location", "calendar", "rewards", "invite", "done"],
};

export const CHAPTER_LABELS: Record<ChapterId, string> = {
  you: "You",
  family: "Family",
  location: "Location",
  calendar: "Calendars",
  rewards: "Rewards",
  invite: "Invite",
  done: "Done",
};

/** Same palette, in the same order, as the old walkthrough. */
export const PROFILE_COLORS = ["#5E8FAD", "#E07B6A", "#6DB98A", "#A67BB9", "#D4A843", "#5BA9A9", "#D97DB5", "#7B9E6B"];

export interface Person {
  id: string;
  name: string;
  color: string;
  role?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  googleCalendarConnected?: boolean | null;
  outlookCalendarConnected?: boolean | null;
  icalConnected?: boolean | null;
}

export interface RewardsNow {
  hasParentPin: boolean;
  pinGatedFeatures: string[];
  redemptionMode: string;
  pointsMode: string;
  centsPerPoint: number;
  completionBonusPoints: number;
  currencySymbol?: string | null;
}

/** What the app already knows, read fresh for every answer. */
export interface SetupContext {
  user: { id: string; email?: string | null; firstName?: string | null; displayName?: string | null };
  /** Everyone in the family except the shared "All Family" profile. */
  profiles: Person[];
  location: { city?: string | null; state?: string | null; country?: string | null; timezone?: string | null } | null;
  rewards: RewardsNow | null;
  /** The role this account was invited as, when it joined with a code. */
  inviteRole?: string | null;
  /** Everything a Parent PIN can lock, and the ones it locks by default. */
  pinFeatures: { key: string; label: string }[];
  pinDefaults: string[];
}

export interface Deps extends SaveDeps {
  ctx: SetupContext;
}

export type Art = "home" | "map" | "calendar" | "trophy" | "envelope" | "done";
export type Tint = "sky" | "sage" | "lavender" | "butter" | "peach";

export type Entry =
  | { kind: "bot"; text: string }
  | { kind: "me"; text: string }
  | { kind: "me-pin" }
  | { kind: "me-photo"; photoUrl: string }
  | { kind: "picture"; art: Art; tint: Tint; title: string; body?: string }
  | { kind: "profile"; id: string; line: "added" | "role" | "email" }
  | { kind: "roster"; ids: string[]; draft?: { name: string; color: string }[]; roles?: boolean; camera?: boolean }
  | { kind: "location"; city: string; region: string; timezone?: string | null }
  | { kind: "calendars" }
  | { kind: "rewards" }
  | { kind: "pin-locks"; features: string[]; title: string }
  | { kind: "code"; code: string; email?: string }
  | { kind: "summary" };

export type QuestionId =
  | "welcome" | "join-code" | "join-confirm"
  | "you-name" | "you-name-type" | "you-pick" | "you-add-name" | "you-keep" | "you-photo" | "you-email" | "you-email-type"
  | "family-names" | "family-split" | "family-role" | "family-review" | "family-add" | "family-fix-pick" | "family-fix-name"
  | "location-keep" | "location-city" | "location-region" | "location-town" | "location-confirm"
  | "calendar"
  | "rewards-keep" | "rewards-earn" | "rewards-bonus" | "rewards-spend" | "rewards-rate"
  | "pin-ask" | "pin-enter" | "pin-confirm" | "pin-locks" | "pin-choose"
  | "invite-how" | "invite-email" | "invite-role" | "invite-more"
  | "done" | "tour";

export interface SetupState {
  version: 1;
  mode: Mode;
  q: QuestionId;
  transcript: Entry[];
  /** The profile that is this account's person. */
  meId?: string;
  /** People this chat added, until the profiles list catches up. */
  created: Person[];
  /** Changes this chat made, until the profiles list catches up. */
  edits: Record<string, Partial<Person>>;
  /** Names still waiting for "grown-up or kid?". */
  pendingNames: string[];
  splitText?: string;
  fixId?: string;
  place?: { city: string | null; region: Region | null; country: CountryCode | null };
  savedLocation?: { city: string; state: string; country: CountryCode; timezone?: string | null };
  earn?: "per_chore" | "per_completion";
  bonus?: number;
  spend?: "rewards_only" | "cashout_only" | "both";
  rate?: number;
  /** The first PIN entry, held only until it is confirmed. Never saved to
   *  the device (session.ts strips it). */
  pinFirst?: string;
  pinChoice?: string[];
  inviteEmail?: string;
  codes: { code: string; email?: string }[];
  joinCode?: string;
  /** Set by a summary card's "Change": go back to the summary afterwards. */
  returnToDone?: boolean;
  toured?: boolean;
}

export type IconName = "camera" | "image" | "lock" | "mail" | "check" | "link" | "pencil" | "plus" | "play" | "device" | "pin" | "calendar" | "star";

export type OptionArt =
  | { kind: "icon"; icon: IconName }
  | { kind: "avatar"; profileId: string }
  | { kind: "role"; role: "adult" | "child" }
  | { kind: "trophy"; trophy: "chore" | "day" }
  | { kind: "spend"; spend: "rewards" | "cash" | "both" };

export interface Option {
  id: string;
  label: string;
  hint?: string;
  art?: OptionArt;
  /** Tile buttons sit two to a row with a picture on top. */
  tile?: boolean;
  primary?: boolean;
  /** Tapping opens the photo picker instead of answering. */
  upload?: "camera" | "library";
  say?: readonly string[];
}

export interface QuestionView {
  options: Option[];
  layout: "list" | "chips";
  /** Answers show numbers, and a typed number picks one. */
  numbered: boolean;
  input: "text" | "pin" | "none";
  inputMode?: "text" | "email" | "numeric";
  /** How the keyboard capitalises: "words" for names and places. */
  autoCapitalize?: "words" | "characters";
  placeholder: string;
  /** Typed text only picks an answer on an exact match (the reply may be a name). */
  strict: boolean;
  /** A live card shown under the question. */
  card?: "calendar-live" | "pin-choose" | "tour";
}

export type Answer =
  | { kind: "choice"; id: string }
  | { kind: "text"; text: string }
  | { kind: "photo"; profileId: string; photoUrl: string }
  | { kind: "toggle"; key: string }
  | { kind: "tour-done" };

/** "joined" reloads into the new family; "finish" means setup is complete;
 *  "close" ends a replay. */
export interface Outcome {
  state: SetupState;
  after?: "joined" | "finish" | "close";
}

const NUDGE = "Tap an answer, or type its number.";
const TAP_OR_TYPE = "Tap an answer or type its number";
const SKIPPED = "No problem. You can finish this later from Settings.";
const SAVE_FAILED = "That didn't save. Check your connection and try again.";

const KEEP_WORDS = [...YES_WORDS, "keep", "keep it", "keep them", "fine", "good", "thats fine", "all good", "leave it"];
const CHANGE_WORDS = ["change", "change it", "edit", "update", "different", "no", "nope", "wrong", "not right", "fix it"];
const ADULT_WORDS = [
  "grown up", "grownup", "grown", "adult", "parent", "mom", "dad", "mum", "mother", "father", "grandma", "grandpa",
  "grandparent", "grandmother", "grandfather", "wife", "husband", "partner", "spouse", "aunt", "uncle", "nanny",
];
const KID_WORDS = ["kid", "child", "son", "daughter", "teen", "teenager", "baby", "boy", "girl", "toddler", "kiddo", "student"];

const UNHANDLED = { unhandled: true } as const;
type Result = Outcome | void | typeof UNHANDLED;

interface QuestionDef {
  chapter: ChapterId | null;
  enter(s: SetupState, d: Deps, variant?: string): void;
  view(s: SetupState, ctx: SetupContext): QuestionView;
  choose?(s: SetupState, d: Deps, id: string): Promise<Result> | Result;
  /** Typed text the answers don't cover. With `textFirst`, it gets the text
   *  before the answers do, and returns UNHANDLED to pass. */
  text?(s: SetupState, d: Deps, text: string): Promise<Result> | Result;
  textFirst?: boolean;
  /** Said when a typed reply matches nothing. */
  nudge?: string;
  photo?(s: SetupState, d: Deps, profileId: string, photoUrl: string): Promise<Result>;
  toggle?(s: SetupState, d: Deps, key: string): void;
}

// ── Small helpers ───────────────────────────────────────────────────────────

function bot(s: SetupState, text: string) {
  s.transcript.push({ kind: "bot", text });
}
function me(s: SetupState, text: string) {
  s.transcript.push({ kind: "me", text });
}
function picture(s: SetupState, art: Art, tint: Tint, title: string, body?: string) {
  s.transcript.push({ kind: "picture", art, tint, title, body });
}
function card(s: SetupState, entry: Entry) {
  s.transcript.push(entry);
}

function icon(name: IconName): OptionArt {
  return { kind: "icon", icon: name };
}

function list(options: Option[], extra: Partial<QuestionView> = {}): QuestionView {
  return { options, layout: "list", numbered: true, input: "text", placeholder: TAP_OR_TYPE, strict: false, ...extra };
}

function chips(options: Option[], extra: Partial<QuestionView> = {}): QuestionView {
  return list(options, { layout: "chips", ...extra });
}

function keepOrChange(): QuestionView {
  return chips([
    { id: "keep", label: "Keep it", say: KEEP_WORDS },
    { id: "change", label: "Change it", art: icon("pencil"), say: CHANGE_WORDS },
  ]);
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function accountName(ctx: SetupContext): string {
  const first = ctx.user.firstName?.trim() || ctx.user.displayName?.trim().split(/\s+/)[0] || "";
  return tidyName(first);
}

/** Everyone in the family, with this chat's own adds and edits applied
 *  until the profiles list refetches. */
export function knownPeople(s: SetupState, ctx: SetupContext): Person[] {
  const people = ctx.profiles.map((p) => ({ ...p, ...(s.edits[p.id] ?? {}) }));
  for (const p of s.created) {
    if (!people.some((q) => q.id === p.id)) people.push({ ...p, ...(s.edits[p.id] ?? {}) });
  }
  return people;
}

function person(s: SetupState, ctx: SetupContext, id: string | undefined): Person | undefined {
  return id ? knownPeople(s, ctx).find((p) => p.id === id) : undefined;
}

/** Profiles that look like this account: the same email, or the same name. */
function lookalikes(ctx: SetupContext, people: Person[]): Map<string, "email" | "name"> {
  const found = new Map<string, "email" | "name">();
  for (const p of people) {
    if (same(p.email, ctx.user.email)) found.set(p.id, "email");
    else if (same(p.name, accountName(ctx)) || same(p.name, ctx.user.displayName)) found.set(p.id, "name");
  }
  return found;
}

function findMe(s: SetupState, ctx: SetupContext): string | undefined {
  const people = knownPeople(s, ctx);
  const found = lookalikes(ctx, people);
  const byEmail = [...found].filter(([, why]) => why === "email");
  if (byEmail.length === 1) return byEmail[0][0];
  if (byEmail.length === 0 && found.size === 1) return [...found.keys()][0];
  return undefined;
}

/** The first color nobody in the family has yet. */
export function nextColor(people: { color: string }[]): string {
  const used = new Set(people.map((p) => p.color.toLowerCase()));
  return PROFILE_COLORS.find((c) => !used.has(c.toLowerCase())) ?? PROFILE_COLORS[people.length % PROFILE_COLORS.length];
}

function anyCalendar(people: Person[]): boolean {
  return people.some((p) => p.googleCalendarConnected || p.outlookCalendarConnected || p.icalConnected);
}

function currency(ctx: SetupContext): string {
  return ctx.rewards?.currencySymbol || "$";
}

function starsPerDollar(centsPerPoint: number): string {
  return String(Math.round((100 / centsPerPoint) * 100) / 100);
}

export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** A location saved earlier: by this chat, or before it. */
function savedPlace(s: SetupState, ctx: SetupContext): { city: string; state: string; country: CountryCode; timezone?: string | null } | null {
  if (s.savedLocation) return s.savedLocation;
  const loc = ctx.location;
  if (loc?.city?.trim() && loc.state?.trim()) {
    return { city: loc.city.trim(), state: loc.state.trim(), country: countryFromName(loc.country), timezone: loc.timezone };
  }
  return null;
}

function regionName(state: string, country: CountryCode): string {
  return parseRegion(state, country)?.name ?? state;
}

function locationCard(s: SetupState, ctx: SetupContext) {
  const place = savedPlace(s, ctx);
  if (place) card(s, { kind: "location", city: place.city, region: regionName(place.state, place.country), timezone: place.timezone });
}

/** "Central Time" for America/Chicago, or null if the device can't say. */
export function timeZoneLabel(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return name ? name.replace(/ (Standard|Daylight) Time$/, " Time") : null;
  } catch {
    return null;
  }
}

/** Looks like a name someone typed, rather than a question or a "hmm". */
function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40 || !/^[\p{L}][\p{L}'’. -]*$/u.test(t)) return false;
  const words = normalize(t).split(" ");
  if (words.length > 3) return false;
  return !["i", "im", "not", "no", "what", "why", "how", "dont", "maybe", "idk", "huh", "hmm", "um", "uh", "help", "wait"].includes(words[0]);
}

// ── Moving between chapters ─────────────────────────────────────────────────

function go(s: SetupState, d: Deps, q: QuestionId, variant?: string) {
  s.q = q;
  QUESTIONS[q].enter(s, d, variant);
}

function isSkippable(chapter: ChapterId): chapter is SkippableStep {
  return chapter !== "family" && chapter !== "done";
}

function startChapter(s: SetupState, d: Deps, chapter: ChapterId, variant?: string) {
  switch (chapter) {
    case "you":
      return startYou(s, d);
    case "family": {
      const others = knownPeople(s, d.ctx).filter((p) => p.id !== s.meId);
      return others.length ? go(s, d, "family-review", "so-far") : go(s, d, "family-names");
    }
    case "location":
      return startLocation(s, d, variant);
    case "calendar":
      return go(s, d, "calendar", variant);
    case "rewards":
      return s.mode === "replay" && variant !== "change" ? go(s, d, "rewards-keep") : go(s, d, "rewards-earn", variant);
    case "invite":
      return go(s, d, "invite-how", variant);
    case "done":
      return go(s, d, "done");
  }
}

function startYou(s: SetupState, d: Deps) {
  if (s.mode === "joiner") return go(s, d, "you-pick", "joiner");
  if (s.mode === "fresh" && knownPeople(s, d.ctx).length === 0) return go(s, d, "you-name");
  const found = s.meId ?? findMe(s, d.ctx);
  if (!found) return go(s, d, "you-pick", s.mode === "fresh" ? "fresh" : undefined);
  s.meId = found;
  if (s.mode === "replay") return go(s, d, "you-keep");
  const name = accountName(d.ctx);
  bot(s, name ? `Welcome back, ${name}! Let's finish setting up.` : "Welcome back! Let's finish setting up.");
  go(s, d, "you-photo");
}

function startLocation(s: SetupState, d: Deps, variant?: string) {
  if (variant === "change") return go(s, d, "location-city", "again");
  if (savedPlace(s, d.ctx)) {
    if (s.mode === "replay") return go(s, d, "location-keep");
    bot(s, "Your family's location is already saved.");
    locationCard(s, d.ctx);
    return finishChapter(s, d, "location", "done");
  }
  go(s, d, "location-city");
}

/** Marks the chapter (a replay never marks one skipped) and moves on: to the
 *  summary after a "Change", otherwise to the next chapter. */
function finishChapter(s: SetupState, d: Deps, chapter: ChapterId, mark?: "done" | "skip") {
  if (mark && isSkippable(chapter)) {
    if (mark === "done" || s.mode !== "replay") saves.markStep(d, chapter, mark);
    if (mark === "skip" && s.mode !== "replay") bot(s, SKIPPED);
  }
  if (s.returnToDone) {
    s.returnToDone = false;
    return go(s, d, "done", "again");
  }
  const chapters = CHAPTERS[s.mode];
  startChapter(s, d, chapters[chapters.indexOf(chapter) + 1] ?? "done");
}

// ── Saves that more than one question shares ────────────────────────────────

async function createMe(s: SetupState, d: Deps, name: string): Promise<Result> {
  if (!name) {
    bot(s, "What should everyone call you?");
    return;
  }
  const people = knownPeople(s, d.ctx);
  if (people.some((p) => same(p.name, name))) {
    bot(s, `**${name}** is already in your family. Type a different name.`);
    s.q = "you-name-type";
    return;
  }
  const role: "adult" | "child" = s.mode === "joiner" && d.ctx.inviteRole === "child" ? "child" : "adult";
  const color = nextColor(people);
  try {
    const created = await saves.createProfile(d, { name, color, role });
    s.meId = created.id;
    s.created.push({ id: created.id, name, color, role, photoUrl: null, email: null });
  } catch {
    bot(s, SAVE_FAILED);
    return;
  }
  card(s, { kind: "profile", id: s.meId!, line: "added" });
  go(s, d, "you-photo");
}

async function saveMyEmail(s: SetupState, d: Deps, email: string): Promise<Result> {
  try {
    await saves.updateProfile(d, s.meId!, { email });
    s.edits[s.meId!] = { ...s.edits[s.meId!], email };
  } catch {
    bot(s, SAVE_FAILED);
    return;
  }
  finishChapter(s, d, "you", "done");
}

async function savePhoto(s: SetupState, d: Deps, profileId: string, photoUrl: string): Promise<boolean> {
  try {
    await saves.updateProfile(d, profileId, { photoUrl });
    s.edits[profileId] = { ...s.edits[profileId], photoUrl };
    return true;
  } catch {
    bot(s, "That photo didn't save. Try again.");
    return false;
  }
}

function takeNames(s: SetupState, d: Deps, text: string): Result {
  me(s, text.trim());
  const { names, ambiguous } = parseNames(text);
  if (names.length === 0) {
    bot(s, "Type their first names, like Sarah, Ava and Noah.");
    return;
  }
  if (ambiguous) {
    s.splitText = names[0];
    return go(s, d, "family-split");
  }
  acceptNames(s, d, names);
}

/** Returns false, staying put, when every name is already in the family. */
function acceptNames(s: SetupState, d: Deps, names: string[]): boolean {
  const people = knownPeople(s, d.ctx);
  const already = names.filter((n) => people.some((p) => same(p.name, n)));
  const fresh = names.filter((n) => !already.includes(n));
  if (already.length) {
    bot(s, `${joinNames(already.map((n) => `**${n}**`))} ${already.length === 1 ? "is" : "are"} already in your family.`);
  }
  if (fresh.length === 0) return false;
  s.pendingNames = fresh;
  bot(s, `Got it, that's ${countWord(people.length + fresh.length)} of you.`);
  const colors: string[] = [];
  for (let i = 0; i < fresh.length; i++) colors.push(nextColor([...people, ...colors.map((color) => ({ color }))]));
  card(s, { kind: "roster", ids: people.map((p) => p.id), draft: fresh.map((name, i) => ({ name, color: colors[i] })) });
  go(s, d, "family-role", "first");
  return true;
}

async function saveCity(s: SetupState, d: Deps, city: string, region: Region): Promise<Result> {
  try {
    const saved = await saves.saveLocation(d, city, region);
    s.savedLocation = { city, state: region.abbr, country: region.country, timezone: saved.timezone ?? null };
  } catch {
    bot(s, "I couldn't save your location just now. Try again.");
    return;
  }
  s.place = undefined;
  go(s, d, "location-confirm");
}

function setBonus(s: SetupState, d: Deps, n: number): Result {
  const stars = Math.round(n);
  if (stars < 1 || stars > 1000) {
    bot(s, "Pick a number of stars from 1 to 1000.");
    return;
  }
  s.bonus = stars;
  go(s, d, "rewards-spend");
}

function setRate(s: SetupState, d: Deps, n: number): Promise<Result> | Result {
  if (!(n > 0) || n > 100) {
    bot(s, "Pick a number from 1 to 100.");
    return;
  }
  s.rate = n;
  return finishRewards(s, d);
}

function rewardsSentence(s: SetupState, symbol: string): string {
  const earn = s.earn === "per_completion" ? `**${s.bonus ?? 10} stars** for finishing the day` : "Stars for **each chore**";
  const spend = s.spend === "rewards_only" ? "spent on rewards" : s.spend === "cashout_only" ? "cashed out" : "spend or cash out";
  const rate = s.spend !== "rewards_only" && s.rate ? `, **${s.rate} stars = ${symbol}1**` : "";
  return `${earn}, ${spend}${rate}.`;
}

async function finishRewards(s: SetupState, d: Deps): Promise<Result> {
  try {
    await saves.saveRewards(d, {
      pointsMode: s.earn!,
      redemptionMode: s.spend!,
      completionBonusPoints: s.earn === "per_completion" ? s.bonus : undefined,
      starsPerDollar: s.spend !== "rewards_only" ? s.rate : undefined,
    });
  } catch {
    bot(s, SAVE_FAILED);
    return;
  }
  bot(s, `Saved! ${rewardsSentence(s, currency(d.ctx))}`);
  go(s, d, "pin-ask");
}

async function noPin(s: SetupState, d: Deps): Promise<Result> {
  try {
    await saves.savePin(d, []);
  } catch {
    bot(s, SAVE_FAILED);
    return;
  }
  bot(s, "No PIN for now. You can add one in Settings any time.");
  finishChapter(s, d, "rewards");
}

async function makeInvite(s: SetupState, d: Deps, invite: { email?: string; role?: InviteeRole }): Promise<Result> {
  let code: string | undefined;
  try {
    code = await saves.createInvite(d, invite);
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : "";
    bot(s, reason ? `I couldn't make that invite: ${reason}` : "I couldn't make an invite just now. Try again.");
    return;
  }
  if (!code) {
    bot(s, "I couldn't make an invite just now. Try again.");
    return;
  }
  s.codes.push({ code, email: invite.email });
  if (invite.email) bot(s, `Sent! I emailed an invite to **${invite.email}**.`);
  card(s, { kind: "code", code, email: invite.email });
  s.inviteEmail = undefined;
  go(s, d, "invite-more");
}

async function finish(s: SetupState, d: Deps): Promise<Result> {
  if (s.mode === "replay") return { state: s, after: "close" };
  try {
    await saves.completeOnboarding(d);
  } catch {
    bot(s, "I couldn't finish setup just now. Check your connection and tap **Open SuperHub** again.");
    return;
  }
  return { state: s, after: "finish" };
}

// ── The questions ───────────────────────────────────────────────────────────

const QUESTIONS: Record<QuestionId, QuestionDef> = {
  welcome: {
    chapter: null,
    enter(s, d) {
      const name = accountName(d.ctx);
      bot(s, name ? `Hi ${name}! I'm SuperHub, your family's helper.` : "Hi! I'm SuperHub, your family's helper.");
      picture(s, "home", "sky", "Let's set up your home base", "About two minutes. Tap an answer, or type its number.");
      bot(s, "Are you starting a new family, or joining one?");
    },
    view: () =>
      list(
        [
          { id: "new", label: "Start a new family", hint: "Add the people who live with you", art: icon("plus"), say: ["new", "new family", "start", "create", "start one", "my family", "a new family"] },
          { id: "join", label: "Join a family", hint: "I have an invite code", art: icon("mail"), say: ["join", "join one", "invite", "code", "invite code", "i have a code", "i have an invite code"] },
        ],
        { placeholder: "Tap an answer or type 1 or 2" },
      ),
    choose(s, d, id) {
      if (id === "new") return startChapter(s, d, "you");
      go(s, d, "join-code");
    },
  },

  "join-code": {
    chapter: null,
    enter(s) {
      bot(s, "Type the 8-character code from your invite.");
    },
    view: () => chips([{ id: "back", label: "I don't have one", say: ["back", "no", "none", "i dont have one", "dont have one", "start a new family", "new"] }], { strict: true, placeholder: "Invite code, like K7M2 QX9P", autoCapitalize: "characters" }),
    choose(s, d) {
      bot(s, "No problem. Let's start a new family instead.");
      startChapter(s, d, "you");
    },
    textFirst: true,
    text(s, d, text) {
      const code = parseInviteCode(text);
      if (!code) return UNHANDLED;
      me(s, formatCode(code));
      s.joinCode = code;
      return go(s, d, "join-confirm");
    },
    nudge: "Invite codes are 8 letters and numbers, like K7M2 QX9P. Check the code and try again.",
  },

  "join-confirm": {
    chapter: null,
    enter(s, d) {
      const hasData = d.ctx.profiles.length > 0;
      bot(
        s,
        hasData
          ? "Join this family? This will replace any data in your current family (chores, calendar, etc.) with the invited family's shared data. This can't be undone."
          : "Join this family? You'll be added to their family and see their shared chores, calendar, and more.",
      );
    },
    view: () =>
      chips([
        { id: "join", label: "Join family", primary: true, say: [...YES_WORDS, "join", "join family"] },
        { id: "cancel", label: "Cancel", say: ["cancel", "no", "back", "nope", "never mind"] },
      ]),
    async choose(s, d, id) {
      if (id === "cancel") {
        s.joinCode = undefined;
        return go(s, d, "welcome");
      }
      try {
        await saves.joinFamily(d, s.joinCode!);
      } catch (e) {
        const reason = e instanceof Error && e.message ? e.message : "";
        bot(s, reason ? `Couldn't join: ${reason}` : "Couldn't join just now. Check the code and try again.");
        return go(s, d, "join-code");
      }
      return { state: s, after: "joined" };
    },
  },

  "you-name": {
    chapter: "you",
    enter(s, d) {
      const name = accountName(d.ctx);
      bot(s, name ? `Great! Let's start with you. Should everyone see you as **${name}**?` : "Great! Let's start with you. What's your first name?");
    },
    view(s, ctx) {
      const name = accountName(ctx);
      if (!name) return list([], { placeholder: "Your first name", autoCapitalize: "words" });
      return list([
        { id: "yes", label: `Yes, ${name}`, say: [...YES_WORDS, name] },
        { id: "other", label: "Use a different name", art: icon("pencil"), say: ["no", "nope", "different", "different name", "a different name", "change", "change it", "other"] },
      ], { autoCapitalize: "words" });
    },
    choose(s, d, id) {
      if (id === "other") return go(s, d, "you-name-type");
      return createMe(s, d, accountName(d.ctx));
    },
    text(s, d, text) {
      if (accountName(d.ctx) && !looksLikeName(text)) return UNHANDLED;
      me(s, text.trim());
      return createMe(s, d, tidyName(text));
    },
  },

  "you-name-type": {
    chapter: "you",
    enter(s) {
      bot(s, "What should everyone call you?");
    },
    view: () => list([], { placeholder: "Your first name", autoCapitalize: "words" }),
    text(s, d, text) {
      me(s, text.trim());
      return createMe(s, d, tidyName(text));
    },
  },

  "you-pick": {
    chapter: "you",
    enter(s, d, variant) {
      const name = accountName(d.ctx);
      if (variant === "joiner") {
        bot(s, name ? `Welcome, ${name}! Your family is already set up here.` : "Welcome! Your family is already set up here.");
        picture(s, "home", "sky", "You're in", "Let's add your part. It takes about a minute.");
      } else if (variant === "fresh") {
        bot(s, name ? `Welcome back, ${name}! Let's finish setting up.` : "Welcome back! Let's finish setting up.");
      }
      bot(s, "Which one is you?");
    },
    view(s, ctx) {
      const people = knownPeople(s, ctx);
      const found = lookalikes(ctx, people);
      return list([
        ...people.map((p) => ({
          id: `p:${p.id}`,
          label: p.name,
          hint: found.get(p.id) === "email" ? "Same email as your account" : found.get(p.id) === "name" ? "Same name as your account" : undefined,
          art: { kind: "avatar", profileId: p.id } as OptionArt,
          say: [p.name],
        })),
        { id: "none", label: "I'm not on the list", art: icon("plus"), say: ["none", "not on the list", "not listed", "add me", "none of these", "none of them", "neither", "no", "nope"] },
      ]);
    },
    choose(s, d, id) {
      if (id === "none") return go(s, d, "you-add-name");
      s.meId = id.slice(2);
      go(s, d, "you-photo");
    },
  },

  "you-add-name": {
    chapter: "you",
    enter(s) {
      bot(s, "What's your name?");
    },
    view(s, ctx) {
      const name = accountName(ctx);
      return name
        ? chips([{ id: "account", label: name, say: [...YES_WORDS, name] }], { strict: true, placeholder: "Your first name", autoCapitalize: "words" })
        : list([], { placeholder: "Your first name", autoCapitalize: "words" });
    },
    choose(s, d) {
      return createMe(s, d, accountName(d.ctx));
    },
    text(s, d, text) {
      me(s, text.trim());
      return createMe(s, d, tidyName(text));
    },
  },

  "you-keep": {
    chapter: "you",
    enter(s) {
      bot(s, "Here's you:");
      card(s, { kind: "profile", id: s.meId!, line: "email" });
      bot(s, "Keep your photo and email?");
    },
    view: () => keepOrChange(),
    choose(s, d, id) {
      if (id === "change") return go(s, d, "you-photo");
      finishChapter(s, d, "you", "done");
    },
  },

  "you-photo": {
    chapter: "you",
    enter(s, d) {
      bot(s, person(s, d.ctx, s.meId)?.photoUrl ? "Want a new photo, or keep this one?" : "Add a photo so everyone can spot you at a glance?");
    },
    view(s, ctx) {
      const has = !!person(s, ctx, s.meId)?.photoUrl;
      return list([
        { id: "camera", label: has ? "Take a new photo" : "Take a photo", art: icon("camera"), upload: "camera", say: ["camera", "take one", "take a photo", "selfie"] },
        { id: "library", label: has ? "Choose a new photo" : "Choose a photo", art: icon("image"), upload: "library", say: ["library", "choose one", "choose a photo", "photos", "pick one"] },
        has
          ? { id: "skip", label: "Keep this one", say: KEEP_WORDS }
          : { id: "skip", label: "Not now", hint: "Your initials show instead", say: [...NO_WORDS, "no photo"] },
      ]);
    },
    choose(s, d) {
      go(s, d, "you-email");
    },
    async photo(s, d, profileId, photoUrl) {
      if (profileId !== s.meId) {
        await savePhoto(s, d, profileId, photoUrl);
        return;
      }
      s.transcript.push({ kind: "me-photo", photoUrl });
      if (!(await savePhoto(s, d, profileId, photoUrl))) return;
      bot(s, "Looking good!");
      card(s, { kind: "profile", id: profileId, line: "role" });
      go(s, d, "you-email");
    },
  },

  "you-email": {
    chapter: "you",
    enter(s, d) {
      const email = person(s, d.ctx, s.meId)?.email;
      bot(s, email ? `Your profile email is **${email}**. Keep it?` : "Which email should go on your profile?");
    },
    view(s, ctx) {
      if (person(s, ctx, s.meId)?.email) {
        return chips(
          [
            { id: "keep", label: "Keep it", say: KEEP_WORDS },
            { id: "other", label: "Change it", art: icon("pencil"), say: CHANGE_WORDS },
          ],
          { inputMode: "email" },
        );
      }
      const account = ctx.user.email?.trim();
      const options: Option[] = [];
      if (account) options.push({ id: "account", label: account, hint: "The one you sign in with", art: icon("mail"), say: [...YES_WORDS, "mine", "that one", "that", "the one i sign in with"] });
      options.push({ id: "other", label: account ? "A different one" : "Add an email", art: icon("pencil"), say: ["different", "a different one", "another", "other", "another one", "add", "add an email"] });
      options.push({ id: "skip", label: "Skip", say: [...NO_WORDS, "none", "no email"] });
      return list(options, { inputMode: "email" });
    },
    textFirst: true,
    text(s, d, text) {
      const email = parseEmail(text);
      if (!email) return UNHANDLED;
      me(s, email);
      return saveMyEmail(s, d, email);
    },
    choose(s, d, id) {
      if (id === "other") return go(s, d, "you-email-type");
      if (id === "account") return saveMyEmail(s, d, d.ctx.user.email!.trim());
      finishChapter(s, d, "you", "done");
    },
  },

  "you-email-type": {
    chapter: "you",
    enter(s) {
      bot(s, "What email should go on your profile?");
    },
    view: () => chips([{ id: "skip", label: "Skip", say: [...NO_WORDS, "none", "no email"] }], { inputMode: "email", strict: true, placeholder: "name@example.com" }),
    textFirst: true,
    text(s, d, text) {
      const email = parseEmail(text);
      if (!email) return UNHANDLED;
      me(s, email);
      return saveMyEmail(s, d, email);
    },
    nudge: "That doesn't look like an email address. Try again, or tap Skip.",
    choose(s, d) {
      finishChapter(s, d, "you", "done");
    },
  },

  "family-names": {
    chapter: "family",
    enter(s) {
      bot(s, "Who else lives with you? Type their first names.");
    },
    view: () =>
      chips([{ id: "solo", label: "It's just me", say: ["just me", "only me", "me", "nobody", "no one", "none", "no", "nope", "just me for now"] }], {
        strict: true,
        placeholder: "Type names, like Sarah, Ava and Noah",
        autoCapitalize: "words",
      }),
    choose(s, d) {
      finishChapter(s, d, "family");
    },
    text: (s, d, text) => takeNames(s, d, text),
  },

  "family-add": {
    chapter: "family",
    enter(s) {
      bot(s, "Who else? Type their first names.");
    },
    view: () => chips([{ id: "cancel", label: "Never mind", say: ["never mind", "nevermind", "cancel", "no", "nope", "back"] }], { strict: true, placeholder: "Type names, like Sarah and Noah", autoCapitalize: "words" }),
    choose(s, d) {
      go(s, d, "family-review", "again");
    },
    text: (s, d, text) => takeNames(s, d, text),
  },

  "family-split": {
    chapter: "family",
    enter(s) {
      const words = s.splitText!.split(" ");
      bot(s, `Is **${s.splitText}** one person, or ${countWord(words.length)} people?`);
    },
    view(s) {
      const words = s.splitText!.split(" ");
      const many = countWord(words.length);
      return list([
        { id: "one", label: "One person", hint: s.splitText, say: ["one", "one person", "1 person", "single", "just one"] },
        {
          id: "many",
          label: `${many[0].toUpperCase()}${many.slice(1)} people`,
          hint: joinNames(words),
          say: [many, `${many} people`, `${words.length} people`, "separate", "different people"],
        },
      ]);
    },
    choose(s, d, id) {
      const text = s.splitText!;
      s.splitText = undefined;
      if (acceptNames(s, d, id === "one" ? [text] : text.split(" ").map(tidyName))) return;
      const others = knownPeople(s, d.ctx).some((p) => p.id !== s.meId);
      go(s, d, others ? "family-add" : "family-names");
    },
  },

  "family-role": {
    chapter: "family",
    enter(s, d, variant) {
      const name = s.pendingNames[0];
      bot(s, variant === "first" ? `Is **${name}** a grown-up or a kid?` : `And **${name}**?`);
    },
    view: () =>
      list(
        [
          { id: "adult", label: "Grown-up", art: { kind: "role", role: "adult" }, tile: true, say: ADULT_WORDS },
          { id: "child", label: "Kid", art: { kind: "role", role: "child" }, tile: true, say: KID_WORDS },
        ],
        { placeholder: "Tap, or type 1 or 2" },
      ),
    async choose(s, d, id) {
      const name = s.pendingNames[0];
      const role = id as "adult" | "child";
      const people = knownPeople(s, d.ctx);
      if (!people.some((p) => same(p.name, name))) {
        const color = nextColor(people);
        try {
          const created = await saves.createProfile(d, { name, color, role });
          s.created.push({ id: created.id, name, color, role, photoUrl: null, email: null });
        } catch {
          bot(s, `I couldn't add **${name}** just now. Tap Grown-up or Kid to try again.`);
          return;
        }
      }
      s.pendingNames = s.pendingNames.slice(1);
      if (s.pendingNames.length) return go(s, d, "family-role");
      go(s, d, "family-review");
    },
  },

  "family-review": {
    chapter: "family",
    enter(s, d, variant) {
      bot(
        s,
        variant === "again"
          ? "Here's everyone now."
          : variant === "so-far"
            ? "Here's your family so far. Tap a face to add a photo."
            : "Here's your family. Tap a face to add a photo.",
      );
      card(s, { kind: "roster", ids: knownPeople(s, d.ctx).map((p) => p.id), roles: true, camera: true });
    },
    view: () =>
      list([
        { id: "done", label: "Looks good", art: icon("check"), say: [...YES_WORDS, "good", "looks good", "done", "next", "thats everyone", "all good", "perfect"] },
        { id: "add", label: "Add someone", art: icon("plus"), say: ["add", "add someone", "add more", "more", "someone else", "another"] },
        { id: "fix", label: "Fix a name", art: icon("pencil"), say: ["fix", "fix a name", "rename", "change a name", "edit", "spelling", "typo"] },
      ]),
    choose(s, d, id) {
      if (id === "add") return go(s, d, "family-add");
      if (id === "fix") return go(s, d, "family-fix-pick");
      finishChapter(s, d, "family");
    },
  },

  "family-fix-pick": {
    chapter: "family",
    enter(s) {
      bot(s, "Whose name should I fix?");
    },
    view(s, ctx) {
      return list([
        ...knownPeople(s, ctx).map((p) => ({ id: `p:${p.id}`, label: p.name, art: { kind: "avatar", profileId: p.id } as OptionArt, say: [p.name] })),
        { id: "cancel", label: "Never mind", say: ["never mind", "nevermind", "cancel", "back", "none"] },
      ]);
    },
    choose(s, d, id) {
      if (id === "cancel") return go(s, d, "family-review", "again");
      s.fixId = id.slice(2);
      go(s, d, "family-fix-name");
    },
  },

  "family-fix-name": {
    chapter: "family",
    enter(s, d) {
      bot(s, `What should **${person(s, d.ctx, s.fixId)?.name ?? "they"}** be called?`);
    },
    view: () => chips([{ id: "cancel", label: "Never mind", say: ["never mind", "nevermind", "cancel", "back"] }], { strict: true, placeholder: "New name", autoCapitalize: "words" }),
    choose(s, d) {
      s.fixId = undefined;
      go(s, d, "family-review", "again");
    },
    async text(s, d, text) {
      me(s, text.trim());
      const name = tidyName(text);
      const id = s.fixId!;
      if (!name) return;
      if (knownPeople(s, d.ctx).some((p) => p.id !== id && same(p.name, name))) {
        bot(s, `**${name}** is already in your family. Type a different name.`);
        return;
      }
      try {
        await saves.renameProfile(d, id, name);
        s.edits[id] = { ...s.edits[id], name };
      } catch {
        bot(s, SAVE_FAILED);
        return;
      }
      bot(s, `Done. It's **${name}** now.`);
      s.fixId = undefined;
      go(s, d, "family-review", "again");
    },
  },

  "location-keep": {
    chapter: "location",
    enter(s, d) {
      bot(s, "Your family's location:");
      locationCard(s, d.ctx);
    },
    view: () => keepOrChange(),
    choose(s, d, id) {
      if (id === "change") return go(s, d, "location-city", "again");
      finishChapter(s, d, "location", "done");
    },
  },

  "location-city": {
    chapter: "location",
    enter(s, d, variant) {
      if (variant !== "again") picture(s, "map", "sage", "Where's home?", "Your city sets the time zone and the weather on Home.");
      bot(s, variant === "again" ? "What city should it be?" : "What city do you live in?");
    },
    view: (s) => chips([{ id: "skip", label: s.mode === "replay" ? "Skip" : "Not now", say: [...NO_WORDS] }], { strict: true, placeholder: "Your city, like Minneapolis MN", autoCapitalize: "words" }),
    choose(s, d) {
      finishChapter(s, d, "location", "skip");
    },
    text(s, d, text) {
      me(s, text.trim());
      const place = parseLocation(text);
      if (place.city && place.region) return saveCity(s, d, place.city, place.region);
      if (place.city) {
        s.place = { city: place.city, region: null, country: place.country };
        return go(s, d, "location-region");
      }
      if (place.region) {
        s.place = { city: null, region: place.region, country: place.region.country };
        return go(s, d, "location-town");
      }
      bot(s, "Type your city and state, like Minneapolis MN.");
    },
  },

  "location-region": {
    chapter: "location",
    enter(s) {
      bot(s, `Which state or province is **${s.place!.city}** in?`);
    },
    view: (s) => chips([{ id: "skip", label: s.mode === "replay" ? "Skip" : "Not now", say: [...NO_WORDS] }], { strict: true, placeholder: "State or province, like MN", autoCapitalize: "words" }),
    choose(s, d) {
      s.place = undefined;
      finishChapter(s, d, "location", "skip");
    },
    text(s, d, text) {
      me(s, text.trim());
      const region = parseRegion(text, s.place!.country ?? undefined);
      if (!region) {
        bot(s, "I don't know that one. Type a US state or Canadian province, like MN or Ontario.");
        return;
      }
      return saveCity(s, d, s.place!.city!, region);
    },
  },

  "location-town": {
    chapter: "location",
    enter(s) {
      bot(s, `Which city in **${s.place!.region!.name}**?`);
    },
    view: (s) => chips([{ id: "skip", label: s.mode === "replay" ? "Skip" : "Not now", say: [...NO_WORDS] }], { strict: true, placeholder: "Your city", autoCapitalize: "words" }),
    choose(s, d) {
      s.place = undefined;
      finishChapter(s, d, "location", "skip");
    },
    text(s, d, text) {
      me(s, text.trim());
      const place = parseLocation(text);
      const city = place.city ?? tidyName(text);
      return saveCity(s, d, city, place.region ?? s.place!.region!);
    },
  },

  "location-confirm": {
    chapter: "location",
    enter(s, d) {
      locationCard(s, d.ctx);
      bot(s, "Is that right?");
    },
    view: () =>
      chips([
        { id: "yes", label: "Yes", say: [...YES_WORDS, "thats it", "perfect"] },
        { id: "change", label: "Change it", art: icon("pencil"), say: CHANGE_WORDS },
      ]),
    choose(s, d, id) {
      if (id === "change") return go(s, d, "location-city", "again");
      finishChapter(s, d, "location", "done");
    },
  },

  calendar: {
    chapter: "calendar",
    enter(s, d, variant) {
      if (variant !== "again" && variant !== "change") {
        bot(s, "Bring in the calendars you already use. Events show up on their own.");
        picture(s, "calendar", "lavender", "Google, Outlook or an iCal link");
      }
      bot(s, "Tap **Connect** next to anyone who has one.");
    },
    view(s, ctx) {
      const connected = anyCalendar(knownPeople(s, ctx));
      return list(
        connected
          ? [{ id: "done", label: "I'm done", art: icon("check"), say: [...YES_WORDS, "done", "im done", "finished", "next", "continue", "all set", "thats it", "thats all"] }]
          : [{ id: "skip", label: s.mode === "replay" ? "Skip" : "Not now", hint: "You can connect one later in Settings", say: [...NO_WORDS, "done", "im done", "none", "no calendars", "next", "continue"] }],
        { card: "calendar-live" },
      );
    },
    choose(s, d, id) {
      if (id === "done") {
        card(s, { kind: "calendars" });
        return finishChapter(s, d, "calendar", "done");
      }
      finishChapter(s, d, "calendar", "skip");
    },
  },

  "rewards-keep": {
    chapter: "rewards",
    enter(s) {
      bot(s, "Your stars and rewards:");
      card(s, { kind: "rewards" });
    },
    view: () => keepOrChange(),
    choose(s, d, id) {
      if (id === "change") return go(s, d, "rewards-earn", "change");
      saves.markStep(d, "rewards", "done");
      go(s, d, "pin-ask");
    },
  },

  "rewards-earn": {
    chapter: "rewards",
    enter(s, d, variant) {
      if (variant !== "change") picture(s, "trophy", "butter", "Stars and rewards", "Kids earn stars for chores, then spend them or cash out.");
      bot(s, "How should kids earn stars?");
    },
    view: (s) =>
      list([
        { id: "per_chore", label: "For each chore", hint: "Make bed = 2 stars", art: { kind: "trophy", trophy: "chore" }, tile: true, say: ["each chore", "each", "per chore", "every chore", "chore", "chores", "for each chore"] },
        { id: "per_completion", label: "For finishing the day", hint: "All chores done = 10 stars", art: { kind: "trophy", trophy: "day" }, tile: true, say: ["finishing the day", "the day", "day", "daily", "all chores", "whole day", "per day", "finishing"] },
        { id: "skip", label: s.mode === "replay" ? "Skip" : "Not now", hint: "Rewards can wait", say: [...NO_WORDS] },
      ]),
    choose(s, d, id) {
      if (id === "skip") return finishChapter(s, d, "rewards", "skip");
      s.earn = id as "per_chore" | "per_completion";
      go(s, d, id === "per_completion" ? "rewards-bonus" : "rewards-spend");
    },
  },

  "rewards-bonus": {
    chapter: "rewards",
    enter(s) {
      bot(s, "How many stars for finishing the whole day?");
    },
    view: () =>
      chips(
        [
          { id: "10", label: "10 stars" },
          { id: "5", label: "5 stars" },
          { id: "20", label: "20 stars" },
        ],
        { numbered: false, inputMode: "numeric", strict: true, placeholder: "Or type a number" },
      ),
    textFirst: true,
    text(s, d, text) {
      const n = parseAmount(text);
      if (n === null) return UNHANDLED;
      me(s, text.trim());
      return setBonus(s, d, n);
    },
    nudge: "Type a number of stars, like 10.",
    choose: (s, d, id) => setBonus(s, d, Number(id)),
  },

  "rewards-spend": {
    chapter: "rewards",
    enter(s) {
      bot(s, `${s.earn === "per_chore" ? "Nice and simple." : "Got it."} What can they do with their stars?`);
    },
    view: () =>
      list([
        { id: "rewards_only", label: "Spend on rewards", hint: "Things you add to the reward list", art: { kind: "spend", spend: "rewards" }, say: ["rewards", "spend", "spend them", "reward list", "prizes", "treats", "spend on rewards"] },
        { id: "cashout_only", label: "Cash out for money", hint: "Stars turn into money you pay out", art: { kind: "spend", spend: "cash" }, say: ["cash", "money", "cash out", "pay", "allowance", "dollars", "cash out for money"] },
        { id: "both", label: "Both", art: { kind: "spend", spend: "both" }, say: ["both", "either", "both please", "all", "spend or cash out"] },
      ]),
    choose(s, d, id) {
      s.spend = id as "rewards_only" | "cashout_only" | "both";
      if (id === "rewards_only") return finishRewards(s, d);
      return go(s, d, "rewards-rate");
    },
  },

  "rewards-rate": {
    chapter: "rewards",
    enter(s, d) {
      bot(s, `How many stars make ${currency(d.ctx)}1?`);
    },
    view: () =>
      chips(
        [
          { id: "10", label: "10 stars" },
          { id: "20", label: "20 stars" },
          { id: "5", label: "5 stars" },
        ],
        { numbered: false, inputMode: "numeric", strict: true, placeholder: "Or type a number" },
      ),
    textFirst: true,
    text(s, d, text) {
      const n = parseAmount(text);
      if (n === null) return UNHANDLED;
      me(s, text.trim());
      return setRate(s, d, n);
    },
    nudge: "Type a number of stars, like 10.",
    choose: (s, d, id) => setRate(s, d, Number(id)),
  },

  "pin-ask": {
    chapter: "rewards",
    enter(s, d) {
      if (d.ctx.rewards?.hasParentPin) {
        bot(s, "You already have a Parent PIN, so I'll leave it as it is.");
        return finishChapter(s, d, "rewards");
      }
      bot(s, "Want a Parent PIN? It keeps kids from changing chores, rewards and calendar settings.");
    },
    view: () =>
      list([
        { id: "yes", label: "Yes, set a PIN", art: icon("lock"), say: [...YES_WORDS, "set", "set a pin", "pin", "set one", "a pin"] },
        { id: "no", label: "Not now", hint: "You can add one later in Settings", say: [...NO_WORDS, "no pin", "dont need one", "none"] },
      ]),
    choose(s, d, id) {
      if (id === "yes") return go(s, d, "pin-enter");
      return noPin(s, d);
    },
  },

  "pin-enter": {
    chapter: "rewards",
    enter(s, d, variant) {
      bot(s, variant === "retry" ? "Those didn't match. Type a 4-digit PIN again." : "Type a 4-digit PIN.");
    },
    view: () => chips([{ id: "no", label: "Not now", say: NO_WORDS }], { input: "pin", numbered: false, inputMode: "numeric", placeholder: "4-digit PIN" }),
    choose: (s, d) => noPin(s, d),
    text(s, d, text) {
      const pin = parsePin(text);
      if (!pin) {
        bot(s, "The PIN needs to be exactly 4 digits.");
        return;
      }
      s.pinFirst = pin;
      s.transcript.push({ kind: "me-pin" });
      go(s, d, "pin-confirm");
    },
  },

  "pin-confirm": {
    chapter: "rewards",
    enter(s) {
      bot(s, "Once more to confirm.");
    },
    view: () => chips([{ id: "restart", label: "Start over", say: ["start over", "restart", "again", "back"] }], { input: "pin", numbered: false, inputMode: "numeric", placeholder: "4-digit PIN" }),
    choose(s, d) {
      s.pinFirst = undefined;
      go(s, d, "pin-enter");
    },
    async text(s, d, text) {
      const pin = parsePin(text);
      if (!pin) {
        bot(s, "The PIN needs to be exactly 4 digits.");
        return;
      }
      s.transcript.push({ kind: "me-pin" });
      if (pin !== s.pinFirst) {
        s.pinFirst = undefined;
        return go(s, d, "pin-enter", "retry");
      }
      s.pinFirst = undefined;
      const features = [...d.ctx.pinDefaults];
      try {
        await saves.savePin(d, features, pin);
      } catch {
        bot(s, "I couldn't save the PIN just now.");
        return go(s, d, "pin-enter");
      }
      s.pinChoice = features;
      go(s, d, "pin-locks");
    },
  },

  "pin-locks": {
    chapter: "rewards",
    enter(s) {
      card(s, { kind: "pin-locks", features: s.pinChoice ?? [], title: "PIN saved. It locks:" });
    },
    view: () =>
      chips([
        { id: "ok", label: "Sounds good", say: [...YES_WORDS, "good", "great", "fine", "perfect", "sounds good"] },
        { id: "choose", label: "Choose what it locks", art: icon("lock"), say: ["choose", "change", "pick", "customize", "edit", "choose what it locks", "change it"] },
      ]),
    choose(s, d, id) {
      if (id === "choose") return go(s, d, "pin-choose");
      finishChapter(s, d, "rewards");
    },
  },

  "pin-choose": {
    chapter: "rewards",
    enter(s) {
      bot(s, "Tap each one to turn it on or off, then tap **Save**.");
    },
    view: () => chips([{ id: "save", label: "Save", primary: true, say: ["save", "done", "ok", "okay", "finished", "save it"] }], { numbered: false, card: "pin-choose", placeholder: "Type a number to turn it on or off" }),
    textFirst: true,
    text(s, d, text) {
      const numbers = parseNumberList(text, d.ctx.pinFeatures.length);
      if (!numbers) return UNHANDLED;
      me(s, text.trim());
      for (const n of numbers) QUESTIONS["pin-choose"].toggle!(s, d, d.ctx.pinFeatures[n - 1].key);
      return undefined;
    },
    nudge: "Tap an item to turn it on or off, or type its number.",
    toggle(s, d, key) {
      const on = new Set(s.pinChoice ?? []);
      if (on.has(key)) on.delete(key);
      else on.add(key);
      s.pinChoice = d.ctx.pinFeatures.map((f) => f.key).filter((k) => on.has(k));
    },
    async choose(s, d) {
      const features = s.pinChoice ?? [];
      try {
        await saves.savePin(d, features);
      } catch {
        bot(s, SAVE_FAILED);
        return;
      }
      card(s, { kind: "pin-locks", features, title: features.length ? "Saved. The PIN locks:" : "Saved. Nothing is locked, so the PIN won't be asked for." });
      finishChapter(s, d, "rewards");
    },
  },

  "invite-how": {
    chapter: "invite",
    enter(s, d, variant) {
      if (variant !== "again" && variant !== "change") picture(s, "envelope", "peach", "Invite someone", "For anyone who needs their own login.");
      bot(s, "Email an invite, or get a code to share?");
    },
    view: (s) =>
      list(
        [
          { id: "email", label: "Email it", art: icon("mail"), say: ["email", "email it", "send", "send it", "mail", "send an email", "an email", "by email"] },
          { id: "code", label: "Just a code", art: icon("link"), say: ["code", "just a code", "a code", "share", "share a code", "get a code", "link"] },
          { id: "skip", label: s.codes.length ? "That's everyone" : "Not now", say: [...NO_WORDS, "nobody", "no one", "none", "thats everyone", "done"] },
        ],
        { inputMode: "email" },
      ),
    textFirst: true,
    text(s, d, text) {
      const email = parseEmail(text);
      if (!email) return UNHANDLED;
      me(s, email);
      s.inviteEmail = email;
      return go(s, d, "invite-role");
    },
    choose(s, d, id) {
      if (id === "email") return go(s, d, "invite-email");
      if (id === "code") return makeInvite(s, d, {});
      finishChapter(s, d, "invite", s.codes.length ? "done" : "skip");
    },
  },

  "invite-email": {
    chapter: "invite",
    enter(s) {
      bot(s, "What's their email?");
    },
    view: () => chips([{ id: "code", label: "Just a code instead", say: ["code", "just a code", "a code instead"] }], { inputMode: "email", strict: true, placeholder: "name@example.com" }),
    textFirst: true,
    text(s, d, text) {
      const email = parseEmail(text);
      if (!email) return UNHANDLED;
      me(s, email);
      s.inviteEmail = email;
      return go(s, d, "invite-role");
    },
    nudge: "That doesn't look like an email address. Try again.",
    choose: (s, d) => makeInvite(s, d, {}),
  },

  "invite-role": {
    chapter: "invite",
    enter(s) {
      bot(s, `Is **${s.inviteEmail}** for a grown-up or a kid?`);
    },
    view: () =>
      list([
        { id: "parent", label: "Grown-up", hint: "Can approve cash-outs", art: { kind: "role", role: "adult" }, say: ADULT_WORDS },
        { id: "child", label: "Kid", art: { kind: "role", role: "child" }, say: KID_WORDS },
        { id: "shared_device", label: "A shared device", hint: "Like a kitchen iPad", art: icon("device"), say: ["shared", "device", "shared device", "a shared device", "ipad", "tablet", "kitchen"] },
      ]),
    choose: (s, d, id) => makeInvite(s, d, { email: s.inviteEmail, role: id as InviteeRole }),
  },

  "invite-more": {
    chapter: "invite",
    enter(s) {
      bot(s, "Anyone else?");
    },
    view: () =>
      chips([
        { id: "another", label: "Invite someone else", art: icon("plus"), say: ["another", "someone else", "more", "yes", "yep", "sure", "invite another", "add", "one more"] },
        { id: "done", label: "That's everyone", say: ["no", "nope", "done", "thats everyone", "thats all", "thats it", "nobody", "no one", "everyone", "finished", "not now"] },
      ]),
    choose(s, d, id) {
      if (id === "another") return go(s, d, "invite-how", "again");
      finishChapter(s, d, "invite", "done");
    },
  },

  done: {
    chapter: "done",
    enter(s, d, variant) {
      if (variant === "after-tour") {
        bot(s, "That's the tour. You're ready to go.");
        return;
      }
      if (variant === "again") bot(s, "Updated. Here's everything now.");
      else {
        const name = accountName(d.ctx);
        picture(s, "done", "sage", name ? `You're all set, ${name}!` : "You're all set!", "Here's everything in one place.");
      }
      card(s, { kind: "summary" });
    },
    view(s) {
      const options: Option[] = [];
      if (!s.toured) options.push({ id: "tour", label: "Show me around", hint: "A quick tour of the app", art: icon("play"), say: ["tour", "show me", "show me around", "quick tour", "the tour"] });
      options.push({
        id: "open",
        label: s.mode === "replay" ? "Back to SuperHub" : "Open SuperHub",
        primary: true,
        say: ["open", "done", "finish", "finished", "go", "start", "get started", "lets go", "close", "back", "open superhub", "back to superhub", "open it"],
      });
      return list(options);
    },
    choose(s, d, id) {
      if (id === "tour") return go(s, d, "tour");
      return finish(s, d);
    },
  },

  tour: {
    chapter: "done",
    enter() {},
    view: () => ({ options: [], layout: "list", numbered: false, input: "none", placeholder: "", strict: true, card: "tour" }),
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

function emptyState(mode: Mode): SetupState {
  return { version: 1, mode, q: "welcome", transcript: [], created: [], edits: {}, pendingNames: [], codes: [] };
}

/** A replay starts at `initialStep`: the chapter a "Finish setting up"
 *  reminder points at, or "you" from Settings. */
export function startState(mode: Mode, d: Deps, initialStep?: SkippableStep): SetupState {
  const s = emptyState(mode);
  if (mode === "replay") {
    bot(s, "Let's walk through your setup. Keep what's right and change the rest.");
    startChapter(s, d, initialStep ?? "you");
  } else if (mode === "fresh" && knownPeople(s, d.ctx).length === 0) {
    go(s, d, "welcome");
  } else {
    startChapter(s, d, "you");
  }
  return s;
}

/** Picks a saved chat back up. The PIN was never saved, so a half-typed
 *  one starts over. */
export function resumeState(saved: SetupState): SetupState {
  const s = clone(saved);
  if (!(s.q in QUESTIONS)) s.q = "welcome";
  if (s.q === "pin-confirm" && !s.pinFirst) {
    s.q = "pin-enter";
    bot(s, "Let's set that PIN again. Type a 4-digit PIN.");
  }
  return s;
}

export function view(s: SetupState, ctx: SetupContext): QuestionView {
  return QUESTIONS[s.q].view(s, ctx);
}

/** The chapter list for the progress bar, and which one the chat is on. */
export function progress(s: SetupState): { labels: string[]; at: number } {
  const chapters = CHAPTERS[s.mode];
  const chapter = QUESTIONS[s.q].chapter;
  return { labels: chapters.map((c) => CHAPTER_LABELS[c]), at: chapter ? chapters.indexOf(chapter) : -1 };
}

async function pick(s: SetupState, d: Deps, q: QuestionDef, option: Option, typed?: string): Promise<Result> {
  if (option.upload) {
    me(s, typed ?? option.label);
    bot(s, `Tap **${option.label}** to ${option.upload === "camera" ? "open your camera" : "pick one from your photos"}.`);
    return;
  }
  me(s, option.label);
  return q.choose?.(s, d, option.id);
}

export async function answer(state: SetupState, a: Answer, d: Deps): Promise<Outcome> {
  const s = clone(state);
  const q = QUESTIONS[s.q];
  const v = q.view(s, d.ctx);
  let result: Result = undefined;

  if (a.kind === "choice") {
    if (a.id.startsWith("change:") && s.q === "done") {
      const target = a.id.slice("change:".length);
      me(s, target === "pin" ? "Change Parent PIN" : `Change ${CHAPTER_LABELS[target as ChapterId]?.toLowerCase() ?? target}`);
      s.returnToDone = true;
      if (target === "pin") go(s, d, "pin-ask");
      else if (target === "family") go(s, d, "family-review", "again");
      else if (target === "you") go(s, d, "you-photo");
      else startChapter(s, d, target as ChapterId, "change");
      return { state: s };
    }
    const option = v.options.find((o) => o.id === a.id);
    if (!option) return { state };
    result = await pick(s, d, q, option);
  } else if (a.kind === "text") {
    const text = a.text.trim();
    if (!text) return { state };
    if (v.input === "pin") {
      result = await q.text?.(s, d, text);
    } else {
      result = UNHANDLED;
      if (q.textFirst && q.text) result = await q.text(s, d, text);
      if (result === UNHANDLED) {
        const i = matchChoice(text, v.options, { strict: v.strict, numbers: v.numbered });
        if (i !== -1) result = await pick(s, d, q, v.options[i], text);
        else if (!q.textFirst && q.text) result = await q.text(s, d, text);
      }
      if (result === UNHANDLED) {
        me(s, text);
        bot(s, q.nudge ?? NUDGE);
        result = undefined;
      }
    }
  } else if (a.kind === "photo") {
    result = q.photo ? await q.photo(s, d, a.profileId, a.photoUrl) : void (await savePhoto(s, d, a.profileId, a.photoUrl));
  } else if (a.kind === "toggle") {
    q.toggle?.(s, d, a.key);
  } else if (a.kind === "tour-done" && s.q === "tour") {
    s.toured = true;
    go(s, d, "done", "after-tour");
  }

  return result && "state" in result ? result : { state: s };
}

// ── The summary card ────────────────────────────────────────────────────────

export interface SummaryRow {
  id: "location" | "calendar" | "rewards" | "pin" | "invite";
  icon: IconName;
  text: string;
  change: boolean;
}

export function summary(s: SetupState, ctx: SetupContext): { people: Person[]; names: string; changeFamily: boolean; rows: SummaryRow[] } {
  const people = knownPeople(s, ctx);
  const rows: SummaryRow[] = [];
  const place = savedPlace(s, ctx);
  rows.push({ id: "location", icon: "pin", text: place ? `${place.city}, ${place.state}` : "No location yet", change: true });

  const linked = people
    .map((p) => ({ name: p.name, kinds: [p.googleCalendarConnected && "Google", p.outlookCalendarConnected && "Outlook", p.icalConnected && "iCal"].filter(Boolean) as string[] }))
    .filter((p) => p.kinds.length);
  const total = linked.reduce((n, p) => n + p.kinds.length, 0);
  rows.push({
    id: "calendar",
    icon: "calendar",
    text: total ? `${joinNames(linked.map((p) => `${p.name}'s ${joinNames(p.kinds)}`))} ${total === 1 ? "calendar" : "calendars"}` : "No calendars connected",
    change: true,
  });

  if (s.mode !== "joiner") {
    const r = ctx.rewards;
    if (r) {
      const earn = r.pointsMode === "per_completion" ? `${r.completionBonusPoints} stars for finishing the day` : "Stars for each chore";
      const spend = r.redemptionMode === "rewards_only" ? "Spend on rewards" : `${starsPerDollar(r.centsPerPoint)} stars = ${currency(ctx)}1`;
      rows.push({ id: "rewards", icon: "star", text: `${earn} · ${spend}`, change: true });
      rows.push({ id: "pin", icon: "lock", text: r.hasParentPin ? "Parent PIN on" : "No Parent PIN", change: !r.hasParentPin });
    }
    const last = s.codes[s.codes.length - 1];
    rows.push({
      id: "invite",
      icon: "mail",
      text: last ? `Invite code ${formatCode(last.code)}${s.codes.length > 1 ? ` and ${s.codes.length - 1} more` : ""}` : "No invites yet",
      change: true,
    });
  }
  return { people, names: joinNames(people.map((p) => p.name)), changeFamily: s.mode === "fresh", rows };
}
