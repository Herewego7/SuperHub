import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { issueDateLabel, newsletterInitials, PLAN_NEWSLETTERS } from "@/lib/homeDay";
import { noteBullets } from "@/lib/slipMail";
import { HomeCard } from "./HomeCard";
import type { HomeModel, Letters } from "./useHomeDay";

const LOGO_INKS = ["#2F5E9E", "#C0392B", "#2E7355", "#5E8FAD", "#9A4E2A"];

function logoInk(text: string): string {
  const sum = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
  return LOGO_INKS[sum % LOGO_INKS.length];
}

export function NewslettersCard({ home }: { home: HomeModel }) {
  const { newsletters, visibleNewsletters, showAllLetters, setShowAllLetters } = home;
  const summary = newsletters.length === 0 ? "None yet" : newsletters.length === 1 ? "1 newsletter" : `${newsletters.length} newsletters`;
  return (
    <HomeCard id="newsletters" title="School Newsletters" summary={summary} collapsed={home.isCollapsed("newsletters")} onToggle={() => home.toggleCard("newsletters")}>
      {visibleNewsletters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No school newsletters in the last 30 days.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleNewsletters.map((letters) => <NewsletterRow key={letters.key} home={home} letters={letters} />)}
        </ul>
      )}
      {newsletters.length > PLAN_NEWSLETTERS && !showAllLetters && (
        <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAllLetters(true)}>View all</button>
      )}
    </HomeCard>
  );
}

/** One newsletter, newest issue first. Swipe sideways for the older ones. */
function NewsletterRow({ home, letters }: { home: HomeModel; letters: Letters }) {
  const [at, setAt] = useState(0);
  const count = letters.issues.length;
  const initials = newsletterInitials(letters.name);
  return (
    <li data-testid="home-newsletter" className="rounded-xl bg-[#E7F1F6] dark:bg-[rgba(94,143,173,0.18)]">
      <div
        data-testid="home-newsletter-track"
        className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ scrollbarWidth: "none" }}
        onScroll={(event) => {
          const track = event.currentTarget;
          setAt(Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)))));
        }}
      >
        {letters.issues.map((issue, index) => {
          const first = noteBullets(issue.description)[0];
          const when = issueDateLabel(issue);
          return (
            <button
              key={issue.id}
              type="button"
              data-testid="home-newsletter-issue"
              aria-label={`${letters.name}, ${when}${count > 1 ? `, ${index + 1} of ${count}` : ""}`}
              className="flex w-full shrink-0 snap-start items-start gap-3 px-3 py-3 text-left"
              onClick={() => home.setSheet({ chore: issue, mode: "letter", letters })}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-sm font-black" style={{ color: logoInk(initials) }} aria-hidden="true">{initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{letters.name}</span>
                <span className="mt-0.5 block text-xs text-[#6e6e78]">{when}</span>
                {first && <span data-testid="home-newsletter-highlight" className="mt-1 line-clamp-2 text-sm leading-snug">{first}</span>}
              </span>
              <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#1e1e24]" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {count > 1 && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <span data-testid="home-newsletter-position" className="text-xs text-[#6e6e78]">{at + 1} of {count}</span>
          <span className="flex items-center gap-1" aria-hidden="true">
            {letters.issues.map((issue, index) => (
              <span key={issue.id} data-testid="home-newsletter-dot" data-active={index === at} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: index === at ? "#5E8FAD" : "#b9cfdb" }} />
            ))}
          </span>
          <button type="button" className="ml-auto py-1 text-xs font-semibold text-[#5E8FAD]" onClick={() => home.setSheet({ chore: letters.issues[0], mode: "issues", letters })}>
            All issues
          </button>
        </div>
      )}
    </li>
  );
}
