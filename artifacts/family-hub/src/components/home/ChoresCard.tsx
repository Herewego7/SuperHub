import { ClipboardList } from "lucide-react";
import type { HomeModel } from "./useHomeDay";

/** One line that opens the Chores tab, so there is nothing to collapse. */
export function ChoresCard({ home }: { home: HomeModel }) {
  return (
    <button type="button" data-testid="home-chore-count" data-home-card="chores" onClick={home.props.onOpenChores} className="flex w-full items-center gap-2 plan-card text-left">
      <ClipboardList className="h-5 w-5 text-[#5E8FAD]" aria-hidden="true" />
      <span className="text-[17px] font-medium">Chores</span>
      <span className="ml-auto text-sm text-muted-foreground">{home.progress.done} of {home.progress.total}</span>
    </button>
  );
}
