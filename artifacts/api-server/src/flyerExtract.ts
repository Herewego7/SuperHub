import { GoogleGenAI } from "@google/genai";
import { ObjectStorageService } from "./objectStorage";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ExtractedEvent {
  title: string;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  /**
   * True when a four-digit year was actually printed on the flyer. When false
   * the year is the model's guess, which is what the year-rollforward guard
   * below is allowed to correct. Defaults to false (guess) so an older model
   * that omits the field still gets the correction.
   */
  yearPrinted: boolean;
  /** Set when the guard moved the year; drives the "we adjusted this" hint. */
  yearAdjustedFrom: string | null;
  /** True when the final date is still before today (only possible when the
   *  flyer explicitly printed a past year) — the review sheet flags these. */
  isPastDate: boolean;
  confidence: {
    title: ConfidenceLevel;
    date: ConfidenceLevel;
    time: ConfidenceLevel;
    location: ConfidenceLevel;
  };
}

export interface FlyerExtraction {
  imageUrl: string;
  events: ExtractedEvent[];
  warning: string | null;
}

/**
 * The prompt MUST be built per-request, not stored as a constant: it embeds
 * today's date. Without that the model resolves a year-less flyer date
 * ("Wednesday, August 14") against its own training-era sense of "now" and
 * happily returns a year two years in the past — the event saves fine but
 * lands where nobody will ever scroll, which reads as total data loss.
 */
function buildFlyerPrompt(todayISO: string): string {
  const weekday = new Date(`${todayISO}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", timeZone: "UTC",
  });
  return `Today's date is ${todayISO} (${weekday}). Flyers advertise UPCOMING events.

${FLYER_PROMPT_BODY}`;
}

const FLYER_PROMPT_BODY = `You are a family calendar assistant. Extract calendar events from ANY image a parent uploads — this includes school flyers, party invitations, sports schedules, permission slips, screenshots of emails, screenshots of text messages, screenshots of websites, handwritten notes, or any other document that mentions dates or events.

Extract ALL distinct events or scheduled dates you can find. There may be 1 event or there may be many (e.g., a sports schedule with 10 games, a school calendar with multiple dates, an email mentioning several upcoming deadlines).

Return ONLY valid JSON matching this exact shape (no markdown, no code fences, no extra commentary):
{
  "events": [
    {
      "title": "string",
      "date": "YYYY-MM-DD or null",
      "endDate": "YYYY-MM-DD or null",
      "startTime": "HH:MM (24h) or null",
      "endTime": "HH:MM (24h) or null",
      "isAllDay": true,
      "location": "string or null",
      "description": "string or null",
      "yearPrinted": false,
      "confidence": {
        "title": "high|medium|low",
        "date": "high|medium|low",
        "time": "high|medium|low",
        "location": "high|medium|low"
      }
    }
  ]
}

Rules:
- Include EVERY distinct event or date-based item you find, not just the primary one.
- Screenshots of emails and messages are valid — extract any events, appointments, deadlines, or dates mentioned in them.
- Each event's title should be a human-readable name (e.g., "Soccer Practice", "Spring Carnival", "Field Trip Permission Due"). Never use generic labels like "FLYER" or "EVENT".
- If only a date appears with no time, set isAllDay=true and times to null.
- DATES (important):
  - If a date is missing a year, resolve it to the NEXT occurrence on or after today's date given above. Never return a date in the past.
  - If the weekday printed on the flyer conflicts with the weekday of the resolved date, TRUST THE MONTH AND DAY and ignore the printed weekday. Do NOT shift the date to make the weekday match, and do NOT pick an older year just because its weekday lines up.
  - Set "yearPrinted": true ONLY when a four-digit year is actually printed on the image for that event. If you inferred or assumed the year, set "yearPrinted": false.
- description should briefly summarize key details for that specific event (RSVP info, what to bring, dress code, any other relevant info) — keep under 400 characters.
- Confidence is "high" when the value is clearly printed, "medium" when implied or partially obscured, "low" when guessed or missing.
- If you genuinely cannot find a date for an event, set date and endDate to null with confidence "low".
- Only return an empty events array if the image contains absolutely no dates, events, or appointments whatsoever (e.g., a plain landscape photo).`;

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

function normalizeConfidence(v: unknown): ConfidenceLevel {
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

function isoDateOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function timeOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function inferImageMimeType(contentType: string | null | undefined, objectName: string, buffer?: Buffer): string {
  if (contentType && /^image\//.test(contentType)) return contentType;
  const lower = objectName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  // Detect from magic bytes when extension is absent/unknown
  if (buffer && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  }
  return "image/jpeg";
}

/** Today in the given IANA-free "YYYY-MM-DD" form, in the SERVER's local zone. */
export function serverToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/**
 * Move a date forward by whole years until it is on or after `todayISO`,
 * preserving month/day. Returns the number of years added so a companion
 * endDate can be shifted by exactly the same amount (otherwise a multi-day
 * event would have its span stretched to years).
 *
 * Feb 29 is clamped to Feb 28 in non-leap target years rather than silently
 * rolling into March 1, which is what a naive Date(y+1, 1, 29) would do.
 */
export function rollYearForward(
  dateISO: string,
  todayISO: string,
): { date: string; yearsAdded: number } {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return { date: dateISO, yearsAdded: 0 };

  const build = (year: number) => {
    // Clamp the day to the target year's real month length (Feb 29 -> Feb 28).
    const lastDay = new Date(year, m, 0).getDate();
    const day = Math.min(d, lastDay);
    return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  let years = 0;
  // String compare is safe and TZ-free for zero-padded YYYY-MM-DD.
  while (build(y + years) < todayISO && years < 25) years += 1;
  return { date: build(y + years), yearsAdded: years };
}

/**
 * The code-side half of the year fix. Deliberately independent of the prompt:
 * the prompt tells the model what today is, this makes sure a wrong answer
 * still can't put a flyer event in the past.
 *
 * Only fires when the year was NOT printed on the flyer. If the flyer really
 * did say "August 14, 2024", that's a deliberate past date (someone snapping
 * an old document) — it is left alone and flagged for the UI instead, which is
 * why `isPastDate` exists.
 */
function applyDateGuard(ev: ExtractedEvent, todayISO: string): ExtractedEvent {
  if (!ev.date) return ev;

  if (!ev.yearPrinted && ev.date < todayISO) {
    const { date, yearsAdded } = rollYearForward(ev.date, todayISO);
    if (yearsAdded > 0) {
      console.warn(
        `[flyer-extract] model returned a past date ${ev.date} (today ${todayISO}); ` +
        `rolled forward ${yearsAdded}y to ${date} for "${ev.title}"`,
      );
      return {
        ...ev,
        date,
        // Shift endDate by the same number of years so a multi-day span keeps
        // its length. If it was missing or now trails the start, drop it.
        endDate: ev.endDate
          ? (() => {
              const [ey, em, ed] = ev.endDate.split("-").map(Number);
              if (!ey) return null;
              const lastDay = new Date(ey + yearsAdded, em, 0).getDate();
              const shifted = `${ey + yearsAdded}-${String(em).padStart(2, "0")}-${String(Math.min(ed, lastDay)).padStart(2, "0")}`;
              return shifted >= date ? shifted : null;
            })()
          : null,
        yearAdjustedFrom: ev.date,
        isPastDate: false,
      };
    }
  }

  return { ...ev, isPastDate: ev.date < todayISO };
}

function normalizeEvent(raw: any): ExtractedEvent {
  const conf = raw?.confidence ?? {};
  const date = isoDateOrNull(raw?.date);
  const startTime = timeOrNull(raw?.startTime);
  const endTime = timeOrNull(raw?.endTime);
  const isAllDay = raw?.isAllDay === true || (!startTime && !!date);

  return {
    title: typeof raw?.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim().slice(0, 200)
      : "Untitled event",
    date,
    endDate: isoDateOrNull(raw?.endDate),
    startTime: isAllDay ? null : startTime,
    endTime: isAllDay ? null : endTime,
    isAllDay,
    location: typeof raw?.location === "string" && raw.location.trim().length > 0
      ? raw.location.trim().slice(0, 300)
      : null,
    description: typeof raw?.description === "string" && raw.description.trim().length > 0
      ? raw.description.trim().slice(0, 1000)
      : null,
    // Strict === true: anything else (missing field from an older model,
    // a string, null) counts as "the model guessed", which is the case the
    // rollforward guard is meant to correct.
    yearPrinted: raw?.yearPrinted === true,
    yearAdjustedFrom: null,
    isPastDate: false,
    confidence: {
      title: normalizeConfidence(conf.title),
      date: normalizeConfidence(conf.date),
      time: normalizeConfidence(conf.time),
      location: normalizeConfidence(conf.location),
    },
  };
}

/**
 * Download a flyer image from object storage and ask Gemini to extract
 * all events found on it. Returns an array of events for the user to select from.
 */
export async function extractEventFromImage(
  rawObjectURL: string,
  /**
   * The CLIENT's local "YYYY-MM-DD". Passed through from the request because
   * the server commonly runs in UTC — near a day boundary the server's idea of
   * "today" can be a different calendar day than the family's, which would
   * make the guard roll (or fail to roll) by a day at the edges.
   */
  clientTodayISO?: string,
): Promise<FlyerExtraction> {
  const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(clientTodayISO ?? "")
    ? (clientTodayISO as string)
    : serverToday();
  const objectStorage = new ObjectStorageService();
  const normalizedPath = objectStorage.normalizeObjectEntityPath(rawObjectURL);
  if (!normalizedPath.startsWith("/objects/")) {
    throw new Error("Invalid uploaded image path");
  }

  const buffer = await objectStorage.downloadBytes(normalizedPath);
  const mimeType = inferImageMimeType(null, normalizedPath, buffer);
  if (buffer.length > 12 * 1024 * 1024) {
    throw new Error("Image is too large (max 12 MB)");
  }
  const base64 = buffer.toString("base64");

  const ai = fetchGemini();

  // Try models in order of preference; fall through on failure
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastError: unknown;
  let text = "";

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: buildFlyerPrompt(todayISO) },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        // omit responseMimeType — some proxy configs reject it for vision requests
        config: { maxOutputTokens: 8192 },
      });
      text = response.text || "";
      if (text) break;
    } catch (err) {
      console.warn(`Flyer extract: model ${model} failed:`, err instanceof Error ? err.message : err);
      lastError = err;
    }
  }

  if (!text) {
    throw lastError instanceof Error ? lastError : new Error("AI service returned an empty response");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    // find the first {...} block in case there's surrounding prose
    const match = cleaned.match(/\{[\s\S]*\}/);
    try {
      parsed = JSON.parse(match ? match[0] : cleaned);
    } catch {
      throw new Error(`AI returned unreadable response: ${text.slice(0, 200)}`);
    }
  }

  const rawEvents = Array.isArray(parsed?.events) ? parsed.events : [];
  const events: ExtractedEvent[] = rawEvents
    .map(normalizeEvent)
    .map((e: ExtractedEvent) => applyDateGuard(e, todayISO));

  let warning: string | null = null;
  if (events.length === 0) {
    warning = "We couldn't find any events on this flyer. Try a clearer photo.";
  } else if (events.some((e) => !e.date)) {
    warning = "Some events are missing dates — you can edit them before saving.";
  } else if (events.some((e) => e.isPastDate)) {
    warning = "Some dates are in the past — double-check them before saving.";
  }

  return {
    imageUrl: normalizedPath,
    events,
    warning,
  };
}
