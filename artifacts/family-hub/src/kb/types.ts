/**
 * Knowledge base article shape.
 *
 * Articles live in code (`src/kb/articles/*.ts`), not a database — this is
 * what lets the KB open and search with no network at all, which matters
 * because a lot of what people search for ("why isn't this syncing") is
 * exactly the situation where a database-backed help center would be
 * showing a spinner instead of an answer. Editing an article means editing
 * its file and shipping a normal deploy — no admin panel, no login roles,
 * no rich-text field to sanitize.
 *
 * See artifacts/family-hub/KB_PLAN.md for the full reasoning.
 */

export type KbCategory =
  | "getting-started"
  | "family-and-profiles"
  | "calendar"
  | "calendar-sync"
  | "chores-and-tasks"
  | "stars-and-rewards"
  | "streaks-and-achievements"
  | "meals-and-groceries"
  | "notes-and-health"
  | "notifications"
  | "parent-controls"
  | "settings"
  | "sharing-and-account"
  | "privacy-and-kids"
  | "mobile-app"
  | "troubleshooting";

export const KB_CATEGORY_LABELS: Record<KbCategory, string> = {
  "getting-started": "Getting Started",
  "family-and-profiles": "Family & Profiles",
  calendar: "Calendar",
  "calendar-sync": "Calendar Sync",
  "chores-and-tasks": "Chores & Tasks",
  "stars-and-rewards": "Stars & Rewards",
  "streaks-and-achievements": "Streaks & Achievements",
  "meals-and-groceries": "Meals & Groceries",
  "notes-and-health": "Notes & Health Reminders",
  notifications: "Notifications",
  "parent-controls": "Parent Controls & PIN",
  settings: "Settings & Customization",
  "sharing-and-account": "Sharing & Account",
  "privacy-and-kids": "Privacy & Kids",
  "mobile-app": "Mobile App",
  troubleshooting: "Troubleshooting",
};

/**
 * - how-to: "where do I click" — a walkthrough of a specific action.
 * - guidance: "what should I do" — an opinion/recommendation where the UI
 *   itself offers no answer (e.g. how many stars a chore should be worth).
 * - concept: "how does this work" — explains a system, no specific task.
 * - troubleshooting: "why is this broken" — titled the way a frustrated
 *   person would describe the symptom, not the underlying mechanism.
 */
export type KbArticleType = "how-to" | "guidance" | "concept" | "troubleshooting";

export type KbBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }
  | { kind: "path"; path: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "faq"; items: { q: string; a: string }[] };

export interface KbArticle {
  /** Stable slug — used as the URL fragment and the React key. Never reuse
      an id for a different article once published; broken deep links are
      worse than a 404. */
  id: string;
  title: string;
  category: KbCategory;
  type: KbArticleType;
  /** One sentence, shown under the title in search results. */
  summary: string;
  /**
   * Free-form search vocabulary — put anything here. Feature names, what
   * users call it instead of what we call it, symptom phrasings ("stars
   * didn't add up"), common misspellings. This is the single lever that
   * makes an article findable by someone who doesn't know the app's own
   * terminology; search weights this field (and the title) well above the
   * article body.
   */
  tags: string[];
  blocks: KbBlock[];
  /** Ids of other articles to surface as "related" at the bottom. */
  related?: string[];
  /** ISO date (YYYY-MM-DD), shown at the article's foot. Bump when the
      content changes meaningfully — not on every trivial wording tweak. */
  updatedAt: string;
}
