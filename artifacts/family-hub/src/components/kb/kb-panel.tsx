import { useMemo, useState, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, X, Search, HelpCircle, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { KB_ARTICLES, KB_CATEGORY_LABELS, type KbCategory } from "@/kb";
import { searchKb } from "@/kb/search";
import { KbArticleView } from "./kb-article-view";
import { KbAskForm } from "./kb-ask-form";

type KbView = { kind: "list" } | { kind: "article"; id: string };

interface KbPanelProps {
  /** Called when the panel should close, returning the user to Settings. */
  onClose: () => void;
}

/**
 * A genuine nested Radix Dialog on top of the Settings modal — NOT a plain
 * portal div (an earlier version was, which required toggling Settings'
 * `modal` prop off while this was open; that toggle put Radix into a stuck
 * half-closed animation state, visible as Settings rendering greyed-out and
 * unclickable after closing this panel). A real nested Dialog is naturally
 * exempted from the parent's inert/scroll-lock sweep — Radix recognizes its
 * own tracked layers — the same reason CalendarSelectionModal never needed
 * any special-casing. Settings' own Dialog can go back to a plain, always-on
 * `modal` with no conditional.
 *
 * Two-level navigation only: article -> list -> Settings. The one
 * always-visible "Back to Settings" affordance is deliberate — see
 * KB_PLAN.md's navigation model for why (easy to leave on purpose, hard to
 * leave by accident). onInteractOutside/onPointerDownOutside are suppressed
 * since this is full-screen — there's no visible "outside" to click, and
 * closing should only ever happen via the explicit buttons.
 */
export function KbPanel({ onClose }: KbPanelProps) {
  const [view, setView] = useState<KbView>({ kind: "list" });
  const [query, setQuery] = useState("");
  const listScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

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

  // Escape steps back one level (article -> list), same as the "All
  // articles" link — only closes the whole panel from the list view.
  const handleEscapeKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    if (view.kind === "article") {
      setView({ kind: "list" });
    } else {
      onClose();
    }
  };

  const openArticle = (id: string) => {
    savedScrollTop.current = listScrollRef.current?.scrollTop ?? 0;
    setView({ kind: "article", id });
  };

  const backToList = () => {
    setView({ kind: "list" });
    requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTop.current;
    });
  };

  const currentArticle =
    view.kind === "article" ? KB_ARTICLES.find((a) => a.id === view.id) : undefined;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
    <DialogPrimitive.Portal>
    {/* An Overlay is REQUIRED even though this panel is fully opaque and
        covers the screen itself. Radix installs its react-remove-scroll lock
        on the *Overlay* (shard-ed to that dialog's own content), not on the
        Content. With no Overlay here, the still-open Settings dialog's lock
        stayed in charge — and it only whitelists Settings' own content, so
        every touchmove inside this panel was swallowed and neither the
        article list nor an open article could be scrolled on a touch device.
        Mounting our own Overlay puts this panel's content on top of the lock
        stack. Transparent + pointer-events-none so it changes nothing
        visually and can't intercept taps. */}
    <DialogPrimitive.Overlay className="fixed inset-0 z-[2090] bg-transparent pointer-events-none" />
    <DialogPrimitive.Content
      className="fixed inset-0 z-[2100] bg-background flex flex-col outline-none"
      aria-label="Help & Knowledge Base"
      onEscapeKeyDown={handleEscapeKeyDown}
      onInteractOutside={(e) => e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
    >
      <DialogPrimitive.Title className="sr-only">Help &amp; Knowledge Base</DialogPrimitive.Title>
      <div
        className="shrink-0 border-b border-border bg-card px-3 pb-2.5 flex items-center gap-2"
        style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))" }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg hover:bg-accent active:bg-accent transition-colors text-sm font-medium text-foreground shrink-0"
          data-testid="kb-back-to-settings"
        >
          <ArrowLeft className="w-4 h-4" />
          {/* "Close" rather than "Back": this fully closes the panel, while
              the panel's actual step-back control is "All Articles". Two
              controls labelled as if they both went back, doing different
              things, is what made the header confusing. */}
          <span className="hidden xs:inline">Close Help</span>
          <span className="xs:hidden">Close</span>
        </button>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground min-w-0">
          <HelpCircle className="w-4 h-4 shrink-0" />
          <span className="truncate">Help</span>
        </div>
        <button
          onClick={onClose}
          className="ml-auto p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Close help"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        ref={listScrollRef}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {view.kind === "article" && currentArticle ? (
          <div className="p-4 max-w-2xl mx-auto">
            <button
              onClick={backToList}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All articles
            </button>
            <KbArticleView article={currentArticle} onOpenArticle={openArticle} />
          </div>
        ) : (
          <div className="p-4 max-w-2xl mx-auto space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help…"
                className="pl-9"
                autoFocus
              />
            </div>

            {query.trim() ? (
              <div className="space-y-1">
                {results.length === 0 ? (
                  <div className="py-6 text-center space-y-4">
                    <p className="text-sm text-muted-foreground">
                      No articles matched "{query.trim()}".
                    </p>
                    <KbAskForm searchQuery={query} />
                  </div>
                ) : (
                  <>
                    {results.map(({ article }) => (
                      <button
                        key={article.id}
                        onClick={() => openArticle(article.id)}
                        data-testid={`kb-article-${article.id}`}
                        className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 active:bg-accent transition-colors"
                      >
                        <p className="text-sm font-medium text-foreground">{article.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{article.summary}</p>
                      </button>
                    ))}
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        Didn't find what you needed?
                      </p>
                      <KbAskForm searchQuery={query} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {Array.from(grouped.entries()).map(([category, articles]) => (
                  <div key={category}>
                    {/* Same treatment as the Grocery List's aisle headings —
                        full-strength text over a rule — and sticky, so while
                        you scroll a long list you can still see which
                        category the articles under your thumb belong to. */}
                    <p className="sticky top-0 z-10 bg-background text-xs font-bold uppercase tracking-wide text-foreground px-2 pt-1 pb-1 mb-1.5 border-b border-border">
                      {KB_CATEGORY_LABELS[category]}
                    </p>
                    <div className="space-y-1">
                      {articles.map((article) => (
                        <button
                          key={article.id}
                          onClick={() => openArticle(article.id)}
                          data-testid={`kb-article-${article.id}`}
                          className="w-full flex items-center justify-between gap-2 text-left rounded-lg px-3 py-2.5 hover:bg-accent/50 active:bg-accent transition-colors"
                        >
                          <span className="text-sm text-foreground">{article.title}</span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
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
    </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
