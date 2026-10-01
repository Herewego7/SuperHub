// Country + region helpers for every part of the app that cares about WHERE a
// family is: which timezone their timed pushes fire in, which coordinates their
// weather comes from, whether the field is called "State" or "Province", and
// whether temperatures are Fahrenheit or Celsius.
//
// Was `usTimezones.ts`, US-only, until Canada was added (2026-09-10). The old
// name had become actively misleading.
//
// ⚠️ The single most important rule here: a region -> timezone map is a GUESS.
// Several states and provinces legitimately span two zones (western
// Nebraska/Kansas/Texas are Mountain, the FL panhandle is Central, northern
// Idaho is Pacific, Nunavut spans three). `deviceTimezone()` below asks the
// operating system instead, which is simply correct, needs no permission and
// costs nothing — prefer it, and keep these maps only as the fallback for when
// it is unavailable or obviously wrong.

export type CountryCode = "US" | "CA";

export interface CountryInfo {
  code: CountryCode;
  /** What `location_settings.country` stores — matches the column's existing
   *  default ("United States"), so nothing already saved has to be migrated. */
  name: string;
  /** "State" in the US, "Province" in Canada. */
  regionLabel: string;
  /** Open-Meteo's `temperature_unit` parameter. */
  tempUnit: "fahrenheit" | "celsius";
}

export const COUNTRIES: CountryInfo[] = [
  { code: "US", name: "United States", regionLabel: "State", tempUnit: "fahrenheit" },
  { code: "CA", name: "Canada", regionLabel: "Province", tempUnit: "celsius" },
];

export const DEFAULT_COUNTRY: CountryCode = "US";

const US_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
  PR: "America/Puerto_Rico", GU: "Pacific/Guam", VI: "America/St_Thomas",
};

const US_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "puerto rico": "PR",
};

// Canada. No 2-letter code here collides with a US one (checked: AB BC MB NB
// NL NS NT NU ON PE QC SK YT against all 50 states + DC/PR/GU/VI), so a
// country-less lookup still resolves unambiguously — but pass the country when
// you have it.
//
// NT uses America/Edmonton rather than America/Yellowknife: tzdata merged the
// latter into the former in 2022, and some runtimes no longer resolve it.
// Saskatchewan is America/Regina, which does NOT observe DST — the one place
// where getting this wrong drifts by an hour for half the year.
const CA_TIMEZONES: Record<string, string> = {
  AB: "America/Edmonton",   BC: "America/Vancouver", MB: "America/Winnipeg",
  NB: "America/Moncton",    NL: "America/St_Johns",  NS: "America/Halifax",
  NT: "America/Edmonton",   NU: "America/Iqaluit",   ON: "America/Toronto",
  PE: "America/Halifax",    QC: "America/Toronto",   SK: "America/Regina",
  YT: "America/Whitehorse",
};

const CA_NAME_TO_ABBR: Record<string, string> = {
  alberta: "AB", "british columbia": "BC", manitoba: "MB",
  "new brunswick": "NB", "newfoundland and labrador": "NL", newfoundland: "NL",
  "nova scotia": "NS", "northwest territories": "NT", nunavut: "NU",
  ontario: "ON", "prince edward island": "PE", quebec: "QC", "québec": "QC",
  saskatchewan: "SK", yukon: "YT",
};

const REGION_NAMES: Record<CountryCode, Record<string, string>> = {
  US: Object.fromEntries(Object.entries(US_NAME_TO_ABBR).map(([n, a]) => [a, title(n)])),
  CA: Object.fromEntries(Object.entries(CA_NAME_TO_ABBR).map(([n, a]) => [a, title(n)])),
};

function title(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function countryInfo(code: CountryCode): CountryInfo {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]!;
}

/** "United States" -> "US". Unrecognised names fall back to US, matching the
 *  column default rather than inventing a third state. */
export function countryFromName(name: string | null | undefined): CountryCode {
  if (!name) return DEFAULT_COUNTRY;
  const n = name.trim().toLowerCase();
  if (n === "canada" || n === "ca") return "CA";
  return "US";
}

export function regionLabel(code: CountryCode): string {
  return countryInfo(code).regionLabel;
}

/** Regions for a picker: [{ abbr, name }], alphabetical by name. */
export function regionsFor(code: CountryCode): { abbr: string; name: string }[] {
  return Object.entries(REGION_NAMES[code])
    .map(([abbr, name]) => ({ abbr, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Best-effort IANA timezone for a state or province — accepts a 2-letter
 * abbreviation ("MN", "ON") or a full name ("Minnesota", "Ontario"),
 * case- and spacing-insensitive. `undefined` for anything unrecognised, so the
 * caller can omit the field rather than guess and let the stored value stand.
 */
export function regionToTimezone(region: string, country?: CountryCode): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  const lookups: CountryCode[] = country ? [country] : ["US", "CA"];
  for (const c of lookups) {
    const names = c === "US" ? US_NAME_TO_ABBR : CA_NAME_TO_ABBR;
    const zones = c === "US" ? US_TIMEZONES : CA_TIMEZONES;
    const abbr = trimmed.length === 2 ? trimmed.toUpperCase() : names[trimmed.toLowerCase()];
    if (abbr && zones[abbr]) return zones[abbr];
  }
  return undefined;
}

/**
 * The timezone the operating system says this device is in. Correct by
 * construction — no state-spans-two-zones guessing — and available everywhere
 * without a permission prompt. Returns undefined only if Intl is unavailable
 * or reports something empty.
 */
export function deviceTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : undefined;
  } catch {
    return undefined;
  }
}

const CA_ZONE_SET = new Set(Object.values(CA_TIMEZONES));

/** Which country a timezone implies — used only to pre-select the picker. */
export function countryFromTimezone(tz: string | undefined): CountryCode | undefined {
  if (!tz) return undefined;
  if (CA_ZONE_SET.has(tz)) return "CA";
  if (tz.startsWith("America/") || tz.startsWith("Pacific/Honolulu")) return "US";
  return undefined;
}

/** The country to pre-select for a family that has not chosen one yet. */
export function guessCountry(): CountryCode {
  return countryFromTimezone(deviceTimezone()) ?? DEFAULT_COUNTRY;
}
