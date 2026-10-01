/** What Home shows for one day. A shared to-do is one chore row, however many people are on it. */

export type HomeTodo = {
  id: string;
  taskType: string;
  profileIds: string[];
  isActive?: boolean | null;
};

export function visibleForProfiles<T extends { profileIds?: string[] | null }>(rows: T[], selectedIds: string[]): T[] {
  if (selectedIds.length === 0) return rows;
  return rows.filter((row) => {
    const ids = row.profileIds ?? [];
    if (ids.length === 0) return true;
    return ids.some((id) => selectedIds.includes(id));
  });
}

export function todosForHome<T extends HomeTodo>(chores: T[], selectedIds: string[], familyIds: string[]): T[] {
  const todos = chores.filter((chore) => chore.taskType === "todo" && chore.isActive !== false);
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  const pool = allSelected
    ? todos.filter((todo) => todo.profileIds.length !== 1)
    : todos.filter((todo) => todo.profileIds.length === 0 || todo.profileIds.some((id) => selectedIds.includes(id)));
  const seen = new Set<string>();
  return pool.filter((todo) => {
    if (seen.has(todo.id)) return false;
    seen.add(todo.id);
    return true;
  });
}

const NOT_A_CHORE = new Set(["todo", "memory_verse", "affirmation", "bible_verse", "mission", "custom"]);

/** All Family counts the household. One person counts only their chores. */
export function choresForCount<T extends { profileIds: string[] }>(chores: T[], selectedIds: string[], familyIds: string[]): T[] {
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  if (selectedIds.length === 0 || allSelected) return chores;
  return chores.filter((chore) => chore.profileIds.length === 0 || chore.profileIds.some((id) => selectedIds.includes(id)));
}

export function choreProgress(
  chores: Array<HomeTodo & { daysOfWeek?: number[]; recurrenceType?: string | null; targetCount?: number | null; endDate?: Date | string | null }>,
  completions: Array<{ choreId: string; completedAt?: Date | string | null }>,
  day: Date,
): { done: number; total: number } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const due = chores.filter((chore) => {
    if (chore.isActive === false) return false;
    if (NOT_A_CHORE.has(chore.taskType)) return false;
    if (chore.targetCount && chore.targetCount > 0) return false;
    if (chore.endDate && new Date(chore.endDate) < start) return false;
    if (chore.recurrenceType === "daily") return true;
    return (chore.daysOfWeek ?? []).includes(start.getDay());
  });
  const doneIds = new Set(
    completions
      .filter((completion) => {
        if (!completion.completedAt) return false;
        const at = new Date(completion.completedAt);
        return at >= start && at < end;
      })
      .map((completion) => completion.choreId),
  );
  return { done: due.filter((chore) => doneIds.has(chore.id)).length, total: due.length };
}

export type HorizonEvent = {
  id: string;
  title: string;
  startTime: Date | string;
  recurrenceType?: string | null;
};

export function horizonEvents<T extends HorizonEvent>(events: T[], day: Date): T[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const from = new Date(start);
  from.setDate(from.getDate() + 1);
  const until = new Date(start);
  until.setDate(until.getDate() + 8);
  return events.filter((event) => {
    if (event.recurrenceType === "daily" || event.recurrenceType === "weekly") return false;
    const at = new Date(event.startTime);
    return at >= from && at < until;
  });
}

/** A kid's list hides school mail that does not name them. Everyone else sees it. */
export function mailVisibleToKid(
  row: { title: string; description?: string | null; category?: string | null; source?: string | null },
  kidName: string | null,
): boolean {
  if (!kidName) return true;
  if (row.category !== "school_email" && row.source !== "school") return true;
  return schoolEmailNames({ title: row.title, description: row.description, category: "school_email" }, kidName);
}

export function schoolEmailNames(
  todo: { title: string; description?: string | null; category?: string | null },
  kidName: string,
): boolean {
  if (todo.category !== "school_email") return true;
  const name = kidName.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(`${todo.title}\n${todo.description ?? ""}`);
}

export function dinnerName(meals: Array<{ date: string; slot: string; name: string }>, day: Date): string | null {
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return meals.find((meal) => meal.date === key && meal.slot === "dinner")?.name ?? null;
}
