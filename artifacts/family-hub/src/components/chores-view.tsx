import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChoreIcon } from "@/components/customChoreIcons";
import { objectUrl } from "@/lib/apiBase";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import { Profile, Chore, ChoreCompletion, InsertChore, InsertChoreCompletion, Reward, RewardSettings, isRequiredChoreTaskType } from "@workspace/shared-types";
import { ChoreDisplay } from "@/lib/types";
import { useParentGate, isKidContext } from "@/lib/parentGate";
import { maybeRequestReview } from "@/lib/reviewPrompt";
import { useTriggerEffect } from "@/lib/useTriggerEffect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommentThread } from "./comment-thread";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { isChoreScheduledForDate, getPeriodProgress as getPeriodProgressShared, isFutureDate } from "@/lib/choreSchedule";
import { hasCelebratedAllDone, markCelebratedAllDone, clearCelebratedAllDone } from "@/lib/allDoneCelebration";
import { confirmDialog, chooseDialog } from "@/lib/confirmDialog";
import { SwipeToRemoveRow } from "@/components/swipe-to-remove-row";
import { Plus, Star, Trophy, Check, Edit, Trash2, Flame, Target, Gift, Sparkles, Shirt, UtensilsCrossed, BookOpen, Trash, Dog, Car, Bath, Bed, Snowflake, ListChecks, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { format, isToday } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { BulkAddChoresModal } from "./bulk-add-chores-modal";
import { ChoreManagementDrawer } from "./chore-management-drawer";
import { EmojiPicker } from "./EmojiPicker";
import { PER_DAY_STARS_EXPLAINER } from "@/lib/copy";

interface ProfileStats {
  profileId: string;
  points: number;
  streak: number;
  completionCount: number;
  categoryCounts: Record<string, number>;
}

interface ChoresViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  selectedDate: Date;
  /** When true, hide the view's own page title — it's shown by the enclosing card header. */
  embedded?: boolean;
  /** When true, render profile chore lists in a 2-column side-by-side grid. */
  wideMode?: boolean;
  /** Called when a profile row is tapped in the all-family summary view. */
  onSelectProfile?: (profileId: string) => void;
  /** Increment to programmatically open the Add Chore modal. */
  triggerAdd?: number;
  /** Increment to programmatically toggle the Manage Chores drawer. */
  triggerManage?: number;
  /** Increment to programmatically open (never close) the Manage Chores drawer. */
  triggerManageOpen?: number;
  /** Controlled Fun Mode state — when provided (embedded usage), the toggle button renders in the enclosing card header instead of its own row. */
  funMode?: boolean;
  onToggleFunMode?: () => void;
  /** Scope this card's displayed list to just to-dos, or everything except to-dos — used to split To-Dos into its own card on the Tasks tab. Manage/Bulk-Add/Spin-the-Wheel still operate on the full chore list either way. */
  taskTypeFilter?: "todos" | "non-todos";
  /** To-Dos card: opens the Add To-Do quick dialog (owned by family-hub)
   * instead of the chores Bulk Add screen. */
  onRequestAddTodo?: () => void;
  /** Main Tasks card: routes the "add" affordances to the unified
   *  Create-a-task picker instead of the legacy Bulk Add screen. */
  onRequestCreate?: () => void;
  /** Opens the unified Create/Edit task modal for a chore, and deletes one
   * (PIN-gated by kind) — surfaced on the inspiration-item detail popup. */
  onEditChore?: (chore: Chore) => void;
  onDeleteChore?: (chore: Chore) => void;
}

export const TASK_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: "chore",        label: "Chore",        emoji: "🧹" },
  { value: "todo",         label: "To-Do",        emoji: "✅" },
  { value: "memory_verse", label: "Memory Verse", emoji: "📖" },
  { value: "affirmation",  label: "Affirmation",  emoji: "💬" },
  { value: "bible_verse",  label: "Bible Verse",  emoji: "📜" },
  { value: "mission",      label: "Mission",      emoji: "❤️" },
  { value: "custom",       label: "Other",        emoji: "📝" },
];

export function taskTypeMeta(value: string | null | undefined) {
  return TASK_TYPES.find(t => t.value === value) ?? TASK_TYPES[0];
}

// Inline "N times per week/month" control, replacing a separate number-input
// + period-dropdown pair. Plain native <select> elements (not the Radix
// Select used elsewhere in this form) rather than a text input specifically
// because iOS renders a native <select> as a scrolling wheel picker — the
// number input required tapping into the field, selecting the existing
// digit, then retyping (no reliable "clear" via the keyboard's delete key),
// which this sidesteps entirely.
function TargetCountPicker({
  count,
  period,
  onCountChange,
  onPeriodChange,
  idPrefix,
}: {
  count: number | null;
  period: "weekly" | "monthly";
  onCountChange: (n: number) => void;
  onPeriodChange: (p: "weekly" | "monthly") => void;
  idPrefix: string;
}) {
  return (
    <div>
      <Label htmlFor={`${idPrefix}-targetCount`}>Target Count</Label>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-sm text-muted-foreground">Complete</span>
        <select
          id={`${idPrefix}-targetCount`}
          value={count ?? 1}
          onChange={(e) => onCountChange(Number(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm font-semibold text-center"
          data-testid={`${idPrefix}-target-count-select`}
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">time{count === 1 ? "" : "s"} per</span>
        <select
          value={period}
          onChange={(e) => onPeriodChange(e.target.value as "weekly" | "monthly")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm font-medium"
          data-testid={`${idPrefix}-target-period-select`}
        >
          <option value="weekly">week</option>
          <option value="monthly">month</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        No fixed days — just needs to be done this many times. If it's open to whoever
        gets to it first instead of one specific person, use Bonus Chores instead.
      </p>
    </div>
  );
}

// Rough effort-based point tiers, shown as tappable suggestions next to the
// Points field — families consistently ask "how many points should this be
// worth?" with no anchor to start from. Converts to the family's actual
// $-per-point rate (already configured in Rewards & Approvals) so the
// suggestion reads as a real dollar amount, not an abstract number.
const POINT_TIERS: { label: string; points: number }[] = [
  { label: "Quick (a few min)", points: 1 },
  { label: "Medium (10–20 min)", points: 3 },
  { label: "Big job (30+ min)", points: 6 },
];

export function PointsSuggestionHint({
  points,
  onPick,
}: {
  points: number;
  onPick: (n: number) => void;
}) {
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const centsPerPoint = rewardSettings?.centsPerPoint ?? 0;
  const dollarValue = (n: number) => ((n * centsPerPoint) / 100).toFixed(2);

  return (
    <div className="mt-1.5 space-y-1">
      {centsPerPoint > 0 && points > 0 && (
        <p className="text-xs text-muted-foreground">≈ ${dollarValue(points)} at your family's rate</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {POINT_TIERS.map((tier) => (
          <button
            key={tier.points}
            type="button"
            onClick={() => onPick(tier.points)}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border transition-colors",
              points === tier.points
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent",
            )}
          >
            {tier.label}: {tier.points}{centsPerPoint > 0 ? ` (~$${dollarValue(tier.points)})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// Small 8-particle emoji burst — same shape as the Stars card's own tap
// animation in home-view.tsx, just reusable for both the star badge (⭐) and
// the streak badge (🔥) here.
function BadgeBurst({ emoji }: { emoji: string }) {
  return (
    <AnimatePresence>
      {[...Array(8)].map((_, i) => {
        const angle = ((i * 45) - 90) * (Math.PI / 180);
        const dist = 30 + (i % 2) * 12;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        return (
          <motion.span
            key={i}
            className="absolute pointer-events-none"
            style={{ left: "50%", top: "50%", translateX: "-50%", translateY: "-50%", fontSize: 9 + (i % 3) * 3 }}
            initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            animate={{ opacity: 0, x: tx, y: ty, scale: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >{emoji}</motion.span>
        );
      })}
    </AnimatePresence>
  );
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

// Card-header "trigger" props (triggerAdd/triggerManage/triggerManageOpen)
// are plain incrementing counters, consumed via the shared useTriggerEffect
// (see @/lib/useTriggerEffect for why a naive `if (trigger > 0)` effect
// mis-fires on remount).
export function ChoresView({ selectedProfiles, profiles, selectedDate, embedded = false, wideMode = false, onSelectProfile, triggerAdd = 0, triggerManage = 0, triggerManageOpen = 0, funMode: funModeProp, onToggleFunMode, taskTypeFilter, onRequestAddTodo, onRequestCreate, onEditChore, onDeleteChore }: ChoresViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { guard: guardParentAction, gateDialog: parentGateDialog } = useParentGate(profiles, selectedProfiles);
  // Same definition the PIN gate uses — a kid on the shared iPad must never
  // be the one asked to rate the app.
  const kidContext = isKidContext(profiles, selectedProfiles);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  // Every "open the add-chore flow" entry point (header button, empty state,
  // Manage drawer, global "+" menu's triggerAdd) routes through these so
  // creating a chore is PIN-gated in one place instead of at each trigger.
  // The To-Dos card gates under "createTodo" (ungated by default) instead of
  // "createChore" so to-dos aren't locked for kids unless a family opts in.
  const gateKey = taskTypeFilter === "todos" ? "createTodo" : "createChore";
  const openAddModal = () => guardParentAction(gateKey, () => setShowAddModal(true));
  const openBulkAddModal = () => guardParentAction(gateKey, () => setShowBulkAddModal(true));
  const [choresColumns, setChoresColumns] = useState<2 | 3>(() =>
    localStorage.getItem('familyHub_choresColumns') === '3' ? 3 : 2
  );
  // Fun Mode: per-device (not per-family) — a kitchen iPad can stay big/kid-
  // friendly while a parent's phone stays compact. Default OFF (compact):
  // Non-Fun Mode matches the Home screen's plain compact row style; Fun Mode
  // restores the bigger, colorful, more kid-friendly card look.
  // Controlled by the parent (family-hub.tsx's card header) when embedded so
  // the toggle button can live in the shared card header instead of its own
  // row; falls back to owning its own state when used standalone.
  const [internalFunMode, setInternalFunMode] = useState<boolean>(() => localStorage.getItem('familyHub_tasksFunMode') === 'true');
  const funMode = funModeProp ?? internalFunMode;
  const toggleFunMode = onToggleFunMode ?? (() => {
    setInternalFunMode((v) => {
      const next = !v;
      localStorage.setItem('familyHub_tasksFunMode', String(next));
      return next;
    });
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [celebratingChore, setCelebratingChore] = useState<string | null>(null);
  // Which header badge (keyed `${profileId}:star` / `${profileId}:streak`)
  // is mid-tap-animation — mirrors the Stars card's own tap-to-celebrate.
  const [badgeBurst, setBadgeBurst] = useState<string | null>(null);
  const fireBadgeBurst = (key: string) => {
    setBadgeBurst(key);
    setTimeout(() => setBadgeBurst(null), 700);
  };
  const [celebratingProfile, setCelebratingProfile] = useState<string | null>(null);
  const [flyingStars, setFlyingStars] = useState<{
    id: string; points: number | null; // null = star-only, no "+N" (per_completion checklist chores)
    fromX: number; fromY: number;
    toX: number; toY: number;
    trail: Array<{ driftX: number; driftY: number }>;
  }[]>([]);
  const profileStarBadgeRefs = useRef<Record<string, HTMLElement | null>>({});
  const fireConfetti = useCallback(() => {
    // First burst from center
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { x: 0.5, y: 0.55 },
      colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'],
      startVelocity: 45,
      gravity: 0.9,
      ticks: 200,
    });
    // Left cannon after short delay
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.65 },
        colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'],
        startVelocity: 50,
        ticks: 180,
      });
    }, 150);
    // Right cannon after short delay
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.65 },
        colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'],
        startVelocity: 50,
        ticks: 180,
      });
    }, 300);
    // Final shower burst
    setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 120,
        origin: { x: 0.5, y: 0.3 },
        colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'],
        startVelocity: 20,
        gravity: 1.2,
        ticks: 250,
      });
    }, 500);
  }, []);
  const [showManageDrawer, setShowManageDrawer] = useState(false);
  const [viewingAffirmation, setViewingAffirmation] = useState<ChoreDisplay | null>(null);

  // Ticks every second so the 30s "stay visible after completion" timer updates
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Ids the user has just ticked, with the moment they tapped. The 30s
  // "hold it in place before it drops into Done" window used to key off the
  // completion's own timestamp, which works for today (stamped `new Date()`)
  // but not for a backfilled day — those are stamped at noon of that day, so
  // the row read as hours old and collapsed into Done instantly. Recency is
  // about when you tapped, not what date the completion is recorded under.
  const [justCompleted, setJustCompleted] = useState<Record<string, number>>({});
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Per-profile toggle for the collapsed "Done" section (keyed by profileId)
  const [showDoneTasks, setShowDoneTasks] = useState<Record<string, boolean>>({});

  // External triggers from card header buttons
  // The To-Dos card's "add" goes to the Add To-Do quick dialog, not the
  // chores Bulk Add screen it previously (wrongly) opened.
  const isTodosCard = taskTypeFilter === "todos";
  // Prefer the unified picker (onRequestCreate) over the legacy Bulk Add
  // screen for the main Tasks card; the To-Dos card routes to its to-do form.
  const addAction = isTodosCard && onRequestAddTodo ? onRequestAddTodo : (onRequestCreate ?? openBulkAddModal);
  useTriggerEffect(triggerAdd, addAction);
  useTriggerEffect(triggerManage, () => setShowManageDrawer(v => !v));
  // Separate from triggerManage above: that one *toggles* (so re-pressing the
  // card header's own manage button closes it), which meant a caller that
  // just wants to definitely land on an open drawer (e.g. a toast's "Manage
  // Chores" action, fired from a completely different tab) could instead
  // close it if the toggle's parity happened to already be "open" — looking
  // like the button silently did nothing. This one always opens.
  useTriggerEffect(triggerManageOpen, () => setShowManageDrawer(true));
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    icon: "",
    taskType: "chore",
    points: 1,
    profileIds: [] as string[],
    daysOfWeek: [] as number[],
    recurrenceType: "weekly" as "weekly" | "monthly",
    targetCount: null as number | null,
    endDate: null as Date | null,
  });
  const [scheduleMode, setScheduleMode] = useState<"days" | "target">("days");

  const { data: allChores = [], isLoading: choresLoading } = useQuery<Chore[]>({
    queryKey: ["/api/chores"],
  });

  // When this card is scoped to a single task type (the standalone To-Dos
  // card vs. the main Tasks/Chores card), both the display list AND the
  // Manage drawer are scoped to that kind — each card manages its own items
  // (user decision: separate To-Dos management, not a shared drawer).
  const chores = taskTypeFilter === "todos"
    ? allChores.filter(c => c.taskType === "todo")
    : taskTypeFilter === "non-todos"
      ? allChores.filter(c => c.taskType !== "todo")
      : allChores;

  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  // "Not today" skips — one chore, one person, one day. The permanent
  // counterpart (unassigning the person) lives in the same swipe menu.
  const { data: choreSkips = [] } = useQuery<{ choreId: string; profileId: string; skipDate: string }[]>({
    queryKey: ["/api/chore-skips"],
  });
  const skippedKeys = useMemo(
    () => new Set(choreSkips.map(s => `${s.choreId}|${s.profileId}|${new Date(s.skipDate).toDateString()}`)),
    [choreSkips],
  );
  const isSkipped = (choreId: string, profileId: string) =>
    skippedKeys.has(`${choreId}|${profileId}|${selectedDate.toDateString()}`);

  const { data: rewards = [] } = useQuery<Reward[]>({
    queryKey: ["/api/rewards"],
  });

  // Family points mode. In "per_completion" the individual required chores
  // no longer carry points (finishing the whole daily checklist earns a flat
  // bonus instead), so the star-pill total can't be a client sum of
  // completion points — it must come from the authoritative backend total
  // (which includes the daily bonus). per_chore mode is unchanged.
  const { data: rewardSettingsCfg } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const perCompletionMode = rewardSettingsCfg?.pointsMode === "per_completion";
  const backendPointsQueries = useQueries({
    queries: selectedProfiles.map((profileId) => ({
      queryKey: ["/api/points", profileId],
      enabled: !!profileId,
      staleTime: 15_000,
    })),
  });
  const backendPointsMap = new Map<string, number | undefined>(
    selectedProfiles.map((pid, i) => [pid, (backendPointsQueries[i]?.data as { points?: number } | undefined)?.points]),
  );
  // Always the server's authoritative balance (subtracts redemptions,
  // includes bonuses/adjustments); client sum only bridges the first paint.
  const displayPoints = (profileId: string, clientSum: number) =>
    backendPointsMap.get(profileId) ?? clientSum;

  type StreakDetails = {
    streak: number;
    weekKey: string;
    hasFreezeThisWeek: boolean;
    frozenDates: string[];
    canUseFreezeForYesterday: boolean;
  };
  const streakQueries = useQueries({
    queries: selectedProfiles.map((profileId) => ({
      queryKey: ["/api/streak-freezes", profileId],
      queryFn: async () => {
        // apiRequest so this resolves to the backend origin and carries the
        // native bearer token — a raw relative fetch fails on the iOS app.
        const res = await apiRequest("GET", `/api/streak-freezes/${profileId}`);
        return (await res.json()) as StreakDetails;
      },
      enabled: !!profileId,
      staleTime: 30_000,
    })),
  });

  const useFreezeMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await apiRequest("POST", `/api/streak-freezes/${profileId}/use`, {});
      return res.json();
    },
    onSuccess: (_data, profileId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
      toast({ title: "Streak freeze used", description: "Yesterday's gap is bridged." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't use freeze", description: err?.message ?? "Try again later", variant: "destructive" });
    },
  });

  const profileStats = useMemo(() => {
    return selectedProfiles.map(profileId => {
      const profileCompletions = choreCompletions.filter(c => c.profileId === profileId);
      
      const totalPoints = profileCompletions.reduce((sum, c) => sum + (c.points || 0), 0);
      
      const sortedDates = Array.from(new Set(
        profileCompletions
          .filter(c => c.completedAt)
          .map(c => new Date(c.completedAt!).toDateString())
      )).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (let i = 0; i < sortedDates.length; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() - i);
        if (sortedDates.includes(checkDate.toDateString())) {
          streak++;
        } else {
          break;
        }
      }
      
      return {
        profileId,
        points: totalPoints,
        streak,
      };
    });
  }, [selectedProfiles, choreCompletions]);

  // Show family summary (not per-person detail) when more than one profile is selected
  const isAllFamily = selectedProfiles.length !== 1;

  const createChoreMutation = useMutation({
    mutationFn: async (choreData: InsertChore) => {
      const response = await apiRequest("POST", "/api/chores", choreData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      toast({ title: "Task created successfully!" });
      setShowAddModal(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create task", variant: "destructive" });
    },
  });

  const completeChoresMutation = useMutation({
    mutationFn: async (completionData: InsertChoreCompletion & { completedAt?: Date }) => {
      const { completedAt, ...data } = completionData;
      // The "already completed today" check on the server needs to agree with
      // what this browser considers "today" — the server's own local timezone
      // (usually UTC) can disagree with the family's, which made every
      // completion attempt get rejected for families outside that timezone.
      // Sending the local day window explicitly removes the ambiguity.
      const localDayStart = completedAt ? new Date(completedAt) : new Date();
      localDayStart.setHours(0, 0, 0, 0);
      const response = await apiRequest("POST", "/api/chore-completions", {
        ...data,
        completedAt: completedAt?.toISOString(),
        localDayStart: localDayStart.toISOString(),
      });
      return response.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const previousCompletions = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);

      const tempId = `temp-${Date.now()}`;
      const optimisticCompletion: ChoreCompletion = {
        id: tempId,
        choreId: variables.choreId,
        profileId: variables.profileId!,
        completedAt: variables.completedAt || new Date(),
        points: variables.points ?? 0,
      };

      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) => [
        ...old,
        optimisticCompletion,
      ]);

      return { previousCompletions, tempId };
    },
    onSuccess: (data, variables, context) => {
      // Swap the optimistic entry for the server-confirmed one in place, instead of
      // invalidating + refetching. A refetch can race with backend write-propagation
      // and briefly return a list missing the new completion, which made the chore
      // flash back to "active" before settling — replacing in place avoids that gap.
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.map(c => (c.id === context?.tempId ? data : c))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      // The star pills read the server's authoritative balance in BOTH modes
      // now (it subtracts redemptions / adds bonuses), so always refetch this
      // profile's total after a completion.
      queryClient.invalidateQueries({ queryKey: ["/api/points", variables.profileId] });
      // A completion (incl. a backdated one, e.g. checking off yesterday's
      // chore) can change the streak or freeze eligibility — refetch both,
      // since neither refreshes on its own otherwise.
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", variables.profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
      setCelebratingChore(`${variables.choreId}|${variables.profileId}`);
      setTimeout(() => setCelebratingChore(null), 600);

      const chore = allChores.find(c => c.id === variables.choreId);
      // In per_completion mode an individual chore awards nothing on its own —
      // don't promise "+N points" per chore; the whole-day bonus does that.
      const earnsOwnPoints = !perCompletionMode || chore?.isBonus || chore?.taskType === "todo";
      toast({
        title: earnsOwnPoints && (chore?.points ?? 0) > 0 ? `Great job! +${chore!.points} stars!` : "Great job! Done!",
        description: "Keep up the amazing work! 🎉"
      });
    },
    onError: (err: any, __, context) => {
      if (context?.previousCompletions) {
        queryClient.setQueryData(["/api/chore-completions"], context.previousCompletions);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      toast({ title: "Couldn't complete task", description: err?.message ?? "Try again later", variant: "destructive" });
    },
  });

  const uncompleteChoresMutation = useMutation({
    mutationFn: async (data: { choreId: string; profileId: string; date: Date }) => {
      const dateParam = data.date.toISOString().split("T")[0];
      // Same local-midnight instant the completion sent, so the server can
      // match (and remove) the day's per_completion bonus row by an identical
      // day-key regardless of its own timezone.
      const localDayStart = new Date(data.date);
      localDayStart.setHours(0, 0, 0, 0);
      const response = await apiRequest("DELETE", `/api/chore-completions/${data.choreId}/${data.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`);
      return response;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const previousCompletions = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      const dayStr = variables.date.toDateString();
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.filter(c => {
          if (c.choreId !== variables.choreId || c.profileId !== variables.profileId) return true;
          if (!c.completedAt) return true;
          return new Date(c.completedAt).toDateString() !== dayStr;
        })
      );
      
      return { previousCompletions };
    },
    onSuccess: (_data, variables) => {
      // Skip re-invalidating chore-completions: the optimistic removal in onMutate
      // already reflects the deletion, and a refetch here can race with backend
      // write-propagation and briefly show the chore as still completed.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      // Un-checking changes the balance (and may revoke the day's bonus in
      // per_completion mode) — refetch the authoritative total the pills read.
      queryClient.invalidateQueries({ queryKey: ["/api/points", variables.profileId] });
      // Un-checking (e.g. undoing yesterday's completion) can also change the
      // streak or freeze eligibility.
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", variables.profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
      toast({ title: "Task unchecked" });
    },
    onError: (_, __, context) => {
      if (context?.previousCompletions) {
        queryClient.setQueryData(["/api/chore-completions"], context.previousCompletions);
      }
      toast({ title: "Failed to uncheck task", variant: "destructive" });
    },
  });

  const updateChoreMutation = useMutation({
    mutationFn: async (choreData: InsertChore & { id: string }) => {
      const { id, ...data } = choreData;
      const response = await apiRequest("PATCH", `/api/chores/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      toast({ title: "Task updated successfully!" });
      setShowEditModal(false);
      setEditingChoreId(null);
      resetForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update task", description: err?.message ?? "Try again later", variant: "destructive" });
    },
  });

  const deleteChoreeMutation = useMutation({
    mutationFn: async (choreId: string) => {
      const response = await apiRequest("DELETE", `/api/chores/${choreId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      toast({ title: "Task deleted successfully!" });
    },
    onError: () => {
      toast({ title: "Failed to delete task", variant: "destructive" });
    },
  });

  // Create chore display data organized by profile
  const choresByProfile = selectedProfiles.map(profileId => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return null;

    const selectedDayOfWeek = selectedDate.getDay();
    const isSelectedDateToday = isToday(selectedDate);

    // Compute period progress for target-count chores — shared with
    // people-view.tsx (src/lib/choreSchedule.ts) since both need the exact
    // same period-window math.
    const getPeriodProgress = (chore: Chore): number =>
      getPeriodProgressShared(chore, profileId, choreCompletions, selectedDate);

    const profileChores = chores
      .filter(chore => {
        // Bonus chores live exclusively in the dedicated Bonus Chores card,
        // whether assigned or not — they must never fall into a person's
        // regular chore list via the "unassigned chores show to everyone"
        // fallback below, which was previously written only with regular/
        // target chores in mind and didn't check isBonus at all.
        if (chore.isBonus) return false;
        const assignedToMe = !!chore.profileIds?.includes(profileId);
        const isUnassigned = (chore.profileIds?.length ?? 0) === 0;
        // Unassigned chores of every kind (regular, target, to-do) no longer
        // fan out to everyone's personal list. That used to be deliberate — a
        // locked "Needs assignment" row meant as a nudge — but per explicit
        // feedback it read as a bug: the chore showed on every single
        // profile, couldn't be completed by anyone until it was assigned
        // anyway, and cluttered every other person's list in the meantime.
        // Unassigned chores now stay in Manage Chores only (still tagged
        // "Unassigned" there) until someone gives them an owner.
        if (isUnassigned) return false;
        if (!assignedToMe) return false;
        if (!isChoreScheduledForDate(chore, selectedDate)) return false;
        // Skipped for this one day — off the list, still assigned.
        if (isSkipped(chore.id, profileId)) return false;

        // Target-count chores: show if target not yet reached, OR if completed today
        // (so the checked/strikethrough state is visible before it disappears)
        if (chore.targetCount && chore.targetCount > 0) {
          const progress = getPeriodProgress(chore);
          if (progress < chore.targetCount) return true;
          // Target met — still show today if completed today so the checkmark feedback is visible
          return choreCompletions.some(c =>
            c.choreId === chore.id &&
            c.profileId === profileId &&
            c.completedAt &&
            new Date(c.completedAt).toDateString() === selectedDate.toDateString()
          );
        }

        return true;
      })
      .map(chore => {
        const choreProfiles = chore.profileIds.map(id => profiles.find(p => p.id === id)).filter(Boolean);
        // To-dos are one-time items, not daily-recurring — completion must
        // stick regardless of which day is being viewed. Scoping the check
        // to `selectedDate` is correct for a recurring chore ("done today?")
        // but made a to-do completed on any earlier day silently revert to
        // "not done" the moment the calendar day rolled over, since no
        // completion record exists for the NEW day. A to-do counts as done
        // if it's EVER been completed.
        const isTodo = chore.taskType === "todo";
        // LATEST completion (of the day for chores; ever, for to-dos), not
        // the first match: if a stale completion record lingers (e.g. an
        // uncheck whose server delete missed), a fresh check-off would
        // otherwise read that old timestamp, fail the 30s-recent window,
        // and jump straight to Done.
        const selectedDateCompletion = choreCompletions
          .filter(completion => {
            if (!completion.completedAt) return false;
            if (completion.choreId !== chore.id || completion.profileId !== profileId) return false;
            if (isTodo) return true;
            const completionDate = new Date(completion.completedAt);
            return completionDate.toDateString() === selectedDate.toDateString();
          })
          .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0];
        const progress = getPeriodProgress(chore);
        const isTarget = !!(chore.targetCount && chore.targetCount > 0);
        const isUnassignedRegular = !isTarget && (chore.profileIds?.length ?? 0) === 0;

        // For target chores, find the most recent completion timestamp in the period
        // so isRecent() can grant a 30s grace period after the target is just met.
        let lastCompletionDate: Date | undefined;
        if (isTarget) {
          const periodCompletions = choreCompletions
            .filter(c => c.choreId === chore.id && c.profileId === profileId && c.completedAt)
            .map(c => new Date(c.completedAt!))
            .sort((a, b) => b.getTime() - a.getTime());
          lastCompletionDate = periodCompletions[0];
        }

        return {
          ...chore,
          profileIds: chore.profileIds,
          profileNames: choreProfiles.map(p => p!.name),
          profileColors: choreProfiles.map(p => p!.color),
          daysOfWeek: chore.daysOfWeek as number[],
          isCompleted: !!selectedDateCompletion,
          completionDate: selectedDateCompletion?.completedAt ? new Date(selectedDateCompletion.completedAt) : undefined,
          assignedProfileId: profileId,
          isTargetChore: isTarget,
          isUnassignedRegular,
          targetCount: chore.targetCount ?? null,
          targetPeriod: chore.recurrenceType,
          targetProgress: isTarget ? progress : undefined,
          lastCompletionDate,
        } as ChoreDisplay;
      });

    return {
      profile,
      chores: profileChores,
    };
  }).filter(Boolean) as Array<{ profile: Profile; chores: ChoreDisplay[] }>;

  const handleToggleChore = (chore: ChoreDisplay, e?: React.MouseEvent) => {
    if (!chore.assignedProfileId) return;
    if (chore.isUnassignedRegular) {
      toast({ title: "Assign someone first", variant: "destructive" });
      return;
    }

    if (chore.isCompleted) {
      // The day is no longer finished, so let it be celebrated again when it
      // is. Without this the flag was write-once per day and every completion
      // after the first was silent — which is what "the confetti stopped
      // working" actually was.
      clearCelebratedAllDone(chore.assignedProfileId, selectedDate, chore.taskType === "todo" ? "todos" : "chores");
      uncompleteChoresMutation.mutate({
        choreId: chore.id,
        profileId: chore.assignedProfileId,
        date: selectedDate,
      });
    } else {
      // Chores are schedule-bound and can't be checked off before their day
      // arrives; to-dos aren't tied to a schedule, so they're exempt.
      if (chore.taskType !== "todo" && isFutureDate(selectedDate)) {
        toast({
          title: "Not due yet",
          description: `Not scheduled until ${format(selectedDate, "EEEE, MMM d")}.`,
        });
        return;
      }

      hapticMedium();
      setCelebratingChore(`${chore.id}|${chore.assignedProfileId}`);
      setTimeout(() => setCelebratingChore(null), 1000);

      // In per_completion mode a checklist chore (regular, non-target,
      // non-todo) earns nothing of its own — skip the animation entirely
      // rather than just hiding the "+N" (a bare star flying to the tally
      // still visually implies stars were just added). Target chores and
      // to-dos DO earn their own points in both modes, same as the star
      // badge next to a target row already correctly shows unconditionally.
      const earnsOwn = !perCompletionMode || chore.taskType === "todo" || (chore.targetCount ?? 0) > 0;
      if (e && (chore.points ?? 0) > 0 && earnsOwn) {
        const fromRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const fromX = fromRect.left + fromRect.width / 2;
        const fromY = fromRect.top + fromRect.height / 2;
        const starBadge = profileStarBadgeRefs.current[chore.assignedProfileId!];
        const toRect = starBadge
          ? starBadge.getBoundingClientRect()
          : { left: window.innerWidth - 80, top: 80, width: 40, height: 24 };
        const toX = toRect.left + toRect.width / 2;
        const toY = toRect.top + toRect.height / 2;
        const starId = `${chore.id}-${Date.now()}`;
        setFlyingStars(prev => [...prev, {
          id: starId, points: chore.points || 1, fromX, fromY, toX, toY,
          trail: [...Array(6)].map(() => ({
            driftX: (Math.random() - 0.5) * 28,
            driftY: Math.random() * 22 + 10,
          })),
        }]);
        setTimeout(() => setFlyingStars(prev => prev.filter(s => s.id !== starId)), 3500);
      }

      // "Today" keeps the real current time (so the 30s-recent/confetti checks
      // that key off completedAt still behave exactly as before); a past (or,
      // for to-dos, future) selected date is stamped at noon of that day —
      // there's no real completion time to preserve for a backfilled day, and
      // noon avoids any UTC-boundary rollover at local midnight.
      const completedAt = isToday(selectedDate)
        ? new Date()
        : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 12, 0, 0);

      setJustCompleted(prev => ({ ...prev, [chore.id]: Date.now() }));

      completeChoresMutation.mutate({
        choreId: chore.id,
        profileId: chore.assignedProfileId,
        points: chore.points ?? 0,
        completedAt,
      });

      // Daily celebration: non-target, actually-assigned, non-to-do chores determine
      // "day complete" (matches home-view.tsx's own "all done" definition, so both
      // tabs agree on when a day counts as finished); target chores are optional.
      const profileData = choresByProfile.find(p => p.profile.id === chore.assignedProfileId);
      if (profileData) {
        const requiredChores = profileData.chores.filter(
          c => !c.isTargetChore && !c.isUnassignedRegular && isRequiredChoreTaskType(c.taskType)
        );
        const remainingRequired = requiredChores.filter(c => c.id !== chore.id && !c.isCompleted);
        // If there are regular chores, celebrate when all of them are done (regardless of targets).
        // If the user only has target chores, celebrate when all of those are done.
        const allDone = requiredChores.length > 0
          ? remainingRequired.length === 0
          : profileData.chores.filter(c => c.id !== chore.id && !c.isCompleted).length === 0 && profileData.chores.length > 0;
        if (allDone && !hasCelebratedAllDone(chore.assignedProfileId!, selectedDate)) {
          markCelebratedAllDone(chore.assignedProfileId!, selectedDate);
          // In per_completion mode, finishing the day is what earns points — call
          // it out so the reward is obvious the moment it's earned.
          if (perCompletionMode) {
            // A profile-level override (Per-Person Settings) wins over the
            // family-wide default — mirror the server's resolution.
            const bonusProfile = profiles.find(pr => pr.id === chore.assignedProfileId);
            const bonus = bonusProfile?.completionBonusPoints ?? rewardSettingsCfg?.completionBonusPoints ?? 10;
            toast({
              title: `🎉 Whole day finished — +${bonus} stars!`,
              description: "Every chore done. Bonus earned!",
            });
          }
          setTimeout(() => {
            setCelebratingProfile(chore.assignedProfileId!);
            hapticSuccess();
            fireConfetti();
            setTimeout(() => setCelebratingProfile(null), 3000);
            // Peak "this actually works" moment — the one place worth spending
            // one of iOS's ~3-per-year review prompts. Self-gating (native
            // only, not a kid context, 3+ distinct good days, once a year), so
            // it's safe to call unconditionally from here. Fires after the
            // confetti so it never lands on top of the celebration.
            setTimeout(() => maybeRequestReview({ isKidContext: kidContext }, selectedDate), 2500);
          }, 400);
        }
        // Daily celebration for To-Dos specifically — independent of the
        // chores celebration above, since a profile can finish one before
        // (or without) the other.
        const requiredTodos = profileData.chores.filter(c => c.taskType === "todo");
        const remainingTodos = requiredTodos.filter(c => c.id !== chore.id && !c.isCompleted);
        const allTodosDone = requiredTodos.length > 0 && remainingTodos.length === 0;
        if (allTodosDone && !hasCelebratedAllDone(chore.assignedProfileId!, selectedDate, "todos")) {
          markCelebratedAllDone(chore.assignedProfileId!, selectedDate, "todos");
          setTimeout(() => {
            setCelebratingProfile(chore.assignedProfileId!);
            hapticSuccess();
            fireConfetti();
            setTimeout(() => setCelebratingProfile(null), 3000);
          }, 400);
        }
        // Target-count celebration: just reached the target?
        if (chore.isTargetChore && chore.targetCount != null && chore.targetProgress != null) {
          const newProgress = chore.targetProgress + 1;
          if (newProgress === chore.targetCount) {
            setTimeout(() => {
              setCelebratingProfile(chore.assignedProfileId!);
              fireConfetti();
              toast({ title: `Target reached! ${newProgress}/${chore.targetCount} this ${chore.targetPeriod || "week"}` });
              setTimeout(() => setCelebratingProfile(null), 3000);
            }, 600);
          }
        }
      }
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      icon: "",
      taskType: "chore",
      points: 1,
      profileIds: [],
      daysOfWeek: [],
      recurrenceType: "weekly",
      targetCount: null,
      endDate: null,
    });
    setScheduleMode("days");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      toast({ title: "Please enter a title", variant: "destructive" });
      return;
    }

    if (scheduleMode === "days" && formData.daysOfWeek.length === 0) {
      toast({ title: "Please select at least one day", variant: "destructive" });
      return;
    }
    if (scheduleMode === "target" && (!formData.targetCount || formData.targetCount < 1)) {
      toast({ title: "Please enter a target count (1 or more)", variant: "destructive" });
      return;
    }

    if (formData.profileIds.length === 0) {
      const proceed = await confirmDialog({
        title: "Add without assigning anyone?",
        description: "It'll only show in the overall chores list until assigned.",
        confirmLabel: "Add anyway",
        destructive: false,
      });
      if (!proceed) return;
    }

    createChoreMutation.mutate({
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      icon: formData.icon || null,
      taskType: formData.taskType as any,
      points: formData.points,
      profileIds: formData.profileIds,
      daysOfWeek: scheduleMode === "target" ? [0,1,2,3,4,5,6] : formData.daysOfWeek,
      recurrenceType: formData.recurrenceType,
      targetCount: scheduleMode === "target" ? formData.targetCount : null,
      endDate: formData.endDate,
      isActive: true,
    });
  };

  const toggleDay = (day: number) => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter(d => d !== day)
        : [...prev.daysOfWeek, day]
    }));
  };

  const selectAllDays = () => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    }));
  };

  const selectWeekdays = () => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: [1, 2, 3, 4, 5] // Monday through Friday
    }));
  };

  const selectWeekends = () => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: [0, 6] // Sunday and Saturday
    }));
  };

  const clearDays = () => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: []
    }));
  };

  const handleEditChore = (chore: Chore) => {
    const isTarget = chore.targetCount != null && chore.targetCount > 0;
    setFormData({
      title: chore.title,
      description: chore.description || "",
      icon: chore.icon || "",
      taskType: chore.taskType || "chore",
      points: chore.points ?? 0,
      profileIds: chore.profileIds,
      daysOfWeek: chore.daysOfWeek,
      recurrenceType: (chore.recurrenceType as "weekly" | "monthly") || "weekly",
      targetCount: chore.targetCount ?? null,
      endDate: chore.endDate ? new Date(chore.endDate) : null,
    });
    setScheduleMode(isTarget ? "target" : "days");
    setEditingChoreId(chore.id);
    setShowEditModal(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      toast({ title: "Please enter a title", variant: "destructive" });
      return;
    }

    if (scheduleMode === "days" && formData.daysOfWeek.length === 0) {
      toast({ title: "Please select at least one day", variant: "destructive" });
      return;
    }
    if (scheduleMode === "target" && (!formData.targetCount || formData.targetCount < 1)) {
      toast({ title: "Please enter a target count (1 or more)", variant: "destructive" });
      return;
    }

    if (!editingChoreId) return;

    updateChoreMutation.mutate({
      id: editingChoreId,
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      icon: formData.icon || null,
      taskType: formData.taskType as any,
      points: formData.points,
      profileIds: formData.profileIds,
      daysOfWeek: scheduleMode === "target" ? [0,1,2,3,4,5,6] : formData.daysOfWeek,
      recurrenceType: formData.recurrenceType,
      targetCount: scheduleMode === "target" ? formData.targetCount : null,
      endDate: formData.endDate,
      isActive: true,
    });
  };

  const todayIndex = new Date().getDay();

  return (
    <div className="space-y-6">
      {/* Header — only shown when not embedded (standalone page). When embedded,
           the card header in family-hub.tsx owns the action buttons. */}
      {!embedded && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Family Tasks</h2>
            <p className="text-muted-foreground">Chores, to-dos &amp; more</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isAllFamily && (
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => { setChoresColumns(2); localStorage.setItem('familyHub_choresColumns', '2'); }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${choresColumns === 2 ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                >2</button>
                <button
                  onClick={() => { setChoresColumns(3); localStorage.setItem('familyHub_choresColumns', '3'); }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${choresColumns === 3 ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                >3</button>
              </div>
            )}
            <Button variant="outline" onClick={() => setShowManageDrawer(v => !v)} data-testid="manage-chores-button">
              <ListChecks className="w-4 h-4 mr-2" />
              Manage
            </Button>
            <Button onClick={openBulkAddModal} className="bg-primary text-primary-foreground hover:bg-primary/90" data-testid="add-chore-button">
              <Plus className="w-4 h-4 mr-2" />
              Add chore
            </Button>
          </div>
        </div>
      )}

      {choresLoading && chores.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="chores-loading">
          <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
          Loading…
        </div>
      )}

      {/* No chores/to-dos configured for the family at all yet (as opposed to
          "none scheduled today") — point straight at the header's Add button.
          Gated on !choresLoading so it doesn't flash on every cold start. */}
      {!choresLoading && chores.length === 0 && (
        <div className="text-center py-12 rounded-2xl border border-dashed border-border bg-accent/20">
          <ListChecks className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">
            {taskTypeFilter === "todos" ? "No to-dos yet" : "No chores or to-dos yet"}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {taskTypeFilter === "todos"
              ? "Add a to-do to start tracking one-off tasks."
              : "Add a chore to start tracking tasks and earning stars."}
          </p>
          <Button onClick={addAction} data-testid="add-first-chore-button">
            <Plus className="w-4 h-4 mr-2" />
            {taskTypeFilter === "todos" ? "Add a To-Do" : "Add a Chore"}
          </Button>
        </div>
      )}

      {/* Fun Mode toggle — per-device (localStorage), default off/compact.
          When embedded with a controlled funMode prop, the toggle button
          renders in the enclosing card header instead (see family-hub.tsx)
          to save this row's space — checking `funModeProp === undefined`
          (not `!funModeProp`) so a controlled instance whose value happens
          to BE `false` (Fun Mode off, the default) doesn't fall through and
          render this row's button too, duplicating the header's. */}
      {chores.length > 0 && funModeProp === undefined && (
        <div className="flex justify-end -mt-2">
          <button
            type="button"
            onClick={toggleFunMode}
            className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1",
              funMode
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent",
            )}
            data-testid="fun-mode-toggle"
          >
            🎉 Fun Mode
          </button>
        </div>
      )}

      {/* All-Family summary OR single-person detail.
          Suppressed entirely while the family-wide empty state above is
          showing: the two used to render together, so the card claimed "No
          chores or to-dos yet" and then listed every family member with
          "Tap a person to see their chores" underneath it. */}
      <AnimatePresence mode="wait">
      {(choresLoading || chores.length > 0) && (isAllFamily ? (
        <motion.div
          key="family-summary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="space-y-2"
        >
          {choresByProfile.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No family members selected</p>
          ) : (
            <>
              <div className={wideMode ? "grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start" : "space-y-2"}>
              {choresByProfile.map(({ profile, chores: profileChores }) => {
                const todayChores = profileChores.filter(c => !c.isTargetChore);
                const completed = todayChores.filter(c => c.isCompleted).length;
                const total = todayChores.length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const stats = profileStats.find(s => s.profileId === profile.id);
                const points = displayPoints(profile.id, stats?.points ?? 0);
                const idx = selectedProfiles.indexOf(profile.id);
                const sd = streakQueries[idx]?.data;
                const streak = sd?.streak ?? stats?.streak ?? 0;

                return (
                  <motion.div
                    layout
                    transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                    key={profile.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`See ${profile.name}'s chores`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl [@media(hover:hover)]:hover:bg-accent/50 transition-colors cursor-pointer bg-card"
                    style={{ borderLeft: `3px solid ${profile.color}` }}
                    onClick={() => onSelectProfile?.(profile.id)}
                    data-testid={`family-summary-${profile.id}`}
                  >
                    {/* Avatar */}
                    <div
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{ background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` }}
                    >
                      {profile.photoUrl ? (
                        <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" />
                      ) : profile.initials}
                    </div>

                    {/* Name + bar */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-foreground truncate">{profile.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {total === 0 ? (isTodosCard ? 'No to-dos' : 'No chores today') : `${completed}/${total} done`}
                        </span>
                      </div>
                      {total > 0 && (
                        <div className="w-full rounded-full h-1.5" style={{ backgroundColor: `${profile.color}25` }}>
                          <div
                            className="h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#86efac' : profile.color, minWidth: pct > 0 ? '4px' : undefined }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Stars + streak — hidden on the To-Dos card (to-dos
                        aren't worth stars) */}
                    {!isTodosCard && (
                    <div className="flex items-center gap-2 shrink-0">
                      {streak > 0 && (
                        <div className="flex items-center gap-0.5 text-orange-500">
                          <Flame className="w-3.5 h-3.5" />
                          <span className="text-xs font-bold">{streak}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-amber-400">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="text-sm font-bold">{points}</span>
                      </div>
                    </div>
                    )}
                    {/* The row is tappable; a chevron says so, instead of
                        leaving it to a caption under the whole list. */}
                    {onSelectProfile && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                    )}
                  </motion.div>
                );
              })}
              </div>

            </>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="person-detail"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
      <div className="space-y-8">
        {choresByProfile.map(({ profile, chores: profileChores }) => (
          <div key={profile.id} id={`chore-section-${profile.id}`} className="space-y-4 scroll-mt-24">
            {/* Profile Header */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
              {/* flex-1: without it this block sizes to its content, so a
                  longer subtitle ("11 today · 2 targets this period") ate the
                  width the badges needed and pushed the streak onto its own
                  line for that one person. It wraps now; the badges don't. */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div 
                  className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-white font-semibold text-lg"
                  style={{ 
                    background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` 
                  }}
                >
                  {profile.photoUrl ? (
                    <img 
                      src={objectUrl(profile.photoUrl)}
                      alt={profile.name} 
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    profile.initials
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">{profile.name}'s {isTodosCard ? "To-Dos" : "Chores"}</h3>
                  <p className="text-sm text-muted-foreground">
                    {(() => {
                      if (isTodosCard) {
                        const total = profileChores.length;
                        const open = profileChores.filter(c => !c.isCompleted).length;
                        if (total === 0) return 'No to-dos';
                        if (open === 0) return 'All done!';
                        return `${open} open to-do${open !== 1 ? 's' : ''}`;
                      }
                      const dayCount = profileChores.filter(c => !c.isTargetChore).length;
                      const tgtCount = profileChores.filter(c => c.isTargetChore).length;
                      if (dayCount > 0 && tgtCount > 0) return `${dayCount} today · ${tgtCount} target${tgtCount !== 1 ? 's' : ''} this period`;
                      if (dayCount > 0) return `${dayCount} ${dayCount === 1 ? 'chore' : 'chores'} today`;
                      if (tgtCount > 0) return `${tgtCount} target chore${tgtCount !== 1 ? 's' : ''} this period`;
                      return 'No chores today';
                    })()}
                  </p>
                </div>
              </div>
              
              {/* Points & Streak — hidden on the To-Dos card: to-dos aren't
                  worth stars, so a star count there was just confusing. */}
              {!isTodosCard && (() => {
                const stats = profileStats.find(s => s?.profileId === profile.id);
                const points = displayPoints(profile.id, stats?.points || 0);
                const idx = selectedProfiles.indexOf(profile.id);
                const sd = streakQueries[idx]?.data;
                const streak = sd?.streak ?? stats?.streak ?? 0;
                const isFrozen = (sd?.frozenDates?.length ?? 0) > 0;
                const canFreeze = !!sd?.canUseFreezeForYesterday;

                return (
                  <div className="flex items-center flex-nowrap justify-end gap-2 shrink-0">
                    <motion.div
                      ref={(el) => { profileStarBadgeRefs.current[profile.id] = el; }}
                      className="relative flex items-center gap-1 text-amber-400 shrink-0 cursor-pointer select-none"
                      animate={badgeBurst === `${profile.id}:star` ? { scale: [1, 1.4, 1] } : {}}
                      transition={{ duration: 0.35 }}
                      onClick={() => fireBadgeBurst(`${profile.id}:star`)}
                    >
                      <Star className="w-7 h-7 fill-current" />
                      <span className="text-xl font-bold">{points}</span>
                      <span className="text-base text-muted-foreground hidden sm:inline">stars</span>
                      {badgeBurst === `${profile.id}:star` && <BadgeBurst emoji="⭐" />}
                    </motion.div>
{streak > 0 && (
                      <motion.div
                        className="relative flex items-center gap-1 text-orange-500 shrink-0 cursor-pointer select-none"
                        data-testid={`streak-badge-${profile.id}`}
                        animate={badgeBurst === `${profile.id}:streak` ? { scale: [1, 1.4, 1] } : {}}
                        transition={{ duration: 0.35 }}
                        onClick={() => fireBadgeBurst(`${profile.id}:streak`)}
                      >
                        <Flame className="w-5 h-5" />
                        <span className="font-bold">{streak}</span>
                        <span className="text-sm text-muted-foreground hidden sm:inline">day streak</span>
                        {isFrozen && (
                          <span title="A streak freeze is bridging a missed day this week" className="ml-1 inline-flex items-center text-sky-500">
                            <Snowflake className="w-4 h-4" />
                          </span>
                        )}
                        {badgeBurst === `${profile.id}:streak` && <BadgeBurst emoji="🔥" />}
                      </motion.div>
                    )}
                    {canFreeze && (
                      // A single compact pill instead of a "Use freeze" button
                      // plus a separate (?) icon — that pair's combined width
                      // was squeezing the name column into wrapping (e.g.
                      // "Jett's Chores" splitting onto two lines). One control
                      // does both jobs: tapping it uses the freeze, and its
                      // title attribute (a hover tooltip on desktop) carries
                      // the same explanation the (?) icon used to.
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => useFreezeMutation.mutate(profile.id)}
                        disabled={useFreezeMutation.isPending}
                        title="Covers a missed day — one per week. Tap to save yesterday."
                        className="h-7 px-2 text-xs gap-1 border-sky-300 text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950 shrink-0"
                        data-testid={`use-freeze-${profile.id}`}
                      >
                        <Snowflake className="w-3.5 h-3.5" />
                        Freeze
                      </Button>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Profile's Chores — split into Today (day-based) and This Week/Month (target-count) */}
            {(() => {
              const allDayChores = profileChores.filter(c => !c.isTargetChore);
              const todayChores     = allDayChores.filter(c => !c.taskType || c.taskType === "chore");
              const todayOtherTasks = allDayChores.filter(c => c.taskType && c.taskType !== "chore" && c.taskType !== "todo");
              const todayTodos = allDayChores.filter(c => c.taskType === "todo");
              const weekChores = profileChores.filter(c => c.isTargetChore);
              const weeklyTargets = weekChores.filter(c => c.targetPeriod !== "monthly");
              const monthlyTargets = weekChores.filter(c => c.targetPeriod === "monthly");
              const hasBoth = (todayChores.length > 0 || todayOtherTasks.length > 0) && weekChores.length > 0;

              // A completed task stays in the active grid for 30 seconds before collapsing.
              // `nowMs` only ticks once per second, so a chore just completed with
              // `new Date()` reads as a moment in the "future" relative to the last tick
              // (negative age). The old `age >= 0` guard treated that as "not recent" and
              // collapsed the chore to Done instantly, then it popped back when nowMs caught
              // up — a visible flicker. Tolerate small/normal future offsets; the wide lower
              // bound still rejects genuinely bogus far-future timestamps so a skewed
              // completion can't stay "recent" forever.
              const isRecent = (chore: ChoreDisplay) => {
                const dateToCheck = chore.isTargetChore ? chore.lastCompletionDate : chore.completionDate;
                if (!dateToCheck) return false;
                const age = nowMs - dateToCheck.getTime();
                if (age < 30_000 && age > -60_000) return true;
                // Backfilled day: the stored timestamp is noon of that date, so
                // the age check above can never pass. Fall back to when it was
                // actually tapped in this session.
                const tapped = justCompleted[chore.id];
                return tapped !== undefined && nowMs - tapped < 30_000;
              };

              const activeTodayChores     = todayChores.filter(c => !c.isCompleted || isRecent(c));
              const doneTodayChores       = todayChores.filter(c =>  c.isCompleted && !isRecent(c));
              const activeTodayOtherTasks = todayOtherTasks.filter(c => !c.isCompleted || isRecent(c));
              const doneTodayOtherTasks   = todayOtherTasks.filter(c =>  c.isCompleted && !isRecent(c));
              const activeTodayTodos      = todayTodos.filter(c => !c.isCompleted || isRecent(c));
              const doneTodayTodos        = todayTodos.filter(c =>  c.isCompleted && !isRecent(c));
              // Target chores (can be completed multiple times across a
              // week/month) collapse into Done for the day the moment
              // they're checked off TODAY specifically — same day-boundary
              // rule as every other task type — then reappear the next day
              // so the same person can contribute to the target again. This
              // is independent of whether the overall weekly/monthly target
              // count has been fully met yet (that's tracked separately by
              // the progress bar on the active card).
              const activeWeeklyTargets   = weeklyTargets.filter(c => !c.isCompleted || isRecent(c));
              const doneWeeklyTargets     = weeklyTargets.filter(c =>  c.isCompleted && !isRecent(c));
              const activeMonthlyTargets  = monthlyTargets.filter(c => !c.isCompleted || isRecent(c));
              const doneMonthlyTargets    = monthlyTargets.filter(c =>  c.isCompleted && !isRecent(c));
              const doneTargets = [...doneWeeklyTargets, ...doneMonthlyTargets];
              const doneAll = [...doneTodayChores, ...doneTodayOtherTasks, ...doneTodayTodos, ...doneTargets];
              const showDone = !!showDoneTasks[profile.id];

              // Sticker slot: dashed border when empty, gold star stamp when done.
              const StickerSlot = ({ completed, testId }: { completed: boolean; testId?: string }) => (
                <div
                  data-testid={testId}
                  className={cn(
                    "rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 select-none",
                    funMode ? "w-9 h-9 text-lg" : "w-6 h-6 text-sm",
                    completed
                      ? 'bg-amber-400 text-white shadow-sm'
                      : 'border-2 border-dashed border-muted-foreground/40 bg-background/60 text-muted-foreground/30'
                  )}
                >
                  ★
                </div>
              );

              // Swipe-left "Remove from this person's list" — only touches this
              // one profile's assignment (removes profile.id from the chore's
              // profileIds), never deletes the chore itself. PIN-gated the same
              // way creating/editing this card's items already is.
              const removeFromPersonList = (chore: ChoreDisplay) => {
                guardParentAction(gateKey, async () => {
                  const noun = isTodosCard ? "to-do" : "task";
                  const dayLabel = isToday(selectedDate) ? "today" : format(selectedDate, "EEEE");
                  // Two genuinely different intents. Unassigning is permanent
                  // and duplicates what Manage tasks already does; "just for
                  // <day>" is the one this swipe is usually reached for (kid's
                  // away for the evening) and had nowhere else to live.
                  const choice = await chooseDialog({
                    title: `Take "${chore.title}" off ${profile.name}'s list?`,
                    description: `The ${noun} itself won't be deleted either way, and anyone else it's assigned to keeps it.`,
                    options: [
                      {
                        value: "today",
                        label: `Just for ${dayLabel}`,
                        description: `It comes back on ${profile.name}'s list next time it's due.`,
                      },
                      {
                        value: "forever",
                        label: "From now on",
                        description: `Unassigns ${profile.name} from this ${noun} entirely.`,
                        destructive: true,
                      },
                    ],
                  });
                  if (!choice) return;

                  if (choice === "today") {
                    const day = new Date(selectedDate);
                    day.setHours(0, 0, 0, 0);
                    try {
                      await apiRequest("POST", "/api/chore-skips", {
                        choreId: chore.id,
                        profileId: profile.id,
                        skipDate: day.toISOString(),
                      });
                      queryClient.invalidateQueries({ queryKey: ["/api/chore-skips"] });
                      toast({ title: `Skipped for ${dayLabel}` });
                    } catch (err: any) {
                      toast({ title: "Couldn't skip it", description: err?.message, variant: "destructive" });
                    }
                    return;
                  }

                  const nextProfileIds = (chore.profileIds ?? []).filter((id) => id !== profile.id);
                  try {
                    await apiRequest("PATCH", `/api/chores/${chore.id}`, { profileIds: nextProfileIds });
                    queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
                    toast({ title: `Removed from ${profile.name}'s list` });
                  } catch (err: any) {
                    toast({ title: "Couldn't remove it", description: err?.message, variant: "destructive" });
                  }
                });
              };

              // Target chores (weekly/monthly): quest card with fill bar below the row.
              const renderTargetRow = (chore: ChoreDisplay) => {
                const progress = chore.targetProgress ?? 0;
                const total = chore.targetCount ?? 1;
                const done = progress >= total;
                const pct = Math.min(100, Math.round((progress / total) * 100));

                // Non-Fun Mode: same plain compact row style renderChoreCard
                // uses for regular chores below (not a shrunk version of the
                // colorful Fun-Mode "quest" card) — target chores previously
                // had no such branch, so they stayed visually "in Fun Mode"
                // even after the toggle was turned off.
                if (!funMode) {
                  const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                  return (
                    <div
                      key={`${chore.id}-${profile.id}`}
                      onClick={(e) => handleToggleChore(chore, e)}
                      className={cn(
                        "flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none",
                        celebrating
                          ? "animate-bounce bg-green-500/10 border-green-400"
                          : done
                            ? "bg-accent/30 border-green-400/30"
                            : "bg-card border-border hover:border-orange-400/40 hover:bg-orange-500/5",
                      )}
                      data-testid={`chore-item-${chore.id}-${profile.id}`}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200",
                          done ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground hover:border-primary hover:bg-primary/10",
                        )}
                      >
                        {done && <Check className="w-3 h-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {chore.icon && <ChoreIcon icon={chore.icon} className="w-4 h-4" />}
                          <span className={cn("text-sm transition-all duration-200", done ? "line-through text-muted-foreground" : "text-foreground")}>
                            {chore.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="flex-1 max-w-[6rem] h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: done ? '#34d399' : profile.color }}
                            />
                          </div>
                          <span className={cn("text-[10px] font-medium shrink-0", done ? "text-emerald-500" : "text-muted-foreground")}>
                            🎯 {progress}/{total}
                          </span>
                        </div>
                      </div>
                      {(chore.points ?? 0) > 0 && (
                        <span className="text-xs text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                          <Star className="w-3 h-3" />
                          {chore.points}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={`${chore.id}-${profile.id}`}
                    onClick={(e) => handleToggleChore(chore, e)}
                    className={cn(
                      "break-inside-avoid rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-md",
                      "px-3 py-2.5",
                      celebratingChore === `${chore.id}|${profile.id}` ? 'animate-bounce' : ''
                    )}
                    style={{
                      borderLeft: `5px solid ${profile.color}`,
                      borderTop: `1px solid ${profile.color}30`,
                      borderRight: `1px solid ${profile.color}30`,
                      borderBottom: `1px solid ${profile.color}30`,
                      backgroundColor: chore.isCompleted ? `${profile.color}10` : `${profile.color}18`,
                    }}
                    data-testid={`chore-item-${chore.id}-${profile.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <StickerSlot completed={!!chore.isCompleted} testId={`chore-checkbox-${chore.id}-${profile.id}`} />
                      {chore.icon && (
                        <span
                          className="rounded-full flex items-center justify-center shrink-0 w-9 h-9 text-xl"
                          style={{ backgroundColor: `${profile.color}30` }}
                        >
                          <ChoreIcon icon={chore.icon} className="w-5 h-5" />
                        </span>
                      )}
                      <span className={cn(
                        "flex-1 min-w-0 font-semibold text-foreground truncate text-sm",
                        chore.isCompleted && 'line-through text-muted-foreground',
                      )}>
                        {chore.title}
                      </span>
                      {(chore.points ?? 0) > 0 && (
                        <span className="font-bold rounded-full bg-background/70 text-amber-600 shrink-0 text-xs px-2 py-0.5">
                          ⭐ {chore.points}
                        </span>
                      )}
                    </div>
                    {/* Quest progress bar */}
                    <div className="flex items-center gap-2 mt-2" style={{ paddingLeft: chore.icon ? '4.5rem' : '3rem' }}>
                      <div className="flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden h-2">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: done ? '#34d399' : profile.color }}
                        />
                      </div>
                      <span className={`text-[11px] font-bold shrink-0 ${done ? 'text-emerald-500' : 'text-sky-500'}`}>
                        🎯 {progress} of {total}
                      </span>
                    </div>
                  </div>
                );
              };

              const renderChoreCard = (chore: ChoreDisplay) => {
                // "mission"/"custom" used to fall straight through to
                // handleToggleChore with no way to ever see their content —
                // now every inspiration type opens the same detail popup
                // (which also has Edit/Delete).
                const isAffirmation = !!chore.taskType && chore.taskType !== "chore" && chore.taskType !== "todo";
                const onCardClick = (e: React.MouseEvent) => {
                  if (isAffirmation) { setViewingAffirmation(chore); }
                  else { handleToggleChore(chore, e); }
                };

                // Non-Fun Mode: match the Home screen's plain compact row
                // style exactly (same border/checkbox/badge treatment as
                // PersonCard in people-view.tsx) instead of a shrunk version
                // of Fun Mode's colorful card.
                if (!funMode) {
                  const done = !!chore.isCompleted;
                  const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                  return (
                    <div
                      key={`${chore.id}-${profile.id}`}
                      onClick={onCardClick}
                      className={cn(
                        "flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none",
                        celebrating
                          ? "animate-bounce bg-green-500/10 border-green-400"
                          : done
                            ? "bg-accent/30 border-green-400/30"
                            : "bg-card border-border hover:border-orange-400/40 hover:bg-orange-500/5",
                      )}
                      data-testid={`chore-item-${chore.id}-${profile.id}`}
                    >
                      {chore.isUnassignedRegular ? (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 bg-muted/60 text-muted-foreground text-xs">
                          🔒
                        </div>
                      ) : (
                        <div
                          data-testid={`chore-checkbox-${chore.id}-${profile.id}`}
                          className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200",
                            done ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground hover:border-primary hover:bg-primary/10",
                          )}
                        >
                          {done && <Check className="w-3 h-3" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {chore.icon && <ChoreIcon icon={chore.icon} className="w-4 h-4" />}
                          <span className={cn("text-sm transition-all duration-200", done ? "line-through text-muted-foreground" : "text-foreground")}>
                            {chore.title}
                          </span>
                        </div>
                        {chore.isUnassignedRegular && (
                          <span className="mt-0.5 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 whitespace-nowrap">
                            Needs assignment
                          </span>
                        )}
                        {chore.taskType && chore.taskType !== "chore" && !chore.isUnassignedRegular && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                            <span>{taskTypeMeta(chore.taskType).emoji}</span>
                            <span>{taskTypeMeta(chore.taskType).label}</span>
                          </span>
                        )}
                      </div>
                      {done ? (
                        <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                          <Trophy className="w-3.5 h-3.5" />
                          <span className="text-xs font-medium">Done!</span>
                        </div>
                      ) : (chore.points ?? 0) > 0 && (!perCompletionMode || chore.taskType === "todo") ? (
                        <span className="text-xs text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                          <Star className="w-3 h-3" />
                          {chore.points}
                        </span>
                      ) : null}
                    </div>
                  );
                }

                return (
                <div
                  key={`${chore.id}-${profile.id}`}
                  onClick={onCardClick}
                  className={cn(
                    "break-inside-avoid flex items-center rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-md gap-3 px-3 py-2.5",
                    celebratingChore === `${chore.id}|${profile.id}` ? 'animate-bounce' : ''
                  )}
                  style={{
                    borderLeft: `5px solid ${profile.color}`,
                    borderTop: `1px solid ${profile.color}30`,
                    borderRight: `1px solid ${profile.color}30`,
                    borderBottom: `1px solid ${profile.color}30`,
                    backgroundColor: chore.isCompleted ? `${profile.color}10` : `${profile.color}18`,
                  }}
                  data-testid={`chore-item-${chore.id}-${profile.id}`}
                >
                  {/* Sticker slot / lock for unassigned */}
                  {chore.isUnassignedRegular ? (
                    <div className="rounded-full flex items-center justify-center shrink-0 bg-muted/60 text-muted-foreground w-10 h-10">
                      🔒
                    </div>
                  ) : (
                    <StickerSlot
                      completed={!!chore.isCompleted}
                      testId={`chore-checkbox-${chore.id}-${profile.id}`}
                    />
                  )}

                  {/* Emoji bubble */}
                  {chore.icon && (
                    <span
                      className="rounded-full flex items-center justify-center shrink-0 w-9 h-9 text-xl"
                      style={{ backgroundColor: `${profile.color}30` }}
                    >
                      <ChoreIcon icon={chore.icon} className="w-5 h-5" />
                    </span>
                  )}

                  {/* Title + task-type badge */}
                  <div className="flex-1 min-w-0">
                    <h4 className={cn(
                      "font-semibold text-foreground leading-snug text-sm",
                      chore.isCompleted && 'line-through text-muted-foreground',
                    )}>
                      {chore.title}
                    </h4>
                    {chore.isUnassignedRegular && (
                      <span className="mt-0.5 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 whitespace-nowrap">
                        Needs assignment
                      </span>
                    )}
                    {chore.taskType && chore.taskType !== "chore" && !chore.isUnassignedRegular && (
                      <span className="mt-0.5 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-background/70 border border-border text-muted-foreground whitespace-nowrap">
                        {taskTypeMeta(chore.taskType).emoji} {taskTypeMeta(chore.taskType).label}
                      </span>
                    )}
                    {chore.description && chore.taskType && chore.taskType !== "chore" && chore.taskType !== "todo" && (
                      <p className={`text-xs text-muted-foreground italic mt-0.5 line-clamp-2 ${chore.isCompleted ? 'line-through' : ''}`}>
                        {chore.description}
                      </p>
                    )}
                  </div>

                  {/* Star points pill — hidden for required checklist chores in
                      per_completion mode (they earn 0; the whole-day bonus pays
                      out instead). To-dos keep their points. */}
                  {(chore.points ?? 0) > 0 && (!perCompletionMode || chore.taskType === "todo") && (
                    <span className="font-bold rounded-full bg-background/70 text-amber-600 shrink-0 text-xs px-2 py-0.5">
                      ⭐ {chore.points}
                    </span>
                  )}
                </div>
              );
              };

              if (profileChores.length === 0) {
                return (
                  <div className="text-center py-8 bg-accent/20 rounded-xl">
                    <p className="text-muted-foreground">
                      {isTodosCard ? `No to-dos scheduled for ${profile.name} today` : `No chores scheduled for ${profile.name} today`}
                    </p>
                  </div>
                );
              }

              // In wide mode, each section's own rows lay out in a real 2-column
              // CSS grid (matching the pattern already used elsewhere in this
              // file) so corresponding rows in each column line up — a plain
              // CSS multi-column ("masonry") layout was tried here previously,
              // but columns fill independently by height with no relationship
              // between rows across columns, so rows never aligned.
              const sectionClass = wideMode ? "mb-5" : "";
              const gridClass = wideMode ? "grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start" : "space-y-2";
              const gridClassTight = wideMode ? "grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 items-start" : "space-y-1.5";
              return (
                <div className={`transition-all duration-500 ${celebratingProfile === profile.id ? 'animate-profile-celebrate' : ''}`}>
                <div className="space-y-5">
                  {activeTodayChores.length > 0 && (
                    <div className={sectionClass}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-base leading-none">🧹</span>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chores</p>
                      </div>
                      <div className={gridClass}>
                        <AnimatePresence initial={false}>
                        {activeTodayChores.map(chore => (
                          <motion.div key={`${chore.id}-${profile.id}`} layout exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}>
                            <SwipeToRemoveRow onRemove={() => removeFromPersonList(chore)}>
                              {renderChoreCard(chore)}
                            </SwipeToRemoveRow>
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  {activeWeeklyTargets.length > 0 && (
                    <div className={sectionClass}>
                      {(hasBoth || activeMonthlyTargets.length > 0) && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <Target className="w-3.5 h-3.5 text-muted-foreground" />
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">This Week</p>
                        </div>
                      )}
                      <div className={gridClassTight}>
                        <AnimatePresence initial={false}>
                        {activeWeeklyTargets.map(chore => (
                          <motion.div key={`${chore.id}-${profile.id}`} layout exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}>
                            <SwipeToRemoveRow onRemove={() => removeFromPersonList(chore)}>
                              {renderTargetRow(chore)}
                            </SwipeToRemoveRow>
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  {activeMonthlyTargets.length > 0 && (
                    <div className={sectionClass}>
                      {(hasBoth || activeWeeklyTargets.length > 0) && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <Target className="w-3.5 h-3.5 text-muted-foreground" />
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">This Month</p>
                        </div>
                      )}
                      <div className={gridClassTight}>
                        <AnimatePresence initial={false}>
                        {activeMonthlyTargets.map(chore => (
                          <motion.div key={`${chore.id}-${profile.id}`} layout exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}>
                            <SwipeToRemoveRow onRemove={() => removeFromPersonList(chore)}>
                              {renderTargetRow(chore)}
                            </SwipeToRemoveRow>
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  {activeTodayOtherTasks.length > 0 && (
                    <div className={sectionClass}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inspiration</p>
                      </div>
                      <div className={gridClass}>
                        <AnimatePresence initial={false}>
                        {activeTodayOtherTasks.map(chore => (
                          <motion.div key={`${chore.id}-${profile.id}`} layout exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}>
                            {renderChoreCard(chore)}
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  {activeTodayTodos.length > 0 && (
                    <div className={sectionClass}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-base leading-none">✅</span>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To-Dos</p>
                        <span className="text-xs text-muted-foreground ml-1">
                          {todayTodos.filter(t => t.isCompleted).length}/{todayTodos.length} done
                        </span>
                      </div>
                      <div className={gridClassTight}>
                        <AnimatePresence initial={false}>
                        {activeTodayTodos.map(chore => (
                          <motion.div
                            key={`${chore.id}-${profile.id}`}
                            layout
                            exit={{ opacity: 0, scale: 0.92 }}
                            transition={{ duration: 0.25, layout: { duration: 0.25, ease: "easeOut" } }}
                            onClick={(e) => handleToggleChore(chore, e)}
                            className={`break-inside-avoid flex items-center cursor-pointer transition-colors duration-200 hover:shadow-sm ${
                              funMode
                                ? "gap-3.5 px-4 py-3 rounded-2xl border-2"
                                : "gap-3 px-3 py-2 rounded-lg border"
                            } ${
                              chore.isCompleted
                                ? 'bg-muted/40 border-muted-foreground/20'
                                : funMode
                                  ? 'bg-blue-500/5 border-blue-400/40 hover:border-blue-400'
                                  : 'bg-card border-border hover:border-blue-400/30'
                            }`}
                          >
                            <div className={`rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                              funMode ? "w-7 h-7" : "w-5 h-5"
                            } ${
                              chore.isCompleted
                                ? 'bg-emerald-400 border-emerald-400 text-white'
                                : 'border-muted-foreground'
                            }`}>
                              {chore.isCompleted && <Check className={funMode ? "w-4 h-4" : "w-3 h-3"} />}
                            </div>
                            <ChoreIcon icon={chore.icon} className={funMode ? "w-6 h-6 text-xl" : "w-4 h-4"} />
                            <span className={`flex-1 min-w-0 ${funMode ? "text-base font-medium" : "text-sm"} ${chore.isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                              {chore.title}
                            </span>
                            {chore.isCompleted && <Check className={`text-emerald-400 shrink-0 ${funMode ? "w-4 h-4" : "w-3.5 h-3.5"}`} />}
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                </div>

                  {/* Collapsed "Done" section — full width, below the columns */}
                  {doneAll.length > 0 && (
                    <div className={`pt-2 ${wideMode ? "mt-5" : ""}`}>
                      <button
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                        onClick={() => setShowDoneTasks(prev => ({ ...prev, [profile.id]: !prev[profile.id] }))}
                      >
                        {showDone ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        Done ({doneAll.length})
                      </button>
                      <AnimatePresence initial={false}>
                        {showDone && (
                          <motion.div
                            key={`done-${profile.id}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 space-y-3">
                              {doneTodayChores.length > 0 && (
                                <div className="space-y-2">
                                  {doneTodayChores.map(renderChoreCard)}
                                </div>
                              )}
                              {doneTargets.length > 0 && (
                                <div className="space-y-2">
                                  {doneTargets.map(renderTargetRow)}
                                </div>
                              )}
                              {doneTodayOtherTasks.length > 0 && (
                                <div className="space-y-2">
                                  {doneTodayOtherTasks.map(renderChoreCard)}
                                </div>
                              )}
                              {doneTodayTodos.length > 0 && (
                                <div className="space-y-1.5">
                                  {doneTodayTodos.map(chore => (
                                    <div
                                      key={`done-${chore.id}-${profile.id}`}
                                      onClick={(e) => handleToggleChore(chore, e)}
                                      className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200 bg-muted/40 border-muted-foreground/20"
                                    >
                                      <div className="w-5 h-5 rounded-full border-2 bg-emerald-400 border-emerald-400 text-white flex items-center justify-center shrink-0">
                                        <Check className="w-3 h-3" />
                                      </div>
                                      <ChoreIcon icon={chore.icon} className="w-4 h-4" />
                                      <span className="text-sm flex-1 min-w-0 line-through text-muted-foreground">{chore.title}</span>
                                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}

        {choresByProfile.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Select a family member to see their chores</p>
            <Button
              onClick={openAddModal}
              variant="outline"
              className="mt-4"
            >
              Create your first chore
            </Button>
          </div>
        )}
      </div>
        </motion.div>
      ))}
      </AnimatePresence>

      {/* Manage Chores Drawer */}
      <ChoreManagementDrawer
        open={showManageDrawer}
        onOpenChange={(open) => {
          // Radix quirk: opening the Edit dialog counts as an "outside
          // interaction" on this Sheet and auto-dismisses it — which dumped
          // the user back on the Tasks tab when they closed the edit pop-up.
          // Keep the drawer open underneath while the edit modal is up.
          if (!open && showEditModal) return;
          setShowManageDrawer(open);
        }}
        chores={isTodosCard
          ? allChores.filter(c => c.taskType === "todo")
          : taskTypeFilter === "non-todos"
            ? allChores.filter(c => c.taskType !== "todo")
            : allChores}
        profiles={profiles}
        onEdit={handleEditChore}
        onDelete={(choreId) => deleteChoreeMutation.mutate(choreId)}
        onAddChore={addAction}
        title={isTodosCard ? "Manage To-Dos" : "Manage Chores"}
        noun={isTodosCard ? "to-do" : "chore"}
      />

      {/* Add Chore Modal */}
      <Dialog open={showAddModal} onOpenChange={(open) => {
        if (!open) {
          setShowAddModal(false);
          resetForm();
        }
      }}>
        <DialogContent className="w-full max-w-lg max-h-[85dvh] flex flex-col bg-card rounded-2xl border border-border shadow-xl" data-testid="add-chore-modal">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-lg font-semibold text-foreground">Create New Chore</DialogTitle>
          </DialogHeader>
          {/* overflow-x-hidden alongside overflow-y-auto is required, not
              cosmetic: setting overflow-y without an explicit overflow-x
              makes the browser compute overflow-x as "auto" too (per the CSS
              overflow spec), not "visible" — so a single oversized child
              (e.g. iOS's native date-input control, which can render wider
              than its own w-full box) makes this WHOLE scroll container
              horizontally swipeable instead of just clipping that child. */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <form onSubmit={handleSubmit} className="space-y-4 pb-2">
            <div>
              <Label>Type</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TASK_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, taskType: t.value })}
                    className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
                      formData.taskType === t.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-accent/40"
                    }`}
                    data-testid={`task-type-${t.value}`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Take out trash, Make bed"
                data-testid="chore-title-input"
              />
            </div>

            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional details about the chore"
                rows={2}
                data-testid="chore-description-input"
              />
            </div>

            <div>
              <Label>Emoji (optional)</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <EmojiPicker
                  value={formData.icon}
                  onChange={(emoji) => setFormData({ ...formData, icon: emoji })}
                />
                {formData.icon && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: "" })}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                {perCompletionMode && formData.taskType !== "todo" ? (
                  <>
                    <Label>Stars</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {PER_DAY_STARS_EXPLAINER}
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="points">Stars (0 = none)</Label>
                    <Input
                      id="points"
                      type="number"
                      min="0"
                      value={formData.points}
                      onChange={(e) => { const raw = parseInt(e.target.value); setFormData({ ...formData, points: isNaN(raw) ? formData.points : raw }); }}
                      data-testid="chore-points-input"
                    />
                    <PointsSuggestionHint points={formData.points} onPick={(n) => setFormData({ ...formData, points: n })} />
                  </>
                )}
              </div>


              <div>
                <Label>Assign to</Label>
                <div className="mt-2">
                  <Select
                    value={formData.profileIds.length > 0 ? formData.profileIds[0] : ""}
                    onValueChange={(value) => {
                      if (value && !formData.profileIds.includes(value)) {
                        setFormData(prev => ({
                          ...prev,
                          profileIds: [...prev.profileIds, value]
                        }));
                      }
                    }}
                  >
                    <SelectTrigger data-testid="chore-assign-dropdown">
                      <SelectValue placeholder="Select family members" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles
                        .filter(profile => !formData.profileIds.includes(profile.id))
                        .map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
                              style={{ 
                                background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` 
                              }}
                            >
                              {profile.photoUrl ? (
                                <img 
                                  src={objectUrl(profile.photoUrl)}
                                  alt={profile.name} 
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                profile.initials
                              )}
                            </div>
                            <span className="text-sm">{profile.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {/* Selected Profiles */}
                  {formData.profileIds.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.profileIds.map((profileId) => {
                        const profile = profiles.find(p => p.id === profileId);
                        if (!profile) return null;
                        return (
                          <div
                            key={profileId}
                            className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-1"
                            data-testid={`selected-${profile.name.toLowerCase()}`}
                          >
                            <div 
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
                              style={{ 
                                background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` 
                              }}
                            >
                              {profile.photoUrl ? (
                                <img 
                                  src={objectUrl(profile.photoUrl)}
                                  alt={profile.name} 
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                profile.initials
                              )}
                            </div>
                            <span className="text-sm font-medium">{profile.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setFormData(prev => ({
                                  ...prev,
                                  profileIds: prev.profileIds.filter(id => id !== profileId)
                                }));
                              }}
                              className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                              data-testid={`remove-${profile.name.toLowerCase()}`}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label>Schedule</Label>
              <div className="flex gap-2 mt-1 mb-3">
                <Button
                  type="button"
                  variant={scheduleMode === "days" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("days")}
                  className="text-xs"
                >
                  Specific days
                </Button>
                <Button
                  type="button"
                  variant={scheduleMode === "target" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("target")}
                  className="text-xs"
                >
                  Target count
                </Button>
              </div>
              {scheduleMode === "days" && (
                <>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Button type="button" variant={formData.daysOfWeek.length === 7 ? "default" : "outline"} size="sm" onClick={selectAllDays} className="text-xs" data-testid="select-all-days">All Days</Button>
                    <Button type="button" variant={formData.daysOfWeek.length === 5 && formData.daysOfWeek.includes(1) ? "default" : "outline"} size="sm" onClick={selectWeekdays} className="text-xs" data-testid="select-weekdays">Weekdays</Button>
                    <Button type="button" variant={formData.daysOfWeek.length === 2 && (formData.daysOfWeek.includes(0) || formData.daysOfWeek.includes(6)) ? "default" : "outline"} size="sm" onClick={selectWeekends} className="text-xs" data-testid="select-weekends">Weekends</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearDays} className="text-xs text-muted-foreground" data-testid="clear-days">Clear</Button>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={formData.daysOfWeek.includes(day.value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleDay(day.value)}
                        className={cn("text-xs", formData.daysOfWeek.includes(day.value) && "ring-2 ring-primary/50 shadow-sm")}
                        data-testid={`day-${day.short.toLowerCase()}`}
                      >
                        {day.short}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {scheduleMode === "target" && (
                <TargetCountPicker
                  idPrefix="add"
                  count={formData.targetCount}
                  period={formData.recurrenceType as "weekly" | "monthly"}
                  onCountChange={(n) => setFormData({ ...formData, targetCount: n })}
                  onPeriodChange={(p) => setFormData({ ...formData, recurrenceType: p })}
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="endDate">End Date (optional)</Label>
                {formData.endDate && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, endDate: null })}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    data-testid="clear-end-date-button"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate ? format(formData.endDate, "yyyy-MM-dd") : ""}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value ? new Date(e.target.value) : null })}
                className="appearance-none"
                data-testid="end-date-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                data-testid="cancel-chore-button"
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createChoreMutation.isPending}
                data-testid="save-chore-button"
              >
                {createChoreMutation.isPending ? "Creating..." : "Create Chore"}
              </Button>
            </div>
          </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Chore Modal */}
      <Dialog open={showEditModal} onOpenChange={(open) => {
        if (!open) {
          setShowEditModal(false);
          setEditingChoreId(null);
          resetForm();
        }
      }}>
        <DialogContent className="w-full max-w-lg max-h-[85dvh] flex flex-col bg-card rounded-2xl border border-border shadow-xl" data-testid="edit-chore-modal">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-lg font-semibold text-foreground">Edit Task</DialogTitle>
          </DialogHeader>
          {/* overflow-x-hidden alongside overflow-y-auto is required, not
              cosmetic: setting overflow-y without an explicit overflow-x
              makes the browser compute overflow-x as "auto" too (per the CSS
              overflow spec), not "visible" — so a single oversized child
              (e.g. iOS's native date-input control, which can render wider
              than its own w-full box) makes this WHOLE scroll container
              horizontally swipeable instead of just clipping that child. */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <form onSubmit={handleEditSubmit} className="space-y-4 pb-2">
            <div>
              <Label>Type</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TASK_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, taskType: t.value })}
                    className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
                      formData.taskType === t.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-accent/40"
                    }`}
                    data-testid={`edit-task-type-${t.value}`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Take out trash, Make bed"
                data-testid="edit-chore-title-input"
              />
            </div>

            <div>
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Additional details about the chore"
                rows={2}
                data-testid="edit-chore-description-input"
              />
            </div>

            <div>
              <Label>Emoji (optional)</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <EmojiPicker
                  value={formData.icon}
                  onChange={(emoji) => setFormData({ ...formData, icon: emoji })}
                />
                {formData.icon && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: "" })}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                {perCompletionMode && formData.taskType !== "todo" ? (
                  <>
                    <Label>Stars</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {PER_DAY_STARS_EXPLAINER}
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="edit-points">Stars (0 = none)</Label>
                    <Input
                      id="edit-points"
                      type="number"
                      min="0"
                      value={formData.points}
                      onChange={(e) => { const raw = parseInt(e.target.value); setFormData({ ...formData, points: isNaN(raw) ? formData.points : raw }); }}
                      data-testid="edit-chore-points-input"
                    />
                    <PointsSuggestionHint points={formData.points} onPick={(n) => setFormData({ ...formData, points: n })} />
                  </>
                )}
              </div>

              <div>
                <Label>Assign to</Label>
                <div className="mt-2">
                  <Select
                    value={formData.profileIds.length > 0 ? formData.profileIds[0] : ""}
                    onValueChange={(value) => {
                      if (value && !formData.profileIds.includes(value)) {
                        setFormData(prev => ({
                          ...prev,
                          profileIds: [...prev.profileIds, value]
                        }));
                      }
                    }}
                  >
                    <SelectTrigger data-testid="edit-chore-assign-dropdown">
                      <SelectValue placeholder="Select family members" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles
                        .filter(profile => !formData.profileIds.includes(profile.id))
                        .map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
                              style={{ 
                                background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` 
                              }}
                            >
                              {profile.photoUrl ? (
                                <img 
                                  src={objectUrl(profile.photoUrl)}
                                  alt={profile.name} 
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                profile.initials
                              )}
                            </div>
                            <span className="text-sm">{profile.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {formData.profileIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.profileIds.map((profileId) => {
                  const profile = profiles.find(p => p.id === profileId);
                  if (!profile) return null;
                  return (
                    <div
                      key={profileId}
                      className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-1"
                    >
                      <div 
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
                        style={{ 
                          background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` 
                        }}
                      >
                        {profile.photoUrl ? (
                          <img 
                            src={objectUrl(profile.photoUrl)}
                            alt={profile.name} 
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          profile.initials
                        )}
                      </div>
                      <span className="text-sm font-medium">{profile.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            profileIds: prev.profileIds.filter(id => id !== profileId)
                          }));
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <Label>Schedule</Label>
              <div className="flex gap-2 mt-1 mb-3">
                <Button
                  type="button"
                  variant={scheduleMode === "days" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("days")}
                  className="text-xs"
                >
                  Specific days
                </Button>
                <Button
                  type="button"
                  variant={scheduleMode === "target" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("target")}
                  className="text-xs"
                >
                  Target count
                </Button>
              </div>
              {scheduleMode === "days" && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <Button type="button" onClick={selectAllDays} variant={formData.daysOfWeek.length === 7 ? "default" : "outline"} size="sm" className="text-xs">All Days</Button>
                    <Button type="button" onClick={selectWeekdays} variant={formData.daysOfWeek.length === 5 && formData.daysOfWeek.includes(1) ? "default" : "outline"} size="sm" className="text-xs">Weekdays</Button>
                    <Button type="button" onClick={selectWeekends} variant={formData.daysOfWeek.length === 2 && (formData.daysOfWeek.includes(0) || formData.daysOfWeek.includes(6)) ? "default" : "outline"} size="sm" className="text-xs">Weekends</Button>
                    <Button type="button" onClick={clearDays} variant="outline" size="sm" className="text-xs">Clear</Button>
                  </div>
                  <div className="flex gap-1 flex-wrap mt-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        onClick={() => toggleDay(day.value)}
                        variant={formData.daysOfWeek.includes(day.value) ? "default" : "outline"}
                        size="sm"
                        className={cn("text-xs", formData.daysOfWeek.includes(day.value) && "ring-2 ring-primary/50 shadow-sm")}
                        data-testid={`edit-day-${day.short.toLowerCase()}`}
                      >
                        {day.short}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {scheduleMode === "target" && (
                <TargetCountPicker
                  idPrefix="edit"
                  count={formData.targetCount}
                  period={formData.recurrenceType}
                  onCountChange={(n) => setFormData({ ...formData, targetCount: n })}
                  onPeriodChange={(p) => setFormData({ ...formData, recurrenceType: p })}
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-endDate">End Date (optional)</Label>
                {formData.endDate && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, endDate: null })}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    data-testid="clear-edit-end-date-button"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Input
                id="edit-endDate"
                type="date"
                value={formData.endDate ? format(formData.endDate, "yyyy-MM-dd") : ""}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value ? new Date(e.target.value) : null })}
                className="appearance-none"
                data-testid="edit-end-date-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setShowEditModal(false);
                  setEditingChoreId(null);
                  resetForm();
                }}
                data-testid="cancel-edit-chore-button"
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={updateChoreMutation.isPending}
                data-testid="save-edit-chore-button"
              >
                {updateChoreMutation.isPending ? "Updating..." : "Update Chore"}
              </Button>
            </div>
          </form>
          {editingChoreId && (
            <CommentThread entityType="chore" entityId={editingChoreId} profiles={profiles} />
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Flying star overlay — shooting star with trailing sparks */}
      <AnimatePresence>
        {flyingStars.map(star => {
          const dx = star.toX - star.fromX;
          const dy = star.toY - star.fromY;
          // Arc apex: 90px above the midpoint of the straight-line path
          const arcX = star.fromX + dx * 0.45;
          const arcY = star.fromY + dy * 0.45 - 90;

          return (
            <AnimatePresence key={star.id}>
              {/* ── Main shooting star ── */}
              <motion.div
                className="fixed pointer-events-none select-none"
                style={{ left: star.fromX - 22, top: star.fromY - 22, zIndex: 9999 }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{
                  x: [0, arcX - star.fromX, dx],
                  y: [0, arcY - star.fromY, dy],
                  opacity: [0, 1, 1, 0],
                  scale: [0.6, 2.2, 1.8, 0.8],
                  rotate: [0, -15, -25, -20],
                }}
                transition={{ duration: 2.0, ease: "easeInOut", times: [0, 0.18, 0.78, 1] }}
              >
                <div className="flex items-center gap-1">
                  <span style={{ fontSize: 36, filter: "drop-shadow(0 0 8px #fbbf24) drop-shadow(0 0 18px #f59e0b)" }}>⭐</span>
                  <span
                    className="font-black text-white"
                    style={{ fontSize: 20, textShadow: "0 0 6px #f59e0b, 0 0 14px #f59e0b, 0 2px 4px rgba(0,0,0,0.5)" }}
                  >
                    {star.points != null ? `+${star.points}` : ""}
                  </span>
                </div>
              </motion.div>

              {/* ── Trail sparks: shed from the star's body as it moves ── */}
              {star.trail.map((t, i) => {
                // Estimate where the main star is at each spark's spawn time
                const spawnDelay = 0.18 + i * 0.17;
                const progress = Math.min(spawnDelay / 2.0, 1);
                const arcBump = Math.sin(Math.PI * progress) * 90;
                const spawnX = star.fromX + dx * progress;
                const spawnY = star.fromY + dy * progress - arcBump;
                const sparkSize = Math.max(10, 22 - i * 2.5);
                return (
                  <motion.span
                    key={`trail-${i}`}
                    className="fixed pointer-events-none select-none"
                    style={{ left: spawnX, top: spawnY, fontSize: sparkSize, zIndex: 9998, lineHeight: 1 }}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 1.4 }}
                    animate={{ x: t.driftX - dx * 0.12, y: t.driftY - dy * 0.08, opacity: 0, scale: 0.1 }}
                    transition={{ duration: 0.55 + i * 0.04, delay: spawnDelay, ease: "easeOut" }}
                  >
                    ✨
                  </motion.span>
                );
              })}
            </AnimatePresence>
          );
        })}
      </AnimatePresence>

      {/* Bulk Add Chores Modal */}
      <BulkAddChoresModal
        open={showBulkAddModal}
        onOpenChange={setShowBulkAddModal}
        profiles={profiles}
        onSaveChores={async (choresToSave) => {
          // Each row is its own request (no batch endpoint) — a failure partway
          // through used to throw out of a plain for-loop, silently leaving an
          // unknown number already created with no feedback and no way to tell
          // which ones, so retrying just duplicated the successes. Track each
          // outcome instead so the result — full success, partial, or total
          // failure — is always reported honestly.
          const results = await Promise.allSettled(
            choresToSave.map((chore) => apiRequest("POST", "/api/chores", chore)),
          );
          const succeeded = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - succeeded;

          if (succeeded > 0) {
            await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
          }

          if (failed === 0) {
            toast({
              title: `${succeeded} chore${succeeded === 1 ? "" : "s"} created successfully!`,
              description: "Your new chores have been added.",
            });
          } else if (succeeded > 0) {
            toast({
              title: `${succeeded} of ${choresToSave.length} chores created`,
              description: `${failed} failed to save — fix and re-add just those, the rest are already in your list.`,
              variant: "destructive",
            });
          } else {
            // Nothing succeeded — let the modal's own catch handle it (stays
            // open so the user doesn't lose what they typed).
            throw new Error(`Couldn't create any of the ${choresToSave.length} chores. Please try again.`);
          }
        }}
      />

      {/* Inspiration-item detail dialog — affirmation / Bible verse / memory
          verse / mission / custom. Clicking the card body opens this; the
          checkbox is the only way to mark it complete. */}
      <Dialog open={!!viewingAffirmation} onOpenChange={(open) => { if (!open) setViewingAffirmation(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {viewingAffirmation && `${taskTypeMeta(viewingAffirmation.taskType).emoji} ${taskTypeMeta(viewingAffirmation.taskType).label}`}
            </DialogTitle>
          </DialogHeader>
          {viewingAffirmation && (
            <div className="space-y-4">
              <p className="text-base font-semibold text-foreground">{viewingAffirmation.title}</p>
              {viewingAffirmation.description ? (
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{viewingAffirmation.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No content added yet — tap Edit to add it.</p>
              )}
              {(onEditChore || onDeleteChore) && (
                <div className="flex items-center gap-3">
                  {onEditChore && (
                    <button
                      type="button"
                      onClick={() => {
                        // ChoreDisplay is a display-shaped projection, not
                        // the real Chore CreateTaskModal needs to edit (it's
                        // missing e.g. recurrenceType/endDate) — look up the
                        // real row by id instead of coercing this one.
                        const real = allChores.find(c => c.id === viewingAffirmation.id);
                        if (real) onEditChore(real);
                        setViewingAffirmation(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      Edit
                    </button>
                  )}
                  {onDeleteChore && (
                    <button
                      type="button"
                      onClick={async () => {
                        const real = allChores.find(c => c.id === viewingAffirmation.id);
                        if (real && await confirmDialog({ title: `Delete "${viewingAffirmation.title}"?` })) {
                          onDeleteChore(real);
                          setViewingAffirmation(null);
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setViewingAffirmation(null)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                >
                  Go Back
                </button>
                <button
                  onClick={(e) => {
                    handleToggleChore(viewingAffirmation, e);
                    setViewingAffirmation(null);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    viewingAffirmation.isCompleted
                      ? "bg-muted text-muted-foreground hover:bg-muted/80"
                      : "bg-emerald-500 hover:bg-emerald-600 text-white"
                  }`}
                >
                  {/* The tick is the icon. The label used to end in "✓" as
                      well, so the button read as two check marks with the word
                      between them (2026-09-12). */}
                  <Check className="w-4 h-4" />
                  {viewingAffirmation.isCompleted ? "Mark as not done" : "Complete"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {parentGateDialog}
    </div>
  );
}
