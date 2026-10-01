// Which `chores.taskType` rows make up a profile's daily checklist.
//
// Deliberately duplicated from @workspace/shared-types' identical helper rather
// than imported, for the same reason lib/groceryMerge.ts is: the api-server
// package does not depend on shared-types, and adding a cross-package
// dependency for one five-element set isn't worth it. If the Inspiration
// sub-types ever change, both copies have to move together — the frontend's
// list lives in lib/shared-types/src/index.ts and the sub-types themselves are
// defined in family-hub's create-task-modal.tsx.
const INSPIRATION_TASK_TYPES = new Set([
  "affirmation",
  "bible_verse",
  "memory_verse",
  "mission",
  "custom",
]);

// True for the rows that decide whether a day is finished — real chores only.
// To-dos have always been excluded and keep their own celebration; Inspiration
// (affirmations, verses, missions) is something to read, not work to get
// through, and counting it meant a family with any Inspiration could never
// finish their day without ticking the day's verse too.
//
// Unknown values fall through as regular, so an unrecognised taskType can never
// silently make a day impossible to finish.
export function isRequiredChoreTaskType(taskType: string | null | undefined): boolean {
  const t = taskType ?? "chore";
  return t !== "todo" && !INSPIRATION_TASK_TYPES.has(t);
}
