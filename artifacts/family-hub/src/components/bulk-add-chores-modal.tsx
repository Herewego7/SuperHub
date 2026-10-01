import { useState } from "react";
import { Profile, InsertChore } from "@workspace/shared-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Check, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";


const DAYS_OF_WEEK = [
  { value: 0, short: "Sun", letter: "S" },
  { value: 1, short: "Mon", letter: "M" },
  { value: 2, short: "Tue", letter: "T" },
  { value: 3, short: "Wed", letter: "W" },
  { value: 4, short: "Thu", letter: "T" },
  { value: 5, short: "Fri", letter: "F" },
  { value: 6, short: "Sat", letter: "S" },
];

const POINT_OPTIONS = [0, 1, 2, 3, 5, 10];

interface BulkChoreData {
  id: string;
  title: string;
  icon: string;
  description: string;
  profileIds: string[];
  daysOfWeek: number[];
  points: number;
  recurrenceType: "weekly" | "monthly";
  endDate: Date | null;
  targetCount: number | null;
}

interface BulkAddChoresModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
  onSaveChores: (chores: InsertChore[]) => Promise<void>;
}

let idCounter = 0;
const newId = () => `chore-${Date.now()}-${idCounter++}`;

// Hoisted to module scope — these were previously declared inside
// BulkAddChoresModal's render body, which redefines them as new function
// references on every single state update. React treats a new function
// identity as a different component type, so every AvatarToggle/DayToggle
// instance was fully unmounted and remounted (not just re-rendered) on
// every keystroke or click, anywhere in the modal. With 21 chore rows that
// was already 21×profiles.length + 21×7 wasted remounts per interaction —
// severe enough with the Days grid specifically (a fixed 7 per row,
// regardless of family size, so it scales worse than the profile picker)
// to freeze the whole page. Module-scope, stable identities let React
// diff props instead of remounting.
const AvatarToggle = ({ profile, active, onClick, size = "md" }: { profile: Profile; active: boolean; onClick: () => void; size?: "sm" | "md" }) => (
  <button
    onClick={onClick}
    title={profile.name}
    className={cn(
      "rounded-full flex items-center justify-center font-bold text-white transition-all border-2 shrink-0",
      size === "sm" ? "w-7 h-7 text-[10px]" : "w-8 h-8 text-xs",
      active ? "ring-2 ring-primary ring-offset-1 border-white" : "border-transparent opacity-40 hover:opacity-70"
    )}
    style={{ backgroundColor: profile.color }}
  >
    {profile.initials}
  </button>
);

const DayToggle = ({ day, active, onClick }: { day: typeof DAYS_OF_WEEK[number]; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    title={day.short}
    className={cn(
      "w-7 h-7 rounded-md text-xs font-bold transition-all border shrink-0",
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background border-border text-muted-foreground hover:border-primary/50"
    )}
  >
    {day.letter}
  </button>
);

export function BulkAddChoresModal({ open, onOpenChange, profiles, onSaveChores }: BulkAddChoresModalProps) {
  const { toast } = useToast();
  const [chores, setChores] = useState<BulkChoreData[]>([]);
  const [newNames, setNewNames] = useState("");
  const [addMore, setAddMore] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const activeProfiles = profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false);

  const resetWizard = () => {
    setChores([]);
    setNewNames("");
    setAddMore("");
    setExpandedIds(new Set());
  };

  const handleClose = () => {
    resetWizard();
    onOpenChange(false);
  };

  const makeChore = (name: string): BulkChoreData => ({
    id: newId(),
    title: name,
    icon: "",
    description: "",
    profileIds: [],
    daysOfWeek: [],
    points: 1,
    recurrenceType: "weekly",
    endDate: null,
    targetCount: null,
  });

  const addChoresFromText = (text: string) => {
    const names = text.split("\n").map(n => n.trim()).filter(n => n.length > 0);
    if (names.length === 0) return;
    setChores(prev => [...prev, ...names.map(makeChore)]);
  };

  // ── Per-chore mutations ──
  const patchChore = (id: string, patch: Partial<BulkChoreData>) => {
    setChores(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeChore = (id: string) => {
    setChores(prev => prev.filter(c => c.id !== id));
    setExpandedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const toggleProfile = (id: string, profileId: string) => {
    setChores(prev => prev.map(c => {
      if (c.id !== id) return c;
      const has = c.profileIds.includes(profileId);
      return { ...c, profileIds: has ? c.profileIds.filter(p => p !== profileId) : [...c.profileIds, profileId] };
    }));
  };

  const toggleDay = (id: string, day: number) => {
    setChores(prev => prev.map(c => {
      if (c.id !== id) return c;
      const has = c.daysOfWeek.includes(day);
      const daysOfWeek = (has ? c.daysOfWeek.filter(d => d !== day) : [...c.daysOfWeek, day]).sort((a, b) => a - b);
      return { ...c, daysOfWeek, targetCount: null };
    }));
  };

  // ── Apply-to-all mutations ──
  const patchAll = (patch: Partial<BulkChoreData>) => setChores(prev => prev.map(c => ({ ...c, ...patch })));

  const allHaveProfile = (id: string) => chores.length > 0 && chores.every(c => c.profileIds.includes(id));
  const allHaveDay = (d: number) => chores.length > 0 && chores.every(c => c.targetCount == null && c.daysOfWeek.includes(d));
  const allHavePoints = (p: number) => chores.length > 0 && chores.every(c => c.points === p);
  const allHaveRecurrence = (r: "weekly" | "monthly") => chores.length > 0 && chores.every(c => c.recurrenceType === r);

  const toggleProfileAll = (profileId: string) => {
    const remove = allHaveProfile(profileId);
    setChores(prev => prev.map(c => {
      const has = c.profileIds.includes(profileId);
      if (remove) return { ...c, profileIds: c.profileIds.filter(p => p !== profileId) };
      return has ? c : { ...c, profileIds: [...c.profileIds, profileId] };
    }));
  };

  const setDaysAll = (days: number[]) => patchAll({ daysOfWeek: [...days].sort((a, b) => a - b), targetCount: null });
  const toggleDayAll = (d: number) => {
    const remove = allHaveDay(d);
    setChores(prev => prev.map(c => {
      const base = c.targetCount != null ? [] : c.daysOfWeek;
      const has = base.includes(d);
      const daysOfWeek = (remove
        ? base.filter(x => x !== d)
        : has ? base : [...base, d]).sort((a, b) => a - b);
      return { ...c, daysOfWeek, targetCount: null };
    }));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const choresToSave: InsertChore[] = chores.map(chore => ({
        title: chore.title,
        icon: chore.icon || null,
        description: chore.description || null,
        points: chore.points,
        // Target chores may be unassigned (open to the whole family); regular chores default to all profiles.
        // Same reasoning for days: an unconfigured chore defaults to every day, not a silently narrower
        // weekdays-only subset — a chore created on a Saturday with no days picked should still show up today.
        profileIds: chore.targetCount != null
          ? chore.profileIds
          : (chore.profileIds.length > 0 ? chore.profileIds : activeProfiles.map(p => p.id)),
        daysOfWeek: chore.targetCount != null ? [0, 1, 2, 3, 4, 5, 6] : (chore.daysOfWeek.length > 0 ? chore.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]),
        recurrenceType: chore.recurrenceType,
        targetCount: chore.targetCount ?? null,
        endDate: chore.endDate,
      }));
      await onSaveChores(choresToSave);
      handleClose();
    } catch (error: any) {
      console.error("Failed to save chores:", error);
      toast({
        title: "Couldn't create these chores",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Empty state: bulk name entry ──
  const renderEmptyState = () => (
    <div className="space-y-4">
      <div className="text-center">
        {/* No "type each chore on its own line" line: the placeholder below
            is four example chores on four lines, which shows the shape. */}
        <h3 className="text-lg font-semibold">Add Your Chores</h3>
      </div>
      <Textarea
        value={newNames}
        onChange={(e) => setNewNames(e.target.value)}
        placeholder="Clean bedroom&#10;Take out trash&#10;Feed the dog&#10;Do homework"
        className="min-h-[200px] text-base"
        autoFocus
      />
      <Button
        className="w-full"
        disabled={newNames.trim().split("\n").filter(n => n.trim()).length === 0}
        onClick={() => { addChoresFromText(newNames); setNewNames(""); }}
      >
        <Plus className="w-4 h-4 mr-1" />
        Add {newNames.trim().split("\n").filter(n => n.trim()).length || ""} chores
      </Button>
    </div>
  );

  // ── Apply-to-all bar ──
  const renderApplyToAll = () => (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-2.5">
      <p className="text-xs font-bold text-primary uppercase tracking-wide">Apply to all {chores.length} chores</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* People */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground w-12">People</span>
          <div className="flex gap-1">
            {activeProfiles.map(p => (
              <AvatarToggle key={p.id} profile={p} active={allHaveProfile(p.id)} onClick={() => toggleProfileAll(p.id)} />
            ))}
          </div>
        </div>

        {/* Days */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground w-12">Days</span>
          <div className="flex gap-1 flex-wrap">
            {DAYS_OF_WEEK.map(d => (
              <DayToggle key={d.value} day={d} active={allHaveDay(d.value)} onClick={() => toggleDayAll(d.value)} />
            ))}
          </div>
          <div className="flex gap-1 ml-1 flex-wrap">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDaysAll([0, 1, 2, 3, 4, 5, 6])}>All</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDaysAll([1, 2, 3, 4, 5])}>Wkdy</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDaysAll([0, 6])}>Wknd</Button>
          </div>
        </div>

        {/* Points */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground w-12">Stars</span>
          <div className="flex gap-1 flex-wrap">
            {POINT_OPTIONS.map(pts => (
              <button
                key={pts}
                onClick={() => patchAll({ points: pts })}
                className={cn(
                  "h-7 rounded-md text-xs font-bold transition-all border px-1.5 min-w-[28px]",
                  allHavePoints(pts)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-yellow-50 border-yellow-300 hover:bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:border-yellow-700 dark:text-yellow-100 dark:hover:bg-yellow-900"
                )}
              >
                {pts === 0 ? "—" : pts}
              </button>
            ))}
          </div>
        </div>

        {/* Recurrence */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground w-12">Repeat</span>
          <div className="flex gap-1">
            {(["weekly", "monthly"] as const).map(r => (
              <button
                key={r}
                onClick={() => patchAll({ recurrenceType: r })}
                className={cn(
                  "h-7 rounded-md text-xs font-medium transition-all border px-2 capitalize",
                  allHaveRecurrence(r)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-blue-50 border-blue-300 hover:bg-blue-100 text-blue-900 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── A single chore row ──
  const renderChoreRow = (chore: BulkChoreData) => {
    const isTarget = chore.targetCount != null;
    const expanded = expandedIds.has(chore.id);
    return (
      <div key={chore.id} className="rounded-lg border border-border bg-background p-2.5 space-y-2">
        {/* Icon + name + delete */}
        <div className="flex items-center gap-2">
          <div className="shrink-0">
            <EmojiPicker
              value={chore.icon}
              onChange={(emoji) => patchChore(chore.id, { icon: emoji })}
            />
          </div>
          {chore.icon && (
            <button
              type="button"
              onClick={() => patchChore(chore.id, { icon: "" })}
              title="Clear icon"
              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <Input
            value={chore.title}
            onChange={(e) => patchChore(chore.id, { title: e.target.value })}
            className="h-8 text-sm font-medium flex-1"
            placeholder="Chore name"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive shrink-0" onClick={() => removeChore(chore.id)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* People */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-1 -mx-1",
            chore.profileIds.length === 0 && chore.targetCount == null && "ring-1 ring-amber-400 dark:ring-amber-600 bg-amber-50 dark:bg-amber-950/30",
          )}
        >
          <span className="text-xs text-muted-foreground w-12 shrink-0">People</span>
          <div className="flex gap-1 flex-wrap">
            {activeProfiles.map(p => (
              <AvatarToggle key={p.id} profile={p} size="sm" active={chore.profileIds.includes(p.id)} onClick={() => toggleProfile(chore.id, p.id)} />
            ))}
          </div>
          {chore.profileIds.length === 0 && (
            <span className={cn(
              "text-[10px] italic",
              chore.targetCount != null ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500 font-medium not-italic",
            )}>
              {chore.targetCount != null ? "open to all" : "not assigned yet"}
            </span>
          )}
        </div>

        {/* Schedule */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground w-12 shrink-0">When</span>
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => patchChore(chore.id, { targetCount: null })}
              className={cn("px-2 py-1 text-xs font-medium", !isTarget ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
            >
              Specific days
            </button>
            <button
              onClick={() => patchChore(chore.id, { targetCount: chore.targetCount ?? 1, daysOfWeek: [] })}
              className={cn("px-2 py-1 text-xs font-medium", isTarget ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
            >
              Target count
            </button>
          </div>
          {isTarget ? (
            <div className="flex items-center gap-1 flex-wrap">
              <Input
                type="number"
                min={1}
                max={100}
                value={chore.targetCount ?? 1}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) patchChore(chore.id, { targetCount: v }); }}
                className="h-7 w-20 text-xs"
              />
              <span className="text-xs text-muted-foreground">x / {chore.recurrenceType === "weekly" ? "week" : "month"}</span>
              <span className="text-[10px] text-blue-500 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 leading-tight">Complete any day — no schedule needed</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              <div className="flex gap-1 flex-wrap">
                {DAYS_OF_WEEK.map(d => (
                  <DayToggle key={d.value} day={d} active={chore.daysOfWeek.includes(d.value)} onClick={() => toggleDay(chore.id, d.value)} />
                ))}
              </div>
              <div className="flex gap-1 flex-wrap">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => patchChore(chore.id, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], targetCount: null })}>All</Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => patchChore(chore.id, { daysOfWeek: [1, 2, 3, 4, 5], targetCount: null })}>Wkdy</Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => patchChore(chore.id, { daysOfWeek: [0, 6], targetCount: null })}>Wknd</Button>
              </div>
            </div>
          )}
        </div>

        {/* Points + repeat */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground w-12 shrink-0">Pts</span>
          <div className="flex gap-1 flex-wrap">
            {POINT_OPTIONS.map(pts => (
              <button
                key={pts}
                onClick={() => patchChore(chore.id, { points: pts })}
                className={cn(
                  "h-7 rounded-md text-xs font-bold transition-all border px-1.5 min-w-[28px]",
                  chore.points === pts
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-yellow-50 border-yellow-300 hover:bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:border-yellow-700 dark:text-yellow-100 dark:hover:bg-yellow-900"
                )}
              >
                {pts === 0 ? "—" : pts}
              </button>
            ))}
            <Input
              type="number"
              min={0}
              max={999}
              value={POINT_OPTIONS.includes(chore.points) ? "" : chore.points}
              placeholder="•••"
              onChange={(e) => { const v = parseInt(e.target.value); patchChore(chore.id, { points: isNaN(v) ? 0 : Math.max(0, v) }); }}
              className="h-7 w-20 text-xs"
            />
          </div>
          <div className="flex gap-1 ml-auto">
            {(["weekly", "monthly"] as const).map(r => (
              <button
                key={r}
                onClick={() => patchChore(chore.id, { recurrenceType: r })}
                className={cn(
                  "h-7 rounded-md text-xs font-medium transition-all border px-2 capitalize",
                  chore.recurrenceType === r
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-blue-50 border-blue-300 hover:bg-blue-100 text-blue-900 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* More: description + end date */}
        <button
          onClick={() => toggleExpanded(chore.id)}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Less" : "Description & end date"}
        </button>
        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <Input
              value={chore.description}
              onChange={(e) => patchChore(chore.id, { description: e.target.value })}
              placeholder="Optional description"
              className="h-8 text-sm"
            />
            <div className="flex gap-1">
              <Input
                type="date"
                value={chore.endDate ? chore.endDate.toISOString().split("T")[0] : ""}
                onChange={(e) => patchChore(chore.id, { endDate: e.target.value ? new Date(e.target.value) : null })}
                className="h-8 text-sm flex-1"
              />
              {chore.endDate && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => patchChore(chore.id, { endDate: null })}>Clear</Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk Add Chores</DialogTitle>
        </DialogHeader>

        {chores.length === 0 ? (
          renderEmptyState()
        ) : (
          <div className="space-y-3">
            {chores.length > 1 && renderApplyToAll()}

            <div className="space-y-2">
              {chores.map(renderChoreRow)}
            </div>

            {/* Add more */}
            <div className="flex items-start gap-2 pt-1">
              <Textarea
                value={addMore}
                onChange={(e) => setAddMore(e.target.value)}
                placeholder="Add more chores (one per line)…"
                className="min-h-[40px] text-sm flex-1"
                rows={1}
              />
              <Button
                variant="outline"
                disabled={addMore.trim().length === 0}
                onClick={() => { addChoresFromText(addMore); setAddMore(""); }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t mt-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {chores.length > 0 && (
            <Button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSaving ? "Saving..." : (
                <span className="flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  Save All ({chores.length})
                </span>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
