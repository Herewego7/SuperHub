export function slipSender(description: string | null | undefined): string | null {
  const match = description?.match(/^From: (\S+)\n/);
  return match?.[1] ?? null;
}

export function slipQuote(description: string | null | undefined): string {
  if (!description) return "";
  return description.replace(/^From: \S+\n/, "");
}

export function openEmailHref(shareOriginals: boolean, sender: string | null): string | null {
  if (!shareOriginals || !sender) return null;
  return `mailto:${sender}`;
}

export function suggestedSchool(text: string): string | null {
  const match = text.match(/\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4}\s+(?:School|Academy|Elementary|Middle|High))\b/);
  return match?.[1] ?? null;
}

export function schoolFromSlip(title: string, description: string | null | undefined): string | null {
  return suggestedSchool(`${title}\n${slipQuote(description)}`);
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
  const text = `${title}\n${slipQuote(description)}`;
  const named = people.filter((person) => namesPerson(text, person.name) && !person.school?.trim());
  if (named.length === 1) return { profileId: named[0].id, name: named[0].name, school };
  if (named.length > 1) return null;
  const selected = people.find((person) => person.id === selectedId);
  if (!selected || selected.school?.trim()) return null;
  if (selected.role !== "child" && !selected.isChild) return null;
  return { profileId: selected.id, name: selected.name, school };
}
