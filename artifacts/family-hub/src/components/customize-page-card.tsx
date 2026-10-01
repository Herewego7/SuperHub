import { Settings } from "lucide-react";

/**
 * A plain, low-key "Customize Page" bar at the very bottom of the Home and
 * Chores card stacks — the same pattern as Alarm.com's dashboard "EDIT
 * DASHBOARD" bar (a flat, full-width, muted button below every widget).
 * Deliberately just a different ENTRY POINT into the existing Customize
 * Home Page / Customize Tasks Page dialogs — those dialogs themselves are
 * unchanged; this replaced the small gear icon that used to sit in the
 * shared date-nav row up top.
 */
export function CustomizePageCard({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-border bg-muted/40 hover:bg-muted/70 active:bg-muted transition-colors text-sm font-semibold tracking-wide text-muted-foreground hover:text-foreground"
    >
      <Settings className="w-4 h-4" />
      {label}
    </button>
  );
}
