import { BROWSE_IDEAS, type BrowseIdea } from "./browseCatalog";

export type MealIngredient = { item: string; quantity: string | null };

export type MatchedMeal = { name: string; source: "saved" | "ideas"; ingredients: MealIngredient[] };

/** "1.5 lb ground beef" becomes a quantity and an item. A bare "Tortillas" stays one item. */
export function splitIngredient(text: string): MealIngredient {
  const match = text.match(/^([\d.\/\s]+(?:tbsp|tsp|cup|cups|lb|lbs|oz|can|cans|bunch|head|heads|slices?|cloves?)?\.?)\s+(.+)$/i);
  if (match && match[1].trim()) return { quantity: match[1].trim(), item: match[2].trim() };
  return { quantity: null, item: text.trim() };
}

function ideaIngredients(idea: BrowseIdea): MealIngredient[] {
  return idea.ingredients.map(splitIngredient).filter((row) => row.item);
}

function sameName(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const singular = (word: string) => {
    if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
    if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
    return word;
  };
  if (a.includes(" ") || b.includes(" ")) return false;
  return singular(a) === singular(b);
}

/** Saved meals win. A Browse Meal Ideas name matches exactly, or when only one idea contains it. */
export function matchMeal(
  spoken: string,
  saved: { name: string; ingredients?: MealIngredient[] }[] = [],
): MatchedMeal | null {
  const key = spoken.trim().toLowerCase();
  if (!key) return null;
  const savedExact = saved.find((meal) => meal.name.trim().toLowerCase() === key);
  if (savedExact) return { name: savedExact.name, source: "saved", ingredients: savedExact.ingredients ?? [] };
  const ideaExact = BROWSE_IDEAS.find((idea) => idea.name.trim().toLowerCase() === key);
  if (ideaExact) return { name: ideaExact.name, source: "ideas", ingredients: ideaIngredients(ideaExact) };
  const savedPartial = saved.filter((meal) => {
    const name = meal.name.trim().toLowerCase();
    return name.includes(key) || key.includes(name);
  });
  if (savedPartial.length === 1) return { name: savedPartial[0].name, source: "saved", ingredients: savedPartial[0].ingredients ?? [] };
  const ideaPartial = BROWSE_IDEAS.filter((idea) => {
    const name = idea.name.trim().toLowerCase();
    return name.includes(key) || key.includes(name);
  });
  if (ideaPartial.length === 1) return { name: ideaPartial[0].name, source: "ideas", ingredients: ideaIngredients(ideaPartial[0]) };
  return null;
}

export function dinnerIdeaNames(): string {
  return BROWSE_IDEAS.filter((idea) => idea.mealType === "dinner").map((idea) => idea.name).join(", ");
}

/** Ingredients that are not already on the grocery list. */
export function groceriesToAdd(
  ingredients: { item: string; quantity?: string | null }[],
  existing: { name: string }[],
): { name: string; quantity: string | null }[] {
  const blocked = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  const added: { name: string; quantity: string | null }[] = [];
  for (const row of ingredients) {
    const name = row.item.trim();
    const key = name.toLowerCase();
    if (!name || blocked.has(key) || existing.some((item) => sameName(item.name, name))) continue;
    blocked.add(key);
    added.push({ name, quantity: row.quantity ?? null });
  }
  return added;
}

export function groceryAddedLine(names: string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, 8);
  const more = names.length - shown.length;
  return more > 0
    ? `Added to the grocery list: ${shown.join(", ")}, and ${more} more.`
    : `Added to the grocery list: ${shown.join(", ")}.`;
}

export type GroceryRequest =
  | { kind: "list" }
  | { kind: "add"; items: { name: string; quantity: string | null }[] }
  | { kind: "remove"; names: string[] }
  | { kind: "check"; names: string[]; checked: boolean }
  | { kind: "ingredients"; meal: string };

function cleanItem(raw: string): string {
  return raw.replace(/^(?:the|some|a|an)\s+/i, "").replace(/[.!?]+$/g, "").trim();
}

function itemList(raw: string): { name: string; quantity: string | null }[] {
  return raw.split(/\s*(?:,|\band\b)\s*/i).flatMap((part) => {
    const text = cleanItem(part);
    if (!text || text.length > 80) return [];
    const split = splitIngredient(text);
    return split.item ? [{ name: split.item, quantity: split.quantity }] : [];
  });
}

/** A direct grocery sentence. Dinner plans ("tacos on Wednesday") do not match. */
export function groceryRequest(text: string): GroceryRequest | null {
  const said = text.trim();
  if (/what(?:'s| is) on (?:the )?(?:grocery|shopping) list\b/i.test(said) || /^(?:show|read|open) (?:me )?(?:the )?(?:grocery|shopping) list\b/i.test(said)) {
    return { kind: "list" };
  }
  const ingredients = said.match(/^(?:please\s+)?add (?:the )?ingredients for (.+?) (?:on|to) (?:the )?(?:grocery|shopping) list\b/i);
  if (ingredients?.[1]) return { kind: "ingredients", meal: cleanItem(ingredients[1]) };
  const add = said.match(/^(?:please\s+)?(?:add|put) (.+?) (?:on|to) (?:the )?(?:grocery|shopping) list\b/i);
  if (add?.[1]) {
    const items = itemList(add[1]);
    return items.length > 0 ? { kind: "add", items } : null;
  }
  const remove = said.match(/^(?:please\s+)?(?:remove|delete|take) (.+?) (?:off|from) (?:the )?(?:grocery|shopping) list\b/i);
  if (remove?.[1]) {
    const names = itemList(remove[1]).map((item) => item.name);
    return names.length > 0 ? { kind: "remove", names } : null;
  }
  const check = said.match(/^(?:please\s+)?(?:check off|mark off|uncheck) (.+?)(?: (?:on|off|from) (?:the )?(?:grocery|shopping) list)?[.!]?$/i);
  if (check?.[1] && /\b(?:grocery|shopping) list\b/i.test(said)) {
    const names = itemList(check[1]).map((item) => item.name);
    if (names.length === 0) return null;
    return { kind: "check", names, checked: !/^uncheck/i.test(said.trim()) };
  }
  return null;
}

export function findGrocery<T extends { name: string }>(items: T[], spoken: string): T | undefined {
  const exact = items.find((item) => item.name.trim().toLowerCase() === spoken.trim().toLowerCase());
  if (exact) return exact;
  const partial = items.filter((item) => sameName(item.name, spoken));
  return partial.length === 1 ? partial[0] : undefined;
}

export function groceryListText(items: { name: string; quantity?: string | null; isChecked?: boolean | null; alreadyHave?: boolean | null }[]): string {
  const rows = items.filter((item) => !item.alreadyHave);
  if (rows.length === 0) return "The grocery list is empty.";
  const lines = rows.slice(0, 40).map((item) => {
    const quantity = item.quantity ? ` (${item.quantity})` : "";
    const checked = item.isChecked ? " (checked)" : "";
    return `- ${item.name}${quantity}${checked}`;
  });
  const more = rows.length > 40 ? `\nAnd ${rows.length - 40} more.` : "";
  return `On the grocery list:\n${lines.join("\n")}${more}`;
}
