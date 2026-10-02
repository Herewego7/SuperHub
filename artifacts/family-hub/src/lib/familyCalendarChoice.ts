export type FamilyCalendarChoice = {
  provider: "google" | "outlook";
  profileId: string;
  calendarId: string;
};

export function familyCalendarOptionValue(calendar: FamilyCalendarChoice): string {
  return JSON.stringify([calendar.provider, calendar.profileId, calendar.calendarId]);
}

export function parseFamilyCalendarOption(value: string): FamilyCalendarChoice | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [provider, profileId, calendarId] = parsed;
    if ((provider !== "google" && provider !== "outlook") || typeof profileId !== "string" || !profileId || typeof calendarId !== "string" || !calendarId) return null;
    return { provider, profileId, calendarId };
  } catch {
    return null;
  }
}

export function familyCalendarSelectValue(
  calendarId: string | null | undefined,
  profileId: string | null | undefined,
  calendars: FamilyCalendarChoice[],
): string {
  const id = calendarId?.trim();
  if (!id || id === "none") return "none";
  const matches = calendars.filter((calendar) => calendar.calendarId === id);
  const owned = (profileId ? matches.find((calendar) => calendar.profileId === profileId) : undefined) ?? matches[0];
  return owned ? familyCalendarOptionValue(owned) : "none";
}
