/**
 * Who an email belongs to. Kept the same as api-server/src/ingest/assign.ts:
 * the server uses it when mail is read, and Home uses it to fix rows saved
 * before it existed and to learn from a reassignment.
 *
 * What a person taught the app comes first ("Mail from x@y.com is for Mom."
 * saved on Mom), then the people the mail itself names ("For Mom." in the
 * note), and only then whoever's inbox it came in.
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

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Email to-dos whose owners are wrong by what is now known. A row the person
 * assigned by hand is left alone. Without a taught sender, only a row that
 * went to everyone moves, to the people its note names.
 */
export function ownerFixes<T extends { id: string; category?: string | null; description?: string | null; profileIds?: string[] | null }>(
  todos: T[],
  people: OwnerPerson[],
  senderOf: (description: string | null | undefined) => string | null,
  handPicked: ReadonlySet<string>,
): { id: string; profileIds: string[] }[] {
  const family = people.map((person) => person.id);
  const fixes: { id: string; profileIds: string[] }[] = [];
  for (const todo of todos) {
    if (todo.category !== "school_email" || handPicked.has(todo.id)) continue;
    const ids = todo.profileIds ?? [];
    const sender = senderOf(todo.description);
    const taught = senderOwners(sender, people);
    const everyone = ids.length === 0 || ids.some((id) => !family.includes(id)) || (family.length >= 2 && family.every((id) => ids.includes(id)));
    const want = taught.length > 0 ? taught : everyone ? namedOwners(noteNames(todo.description), people) : [];
    if (want.length === 0 || sameIds(ids, want)) continue;
    fixes.push({ id: todo.id, profileIds: want });
  }
  return fixes;
}

/**
 * The facts each person should have after a sender's mail was handed to
 * `ids`: the rule moves to them and off everyone else. Only people whose
 * facts change are returned. A person keeps at most 20 facts, so the oldest
 * sender rule makes room.
 */
export function teachSender(sender: string, ids: string[], people: OwnerPerson[]): { id: string; facts: string[] }[] {
  const changes: { id: string; facts: string[] }[] = [];
  for (const person of people) {
    const before = person.facts ?? [];
    let facts = withoutSenderFact(before, sender);
    if (ids.includes(person.id)) {
      facts = [...facts, senderFact(sender, person.name)];
      while (facts.length > 20) {
        const oldest = facts.findIndex((fact) => SENDER_FACT.test(fact));
        facts.splice(oldest >= 0 ? oldest : 0, 1);
      }
    }
    if (facts.length !== before.length || facts.some((fact, at) => fact !== before[at])) changes.push({ id: person.id, facts });
  }
  return changes;
}
