export function mealEvents<T extends { slot: string }>(meals: T[], writeToCalendar: boolean): T[] {
  if (!writeToCalendar) return [];
  return meals.filter((meal) => meal.slot === "dinner");
}

export function groceryAlreadyHave(text: string): string | null {
  const match = /\b(?:already have|have|got)\s+(.+?)\.?$/i.exec(text.trim());
  const name = match?.[1]?.trim();
  return name ? name : null;
}
