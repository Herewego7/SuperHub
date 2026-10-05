import { moveDay } from "./chatTools";

function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** The week on screen, plus the next eight weeks, so a dinner planned ahead still lands on the calendar. */
export function dinnerCopyRange(weekStart: string, weekEnd: string, today: Date, weeks = 8): { start: string; end: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  const ahead = dayKey(start);
  const horizon = dayKey(end);
  return {
    start: weekStart < ahead ? weekStart : ahead,
    end: weekEnd > horizon ? weekEnd : horizon,
  };
}

export function mealEvents<T extends { slot: string }>(meals: T[], writeToCalendar: boolean): T[] {
  if (!writeToCalendar) return [];
  return meals.filter((meal) => meal.slot === "dinner");
}

export function groceryHaveReply(name: string, action: GroceryHaveAction | null): string | null {
  if (action) return null;
  const item = name.trim();
  if (!item) return null;
  return `I don't see ${item} on the list.`;
}

export function groceryAlreadyHave(text: string): string | null {
  const match = /^(?:(?:i|we)(?:\s+|['’]ve\s+))?(?:already\s+)?(?:have|got)\s+(.+?)\.?$/i.exec(text.trim());
  const name = match?.[1]?.trim().replace(/^(?:the|some|a|an)\s+/i, "");
  return name ? name : null;
}

export type GroceryHaveAction =
  | { kind: "delete"; id: string }
  | { kind: "check"; id: string }
  | { kind: "have"; name: string };

function sameGrocery(spoken: string, saved: string): boolean {
  const left = spoken.trim().toLowerCase();
  const right = saved.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(" ") || right.includes(" ")) return false;
  const singular = (word: string) => {
    if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
    if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
    return word;
  };
  return singular(left) === singular(right);
}

export function groceryHaveAction(
  name: string,
  persisted: { id: string; name: string }[],
  fromMeals: { name: string }[],
): GroceryHaveAction | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const saved = persisted.find((item) => sameGrocery(key, item.name));
  const meal = fromMeals.find((item) => sameGrocery(key, item.name));
  if (meal && saved) return { kind: "check", id: saved.id };
  if (meal) return { kind: "have", name: meal.name };
  if (saved) return { kind: "delete", id: saved.id };
  return null;
}

/** Names the household already has leave the shopping list. The meal still lists them. */
export function groceryListAfterHave<T extends { name: string }>(
  rows: T[],
  saved: { name: string; alreadyHave?: boolean | null }[],
): T[] {
  const gone = saved.filter((item) => item.alreadyHave).map((item) => item.name);
  if (gone.length === 0) return rows;
  return rows.filter((row) => !gone.some((name) => sameGrocery(name, row.name)));
}

export function dinnerReply(
  text: string,
  meals: Array<{ date: string; slot: string; name: string }>,
  day: Date,
): string | null {
  const asked = text.trim().match(/\bwhat(?:'s| is) for dinner(?:\s+(?:on|for))?\s*(.*?)\??$/i);
  if (!asked) return null;
  const when = asked[1].trim();
  const days = when ? [/^today$/i.test(when) ? day : moveDay(when, day)] : [day, nextDay(day)];
  const named = days[0];
  if (when && !named) return "I don't know that day.";
  for (const date of days) {
    if (!date) continue;
    const name = meals.find((meal) => meal.date === dayKey(date) && meal.slot === "dinner")?.name;
    if (!name) continue;
    if (!when && dayKey(date) !== dayKey(day)) return `Dinner tomorrow. ${name}`;
    return `Dinner. ${name}`;
  }
  return "Nothing planned for dinner.";
}

function nextDay(day: Date): Date {
  const tomorrow = new Date(day);
  tomorrow.setDate(day.getDate() + 1);
  return tomorrow;
}

export type DinnerPick = { date: string; name: string; replaces?: string };

const DINNER_DAY = "today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday";

/** "Plan dinners" or "meals for the week", not "what's for dinner". */
export function wantsDinnerPlan(text: string): boolean {
  return /\b(?:plan|pick|choose)\b[\s\S]{0,48}\b(?:dinners?|meals?)\b/i.test(text)
    || /\b(?:dinners?|meals?) for (?:the|this) week\b/i.test(text)
    || /\bhelp me (?:plan|pick|choose) (?:the )?(?:dinners?|meals?|week)\b/i.test(text);
}

function mealName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:please\s+|let's\s+|lets\s+|we should (?:eat|have|do)\s+|i want\s+|eat\s+|have\s+|do\s+|for\s+|the\s+|dinner\s+|meal\s+)+/i, "")
    .trim();
  if (!name || name.length > 60 || name.split(/\s+/).length > 6) return null;
  if (/\b(?:what|when|who|where|why|how)\b/i.test(name)) return null;
  if (/^(?:plan|pick|choose|week|the week|dinners?|meals?)$/i.test(name)) return null;
  return name;
}

function dayFromWord(word: string, today: Date): Date | null {
  const key = word.toLowerCase();
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (key === "today" || key === "tonight") return at;
  if (key === "tomorrow") {
    at.setDate(at.getDate() + 1);
    return at;
  }
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = names.indexOf(key);
  if (index < 0) return null;
  at.setDate(at.getDate() + ((index - at.getDay() + 7) % 7));
  return at;
}

/**
 * "Let's do tacos on Wednesday" names a dinner to save now.
 * A proposed week ("does this sound good?") does not match.
 */
export function assignedDinners(text: string, today: Date): { date: string; name: string }[] {
  const found = new Map<string, { date: string; name: string }>();
  const re = new RegExp(`\\b(?:let's|lets|let us|add|put)\\s+(.+?)\\s+(?:on|for)\\s+(${DINNER_DAY})\\b`, "gi");
  for (const match of text.matchAll(re)) {
    const name = mealName(match[1] ?? "");
    const day = dayFromWord(match[2] ?? "", today);
    if (!name || !day) continue;
    found.set(dayKey(day), { date: dayKey(day), name });
  }
  return [...found.values()];
}

const PROPOSAL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A suggested week from chat: "Wednesday: Tacos" or "Wed, Oct 7: Tacos".
 * A dinner already saved ("On the meal plan.") is not asked again.
 */
export function proposedDinners(text: string, today: Date): { date: string; name: string }[] {
  if (/^On the meal plan\./i.test(text.trim())) return [];
  const found = new Map<string, { date: string; name: string }>();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const line of text.split("\n")) {
    const dated = line.match(/^\s*(?:[-*•]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}):\s*(.+)$/i);
    const named = line.match(new RegExp(`^\\s*(?:[-*•]\\s*)?(${DINNER_DAY})\\s*:\\s*(.+)$`, "i"));
    const raw = dated?.[4] ?? named?.[2] ?? "";
    const name = mealName(raw.replace(/\s*\(replaces [^)]+\)\s*$/i, ""));
    if (!name) continue;
    if (dated) {
      const month = PROPOSAL_MONTHS.findIndex((item) => item.toLowerCase() === dated[2].toLowerCase());
      const day = Number(dated[3]);
      if (month < 0 || !day) continue;
      let year = current.getFullYear();
      const stamp = new Date(year, month, day);
      if (stamp.getTime() < current.getTime() - 2 * 86400000) year += 1;
      const date = dayKey(new Date(year, month, day));
      found.set(date, { date, name });
      continue;
    }
    const day = dayFromWord(named?.[1] ?? "", current);
    if (!day) continue;
    const date = dayKey(day);
    found.set(date, { date, name });
  }
  const asking = /Reply yes to put these on the meal plan/i.test(text);
  const suggesting = /\b(meal plan|dinners|menu|dinner ideas)\b/i.test(text);
  if (asking && found.size > 0) return [...found.values()];
  if (suggesting && found.size >= 2) return [...found.values()];
  return [];
}

/** "Tacos tonight and pasta tomorrow", or "Monday tacos, Wednesday soup". */
export function statedDinners(text: string, today: Date): { date: string; name: string }[] {
  const found = new Map<string, { date: string; name: string }>();
  for (const chunk of text.split(/\s*(?:,|\band\b)\s*/i)) {
    const lead = chunk.match(new RegExp(`(?:^|\\b)(${DINNER_DAY})\\s+(?:is\\s+|as\\s+|:\\s*)?(.+)$`, "i"));
    const trail = chunk.match(new RegExp(`^(.+?)\\s+(?:on\\s+|for\\s+)?(${DINNER_DAY})\\s*$`, "i"));
    const word = lead?.[1] || trail?.[2];
    const raw = lead?.[2] || trail?.[1];
    if (!word || !raw) continue;
    const day = dayFromWord(word, today);
    const name = mealName(raw);
    if (!day || !name) continue;
    const date = dayKey(day);
    found.set(date, { date, name });
  }
  return [...found.values()];
}

/** Open nights this week, one saved meal each, without repeating a recipe. */
export function dinnersFromSaved(
  saved: { id: string; name: string }[],
  existing: { date: string; slot?: string | null }[],
  today: Date,
): DinnerPick[] {
  const open: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const date = dayKey(day);
    if (existing.some((meal) => meal.date === date && (meal.slot === "dinner" || !meal.slot))) continue;
    open.push(date);
  }
  return open.slice(0, saved.length).map((date, index) => ({ date, name: saved[index].name }));
}

export function withSavedMeals(
  picks: { date: string; name: string }[],
  saved: { name: string }[],
  existing: { date: string; slot?: string | null; name: string }[],
): DinnerPick[] {
  return picks.map((pick) => {
    const idea = saved.find((meal) => meal.name.trim().toLowerCase() === pick.name.trim().toLowerCase());
    const current = existing.find((meal) => meal.date === pick.date && (meal.slot === "dinner" || !meal.slot));
    const name = idea?.name ?? pick.name;
    const replaces = current && current.name.trim().toLowerCase() !== name.trim().toLowerCase() ? current.name : undefined;
    return { date: pick.date, name, replaces };
  });
}

export function dinnerPlanReply(picks: DinnerPick[]): string {
  const lines = picks.map((pick) => {
    const [year, month, day] = pick.date.split("-").map(Number);
    const label = new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return pick.replaces ? `${label}: ${pick.name} (replaces ${pick.replaces})` : `${label}: ${pick.name}`;
  });
  return `${lines.join("\n")}\nReply yes to put these on the meal plan.`;
}

export const GROCERY_PROMPT_KEY = "superhub_grocery_prompt_queue";

export type GroceryPromptMeal = {
  id: string;
  name: string;
  date?: string;
  slot?: string;
  ingredients: { id: string; item: string; quantity?: string | null }[];
};

export function queueGroceryPrompts(meals: GroceryPromptMeal[]) {
  if (typeof sessionStorage === "undefined") return;
  const next = meals.filter((meal) => meal.ingredients.length > 0);
  if (next.length === 0) return;
  const current = readGroceryQueue();
  sessionStorage.setItem(GROCERY_PROMPT_KEY, JSON.stringify([...current, ...next]));
}

export function peekGroceryPrompt(): GroceryPromptMeal | null {
  if (typeof sessionStorage === "undefined") return null;
  return readGroceryQueue()[0] ?? null;
}

export function dismissGroceryPrompt() {
  if (typeof sessionStorage === "undefined") return;
  const [, ...rest] = readGroceryQueue();
  if (rest.length > 0) sessionStorage.setItem(GROCERY_PROMPT_KEY, JSON.stringify(rest));
  else sessionStorage.removeItem(GROCERY_PROMPT_KEY);
}

function readGroceryQueue(): GroceryPromptMeal[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(GROCERY_PROMPT_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((meal): meal is GroceryPromptMeal => !!meal && typeof meal === "object" && typeof (meal as GroceryPromptMeal).id === "string" && Array.isArray((meal as GroceryPromptMeal).ingredients));
  } catch {
    return [];
  }
}
