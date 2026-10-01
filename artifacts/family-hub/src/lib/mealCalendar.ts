export function mealEvents<T extends { slot: string }>(meals: T[], writeToCalendar: boolean): T[] {
  if (!writeToCalendar) return [];
  return meals.filter((meal) => meal.slot === "dinner");
}

export function groceryAlreadyHave(text: string): string | null {
  const match = /\b(?:already have|have|got)\s+(.+?)\.?$/i.exec(text.trim());
  const name = match?.[1]?.trim();
  return name ? name : null;
}

function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function dinnerReply(
  text: string,
  meals: Array<{ date: string; slot: string; name: string }>,
  day: Date,
): string | null {
  if (!/\bwhat(?:'s| is) for dinner\b/i.test(text.trim())) return null;
  const tomorrow = new Date(day);
  tomorrow.setDate(day.getDate() + 1);
  const name = [day, tomorrow]
    .map((date) => meals.find((meal) => meal.date === dayKey(date) && meal.slot === "dinner")?.name)
    .find((found) => found);
  return name ? `Dinner. ${name}` : "Nothing planned for dinner.";
}
