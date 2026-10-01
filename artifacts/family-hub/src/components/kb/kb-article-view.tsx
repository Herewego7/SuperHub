import { ChevronRight, Info, AlertTriangle } from "lucide-react";
import type { KbArticle } from "@/kb/types";
import { getRelatedArticles } from "@/kb";

interface KbArticleViewProps {
  article: KbArticle;
  onOpenArticle: (id: string) => void;
}

export function KbArticleView({ article, onOpenArticle }: KbArticleViewProps) {
  const related = getRelatedArticles(article);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{article.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{article.summary}</p>
      </div>

      <div className="space-y-4">
        {article.blocks.map((block, i) => {
          switch (block.kind) {
            case "text":
              return (
                <p key={i} className="text-sm text-foreground leading-relaxed">
                  {block.text}
                </p>
              );
            case "steps":
              return (
                <ol key={i} className="space-y-2 list-decimal list-inside">
                  {block.steps.map((step, si) => (
                    <li key={si} className="text-sm text-foreground leading-relaxed pl-1">
                      {step}
                    </li>
                  ))}
                </ol>
              );
            case "path":
              return (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground bg-muted/50 rounded-md px-3 py-2"
                >
                  {block.path.map((segment, pi) => (
                    <span key={pi} className="flex items-center gap-1">
                      {pi > 0 && <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span>{segment}</span>
                    </span>
                  ))}
                </div>
              );
            case "note": {
              const isWarn = block.tone === "warn";
              const Icon = isWarn ? AlertTriangle : Info;
              return (
                <div
                  key={i}
                  className={`flex gap-2 rounded-lg border p-3 text-sm leading-relaxed ${
                    isWarn
                      ? "border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                      : "border-primary/20 bg-primary/5 text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{block.text}</span>
                </div>
              );
            }
            case "faq":
              return (
                <div key={i} className="space-y-3">
                  {block.items.map((item, fi) => (
                    <div key={fi}>
                      <p className="text-sm font-semibold text-foreground">{item.q}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{item.a}</p>
                    </div>
                  ))}
                </div>
              );
            default:
              return null;
          }
        })}
      </div>

      {related.length > 0 && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Related
          </p>
          <div className="space-y-1">
            {related.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenArticle(r.id)}
                className="flex items-center gap-1 text-sm text-primary hover:underline text-left"
              >
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                {r.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground/70 pt-2">Last updated {article.updatedAt}</p>
    </div>
  );
}
