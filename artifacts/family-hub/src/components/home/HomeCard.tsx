import type { ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { robustScrollIntoView, stickyHeaderOffset } from "@/lib/scroll";
import { cardIcon, type HomeCardId } from "./registry";

type Props = {
  id: HomeCardId;
  title: string;
  /** One line shown in place of the card's body while it is collapsed. */
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Buttons beside the title. They stay reachable while the card is collapsed. */
  actions?: ReactNode;
  testId?: string;
  children: ReactNode;
};

export function HomeCard({ id, title, summary, collapsed, onToggle, actions, testId, children }: Props) {
  const Icon = cardIcon(id);
  const bodyId = `home-card-body-${id}`;
  return (
    <section id={`home-card-${id}`} className="plan-card" data-testid={testId} data-home-card={id}>
      <div className={`flex items-center gap-2 ${collapsed ? "" : "mb-2"}`}>
        <h2 className="min-w-0 flex-1 text-[17px] font-medium">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2.5 text-left"
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : bodyId}
            onClick={onToggle}
          >
            <Icon className="h-5 w-5 shrink-0 text-[#5E8FAD]" aria-hidden="true" />
            <span className="shrink-0">{title}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-[#a0a0a8] transition-transform ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true" />
            {collapsed && (
              <span data-testid="home-card-summary" className="ml-auto min-w-0 truncate text-sm font-normal text-[#6e6e78]">{summary}</span>
            )}
          </button>
        </h2>
        {actions}
      </div>
      {!collapsed && <div id={bodyId}>{children}</div>}
    </section>
  );
}

/** Opens Email filters from a card whose rows come from email. */
export function EmailFiltersButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" aria-label="Email filters" data-testid="home-email-filters-button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-[#6e6e78]" onClick={onOpen}>
      <SlidersHorizontal className="h-4 w-4" />
    </button>
  );
}

/**
 * "View all" that turns into "Show less", so a long list can be put away
 * again; before, it stayed long until the app was closed (2026-10-22).
 * Folding it back scrolls to the card's top when that has gone off screen,
 * so the shorter list isn't left far above the finger.
 */
export function ShowAllToggle({ id, open, onChange, more = "View all", variant = "bar" }: {
  id: HomeCardId;
  open: boolean;
  onChange: (open: boolean) => void;
  more?: string;
  variant?: "bar" | "link";
}) {
  const fold = () => {
    onChange(false);
    const card = document.getElementById(`home-card-${id}`);
    if (card && card.getBoundingClientRect().top < stickyHeaderOffset(0)) robustScrollIntoView(`home-card-${id}`, stickyHeaderOffset(), "smooth");
  };
  return (
    <button
      type="button"
      data-testid={`home-show-all-${id}`}
      aria-expanded={open}
      className={variant === "bar" ? "mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" : "mt-1 text-sm font-semibold text-[#5E8FAD]"}
      onClick={() => (open ? fold() : onChange(true))}
    >
      {open ? "Show less" : more}
    </button>
  );
}
