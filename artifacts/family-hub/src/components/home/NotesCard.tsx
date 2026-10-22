import { useEffect, useRef, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { HomeCard } from "./HomeCard";
import type { HomeModel } from "./useHomeDay";

/** How many messages show before "Show all". */
const NOTES_SHOWN = 3;
const SEEN_AFTER_MS = 1000;

/**
 * The week's praise and family notes, newest first. It replaced Completed
 * Actions (2026-10-22) and is not there at all when there is nothing to show.
 * Praise is marked seen only once it is on screen: a folded card shows none.
 */
export function NotesCard({ home }: { home: HomeModel }) {
  const { messages, praise, notes, nameOf } = home;
  const collapsed = home.isCollapsed("notes");
  const [showAll, setShowAll] = useState(false);
  // Praise not seen yet always shows: the Home badge promised it.
  const lastUnseen = messages.reduce((last, row, index) => (row.kind === "praise" && row.unseen ? index : last), -1);
  const cap = Math.max(NOTES_SHOWN, lastUnseen + 1);
  const shown = showAll ? messages : messages.slice(0, cap);
  const markedSeen = useRef(new Set<string>());
  const unseenShown = collapsed ? "" : shown.filter((row) => row.kind === "praise" && row.unseen).map((row) => row.id).join(",");
  // Seen once it has stayed on screen a moment. Home first draws for everyone
  // before the chosen person is applied, and that first draw is nobody's.
  useEffect(() => {
    const ids = unseenShown.split(",").filter((id) => id && !markedSeen.current.has(id));
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      ids.forEach((id) => markedSeen.current.add(id));
      void Promise.all(ids.map((id) => apiRequest("POST", `/api/shoutouts/${id}/seen`, {}).catch(() => null)))
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/shoutouts"] }));
    }, SEEN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [unseenShown]);
  if (messages.length === 0) return null;
  const summary = messages.length === 1 ? "1 this week" : `${messages.length} this week`;
  return (
    <div id="home-notes">
      <HomeCard id="notes" title="Notes & Praise" summary={summary} collapsed={collapsed} onToggle={() => home.toggleCard("notes")} testId="home-notes-card">
        <ul className="flex flex-col gap-1.5">
          {shown.map((row) => row.kind === "praise" ? (
            <li key={row.id} id={row.id === praise[0]?.id ? "home-notes-praise" : undefined} data-testid="home-notes-praise" className="text-sm text-muted-foreground">
              {row.emoji} {nameOf(row.fromId) ?? "Someone"} to {nameOf(row.toId) ?? "someone"}: {row.text}
            </li>
          ) : (
            <li key={row.id} id={row.id === notes[0]?.id ? "home-notes-note" : undefined} data-testid="home-notes-note" className="line-clamp-2 text-sm text-muted-foreground">
              📝 {nameOf(row.authorId) ? `${nameOf(row.authorId)}: ` : ""}{row.text}
            </li>
          ))}
        </ul>
        {messages.length > cap && (
          <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAll((all) => !all)}>
            {showAll ? "Show less" : `Show all ${messages.length}`}
          </button>
        )}
      </HomeCard>
    </div>
  );
}
