import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ActivityLogEntry, ActivityLogEntryType, Profile } from "@workspace/shared-types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X, Search, Undo2 } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { objectUrl } from "@/lib/apiBase";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { confirmDialog } from "@/lib/confirmDialog";
import { useSpotlight } from "@/lib/spotlight";

interface HistoryViewProps {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  /** When set, pre-filters to just these types on open (e.g. jumping in from
      the Behavior Board's own "View Activity" link) instead of showing every
      activity type. The user can still broaden the filter from here. Ignored
      whenever focusEntryId is also set — jumping to a specific entry must
      never risk a stale/narrow filter hiding the very thing being opened for. */
  initialTypeFilter?: ActivityLogEntryType[];
  /** When set (e.g. tapping a row in Home's Recent Activity card), scrolls to
      and briefly highlights that one entry once it's loaded, instead of just
      opening to the top of the list. */
  focusEntryId?: string | null;
}

const TYPE_CONFIG: Record<ActivityLogEntryType, { label: string; emoji: string; bg: string; text: string }> = {
  chore_complete:      { label: 'Chore Done',   emoji: '✅', bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-700 dark:text-green-400' },
  chore_uncomplete:    { label: 'Undone',       emoji: '↩️', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  reward_redeem:       { label: 'Reward',       emoji: '🎁', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400' },
  shoutout:            { label: 'Shoutout',     emoji: '👏', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-600' },
  point_adjustment:    { label: 'Stars',       emoji: '⭐', bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-700 dark:text-blue-400' },
  behaviour_incident:  { label: 'Behavior',     emoji: '📋', bg: 'bg-rose-100 dark:bg-rose-900/30',     text: 'text-rose-700 dark:text-rose-400' },
  meal_planned:        { label: 'Meal',         emoji: '🍽️', bg: 'bg-teal-100 dark:bg-teal-900/30',     text: 'text-teal-700 dark:text-teal-400' },
  cashout_requested:   { label: 'Cash-Out Requested', emoji: '💵', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400' },
  cashout_approved:    { label: 'Cash-Out Approved',  emoji: '✅', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400' },
  cashout_declined:    { label: 'Cash-Out Declined',  emoji: '🚫', bg: 'bg-red-100 dark:bg-red-900/30',         text: 'text-red-700 dark:text-red-400' },
  note_posted:         { label: 'Note',               emoji: '📝', bg: 'bg-amber-100 dark:bg-amber-900/30',     text: 'text-amber-700 dark:text-amber-400' },
};

const ALL_TYPES: ActivityLogEntryType[] = [
  'chore_complete', 'chore_uncomplete', 'reward_redeem', 'shoutout', 'point_adjustment', 'behaviour_incident', 'meal_planned',
  'cashout_requested', 'cashout_approved', 'cashout_declined', 'note_posted',
];

// Filter chips are no longer 1:1 with activity types. Three separate
// cash-out chips took a whole row to say one thing, and bonus-chore
// completions were indistinguishable from regular ones — so a chip is now a
// named predicate instead. Two consequences worth knowing:
//   * An entry that matches NO chip (a behaviour incident, say — that
//     feature is hidden from the nav, so it doesn't get a chip naming it)
//     is always shown rather than silently filtered out, so a family with
//     historical entries doesn't lose them.
//   * A chore completion is a Bonus Chore when its metadata says so; the
//     activity-log route already carries isBonus on every chore_complete
//     entry, so this needs no backend change.
const isBonusEntry = (e: any) => !!(e?.metadata && (e.metadata as any).isBonus);

export type ChipDef = {
  key: string; label: string; emoji: string; bg: string; text: string;
  match: (e: any) => boolean;
};

const CHIPS: ChipDef[] = [
  { key: 'chore', label: 'Chores', emoji: '✅', bg: TYPE_CONFIG.chore_complete.bg, text: TYPE_CONFIG.chore_complete.text,
    match: (e) => e.activityType === 'chore_complete' && !isBonusEntry(e) },
  { key: 'bonus', label: 'Bonus', emoji: '✨', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400',
    match: (e) => e.activityType === 'chore_complete' && isBonusEntry(e) },
  { key: 'undone', label: 'Undone', emoji: '↩️', bg: TYPE_CONFIG.chore_uncomplete.bg, text: TYPE_CONFIG.chore_uncomplete.text,
    match: (e) => e.activityType === 'chore_uncomplete' },
  { key: 'reward', label: 'Rewards', emoji: '🎁', bg: TYPE_CONFIG.reward_redeem.bg, text: TYPE_CONFIG.reward_redeem.text,
    match: (e) => e.activityType === 'reward_redeem' },
  { key: 'shoutout', label: 'Praise', emoji: '👏', bg: TYPE_CONFIG.shoutout.bg, text: TYPE_CONFIG.shoutout.text,
    match: (e) => e.activityType === 'shoutout' },
  { key: 'stars', label: 'Stars', emoji: '⭐', bg: TYPE_CONFIG.point_adjustment.bg, text: TYPE_CONFIG.point_adjustment.text,
    match: (e) => e.activityType === 'point_adjustment' },
  { key: 'meal', label: 'Meals', emoji: '🍽️', bg: TYPE_CONFIG.meal_planned.bg, text: TYPE_CONFIG.meal_planned.text,
    match: (e) => e.activityType === 'meal_planned' },
  { key: 'cashout', label: 'Cash-Out', emoji: '💵', bg: TYPE_CONFIG.cashout_requested.bg, text: TYPE_CONFIG.cashout_requested.text,
    match: (e) => e.activityType === 'cashout_requested' || e.activityType === 'cashout_approved' || e.activityType === 'cashout_declined' },
  { key: 'note', label: 'Notes', emoji: '📝', bg: TYPE_CONFIG.note_posted.bg, text: TYPE_CONFIG.note_posted.text,
    match: (e) => e.activityType === 'note_posted' },
];
const ALL_CHIP_KEYS = CHIPS.map(c => c.key);

/** Which chips a legacy initialTypeFilter (a list of activity types) maps to. */
function chipsForTypes(types: ActivityLogEntryType[]): string[] {
  const keys = CHIPS.filter(c => types.some(t => c.match({ activityType: t, metadata: t === 'chore_complete' ? { isBonus: c.key === 'bonus' } : null }))).map(c => c.key);
  return keys.length ? keys : ALL_CHIP_KEYS;
}

function ProfileAvatar({ name, color, initials, photoUrl }: {
  name: string; color: string; initials: string; photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <img
        src={objectUrl(photoUrl)}
        alt={name}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0 border-2 border-white dark:border-gray-800 shadow-sm"
      />
    );
  }
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold border-2 border-white dark:border-gray-800 shadow-sm"
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}

function groupByDate(entries: ActivityLogEntry[]): Array<{ label: string; items: ActivityLogEntry[] }> {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    let key: string;
    if (isToday(d)) key = 'Today';
    else if (isYesterday(d)) key = 'Yesterday';
    else key = format(d, 'EEEE, MMM d');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export function HistoryView({ open, onClose, profiles, initialTypeFilter, focusEntryId }: HistoryViewProps) {
  const { toast } = useToast();
  const [activeChips, setActiveChips] = useState<Set<string>>(
    new Set(initialTypeFilter && initialTypeFilter.length > 0 ? chipsForTypes(initialTypeFilter) : ALL_CHIP_KEYS),
  );
  const [activeProfileIds, setActiveProfileIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Reset to the requested filter each time the drawer is (re)opened — so
  // opening it fresh from Behavior Board always starts scoped to Behavior,
  // and opening it from the generic "Recent Activity" entry point always
  // starts unfiltered, regardless of whatever filter was left over from the
  // last time it was open. Jumping to one specific entry (focusEntryId)
  // always shows everything, unfiltered — a stale/narrow type or person
  // filter left over from a previous open must never hide the very entry
  // this open is FOR.
  useEffect(() => {
    if (open) {
      setActiveChips(new Set(focusEntryId || !initialTypeFilter || initialTypeFilter.length === 0 ? ALL_CHIP_KEYS : chipsForTypes(initialTypeFilter)));
      setActiveProfileIds(new Set());
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusEntryId]);

  // Memoized with an empty dep array — react-query re-runs `select` any time
  // ITS OWN function identity changes, not just when the underlying data
  // does, so an inline arrow function here (recreated every render) made
  // `rawEntries`/`filtered`/`grouped` new object references on every single
  // render regardless of whether the data actually changed. That fed
  // straight into the scroll-to-entry effect below (which depends on
  // `grouped`), causing it to refire — and re-spotlight — on every render,
  // forever: a real, previously-shipped bug (spotlighting a Family Activity
  // entry never stopped dimming/undimming the screen). Keeping this
  // reference stable across renders is what actually fixes it.
  const transformEntries = useCallback(
    (data: ActivityLogEntry[]) => data.map((e) => ({ ...e, timestamp: new Date(e.timestamp) })),
    [],
  );
  const { data: rawEntries = [], isLoading, isError } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-log"],
    enabled: open,
    // The drawer is meant to be a live audit trail — always hit the network
    // on every open rather than trusting the normal 30s staleTime, so there's
    // no window where a just-completed chore could still show stale data.
    refetchOnMount: "always",
    select: transformEntries,
  });

  const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawEntries.filter((e) => {
      // An entry that matches no chip at all is always shown — see the CHIPS
      // note above; only entries a chip *could* match are filterable.
      const owning = CHIPS.filter(c => c.match(e));
      if (owning.length && !owning.some(c => activeChips.has(c.key))) return false;
      if (activeProfileIds.size > 0 && !activeProfileIds.has(e.profileId)) return false;
      if (q) {
        const haystack = `${e.profileName} ${e.description} ${e.entityTitle ?? ""} ${e.toProfileName ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rawEntries, activeChips, activeProfileIds, search]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  // Scroll to and briefly highlight one specific entry once it's loaded.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { spotlight, spotlightOverlay } = useSpotlight();
  // Tracks which focusEntryId this effect has already handled — defense in
  // depth (on top of transformEntries above being memoized) against ever
  // re-spotlighting the same entry more than once per open, e.g. if a
  // legitimate mid-open data refetch happens to change `grouped` again.
  const lastSpotlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) lastSpotlightedRef.current = null;
  }, [open]);
  useEffect(() => {
    if (!open || !focusEntryId || isLoading) return;
    if (lastSpotlightedRef.current === focusEntryId) return;
    // The row for focusEntryId may not have its ref attached on the exact
    // render this effect sees fresh data yet (e.g. right after the Sheet's
    // own content remounts on reopen) — a requestAnimationFrame defers the
    // lookup past the current commit, by which point the DOM is settled.
    const raf = requestAnimationFrame(() => {
      const el = rowRefs.current.get(focusEntryId);
      if (!el) return;
      lastSpotlightedRef.current = focusEntryId;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(focusEntryId);
      spotlight(`activity-entry-${focusEntryId}`);
    });
    const t = setTimeout(() => setHighlightedId(null), 2200);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [open, focusEntryId, isLoading, grouped]);

  const undoCompletion = useMutation({
    mutationFn: async (entry: ActivityLogEntry) => {
      const choreId = entry.metadata?.choreId as string | undefined;
      if (!choreId) throw new Error("Missing chore id");
      const dateParam = entry.timestamp.toISOString().split("T")[0];
      const localDayStart = new Date(entry.timestamp);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest(
        "DELETE",
        `/api/chore-completions/${choreId}/${entry.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chores/bonus"] });
      toast({ title: "Completion undone" });
    },
    onError: (err: any) => toast({ title: "Couldn't undo that", description: err?.message, variant: "destructive" }),
  });

  const handleUndo = async (entry: ActivityLogEntry) => {
    const ok = await confirmDialog({
      title: `Undo "${entry.entityTitle}"?`,
      description: `This removes ${entry.profileName}'s completion${entry.metadata?.points ? ` and its ${entry.metadata.points} star${entry.metadata.points === 1 ? "" : "s"}` : ""}.`,
      confirmLabel: "Undo it",
    });
    if (ok) undoCompletion.mutate(entry);
  };

  const toggleType = (t: string) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  };

  const toggleProfile = (id: string) => {
    setActiveProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
    {spotlightOverlay}
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-full p-0 flex flex-col overflow-hidden [&>button]:hidden"
        onInteractOutside={(e) => {
          // The Undo confirmation (confirmDialog) opens as its own top-level
          // alertdialog on top of this drawer — without this guard, tapping
          // its "Undo it" button registers as an "interact outside" on this
          // Sheet and dismisses the whole drawer instead of just resolving
          // the confirmation. Same fix already applied to the Manage-tasks
          // drawer and Settings for the identical class of bug.
          const t = (e.detail as any)?.originalEvent?.target as Element | null;
          if (t && t.closest('[role="dialog"],[role="alertdialog"]')) e.preventDefault();
        }}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">📋</span>
              Family Activity
            </SheetTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" data-testid="history-close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2">
          {/* Search — not everything worth finding is recent, so scrolling
              through weeks of history to find one thing isn't the only way. */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity…"
              className="h-8 pl-8 text-sm"
              data-testid="history-search"
            />
          </div>

          {/* Activity type pills. Leads with an All types reset (matching the
              Manage-tasks drawer's filter row, which already had one) so
              "everything" is a state you can see and get back to, rather
              than being implied by every chip happening to be lit. */}
          <div className="flex flex-wrap gap-1.5">
            {(() => {
              // Toggles both ways: everything on -> clear it, anything else ->
              // select everything. One control for "show it all" and "start
              // from nothing", instead of a reset that can only ever go one
              // direction and then sits there doing nothing.
              const allOn = ALL_CHIP_KEYS.every(k => activeChips.has(k));
              return (
                <button
                  onClick={() => setActiveChips(allOn ? new Set() : new Set(ALL_CHIP_KEYS))}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                    allOn
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'bg-transparent text-muted-foreground border-border'
                  }`}
                  data-testid="activity-filter-all"
                >
                  {allOn ? 'Clear all' : 'All types'}
                </button>
              );
            })()}
            {CHIPS.map((c) => {
              const active = activeChips.has(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => toggleType(c.key)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                    active
                      ? `${c.bg} ${c.text} border-transparent`
                      : 'bg-transparent text-muted-foreground border-border opacity-50'
                  }`}
                  data-testid={`activity-filter-${c.key}`}
                >
                  <span>{c.emoji}</span>
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Person pills */}
          {regularProfiles.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {regularProfiles.map((p) => {
                const active = activeProfileIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProfile(p.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                      active
                        ? 'border-transparent text-white'
                        : 'bg-transparent text-muted-foreground border-border'
                    }`}
                    style={active ? { backgroundColor: p.color } : {}}
                  >
                    {/* When the chip is active its background IS p.color, so a
                        same-colour dot vanished into it and read as a blank
                        gap. A white ring keeps the dot legible on the chip. */}
                    <div
                      className={`w-3 h-3 rounded-full flex-shrink-0 ${active ? 'ring-2 ring-white' : ''}`}
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                  </button>
                );
              })}
              {activeProfileIds.size > 0 && (
                <button
                  onClick={() => setActiveProfileIds(new Set())}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground border border-border hover:bg-accent/50 transition-all"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              <div className="text-center space-y-2">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p>Loading history…</p>
              </div>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-destructive text-sm gap-2">
              <span className="text-3xl">⚠️</span>
              <p>Couldn't load history. Try again.</p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <span className="text-3xl">📭</span>
              <p>{search.trim() ? "No activity matches your search" : "No activity in the last 30 days"}</p>
            </div>
          ) : (
            <div className="pb-6">
              {grouped.map(({ label, items }) => (
                <div key={label}>
                  <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50">
                    {label}
                  </div>
                  <div className="divide-y divide-border/50">
                    {items.map((entry) => {
                      // Prefer the chip's own label/colour so a bonus-chore
                      // completion reads as "Bonus" in the list, not "Chore
                      // Done" — otherwise the new filter separates them while
                      // the rows still claim to be the same thing.
                      const chip = CHIPS.find(c => c.match(entry));
                      const byType = TYPE_CONFIG[entry.activityType as ActivityLogEntryType] ?? TYPE_CONFIG.chore_complete;
                      const cfg = chip ? { label: chip.label, emoji: chip.emoji, bg: chip.bg, text: chip.text } : byType;
                      const canUndo =
                        entry.activityType === "chore_complete" &&
                        !!entry.metadata?.choreId &&
                        !!(entry.metadata?.isBonus || entry.metadata?.isTargetChore);
                      const isHighlighted = highlightedId === entry.id;
                      return (
                        <div
                          key={entry.id}
                          id={`activity-entry-${entry.id}`}
                          ref={(el) => { if (el) rowRefs.current.set(entry.id, el); else rowRefs.current.delete(entry.id); }}
                          className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                            isHighlighted ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-accent/30"
                          }`}
                        >
                          <ProfileAvatar
                            name={entry.profileName}
                            color={entry.profileColor}
                            initials={entry.profileInitials}
                            photoUrl={entry.profilePhotoUrl}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className="font-medium text-sm text-foreground">{entry.profileName}</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                                {cfg.emoji} {cfg.label}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-snug">{entry.description}</p>
                            {canUndo && (
                              <button
                                onClick={() => handleUndo(entry)}
                                disabled={undoCompletion.isPending}
                                className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                data-testid="undo-completion"
                              >
                                <Undo2 className="w-3 h-3" />
                                Undo
                              </button>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 pt-0.5">
                            {format(new Date(entry.timestamp), 'h:mm a')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}
