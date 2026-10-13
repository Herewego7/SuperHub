const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY = `${DAYS.join("|")}|today|tonight|tomorrow`;
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type MealSlot = "breakfast" | "lunch" | "dinner";
/** A meal to write. No slot means dinner, the slot chat has always filled. */
export type DinnerNight = { date: string; name: string; slot?: MealSlot };

const SLOT_WORD = "breakfast|brunch|lunch|dinner|supper";

function slotOf(word: string): MealSlot {
  const key = word.toLowerCase();
  if (key === "breakfast" || key === "brunch") return "breakfast";
  if (key === "lunch") return "lunch";
  return "dinner";
}

function slotLabel(slot: MealSlot | undefined): string {
  const key = slot ?? "dinner";
  return key[0].toUpperCase() + key.slice(1);
}

/**
 * "Add eggs for breakfast" is the meal "Eggs" at breakfast. The verb and the
 * slot are instructions, not part of the meal's name. Matches the app's
 * mealRequest in family-hub/src/lib/mealCalendar.ts.
 */
export function mealRequest(raw: string): { name: string; slot?: MealSlot } | null {
  let text = raw.trim().replace(/[.!?]+$/g, "");
  let slot: MealSlot | undefined;
  const slotted = text.match(new RegExp(`\\b(?:for|at|to|as)\\s+(?:the\\s+)?(${SLOT_WORD})\\b`, "i"))
    ?? text.match(new RegExp(`^(${SLOT_WORD})\\s*(?::|is|will be|-)\\s*`, "i"));
  if (slotted) {
    slot = slotOf(slotted[1]);
    text = text.replace(slotted[0], " ");
  }
  const name = text
    .replace(/\b(?:to|on|onto|into)\s+(?:the\s+)?(?:meal\s+plan|meals?(?:\s+tab)?|menu|calendar)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:can you\s+|could you\s+|please\s+)*(?:add|put|schedule|plan|make|cook|set)\s+/i, "")
    .replace(/^(?:do|eat|have|make|the|a|some)\s+/i, "")
    .replace(/\s+(?:for|on|at|to)$/i, "")
    .trim();
  if (!name || name.length > 60 || name.split(/\s+/).length > 6) return null;
  if (/\b(?:what|when|who|where|why|how)\b/i.test(name)) return null;
  const titled = name[0].toUpperCase() + name.slice(1);
  return slot && slot !== "dinner" ? { name: titled, slot } : { name: titled };
}

/** A whole-message yes to the meal list. "Yes, but change Friday" is not one. */
export function acceptedMealPlan(text: string): boolean {
  return /^\s*(yes|yep|yeah|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|please do|sounds good|correct|that's right)(?:\s+please)?[.!]?$/i.test(text.trim());
}

function familyDay(now: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = SHORT_DAYS.indexOf(value("weekday"));
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  if (!year || !month || !day || weekday < 0) return null;
  return { year, month, day, weekday };
}

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function dinnerName(raw: string): string | null {
  const name = raw.replace(/\s*\(replaces [^)]+\)\s*$/i, "").replace(/[.!?]+$/g, "").trim();
  if (!name || name.length > 80 || name.split(/\s+/).length > 8) return null;
  if (/\b(?:what|when|who|where|why|how)\b/i.test(name)) return null;
  return name;
}

/**
 * "Let's do tacos on Wednesday" names a dinner to save now.
 * A proposed week does not match. The day is the family's, not the server's.
 */
export function assignedDinners(text: string, now: Date, timeZone: string): DinnerNight[] {
  const today = familyDay(now, timeZone);
  if (!today) return [];
  const { year, month, day, weekday } = today;
  const found = new Map<string, DinnerNight>();
  const re = new RegExp(`\\b(?:let's|lets|let us|add|put)\\s+(.+?)\\s+(?:on|for)\\s+(${DAY})\\b`, "gi");
  for (const match of text.matchAll(re)) {
    const meal = mealRequest(match[1] ?? "");
    if (!meal) continue;
    const word = (match[2] ?? "").toLowerCase();
    let offset = 0;
    if (word === "tomorrow") offset = 1;
    else if (word !== "today" && word !== "tonight") {
      const index = DAYS.indexOf(word);
      if (index < 0) continue;
      offset = (index - weekday + 7) % 7;
    }
    const date = iso(year, month, day + offset);
    found.set(`${date}|${meal.slot ?? "dinner"}`, { date, ...meal });
  }
  return [...found.values()];
}

/**
 * A suggested week: "Wednesday: Tacos" or the confirmation "Wed, Oct 7: Tacos".
 * "On the meal plan." is a dinner already saved, so it is not asked again.
 */
export function proposedDinners(text: string, now: Date, timeZone: string): DinnerNight[] {
  if (/^On the meal plan\./i.test(text.trim())) return [];
  const today = familyDay(now, timeZone);
  if (!today) return [];
  const found = new Map<string, DinnerNight>();
  for (const line of text.split("\n")) {
    const dated = line.match(/^\s*(?:[-*•]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+·\s+(Breakfast|Lunch|Dinner))?:\s*(.+)$/i);
    const named = line.match(new RegExp(`^\\s*(?:[-*•]\\s*)?(${DAYS.join("|")})\\s*:\\s*(.+)$`, "i"));
    const name = dinnerName(dated?.[5] ?? named?.[2] ?? "");
    if (!name) continue;
    const slot = dated?.[4] ? slotOf(dated[4]) : "dinner";
    const pick = (date: string): DinnerNight => (slot === "dinner" ? { date, name } : { date, name, slot });
    if (dated) {
      const month = MONTHS.findIndex((item) => item.toLowerCase() === dated[2].toLowerCase()) + 1;
      const day = Number(dated[3]);
      if (!month || !day) continue;
      let year = today.year;
      const stamp = Date.UTC(year, month - 1, day);
      const current = Date.UTC(today.year, today.month - 1, today.day);
      if (stamp < current - 2 * 86400000) year += 1;
      const date = iso(year, month, day);
      found.set(`${date}|${slot}`, pick(date));
      continue;
    }
    const index = DAYS.indexOf((named?.[1] ?? "").toLowerCase());
    if (index < 0) continue;
    const date = iso(today.year, today.month, today.day + ((index - today.weekday + 7) % 7));
    found.set(`${date}|${slot}`, pick(date));
  }
  const asking = /Reply yes to put (?:these|it) on the meal plan/i.test(text);
  const suggesting = /\b(meal plan|dinners|menu|dinner ideas)\b/i.test(text);
  if (asking && found.size > 0) return [...found.values()];
  if (suggesting && found.size >= 2) return [...found.values()];
  return [];
}

/** The line the person has to answer before those nights are written. */
export function dinnerConfirmText(dinners: DinnerNight[]): string {
  const lines = dinners.map((dinner) => {
    const [year, month, day] = dinner.date.split("-").map(Number);
    const label = `${SHORT_DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${MONTHS[month - 1]} ${day} · ${slotLabel(dinner.slot)}`;
    return `${label}: ${dinner.name}`;
  });
  return `${lines.join("\n")}\nReply yes to put ${dinners.length === 1 ? "it" : "these"} on the meal plan.`;
}
