import type { NewsletterGroup } from "@/lib/homeDay";

/**
 * Several senders, one newsletter row. A school mails from its office, its
 * PTA (through Constant Contact) and a teacher; a church from its office and
 * its youth group. Each was its own row, so a handful of newsletters looked
 * like a dozen (2026-10-22).
 *
 * Obvious matches combine on their own; less clear ones are offered once on
 * the row. What the family decides is kept in calendar settings:
 * - groups: ones they combined or renamed, by member key ("sender|name");
 * - apart: members never to combine on their own, and "a||b" pairs they said
 *   were not the same.
 */
export type NewsletterGrouping = { groups: { id: string; name: string | null; members: string[] }[]; apart: string[] };

export const EMPTY_GROUPING: NewsletterGrouping = { groups: [], apart: [] };

export type CombinedLetters<T> = NewsletterGroup<T> & {
  /** The newsletters inside, one per sender; a single one when nothing combined. */
  members: NewsletterGroup<T>[];
  /** Set when the family made or renamed this group. */
  groupId: string | null;
};

export type LettersSuggestion = { keys: [string, string]; names: [string, string]; pair: string };

/** Words too common in newsletter and sender names to say two are the same. */
const COMMON = new Set([
  "the", "and", "for", "from", "our", "your", "this", "with", "news", "newsletter", "newsletters", "weekly",
  "monthly", "daily", "update", "updates", "bulletin", "digest", "notes", "week", "school", "schools",
  "elementary", "middle", "high", "academy", "church", "parish", "ministry", "ministries", "family",
  "families", "parent", "parents", "pta", "pto", "association", "office", "team", "community", "district",
  "isd", "class", "classroom", "grade", "mrs", "saint", "saints", "info", "noreply", "reply", "mail",
  "email", "group", "club", "kids", "youth", "student", "students", "staff", "admin", "principal",
  "notifications", "notification", "alerts", "alert", "announcements", "announcement", "events", "calendar",
  "message", "messages", "reminder", "reminders", "support", "hello", "contact", "communications",
  "org", "com", "net", "edu", "gov", "www", "inc", "llc",
]);

/** Mail services many unrelated senders share; the sender is in the subdomain or the name. */
const BULK = /(^|\.)(ccsend\.com|constantcontact\.com|mcsv\.net|mailchimpapp\.net|mcdlv\.net|list-manage\.com|beehiiv\.com|substack\.com|smore\.com|schoolmessenger\.com|parentsquare\.com|remind\.com|bloomz\.net|membershiptoolkit\.com|flocknote\.com|sendgrid\.net|mailgun\.org|hubspotemail\.net|e\.givelify\.com|campaign-archive\.com|ourschoolpages\.com|peachjar\.com)$/i;
const FREE = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|comcast)\./i;

export function distinctiveWords(name: string | null | undefined): string[] {
  if (!name) return [];
  // An address is not a name: "info@rivervalley.org" and
  // "notifications@farmingtonbasketball.org" matched on "org" (2026-10-22).
  // The address itself is compared separately, in traitsOf.
  const words = name.replace(/\S+@\S+/g, " ").replace(/\b(?:https?:\/\/)?(?:[\w-]+\.)+(?:com|org|net|edu|gov|us|io|ai|co|info|church)\b\S*/gi, " ");
  return [...new Set(
    words.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !COMMON.has(word) && !/^\d+$/.test(word)),
  )];
}

type Traits = { words: string[]; org: string | null; label: string };

function traitsOf(letters: NewsletterGroup<unknown>): Traits {
  const host = letters.sender?.split("@")[1]?.toLowerCase().trim() ?? "";
  const named = letters.issues.map((issue) => issue.senderName).find(Boolean);
  const words = distinctiveWords(`${letters.name} ${named ?? ""}`);
  if (!host) return { words, org: null, label: "" };
  const parts = host.split(".");
  if (BULK.test(host)) {
    // greatoaksacademyparentassociation.ccsend.com, or the part before the @:
    // on a shared service that is what names the sender.
    const local = letters.sender?.split("@")[0]?.toLowerCase() ?? "";
    return { words, org: null, label: `${parts.length > 2 ? parts[0] : ""} ${local}`.replace(/[^a-z0-9 ]/g, "") };
  }
  if (FREE.test(host)) return { words, org: null, label: "" };
  const shared = parts.length >= 3 && /^(co|com|org|net|edu|k12|ac|gov)$/.test(parts[parts.length - 2]);
  const org = parts.slice(shared ? -3 : -2).join(".");
  return { words, org, label: org.split(".")[0].replace(/[^a-z0-9]/g, "") };
}

/** All of `words` are in `traits`: as words, or run together in its address. */
function covers(traits: Traits, words: string[]): boolean {
  if (words.length === 0) return false;
  if (words.every((word) => traits.words.includes(word))) return true;
  const joined = words.join("");
  return joined.length >= 6 && traits.label.includes(joined);
}

function sharedWord(a: Traits, b: Traits): boolean {
  return a.words.some((word) => b.words.includes(word));
}

/**
 * Each names a different one of the family's schools: a district that mails
 * every school from one domain must not become one newsletter.
 */
function differentSchools(a: Traits, b: Traits, schools: string[][]): boolean {
  const of = (t: Traits) => schools.map((school, index) => (covers(t, school) ? index : -1)).filter((index) => index >= 0);
  const sa = of(a);
  const sb = of(b);
  return sa.length > 0 && sb.length > 0 && !sa.some((index) => sb.includes(index));
}

/** Plainly the same sender family: combine without asking. */
function obvious(a: Traits, b: Traits, schools: string[][]): boolean {
  // The same organisation's own domain: info@ and weekly@rivervalleychurch.org
  // are one church (2026-10-22). Shared mail services and personal addresses
  // have no org, so they never get here.
  if (a.org && a.org === b.org) return !differentSchools(a, b, schools);
  const [small, large] = a.words.length <= b.words.length ? [a, b] : [b, a];
  if (small.words.length >= 2 && covers(large, small.words)) return true;
  return schools.some((school) => school.length > 0 && covers(a, school) && covers(b, school));
}

/**
 * Maybe the same: worth one question. Stricter than a shared word of any
 * length, which offered a church and a basketball league (2026-10-22): the
 * word must be a real one (4+ letters), or the same organisation's address.
 */
function likely(a: Traits, b: Traits, schools: string[][]): boolean {
  if (differentSchools(a, b, schools)) return false;
  if (a.words.some((word) => word.length >= 4 && b.words.includes(word))) return true;
  if (a.org && a.org === b.org) return true;
  const inLabel = (words: string[], label: string) => label.length > 0 && words.some((word) => word.length >= 5 && label.includes(word));
  return inLabel(a.words, b.label) || inLabel(b.words, a.label);
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("||");
}

/**
 * The newsletter rows to show, combined, newest first, and at most one
 * question to ask. `schools` are the schools on the family's profiles.
 */
export function combineNewsletters<T>(
  sources: NewsletterGroup<T>[],
  grouping: NewsletterGrouping = EMPTY_GROUPING,
  schools: string[] = [],
): { letters: CombinedLetters<T>[]; suggestion: LettersSuggestion | null } {
  const groupable = sources.filter((source) => source.sender);
  const byKey = new Map(groupable.map((source) => [source.key, source]));
  const traits = new Map(groupable.map((source) => [source.key, traitsOf(source)]));
  const schoolWords = schools.map((school) => distinctiveWords(school)).filter((words) => words.length > 0);
  const apart = new Set(grouping.apart);

  // Union-find over member keys.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const key of byKey.keys()) parent.set(key, key);

  const saved = new Map<string, { id: string; name: string | null }>();
  const inSaved = new Set<string>();
  for (const group of grouping.groups) {
    const present = group.members.filter((key) => byKey.has(key));
    present.forEach((key) => { inSaved.add(key); join(present[0], key); });
    if (present[0]) saved.set(present[0], { id: group.id, name: group.name });
  }
  const free = [...byKey.keys()].filter((key) => !inSaved.has(key) && !apart.has(key));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (apart.has(pairKey(free[i], free[j]))) continue;
      if (obvious(traits.get(free[i])!, traits.get(free[j])!, schoolWords)) join(free[i], free[j]);
    }
  }

  const clusters = new Map<string, NewsletterGroup<T>[]>();
  for (const source of groupable) {
    const root = find(source.key);
    clusters.set(root, [...(clusters.get(root) ?? []), source]);
  }
  const letters: CombinedLetters<T>[] = [];
  for (const members of clusters.values()) {
    const group = members.map((member) => saved.get(member.key)).find(Boolean) ?? null;
    if (members.length === 1 && !group) {
      letters.push({ ...members[0], members, groupId: null });
      continue;
    }
    const issues = members.flatMap((member) => member.issues).sort((a, b) => b.when.getTime() - a.when.getTime());
    const memberTraits = members.map((member) => traits.get(member.key)!);
    const school = schools.find((name) => {
      const words = distinctiveWords(name);
      return words.length > 0 && memberTraits.every((t) => covers(t, words));
    });
    // Named for the school on a child's profile when it is that school; else
    // for the member with the most issues (the main one), newest on a tie.
    const main = [...members].sort((a, b) => b.issues.length - a.issues.length || b.issues[0].when.getTime() - a.issues[0].when.getTime())[0];
    const keys = members.map((member) => member.key).sort();
    letters.push({
      key: group ? `group:${group.id}` : `group:${keys.join("+")}`,
      name: group?.name?.trim() || school || main.name,
      sender: main.sender,
      muteName: main.muteName,
      issues,
      members,
      groupId: group?.id ?? null,
    });
  }
  for (const source of sources) if (!source.sender) letters.push({ ...source, members: [source], groupId: null });
  letters.sort((a, b) => b.issues[0].when.getTime() - a.issues[0].when.getTime());

  let suggestion: LettersSuggestion | null = null;
  outer: for (let i = 0; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const a = letters[i];
      const b = letters[j];
      if (!a.sender || !b.sender) continue;
      const pair = pairKey(a.members[0].key, b.members[0].key);
      if (apart.has(pair)) continue;
      if (a.members.some((m) => apart.has(m.key)) || b.members.some((m) => apart.has(m.key))) continue;
      const close = a.members.some((m) => b.members.some((n) => likely(traits.get(m.key)!, traits.get(n.key)!, schoolWords)));
      if (close) {
        suggestion = { keys: [a.key, b.key], names: [a.name, b.name], pair };
        break outer;
      }
    }
  }
  return { letters, suggestion };
}

/** Puts some rows together under one name, taking their members out of any group they were in. */
export function combineRows(grouping: NewsletterGrouping, rows: { members: { key: string }[] }[], name: string | null, id: string): NewsletterGrouping {
  const members = [...new Set(rows.flatMap((row) => row.members.map((member) => member.key)))];
  const taken = new Set(members);
  return {
    groups: [
      ...grouping.groups.map((group) => ({ ...group, members: group.members.filter((key) => !taken.has(key)) })).filter((group) => group.members.length > 1 || group.name),
      { id, name, members },
    ],
    apart: grouping.apart.filter((key) => !taken.has(key) && !key.split("||").every((part) => taken.has(part))),
  };
}

/** Splits a row back into one row per sender, and keeps them from combining again on their own. */
export function separateRow(grouping: NewsletterGrouping, row: { groupId: string | null; members: { key: string }[] }): NewsletterGrouping {
  const keys = row.members.map((member) => member.key);
  return {
    groups: grouping.groups.filter((group) => group.id !== row.groupId),
    apart: [...new Set([...grouping.apart, ...keys])],
  };
}

/** Names a row; a row that was combined on its own becomes a saved group so the name sticks. */
export function renameRow(grouping: NewsletterGrouping, row: { groupId: string | null; members: { key: string }[] }, name: string, id: string): NewsletterGrouping {
  if (row.groupId) return { ...grouping, groups: grouping.groups.map((group) => (group.id === row.groupId ? { ...group, name } : group)) };
  return combineRows(grouping, [row], name, id);
}

/** "Not the same": this pair is never offered again. */
export function declinePair(grouping: NewsletterGrouping, pair: string): NewsletterGrouping {
  return { ...grouping, apart: [...new Set([...grouping.apart, pair])] };
}
