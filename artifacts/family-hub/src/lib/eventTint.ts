/**
 * The faint wash of an event's own colour behind a row, the way the Events
 * card on Home already does it (`eventColor + '28'`, ~16% alpha).
 *
 * ⚠️ Hex-alpha rather than a Tailwind `/16` modifier: opacity modifiers on
 * theme colours compile to no CSS at all in this project (CLAUDE.md), which
 * is how the agenda sheet's grabber shipped invisible.
 *
 * Returns undefined for anything that is not a plain 6-digit hex — a synced
 * Google/Outlook calendar supplies its own `calendarColor` string, and
 * concatenating "28" onto e.g. `rgb(...)` yields a colour the browser drops,
 * leaving a row with no background at all rather than a tinted one.
 */
export function eventTint(color: string | undefined): string | undefined {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? `${color}28` : undefined;
}
