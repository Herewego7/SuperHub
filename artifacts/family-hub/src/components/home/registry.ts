import type { LucideIcon } from "lucide-react";
import { Calendar, CalendarPlus, Car, ListTodo, MessageSquareHeart, Newspaper, Telescope } from "lucide-react";

/**
 * Every card Home can show, in its default order. The day header, medication
 * reminders and the inbox-scan banner are pinned above these and are not cards.
 * Chores (a link to the Chores tab) and Completed Actions (a long list of what
 * was done) left on 2026-10-22: finished to-dos sit under To-Dos' Done, and
 * praise and notes have their own card that shows only when there are some.
 */
export const HOME_CARDS = [
  { id: "todos", name: "To-Dos", icon: ListTodo },
  { id: "keyDates", name: "Key Dates to Add", icon: CalendarPlus },
  { id: "newsletters", name: "School Newsletters", icon: Newspaper },
  { id: "schedule", name: "Today's Schedule", icon: Calendar },
  { id: "driving", name: "Driving", icon: Car },
  { id: "horizon", name: "On the Horizon", icon: Telescope },
  { id: "notes", name: "Notes & Praise", icon: MessageSquareHeart },
] as const satisfies readonly { id: string; name: string; icon: LucideIcon }[];

export type HomeCardId = (typeof HOME_CARDS)[number]["id"];

export interface CardConfig {
  id: HomeCardId;
  name: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_CARD_CONFIG: CardConfig[] = HOME_CARDS.map((card, order) => ({ id: card.id, name: card.name, visible: true, order }));

const CARDS_KEY = "superhub_homeCards_v1";
const COLLAPSED_KEY = "superhub_homeCollapsed_v1";

export function cardIcon(id: HomeCardId): LucideIcon {
  return HOME_CARDS.find((card) => card.id === id)?.icon ?? ListTodo;
}

/** This device's card order and on/off, with any card added since appended in its default spot's order. */
export function getCardSettings(): CardConfig[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CARDS_KEY) || "null");
    if (!Array.isArray(parsed)) return DEFAULT_CARD_CONFIG;
    const defaults = new Map(DEFAULT_CARD_CONFIG.map((card) => [card.id as string, card]));
    const kept = (parsed as Partial<CardConfig>[])
      .filter((card) => typeof card?.id === "string" && defaults.has(card.id) && typeof card.visible === "boolean" && typeof card.order === "number")
      .sort((a, b) => a.order! - b.order!)
      .map((card) => ({ ...defaults.get(card.id!)!, visible: card.visible! }));
    const seen = new Set(kept.map((card) => card.id));
    const merged = [...kept, ...DEFAULT_CARD_CONFIG.filter((card) => !seen.has(card.id))];
    return merged.map((card, order) => ({ ...card, order }));
  } catch {
    return DEFAULT_CARD_CONFIG;
  }
}

export function saveCardSettings(settings: CardConfig[]): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(settings.map(({ id, visible, order }) => ({ id, visible, order }))));
  } catch {
    /* private mode: the layout lasts until the app closes */
  }
}

export function readCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode */
  }
}
