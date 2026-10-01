// Keyword-based detection of birthday/anniversary events, used by two
// features that deliberately share one definition of "this looks like a
// celebration":
//   1. A post-save suggestion toast when someone creates an event whose
//      title matches (see hooks/use-celebration-suggestion.tsx).
//   2. The "Scan my calendar" button in Celebrations, which reviews every
//      already-existing event in one pass (see celebrations-view.tsx).
//
// Deliberately NOT AI-backed: this runs entirely in the browser over data
// the user already has loaded, so nothing about anyone's calendar is sent
// to a third party. That's a hard requirement for this feature, not an
// optimization — see CLAUDE.md.

export type DetectedCelebrationType = "birthday" | "anniversary";

export interface DetectionResult {
  type: DetectedCelebrationType;
  /** Best-guess subject ("Emma", "John & Kate"). "" when none could be read. */
  name: string;
  /** Age / anniversary number stated in the title, e.g. "8th Birthday" → 8. */
  ordinal: number | null;
}

// ── Trigger words ────────────────────────────────────────────────────────────
// \b doesn't work against an emoji, so 🎂/💍 are matched on their own.
const BIRTHDAY_RE = /(\bbirthdays?\b|\bbirth\s+days?\b|\bb-?days?\b|\bb\s+day\b|🎂|🎈)/i;
const ANNIVERSARY_RE = /(\banniversar(?:y|ies)\b|\banniv\b|💍)/i;

// Titles that mention a celebration but are really a prep/errand task about
// it ("Buy birthday gift", "Plan Emma's birthday party"). Tracking those as
// recurring celebrations would be wrong — they're one-off to-dos.
const NOISE_RE =
  /\b(gifts?|presents?|cards?|shopping|shop|buy|order|plan|planning|prep|rsvp|invitations?|invites?|registry|deadline|reminder|budget|venue|decorations?)\b/i;

// The app's own synthetic celebration entries render as "🎉 …" — never
// re-detect those as new candidates (defensive; the scan also filters them
// out by id).
const OWN_SYNTHETIC_RE = /^\s*🎉/;

// Words that are part of the phrasing rather than someone's name. Without
// this, "Wedding Anniversary" reads as a person called "Wedding" and
// "Birthday Party" as one called "Party".
const GENERIC_NAME_RE =
  /^(wedding|happy|our|the|a|an|my|his|her|their|its|work|family|annual|yearly|party|celebration|dinner|lunch|brunch|bash|day|today|tomorrow)$/i;

function cleanName(raw: string): string {
  return raw
    // Strip emoji/pictographs anywhere (titles love them).
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    // "Emma turns 8" → "Emma"; the age is captured separately as `ordinal`.
    .replace(/\s+turns?\s+\d{1,3}\b/gi, "")
    // Drop leading/trailing punctuation and separators, but keep & and .
    .replace(/^[\s\-–—:,!¡?¿"'“”‘’()[\]]+/, "")
    .replace(/[\s\-–—:,!¡?¿"'“”‘’()[\]]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether an extracted string is plausibly somebody's name rather than a
 * leftover fragment of the title's own phrasing.
 */
function isUsableName(name: string, keyword: RegExp): boolean {
  if (!name) return false;
  // Bare milestone counts ("18", "18th", "25 year", "25 years") state the
  // number of years, not who it's for.
  if (/^\d{1,4}\s*(?:st|nd|rd|th)?(?:\s*(?:years?|yrs?))?$/i.test(name)) return false;
  if (GENERIC_NAME_RE.test(name)) return false;
  // Never let a trigger word itself become the name.
  if (new RegExp(`^${keyword.source}$`, "i").test(name)) return false;
  return true;
}

/** Normalized form used for comparing/deduping names. */
export function normalizeCelebrationName(name: string): string {
  return cleanName(name).toLowerCase();
}

function parseOrdinal(title: string): number | null {
  // "8th Birthday", "turns 8", "10 year anniversary"
  const m =
    title.match(/\b(\d{1,3})\s*(?:st|nd|rd|th)\b/i) ??
    title.match(/\bturns?\s+(\d{1,3})\b/i) ??
    title.match(/\b(\d{1,3})\s*(?:-|\s)?\s*years?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  // A plausible age / anniversary count. Rejects "2026th" style noise.
  return Number.isFinite(n) && n >= 1 && n <= 130 ? n : null;
}

/**
 * Decide whether an event title describes a birthday/anniversary, and pull
 * out whatever name/age it states. Returns null when it doesn't match, or
 * when it looks like a prep task rather than the day itself.
 */
export function detectCelebrationInTitle(title: string): DetectionResult | null {
  if (!title || OWN_SYNTHETIC_RE.test(title)) return null;
  const isBirthday = BIRTHDAY_RE.test(title);
  const isAnniversary = ANNIVERSARY_RE.test(title);
  if (!isBirthday && !isAnniversary) return null;
  if (NOISE_RE.test(title)) return null;

  // Anniversary wins a tie ("wedding anniversary birthday party" is absurd,
  // but if both appear the more specific word is the better guess).
  const type: DetectedCelebrationType = isAnniversary ? "anniversary" : "birthday";
  const ordinal = parseOrdinal(title);

  const KEYWORD = /(?:birthdays?|birth\s+days?|b-?days?|anniversar(?:y|ies)|anniv)/i;

  const ORD = `\\d{1,3}\\s*(?:st|nd|rd|th)`;
  // Tried in order, most explicit first; the first usable name wins.
  const patterns: RegExp[] = [
    // 1. Possessive: "Emma's Birthday", "Emma's 8th Birthday",
    //    "John & Kate's 10th Anniversary".
    new RegExp(`^\\s*(.+?)['’]s\\s+(?:${ORD}\\s+)?(?:\\w+\\s+)??${KEYWORD.source}`, "i"),
    // 2. Keyword-first separator: "Birthday - Emma", "Anniversary: John & Kate".
    new RegExp(`${KEYWORD.source}\\s*[-–—:]\\s*(.+)$`, "i"),
    // 3. Name-first separator: "Emma - Birthday", "Emma turns 8 — birthday".
    new RegExp(`^\\s*(.+?)\\s*[-–—:]\\s*(?:the\\s+)?(?:${ORD}\\s+)?(?:wedding\\s+)?${KEYWORD.source}\\s*$`, "i"),
    // 4. Trailing: "Happy Birthday Emma", "Birthday of Emma".
    //    "Happy birthday!" correctly yields nothing once punctuation is
    //    stripped, which is the right answer — there's no name in it.
    new RegExp(`(?:happy\\s+)?${KEYWORD.source}\\s+(?:to\\s+|for\\s+|of\\s+)?(.+)$`, "i"),
    // 5. Bare name-first: "Mom & Dad 25th Anniversary". Deliberately last —
    //    it's the loosest, and relies on isUsableName to reject the
    //    "Wedding Anniversary" / "Birthday Party" style false positives.
    new RegExp(`^\\s*(.+?)\\s+(?:${ORD}\\s+)?(?:wedding\\s+)?${KEYWORD.source}\\s*$`, "i"),
  ];

  for (const re of patterns) {
    const m = title.match(re);
    if (!m) continue;
    const name = cleanName(m[1]);
    if (isUsableName(name, KEYWORD)) return { type, name, ordinal };
  }

  return { type, name: "", ordinal };
}

// ── Scanning an existing calendar ────────────────────────────────────────────

/** The minimum an event needs to expose to be scannable. */
export interface ScannableEvent {
  id: string;
  title: string;
  startTime: Date;
  profileIds?: string[];
}

/** The minimum an existing celebration needs to expose for dedup. */
export interface ExistingCelebration {
  id: string;
  name: string;
  monthDay: string;
  type: string;
}

export interface ScanProfile {
  id: string;
  name: string;
  isAllFamilyProfile?: boolean | null;
}

export interface CelebrationScanCandidate {
  /** Stable identity for this candidate across a single scan. */
  key: string;
  type: DetectedCelebrationType;
  /** Pre-filled name; "" when the title didn't state one. */
  name: string;
  /** "MM-DD" taken from the event's own local calendar date. */
  monthDay: string;
  /** Inferred birth/start year, only when the title stated an age. */
  year: number | null;
  /** App profiles whose name matched the detected name. */
  profileIds: string[];
  /** The original event title, shown in the review list for context. */
  sourceTitle: string;
  /** The occurrence the candidate was read from, for display. */
  sourceDate: Date;
  /** True when an existing celebration already covers this day + type. */
  alreadyTracked: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "MM-DD" from a Date, read in LOCAL time (matching how it renders). */
export function toMonthDay(d: Date): string {
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Review a list of already-loaded calendar events and return the celebrations
 * they appear to describe, deduped both against each other and against the
 * celebrations already being tracked.
 *
 * Dedup rules (see CLAUDE.md for the reasoning):
 *  - Within the scan: one candidate per (type, month-day, name). A recurring
 *    annual birthday expands into many occurrences, and the same event can
 *    arrive from more than one connected calendar — both collapse here.
 *  - An unnamed candidate ("Happy birthday!") merges into a named one on the
 *    same day + type, rather than showing up as a second row.
 *  - Against existing celebrations: same type + month-day counts as already
 *    tracked when the names match OR the candidate has no name at all. Names
 *    that both exist and differ stay separate, so twins aren't collapsed.
 */
export function scanEventsForCelebrations(
  events: ScannableEvent[],
  existing: ExistingCelebration[],
  profiles: ScanProfile[],
): CelebrationScanCandidate[] {
  const realProfiles = profiles.filter((p) => !p.isAllFamilyProfile);
  const byKey = new Map<string, CelebrationScanCandidate>();

  for (const ev of events) {
    // The app's own synthetic celebration entries must never be re-scanned.
    if (ev.id.startsWith("celebration-")) continue;
    if (!ev.startTime || Number.isNaN(ev.startTime.getTime())) continue;

    const hit = detectCelebrationInTitle(ev.title);
    if (!hit) continue;

    const monthDay = toMonthDay(ev.startTime);
    const normName = normalizeCelebrationName(hit.name);
    const key = `${hit.type}|${monthDay}|${normName}`;

    // Only infer a year when the title actually stated an age — never guess.
    const year =
      hit.ordinal !== null ? ev.startTime.getFullYear() - hit.ordinal : null;

    const matchedProfiles = normName
      ? realProfiles.filter((p) => normalizeCelebrationName(p.name) === normName).map((p) => p.id)
      : [];

    const prev = byKey.get(key);
    if (prev) {
      // Keep the richest version: prefer one that resolved a year.
      if (prev.year === null && year !== null) {
        byKey.set(key, { ...prev, year, sourceTitle: ev.title, sourceDate: ev.startTime });
      }
      continue;
    }

    byKey.set(key, {
      key,
      type: hit.type,
      name: hit.name,
      monthDay,
      year,
      profileIds: matchedProfiles,
      sourceTitle: ev.title,
      sourceDate: ev.startTime,
      alreadyTracked: false,
    });
  }

  let candidates = [...byKey.values()];

  // Fold an unnamed candidate into a named one covering the same day+type.
  const namedDays = new Set(
    candidates.filter((c) => c.name).map((c) => `${c.type}|${c.monthDay}`),
  );
  candidates = candidates.filter(
    (c) => c.name || !namedDays.has(`${c.type}|${c.monthDay}`),
  );

  // Mark anything already covered by an existing celebration.
  for (const c of candidates) {
    const cName = normalizeCelebrationName(c.name);
    c.alreadyTracked = existing.some((e) => {
      if (e.type !== c.type || e.monthDay !== c.monthDay) return false;
      const eName = normalizeCelebrationName(e.name);
      return !cName || eName === cName;
    });
  }

  // Soonest-in-the-year first, so the list reads like a calendar.
  return candidates.sort((a, b) => a.monthDay.localeCompare(b.monthDay));
}

/**
 * Whether a just-created event should prompt "add this to Celebrations?".
 * Returns null when it shouldn't — either it isn't a celebration, or one
 * already covers that day, so the prompt would be noise.
 */
export function suggestionForNewEvent(
  event: ScannableEvent,
  existing: ExistingCelebration[],
  profiles: ScanProfile[],
): CelebrationScanCandidate | null {
  const [candidate] = scanEventsForCelebrations([event], existing, profiles);
  if (!candidate || candidate.alreadyTracked) return null;
  return candidate;
}
