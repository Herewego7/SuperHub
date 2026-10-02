import { useMemo, useState } from "react";
import { Search, ChevronRight, ArrowLeft } from "lucide-react";
import { KB_ARTICLES, KB_CATEGORY_LABELS, type KbCategory } from "@/kb";
import { searchKb } from "@/kb/search";
import { KbArticleView } from "@/components/kb/kb-article-view";
import { KbAskForm } from "@/components/kb/kb-ask-form";

type View = { kind: "list" } | { kind: "article"; id: string };

/** Public, no-auth help center at /help — same content as the in-app KB panel. */
export default function Help() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");

  const results = useMemo(() => (query.trim() ? searchKb(query) : []), [query]);

  const grouped = useMemo(() => {
    const byCategory = new Map<KbCategory, typeof KB_ARTICLES>();
    for (const article of KB_ARTICLES) {
      const list = byCategory.get(article.category) ?? [];
      list.push(article);
      byCategory.set(article.category, list);
    }
    return byCategory;
  }, []);

  const currentArticle =
    view.kind === "article" ? KB_ARTICLES.find((a) => a.id === view.id) : undefined;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center gap-4 mb-6">
          <a href="/support" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-3.5 h-3.5" /> Support
          </a>
          <a href="/?openSettings=1" className="text-sm text-indigo-600 hover:underline">
            ← Back to SuperHub
          </a>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">SuperHub Help Center</h1>
        <p className="text-sm text-gray-500 mb-6">Search for an answer, or browse by category.</p>

        {view.kind === "article" && currentArticle ? (
          <div>
            <button
              onClick={() => setView({ kind: "list" })}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> All articles
            </button>
            <KbArticleView article={currentArticle} onOpenArticle={(id) => setView({ kind: "article", id })} />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for help — try 'stars', 'PIN', 'streak'…"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
            </div>

            {query.trim() ? (
              <div className="space-y-1">
                {results.length === 0 ? (
                  <div className="py-6 text-center space-y-4">
                    <p className="text-sm text-gray-500">No articles matched "{query.trim()}".</p>
                    <KbAskForm searchQuery={query} />
                  </div>
                ) : (
                  <>
                    {results.map(({ article }) => (
                      <button
                        key={article.id}
                        onClick={() => setView({ kind: "article", id: article.id })}
                        className="w-full text-left rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-gray-900">{article.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{article.summary}</p>
                      </button>
                    ))}
                    <div className="pt-2">
                      <p className="text-xs text-gray-500 mb-2">Didn't find what you needed?</p>
                      <KbAskForm searchQuery={query} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {Array.from(grouped.entries()).map(([category, articles]) => (
                  <div key={category}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      {KB_CATEGORY_LABELS[category]}
                    </p>
                    <div className="space-y-1">
                      {articles.map((article) => (
                        <button
                          key={article.id}
                          onClick={() => setView({ kind: "article", id: article.id })}
                          className="w-full flex items-center justify-between gap-2 text-left rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <span className="text-sm text-gray-900">{article.title}</span>
                          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
