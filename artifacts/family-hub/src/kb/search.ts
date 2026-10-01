import MiniSearch from "minisearch";
import { KB_ARTICLES } from "./index";
import type { KbArticle, KbBlock } from "./types";

interface KbSearchDoc {
  id: string;
  title: string;
  tags: string;
  summary: string;
  body: string;
}

function blockText(block: KbBlock): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "steps":
      return block.steps.join(" ");
    case "path":
      return block.path.join(" ");
    case "note":
      return block.text;
    case "faq":
      return block.items.map((i) => `${i.q} ${i.a}`).join(" ");
    default:
      return "";
  }
}

function toDoc(article: KbArticle): KbSearchDoc {
  return {
    id: article.id,
    title: article.title,
    tags: article.tags.join(" "),
    summary: article.summary,
    body: article.blocks.map(blockText).join(" "),
  };
}

let miniSearch: MiniSearch<KbSearchDoc> | null = null;

function getIndex(): MiniSearch<KbSearchDoc> {
  if (miniSearch) return miniSearch;
  miniSearch = new MiniSearch<KbSearchDoc>({
    fields: ["title", "tags", "summary", "body"],
    storeFields: ["id"],
    searchOptions: {
      boost: { title: 4, tags: 3, summary: 1.5, body: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  miniSearch.addAll(KB_ARTICLES.map(toDoc));
  return miniSearch;
}

const articlesById = new Map(KB_ARTICLES.map((a) => [a.id, a]));

export interface KbSearchResult {
  article: KbArticle;
  score: number;
}

export function searchKb(query: string): KbSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const index = getIndex();
  const results = index.search(trimmed);
  return results
    .map((r) => {
      const article = articlesById.get(r.id as string);
      return article ? { article, score: r.score } : null;
    })
    .filter((r): r is KbSearchResult => !!r);
}
