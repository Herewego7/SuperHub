type ColorPerson = { id: string; color?: string | null; isAllFamilyProfile?: boolean | null };
type ColoredEvent = { profileIds?: string[] | null; calendarColor?: string | null };

export const EVENT_FALLBACK_COLOR = "#5E8FAD";

/** Black or white text, whichever reads on this background (WCAG relative luminance). */
export function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map((at) => toLinear(parseInt(c.substring(at, at + 2), 16)));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.35 ? "#1a1a1a" : "#ffffff";
}

function members(people: ColorPerson[]): ColorPerson[] {
  return people.filter((person) => !person.isAllFamilyProfile);
}

/** The All Family profile is on it, or every member is (two or more of them). */
export function forEveryone(profileIds: string[] | null | undefined, people: ColorPerson[]): boolean {
  const ids = profileIds ?? [];
  if (ids.length === 0) return false;
  if (people.some((person) => person.isAllFamilyProfile && ids.includes(person.id))) return true;
  const family = members(people);
  return family.length >= 2 && family.every((person) => ids.includes(person.id));
}

/**
 * One color per event, the same on Home and in Calendar. The person comes first: an event
 * for everyone takes the All Family color, otherwise the first person on it in family order.
 * An event with nobody on it takes its calendar's color.
 */
export function eventColor(event: ColoredEvent, people: ColorPerson[], fallback = EVENT_FALLBACK_COLOR): string {
  const ids = event.profileIds ?? [];
  if (forEveryone(ids, people)) {
    const family = people.find((person) => person.isAllFamilyProfile);
    if (family?.color) return family.color;
  }
  const first = members(people).find((person) => ids.includes(person.id) && person.color);
  return first?.color || event.calendarColor || fallback;
}

/** The person strip: a segment for each person on a shared event, otherwise the event's one color. */
export function eventStrip(event: ColoredEvent, people: ColorPerson[], fallback = EVENT_FALLBACK_COLOR): string[] {
  const ids = event.profileIds ?? [];
  if (!forEveryone(ids, people)) {
    const colors = members(people).filter((person) => ids.includes(person.id) && person.color).map((person) => person.color as string);
    if (colors.length > 1) return colors;
  }
  return [eventColor(event, people, fallback)];
}
