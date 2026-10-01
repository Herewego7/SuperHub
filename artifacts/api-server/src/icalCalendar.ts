import ICAL from "ical.js";
import { safeFetchIcs } from "./calendarImport";

// For date-only ("all-day") ICAL.Time values, ICAL.js's own toJSDate()
// resolves to midnight UTC of that date — which is the PREVIOUS calendar day,
// evening, for anyone west of UTC (verified: a DTSTART;VALUE=DATE:20260715
// serializes as 2026-07-15T00:00:00.000Z, and a US client rendering that
// raw shows the event starting Jul 14 evening). Anchoring at noon UTC instead
// keeps the same calendar date correct for every timezone within ±12h of UTC.
// calendarImport.ts (the one-off ICS import) already uses exactly this fix;
// this feed-subscription path never got it.
function asUtcDate(time: ICAL.Time): Date {
  if (time.isDate) {
    return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1, 12, 0, 0));
  }
  // A timed value with an unresolvable TZID (feed references a zone with no
  // matching VTIMEZONE block — some school/sports scheduling systems do this)
  // falls back to ical.js's "floating" zone, whose own toJSDate() then builds
  // a plain `new Date(y, m, d, h, ...)` — interpreted in the SERVER's local
  // system timezone, not the feed's intended one. That's a silent 5-6h shift
  // for any family not in the server's timezone, and it changes if the server
  // is ever redeployed to a different region. Resolving the same floating
  // components as UTC instead is not necessarily what the feed author meant,
  // but it's a stable, documented interpretation independent of deployment
  // location, rather than an accidental one.
  if (time.zone === ICAL.Timezone.localTimezone) {
    return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1, time.hour || 0, time.minute || 0, time.second || 0));
  }
  return time.toJSDate();
}

// ─────────────────────────────────────────────────────────────────────────────
// iCal (.ics URL) subscription support — READ ONLY.
//
// Unlike Google/Outlook (OAuth + two-way sync), an .ics feed is just a file at a
// URL. We fetch it, parse with ical.js, expand recurring events within a ±1-year
// window, and return a normalized event shape. There is no write-back.
// ─────────────────────────────────────────────────────────────────────────────

export interface IcalEvent {
  id: string;          // stable per-occurrence id (uid + start)
  uid: string;
  title: string;
  start: string;       // ISO 8601
  end: string;         // ISO 8601
  isAllDay: boolean;
  description: string | null;
  location: string | null;
}

// Window: only return occurrences within ±1 year of now (matches Google/Outlook).
const WINDOW_BACK_MS = 365 * 24 * 60 * 60 * 1000;
const WINDOW_FWD_MS = 365 * 24 * 60 * 60 * 1000;
// Safety cap on expanded occurrences per recurring series.
const MAX_OCCURRENCES = 750;

// ─── In-memory cache ─────────────────────────────────────────────────────────
// .ics feeds change slowly and can be slow/large to fetch, so cache the parsed
// result per URL. (Hearth Display refreshes URL calendars every 4–8h; 15 min is
// a friendlier default while still avoiding a fetch on every request/render.)
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { events: IcalEvent[]; expires: number }>();

export function invalidateIcalCache(feedUrl: string): void {
  cache.delete(normalizeUrl(feedUrl));
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  // webcal:// is the conventional scheme for calendar subscriptions — it's just
  // http(s) under the hood.
  if (trimmed.toLowerCase().startsWith("webcal://")) {
    return "https://" + trimmed.slice("webcal://".length);
  }
  return trimmed;
}

export class IcalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchFeed(feedUrl: string): Promise<string> {
  const url = normalizeUrl(feedUrl);
  let text: string;
  try {
    // Same SSRF-safe fetcher the one-off ICS import already uses (DNS-pinned
    // to a validated public IP, manual-redirect re-validation per hop, size
    // cap) — this subscription path was a plain fetch() of a user-supplied
    // URL with redirects auto-followed, never SSRF-hardened like the import
    // path was.
    text = await safeFetchIcs(url);
  } catch (e: any) {
    throw new IcalError(502, `Could not reach the calendar URL: ${e?.message ?? "network error"}`);
  }
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new IcalError(422, "That URL doesn't look like a valid iCal (.ics) feed.");
  }
  return text;
}

function isWithinWindow(d: Date, now: number): boolean {
  const t = d.getTime();
  return t >= now - WINDOW_BACK_MS && t <= now + WINDOW_FWD_MS;
}

/**
 * Parse raw .ics text into normalized, recurrence-expanded events within the
 * ±1-year window. Pure function (no network) so it's easy to unit-test.
 */
export function parseIcal(raw: string): IcalEvent[] {
  const jcal = ICAL.parse(raw);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");
  const now = Date.now();
  const out: IcalEvent[] = [];

  // Group exceptions (modified single occurrences, carrying RECURRENCE-ID) with
  // their master series so ical.js applies the overrides during expansion.
  const masters: ICAL.Event[] = [];
  const exceptions: ICAL.Event[] = [];
  for (const ve of vevents) {
    let ev: ICAL.Event;
    try {
      ev = new ICAL.Event(ve);
    } catch {
      continue; // skip malformed VEVENT
    }
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.push(ev);
  }

  // Every individual VEVENT parse failure is swallowed above (one bad entry
  // shouldn't sink the whole feed) — but if the feed actually had events and
  // literally none of them survived, that's a real parse problem, not a
  // legitimately empty calendar. Previously this silently returned 0 events
  // with lastError left null, indistinguishable from "nothing scheduled."
  if (vevents.length > 0 && masters.length === 0 && exceptions.length === 0) {
    throw new Error(`Found ${vevents.length} event(s) in this feed, but none of them could be read.`);
  }

  const masterByUid = new Map<string, ICAL.Event>();
  for (const m of masters) if (m.uid) masterByUid.set(m.uid, m);
  for (const ex of exceptions) {
    const master = ex.uid ? masterByUid.get(ex.uid) : undefined;
    if (master) {
      try { master.relateException(ex); } catch { /* ignore */ }
    } else {
      // Orphan exception with no master in the feed — treat as a one-off.
      masters.push(ex);
    }
  }

  for (const ev of masters) {
    if (!ev.startDate) continue;
    const uid = ev.uid || Math.random().toString(36).slice(2);
    const title = ev.summary || "Untitled";
    const description = ev.description || null;
    const location = ev.location || null;

    if (!ev.isRecurring()) {
      const start = asUtcDate(ev.startDate);
      // Some feeds omit DTEND; fall back to start.
      const end = ev.endDate ? asUtcDate(ev.endDate) : start;
      const isAllDay = ev.startDate.isDate;
      if (isWithinWindow(start, now)) {
        out.push({
          id: `${uid}::${start.getTime()}`,
          uid, title, location, description, isAllDay,
          start: start.toISOString(),
          end: end.toISOString(),
        });
      }
      continue;
    }

    // Recurring series — expand within the window.
    const isAllDay = ev.startDate.isDate;
    const durationSec = ev.duration ? ev.duration.toSeconds() : 0;
    const iterator = ev.iterator();
    let next: ICAL.Time | null;
    let count = 0;
    const windowEnd = now + WINDOW_FWD_MS;
    const windowStart = now - WINDOW_BACK_MS;
    while ((next = iterator.next()) && count < MAX_OCCURRENCES) {
      count++;
      // next.toJSDate() (not asUtcDate) here on purpose: this is only used
      // for the window/chronology check below, comparing against `now` in
      // real UTC millis — not something that gets rendered as a calendar day.
      const occStart = next.toJSDate();
      if (occStart.getTime() > windowEnd) break; // iterator is chronological
      if (occStart.getTime() < windowStart) continue;
      // getOccurrenceDetails applies any RECURRENCE-ID exception overrides.
      let details;
      try {
        details = ev.getOccurrenceDetails(next);
      } catch {
        details = null;
      }
      const s = details ? asUtcDate(details.startDate) : asUtcDate(next);
      const e = details
        ? asUtcDate(details.endDate)
        : new Date(asUtcDate(next).getTime() + durationSec * 1000);
      out.push({
        id: `${uid}::${s.getTime()}`,
        uid,
        title: details?.item?.summary || title,
        location: details?.item?.location || location,
        description: details?.item?.description || description,
        isAllDay,
        start: s.toISOString(),
        end: e.toISOString(),
      });
    }
  }

  return out;
}

/**
 * Fetch + parse a feed, with a short in-memory cache. Throws IcalError on
 * unreachable / invalid feeds.
 */
export async function fetchIcalEvents(feedUrl: string): Promise<IcalEvent[]> {
  const key = normalizeUrl(feedUrl);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.events;

  const raw = await fetchFeed(feedUrl);
  let events: IcalEvent[];
  try {
    events = parseIcal(raw);
  } catch (e: any) {
    throw new IcalError(422, `Couldn't parse that calendar feed: ${e?.message ?? "parse error"}`);
  }
  cache.set(key, { events, expires: Date.now() + CACHE_TTL_MS });
  return events;
}

/** Lightweight validation used by the subscribe endpoint — fetch + parse once. */
export async function validateIcalFeed(feedUrl: string): Promise<{ eventCount: number }> {
  const events = await fetchIcalEvents(feedUrl);
  return { eventCount: events.length };
}
