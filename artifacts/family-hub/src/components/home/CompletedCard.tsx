import { useEffect, useRef } from "react";
import { CheckCheck, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { HomeModel } from "./useHomeDay";

/** Starts closed and opens from a praise or note push, so it keeps its own toggle rather than a remembered collapse. */
export function CompletedCard({ home }: { home: HomeModel }) {
  const { chores } = home.props;
  const { earlierOpen, setEarlierOpen, earlierRows, praise, notes, nameOf } = home;
  const markedSeen = useRef(new Set<string>());
  const unseenShown = earlierOpen ? praise.filter((p) => p.unseen).map((p) => p.id).join(",") : "";
  useEffect(() => {
    const ids = unseenShown.split(",").filter((id) => id && !markedSeen.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => markedSeen.current.add(id));
    void Promise.all(ids.map((id) => apiRequest("POST", `/api/shoutouts/${id}/seen`, {}).catch(() => null)))
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/shoutouts"] }));
  }, [unseenShown]);
  return (
    <section id="home-earlier" data-home-card="completed" className="plan-card">
      <button type="button" data-testid="home-earlier-toggle" className="flex w-full items-center gap-2 text-left" aria-expanded={earlierOpen} onClick={() => setEarlierOpen((open) => !open)}>
        <CheckCheck className="h-5 w-5 text-[#6e6e78]" aria-hidden="true" />
        <span className="text-[17px] font-medium">Completed Actions</span>
        <span className="ml-auto inline-flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#E7F1F6] px-1.5 text-xs font-semibold text-[#5E8FAD]">{earlierRows.length}</span>
        <ChevronRight className="h-4 w-4 text-[#a0a0a8]" aria-hidden="true" />
      </button>
      {earlierOpen && (
        <ul className="mt-2 flex flex-col gap-1">
          {earlierRows.map((row) => {
            if (row.kind === "done") {
              return (
                <li key={row.id} data-testid="home-earlier-row" className="text-sm text-muted-foreground">
                  {chores.find((chore) => chore.id === row.choreId)?.title ?? "Done"}
                </li>
              );
            }
            if (row.kind === "praise") {
              return (
                <li key={row.id} id={row.id === praise[0]?.id ? "home-earlier-praise" : undefined} data-testid="home-earlier-praise" className="text-sm text-muted-foreground">
                  {row.emoji} {nameOf(row.fromId) ?? "Someone"} to {nameOf(row.toId) ?? "someone"}: {row.text}
                </li>
              );
            }
            const author = nameOf(row.authorId);
            return (
              <li key={row.id} id={row.id === notes[0]?.id ? "home-earlier-note" : undefined} data-testid="home-earlier-note" className="line-clamp-2 text-sm text-muted-foreground">
                📝 {author ? `${author}: ` : ""}{row.text}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
