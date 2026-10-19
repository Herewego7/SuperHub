export function slipSender(description: string | null | undefined): string | null {
  const match = description?.match(/^From: (\S+)\n/);
  return match?.[1] ?? null;
}

type SlipHeader = Partial<Record<"From" | "Plan" | "Ref" | "Name" | "Sender" | "Sent" | "Mail", string>>;
const HEADER_LINE = /^(From|Plan|Ref|Name|Sender|Sent|Mail): (.*)$/;

/** The lines the inbox writes at the top of a note. The body starts at the first other line. */
export function slipHeader(description: string | null | undefined): SlipHeader {
  const out: SlipHeader = {};
  for (const line of (description ?? "").split("\n")) {
    const match = HEADER_LINE.exec(line);
    if (!match) break;
    const label = match[1] as keyof SlipHeader;
    out[label] ??= match[2].trim();
  }
  return out;
}

export function slipText(description: string | null | undefined): string {
  if (!description) return "";
  const lines = description.split("\n");
  let at = 0;
  while (at < lines.length && HEADER_LINE.test(lines[at])) at += 1;
  return lines.slice(at).join("\n");
}

export function slipQuote(description: string | null | undefined): string {
  return slipText(description).split(/\n\s*\n/)[0] ?? "";
}

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|No|Rm|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|a\.m|p\.m|e\.g|i\.e)\.$/i;

/** The note as a list: one line per line it was written on, and one per sentence within a line. */
export function noteBullets(description: string | null | undefined): string[] {
  const out: string[] = [];
  for (const line of slipText(description).split("\n")) {
    const pieces: string[] = [];
    for (const piece of line.replace(/^\s*[-•*]\s+/, "").split(/(?<=[.!?])\s+/)) {
      if (pieces.length && ABBREVIATION.test(pieces[pieces.length - 1])) pieces[pieces.length - 1] += ` ${piece}`;
      else pieces.push(piece);
    }
    out.push(...pieces.map((piece) => piece.trim()).filter(Boolean));
  }
  return out;
}

/** The sender's own name, like "Elizabeth Simonovich". Older items only have the address. */
export function slipSenderName(description: string | null | undefined): string | null {
  return slipHeader(description).Sender || null;
}

/** What a newsletter calls itself, like "Room 12 News". */
export function slipNewsletterName(description: string | null | undefined): string | null {
  return slipHeader(description).Name || null;
}

/** When the email was sent. Older items don't say. */
export function slipSentAt(description: string | null | undefined): Date | null {
  const raw = slipHeader(description).Sent;
  const at = raw ? new Date(raw) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/** Whose mailbox holds the original, when the app can open it. */
export function slipMailOwner(description: string | null | undefined): string | null {
  return slipHeader(description).Mail?.match(/^(?:gmail|outlook):([^:\s]+):\S+$/)?.[1] ?? null;
}

/** The mailbox owner can read the original. Other adults need Share originals. A child never can. */
export function canReadOriginal(
  shareOriginals: boolean,
  ownerId: string | null,
  viewer?: { id?: string | null; isChild?: boolean },
): boolean {
  if (!ownerId || viewer?.isChild) return false;
  return shareOriginals || (!!viewer?.id && viewer.id === ownerId);
}

function nameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/^(re|fwd):\s*/i, "").replace(/\s+/g, " ").trim();
}

/** Same pair the server keeps: "sender|newsletter name". */
export function newsletterKey(address: string, name?: string | null): string {
  return `${address.trim().toLowerCase()}|${nameKey(name)}`;
}

/** A pair with no name covers the sender's every newsletter, and an issue with no name matches any pair for its sender. */
export function newsletterMuted(keys: readonly string[] | undefined, address: string | null | undefined, name?: string | null): boolean {
  if (!keys?.length || !address) return false;
  const wanted = newsletterKey(address, name);
  const at = wanted.indexOf("|");
  const sender = wanted.slice(0, at);
  const title = wanted.slice(at + 1);
  return keys.some((key) => {
    const split = key.indexOf("|");
    if (split < 0 || key.slice(0, split) !== sender) return false;
    const muted = key.slice(split + 1);
    return !muted || !title || muted === title;
  });
}

/** How Settings names a hidden newsletter: its name, or the sender when it had none. */
export function newsletterKeyLabel(key: string): { sender: string; name: string | null } {
  const split = key.indexOf("|");
  if (split < 0) return { sender: key, name: null };
  return { sender: key.slice(0, split), name: key.slice(split + 1) || null };
}

/** One remembered fact per line. A blank field clears them. A repeat is kept once. */
export function savedFacts(raw: string): string[] {
  const facts: string[] = [];
  for (const line of raw.split("\n")) {
    const fact = line.trim().slice(0, 200);
    if (!fact || facts.includes(fact)) continue;
    facts.push(fact);
    if (facts.length === 20) break;
  }
  return facts;
}

/** A blank school field clears the saved school. */
export function savedSchool(raw: string | null | undefined): string | null {
  const school = raw?.trim() ?? "";
  return school || null;
}

export function personRecordLines(person: { school?: string | null; facts?: string[] | null }): string[] {
  const lines: string[] = [];
  const school = person.school?.trim();
  if (school) lines.push(school);
  const facts: string[] = [];
  for (const fact of person.facts ?? []) {
    const trimmed = fact.trim();
    if (trimmed && !facts.includes(trimmed)) facts.push(trimmed);
  }
  if (facts.length > 0) lines.push(facts.join(" · "));
  return lines;
}

export function suggestedSchool(text: string): string | null {
  const match = text.match(/\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4}\s+(?:School|Academy|Elementary|Middle|High))\b/);
  return match?.[1] ?? null;
}

export function schoolFromSlip(title: string, description: string | null | undefined): string | null {
  return suggestedSchool(`${title}\n${slipText(description)}`);
}

type SlipPerson = { id: string; name: string; school?: string | null; isChild?: boolean | null; role?: string | null };

function namesPerson(text: string, name: string): boolean {
  const who = name.trim();
  if (!who) return false;
  const escaped = who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/** Save a school onto the person the email names. A parent on screen is not that person. */
export function schoolSaveTarget(
  title: string,
  description: string | null | undefined,
  people: SlipPerson[],
  selectedId: string | null,
): { profileId: string; name: string; school: string } | null {
  const school = schoolFromSlip(title, description);
  if (!school) return null;
  const text = `${title}\n${slipText(description)}`;
  const named = people.filter((person) => namesPerson(text, person.name) && !person.school?.trim());
  if (named.length === 1) return { profileId: named[0].id, name: named[0].name, school };
  if (named.length > 1) return null;
  const selected = people.find((person) => person.id === selectedId);
  if (!selected || selected.school?.trim()) return null;
  if (selected.role !== "child" && !selected.isChild) return null;
  return { profileId: selected.id, name: selected.name, school };
}

/**
 * Open inbox items from senders the family stopped. Home never shows them,
 * and Stop emails deletes them, so they can't come back on the next refresh
 * even from a server that only skipped the sender's future mail.
 */
export function fromStoppedSender<T extends { category?: string | null; description?: string | null }>(chore: T, stopped: readonly string[]): boolean {
  if (chore.category !== "school_email" || stopped.length === 0) return false;
  const sender = slipSender(chore.description)?.toLowerCase();
  // A list saved by an older server can hold a blank; skip it rather than crash Home.
  return !!sender && stopped.some((address) => typeof address === "string" && address.trim().toLowerCase() === sender);
}
