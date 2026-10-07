// Reading typed answers in the setup chat. Every question offers numbered
// answers to tap; these let someone type the number, or the answer's own
// words, instead. Free-text questions (names, the city, an email, an invite
// code, the PIN) each get a parser here too.
import { regionsFor, type CountryCode } from "../regions";

export interface Choice { id: string; label: string; say?: readonly string[] }
export interface Region { abbr: string; name: string; country: CountryCode }

export const YES_WORDS: readonly string[] = [
  "yes", "y", "yep", "yeah", "yup", "sure", "ok", "okay", "correct", "right", "thats right",
  "sounds good", "looks good", "of course", "please", "yes please", "do it",
];
export const NO_WORDS: readonly string[] = [
  "no", "n", "nope", "nah", "not now", "later", "skip", "no thanks", "maybe later", "not yet",
];

/** Lowercase, accents and punctuation dropped, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/** "2", "option 2", "two", "the second one" → 2. */
function choiceNumber(t: string): number | null {
  const digits = /^(?:option |number |choice )?(\d{1,2})$/.exec(t);
  if (digits) return parseInt(digits[1], 10);
  const word = /^(?:option |number |choice |the )?([a-z]+)(?: one)?$/.exec(t);
  if (!word) return null;
  return ORDINALS[word[1]] ?? (word[1] in SMALL_NUMBERS && SMALL_NUMBERS[word[1]] > 0 ? SMALL_NUMBERS[word[1]] : null);
}

const NEGATORS = new Set(["not", "no", "dont", "never"]);

function containsWords(text: string, phrase: string): number {
  return ` ${text} `.indexOf(` ${phrase} `);
}

/**
 * Which answer a typed reply picks, or -1. Tries the answer's number, then
 * its exact words, then (unless `strict`) a phrase inside the reply and the
 * start of an answer. `strict` is for questions that also take free text,
 * where "Justin" must stay a name rather than become "It's just me".
 * `numbers: false` is for answers shown without numbers.
 */
export function matchChoice(
  text: string,
  choices: readonly Choice[],
  opts: { strict?: boolean; numbers?: boolean } = {},
): number {
  const t = normalize(text);
  if (!t) return -1;
  const n = opts.numbers === false ? null : choiceNumber(t);
  if (n !== null && n >= 1 && n <= choices.length) return n - 1;

  const candidates = choices.map((c) => [c.label, ...(c.say ?? [])].map(normalize).filter(Boolean));
  for (let i = 0; i < choices.length; i++) {
    if (candidates[i].includes(t)) return i;
  }
  if (opts.strict) return -1;

  let best = -1;
  let bestLength = 0;
  let tied = false;
  candidates.forEach((phrases, i) => {
    for (const phrase of phrases) {
      if (phrase.length < 2) continue;
      const at = containsWords(t, phrase);
      if (at === -1) continue;
      const before = t.slice(0, Math.max(0, at - 1)).split(" ").pop() ?? "";
      if (NEGATORS.has(before)) continue;
      if (phrase.length > bestLength) {
        best = i;
        bestLength = phrase.length;
        tied = false;
      } else if (phrase.length === bestLength && best !== i) {
        tied = true;
      }
    }
  });
  if (best !== -1 && !tied) return best;

  if (t.length >= 3) {
    const starts = new Set<number>();
    candidates.forEach((phrases, i) => {
      if (phrases.some((phrase) => phrase.startsWith(t))) starts.add(i);
    });
    if (starts.size === 1) return [...starts][0];
  }
  return -1;
}

/** "1, 3 and 4" → [1, 3, 4], for toggling several answers at once. */
export function parseNumberList(text: string, max: number): number[] | null {
  const words = normalize(text).split(" ").filter((w) => w && w !== "and");
  if (words.length === 0) return null;
  const numbers: number[] = [];
  for (const w of words) {
    const n = /^\d+$/.test(w) ? parseInt(w, 10) : SMALL_NUMBERS[w];
    if (!n || n < 1 || n > max) return null;
    if (!numbers.includes(n)) numbers.push(n);
  }
  return numbers.sort((a, b) => a - b);
}

function capitaliseWords(text: string): string {
  return text.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** A name as it should be saved: spacing tidied, capitalised only if typed
 *  all in lowercase, and held to the 40 characters the profile form allows. */
export function tidyName(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  return (s === s.toLowerCase() ? capitaliseWords(s) : s).slice(0, 40).trim();
}

/** The same initials the profile form computes: first letters of up to two words. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Names typed in one message. Commas, "and", "&", "+" and new lines separate
 * people. Several words with no separator could be one person ("Mary Kate")
 * or several, so that comes back `ambiguous` for the chat to ask.
 */
export function parseNames(text: string): { names: string[]; ambiguous: boolean } {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s*(?:,|;|\n|\/|&|\+|\band\b)\s*/i);
  const names: string[] = [];
  for (const part of parts) {
    const name = tidyName(part.replace(/^["'“”.\s]+|["'“”.!?\s]+$/g, ""));
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  const ambiguous = parts.length === 1 && names.length === 1 && names[0].includes(" ");
  return { names, ambiguous };
}

// Names that regionsFor doesn't carry, mapped to its abbreviation.
const REGION_ALIASES: Record<string, string> = {
  "newfoundland and labrador": "NL",
  "pei": "PE",
  "washington dc": "DC",
};

function displayRegionName(name: string): string {
  return name.replace(/ (Of|And) /g, (m) => m.toLowerCase());
}

let regionIndex: { byAbbr: Map<string, Region[]>; byName: Map<string, Region> } | null = null;

function regions() {
  if (regionIndex) return regionIndex;
  const byAbbr = new Map<string, Region[]>();
  const byName = new Map<string, Region>();
  for (const country of ["US", "CA"] as const) {
    for (const r of regionsFor(country)) {
      const region: Region = { abbr: r.abbr, name: displayRegionName(r.name), country };
      byAbbr.set(r.abbr.toLowerCase(), [...(byAbbr.get(r.abbr.toLowerCase()) ?? []), region]);
      byName.set(normalize(r.name), region);
    }
  }
  for (const [alias, abbr] of Object.entries(REGION_ALIASES)) {
    const region = byAbbr.get(abbr.toLowerCase())?.[0];
    if (region) byName.set(alias, region);
  }
  regionIndex = { byAbbr, byName };
  return regionIndex;
}

/** A state or province, by abbreviation or name. The country narrows the
 *  lookup but never vetoes it: a region only exists in one country. */
export function parseRegion(text: string, country?: CountryCode): Region | null {
  const n = normalize(text);
  if (!n) return null;
  const { byAbbr, byName } = regions();
  const compact = n.replace(/ /g, "");
  if (compact.length === 2) {
    const found = byAbbr.get(compact) ?? [];
    return found.find((r) => r.country === country) ?? found[0] ?? null;
  }
  return byName.get(n) ?? null;
}

function tidyPlace(text: string): string {
  const s = text.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
  return (s === s.toLowerCase() ? capitaliseWords(s) : s).slice(0, 80);
}

const COUNTRY_SUFFIX = /[,\s]\s*(u\.?s\.?a\.?|u\.s\.|us|united states(?: of america)?|america|canada)\.?\s*$/i;

/**
 * "minneapolis mn", "Minneapolis, Minnesota", "Toronto ON, Canada". The
 * region is read from the end, so a city's own words are never mistaken for
 * one ("Kansas City" stays a city). Either half can come back null for the
 * chat to ask about.
 */
export function parseLocation(text: string): { city: string | null; region: Region | null; country: CountryCode | null } {
  let s = text.replace(/\s+/g, " ").trim().replace(/[,]+$/, "").trim();
  let country: CountryCode | null = null;
  const suffix = COUNTRY_SUFFIX.exec(s);
  if (suffix && suffix.index > 0) {
    country = /canada/i.test(suffix[1]) ? "CA" : "US";
    s = s.slice(0, suffix.index).replace(/,\s*$/, "").trim();
  }
  if (!s) return { city: null, region: null, country };

  const comma = s.lastIndexOf(",");
  if (comma !== -1) {
    const cityPart = s.slice(0, comma).trim();
    const region = parseRegion(s.slice(comma + 1), country ?? undefined);
    if (region) return { city: cityPart ? tidyPlace(cityPart) : null, region, country: region.country };
    return { city: tidyPlace(cityPart || s.slice(comma + 1)), region: null, country };
  }

  const words = s.split(" ");
  for (let take = Math.min(4, words.length); take >= 1; take--) {
    const region = parseRegion(words.slice(words.length - take).join(" "), country ?? undefined);
    if (!region) continue;
    const city = words.slice(0, words.length - take).join(" ");
    return { city: city ? tidyPlace(city) : null, region, country: region.country };
  }
  return { city: tidyPlace(s), region: null, country };
}

export function parseEmail(text: string): string | null {
  const t = text.trim().replace(/[.,;]+$/, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(t) ? t : null;
}

/** 8 letters and numbers, typed with or without spaces and dashes, or pasted
 *  as a /join?code= link. */
export function parseInviteCode(text: string): string | null {
  const fromLink = /[?&]code=([A-Za-z0-9\s-]+)/.exec(text);
  const code = (fromLink ? fromLink[1] : text).replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function parsePin(text: string): string | null {
  const digits = text.replace(/\s/g, "");
  return /^\d{4}$/.test(digits) ? digits : null;
}

/** A positive amount: "10", "10 stars", "ten", "12.5". A "$1" in the reply
 *  is the other side of the rate, so it is ignored. */
export function parseAmount(text: string): number | null {
  const withoutMoney = text.replace(/[$€£]\s*\d+(?:\.\d+)?/g, " ").replace(/,/g, "");
  const digits = /\d+(?:\.\d+)?/.exec(withoutMoney);
  if (digits) {
    const value = parseFloat(digits[0]);
    return value > 0 ? value : null;
  }
  let total = 0;
  let found = false;
  for (const w of normalize(withoutMoney).split(" ")) {
    if (w in SMALL_NUMBERS) { total += SMALL_NUMBERS[w]; found = true; }
    else if (w in TENS) { total += TENS[w]; found = true; }
    else if (w === "hundred") { total = (total || 1) * 100; found = true; }
    else if (w === "a" || w === "and") continue;
    else if (found) break;
  }
  return found && total > 0 ? total : null;
}
