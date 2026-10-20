import type { ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
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
    <section className="plan-card" data-testid={testId} data-home-card={id}>
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
