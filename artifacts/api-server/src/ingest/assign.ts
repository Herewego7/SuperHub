/**
 * Who an email belongs to. Kept the same as family-hub/src/lib/mailOwners.ts.
 *
 * What a person taught the app comes first ("Mail from x@y.com is for Mom."
 * saved on Mom), then the people the mail itself names, and only then whoever's
 * inbox it came in.
 */
export type OwnerPerson = { id: string; name: string; facts?: string[] | null };

const SENDER_FACT = /^Mail from (\S+) is for /i;

export function senderFact(sender: string, name: string): string {
  return `Mail from ${sender.trim().toLowerCase()} is for ${name.trim()}.`;
}

/** Facts with this sender's rule taken out, to move the rule to someone else. */
export function withoutSenderFact(facts: string[] | null | undefined, sender: string): string[] {
  const key = sender.trim().toLowerCase();
  return (facts ?? []).filter((fact) => fact.match(SENDER_FACT)?.[1]?.toLowerCase() !== key);
}

/** The people a household taught the app this sender's mail is for. */
export function senderOwners(sender: string | null | undefined, people: OwnerPerson[]): string[] {
  const key = sender?.trim().toLowerCase();
  if (!key) return [];
  return people
    .filter((person) => (person.facts ?? []).some((fact) => fact.match(SENDER_FACT)?.[1]?.toLowerCase() === key))
    .map((person) => person.id);
}

/** Family names to ids. A first name matches too: "Mom" or "Chad" for "Chad Giles". */
export function namedOwners(names: string[], people: OwnerPerson[]): string[] {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const person = people.find((row) => row.name.trim().toLowerCase() === name)
      ?? people.find((row) => row.name.trim().toLowerCase().split(/\s+/)[0] === name);
    if (person && !ids.includes(person.id)) ids.push(person.id);
  }
  return ids;
}

/** "For Mom and Dad." at the end of a mail note, as names. */
export function noteNames(description: string | null | undefined): string[] {
  const line = (description ?? "").match(/(?:^|\n|\.\s)For ([^.\n]+)\.\s*$/)?.[1];
  if (!line) return [];
  return line.split(/\s*(?:,|\band\b|&)\s*/i).map((name) => name.trim()).filter(Boolean);
}

/** The owners an email row should have, or null when nothing more specific is known. */
export function mailOwnersFor(sender: string | null | undefined, description: string | null | undefined, people: OwnerPerson[]): string[] | null {
  const taught = senderOwners(sender, people);
  if (taught.length > 0) return taught;
  const named = namedOwners(noteNames(description), people);
  return named.length > 0 ? named : null;
}
