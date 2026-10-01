// Mirrors the frontend's mergeGroceryQuantities (lib/shared-types) — kept as
// a small local copy here rather than adding a new workspace dependency on
// @workspace/shared-types just for this one function. Used by the "add a
// staple to the active list" route, the one merge decision that happens
// server-side; every other merge (the grocery prompt, manual adds) happens
// client-side against data already in hand.
const UNIT_ALIASES: Record<string, string> = {
  cup: "cup", cups: "cup", c: "cup",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbs: "tbsp", tbsps: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", tsps: "tsp",
  pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
  ounce: "oz", ounces: "oz", oz: "oz",
  gram: "g", grams: "g", g: "g",
  kilogram: "kg", kilograms: "kg", kg: "kg",
  liter: "l", liters: "l", litre: "l", litres: "l", l: "l",
  milliliter: "ml", milliliters: "ml", ml: "ml",
  gallon: "gal", gallons: "gal", gal: "gal",
  quart: "qt", quarts: "qt", qt: "qt",
  pint: "pt", pints: "pt", pt: "pt",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can",
  package: "pkg", packages: "pkg", pkg: "pkg", pkgs: "pkg",
};

function parseQuantity(q: string): { amount: number; unit: string | null } | null {
  const trimmed = q.trim().toLowerCase();
  const m = trimmed.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s*([a-z]+)?$/);
  if (!m) return null;
  let amount: number;
  if (m[1].includes("/")) {
    const [n, d] = m[1].split("/").map(Number);
    amount = d ? n / d : NaN;
  } else {
    amount = parseFloat(m[1]);
  }
  if (Number.isNaN(amount)) return null;
  const rawUnit = m[2];
  const unit = rawUnit ? (UNIT_ALIASES[rawUnit] ?? rawUnit) : null;
  return { amount, unit };
}

function formatQuantity(amount: number, unit: string | null): string {
  const rounded = Math.round(amount * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

export function mergeGroceryQuantities(existing: string | null, incoming: string | null): string | null {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const a = parseQuantity(existing);
  const b = parseQuantity(incoming);
  if (a && b && a.unit === b.unit) {
    return formatQuantity(a.amount + b.amount, a.unit);
  }
  if (existing.trim().toLowerCase() === incoming.trim().toLowerCase()) {
    return `${existing} (x2)`;
  }
  return `${existing} + ${incoming}`;
}
