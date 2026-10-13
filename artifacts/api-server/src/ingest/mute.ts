import { storage } from "../storage";
import { muteNewsletter, muteSender, openLettersFrom, openMailFrom, unmuteNewsletter, unmuteSender, type HouseholdMail } from "./process";

async function householdMail(userId: string): Promise<Required<HouseholdMail>> {
  const settings = await storage.getCalendarSettingsByUser(userId);
  return {
    mutedSenders: settings?.mutedSenders ?? [],
    dismissedSlipKeys: settings?.dismissedSlipKeys ?? [],
    mutedNewsletters: settings?.mutedNewsletters ?? [],
  };
}

type Row = { id: string; category?: string | null; description?: string | null };

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
