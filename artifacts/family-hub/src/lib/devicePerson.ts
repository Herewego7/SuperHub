const KEY = "superhub_device_person";

type Person = { id: string; role?: string | null; isChild?: boolean | null; isAllFamilyProfile?: boolean | null };

export function readDevicePerson(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeDevicePerson(choice: string) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private mode can reject the write. The header still changes for this visit.
  }
}

/** A saved person wins. Otherwise the device starts on the first adult. */
export function devicePersonIds(saved: string | null, profiles: Person[]): string[] {
  const real = profiles.filter((profile) => !profile.isAllFamilyProfile);
  if (saved === "all") return real.map((profile) => profile.id);
  const ids = saved?.split(",").filter((id) => real.some((profile) => profile.id === id)) ?? [];
  if (saved && ids.length > 0 && ids.length === saved.split(",").filter(Boolean).length) return ids;
  const adult = real.find((profile) => profile.role !== "child" && !profile.isChild);
  const first = adult?.id ?? real[0]?.id;
  return first ? [first] : [];
}
