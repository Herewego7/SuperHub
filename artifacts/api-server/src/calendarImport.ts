import ICAL from "ical.js";
import { GoogleGenAI } from "@google/genai";
import { safeFetchText } from "./lib/safeFetch";
import { ObjectStorageService } from "./objectStorage";

// Internal preview shape sent to the client (dates serialized as ISO strings).
export interface PreviewEvent {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  isAllDay: boolean;
}

export interface PreviewPayload {
  events: PreviewEvent[];
  rangeStart: string | null;
  rangeEnd: string | null;
  totalCount: number;
}

// Expand recurring events within a 12-month window from "now - 1 month".
const RECURRENCE_WINDOW_MONTHS_BEFORE = 1;
const RECURRENCE_WINDOW_MONTHS_AFTER = 12;

function asUtcDate(time: ICAL.Time): Date {
  // For date-only ("all-day") values, anchor at noon UTC of the target date so
  // that the calendar day is preserved across all timezones (±12h safe).
  if (time.isDate) {
    return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1, 12, 0, 0));
  }
  return time.toJSDate();
}

// ---------- SSRF-safe ICS fetch ----------

// The hardening (protocol allowlist, public-IP-only, DNS pinning, per-hop
// redirect re-validation, size cap, timeouts) now lives in lib/safeFetch.ts
// so the recipe-URL importer reuses exactly this implementation instead of
// growing a second, subtly-weaker copy. This wrapper just supplies the
// ICS-specific Accept header, size cap and error wording.
const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB

export async function safeFetchIcs(initialUrl: string): Promise<string> {
  const { text } = await safeFetchText(initialUrl, {
    accept: "text/calendar, text/plain, */*",
    maxBytes: MAX_ICS_BYTES,
    label: "ICS feed",
  });
  return text;
}

function buildDescriptionFromVEvent(vevent: ICAL.Event): string | null {
  const parts: string[] = [];
  const summary = vevent.summary;
  const description = vevent.description;
  if (description && description.trim() && description.trim() !== summary) {
    parts.push(description.trim());
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Fetch an ICS feed and parse it into a preview payload. Recurring events are
 * expanded into individual occurrences within a 12-month window so the user
 * can see exactly what will be imported.
 */
export async function previewFromIcsUrl(url: string): Promise<PreviewPayload> {
  // Validate URL early
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!/^https?:$/.test(parsedUrl.protocol) && parsedUrl.protocol !== "webcal:") {
    throw new Error("Only http(s) and webcal URLs are supported");
  }

  // Replace webcal:// with https:// per de-facto convention
  const fetchUrl = parsedUrl.protocol === "webcal:"
    ? `https://${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`
    : parsedUrl.toString();

  let icsText: string;
  try {
    icsText = await safeFetchIcs(fetchUrl);
  } catch (err: any) {
    if (err?.name === "TimeoutError") {
      throw new Error("ICS feed fetch timed out");
    }
    throw err;
  }

  return parseIcsText(icsText);
}

export function parseIcsText(icsText: string): PreviewPayload {
  let jcal: any;
  try {
    jcal = ICAL.parse(icsText);
  } catch (err) {
    throw new Error("Could not parse ICS file - it may be malformed");
  }
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setMonth(rangeStart.getMonth() - RECURRENCE_WINDOW_MONTHS_BEFORE);
  const rangeEnd = new Date(now);
  rangeEnd.setMonth(rangeEnd.getMonth() + RECURRENCE_WINDOW_MONTHS_AFTER);

  const previewEvents: PreviewEvent[] = [];
  // Cap occurrences per recurring rule to avoid runaway expansion.
  const MAX_OCCURRENCES_PER_EVENT = 400;

  for (const veventComp of vevents) {
    let vevent: ICAL.Event;
    try {
      vevent = new ICAL.Event(veventComp);
    } catch {
      continue;
    }

    const baseUid = vevent.uid || `${vevent.summary || "event"}-${Math.random().toString(36).slice(2)}`;
    const isAllDay = vevent.startDate?.isDate ?? false;

    if (vevent.isRecurring()) {
      let iterator: ICAL.RecurExpansion;
      try {
        iterator = vevent.iterator();
      } catch {
        continue;
      }
      let occurrenceCount = 0;
      let next: ICAL.Time | null;
      while ((next = iterator.next()) && occurrenceCount < MAX_OCCURRENCES_PER_EVENT) {
        const occurrenceDate = asUtcDate(next);
        if (occurrenceDate > rangeEnd) break;
        if (occurrenceDate < rangeStart) {
          occurrenceCount++;
          continue;
        }
        let occurrence;
        try {
          occurrence = vevent.getOccurrenceDetails(next);
        } catch {
          occurrenceCount++;
          continue;
        }
        const startTime = asUtcDate(occurrence.startDate);
        const endTime = occurrence.endDate
          ? asUtcDate(occurrence.endDate)
          : new Date(startTime.getTime() + (isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
        previewEvents.push({
          externalId: `${baseUid}::${next.toString()}`,
          title: vevent.summary || "Untitled event",
          description: buildDescriptionFromVEvent(vevent),
          location: vevent.location || null,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          isAllDay,
        });
        occurrenceCount++;
      }
    } else {
      if (!vevent.startDate || !vevent.endDate) continue;
      const startTime = asUtcDate(vevent.startDate);
      const endTime = asUtcDate(vevent.endDate);
      // Skip events totally outside our window
      if (startTime > rangeEnd || endTime < rangeStart) continue;
      previewEvents.push({
        externalId: baseUid,
        title: vevent.summary || "Untitled event",
        description: buildDescriptionFromVEvent(vevent),
        location: vevent.location || null,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        isAllDay,
      });
    }
  }

  // Sort by start time
  previewEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const minStart = previewEvents[0]?.startTime ?? null;
  const maxStart = previewEvents[previewEvents.length - 1]?.startTime ?? null;

  return {
    events: previewEvents,
    rangeStart: minStart,
    rangeEnd: maxStart,
    totalCount: previewEvents.length,
  };
}

// ---------- PDF import via Gemini vision ----------

interface AiExtractedEvent {
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD (for multi-day events)
  startTime?: string | null; // HH:MM (24h) or null
  endTime?: string | null;
  isAllDay: boolean;
  location?: string | null;
  description?: string | null;
}

const PDF_EXTRACTION_PROMPT = `You are reading a school's printed calendar. Extract every distinct event, holiday, break, half-day, no-school day, and important date.

Return ONLY valid JSON matching this exact shape (no markdown, no code fences):
{
  "events": [
    {
      "title": "string",
      "date": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD or omit",
      "startTime": "HH:MM (24h) or null",
      "endTime": "HH:MM (24h) or null",
      "isAllDay": true,
      "location": "string or null",
      "description": "string or null"
    }
  ]
}

Rules:
- If only a date is shown (no time), set isAllDay=true and times to null.
- For multi-day breaks like "Spring Break: Mar 23 - Mar 27", create ONE event with date=start, endDate=end.
- Use the year that appears on the calendar (or the most recent if ambiguous).
- Skip generic captions, page numbers, and headings — only real dated events.
- Title should be human-readable, e.g. "No School - Teacher Workshop", not "TW".`;

function fetchGemini(): GoogleGenAI {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("Gemini AI integration is not configured");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
  });
}

function combineDateAndTime(date: string, time: string | null | undefined, fallbackHour: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [hh, mm] = time.split(":").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh, mm, 0));
  }
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, fallbackHour, 0, 0));
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function aiEventToPreview(e: AiExtractedEvent): PreviewEvent | null {
  if (!e?.title || !e?.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  const isAllDay = e.isAllDay ?? !e.startTime;
  // For all-day events, anchor to noon UTC so the calendar day is preserved
  // across all viewer timezones.
  const startFallbackHour = isAllDay ? 12 : 9;
  const start = combineDateAndTime(e.date, isAllDay ? null : e.startTime, startFallbackHour);
  let end: Date;
  if (e.endDate && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate)) {
    end = combineDateAndTime(e.endDate, isAllDay ? null : (e.endTime ?? e.startTime), isAllDay ? 12 : 10);
  } else if (isAllDay) {
    end = new Date(start);
  } else {
    end = combineDateAndTime(e.date, e.endTime ?? null, 10);
    if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  // Deterministic external id derived only from content so re-imports of
  // the same PDF (or even a fresh AI extraction with reordered events)
  // dedup correctly.
  const slug = slugifyTitle(e.title);
  const endPart = e.endDate && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate) ? e.endDate : e.date;
  const externalId = `pdf:${slug}:${e.date}:${endPart}:${isAllDay ? "all" : (e.startTime ?? "0")}`;
  return {
    externalId,
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    isAllDay,
  };
}

/**
 * Download a PDF from object storage and ask Gemini to extract events.
 */
export async function previewFromPdfObjectPath(objectPath: string): Promise<PreviewPayload> {
  const objectStorage = new ObjectStorageService();
  const buffer = await objectStorage.downloadBytes(objectPath);
  const base64 = buffer.toString("base64");

  const ai = fetchGemini();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: PDF_EXTRACTION_PROMPT },
          { inlineData: { mimeType: "application/pdf", data: base64 } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const text = response.text || "";
  let parsed: { events?: AiExtractedEvent[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Sometimes the model wraps in code fences despite responseMimeType.
    const cleaned = text.replace(/```json|```/g, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("AI returned invalid JSON when reading the PDF");
    }
  }

  const aiEvents = Array.isArray(parsed?.events) ? parsed.events : [];
  const seen = new Map<string, PreviewEvent>();
  for (const e of aiEvents) {
    const pe = aiEventToPreview(e);
    if (pe && !seen.has(pe.externalId)) {
      seen.set(pe.externalId, pe);
    }
  }
  const previewEvents = Array.from(seen.values());

  previewEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    events: previewEvents,
    rangeStart: previewEvents[0]?.startTime ?? null,
    rangeEnd: previewEvents[previewEvents.length - 1]?.startTime ?? null,
    totalCount: previewEvents.length,
  };
}
