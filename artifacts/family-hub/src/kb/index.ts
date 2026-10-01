import type { KbArticle } from "./types";
import { gettingStartedArticles } from "./articles/getting-started";
import { starsAndRewardsArticles } from "./articles/stars-and-rewards";
import { parentControlsArticles } from "./articles/parent-controls";
import { choresAndTasksArticles } from "./articles/chores-and-tasks";
import { streaksAndAchievementsArticles } from "./articles/streaks-and-achievements";
import { notificationsArticles } from "./articles/notifications";
import { calendarSyncArticles } from "./articles/calendar-sync";
import { troubleshootingArticles } from "./articles/troubleshooting";
import { privacyAndKidsArticles } from "./articles/privacy-and-kids";
import { settingsAndAccountArticles } from "./articles/settings-and-account";

export const KB_ARTICLES: KbArticle[] = [
  ...gettingStartedArticles,
  ...starsAndRewardsArticles,
  ...parentControlsArticles,
  ...choresAndTasksArticles,
  ...streaksAndAchievementsArticles,
  ...notificationsArticles,
  ...calendarSyncArticles,
  ...troubleshootingArticles,
  ...privacyAndKidsArticles,
  ...settingsAndAccountArticles,
];

// Fail fast (at module load, in dev/build) if two articles ever collide on id —
// a silent duplicate would mean one of them is permanently unreachable by direct link.
const seenIds = new Set<string>();
for (const article of KB_ARTICLES) {
  if (seenIds.has(article.id)) {
    throw new Error(`Duplicate KB article id: "${article.id}"`);
  }
  seenIds.add(article.id);
}

const articlesById = new Map(KB_ARTICLES.map((a) => [a.id, a]));

export function getKbArticle(id: string): KbArticle | undefined {
  return articlesById.get(id);
}

export function getRelatedArticles(article: KbArticle): KbArticle[] {
  if (!article.related?.length) return [];
  return article.related
    .map((id) => articlesById.get(id))
    .filter((a): a is KbArticle => !!a);
}

export * from "./types";
