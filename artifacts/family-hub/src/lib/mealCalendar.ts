import { moveDay } from "./chatTools";

export function mealEvents<T extends { slot: string }>(meals: T[], writeToCalendar: boolean): T[] {
  if (!writeToCalendar) return [];
  return meals.filter((meal) => meal.slot === "dinner");
}

export function groceryAlreadyHave(text: string): string | null {
  const match = /^(?:(?:i|we)\s+)?(?:already have|have|got)\s+(.+?)\.?$/i.exec(text.trim());
  const name = match?.[1]?.trim();
  return name ? name : null;
}

export type GroceryHaveAction =
  | { kind: "delete"; id: string }
  | { kind: "check"; id: string }
  | { kind: "have"; name: string };

export function groceryHaveAction(
  name: string,
  persisted: { id: string; name: string }[],
  fromMeals: { name: string }[],
): GroceryHaveAction | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const saved = persisted.find((item) => item.name.trim().toLowerCase() === key);
  const meal = fromMeals.find((item) => item.name.trim().toLowerCase() === key);
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
  const gone = new Set(
    saved.filter((item) => item.alreadyHave).map((item) => item.name.trim().toLowerCase()),
  );
  if (gone.size === 0) return rows;
  return rows.filter((row) => !gone.has(row.name.trim().toLowerCase()));
}

function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
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
  const name = days
    .filter((date): date is Date => !!date)
    .map((date) => meals.find((meal) => meal.date === dayKey(date) && meal.slot === "dinner")?.name)
    .find((found) => found);
  return name ? `Dinner. ${name}` : "Nothing planned for dinner.";
}

function nextDay(day: Date): Date {
  const tomorrow = new Date(day);
  tomorrow.setDate(day.getDate() + 1);
  return tomorrow;
}
