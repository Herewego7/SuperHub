// Parsing helpers for external-calendar event dates. All three sources use
// EXCLUSIVE end dates for all-day events (an event covering just Jul 10
// arrives with end = Jul 11), which — treated as inclusive — made every
// all-day event spill onto the following day ("Cynthia OOO" on 7/10 showing
// 7/10 12:00am → 7/11 11:59pm).

interface GooglePart {
  date?: string | null;
  dateTime?: string | null;
}

/**
 * Google Calendar: timed events carry `dateTime` (with offset); all-day
 * events carry date-only `date` strings where END IS EXCLUSIVE.
 */
export function parseGoogleEventDates(ge: {
  start?: GooglePart | null;
  end?: GooglePart | null;
}): { start: Date; end: Date } {
  const start = ge.start?.dateTime
    ? new Date(ge.start.dateTime)
    : ge.start?.date
      ? new Date(ge.start.date + "T00:00:00")
      : new Date();
  let end: Date;
  if (ge.end?.dateTime) {
    end = new Date(ge.end.dateTime);
  } else if (ge.end?.date) {
    // Exclusive end date → the event really ends at 23:59:59 the day BEFORE.
    end = new Date(new Date(ge.end.date + "T00:00:00").getTime() - 1000);
    if (end < start) end = endOfDay(start); // malformed feed guard (end === start)
  } else {
    end = new Date(start);
  }
  return { start, end };
}

interface GraphPart {
  dateTime?: string;
  timeZone?: string;
}

/**
 * Microsoft Graph: `dateTime` strings carry NO offset — the separate
 * `timeZone` field says which zone they're in, and without a Prefer header
 * (we don't send one) that's UTC. Parsing them bare made JS read UTC
 * wall-times as LOCAL, shifting every timed event by the user's UTC offset.
 * All-day events are UTC midnights with an EXCLUSIVE end; those take the
 * DATE part as a local calendar date instead (converting via UTC would shift
 * the date for anyone west of Greenwich).
 */
export function parseOutlookEventDates(oe: {
  start?: GraphPart | null;
  end?: GraphPart | null;
  isAllDay?: boolean;
}): { start: Date; end: Date } {
  if (oe.isAllDay) {
    const startDay = (oe.start?.dateTime ?? "").slice(0, 10);
    const endDayExclusive = (oe.end?.dateTime ?? "").slice(0, 10);
    const start = startDay ? new Date(startDay + "T00:00:00") : new Date();
    let end = endDayExclusive
      ? new Date(new Date(endDayExclusive + "T00:00:00").getTime() - 1000)
      : endOfDay(start);
    if (end < start) end = endOfDay(start);
    return { start, end };
  }
  return { start: parseGraphTimed(oe.start), end: parseGraphTimed(oe.end) };
}

function parseGraphTimed(part?: GraphPart | null): Date {
  if (!part?.dateTime) return new Date();
  const raw = part.dateTime;
  const hasOffset = /[zZ]$|[+-]\d\d:?\d\d$/.test(raw);
  if (!hasOffset && (part.timeZone ?? "UTC") === "UTC") {
    return new Date(raw + "Z");
  }
  return new Date(raw);
}

/**
 * iCal feeds: RFC 5545's DTEND is also EXCLUSIVE for date-only (all-day)
 * events. The backend (icalCalendar.ts's asUtcDate) anchors date-only values
 * at NOON UTC rather than midnight, specifically so this instant's LOCAL
 * calendar date is correct in every real-world timezone (UTC-12..UTC+12) —
 * midnight UTC read back in local time is the previous evening for anyone
 * west of Greenwich, which is what made all-day events start (and, before
 * this fix, end) a day early.
 *
 * Given that, the exclusive→inclusive conversion has to work in LOCAL
 * calendar days, not milliseconds: subtracting a flat 1 second from a
 * noon-anchored instant just lands at ~11:59am the same exclusive day, still
 * the wrong day — only subtracting 1 second from a MIDNIGHT anchor happens to
 * land just before the correct day. So: read the exclusive end's local date,
 * step back one calendar day, and end at 23:59:59 local of THAT day.
 */
export function icalDisplayEnd(endIso: string, isAllDay: boolean, start: Date): Date {
  const end = new Date(endIso);
  if (!isAllDay) return end;
  const inclusiveDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const adjusted = endOfDay(inclusiveDay);
  return adjusted < start ? endOfDay(start) : adjusted;
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}
