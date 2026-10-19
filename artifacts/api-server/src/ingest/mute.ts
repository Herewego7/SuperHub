import { storage } from "../storage";
import { KIND_PREFIX, mailKindsOf, MAIL_KINDS, type MailKindId } from "./mailKinds";
import { muteNewsletter, muteSender, openLettersFrom, openMailFrom, slipSender, unmuteNewsletter, unmuteSender, type HouseholdMail } from "./process";

async function householdMail(userId: string): Promise<Required<HouseholdMail>> {
  const settings = await storage.getCalendarSettingsByUser(userId);
  return {
    mutedSenders: settings?.mutedSenders ?? [],
    dismissedSlipKeys: settings?.dismissedSlipKeys ?? [],
    mutedNewsletters: settings?.mutedNewsletters ?? [],
  };
}

type Row = { id: string; title?: string | null; category?: string | null; description?: string | null };

async function removeOpen(userId: string, pick: (chores: Row[], done: ReadonlySet<string>) => string[]): Promise<number> {
  const chores = await storage.getChoresByUser(userId);
  const done = new Set((await storage.getChoreCompletionsByUser(userId)).map((completion) => completion.choreId));
  const ids = pick(chores, done);
  for (const id of ids) await storage.deleteChore(id, userId);
  return ids.length;
}

/** Stop emails from a sender: their future mail is skipped and their open inbox items leave now. Calendar events stay. */
export async function stopSender(userId: string, address: string) {
  const state = await householdMail(userId);
  const settings = await storage.updateCalendarSettings({ mutedSenders: muteSender(state, address).mutedSenders, userId });
  const removed = await removeOpen(userId, (chores, done) => openMailFrom(chores, address, done));
  return { ...settings, removed };
}

/** Undo for Stop emails. Only future mail comes back. */
export async function resumeSender(userId: string, address: string) {
  const state = await householdMail(userId);
  return storage.updateCalendarSettings({ mutedSenders: unmuteSender(state, address).mutedSenders, userId });
}

/** Stop showing one newsletter. To-dos and dates from the sender's mail still come through. */
export async function hideNewsletter(userId: string, address: string, name?: string | null) {
  const state = await householdMail(userId);
  const settings = await storage.updateCalendarSettings({ mutedNewsletters: muteNewsletter(state.mutedNewsletters, address, name), userId });
  const removed = await removeOpen(userId, (chores, done) => openLettersFrom(chores, address, name, done));
  return { ...settings, removed };
}

export async function showNewsletter(userId: string, key: string) {
  const state = await householdMail(userId);
  return storage.updateCalendarSettings({ mutedNewsletters: unmuteNewsletter(state.mutedNewsletters, key), userId });
}

/** Stop a kind of email ("Reviews & surveys") from every sender: future mail is skipped and open items of that kind leave now. */
export async function stopKind(userId: string, kind: string) {
  if (!MAIL_KINDS.some((row) => row.id === kind)) throw new Error(`Unknown kind ${kind}`);
  const state = await householdMail(userId);
  const key = `${KIND_PREFIX}${kind}`;
  const dismissedSlipKeys = state.dismissedSlipKeys.includes(key) ? state.dismissedSlipKeys : [...state.dismissedSlipKeys, key];
  const settings = await storage.updateCalendarSettings({ dismissedSlipKeys, userId });
  const removed = await removeOpen(userId, (chores, done) => chores
    .filter((chore) => chore.category === "school_email" && !done.has(chore.id))
    .filter((chore) => mailKindsOf({ subject: chore.title, text: chore.description, from: slipSender(chore.description) }).includes(kind as MailKindId))
    .map((chore) => chore.id));
  return { ...settings, removed };
}

/** Undo for stopKind. Only future mail comes back. */
export async function resumeKind(userId: string, kind: string) {
  const state = await householdMail(userId);
  const key = `${KIND_PREFIX}${kind}`;
  return storage.updateCalendarSettings({ dismissedSlipKeys: state.dismissedSlipKeys.filter((item) => item !== key), userId });
}
