/** Tabs on the bottom bar, in display order. To-Dos is not one of them. */
export const BOTTOM_NAV_IDS = ["home", "calendar", "chores", "meals", "chat"] as const;

export type BottomNavId = (typeof BOTTOM_NAV_IDS)[number];
