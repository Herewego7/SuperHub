/**
 * Bot Life's mail and plan checks, kept as plain functions so a model reply
 * can be rejected when it invents a time or files the wrong grade.
 */

const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi;
const DAY = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi;

const GRADE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(pre-?k|tk|transitional kindergarten)\b/i, "prek"],
  [/\bkindergarten(ers)?\b|\bkinder\b/i, "k"],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n): [RegExp, string] => {
    const ord = n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
    return [new RegExp(`\\b(${ord}[ -]grade(rs)?|grade ${n}\\b)`, "i"), String(n)];
  }),
];

export function shouldRead(triage: { familyRelated: boolean; needsFullRead: boolean; confidence: number }, boosted: boolean): boolean {
  if (triage.familyRelated || triage.needsFullRead) return true;
  return triage.confidence < (boosted ? 0.9 : 0.7);
}

export function gradesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const [pattern, grade] of GRADE_PATTERNS) if (pattern.test(text)) found.add(grade);
  return found;
}

/** An item aimed only at grades this family does not have. */
export function forOtherGrades(text: string, familyGrades: Set<string>): boolean {
  const mentioned = gradesIn(text);
  if (mentioned.size === 0 || familyGrades.size === 0) return false;
  return ![...mentioned].some((grade) => familyGrades.has(grade));
}

export function familyGrades(people: { facts?: string[] | null; school?: string | null; name?: string | null }[]): Set<string> {
  const grades = new Set<string>();
  for (const person of people) {
    for (const grade of gradesIn(`${person.school ?? ""} ${(person.facts ?? []).join(" ")}`)) grades.add(grade);
  }
  return grades;
}

export function chunkText(text: string, max = 8000): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length && chunks.length < 3; i += max) chunks.push(clean.slice(i, i + max));
  return chunks;
}

export function titleSimilarity(a: string, b: string): number {
  const tokens = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function duplicateBand(score: number): "same" | "ask" | "new" {
  if (score >= 0.8) return "same";
  if (score >= 0.45) return "ask";
  return "new";
}

function marks(pattern: RegExp, text: string): Set<string> {
  return new Set((text.match(pattern) ?? []).map((item) => item.toLowerCase().replace(/\s+/g, "")));
}

/** A rewritten plan line may not introduce a time or weekday the source did not have. */
export function planLinesStayHonest(source: string, lines: string[]): boolean {
  if (lines.length === 0 || lines.length > 6) return false;
  const times = marks(TIME, source);
  const days = marks(DAY, source);
  for (const line of lines) {
    for (const time of marks(TIME, line)) if (!times.has(time)) return false;
    for (const day of marks(DAY, line)) if (!days.has(day)) return false;
    if (line.trim().length > 160) return false;
  }
  return true;
}

export function searchHits(rows: { title: string; text: string; kind: string }[], query: string): { title: string; text: string; kind: string }[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (words.length === 0) return [];
  return rows
    .map((row) => {
      const hay = `${row.title} ${row.text}`.toLowerCase();
      const score = words.reduce((sum, word) => sum + (hay.includes(word) ? 1 : 0), 0);
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row);
}

export function mapsUrl(place: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(place.trim())}`;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  if (left === 0 || right === 0) return 0;
  return dot / Math.sqrt(left * right);
}
