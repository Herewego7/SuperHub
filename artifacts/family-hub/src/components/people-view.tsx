import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { ChoreIcon } from "@/components/customChoreIcons";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import {
  Profile, Event, Chore, ChoreCompletion,
  DailyContent, DailyContentAssignment, DailyContentCompletion,
  InsertChoreCompletion, CalendarAssignment, RewardSettings,
} from "@workspace/shared-types";
import { clearCelebratedAllDone } from "@/lib/allDoneCelebration";
import { isKidProfile } from "@/lib/parentGate";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { HealthRemindersSection } from "@/components/health-reminders-section";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import {
  Calendar, ListTodo, BookOpen, Check, Clock,
  MapPin, Star, Heart, Book, Bookmark, FileText, StickyNote, SlidersHorizontal,
  Flame, Trophy, Sparkles, AlertTriangle, Gift, Target as TargetIcon, ChevronDown, ChevronUp, ChevronRight,
} from "lucide-react";
import { taskTypeMeta } from "@/components/chores-view";
import { isFutureDate } from "@/lib/choreSchedule";
import { format, isToday, startOfDay, endOfDay, isBefore } from "date-fns";
import { isWithinInterval } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { objectUrl } from "@/lib/apiBase";
import { isChoreScheduledForDate, getPeriodProgress as getPeriodProgressShared } from "@/lib/choreSchedule";
import { confirmDialog } from "@/lib/confirmDialog";
import { parseGoogleEventDates, parseOutlookEventDates } from "@/lib/calendarDates";
import { applySavedEventToCache, removeEventFromCache, applyGoogleAssignmentToCache } from "@/lib/eventCache";
import { DELETE_SERIES_BODY } from "@/lib/copy";
import { driverIdsOf, sameIds, driverIdsFromGoogleEvent } from "@/lib/eventDrivers";

// ── helpers ──────────────────────────────────────────────────────────────────

const CONTENT_TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  mission:      { label: "Mission",     icon: Heart,       color: "text-red-500"    },
  affirmation:  { label: "Affirmation", icon: Bookmark,    color: "text-blue-500"   },
  bible_verse:  { label: "Bible Verse", icon: Book,        color: "text-purple-500" },
  memory_verse: { label: "Memory Verse",icon: BookOpen,    color: "text-green-500"  },
  note:         { label: "Note",        icon: StickyNote,  color: "text-amber-500"  },
  custom:       { label: "Custom",      icon: FileText,    color: "text-gray-500"   },
};

// ── Avatar ───────────────────────────────────────────────────────────────────

function ProfileAvatar({ profile, size = "md" }: { profile: Profile; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "w-14 h-14 text-xl" : size === "md" ? "w-10 h-10 text-base" : "w-7 h-7 text-xs";
  if (profile.photoUrl) {
    return (
      <img
        src={objectUrl(profile.photoUrl)}
        alt={profile.name}
        className={`${sz} rounded-full object-cover border-2 border-white shadow-sm`}
      />
    );
  }
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-bold text-white shadow-sm border-2 border-white`}
      style={{ backgroundColor: profile.color }}
    >
      {profile.initials}
    </div>
  );
}

// ── People-tab display settings ───────────────────────────────────────────────

interface PeopleTabSettings {
  showEvents: boolean;
  showPastEvents: boolean;
}

const PEOPLE_SETTINGS_KEY = "peopleTabSettings_v1";
const DEFAULT_PEOPLE_SETTINGS: PeopleTabSettings = {
  showEvents: true,
  showPastEvents: false,
};

function getPeopleSettings(): PeopleTabSettings {
  try {
    const raw = localStorage.getItem(PEOPLE_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_PEOPLE_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PEOPLE_SETTINGS;
}

function savePeopleSettings(s: PeopleTabSettings): void {
  try { localStorage.setItem(PEOPLE_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// ── Person Card ───────────────────────────────────────────────────────────────

interface PersonCardProps {
  profile: Profile;
  allProfiles: Profile[];
  selectedDate: Date;
  events: Event[];
  chores: Chore[];
  choreCompletions: ChoreCompletion[];
  dailyContent: DailyContent[];
  dailyAssignments: DailyContentAssignment[];
  dailyCompletions: DailyContentCompletion[];
  onNavigate?: (tab: string) => void;
  showEvents: boolean;
  showPastEvents: boolean;
  noCard?: boolean;
  // When provided, Bonus Chores are NOT rendered inline as their own
  // section — instead a single link-style row takes the user to the real
  // Bonus Chores card (which has its own claim options/frequency limits).
  // Used on Home, which has no separate Bonus Chores card of its own,
  // unlike the Tasks tab's Chores card which already keeps Bonus separate.
  onNavigateToBonusChores?: () => void;
  /** Opens the unified Create/Edit task modal for a chore, and deletes one
   * (PIN-gated by kind) — surfaced on the inspiration-item detail popup. */
  onEditChore?: (chore: Chore) => void;
  onDeleteChore?: (chore: Chore) => void;
}

// Shared collapsible wrapper for every section in PersonCard (Chores/Bonus/
// Target/Inspiration/To-Dos/Notes/Inspiration Content) — hoisted to module
// scope rather than declared inside PersonCard's render body, since a
// component redeclared on every render gets a new identity each time and
// React remounts its whole subtree instead of updating props (the same bug
// class fixed elsewhere in this app, e.g. SettingsSection/DayToggle).
interface TaskSectionProps {
  sectionKey: string;
  icon: React.ReactNode;
  title: string;
  titleHoverClass: string;
  allDone: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onTitleClick?: () => void;
  children: React.ReactNode;
}
function TaskSection({ sectionKey, icon, title, titleHoverClass, allDone, collapsed, onToggle, onTitleClick, children }: TaskSectionProps) {
  // Starts settled: with AnimatePresence initial={false} the first mount does
  // NOT animate, so onAnimationComplete never fires and a section that was
  // never toggled would keep overflow-hidden forever — which is why the
  // previous fix only worked after manually collapsing and re-expanding.
  const [settled, setSettled] = useState(true);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSettled(false);
  }, [collapsed]);
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h4
          className={`text-xs font-semibold text-muted-foreground uppercase tracking-wide transition-colors ${
            onTitleClick ? `cursor-pointer ${titleHoverClass}` : ""
          }`}
          onClick={onTitleClick}
        >{title}</h4>
        {allDone && (
          <Badge className="text-xs px-1.5 py-0 h-4 bg-green-500/15 text-green-700 border-green-400">
            All done!
          </Badge>
        )}
        <button
          type="button"
          className="ml-auto p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          onClick={onToggle}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          data-testid={`section-toggle-${sectionKey}`}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onAnimationComplete={() => setSettled(true)}
            // overflow-hidden is only needed WHILE the height animates. Left on
            // afterwards it clips the top row's check-off hop against the
            // section's own top edge — which is why only the FIRST item in a
            // list ever looked cut off, and why shrinking the hop itself never
            // fixed it.
            className={settled ? undefined : "overflow-hidden"}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const EMPTY_EVENT_FORM: EventFormData = {
  title: "",
  location: "",
  description: "",
  isAllDay: false,
  profileIds: [],
  drivingProfileIds: [] as string[],
  recurrenceType: "none",
  recurrenceEndDate: null,
};

export function PersonCard({
  profile, allProfiles, selectedDate,
  events, chores, choreCompletions,
  dailyContent, dailyAssignments, dailyCompletions,
  onNavigate,
  showEvents, showPastEvents,
  noCard = false,
  onNavigateToBonusChores,
  onEditChore,
  onDeleteChore,
}: PersonCardProps) {
  const { toast } = useToast();

  // ── Animation state ──────────────────────────────────────────────────────
  const [celebratingChore, setCelebratingChore] = useState<string | null>(null);
  // Chores in this set stay at their current position during the bounce animation,
  // then are released (sorted to bottom) once the animation finishes.
  const [pendingBottomChores, setPendingBottomChores] = useState<Set<string>>(new Set());
  // Every section (Chores/Bonus/Target/Inspiration/To-Dos/Notes/Inspiration
  // Content) is collapsible, open by default — this tracks which ones have
  // been explicitly collapsed, rather than which are open, so a brand-new
  // section (or a profile with no prior state) always starts expanded.
  // Persisted per device: this is component state, and PersonCard unmounts
  // on every tab switch — so a section you collapsed was expanded again the
  // next time you came back to Home.
  const collapseKey = `familyHub_collapsedSections_${profile.id}`;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const toggleSection = (key: string) =>
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(collapseKey, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  const [flyingStars, setFlyingStars] = useState<Array<{
    id: string; points: number | null; // null = star-only, no "+N" (per_completion checklist chores)
    fromX: number; fromY: number; toX: number; toY: number;
    trail: Array<{ driftX: number; driftY: number }>;
  }>>([]);
  const starBadgeRef = useRef<HTMLSpanElement | null>(null);
  // Declared before toggleChore uses it for the flying-star animation (the
  // original declaration sat below that handler — TDZ).
  const { data: rewardSettingsCfg } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const perCompletionMode = rewardSettingsCfg?.pointsMode === "per_completion";
  const [starburstActive, setStarburstActive] = useState(false);

  // ── Daily content item modal state ───────────────────────────────────────
  const [viewingDailyItem, setViewingDailyItem] = useState<DailyContent | null>(null);
  const [viewingChoreItem, setViewingChoreItem] = useState<Chore | null>(null);

  // ── Event modal state ────────────────────────────────────────────────────
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEventForModal, setSelectedEventForModal] = useState<any>(null);
  const [recurringScope, setRecurringScope] = useState<null | { eventData: any; ev: any }>(null);
  const [eventFormData, setEventFormData] = useState<EventFormData>(EMPTY_EVENT_FORM);
  const [eventSelectedSlot, setEventSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);

  // ── Events: only on the selected date ────────────────────────────────────
  const profileEvents = useMemo(() => {
    const dayStart = startOfDay(selectedDate);
    const dayEnd   = endOfDay(selectedDate);
    return events
      .filter(e => {
        const eStart = new Date(e.startTime);
        const eEnd   = new Date(e.endTime);
        // Overlap check: event touches the selected day
        const onDay = eEnd >= dayStart && eStart <= dayEnd;
        // Profile matches as attendee or as designated driver
        const asAttendee = Array.isArray(e.profileIds) && e.profileIds.includes(profile.id);
        const asDriver   = driverIdsOf(e).includes(profile.id);
        return (asAttendee || asDriver) && onDay;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [events, profile.id, selectedDate]);

  // ── Chores for selected date ──────────────────────────────────────────────

  const getPeriodProgress = useCallback(
    (chore: Chore): number => getPeriodProgressShared(chore, profile.id, choreCompletions, selectedDate),
    [choreCompletions, profile.id, selectedDate],
  );

  // "Not today" skips, same source of truth as the Chores tab — a chore
  // skipped for the day must disappear here too, not just on that one screen.
  const { data: choreSkips = [] } = useQuery<{ choreId: string; profileId: string; skipDate: string }[]>({
    queryKey: ["/api/chore-skips"],
  });
  const skippedChoreIds = useMemo(() => {
    const day = selectedDate.toDateString();
    return new Set(
      choreSkips
        .filter(s => s.profileId === profile.id && new Date(s.skipDate).toDateString() === day)
        .map(s => s.choreId),
    );
  }, [choreSkips, profile.id, selectedDate]);

  const profileChores = useMemo(() => {
    return chores.filter(c => {
      if (!Array.isArray(c.profileIds) || !c.profileIds.includes(profile.id)) return false;
      if (skippedChoreIds.has(c.id)) return false;
      if (!isChoreScheduledForDate(c, selectedDate)) return false;
      // Target-count chores: show if target not yet met, or if completed today
      if (c.targetCount && c.targetCount > 0) {
        const progress = getPeriodProgress(c);
        if (progress < c.targetCount) return true;
        // Target met — still show if completed today for visual feedback
        const dayStart = startOfDay(selectedDate);
        const dayEnd = endOfDay(selectedDate);
        return choreCompletions.some(cc =>
          cc.choreId === c.id && cc.profileId === profile.id && cc.completedAt != null &&
          isWithinInterval(new Date(cc.completedAt), { start: dayStart, end: dayEnd })
        );
      }
      return true;
    });
  }, [chores, profile.id, selectedDate, choreCompletions, getPeriodProgress, skippedChoreIds]);

  const isChoreCompleted = (choreId: string) => {
    // To-dos are one-time items, not daily-recurring — checking them off
    // must stick regardless of which day is being viewed. Scoping the check
    // to `selectedDate` (right, for a recurring chore's "done today?") made
    // a to-do completed on any earlier day silently revert to "not done"
    // the moment the calendar day rolled over, since no completion record
    // exists for the NEW day. A to-do counts as done if it's EVER been
    // completed; only chores/target-chores stay scoped to the viewed day.
    const chore = chores.find(c => c.id === choreId);
    if (chore?.taskType === "todo") {
      return choreCompletions.some(cc =>
        cc.choreId === choreId && cc.profileId === profile.id && cc.completedAt != null
      );
    }
    const dayStart = startOfDay(selectedDate);
    const dayEnd   = endOfDay(selectedDate);
    return choreCompletions.some(cc =>
      cc.choreId === choreId &&
      cc.profileId === profile.id &&
      cc.completedAt != null &&
      isWithinInterval(new Date(cc.completedAt), { start: dayStart, end: dayEnd })
    );
  };

  // ── Daily content assigned to this profile ────────────────────────────────
  const profileDailyItems = useMemo(() => {
    const assignedIds = new Set(
      dailyAssignments
        .filter(a => a.profileId === profile.id)
        .map(a => a.contentId)
    );
    return dailyContent.filter(d => assignedIds.has(d.id));
  }, [dailyContent, dailyAssignments, profile.id]);

  // Split daily items: notes vs inspiration
  const inspirationItems = useMemo(() => profileDailyItems.filter(d => d.type !== "note"), [profileDailyItems]);

  const isDailyItemCompleted = (contentId: string) => {
    const dayStart = startOfDay(selectedDate);
    const dayEnd   = endOfDay(selectedDate);
    return dailyCompletions.some(dc =>
      dc.contentId === contentId &&
      dc.profileId === profile.id &&
      dc.completedAt != null &&
      isWithinInterval(new Date(dc.completedAt), { start: dayStart, end: dayEnd })
    );
  };

  // ── Chore mutation ────────────────────────────────────────────────────────
  // Both mutations below apply an optimistic update to the shared
  // ["/api/chore-completions"] cache (matching chores-view.tsx's own
  // complete/uncomplete mutations) — without it, the checkbox/strikethrough
  // only ever updated once the invalidated query happened to refetch, which
  // is unpredictable network-timing-dependent: a check could bounce and then
  // appear to jump straight into "done" with no visible checked state in
  // between, and an uncheck could look like it silently did nothing for a
  // moment before catching up.
  const completeChore = useMutation({
    mutationFn: async (data: InsertChoreCompletion & { completedAt?: Date; localDayStart?: Date }) => {
      const { completedAt, localDayStart, ...body } = data;
      const res = await apiRequest("POST", "/api/chore-completions", {
        ...body,
        completedAt: completedAt?.toISOString(),
        // Family's own local midnight for the day being marked — lets
        // per_completion mode key the daily bonus by the family's day.
        localDayStart: localDayStart?.toISOString(),
      });
      return res.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const previousCompletions = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      const tempId = `temp-${Date.now()}`;
      const optimisticCompletion: ChoreCompletion = {
        id: tempId,
        choreId: variables.choreId,
        profileId: variables.profileId!,
        completedAt: variables.completedAt ?? new Date(),
        points: variables.points ?? 0,
      };
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) => [
        ...old,
        optimisticCompletion,
      ]);
      return { previousCompletions, tempId };
    },
    onSuccess: (data, variables, context) => {
      // Swap the optimistic entry for the server-confirmed one in place,
      // instead of invalidating + refetching — a refetch can race with
      // backend write-propagation and briefly return a list missing the new
      // completion, flashing the item back to "active" before settling.
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.map(c => (c.id === context?.tempId ? data : c))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      // A completion (incl. a backdated one) can change the streak or freeze
      // eligibility — refetch both, since neither refreshes on its own.
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", variables.profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
    },
    onError: (err: any, _variables, context) => {
      if (context?.previousCompletions) {
        queryClient.setQueryData(["/api/chore-completions"], context.previousCompletions);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      toast({ title: "Couldn't complete chore", description: err?.message ?? "Try again later", variant: "destructive" });
    },
  });

  const uncompleteChore = useMutation({
    mutationFn: async (data: { choreId: string; profileId: string; date?: Date }) => {
      const d = data.date ?? new Date();
      const dateParam = d.toISOString().split("T")[0];
      const localDayStart = new Date(d);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("DELETE", `/api/chore-completions/${data.choreId}/${data.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`);
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const previousCompletions = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      // To-dos aren't day-scoped (see this file's isChoreCompleted and the
      // backend DELETE route, both of which treat a to-do's completion as
      // permanent regardless of date) — remove every completion for this
      // chore+profile. Regular chores stay scoped to the viewed day, matching
      // the backend's own day-window delete.
      const chore = chores.find(c => c.id === variables.choreId);
      const isTodo = chore?.taskType === "todo";
      const dayStr = (variables.date ?? new Date()).toDateString();
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.filter(c => {
          if (c.choreId !== variables.choreId || c.profileId !== variables.profileId) return true;
          if (isTodo) return false;
          if (!c.completedAt) return true;
          return new Date(c.completedAt).toDateString() !== dayStr;
        })
      );
      return { previousCompletions };
    },
    onSuccess: (_data, variables) => {
      // Skip re-invalidating chore-completions: the optimistic removal above
      // already reflects the deletion, and a refetch here can race with
      // backend write-propagation and briefly show the item as still done.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      // Un-checking (e.g. undoing yesterday's completion) can also change the
      // streak or freeze eligibility.
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", variables.profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
    },
    onError: (_err, _variables, context) => {
      if (context?.previousCompletions) {
        queryClient.setQueryData(["/api/chore-completions"], context.previousCompletions);
      }
      toast({ title: "Failed to update chore", variant: "destructive" });
    },
  });

  // Viewing a future day: nothing here can be checked off yet, so every
  // circle that would refuse the tap is dimmed rather than looking live and
  // silently doing nothing. To-dos are exempt — they aren't day-scheduled.
  const futureDay = isFutureDate(selectedDate);

  const toggleChore = (chore: Chore, e?: React.MouseEvent) => {
    if (isChoreCompleted(chore.id)) {
      clearCelebratedAllDone(profile.id, selectedDate, chore.taskType === "todo" ? "todos" : "chores");
      uncompleteChore.mutate({ choreId: chore.id, profileId: profile.id, date: selectedDate });
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

      // Bounce animation
      setCelebratingChore(`${chore.id}|${profile.id}`);
      setTimeout(() => setCelebratingChore(null), 1000);

      // Hold the chore in place for 30 s so rapid multi-chore checking
      // doesn't shift list positions while the user is still tapping.
      setPendingBottomChores(prev => new Set([...prev, chore.id]));
      setTimeout(() => {
        setPendingBottomChores(prev => {
          const next = new Set(prev);
          next.delete(chore.id);
          return next;
        });
      }, 30000);

      // Flying star animation — skipped entirely for a per_completion
      // checklist chore (regular, non-bonus, non-todo): it earns nothing of
      // its own in that mode, so a star flying to the tally — even bare, with
      // no "+N" — still visually implies stars were just added, which isn't
      // true. Bonus chores and to-dos DO earn their own points in both modes,
      // so they keep the animation.
      const earnsOwn = !perCompletionMode || chore.isBonus || chore.taskType === "todo";
      if (e && (chore.points ?? 0) > 0 && earnsOwn) {
        const fromRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const fromX = fromRect.left + fromRect.width / 2;
        const fromY = fromRect.top + fromRect.height / 2;
        const starBadge = starBadgeRef.current;
        const toRect = starBadge
          ? starBadge.getBoundingClientRect()
          : { left: window.innerWidth - 80, top: 80, width: 40, height: 24 };
        const toX = toRect.left + (toRect as DOMRect).width / 2;
        const toY = toRect.top + (toRect as DOMRect).height / 2;
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

      // "Today" keeps the real current time — home-view.tsx's "was this just
      // completed" 30s-hold check (computeDoneForProfile's DONE_DELAY_MS)
      // compares Date.now() against this exact value, so stamping it at noon
      // unconditionally (the old behavior) made that check almost always see
      // a multi-hour-old "age" instead of a few-seconds-old one — the item
      // skipped its 30s grace period and was immediately reclassified as
      // "done", pulling it out of this card's own list before its checkmark/
      // strikethrough ever rendered and dropping it straight into the
      // separate Done(N) recap instead. Matches chores-view.tsx's own
      // completedAt, which already got this right. A backdated (non-today)
      // completion has no real completion time to preserve, so it still
      // gets stamped at noon of that day — also avoids any UTC-boundary
      // rollover at local midnight.
      const completedAt = isToday(selectedDate)
        ? new Date()
        : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 12, 0, 0);
      const localDayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0);
      completeChore.mutate({ choreId: chore.id, profileId: profile.id, points: chore.points || 1, completedAt, localDayStart });
    }
  };

  // ── Event mutations ───────────────────────────────────────────────────────
  const closeEventModal = () => {
    setShowEventModal(false);
    setSelectedEventForModal(null);
    setRecurringScope(null);
    setEventFormData(EMPTY_EVENT_FORM);
    setEventSelectedSlot(null);
  };

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const r = await apiRequest("PATCH", `/api/events/${id}`, data);
      return r.json();
    },
    onSuccess: (saved) => {
      // Show it immediately, then reconcile — see lib/eventCache.ts.
      applySavedEventToCache(queryClient, saved);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event updated!" });
      closeEventModal();
    },
    onError: () => toast({ title: "Failed to update event", variant: "destructive" }),
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/events/${id}`);
      return id;
    },
    onSuccess: (id) => {
      removeEventFromCache(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event deleted!" });
      closeEventModal();
    },
    onError: () => toast({ title: "Failed to delete event", variant: "destructive" }),
  });

  const updateGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId, eventData }: {
      profileId: string; calendarId: string; eventId: string; eventData: any;
    }) => {
      const r = await apiRequest("PATCH", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`, eventData);
      return { saved: await r.json(), eventId, eventData };
    },
    onSuccess: ({ eventId, eventData }) => {
      // Refetching a Google event means a round-trip all the way to Google, so
      // patch the assignment we just saved into the cache first.
      if (eventData?.profileIds !== undefined) {
        applyGoogleAssignmentToCache(queryClient, {
          eventId,
          recurringEventId: eventData.recurringEventId ?? null,
          applyToSeries: !!eventData.applyToSeries,
          occurrenceStart: eventData.occurrenceStart ?? null,
          profileIds: eventData.profileIds,
          drivingProfileIds: eventData.drivingProfileIds ?? [],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
      toast({ title: "Event updated!" });
      closeEventModal();
    },
    onError: () => toast({ title: "Failed to update Google Calendar event", variant: "destructive" }),
  });

  const deleteGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId }: {
      profileId: string; calendarId: string; eventId: string;
    }) => {
      await apiRequest("DELETE", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
      toast({ title: "Event deleted!" });
      closeEventModal();
    },
    onError: (error: Error) => toast({ title: error.message || "Failed to delete Google Calendar event", variant: "destructive" }),
  });

  const handleEventClick = (ev: any) => {
    setSelectedEventForModal(ev);
    setEventFormData({
      title: ev.title || "",
      location: ev.location || "",
      description: ev.description || "",
      isAllDay: ev.isAllDay || false,
      profileIds: Array.isArray(ev.profileIds) ? ev.profileIds : [],
      drivingProfileIds: driverIdsOf(ev as any),
      recurrenceType: ev.recurrenceType || "none",
      recurrenceEndDate: ev.recurrenceEndDate ? new Date(ev.recurrenceEndDate).toISOString().slice(0, 10) : null,
    });
    setEventSelectedSlot({
      start: ev.startTime instanceof Date ? ev.startTime : new Date(ev.startTime),
      end: ev.endTime instanceof Date ? ev.endTime : new Date(ev.endTime),
    });
    setShowEventModal(true);
  };

  const submitGoogleEventUpdate = (ev: any, eventData: any, applyToSeries: boolean) => {
    return updateGoogleEventMutation.mutateAsync({
      profileId: ev._googleProfileId,
      calendarId: ev._googleCalendarId,
      eventId: ev._googleEventId,
      eventData: { ...eventData, applyToSeries },
    });
  };

  const handleEventSubmit = async (fd: EventFormData) => {
    const ev = selectedEventForModal;
    if (!ev || !eventSelectedSlot) return;
    if (ev._isGoogleEvent && ev._googleEventId && ev._googleCalendarId && ev._googleProfileId) {
      // Mirror the Calendar tab's recurring-event scope choice — this path
      // previously wrote a silent single-occurrence assignment with no way to
      // apply the change to the whole series.
      const eventData: any = {
        title: fd.title.trim(),
        description: fd.description?.trim() || null,
        location: fd.location?.trim() || null,
        start: eventSelectedSlot.start,
        end: eventSelectedSlot.end,
        profileIds: fd.profileIds,
        drivingProfileIds: fd.drivingProfileIds,
        recurringEventId: ev._recurringEventId ?? null,
        occurrenceStart: ev.startTime ? new Date(ev.startTime).toISOString() : null,
      };
      const prevIds = [...(Array.isArray(ev.profileIds) ? ev.profileIds : [])].sort();
      const nextIds = [...fd.profileIds].sort();
      const assignmentChanged =
        prevIds.length !== nextIds.length ||
        prevIds.some((id, i) => id !== nextIds[i]) ||
        !sameIds(driverIdsOf(ev as any), fd.drivingProfileIds);
      if (ev._recurringEventId && assignmentChanged) {
        setRecurringScope({ eventData, ev });
        return;
      }
      await submitGoogleEventUpdate(ev, eventData, false);
    } else {
      await updateEventMutation.mutateAsync({
        id: ev.id,
        data: {
          title: fd.title.trim(),
          description: fd.description?.trim() || null,
          location: fd.location?.trim() || null,
          startTime: eventSelectedSlot.start,
          endTime: eventSelectedSlot.end,
          profileIds: fd.profileIds,
          isAllDay: fd.isAllDay,
          drivingProfileIds: fd.drivingProfileIds,
          recurrenceType: fd.recurrenceType === "none" ? null : fd.recurrenceType,
          recurrenceEndDate: fd.recurrenceEndDate ? new Date(fd.recurrenceEndDate) : null,
        },
      });
    }
  };

  const handleEventDelete = async () => {
    const ev = selectedEventForModal;
    if (!ev) return;
    const isSeries = ev.isRecurringInstance || !!ev.recurrenceType;
    const ok = isSeries ? await confirmDialog({ title: "Delete this repeating event?", description: DELETE_SERIES_BODY, confirmLabel: "Delete series" }) : await confirmDialog({ title: "Delete this event?", confirmLabel: "Delete event" });
    if (!ok) return;
    if (ev._isGoogleEvent && ev._googleEventId && ev._googleCalendarId && ev._googleProfileId) {
      await deleteGoogleEventMutation.mutateAsync({
        profileId: ev._googleProfileId,
        calendarId: ev._googleCalendarId,
        eventId: ev._googleEventId,
      });
    } else {
      await deleteEventMutation.mutateAsync(ev.id);
    }
  };

  // ── Daily content mutation ────────────────────────────────────────────────
  const completeDailyItem = useMutation({
    mutationFn: async (data: { contentId: string; profileId: string; completedAt: Date }) => {
      const res = await apiRequest("POST", "/api/daily-content-completions", {
        contentId: data.contentId,
        profileId: data.profileId,
        completedAt: data.completedAt.toISOString(),
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/daily-content-completions"] }),
    onError: () => toast({ title: "Failed to mark item complete", variant: "destructive" }),
  });

  const uncompleteDailyItem = useMutation({
    mutationFn: async (data: { contentId: string; profileId: string }) => {
      await apiRequest("DELETE", `/api/daily-content-completions/${data.contentId}/${data.profileId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/daily-content-completions"] }),
    onError: () => toast({ title: "Failed to update item", variant: "destructive" }),
  });

  const toggleDailyItem = (contentId: string) => {
    if (isDailyItemCompleted(contentId)) {
      uncompleteDailyItem.mutate({ contentId, profileId: profile.id });
    } else {
      // Same rule chores already had, which notes were silently missing: you
      // can't tick something off before its day arrives. Tapping did nothing
      // at all, with no explanation.
      if (isFutureDate(selectedDate)) {
        toast({
          title: "Not due yet",
          description: `Not scheduled until ${format(selectedDate, "EEEE, MMM d")}.`,
        });
        return;
      }
      completeDailyItem.mutate({ contentId, profileId: profile.id, completedAt: selectedDate });
    }
  };


  // Split into mutually-exclusive buckets so a bonus or target-count chore
  // never also lands in the plain "Chores" section — previously bonus chores
  // (when scoped to specific people, not "open to everyone") and target-count
  // chores both fell straight into regularChores with no visual distinction
  // from an ordinary daily chore, which read as confusing ("is this an extra
  // chore or a regular one?"). Priority: bonus first (it's a distinct concept
  // regardless of taskType/targetCount), then to-do, then target-count, then
  // other task types, then plain chores.
  const bonusChores    = useMemo(() => profileChores.filter(c => c.isBonus), [profileChores]);
  const targetChores   = useMemo(() => profileChores.filter(c => !c.isBonus && c.taskType !== "todo" && !!c.targetCount && c.targetCount > 0), [profileChores]);
  const otherTaskChores = useMemo(() => profileChores.filter(c => !c.isBonus && c.taskType && c.taskType !== "chore" && c.taskType !== "todo" && !(c.targetCount && c.targetCount > 0)), [profileChores]);
  const regularChores  = useMemo(() => profileChores.filter(c => !c.isBonus && (!c.taskType || c.taskType === "chore") && !(c.targetCount && c.targetCount > 0)), [profileChores]);

  // Shared "completed items sink to the bottom, held in place for 30s" sort —
  // used identically by every section below.
  const sortByDone = useCallback((list: Chore[]) =>
    [...list].sort((a, b) => {
      const aDone = isChoreCompleted(a.id) && !pendingBottomChores.has(a.id);
      const bDone = isChoreCompleted(b.id) && !pendingBottomChores.has(b.id);
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [choreCompletions, pendingBottomChores]);
  const sortedRegularChores = useMemo(() => sortByDone(regularChores), [regularChores, sortByDone]);
  const sortedBonusChores = useMemo(() => sortByDone(bonusChores), [bonusChores, sortByDone]);
  const sortedTargetChores = useMemo(() => sortByDone(targetChores), [targetChores, sortByDone]);
  const sortedOtherTaskChores = useMemo(() => sortByDone(otherTaskChores), [otherTaskChores, sortByDone]);

  const completedChores      = profileChores.filter(c => isChoreCompleted(c.id)).length;
  const completedInspiration = inspirationItems.filter(d => isDailyItemCompleted(d.id)).length;

  // Total earned points (all time) for this profile. In per_completion mode
  // individual chores earn 0 (the daily bonus pays out instead), so the total
  // must come from the authoritative backend value, not a client completion sum.
  const { data: backendPoints } = useQuery<{ points: number }>({
    queryKey: ["/api/points", profile.id],
    staleTime: 15_000,
  });
  const clientPointSum = choreCompletions
    .filter(cc => cc.profileId === profile.id)
    .reduce((sum, cc) => sum + (cc.points || 0), 0);
  // Server total is authoritative (subtracts redemptions, includes bonuses);
  // the client sum only bridges the first paint.
  const totalPoints = backendPoints?.points ?? clientPointSum;

  // Health reminders count — same cache key as HealthRemindersSection so no extra request
  const { data: healthReminders = [] } = useQuery<{ id: string }[]>({
    queryKey: [`/api/health-reminders?profileId=${profile.id}&includePaused=true`],
  });

  // Streak — two-element key (matches the convention used elsewhere, e.g.
  // chores-view.tsx) so a single ["/api/streaks", profileId] invalidation
  // call reaches this query too.
  const { data: streakData } = useQuery<{ streak: number }>({
    queryKey: ["/api/streaks", profile.id],
  });
  const currentStreak = streakData?.streak ?? 0;

  // Filter events: optionally hide past events (only applies when viewing today)
  const visibleEvents = useMemo(() => {
    if (!showPastEvents && isToday(selectedDate)) {
      const now = new Date();
      return profileEvents.filter(ev => !isBefore(new Date(ev.endTime), now));
    }
    return profileEvents;
  }, [profileEvents, showPastEvents, selectedDate]);

  const isEmpty =
    profileEvents.length === 0 &&
    profileChores.length === 0 &&
    profileDailyItems.length === 0;

  // Reusable daily-item list renderer
  const renderDailyList = (items: DailyContent[]) => (
    <ul className="space-y-1.5">
      {items.map(item => {
        const done = isDailyItemCompleted(item.id);
        const meta = CONTENT_TYPE_META[item.type] ?? CONTENT_TYPE_META.custom;
        const Icon = meta.icon;
        return (
          <li
            key={item.id}
            className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors cursor-pointer select-none ${
              done
                ? "bg-green-500/8 border-green-400/30"
                : "bg-card border-border hover:border-purple-400/40 hover:bg-purple-500/5"
            }`}
            onClick={() => {
              if (item.type === "affirmation" || item.type === "bible_verse" || item.type === "memory_verse") {
                setViewingDailyItem(item);
              } else {
                toggleDailyItem(item.id);
              }
            }}
          >
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                done ? "bg-green-500 border-green-500 text-white" : futureDay ? "border-muted-foreground/30" : "border-muted-foreground"
              }`}
            >
              {done && <Check className="w-3 h-3" />}
            </div>
            <div className="flex-1 min-w-0">
              {item.type !== "note" && (
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon className={`w-3 h-3 flex-shrink-0 ${meta.color}`} />
                  <span className="text-xs text-muted-foreground">{meta.label}</span>
                </div>
              )}
              <p className={`text-sm ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {item.title}
              </p>
              {item.content && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.content}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
    <Card className={noCard ? "flex flex-col overflow-hidden bg-transparent border-0 shadow-none rounded-none" : "flex flex-col overflow-hidden border border-border shadow-sm"}>
      {/* Card header — profile identity */}
      {!noCard && <CardHeader className="pb-3 pt-4 px-5" style={{ borderTop: `4px solid ${profile.color}` }}>
        <div className="flex items-center gap-3">
          <ProfileAvatar profile={profile} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="font-bold text-lg text-foreground truncate">{profile.name}</h3>
                {isKidProfile(profile) && (
                  <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
                    Kid
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {currentStreak > 0 && (
                  <span className="flex items-center gap-0.5 text-orange-500 font-semibold text-base">
                    <Flame className="w-5 h-5 fill-orange-400 text-orange-400" />
                    {currentStreak}
                  </span>
                )}
                {totalPoints > 0 && (
                  <div
                    className="relative cursor-pointer select-none"
                    onClick={() => {
                      setStarburstActive(true);
                      setTimeout(() => setStarburstActive(false), 900);
                    }}
                  >
                    <motion.span
                      ref={starBadgeRef}
                      className="flex items-center gap-1 text-amber-500 font-bold text-base"
                      animate={starburstActive ? { scale: [1, 1.5, 1] } : {}}
                      transition={{ duration: 0.35 }}
                    >
                      <Star className="w-6 h-6 fill-amber-400 text-amber-400" />
                      {totalPoints.toLocaleString()}
                    </motion.span>
                    <AnimatePresence>
                      {starburstActive && (
                        <>
                          {[...Array(8)].map((_, i) => {
                            const angle = ((i * 45) - 90) * (Math.PI / 180);
                            const dist = 32 + (i % 2) * 12;
                            const tx = Math.cos(angle) * dist;
                            const ty = Math.sin(angle) * dist;
                            return (
                              <motion.span
                                key={i}
                                className="absolute pointer-events-none"
                                style={{ left: "50%", top: "50%", translateX: "-50%", translateY: "-50%", fontSize: 9 + (i % 3) * 2 }}
                                initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                                animate={{ opacity: 0, x: tx, y: ty, scale: 0.4 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.65, ease: "easeOut" }}
                              >⭐</motion.span>
                            );
                          })}
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              {profileChores.length > 0 && (
                <span className="flex items-center gap-1">
                  <ListTodo className="w-3 h-3" />
                  {completedChores}/{profileChores.length} chores
                </span>
              )}
              {inspirationItems.length > 0 && (
                <span className="flex items-center gap-1">
                  <BookOpen className="w-3 h-3" />
                  {completedInspiration}/{inspirationItems.length} inspiration
                </span>
              )}
              {profileEvents.length > 0 && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {profileEvents.length} event{profileEvents.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {/* Progress bar — same style as Overview → Today's Progress */}
            {(profileChores.length + inspirationItems.length) > 0 && (
              <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                <div
                  className="progress-bar-fill h-1.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round(
                      ((completedChores + completedInspiration) /
                        (profileChores.length + inspirationItems.length)) * 100
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </CardHeader>}

      <CardContent className={noCard ? "flex-1 px-0 pb-0 space-y-5" : "flex-1 px-5 pb-5 space-y-5"}>
        {isEmpty && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nothing remaining {isToday(selectedDate) ? "today" : `for ${format(selectedDate, "MMM d")}`}.
          </p>
        )}

        {/* ── Events ─────────────────────────────────────────────────────── */}
        {showEvents && visibleEvents.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <h4
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-blue-500 transition-colors"
                onClick={() => onNavigate?.("calendar")}
              >Events</h4>
              {!showPastEvents && isToday(selectedDate) && profileEvents.length > visibleEvents.length && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {profileEvents.length - visibleEvents.length} past hidden
                </span>
              )}
              <button
                type="button"
                className={`p-0.5 text-muted-foreground hover:text-foreground transition-colors ${
                  !showPastEvents && isToday(selectedDate) && profileEvents.length > visibleEvents.length ? "" : "ml-auto"
                }`}
                onClick={() => toggleSection("events")}
                aria-label={collapsedSections.has("events") ? "Expand Events" : "Collapse Events"}
                data-testid="section-toggle-events"
              >
                {collapsedSections.has("events") ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!collapsedSections.has("events") && (
            <ul className="space-y-2">
              {visibleEvents.map(ev => {
                const start = new Date(ev.startTime);
                const end   = new Date(ev.endTime);
                const isExternal = String(ev.id).startsWith("google-") || String(ev.id).startsWith("outlook-");
                return (
                  <li
                    key={ev.id}
                    className="flex gap-2.5 items-start p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10 cursor-pointer hover:bg-blue-500/10 hover:border-blue-400/30 transition-colors"
                    onClick={() => handleEventClick(ev)}
                  >
                    <div
                      className="w-1 rounded-full self-stretch flex-shrink-0"
                      style={{ backgroundColor: profile.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{ev.title || "Untitled Event"}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        {!ev.isAllDay && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(start, "h:mm a")}
                            {" – "}
                            {format(end, "h:mm a")}
                          </span>
                        )}
                        {ev.isAllDay && (
                          <Badge variant="outline" className="text-xs px-1 py-0 h-4">All day</Badge>
                        )}
                        {isExternal && (
                          <Badge variant="outline" className="text-xs px-1 py-0 h-4 text-muted-foreground">
                            {String(ev.id).startsWith("google-") ? "Google" : "Outlook"}
                          </Badge>
                        )}
                      </div>
                      {ev.location && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {ev.location}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        )}

        {/* ── Chores ─────────────────────────────────────────────────────── */}
        {regularChores.length > 0 && (
          <TaskSection
            sectionKey="chores"
            icon={<ListTodo className="w-3.5 h-3.5 text-muted-foreground" />}
            title="Chores"
            titleHoverClass="hover:text-foreground"
            allDone={regularChores.every(c => isChoreCompleted(c.id))}
            collapsed={collapsedSections.has("chores")}
            onToggle={() => toggleSection("chores")}
            onTitleClick={() => onNavigate?.("chores")}
          >
            <ul className="space-y-1.5">
              {sortedRegularChores.map(chore => {
                const done = isChoreCompleted(chore.id);
                const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                return (
                  <motion.li
                    layout
                    transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                    key={chore.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none ${
                      celebrating
                        ? "animate-bounce bg-green-500/10 border-green-400"
                        : done
                          ? "bg-accent/30 border-green-400/30"
                          : "bg-card border-border hover:border-orange-400/40 hover:bg-orange-500/5"
                    }`}
                    onClick={(e) => toggleChore(chore, e)}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        done ? "bg-green-500 border-green-500 text-white" : futureDay ? "border-muted-foreground/30" : "border-muted-foreground hover:border-primary hover:bg-primary/10"
                      }`}
                    >
                      {done && <Check className="w-3 h-3" />}
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {chore.icon && (
                        <ChoreIcon icon={chore.icon} className="w-4 h-4" />
                      )}
                      <span className={`text-sm transition-all duration-200 ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {chore.title}
                      </span>
                    </div>
                    {done ? (
                      <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                        <Trophy className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Done!</span>
                      </div>
                    ) : (chore.points ?? 0) > 0 && !perCompletionMode ? (
                      <span className="text-xs text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                        <Star className="w-3 h-3" />
                        {chore.points}
                      </span>
                    ) : null}
                  </motion.li>
                );
              })}
            </ul>
          </TaskSection>
        )}

        {/* ── Bonus Chores ───────────────────────────────────────────────── */}
        {onNavigateToBonusChores ? (
          // Home has no dedicated Bonus Chores card of its own (unlike the
          // Tasks tab, where Bonus is already its own card) — so instead of
          // duplicating the list here, link straight to the real card so the
          // person can see full claim options/frequency limits there.
          <button
            type="button"
            onClick={onNavigateToBonusChores}
            // Was a yellow-tinted, yellow-bordered row — the only coloured
            // block on the card, so it read as the most important thing on it
            // rather than as one more link. Neutral now; the count carries
            // whatever urgency there is.
            className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-border hover:bg-accent/40 transition-colors text-left"
            data-testid="link-bonus-chores"
          >
            <Gift className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 text-sm font-medium text-foreground">Bonus Chores</span>
            {bonusChores.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                {bonusChores.length} available
              </Badge>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </button>
        ) : bonusChores.length > 0 && (
          <TaskSection
            sectionKey="bonus"
            icon={<Gift className="w-3.5 h-3.5 text-muted-foreground" />}
            title="Bonus"
            titleHoverClass="hover:text-foreground"
            allDone={bonusChores.every(c => isChoreCompleted(c.id))}
            collapsed={collapsedSections.has("bonus")}
            onToggle={() => toggleSection("bonus")}
            onTitleClick={() => onNavigate?.("chores")}
          >
            <ul className="space-y-1.5">
              {sortedBonusChores.map(chore => {
                const done = isChoreCompleted(chore.id);
                const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                return (
                  <motion.li
                    layout
                    transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                    key={chore.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none ${
                      celebrating
                        ? "animate-bounce bg-green-500/10 border-green-400"
                        : done
                          ? "bg-accent/30 border-green-400/30"
                          : "bg-card border-border hover:border-yellow-400/40 hover:bg-yellow-500/5"
                    }`}
                    onClick={(e) => toggleChore(chore, e)}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        done ? "bg-green-500 border-green-500 text-white" : futureDay ? "border-muted-foreground/30" : "border-muted-foreground hover:border-yellow-500 hover:bg-yellow-500/10"
                      }`}
                    >
                      {done && <Check className="w-3 h-3" />}
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {chore.icon && (
                        <ChoreIcon icon={chore.icon} className="w-4 h-4" />
                      )}
                      <span className={`text-sm transition-all duration-200 ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {chore.title}
                      </span>
                    </div>
                    {done ? (
                      <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                        <Trophy className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Done!</span>
                      </div>
                    ) : (chore.points ?? 0) > 0 ? (
                      <span className="text-xs text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                        <Star className="w-3 h-3" />
                        {chore.points}
                      </span>
                    ) : null}
                  </motion.li>
                );
              })}
            </ul>
          </TaskSection>
        )}

        {/* ── Target Chores (weekly/monthly count) ──────────────────────── */}
        {targetChores.length > 0 && (
          <TaskSection
            sectionKey="target"
            icon={<TargetIcon className="w-3.5 h-3.5 text-muted-foreground" />}
            title="Target Chores"
            titleHoverClass="hover:text-foreground"
            allDone={targetChores.every(c => getPeriodProgress(c) >= (c.targetCount ?? 0))}
            collapsed={collapsedSections.has("target")}
            onToggle={() => toggleSection("target")}
            onTitleClick={() => onNavigate?.("chores")}
          >
            <ul className="space-y-1.5">
              {sortedTargetChores.map(chore => {
                const done = isChoreCompleted(chore.id);
                const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                const progress = getPeriodProgress(chore);
                const target = chore.targetCount ?? 0;
                const periodLabel = chore.recurrenceType === "monthly" ? "mo" : "wk";
                return (
                  <motion.li
                    layout
                    transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                    key={chore.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none ${
                      celebrating
                        ? "animate-bounce bg-green-500/10 border-green-400"
                        : done
                          ? "bg-accent/30 border-green-400/30"
                          : "bg-card border-border hover:border-teal-400/40 hover:bg-teal-500/5"
                    }`}
                    onClick={(e) => toggleChore(chore, e)}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        done ? "bg-green-500 border-green-500 text-white" : futureDay ? "border-muted-foreground/30" : "border-muted-foreground hover:border-teal-500 hover:bg-teal-500/10"
                      }`}
                    >
                      {done && <Check className="w-3 h-3" />}
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {chore.icon && (
                        <ChoreIcon icon={chore.icon} className="w-4 h-4" />
                      )}
                      <span className={`text-sm transition-all duration-200 ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {chore.title}
                      </span>
                    </div>
                    <span className="text-xs text-teal-600 dark:text-teal-400 flex items-center gap-0.5 flex-shrink-0 font-medium">
                      {Math.min(progress, target)}/{target} · {periodLabel}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
          </TaskSection>
        )}

        {/* ── Other Tasks (affirmations, memory verses, etc.) ─────────────── */}
        {otherTaskChores.length > 0 && (
          <TaskSection
            sectionKey="inspiration-tasks"
            icon={<Sparkles className="w-3.5 h-3.5 text-muted-foreground" />}
            title="Inspiration"
            titleHoverClass="hover:text-foreground"
            allDone={otherTaskChores.every(c => isChoreCompleted(c.id))}
            collapsed={collapsedSections.has("inspiration-tasks")}
            onToggle={() => toggleSection("inspiration-tasks")}
            onTitleClick={() => onNavigate?.("chores")}
          >
            <ul className="space-y-1.5">
              {sortedOtherTaskChores.map(chore => {
                const done = isChoreCompleted(chore.id);
                const celebrating = celebratingChore === `${chore.id}|${profile.id}`;
                const meta = taskTypeMeta(chore.taskType);
                return (
                  <motion.li
                    layout
                    transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                    key={chore.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all duration-300 cursor-pointer select-none ${
                      celebrating
                        ? "animate-bounce bg-green-500/10 border-green-400"
                        : done
                          ? "bg-accent/30 border-green-400/30"
                          : "bg-card border-border hover:border-purple-400/40 hover:bg-purple-500/5"
                    }`}
                    onClick={(e) => {
                      // "mission"/"custom" used to fall straight through to
                      // toggleChore with no way to ever see their content —
                      // now every inspiration type opens the same detail
                      // popup (which also has Edit/Delete).
                      if (chore.taskType && chore.taskType !== "chore" && chore.taskType !== "todo") {
                        setViewingChoreItem(chore);
                      } else {
                        toggleChore(chore, e);
                      }
                    }}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        done ? "bg-green-500 border-green-500 text-white" : futureDay ? "border-muted-foreground/30" : "border-muted-foreground hover:border-purple-500 hover:bg-purple-500/10"
                      }`}
                    >
                      {done && <Check className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {chore.icon && <ChoreIcon icon={chore.icon} className="w-4 h-4" />}
                        <span className={`text-sm transition-all duration-200 ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {chore.title}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                        <span>{meta.emoji}</span>
                        <span>{meta.label}</span>
                      </span>
                    </div>
                    {done ? (
                      <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                        <Trophy className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Done!</span>
                      </div>
                    ) : null}
                  </motion.li>
                );
              })}
            </ul>
          </TaskSection>
        )}

        {/* ── To-Dos ──────────────────────────────────────────────────────── */}
        {/* ── Notes ───────────────────────────────────────────────────────── */}
        {/* ── Daily Inspiration (Daily Content system) ──────────────────────
            Deliberately titled differently from the "Inspiration" section
            above (taskType chores created via the unified Create-a-task
            flow) — this is content from the older, separate Daily Content
            system (dailyContent/dailyContentAssignments), which can appear
            in the SAME card as that other section, and identical labels on
            two back-to-back sections showing different content was the
            actual source of "I can't find my Inspiration item" reports —
            the item genuinely was here, just under a section that read as
            a duplicate of the one right above it. Same reasoning as Notes
            above for dropping onTitleClick: this content never appears on
            the Chores tab, so navigating there on tap was actively wrong,
            not just unhelpful. */}
        {inspirationItems.length > 0 && (
          <TaskSection
            sectionKey="inspiration-content"
            icon={<BookOpen className="w-3.5 h-3.5 text-muted-foreground" />}
            title="Daily Inspiration"
            titleHoverClass="hover:text-foreground"
            allDone={completedInspiration === inspirationItems.length}
            collapsed={collapsedSections.has("inspiration-content")}
            onToggle={() => toggleSection("inspiration-content")}
          >
            {renderDailyList(inspirationItems)}
          </TaskSection>
        )}

        {healthReminders.length > 0 && (
          <HealthRemindersSection profile={profile} allProfiles={allProfiles} />
        )}
      </CardContent>
    </Card>

    {/* ── Flying star overlay ─────────────────────────────────────────────── */}
    <AnimatePresence>
      {flyingStars.map(star => {
        const dx = star.toX - star.fromX;
        const dy = star.toY - star.fromY;
        const arcX = star.fromX + dx * 0.45;
        const arcY = star.fromY + dy * 0.45 - 90;
        return (
          <AnimatePresence key={star.id}>
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
                <span className="font-black text-white" style={{ fontSize: 20, textShadow: "0 0 6px #f59e0b, 0 0 14px #f59e0b, 0 2px 4px rgba(0,0,0,0.5)" }}>
                  {star.points != null ? `+${star.points}` : ""}
                </span>
              </div>
            </motion.div>
            {star.trail.map((t, i) => {
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
                >✨</motion.span>
              );
            })}
          </AnimatePresence>
        );
      })}
    </AnimatePresence>

    {/* ── Event detail / edit modal ────────────────────────────────────────── */}
    {showEventModal && selectedEventForModal && (
      <EventModal
        isOpen={showEventModal}
        onClose={closeEventModal}
        onSubmit={handleEventSubmit}
        onDelete={handleEventDelete}
        isEditing
        profiles={allProfiles}
        formData={eventFormData}
        setFormData={setEventFormData}
        selectedSlot={eventSelectedSlot}
        setSelectedSlot={setEventSelectedSlot}
        selectedEvent={selectedEventForModal}
        isSubmitting={updateEventMutation.isPending || updateGoogleEventMutation.isPending}
        isDeleting={deleteEventMutation.isPending || deleteGoogleEventMutation.isPending}
        resetForm={closeEventModal}
      />
    )}

    <Dialog open={!!recurringScope} onOpenChange={(open) => { if (!open) setRecurringScope(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change assignee for…</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This is a repeating event. Who should this change apply to?
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => {
              if (recurringScope) submitGoogleEventUpdate(recurringScope.ev, recurringScope.eventData, false);
              setRecurringScope(null);
            }}
          >
            This event only
          </Button>
          <Button
            onClick={() => {
              if (recurringScope) submitGoogleEventUpdate(recurringScope.ev, recurringScope.eventData, true);
              setRecurringScope(null);
            }}
          >
            This and all following events
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Inspiration-item detail modal — affirmation / Bible verse / memory
        verse / mission / custom, all stored as chores with a taskType. */}
    <Dialog open={!!viewingChoreItem} onOpenChange={(open) => { if (!open) setViewingChoreItem(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {viewingChoreItem && `${taskTypeMeta(viewingChoreItem.taskType).emoji} ${taskTypeMeta(viewingChoreItem.taskType).label}`}
          </DialogTitle>
        </DialogHeader>
        {viewingChoreItem && (
          <div className="space-y-4">
            <p className="text-base font-semibold text-foreground">{viewingChoreItem.title}</p>
            {viewingChoreItem.description ? (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{viewingChoreItem.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No content added yet — tap Edit to add it.</p>
            )}
            {(onEditChore || onDeleteChore) && (
              <div className="flex items-center gap-3">
                {onEditChore && (
                  <button
                    type="button"
                    onClick={() => { onEditChore(viewingChoreItem); setViewingChoreItem(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Edit
                  </button>
                )}
                {onDeleteChore && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (await confirmDialog({ title: `Delete "${viewingChoreItem.title}"?` })) {
                        onDeleteChore(viewingChoreItem);
                        setViewingChoreItem(null);
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
                onClick={() => setViewingChoreItem(null)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
              >
                Go Back
              </button>
              <button
                onClick={(e) => {
                  toggleChore(viewingChoreItem, e as any);
                  setViewingChoreItem(null);
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  isChoreCompleted(viewingChoreItem.id)
                    ? "bg-muted text-muted-foreground hover:bg-muted/80"
                    : "bg-emerald-500 hover:bg-emerald-600 text-white"
                }`}
              >
                <Check className="w-4 h-4" />
                {isChoreCompleted(viewingChoreItem.id) ? "Mark as not done" : "Complete"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Daily content modal — affirmation / bible verse / memory verse */}
    <Dialog open={!!viewingDailyItem} onOpenChange={(open) => { if (!open) setViewingDailyItem(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {viewingDailyItem?.type === "bible_verse" ? "📜 Bible Verse" : viewingDailyItem?.type === "memory_verse" ? "📖 Memory Verse" : "💬 Affirmation"}
          </DialogTitle>
        </DialogHeader>
        {viewingDailyItem && (
          <div className="space-y-4">
            <p className="text-base font-semibold text-foreground">{viewingDailyItem.title}</p>
            {viewingDailyItem.content && (
              <p className="text-sm text-muted-foreground leading-relaxed">{viewingDailyItem.content}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setViewingDailyItem(null)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  toggleDailyItem(viewingDailyItem.id);
                  setViewingDailyItem(null);
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  isDailyItemCompleted(viewingDailyItem.id)
                    ? "bg-muted text-muted-foreground hover:bg-muted/80"
                    : "bg-emerald-500 hover:bg-emerald-600 text-white"
                }`}
              >
                <Check className="w-4 h-4" />
                {isDailyItemCompleted(viewingDailyItem.id) ? "Mark as not done" : "Complete"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  </>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

interface PeopleViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  selectedDate: Date;
  onNavigate?: (tab: string) => void;
  onEditChore?: (chore: Chore) => void;
  onDeleteChore?: (chore: Chore) => void;
}

export function PeopleView({ selectedProfiles, profiles, selectedDate, onNavigate, onEditChore, onDeleteChore }: PeopleViewProps) {
  const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);

  // ── Card display settings ────────────────────────────────────────────────────
  const [settings, setSettings] = useState<PeopleTabSettings>(getPeopleSettings);
  const updateSetting = <K extends keyof PeopleTabSettings>(key: K, value: PeopleTabSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      savePeopleSettings(next);
      return next;
    });
  };

  // ── Core data ───────────────────────────────────────────────────────────────
  const { data: localEvents = [] } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({ queryKey: ["/api/chore-completions"] });
  const { data: dailyContent = [] } = useQuery<DailyContent[]>({ queryKey: ["/api/daily-content"] });
  const { data: dailyAssignments = [] } = useQuery<DailyContentAssignment[]>({ queryKey: ["/api/daily-content-assignments"] });
  const { data: dailyCompletions = [] } = useQuery<DailyContentCompletion[]>({ queryKey: ["/api/daily-content-completions"] });
  const { data: calendarAssignments = [] } = useQuery<CalendarAssignment[]>({ queryKey: ["/api/calendar-assignments"] });

  // ── Google Calendar events per profile ──────────────────────────────────────
  const googleCalendarQueries = useQueries({
    queries: regularProfiles
      .filter(p => p.googleCalendarConnected)
      .map(profile => ({
        queryKey: ["/api/google-calendar/events", profile.id],
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        staleTime: 60_000,
      })),
  });

  // ── Outlook Calendar events per profile ─────────────────────────────────────
  const outlookCalendarQueries = useQueries({
    queries: regularProfiles
      .filter(p => p.outlookCalendarConnected)
      .map(profile => ({
        queryKey: ["/api/outlook-calendar/events", profile.id],
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        staleTime: 60_000,
      })),
  });

  // ── Normalize + combine all events ─────────────────────────────────────────
  const allEvents = useMemo(() => {
    // 1. Local Family Hub events
    const normalized: Array<Event & { startTime: Date; endTime: Date }> = localEvents
      .filter(e => e.startTime && e.endTime)
      .map(e => ({ ...e, startTime: new Date(e.startTime), endTime: new Date(e.endTime) }));

    // 2. Google Calendar events
    const gcProfiles = regularProfiles.filter(p => p.googleCalendarConnected);
    const seenGoogleIds = new Set<string>();
    googleCalendarQueries.forEach((query, idx) => {
      const profileId = gcProfiles[idx]?.id;
      if (!profileId) return;
      const gcEvents: any[] = query.data || [];
      gcEvents.forEach((gcEvent: any) => {
        if (seenGoogleIds.has(gcEvent.id)) return;
        seenGoogleIds.add(gcEvent.id);

        // Shared parser (lib/calendarDates.ts): Google all-day ends are
        // EXCLUSIVE — the old inline version spilled a day over.
        const { start: startTime, end: endTime } = parseGoogleEventDates(gcEvent);

        // Resolve assigned profile(s) via calendarAssignments
        let assignedProfileIds: string[] = [];
        const googleCalendarId = gcEvent.extendedProperties?.private?.['google_calendar_id'];
        if (googleCalendarId) {
          const assignment = calendarAssignments.find(
            (a: any) => a.calendarId === googleCalendarId && a.calendarType === 'google'
          );
          if (assignment) assignedProfileIds = [assignment.profileId];
        }
        // Allow manually-stored profile overrides
        const storedProfileIds = gcEvent.extendedProperties?.private?.['familyhub_profile_ids'];
        if (storedProfileIds) {
          try {
            const parsed = JSON.parse(storedProfileIds);
            if (Array.isArray(parsed) && parsed.length > 0) assignedProfileIds = parsed;
          } catch { /* ignore */ }
        }
        // Fallback: attribute to the profile whose Google account returned it
        if (assignedProfileIds.length === 0) assignedProfileIds = [profileId];


        normalized.push({
          id: `google-${gcEvent.id}`,
          _googleEventId: gcEvent.id,
          _googleProfileId: profileId,
          _googleCalendarId: googleCalendarId || null,
          _recurringEventId: gcEvent.recurringEventId ?? null,
          _isGoogleEvent: true,
          userId: null,
          title: gcEvent.summary || 'Untitled Event',
          description: gcEvent.description || null,
          startTime,
          endTime,
          location: gcEvent.location || null,
          profileIds: assignedProfileIds,
          drivingProfileIds: driverIdsFromGoogleEvent(gcEvent),
          isAllDay: !gcEvent.start?.dateTime,
          calendarId: googleCalendarId || null,
          calendarName: gcEvent.extendedProperties?.private?.['calendar_name'] || 'Google Calendar',
          createdAt: new Date(),
        } as any);
      });
    });

    // 3. Outlook Calendar events
    const outlookProfiles = regularProfiles.filter(p => p.outlookCalendarConnected);
    outlookCalendarQueries.forEach((query, idx) => {
      const profileId = outlookProfiles[idx]?.id;
      if (!profileId) return;
      const outlookEvents: any[] = query.data || [];
      outlookEvents.forEach((oe: any) => {
        const { start: startTime, end: endTime } = parseOutlookEventDates(oe);

        normalized.push({
          id: `outlook-${oe.id}`,
          userId: null,
          title: oe.subject || 'Untitled Event',
          description: oe.bodyPreview || null,
          startTime,
          endTime,
          location: oe.location?.displayName || null,
          profileIds: [profileId],
          isAllDay: oe.isAllDay || false,
          calendarId: oe.calendar?.id || null,
          calendarName: oe.calendar?.name || 'Outlook Calendar',
          createdAt: new Date(),
        } as any);
      });
    });

    return normalized;
  }, [localEvents, googleCalendarQueries, outlookCalendarQueries, calendarAssignments, regularProfiles]);

  // Each query's isError was never read anywhere — a broken/expired
  // connection just returned no events, indistinguishable from a profile
  // with nothing scheduled. calendar3-view.tsx has the equivalent banner.
  const googleSyncError = googleCalendarQueries.some(q => q.isError);
  const outlookSyncError = outlookCalendarQueries.some(q => q.isError);

  // ── Display profile list ────────────────────────────────────────────────────
  const displayProfiles = selectedProfiles.length > 0
    ? regularProfiles.filter(p => selectedProfiles.includes(p.id))
    : regularProfiles;

  if (displayProfiles.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>No one selected — pick someone above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(googleSyncError || outlookSyncError) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {googleSyncError && outlookSyncError
              ? "Google and Outlook Calendar couldn't sync."
              : googleSyncError
                ? "Google Calendar couldn't sync."
                : "Outlook Calendar couldn't sync."}
            {" "}Check Settings → your profile → reconnect.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-foreground">
          {displayProfiles.length === 1
            ? `${displayProfiles[0].name}'s Overview`
            : `Everyone's Overview`}
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm text-muted-foreground hidden sm:block">
            {format(selectedDate, "EEEE, MMMM d")}
          </span>
          {/* Card display settings popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" align="end">
              <p className="text-sm font-semibold mb-3">Card sections</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="people-show-events" className="text-sm cursor-pointer flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                    Show Events
                  </Label>
                  <Switch
                    id="people-show-events"
                    checked={settings.showEvents}
                    onCheckedChange={v => updateSetting("showEvents", v)}
                  />
                </div>
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="people-past-events" className="text-sm cursor-pointer flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      Show past events
                    </Label>
                    <Switch
                      id="people-past-events"
                      checked={settings.showPastEvents}
                      onCheckedChange={v => updateSetting("showPastEvents", v)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    When off, events that have already ended today are hidden.
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className={`grid gap-4 ${
        displayProfiles.length === 1 ? "grid-cols-1 max-w-md" :
        displayProfiles.length === 2 ? "grid-cols-1 sm:grid-cols-2" :
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      }`}>
        {displayProfiles.map(profile => (
          <PersonCard
            key={profile.id}
            profile={profile}
            allProfiles={profiles}
            selectedDate={selectedDate}
            events={allEvents}
            chores={chores}
            choreCompletions={choreCompletions}
            dailyContent={dailyContent}
            dailyAssignments={dailyAssignments}
            dailyCompletions={dailyCompletions}
            onNavigate={onNavigate}
            showEvents={settings.showEvents}
            showPastEvents={settings.showPastEvents}
            onEditChore={onEditChore}
            onDeleteChore={onDeleteChore}
          />
        ))}
      </div>
    </div>
  );
}
