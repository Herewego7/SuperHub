import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCelebrationSuggestion } from "@/hooks/use-celebration-suggestion";
import { Profile, CustomProfileGroup, ChoreCompletion, ActivityLogEntryType, Chore, RewardSettings } from "@workspace/shared-types";
import { ChoreManagementDrawer } from "@/components/chore-management-drawer";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { TabType, ChoresSubTabType } from "@/lib/types";
import { BOTTOM_NAV_IDS } from "@/lib/bottomNav";
import { ChatView } from "@/components/chat-view";
import { appendUserMessage } from "@/lib/chatThread";
import { stageEveningPlan } from "@/components/chat-view";
import { consumeTabDeepLinkFromUrl, onTabDeepLink, consumeCelebrationDeepLinkFromUrl, onCelebrationDeepLink } from "@/lib/pushDeepLink";
import { ProfileCircle } from "@/components/profile-circle";
import { SettingsModal } from "@/components/settings-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { HomeView } from "@/components/home-view";
import { HistoryView } from "@/components/history-view";
import { ChoresView } from "@/components/chores-view";
import { TodosView } from "@/components/todos-view";
import { BonusChoresView } from "@/components/bonus-chores-view";
import { CreateTaskModal, TaskKind, deriveTaskKind, KIND_GATE } from "@/components/create-task-modal";
import { PeopleView } from "@/components/people-view";
import { Calendar3View, type Calendar3ViewHandle } from "@/components/calendar3-view";
import { RewardsView } from "@/components/rewards-view";
import { TrophyCaseView } from "@/components/trophy-case-view";
import { StatsInsightsCard } from "@/components/stats-insights-card";
import { WeatherWidget } from "@/components/weather-widget";
import { MealsView } from "@/components/meals-view";
import { TasksPageSettings, getTasksCardSettings, type TasksCardConfig } from "@/components/tasks-page-settings";
import { CustomizePageCard } from "@/components/customize-page-card";
import { FeatureNudgeController } from "@/components/feature-nudge-controller";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ReminderEditor } from "@/components/health-reminders-section";
import { RecentShoutoutsCard } from "@/components/recent-shoutouts-card";
import { Settings, Home, Calendar, ListTodo, Gift, Trophy, ChevronLeft, ChevronRight, LogOut, UtensilsCrossed, Sparkles, ArrowLeft, Star, Plus, ListChecks, StickyNote, Camera, CalendarPlus, EyeOff, ScrollText, Maximize2, Minimize2, CheckSquare, Smile, MessageCircle } from "lucide-react";
import { format, addDays, subDays, isToday, differenceInWeeks, addWeeks, subWeeks, startOfWeek, isSameDay } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { motion, AnimatePresence } from "framer-motion";
import { PrivacyScreen } from "@/components/privacy-screen";
import { FlyerSnapSheet } from "@/components/flyer-snap-sheet";
import { AddRemoveStarsModal } from "@/components/add-remove-stars-modal";
import { objectUrl } from "@/lib/apiBase";
import { robustScrollIntoView, robustScrollToTop, stickyHeaderOffset } from "@/lib/scroll";
import { useSpotlight } from "@/lib/spotlight";
import { OnboardingWizard, type SkippableStep } from "@/components/onboarding-wizard";
import { BehaviourBoardView } from "@/components/behaviour-board-view";
import { BehaviourTimerWidget } from "@/components/behaviour-timer-widget";
import { EventReminderWatcher } from "@/components/event-reminder-watcher";
import { ConfirmDialogHost } from "@/lib/confirmDialog";
import { UpgradeDialogHost } from "@/lib/upgradeDialog";
import { ScreensaverOverlay } from "@/components/screensaver-overlay";
import { useClaimExistingSubscription } from "@/hooks/use-subscription";
import { hapticSuccess } from "@/lib/haptics";
import { useEdgeSwipeDateNav } from "@/lib/useEdgeSwipeDateNav";
import { useParentGate } from "@/lib/parentGate";
import { refreshNativePushRegistration } from "@/lib/nativeNotifications";
import { useLocalHealthReminders } from "@/hooks/useLocalHealthReminders";
import confetti from "canvas-confetti";

// These were previously one shared constant; split so the date-reset timer
// (Home/Tasks/People snapping back to Today) can be tuned independently of
// the separate "return to the default tab" inactivity timer below.
const DATE_RESET_MS = 10 * 60 * 1000; // 10 minutes
const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

// 'behaviour' deliberately excluded — the Behavior tab is hidden from the
// nav/Settings entirely for now (still fully functional in code, just not
// discoverable) per an explicit request; see ALL_NAV_TAB_CONFIGS below.
const DEFAULT_TAB_ORDER = ['home', 'calendar', 'chores', 'meals', 'chat'];

interface NavTabConfig {
  id: TabType;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  shortLabel?: string;
  testId: string;
  alwaysVisible?: boolean;
}

// 'behaviour' deliberately omitted from this list — the Behavior Board is
// hidden from the nav entirely for now, per an explicit "don't change any
// functionality, just hide all references to this tab" request. The
// underlying tab (behaviour-board-view.tsx), its TabType value, and all its
// routing/state still exist and work — navigateTo("behaviour") still lands
// on it — this list is purely what the tab-pill row renders, so leaving an
// entry out is enough to make it undiscoverable without removing anything.
const ALL_NAV_TAB_CONFIGS: NavTabConfig[] = [
  { id: 'home',      icon: Home,            label: 'Home',     testId: 'home-tab',     alwaysVisible: true },
  { id: 'calendar',  icon: Calendar,        label: 'Calendar', testId: 'calendar-tab', alwaysVisible: true },
  { id: 'chores',    icon: ListTodo,        label: 'Chores',   testId: 'chores-tab',   alwaysVisible: true },
  { id: 'meals',     icon: UtensilsCrossed, label: 'Meals',    testId: 'meals-tab',    alwaysVisible: true },
  { id: 'chat',      icon: MessageCircle,   label: 'Chat',     testId: 'chat-tab',     alwaysVisible: true },
];

export default function FamilyHub() {
  // Links any subscription this Apple ID already owns to the signed-in
  // account, once per launch — the App Store page, a reinstall and a second
  // device all produce a paid subscriber the server has never been told about.
  useClaimExistingSubscription();
  const { user, logout } = useAuth();
  const suggestCelebration = useCelebrationSuggestion();

  // Locks in, the first time we see real data, whether this account began
  // with zero profiles (a brand-new family). Read below, alongside the
  // isLoading gate. This must not be re-derived from the live profile count
  // on every render — adding the very first profile during onboarding's own
  // "setup" step would otherwise flip it (profiles.length goes from 0 to 1
  // mid-wizard), which would either bounce a brand-new user out of
  // onboarding early or misclassify them into the joiner flow partway
  // through.
  const startedWithNoProfilesRef = useRef<boolean | null>(null);

  // The "By Person" tab was removed from the nav entirely (no longer
  // togglable from Settings) — if a device had it saved as its default tab
  // from before, fall back to home so it doesn't land on an unreachable tab.
  if (localStorage.getItem('familyHub_defaultTab') === 'people') {
    localStorage.setItem('familyHub_defaultTab', 'home');
  }

  // One-time init: hide the "Behavior" tab by default. Runs once; later
  // user changes to tab visibility are respected because the marker is set.
  (() => {
    if (localStorage.getItem('familyHub_behaviourTabInit')) return;
    let hidden: string[] = [];
    try {
      hidden = JSON.parse(localStorage.getItem('familyHub_hiddenTabs') || '[]');
    } catch {}
    if (!hidden.includes('behaviour')) hidden.push('behaviour');
    localStorage.setItem('familyHub_hiddenTabs', JSON.stringify(hidden));
    localStorage.setItem('familyHub_behaviourTabInit', '1');
    // If "behaviour" was previously a saved default tab, fall back to home.
    if (localStorage.getItem('familyHub_defaultTab') === 'behaviour') {
      localStorage.setItem('familyHub_defaultTab', 'home');
    }
  })();

  // To-Dos is now visible by default (2026-08-27) — it previously shipped
  // hidden-by-default via a one-time init (below, now removed) right after
  // To-Dos moved out of the combined Tasks/Chores tab into its own tab.
  // This does NOT touch any device that already ran that old init: it wrote
  // 'todos' into the persisted familyHub_hiddenTabs list, which is still
  // read and respected exactly as before — only a genuinely fresh device
  // (no saved hiddenTabs at all) sees the new default. The onboarding Quick
  // Tour's copy was updated to match — see onboarding-tour.tsx.

  // Migrate old tab IDs stored in localStorage
  // (calendar3→calendar, daily/inspiration→chores — Inspiration is now part of Tasks)
  (() => {
    const TAB_RENAMES: Record<string, string> = { calendar3: 'calendar', daily: 'chores', inspiration: 'chores' };
    const def = localStorage.getItem('familyHub_defaultTab');
    if (def && TAB_RENAMES[def]) localStorage.setItem('familyHub_defaultTab', TAB_RENAMES[def]);
    try {
      const order: string[] = JSON.parse(localStorage.getItem('familyHub_tabOrder') || '[]');
      if (order.some(t => TAB_RENAMES[t])) {
        // Map then de-duplicate (inspiration→chores can collide with existing chores entry)
        const mapped = order.map(t => TAB_RENAMES[t] ?? t).filter((t, i, a) => a.indexOf(t) === i);
        localStorage.setItem('familyHub_tabOrder', JSON.stringify(mapped));
      }
    } catch {}
  })();

  // Default tab — persisted to localStorage
  const [defaultTab, setDefaultTabState] = useState<TabType>(() => {
    return (localStorage.getItem('familyHub_defaultTab') as TabType) ?? 'home';
  });
  const setDefaultTab = (tab: TabType) => {
    setDefaultTabState(tab);
    localStorage.setItem('familyHub_defaultTab', tab);
  };

  // Tab order — persisted to localStorage
  const [tabOrder, setTabOrderState] = useState<string[]>(() => {
    const saved = localStorage.getItem('familyHub_tabOrder');
    if (saved) {
      try {
        const parsed: string[] = JSON.parse(saved);
        // Migrate: older saves didn't include 'home'
        const withHome = parsed.includes('home') ? parsed : ['home', ...parsed];
        // Append any tabs added after the order was saved (e.g. 'behaviour'),
        // and drop 'people' if an older save still has it (tab was removed).
        const withoutPeople = withHome.filter(id => id !== 'people');
        const missing = DEFAULT_TAB_ORDER.filter(id => !withoutPeople.includes(id));
        return [...withoutPeople, ...missing];
      } catch {}
    }
    return DEFAULT_TAB_ORDER;
  });
  const setTabOrder = (order: string[]) => {
    setTabOrderState(order);
    localStorage.setItem('familyHub_tabOrder', JSON.stringify(order));
  };

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('familyHub_defaultTab') as TabType | null;
    if (!saved || saved === "todos" || saved === "people") return "home";
    return saved;
  });
  const [chatUnread, setChatUnread] = useState(0);
  const [chatDraft, setChatDraft] = useState("");
  const [chatRevision, setChatRevision] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const [choresSubTab, setChoresSubTab] = useState<ChoresSubTabType>("chores");
  const [pendingOpenEventId, setPendingOpenEventId] = useState<string | null>(null);
  const { spotlight, spotlightOverlay } = useSpotlight();
  // Set only by Home's own "Cash Out"/"Redeem" button — deliberately its own
  // trigger, not folded into the shared chores-section scroll effect below,
  // since that effect also runs for the Announcements "Cash-Out Approvals"
  // deep link, which needs its own DIFFERENT card spotlighted (that one
  // already fires its own spotlight after PIN verification, in
  // rewards-view.tsx) — conflating the two would spotlight the wrong card
  // depending on which path got there first.
  const [cashOutStarsSpotlightTrigger, setCashOutStarsSpotlightTrigger] = useState(0);
  // Pending reward SUGGESTIONS (wishlist items) are a different queue from
  // cash-out approvals and live in their own, un-PIN-gated card directly
  // above Cash-Out Approvals — so their Announcements link must spotlight
  // that card, not open the cash-out PIN dialog.
  const [rewardSuggestionsSpotlightTrigger, setRewardSuggestionsSpotlightTrigger] = useState(0);
  // Same idea as cashOutStarsSpotlightTrigger, for the three Home-tab
  // spotlight targets a push notification can point at.
  const [healthReminderSpotlightTrigger, setHealthReminderSpotlightTrigger] = useState(0);
  const [praiseSpotlightTrigger, setPraiseSpotlightTrigger] = useState(0);
  const [notesSpotlightTrigger, setNotesSpotlightTrigger] = useState(0);

  // ── Global "Add Chore" modal (available on every tab) ──────────────────

  // ── Unified "Create a task" modal (picker → tailored form). Opened with a
  // kind (card-level "+" jumps straight to that form) or null (global "+" and
  // any generic entry point show the type picker first). The modal PIN-gates
  // the actual save per kind, so opening it is always safe/ungated.
  const [createTask, setCreateTask] = useState<{ open: boolean; kind: TaskKind | null; editChore: Chore | null }>({ open: false, kind: null, editChore: null });
  const openCreateTask = (kind: TaskKind | null) => setCreateTask({ open: true, kind, editChore: null });
  const openEditTask = (chore: Chore) => setCreateTask({ open: true, kind: null, editChore: chore });

  // ── One unified "Manage tasks" drawer (replaces the three per-card drawers).
  // Lists every task type; the drawer's own filters slice by kind / Unassigned.
  const [manageTasksOpen, setManageTasksOpen] = useState(false);
  const { data: allTasks = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/chores/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chores/bonus"] });
    },
    onError: (e: any) => toast({ title: "Couldn't delete it", description: e?.message, variant: "destructive" }),
  });
  // Same gate the Manage-drawer's own delete already uses — shared here so
  // any detail view (e.g. an inspiration item's own popup) can offer a
  // Delete action without duplicating the gate-by-kind logic.
  const deleteTask = (chore: Chore) => {
    const gate = KIND_GATE[deriveTaskKind(chore)];
    guardParentAction(gate, () => deleteTaskMutation.mutate(chore.id));
  };

  // ── Global "Add Event" modal (available on every tab) ──────────────────
  const [showGlobalAddEvent, setShowGlobalAddEvent] = useState(false);
  const [globalSlot, setGlobalSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [globalFormData, setGlobalFormData] = useState<EventFormData>({
    title: "", description: "", location: "",
    profileIds: [], isAllDay: false, drivingProfileIds: [] as string[],
    recurrenceType: "none", recurrenceEndDate: null,
  });

  const createGlobalEventMutation = useMutation({
    mutationFn: async () => {
      if (!globalSlot) throw new Error("No time slot selected");
      return (await apiRequest("POST", "/api/events", {
        title: globalFormData.title.trim(),
        description: globalFormData.description.trim() || null,
        location: globalFormData.location.trim() || null,
        startTime: globalSlot.start,
        endTime: globalSlot.end,
        // Driving implies attending — see lib/eventDrivers.ts.
        profileIds: globalFormData.profileIds,
        isAllDay: globalFormData.isAllDay,
        drivingProfileIds: globalFormData.drivingProfileIds,
        calendarId: null,
        calendarName: null,
        recurrenceType: globalFormData.recurrenceType === "none" ? null : globalFormData.recurrenceType,
        recurrenceEndDate: globalFormData.recurrenceEndDate ? new Date(globalFormData.recurrenceEndDate) : null,
      })).json();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event created!" });
      setShowGlobalAddEvent(false);
      setGlobalFormData({ title: "", description: "", location: "", profileIds: [], isAllDay: false, drivingProfileIds: [], recurrenceType: "none", recurrenceEndDate: null });
      // Strictly after the fact, and self-contained: offers to also track a
      // "…'s Birthday" event in Celebrations. Never blocks or alters the
      // save above (see use-celebration-suggestion.tsx).
      void suggestCelebration(saved);
    },
    onError: () => toast({ title: "Failed to create event", variant: "destructive" }),
  });

  const openGlobalAddEvent = () => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setGlobalSlot({ start, end });
    // Every event belongs to someone — default to whoever's currently
    // filtered to, or everyone if no single person is filtered to.
    const realSelected = selectedProfiles.filter((id) => {
      const p = profiles.find((pr) => pr.id === id);
      return p && !p.isAllFamilyProfile;
    });
    const defaultProfileIds = realSelected.length > 0
      ? realSelected
      : profiles.filter((p) => !p.isAllFamilyProfile).map((p) => p.id);
    setGlobalFormData({ title: "", description: "", location: "", profileIds: defaultProfileIds, isAllDay: false, drivingProfileIds: [], recurrenceType: "none", recurrenceEndDate: null });
    setShowGlobalAddEvent(true);
  };

  // ── Navigation history ──────────────────────────────────────────────────
  type NavSnapshot = { tab: TabType; choresSubTab: ChoresSubTabType };
  const [navHistory, setNavHistory] = useState<NavSnapshot[]>([]);

  const navigateTo = (tab: TabType, subTab: ChoresSubTabType = "chores") => {
    setNavHistory(h => {
      // Don't push if we're already here
      if (tab === activeTab && subTab === choresSubTab) return h;
      return [...h, { tab: activeTab, choresSubTab }];
    });
    setActiveTab(tab);
    setChoresSubTab(subTab);
  };

  const goBack = () => {
    setNavHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setActiveTab(prev.tab);
      setChoresSubTab(prev.choresSubTab);
      return h.slice(0, -1);
    });
  };
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | null>(null);
  const [settingsInitialCalendarProfileId, setSettingsInitialCalendarProfileId] = useState<string | null>(null);
  const [settingsInitialHighlightTabId, setSettingsInitialHighlightTabId] = useState<string | null>(null);
  // When there's no ONE specific profile to point at (e.g. "no calendar
  // connected at all yet" on Home, where any of several people could be the
  // one to connect) — spotlights the whole Calendar Connections list instead
  // of auto-expanding a single row.
  const [settingsSpotlightAllCalendarProfiles, setSettingsSpotlightAllCalendarProfiles] = useState(false);
  // Every "open Settings" entry point routes through this so opening it is
  // PIN-gated in one place, not at each trigger.
  const openSettings = (initialSection?: string, initialCalendarProfileId?: string, initialHighlightTabId?: string, spotlightAllCalendarProfiles?: boolean) =>
    guardParentAction("settings", () => {
      if (initialSection) setSettingsInitialSection(initialSection);
      setSettingsInitialCalendarProfileId(initialCalendarProfileId ?? null);
      setSettingsInitialHighlightTabId(initialHighlightTabId ?? null);
      setSettingsSpotlightAllCalendarProfiles(!!spotlightAllCalendarProfiles);
      setShowSettings(true);
    });

  // Opens the Tasks tab's "Customize" dialog with a specific card row
  // scrolled-to and briefly highlighted — used by the feature-nudge sheet's
  // "Turn it on" button for Star Insights so it lands on the exact row.
  const openTasksCardSettings = (highlightCardId?: string) => {
    setTasksCardHighlightId(highlightCardId ?? null);
    setShowTasksCardSettings(true);
  };

  // Support/Privacy/Terms are plain standalone pages outside this app's own
  // routing (App.tsx renders them before AuthenticatedRouter ever mounts), so
  // their "back to the app" links can only get back here via a real page
  // navigation to "/" — this reopens Settings once the app has actually
  // loaded, rather than dropping the user on whatever tab happens to be
  // default, since that's where all three of those pages are reached from.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("openSettings") !== "1") return;
    params.delete("openSettings");
    const next = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (next ? `?${next}` : "") + window.location.hash);
    openSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tapping a push notification whose content is squarely about one tab
  // (bedtime reminder, chore-assigned, reward-redeemed, cashout-requested,
  // cashout-declined) opens straight to it instead of wherever the app
  // happens to launch on. Web delivers this via `?openTab=chores` (+
  // optional `&openSubTab=`/`&openAction=`) on the notification's URL (same
  // pattern as ?openSettings above); native has no URL at all, so
  // nativeNotifications.ts fires the same custom event pushDeepLink.ts's
  // celebration deep link already uses.
  const VALID_DEEP_LINK_TABS: TabType[] = ["home", "calendar", "chores", "todos", "meals", "behaviour", "chat"];
  const VALID_DEEP_LINK_SUBTABS: ChoresSubTabType[] = ["chores", "rewards", "trophies", "bonus"];
  const handleTabDeepLink = (link: { tab: string; subTab?: string; action?: string; profileId?: string; plan?: string }) => {
    if (link.plan) {
      stageEveningPlan(link.plan);
      setChatRevision((n) => n + 1);
    }
    if (!(VALID_DEEP_LINK_TABS as string[]).includes(link.tab)) return;
    const subTab = link.subTab && (VALID_DEEP_LINK_SUBTABS as string[]).includes(link.subTab)
      ? (link.subTab as ChoresSubTabType)
      : undefined;
    navigateTo(link.tab as TabType, subTab);
    if (link.action === "parentControls") {
      // Same PIN-unlock (then, on success, its own spotlight) as the
      // Announcements "Go to Cash-Out Approvals" deep link.
      setRewardsParentUnlockTrigger(n => n + 1);
    } else if (link.action === "cashoutStars") {
      setCashOutStarsSpotlightTrigger(n => n + 1);
    } else if (link.action === "healthReminders") {
      // ⚠️ Make sure there is something to spotlight. Home's reminder card
      // only renders reminders for the CURRENTLY SELECTED profiles, so a push
      // about one person while someone else was selected opened an app with
      // no card in the DOM at all — nothing to scroll to, nothing to dim, and
      // indistinguishable from the spotlight being broken. Three rounds of
      // hardening the spotlight itself could never have fixed it
      // (2026-09-14).
      if (link.profileId) {
        setSelectedProfiles([link.profileId]);
      } else {
        // Pushes sent before the profile was included in the link: fall back
        // to the unfiltered view, which shows every outstanding reminder.
        setSelectedProfiles([]);
      }
      setHealthReminderSpotlightTrigger(n => n + 1);
    } else if (link.action === "praiseSection") {
      setPraiseSpotlightTrigger(n => n + 1);
    } else if (link.action === "notesSection") {
      setNotesSpotlightTrigger(n => n + 1);
    }
  };
  useEffect(() => {
    const link = consumeTabDeepLinkFromUrl();
    if (link) handleTabDeepLink(link);
    return onTabDeepLink(handleTabDeepLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Celebration-reminder push notifications — the target celebration id is
  // owned HERE (the top-level page), not inside HomeView, and specifically
  // routes to the Home tab before setting it. This used to live entirely
  // inside HomeView: its own state + its own `onCelebrationDeepLink`
  // subscription, both of which only exist while HomeView is actually
  // mounted. Tapping the notification while the app was foregrounded on any
  // OTHER tab (or backgrounded and last left on another tab) meant nothing
  // was listening for the event at all — it fired into the void and the
  // celebration silently never opened, with no error to notice. Lifting
  // this to family-hub.tsx (always mounted regardless of active tab, same
  // reasoning as handleTabDeepLink just above) and explicitly navigating to
  // Home closes that gap — this is now correct no matter which tab the app
  // happened to be showing when the notification was tapped.
  const [pendingCelebrationId, setPendingCelebrationId] = useState<string | null>(null);
  const handleCelebrationDeepLink = (celebrationId: string) => {
    navigateTo("home");
    setPendingCelebrationId(celebrationId);
  };
  useEffect(() => {
    const id = consumeCelebrationDeepLinkFromUrl();
    if (id) handleCelebrationDeepLink(id);
    return onCelebrationDeepLink(handleCelebrationDeepLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Replaying the onboarding walkthrough after first-run — either from
  // Settings ("Replay setup walkthrough") or a "Finish now" reminder link in
  // Announcements. null = not showing; otherwise which step to open on.
  const [replayOnboardingStep, setReplayOnboardingStep] = useState<SkippableStep | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Re-send this device's current APNs token once per app run. Lives here
  // rather than in main.tsx because the token POST needs an authenticated
  // session, and this page only renders once signed in. No-op on web, and it
  // never prompts — it bails unless push permission was already granted.
  useEffect(() => { void refreshNativePushRegistration(); }, []);

  // Date-nav row: Back and Today sit outside the absolutely-centered date/
  // chevron cluster, each positioned at the midpoint of its own side of the
  // row (between the screen edge and the date cluster) rather than flush
  // against the edge. Measured via refs instead of a CSS grid — an earlier
  // 3-column-grid attempt at this exact row broke on real phones because a
  // CSS `fr` track's implicit minimum is its own content's min-content, so
  // once one side's content needed more than its "fair half," the grid grew
  // that track and un-centered the whole row (see the long comment further
  // down at the row's own JSX). Measuring the real rendered width of the
  // middle cluster and computing each side's true midpoint has no such
  // content-driven minimum — it's correct regardless of how wide Back/Today
  // happen to render at any given breakpoint.
  const dateNavRowRef = useRef<HTMLDivElement>(null);
  const dateNavMiddleRef = useRef<HTMLDivElement>(null);
  const [dateNavSideCenters, setDateNavSideCenters] = useState<{ left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    let rafId: number | null = null;
    let attempts = 0;
    let observing = false;
    const recompute = () => {
      const row = dateNavRowRef.current;
      const middle = dateNavMiddleRef.current;
      if (!row || !middle) {
        // The whole app renders a loading screen (isLoading, further down
        // in this component) until /api/profiles resolves — this effect's
        // very first run can land while that loading screen is still up,
        // meaning the real date-nav row doesn't exist in the DOM yet and
        // both refs are null. isLoading isn't a dependency of this effect
        // (it's declared later in the component; pulling it in would need
        // reordering), so without a retry, dateNavSideCenters silently
        // stayed null forever once that happened — until some UNRELATED
        // dependency happened to change (e.g. switching tabs), which is
        // the exact "Today button is right-aligned on first load, fixes
        // itself the moment you touch a tab" bug this retry fixes.
        // Bounded to ~0.5s of frames so a genuinely-unmounted row (e.g. a
        // permanently-errored auth state) doesn't retry forever.
        if (attempts++ < 30) rafId = requestAnimationFrame(recompute);
        return;
      }
      if (!observing) {
        ro.observe(row);
        ro.observe(middle);
        observing = true;
      }
      const rowRect = row.getBoundingClientRect();
      const midRect = middle.getBoundingClientRect();
      const midLeft = midRect.left - rowRect.left;
      const midRight = midRect.right - rowRect.left;
      setDateNavSideCenters({
        left: midLeft / 2,
        right: midRight + (rowRect.width - midRight) / 2,
      });
    };
    const ro = new ResizeObserver(recompute);
    recompute();
    window.addEventListener("resize", recompute);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // Recompute whenever the tab changes — the date label's content differs
    // by tab (e.g. Meals' two-line range) and Today/This Week's label text
    // differs too, each changing the middle cluster's real width. Back's own
    // appear/disappear (navHistory.length, mealsShowGrocery) doesn't change
    // the MIDDLE cluster's size and so wouldn't otherwise trigger the
    // ResizeObserver, but Back's own position is independent of whether it's
    // currently rendered, so nothing needs recomputing for that anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, navHistory.length]);

  // How tall the sticky header currently is, measured live.
  //
  // `<main>` needs a minimum height so a short tab (Meals, To-Dos) still has
  // enough scroll range to push the non-sticky weather bar fully out of view —
  // otherwise the collapsing-header behaviour differs by tab. It used to be a
  // flat `min-h-screen`, and the comment justifying that claimed min-h-screen
  // "never binds once content exceeds a viewport, which it does on all four."
  // Measured at 390x844: it binds on To-Dos and Meals (main lands at exactly
  // 844px), and the extra height it forces is dead space below the last card,
  // because `<header>` and `<main>` share one scroll container — a full 100vh
  // main on top of a header that already consumed space above it counts that
  // header's height twice. Same double-count that was fixed for Calendar in
  // 2026-08-14 by exempting it entirely; every other tab needed the subtraction
  // instead, because they genuinely do need the scroll range.
  //
  // 100vh - headerHeight is exactly enough: scroll range then equals the
  // weather bar's own height, which is the only thing that has to scroll away.
  const [stickyHeaderH, setStickyHeaderH] = useState(0);
  // The element is tracked as state rather than looked up by id, so this
  // effect can have a real dependency array. It previously had NO dependency
  // array at all (it had to re-run to catch the header once the loading
  // screen went away), which meant every render tore down and rebuilt the
  // ResizeObserver and called setStickyHeaderH again.
  const [stickyHeaderEl, setStickyHeaderEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!stickyHeaderEl) return;
    // ROUNDED, and only committed when it actually changes. This value feeds
    // <main>'s minHeight, which changes the page's scroll height, which can
    // flip headerCondensed (scrollTop > 10), which changes the header's own
    // height — a closed feedback loop. Unrounded floats made that loop able
    // to run forever on some loads: React eventually throws "Maximum update
    // depth exceeded", which the top-level error boundary catches and renders
    // as "Something went wrong". Bailing out on an unchanged integer breaks
    // the cycle, since a settled layout stops producing new state.
    const measure = () => {
      const h = Math.round(stickyHeaderEl.getBoundingClientRect().height);
      setStickyHeaderH(prev => (prev === h ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stickyHeaderEl);
    return () => ro.disconnect();
  }, [stickyHeaderEl]);

  // Profile strip scroll-fade indicators
  const profileStripRef = useRef<HTMLDivElement>(null);
  const [stripScrollState, setStripScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  useEffect(() => {
    const el = profileStripRef.current;
    if (!el) return;
    const update = () => setStripScrollState({
      canScrollLeft: el.scrollLeft > 4,
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [profileStripRef]);

  // Condensed header: as the page scrolls down, shrink the profile circles and
  // nav so the sticky header takes less vertical space while staying functional.
  // Detect scroll from any possible container (window, document, or the div
  // itself — iOS WKWebView may use any of these as the actual scroll source).
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const [headerCondensed, setHeaderCondensed] = useState(false);
  useEffect(() => {
    const getScrollTop = () =>
      pageContainerRef.current?.scrollTop ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      window.scrollY ||
      0;
    const onScroll = () => setHeaderCondensed(getScrollTop() > 10);
    const container = pageContainerRef.current;
    // iOS fires touchmove during scroll before scroll events arrive
    const onTouch = () => requestAnimationFrame(onScroll);
    container?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("touchmove", onTouch);
    };
  }, []);

  // Card-header action triggers for embedded view components
  const [mealsShowGrocery, setMealsShowGrocery] = useState(false);
  const [wideTasksCard, setWideTasksCard] = useState(() => localStorage.getItem('familyHub_wideTasksCard') === '1');
  const [tasksFunMode, setTasksFunMode] = useState(() => localStorage.getItem('familyHub_tasksFunMode') === 'true');
  const toggleTasksFunMode = () => {
    setTasksFunMode((v) => {
      const next = !v;
      localStorage.setItem('familyHub_tasksFunMode', String(next));
      return next;
    });
  };
  const [showTasksCardSettings, setShowTasksCardSettings] = useState(false);
  const [tasksCardHighlightId, setTasksCardHighlightId] = useState<string | null>(null);
  const [tasksCardSettings, setTasksCardSettings] = useState<TasksCardConfig[]>(() => getTasksCardSettings());
  const [rewardsAddTrigger, setRewardsAddTrigger] = useState(0);
  const [rewardsManageTrigger, setRewardsManageTrigger] = useState(0);
  const [rewardsParentUnlockTrigger, setRewardsParentUnlockTrigger] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [signOutStep, setSignOutStep] = useState(0); // 0=closed 1=step1 2=step2
  const [selectedDate, setSelectedDate] = useState(new Date());
  // Meals navigates by week, not by day — its own week-anchor state, driven
  // by the same persistent nav row as every other tab (Calendar excepted,
  // which has its own view-aware day/week/month step via calendarRef).
  const [mealsWeekAnchor, setMealsWeekAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  // Swiping in from the screen edge flips the date (or, on Meals, the week)
  // by one step — every tab except Calendar, which has its own date state.
  useEdgeSwipeDateNav(
    () => activeTab === "meals" ? setMealsWeekAnchor(d => subWeeks(d, 1)) : setSelectedDate(d => subDays(d, 1)),
    () => activeTab === "meals" ? setMealsWeekAnchor(d => addWeeks(d, 1)) : setSelectedDate(d => addDays(d, 1)),
    { enabled: activeTab !== "calendar" },
  );
  const dateResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const arm = () => {
      if (dateResetTimerRef.current) clearTimeout(dateResetTimerRef.current);
      if (!isToday(selectedDate)) {
        dateResetTimerRef.current = setTimeout(() => {
          setSelectedDate(new Date());
        }, DATE_RESET_MS);
      }
    };
    arm();
    // Re-arm on genuine activity too, not just on explicit date navigation —
    // otherwise actively working through a backdated day's chores (which
    // never itself touches selectedDate) could get silently reset back to
    // today mid-task, after which any further completion in that same
    // sitting gets stamped against the WRONG day with no visible warning.
    // Real bug this caused: several of a profile's chores from "yesterday"
    // were recorded with today's date once the 10-minute window lapsed
    // mid-session, showing as completed hours in the FUTURE relative to
    // when they were actually checked off.
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    events.forEach(e => window.addEventListener(e, arm, { passive: true }));
    return () => {
      if (dateResetTimerRef.current) clearTimeout(dateResetTimerRef.current);
      events.forEach(e => window.removeEventListener(e, arm));
    };
  }, [selectedDate]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<ActivityLogEntryType[] | undefined>(undefined);
  // Set when a specific Recent Activity row is tapped, so Family Activity
  // opens scrolled/highlighted to that exact entry instead of the top of the
  // list. Every entry point that opens History explicitly sets (or clears)
  // this, so a stale value from a previous open can never leak into the next.
  const [focusHistoryEntryId, setFocusHistoryEntryId] = useState<string | null>(null);
  const openHistory = () => { setHistoryTypeFilter(undefined); setFocusHistoryEntryId(null); setShowHistory(true); };
  const openHistoryEntry = (entryId: string) => { setHistoryTypeFilter(undefined); setFocusHistoryEntryId(entryId); setShowHistory(true); };

  // (The old per-type "quick add" dialog + its Settings toggles were retired
  // when the unified CreateTaskModal replaced every scattered add path.)

  // ── Global + button state ───────────────────────────────────────────────
  const { toast } = useToast();
  const [noteTrigger, setNoteTrigger] = useState(0);
  const [shoutoutTrigger, setShoutoutTrigger] = useState(0);
  const [healthReminderPickerOpen, setHealthReminderPickerOpen] = useState(false);
  const [healthReminderProfileId, setHealthReminderProfileId] = useState<string | null>(null);
  const [showSnapFlyer, setShowSnapFlyer] = useState(false);
  const [showAddRemoveStars, setShowAddRemoveStars] = useState(false);

  const calendarRef = useRef<Calendar3ViewHandle>(null);
  const [hiddenTabs, setHiddenTabsState] = useState<Set<string>>(() => {
    // try/catch like every other localStorage JSON read in the app — this one
    // runs during the top-level page render, so an unguarded parse of a
    // corrupt value would white-screen the whole app.
    try {
      const saved = localStorage.getItem('familyHub_hiddenTabs');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const setHiddenTabs = (tabs: string[]) => {
    setHiddenTabsState(new Set(tabs));
    localStorage.setItem('familyHub_hiddenTabs', JSON.stringify(tabs));
    if (tabs.includes(activeTab)) {
      setActiveTab("home");
    }
  };

  // Icons-only nav — a per-device display preference (not synced/shared,
  // same as hiddenTabs/tabOrder), for when enough tabs are turned on that the
  // labeled pill row no longer fits on one line without scrolling.
  const [navIconsOnly, setNavIconsOnlyState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('familyHub_navIconsOnly') === 'true';
    } catch {
      return false;
    }
  });
  const setNavIconsOnly = (value: boolean) => {
    setNavIconsOnlyState(value);
    localStorage.setItem('familyHub_navIconsOnly', String(value));
  };

  // The bottom bar is a fixed set. Older hidden-tab and reorder
  // preferences do not drop Chat or bring To-Dos back.
  const visibleNavTabs = BOTTOM_NAV_IDS.map((id) => ALL_NAV_TAB_CONFIGS.find((tab) => tab.id === id)!);

  const { data: profiles = [], isLoading } = useQuery<Profile[]>({
    queryKey: ["/api/profiles"],
  });
  const chatProfileKey = [...selectedProfiles].sort().join(",") || "family";
  const chatIsChild = profiles.filter((p) => selectedProfiles.includes(p.id) && !p.isAllFamilyProfile).every((p) => p.role === "child" || p.isChild) &&
    profiles.some((p) => selectedProfiles.includes(p.id) && !p.isAllFamilyProfile);
  const sendChatFromMenu = () => {
    const next = appendUserMessage(chatProfileKey, chatDraft);
    if (!next) return;
    setChatDraft("");
    setPlusOpen(false);
    setChatRevision((n) => n + 1);
    navigateTo("chat");
  };
  const { guard: guardParentAction, gateDialog: parentGateDialog } = useParentGate(profiles, selectedProfiles);

  // Hands the family's medication reminders to iOS to fire on its own. The
  // server's scheduler cannot be relied on for these — see the file's header.
  useLocalHealthReminders(profiles);

  // Drives which options the Rewards card's header offers — e.g. a
  // cashout_only family shouldn't see "Add a reward"/"Manage rewards" at
  // all, since there's no reward catalog to add to. Same query RewardsView
  // itself fetches, so this is a cache hit, not an extra request.
  const { data: rewardSettingsCfg } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const showRewardCatalog = (rewardSettingsCfg?.redemptionMode ?? "both") !== "cashout_only";

  const { data: unseenShoutouts } = useQuery<{ count: number }>({
    queryKey: ["/api/shoutouts/unseen-count"],
    refetchInterval: 60_000,
  });
  const unseenShoutoutCount = unseenShoutouts?.count ?? 0;

  const { data: customGroups = [] } = useQuery<CustomProfileGroup[]>({
    queryKey: ["/api/custom-profile-groups"],
  });
  // Re-check strip scrollability when groups load
  useEffect(() => {
    const el = profileStripRef.current;
    if (!el) return;
    setStripScrollState({
      canScrollLeft: el.scrollLeft > 4,
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, [customGroups, profiles]);

  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  // Single selected profile + their point total — used by persistent star displays
  const singleProfile = useMemo(() => {
    if (selectedProfiles.length !== 1) return null;
    return profiles.find(p => p.id === selectedProfiles[0] && !p.isAllFamilyProfile) ?? null;
  }, [selectedProfiles, profiles]);

  const clientSingleProfilePoints = useMemo(() => {
    if (!singleProfile) return 0;
    return choreCompletions
      .filter(c => c.profileId === singleProfile.id)
      .reduce((sum, c) => sum + (c.points || 0), 0);
  }, [singleProfile, choreCompletions]);
  // The header star pill shows the server's authoritative balance (it
  // subtracts redeemed rewards and includes bonuses/adjustments); the
  // client-side completion sum only bridges the first paint.
  const { data: singleProfileBackendPoints } = useQuery<{ points: number }>({
    queryKey: ["/api/points", singleProfile?.id],
    enabled: !!singleProfile,
    staleTime: 15_000,
  });
  const singleProfilePoints = singleProfileBackendPoints?.points ?? clientSingleProfilePoints;

  // Tapping the star pill fires the same multi-burst confetti finale used
  // when a profile finishes all their chores (home-view.tsx's fireConfetti)
  // — the flashiest animation already in the app — anchored near the top of
  // the screen since that's where this pill sits, plus a playful bounce.
  const [starPillPop, setStarPillPop] = useState(false);
  const fireStarPillCelebration = () => {
    hapticSuccess();
    setStarPillPop(true);
    setTimeout(() => setStarPillPop(false), 400);
    confetti({ particleCount: 100, spread: 75, origin: { x: 0.5, y: 0.12 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 40, gravity: 0.9, ticks: 200 });
    setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0.15, y: 0.15 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], startVelocity: 45, ticks: 180 }), 150);
    setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 0.85, y: 0.15 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'], startVelocity: 45, ticks: 180 }), 300);
  };

  // Initialize selected profiles when profiles load (only once)
  useEffect(() => {
    if (profiles.length > 0 && !hasInitialized) {
      const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);
      setSelectedProfiles(regularProfiles.map(p => p.id));
      setHasInitialized(true);
    }
  }, [profiles, hasInitialized]);

  const handleProfileToggle = (profileId: string) => {
    // Select only this profile, deselect all others
    setSelectedProfiles([profileId]);
  };

  const handleAllFamilyToggle = () => {
    // There's no reason for the header to ever have nobody selected — every
    // card on Home/Tasks/Trophies treats an empty selection as an error or
    // edge case, not a real state. Tapping "All Family" again while it's
    // already fully selected simply keeps everyone selected instead of
    // toggling off into that empty state.
    const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);
    setSelectedProfiles(regularProfiles.map(p => p.id));
  };

  const handleCustomGroupClick = (group: CustomProfileGroup) => {
    // Select only the profiles in this custom group
    setSelectedProfiles(group.profileIds);
  };

  // Inactivity timer — return to default tab after 30 minutes of no interaction
  const defaultTabRef = useRef<TabType>(defaultTab);
  useEffect(() => { defaultTabRef.current = defaultTab; }, [defaultTab]);
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timerId);
      timerId = setTimeout(() => {
        setActiveTab(defaultTabRef.current);
        setChoresSubTab("chores");
        setNavHistory([]);
      }, INACTIVITY_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timerId);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "chat") {
      localStorage.setItem("superhub_chat_unread", "0");
      setChatUnread(0);
      return;
    }
    const raw = Number(localStorage.getItem("superhub_chat_unread") || "0");
    setChatUnread(Number.isFinite(raw) && raw > 0 ? raw : 0);
  }, [activeTab]);

  // Redirect legacy "celebrations" tab (now surfaced inside the Calendar tab).
  useEffect(() => {
    if ((activeTab as string) === "celebrations") setActiveTab("calendar");
  }, [activeTab]);

  // Reset all Tasks-tab drawer triggers when leaving the tab so components
  // don't re-open drawers on remount when the user returns.
  useEffect(() => {
    if (activeTab !== "chores") {
      setRewardsAddTrigger(0);
      setRewardsManageTrigger(0);
      setRewardsParentUnlockTrigger(0);
    }
    if (activeTab !== "meals") {
      setMealsShowGrocery(false);
    }
  }, [activeTab]);

  // Chores, Rewards, Trophies and Bonus now live on one page. Deep-links from
  // the Home cards (Rewards / Trophies / Wallet) set choresSubTab; scroll the
  // matching section into view once the combined page is rendered.
  useEffect(() => {
    if (activeTab !== "chores" || choresSubTab === "chores") return;
    // 112px matches the section's `scroll-mt-28` (7rem) sticky-header offset —
    // plain scrollIntoView() doesn't reliably pick the right scroll container
    // on iOS WKWebView, so this scrolls every possible one to the same spot.
    // Measured header height, not a guess: the sticky header stacks the
    // profile row, star pill, date nav and tab pills, which is well over the
    // 112px this used to assume — so the target landed underneath it.
    const t = setTimeout(() => robustScrollIntoView(`chores-section-${choresSubTab}`, stickyHeaderOffset()), 60);
    return () => clearTimeout(t);
  }, [activeTab, choresSubTab]);

  // Home's Cash Out button lands on the Rewards section, which can also
  // hold the reward catalog / Trophies / Bonus Chores / Cash-Out Approvals
  // — spotlight the specific "Cash Out Stars" card so it's unmistakable
  // which one is relevant, especially on tablet/desktop where several are
  // already visible at once. Fires after the scroll effect above has had
  // time to land.
  useEffect(() => {
    if (cashOutStarsSpotlightTrigger === 0) return;
    const t = setTimeout(() => spotlight("cash-out-stars-card"), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashOutStarsSpotlightTrigger]);

  useEffect(() => {
    if (rewardSuggestionsSpotlightTrigger === 0) return;
    const t = setTimeout(() => spotlight("pending-requests-section"), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardSuggestionsSpotlightTrigger]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading Family Hub+…</p>
        </div>
      </div>
    );
  }

  // Onboarding for new users with no profiles yet (a brand-new family), OR
  // someone whose account has never completed onboarding even though
  // profiles already exist — that's what happens when you join an existing
  // family via an invite: you inherit that family's profiles immediately,
  // so the "zero profiles" check alone would never catch you.
  const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);
  if (startedWithNoProfilesRef.current === null && !user?.onboardingCompletedAt) {
    startedWithNoProfilesRef.current = regularProfiles.length === 0;
  }
  if (!user?.onboardingCompletedAt) {
    // Real bug fixed 2026-08-27: this early return replaces the ENTIRE main
    // render below (including the shared sign-out confirmation Dialog further
    // down this component) — so pressing "Sign Out" during onboarding used to
    // just set signOutStep and wait, with nothing mounted to ever show that
    // state. The dialog only appeared once onboarding finished and the main
    // render (with its own copy of this same Dialog) took over — reading as
    // "sign out doesn't work until you finish the walkthrough." Rendering an
    // identical confirmation dialog here, driven by the same signOutStep
    // state, fixes it without touching the main render's copy at all.
    const onboardingSignOutDialog = (
      <Dialog open={signOutStep > 0} onOpenChange={(open) => { if (!open) setSignOutStep(0); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-muted-foreground" />
              {signOutStep === 1 ? "Sign out?" : "Are you sure?"}
            </DialogTitle>
            <DialogDescription>
              {signOutStep === 1
                ? "You'll need to log back in to access Family Hub+. Click Continue to proceed."
                : "This is your final confirmation. Click Sign out to end your session."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSignOutStep(0)}>Cancel</Button>
            {signOutStep === 1
              ? <Button onClick={() => setSignOutStep(2)}>Continue →</Button>
              : <Button variant="destructive" onClick={() => logout()} data-testid="button-logout-confirm">Sign out</Button>
            }
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    // ConfirmDialogHost is mounted here too, not just in the main render
    // below — onboarding's "no photo yet?" confirmation (YouStep) uses the
    // shared confirmDialog() helper, which needs a mounted host to show its
    // styled dialog instead of falling back to a native window.confirm.
    if (startedWithNoProfilesRef.current) {
      return <>
        <OnboardingWizard onSignOut={() => setSignOutStep(1)} />
        {onboardingSignOutDialog}
        <ConfirmDialogHost />
      </>;
    }
    return <>
      <OnboardingWizard onSignOut={() => setSignOutStep(1)} forJoiner />
      {onboardingSignOutDialog}
      <ConfirmDialogHost />
    </>;
  }

  return (
    // opaque-vars: .hearth-theme alone redefines the theme vars as bare
    // "H S% L%" triples — silently invalid (transparent) for every raw
    // bg-/text-/border-/ring- Tailwind utility in this whole subtree. That
    // was the root cause of the invisible dark-mode "+" button and the
    // transparent onboarding overlay, previously spot-fixed per component;
    // applying the fix class at the root corrects every descendant at once.
    <div ref={pageContainerRef} id="app-scroll-container" className="hearth-theme opaque-vars bg-background text-foreground overflow-x-hidden overflow-y-auto h-screen">
      {spotlightOverlay}
      {/* Opaque cover over the notch / Dynamic Island strip. position:fixed to
          the viewport so it hides ANYTHING scrolling into the top safe-area
          band (e.g. the weather bar sliding up), in every scroll state — the
          reason the top menu appeared to slide "up past the island."
          z-[45]: above scrolling content (≤ z-40) but below the sticky header
          (z-50) and modal overlays (z-50+), so it never paints a strip over an
          open Dialog/Sheet (those carry their own safe-area padding). Height 0
          on non-notch devices, so it's a harmless no-op there. */}
      <div
        className="fixed top-0 left-0 right-0 z-[45] bg-background pointer-events-none"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
        aria-hidden
      />

      {/* Weather/time bar — topmost element at rest; its wrapper's
          safe-area-inset-top padding drops it just below the notch cover so
          its content isn't clipped behind the island. */}
      <div style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <WeatherWidget />
      </div>

      {/* Profile-circles header — sticky. Uses `top: env(safe-area-inset-top)`
          (NOT paddingTop): a sticky `top` offset only shifts where the header
          STICKS once scrolled (to just below the notch), and adds ZERO extra
          vertical space at rest — so there's no longer a gap above the profile
          circles before you scroll (the earlier paddingTop approach reserved
          that space permanently, which is what showed up as extra spacing). */}
      <header
        id="app-sticky-header"
        ref={setStickyHeaderEl}
        className="sticky z-50 bg-background/80 sticky-nav border-b border-black/[0.06]"
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="container mx-auto px-3 sm:px-6 py-1 sm:py-1.5">

          {/* ── Profile circles + groups + icons — all in one scrollable strip ── */}
          <div className="relative mb-0.5">
            {/* Left fade when scrolled right */}
            {stripScrollState.canScrollLeft && (
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-background/90 to-transparent" />
            )}
            {/* Right fade when more content exists */}
            {stripScrollState.canScrollRight && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-background/90 to-transparent" />
            )}
          <div
            ref={profileStripRef}
            // py-1/-my-1: overflow-x on its own computes overflow-y to `auto`
            // too (the spec won't leave one axis visible while the other
            // isn't), so this strip clips vertically — which sheared the top
            // off a profile circle as it grew under hover:scale-105. Clipping
            // happens at the PADDING box, so the padding gives the grown
            // circle room to render, and the matching negative margin keeps
            // the header exactly as tall as it was.
            className="flex overflow-x-auto py-1 -my-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex items-center gap-3 sm:gap-5 px-1 mx-auto">
              {/* All Family Profile */}
              {(() => {
                const allFamilyProfile = profiles.find(p => p.isAllFamilyProfile);
                const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);
                const isAllSelected = regularProfiles.length > 0 &&
                  selectedProfiles.length === regularProfiles.length &&
                  regularProfiles.every(p => selectedProfiles.includes(p.id));
                return allFamilyProfile ? (
                  <ProfileCircle
                    key={allFamilyProfile.id}
                    id={allFamilyProfile.id}
                    name={allFamilyProfile.name}
                    initials={allFamilyProfile.initials}
                    color={allFamilyProfile.color}
                    photoUrl={allFamilyProfile.photoUrl}
                    isSelected={isAllSelected}
                    onToggle={handleAllFamilyToggle}
                    condensed={headerCondensed}
                  />
                ) : null;
              })()}

              {/* Individual Profiles */}
              {profiles.filter(p => !p.isAllFamilyProfile).map((profile) => (
                <ProfileCircle
                  key={profile.id}
                  id={profile.id}
                  name={profile.name}
                  initials={profile.initials}
                  color={profile.color}
                  photoUrl={profile.photoUrl}
                  isSelected={selectedProfiles.includes(profile.id)}
                  onToggle={handleProfileToggle}
                  condensed={headerCondensed}
                />
              ))}

              {/* Custom Groups — inline in the strip, stacked up to 4 per column to match profile height.
                  Remainder gets its own column; justify-center vertically centers it. */}
              {customGroups.length > 0 && (
                <>
                  <div className="w-px h-8 bg-border/60 flex-shrink-0 self-center" />
                  {(() => {
                    const cols: typeof customGroups[] = [];
                    for (let i = 0; i < customGroups.length; i += 4) {
                      cols.push(customGroups.slice(i, i + 4));
                    }
                    return cols.map((col, colIdx) => (
                      <div key={colIdx} className="flex flex-col justify-center gap-0.5 flex-shrink-0">
                        {col.map((group) => {
                          const gpIds = group.profileIds || [];
                          const isGroupSelected =
                            gpIds.length > 0 &&
                            gpIds.every(id => selectedProfiles.includes(id)) &&
                            selectedProfiles.length === gpIds.length;
                          return (
                            <button
                              key={group.id}
                              onClick={() => handleCustomGroupClick(group)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all flex-shrink-0 ${
                                isGroupSelected ? 'opacity-100' : 'opacity-40 hover:opacity-75'
                              }`}
                              title={group.name}
                              data-testid={`custom-group-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shadow-sm flex-shrink-0"
                                style={{ backgroundColor: group.color || '#6366f1' }}
                              >
                                {group.icon || '👥'}
                              </div>
                              <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap max-w-[56px] truncate leading-tight">
                                {group.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </>
              )}

              {/* Settings + privacy + sign-out */}
              <div className="flex flex-col justify-center gap-0.5 pl-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettings()}
                  className="p-1 h-[22px] w-[22px] hover:bg-accent rounded-full transition-colors"
                  aria-label="Settings"
                  data-testid="settings-button"
                >
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPrivacy(true)}
                  className="p-1 h-[22px] w-[22px] hover:bg-accent rounded-full transition-colors"
                  title="Privacy screen"
                  aria-label="Privacy screen"
                  data-testid="privacy-button"
                >
                  <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSignOutStep(1)}
                  className="p-1 h-[22px] w-[22px] hover:bg-accent rounded-full transition-colors"
                  aria-label="Sign out"
                  data-testid="button-logout"
                >
                  <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
          </div>

          {/* ── Option A: Persistent star pill ── */}
          {/* Constant key so switching between two single profiles only updates
              the content — no exit/enter remount. Animate GPU-composited
              opacity/scale only (no height) to keep it smooth on iPad Safari. */}
          <AnimatePresence>
            {singleProfile && (
              <motion.div
                key="star-pill"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex justify-center mb-1 overflow-hidden transform-gpu [will-change:transform,opacity]"
              >
                <motion.button
                  onClick={() => { fireStarPillCelebration(); navigateTo("chores"); }}
                  animate={starPillPop ? { scale: [1, 1.35, 0.95, 1.1, 1], rotate: [0, -6, 6, -3, 0] } : {}}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="flex items-center gap-2 px-4 py-1 rounded-full text-white text-sm font-bold shadow-md hover:brightness-110 active:scale-95 transition-all"
                  style={{ backgroundColor: singleProfile.color }}
                  data-testid="star-pill"
                >
                  {singleProfile.photoUrl ? (
                    <img src={objectUrl(singleProfile.photoUrl)} alt={singleProfile.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="text-xs font-bold">{singleProfile.initials}</span>
                  )}
                  {/* One star, not two: the pill had a Star icon before the
                      number and a ⭐ emoji after it, which read as two
                      different values rather than one. Behaviour, colours and
                      the tap-to-celebrate are untouched. */}
                  <Star className="w-4 h-4 fill-white shrink-0" />
                  <span className="text-base font-black">{singleProfilePoints}</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Date Navigation — the single, persistent date control across
              every tab that has one. Calendar used to hide this and keep
              its own separate, disconnected date state (these arrows had
              no effect there at all); it's now driven by the exact same
              selectedDate, with prev/next routed through Calendar's own
              view-aware step (day/week/month) via calendarRef so stepping
              through a Month or Week view doesn't mean tapping through one
              day at a time. Meals now uses this same row too, but steps by
              a whole week (its own mealsWeekAnchor state) instead of a day. */}
          {/* `relative` row with the date-nav group TRULY absolutely
              centered (left-1/2 + -translate-x-1/2), not just "in an equal
              CSS Grid column." The equal-1fr-columns approach used before
              this looked right in wide-viewport testing but breaks on an
              actual phone: an `fr` track's implicit minimum is its own
              content's min-content, so once Back+Customize (left column)
              needed more room than its "fair share" of a narrow phone's
              leftover space, the grid gave that column extra width and
              shrank the empty right spacer to compensate — silently
              un-centering the date by however much the left content grew,
              exactly matching "moves depending on the tab / whether Back
              and Customize show." Absolute positioning has no such
              content-driven minimum: the centered group's position is
              locked to the row's own literal midpoint, full stop, regardless
              of what (if anything) sits in the left-aligned Back/Customize
              cluster. Back/Customize now render in normal flow to the left
              (not a matched flanking column) — they simply sit under
              whatever's already centered on top; the group below has been
              trimmed (label/gaps) so it stays clear of both buttons even
              when they show together on a typical phone width. */}
          <div ref={dateNavRowRef} className="relative flex items-center mb-1 h-9">
            {/* Back — no longer paired with a "Customize" gear here (that's
                now a "Customize Page" card at the bottom of the Home/Chores
                card stack instead, matching the requested pattern). Back is
                positioned at the midpoint between the row's left edge and
                the date cluster's left edge (see dateNavSideCenters above),
                not flush-left in normal flow — falls back to a sensible
                static position before the first measurement resolves.
                Styled more prominently than before (solid border, bolder
                icon/text, stronger contrast) so it doesn't read as just
                another muted icon button next to the date chevrons. */}
            {(navHistory.length > 0 || (activeTab === "meals" && mealsShowGrocery)) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (activeTab === "meals" && mealsShowGrocery) {
                    setMealsShowGrocery(false);
                  } else {
                    goBack();
                  }
                }}
                aria-label="Back"
                style={{ position: "absolute", left: dateNavSideCenters ? dateNavSideCenters.left : 16, transform: "translateX(-50%)" }}
                className="shrink-0 flex items-center gap-1 px-2 sm:px-2.5 py-1.5 h-auto rounded-full text-xs font-bold text-foreground bg-background border-2 border-foreground/25 shadow-sm hover:border-primary hover:text-primary"
                data-testid="back-nav-button"
              >
                <ArrowLeft style={{ width: 17, height: 17 }} strokeWidth={2.5} aria-hidden="true" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            )}

            <div ref={dateNavMiddleRef} className="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5 sm:gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (activeTab === "calendar" && calendarRef.current) calendarRef.current.goPrev();
                  else if (activeTab === "meals") setMealsWeekAnchor(subWeeks(mealsWeekAnchor, 1));
                  else setSelectedDate(subDays(selectedDate, 1));
                }}
                className="p-1 sm:p-2 hover:bg-accent rounded-full"
                aria-label={activeTab === "meals" ? "Previous week" : activeTab === "calendar" ? "Previous" : "Previous day"}
                data-testid="prev-date-button"
              >
                <ChevronLeft style={{ width: 15, height: 15 }} aria-hidden="true" />
              </Button>
              {/* Fixed width (not min/max-width — a genuinely fixed box), so
                  this element's size never varies with content: neither by
                  tab (Meals' two-date label vs. every other tab's single
                  date) nor by which day is selected (the subtitle line can
                  be as short as "Today" or as long as "Wednesday (+12
                  weeks)"). A variable-width label here would shift the WHOLE
                  centered group off-center relative to its own transform
                  origin, even under absolute centering, since it changes the
                  group's total width asymmetrically. Content that doesn't
                  fit truncates with an ellipsis instead of resizing the box. */}
              {/* w-24, not w-20: "Aug 28, 2026" measures ~81px against an
                  80px box, so the year truncated to "20…" with about one
                  pixel of headroom — fine with one font stack and not with
                  another, and guaranteed to clip for anyone using a larger
                  iOS text size. 96px gives it real room without widening
                  the centred cluster enough to crowd Back/Today. */}
              <div className="text-center shrink-0 w-24 sm:w-44">
                {activeTab === "meals" ? (
                  // Two lines, one date each ("Aug 16 –" / "Aug 22, 2026")
                  // instead of one long "Aug 16 – Aug 22, 2026" line — this
                  // keeps each line's width close to a normal single-date
                  // label (e.g. "Aug 16, 2026" on every other tab), so this
                  // fixed-width box doesn't need to be any wider on Meals
                  // than it is everywhere else.
                  <div data-testid="meals-week-label">
                    <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                      {format(mealsWeekAnchor, 'MMM d')} –
                    </p>
                    <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                      {format(addDays(mealsWeekAnchor, 6), 'MMM d, yyyy')}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                      <span className="sm:hidden">{format(selectedDate, 'MMM d, yyyy')}</span>
                      <span className="hidden sm:inline">{format(selectedDate, 'MMMM d, yyyy')}</span>
                    </p>
                    {/* Two forms, same as the date line above it: the full
                        sentence needs ~130px and this box is a fixed 96px on
                        a phone, so "Thursday (next week)" clipped to
                        "Thursday (next we…". The short form fits with room
                        to spare; sm:+ has the width for the long one. */}
                    <p className="text-[10px] sm:text-xs text-muted-foreground truncate" data-testid="date-nav-subtitle">
                      {(() => {
                        if (isToday(selectedDate)) return 'Today';
                        const weeksDiff = differenceInWeeks(selectedDate, new Date());
                        const shortDay = format(selectedDate, 'EEE');
                        const longDay = format(selectedDate, 'EEEE');
                        const rel =
                          weeksDiff === 1 ? ['next wk', 'next week'] :
                          weeksDiff === -1 ? ['last wk', 'last week'] :
                          weeksDiff > 1 ? [`+${weeksDiff} wks`, `+${weeksDiff} weeks`] :
                          weeksDiff < -1 ? [`${weeksDiff} wks`, `${weeksDiff} weeks`] :
                          null;
                        return (
                          <>
                            <span className="sm:hidden">{rel ? `${shortDay} · ${rel[0]}` : shortDay}</span>
                            <span className="hidden sm:inline">{rel ? `${longDay} (${rel[1]})` : longDay}</span>
                          </>
                        );
                      })()}
                    </p>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (activeTab === "calendar" && calendarRef.current) calendarRef.current.goNext();
                  else if (activeTab === "meals") setMealsWeekAnchor(addWeeks(mealsWeekAnchor, 1));
                  else setSelectedDate(addDays(selectedDate, 1));
                }}
                className="p-1 sm:p-2 hover:bg-accent rounded-full"
                aria-label={activeTab === "meals" ? "Next week" : activeTab === "calendar" ? "Next" : "Next day"}
                data-testid="next-date-button"
              >
                <ChevronRight style={{ width: 15, height: 15 }} aria-hidden="true" />
              </Button>
            </div>

            {/* Today/This Week — like Back above, positioned at the midpoint
                between the date cluster's right edge and the row's right
                edge, rather than immediately following the chevrons.
                Pointless (and confusing) to show while already on today/this
                week — pressing it wouldn't change anything — so it's hidden
                in exactly that case. Meals compares its own weekAnchor
                state against the real current week's start; every other
                tab (including Calendar, which keeps selectedDate in sync
                via its own controlled onDateChange) just checks
                isToday(selectedDate). */}
            {(activeTab === "meals"
              ? !isSameDay(mealsWeekAnchor, startOfWeek(new Date(), { weekStartsOn: 0 }))
              : !isToday(selectedDate)) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => activeTab === "meals" ? setMealsWeekAnchor(startOfWeek(new Date(), { weekStartsOn: 0 })) : setSelectedDate(new Date())}
                style={{ position: "absolute", left: dateNavSideCenters ? dateNavSideCenters.right : undefined, right: dateNavSideCenters ? undefined : 8, transform: dateNavSideCenters ? "translateX(-50%)" : undefined }}
                className="px-1.5 py-1.5 sm:px-3 h-auto hover:bg-accent rounded-md text-[11px] sm:text-sm font-medium sm:min-w-[5.5rem] sm:justify-center"
                title={activeTab === "meals" ? "This Week" : "Today"}
                data-testid="today-button"
              >
                {activeTab === "meals" ? "This Week" : "Today"}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      {/* Minimum height: see the stickyHeaderH comment above — 100vh minus the
          sticky header, so a short tab still has the scroll range to hide the
          weather bar without the header's height being counted twice as dead
          space at the bottom. Calendar opts out: its card sets its own fixed
          `h-[calc(100svh-172px)]` and manages its own internal scroll. */}
      {/* pb-24 reserves room for the floating "+" button, which is
          fixed-position and was landing on top of whatever card control sat in
          that corner — including tappable ones, so a tap on the Stars card's
          "Redeem" or the Trophies count opened the + menu instead. 96px is the
          measured minimum that clears it: the button sits 24px off the bottom
          (`calc(1.5rem + safe-area)`) and is 56px tall (`h-14`), so its top
          edge is 80px up, leaving 16px of breathing room. This is the ONLY
          bottom padding on a tab's content — Home's own wrapper and two of
          this file's tab wrappers each carried a further `pb-20`, stacking to
          176px of blank space below the last card. */}
      {/* max-w-screen-2xl + mx-auto: `max-w-full` meant no cap at all, so at
          desktop width every card stretched edge to edge and related controls
          ended up ~1000px apart (Snooze/Done a full screen from the reminder
          they act on). The cap only engages above 1536px-worth of content;
          every phone and tablet width is below it, so those layouts are
          byte-for-byte unchanged. */}
      <main
        className="w-full max-w-screen-2xl mx-auto px-3 sm:px-6 pt-3 overflow-x-hidden"
        style={{
          paddingBottom: "calc(8.5rem + env(safe-area-inset-bottom, 0px))",
          ...(activeTab === "calendar" ? {} : { minHeight: `calc(100vh - ${stickyHeaderH}px)` }),
        }}
      >
        {activeTab === "home" && (
          <HomeView
            selectedProfiles={selectedProfiles}
            profiles={profiles}
            setActiveTab={(tab) => navigateTo(tab as TabType)}
            onSelectProfile={handleProfileToggle}
            selectedDate={selectedDate}
            onEditChore={openEditTask}
            onDeleteChore={deleteTask}
            onNavigateToRewards={() => {
              navigateTo("chores", "rewards");
              setCashOutStarsSpotlightTrigger(n => n + 1);
            }}
            onNavigateToBonusChores={() => navigateTo("chores", "bonus")}
            onOpenHistory={openHistory}
            onOpenActivityEntry={openHistoryEntry}
            onNavigateToEvent={(eventId) => {
              navigateTo("calendar");
              setPendingOpenEventId(eventId);
            }}
            onNavigateToParentControls={() => {
              navigateTo("chores", "rewards");
              setRewardsParentUnlockTrigger(n => n + 1);
            }}
            onNavigateToRewardSuggestions={() => {
              navigateTo("chores", "rewards");
              setRewardSuggestionsSpotlightTrigger(n => n + 1);
            }}
            onReplayOnboarding={(step) => setReplayOnboardingStep(step)}
            onOpenCalendarSettings={() => openSettings("calendar", undefined, undefined, true)}
            healthReminderSpotlightTrigger={healthReminderSpotlightTrigger}
            onHealthReminderSpotlightHandled={() => setHealthReminderSpotlightTrigger(0)}
            praiseSpotlightTrigger={praiseSpotlightTrigger}
            onPraiseSpotlightHandled={() => setPraiseSpotlightTrigger(0)}
            notesSpotlightTrigger={notesSpotlightTrigger}
            onNotesSpotlightHandled={() => setNotesSpotlightTrigger(0)}
            celebrationDeepLinkId={pendingCelebrationId}
          />
        )}
        
        {activeTab === "calendar" && (
          <div className="-mx-3 sm:-mx-6 -mb-8">
            <Calendar3View
              ref={calendarRef}
              selectedProfiles={selectedProfiles}
              profiles={profiles}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              pendingOpenEventId={pendingOpenEventId}
              onPendingEventOpened={() => setPendingOpenEventId(null)}
              onOpenCalendarSettings={(profileId) => openSettings("calendar", profileId)}
            />
          </div>
        )}

        {activeTab === "chores" && (() => {
          // Reusable card fragments
          const tasksCard = (
            <motion.section layout transition={{ layout: { duration: 0.2, ease: "easeOut" } }} id="chores-section-chores" className="scroll-mt-28">
              <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <CardHeader className="p-4 border-b border-border bg-[#D9E3DC]/60 dark:bg-[#2a2e2b]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ListTodo className="w-5 h-5 text-foreground" />
                      <h3 className="text-lg font-semibold text-foreground">Chores</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Hidden unless exactly one person is selected: with
                          several (or All Family) the card shows a per-person
                          summary with no chore rows at all, so Fun Mode has
                          nothing to restyle and the button did nothing.
                          Icon is a Smile, not a party popper — the popper is
                          Celebrations' mark elsewhere in the app, and two
                          different features sharing one glyph was the
                          confusion reported. */}
                      {selectedProfiles.length === 1 && (
                      <Button
                        variant="ghost" size="sm"
                        className={`h-8 w-8 p-0 rounded-full transition-colors ${
                          tasksFunMode ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-black/10 dark:hover:bg-white/10"
                        }`}
                        // aria-label as well as title: a title tooltip never
                        // appears on touch, which is where this app mostly
                        // runs, so this button had no name at all on an iPad.
                        title={tasksFunMode ? "Turn off Fun Mode" : "Turn on Fun Mode"}
                        aria-label={tasksFunMode ? "Turn off Fun Mode" : "Turn on Fun Mode"}
                        onClick={toggleTasksFunMode}
                        data-testid="fun-mode-toggle"
                      >
                        <Smile className="w-4 h-4" />
                      </Button>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        className="hidden md:inline-flex h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                        title={wideTasksCard ? "Switch to narrow layout" : "Switch to wide 2-column layout"}
                        aria-label={wideTasksCard ? "Switch to narrow layout" : "Switch to wide 2-column layout"}
                        onClick={() => { const next = !wideTasksCard; setWideTasksCard(next); localStorage.setItem('familyHub_wideTasksCard', next ? '1' : '0'); setRewardsManageTrigger(0); setRewardsAddTrigger(0); setRewardsParentUnlockTrigger(0); }}
                      >
                        {wideTasksCard ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                        title="Add a chore"
                        aria-label="Add a chore"
                        onClick={() => openCreateTask(null)}
                        data-testid="chores-card-add"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Manage tasks" aria-label="Manage tasks" onClick={() => guardParentAction("createChore", () => guardParentAction("createBonusChore", () => setManageTasksOpen(true)))}>
                        {/* Same glyph as the Rewards and Bonus Chores cards'
                            Manage buttons right beside it — a gear here made
                            one action look like three different ones. */}
                        <ListChecks className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">Chores & more for the family</p>
                </CardHeader>
                <CardContent className="p-4">
                  <ChoresView
                    embedded
                    wideMode={wideTasksCard}
                    selectedProfiles={selectedProfiles}
                    profiles={profiles}
                    selectedDate={selectedDate}
                    onSelectProfile={(id) => setSelectedProfiles([id])}
                    funMode={tasksFunMode}
                    onToggleFunMode={toggleTasksFunMode}
                    taskTypeFilter="non-todos"
                    onRequestCreate={() => openCreateTask(null)}
                    onEditChore={openEditTask}
                    onDeleteChore={deleteTask}
                  />
                </CardContent>
              </Card>
            </motion.section>
          );
          // These three reflow between the left/right columns (narrow) and the
          // row below Tasks (wide), so they remount on toggle — fade them in.
          const sideCardMotion = {
            layout: true,
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.25, layout: { duration: 0.2, ease: "easeOut" } },
          } as const;
          // (To-Dos moved to their own dedicated tab — see the
          // `activeTab === "todos"` branch below and todos-view.tsx.)
          const trophiesCard = (
            <motion.section {...sideCardMotion} id="chores-section-trophies" className="scroll-mt-28">
              <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <CardHeader className="p-4 border-b border-border bg-[#E3E9EF]/70 dark:bg-[#252b30]">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-foreground" />
                    <h3 className="text-lg font-semibold text-foreground">Trophies</h3>
                  </div>
                  <p className="text-muted-foreground text-xs">Achievements earned by each family member</p>
                </CardHeader>
                <CardContent className="p-4">
                  <TrophyCaseView embedded selectedProfiles={selectedProfiles} profiles={profiles} onSelectProfile={(id) => setSelectedProfiles([id])} />
                </CardContent>
              </Card>
            </motion.section>
          );
          // Same "which profiles to show" rule TrophyCaseView uses: the
          // selected profiles, or every regular profile when none/"All
          // Family" is selected. There is exactly ONE Star Insights card — it
          // shows one person's stats when one is selected, and the combined
          // stats for the whole set otherwise (a group, or All Family).
          const starInsightsProfiles = (() => {
            const regular = profiles.filter(p => !p.isAllFamilyProfile);
            return selectedProfiles.length > 0
              ? regular.filter(p => selectedProfiles.includes(p.id))
              : regular;
          })();
          const starInsightsTitle = (() => {
            if (starInsightsProfiles.length === 1) return `${starInsightsProfiles[0].name}'s Star Insights`;
            // If the selection matches a saved group exactly, name it.
            const selectedIds = starInsightsProfiles.map(p => p.id);
            const matchedGroup = customGroups.find(g => {
              const ids = g.profileIds || [];
              return ids.length === selectedIds.length && ids.every(id => selectedIds.includes(id));
            });
            if (matchedGroup) return `${matchedGroup.name} Star Insights`;
            return "Family Star Insights";
          })();
          const starInsightsCard = starInsightsProfiles.length > 0 ? (
            <motion.section {...sideCardMotion} id="chores-section-starInsights" className="scroll-mt-28">
              <StatsInsightsCard profiles={starInsightsProfiles} title={starInsightsTitle} />
            </motion.section>
          ) : null;
          const rewardsCard = (
            <motion.section {...sideCardMotion} id="chores-section-rewards" className="scroll-mt-28">
              <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <CardHeader className="p-4 border-b border-border bg-[#F7F3EC] dark:bg-[#2a2723]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="w-5 h-5 text-foreground" />
                      <h3 className="text-lg font-semibold text-foreground">Rewards</h3>
                    </div>
                    {/* Adding/managing rewards only makes sense with a
                        reward catalog — hidden in cashout_only mode, where
                        this card is purely a cash-out surface. */}
                    {showRewardCatalog && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Add a reward" aria-label="Add a reward" onClick={() => setRewardsAddTrigger(n => n + 1)}><Plus className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Manage rewards" aria-label="Manage rewards" onClick={() => guardParentAction("createReward", () => setRewardsManageTrigger(n => n + 1))}><ListChecks className="w-4 h-4" /></Button>
                      </div>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {showRewardCatalog ? "Earn stars and unlock awesome rewards" : "Cash out stars for real money"}
                  </p>
                </CardHeader>
                <CardContent className="p-4">
                  <RewardsView embedded selectedProfiles={selectedProfiles} profiles={profiles} triggerAdd={rewardsAddTrigger} triggerManage={rewardsManageTrigger} triggerParentUnlock={rewardsParentUnlockTrigger} onParentUnlockTriggerHandled={() => setRewardsParentUnlockTrigger(0)} />
                </CardContent>
              </Card>
            </motion.section>
          );
          const bonusCard = (
            <motion.section {...sideCardMotion} id="chores-section-bonus" className="scroll-mt-28">
              <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <CardHeader className="p-4 border-b border-border bg-[#F2DDD3]/70 dark:bg-[#2e2825]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-foreground" />
                      <h3 className="text-lg font-semibold text-foreground">Bonus Chores</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Add a bonus chore" aria-label="Add a bonus chore" onClick={() => openCreateTask("bonus")}><Plus className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10" title="Manage bonus chores" aria-label="Manage bonus chores" onClick={() => guardParentAction("createBonusChore", () => guardParentAction("createChore", () => setManageTasksOpen(true)))}><ListChecks className="w-4 h-4" /></Button>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">Pick one up any time for extra stars</p>
                </CardHeader>
                <CardContent className="p-4">
                  <BonusChoresView embedded profiles={profiles} selectedProfiles={selectedProfiles} onRequestCreate={() => openCreateTask("bonus")} />
                </CardContent>
              </Card>
            </motion.section>
          );

          // Which side cards show and in what order is user-configurable
          // (Tasks itself is not — see the comment above tasksCard's
          // definition). The first visible side card keeps the pre-existing
          // "goes under Tasks in narrow mode" slot; the rest go in the
          // second column (narrow) or the row below Tasks (wide) — this
          // preserves the original layout's shape while respecting a custom
          // order/visibility.
          const cardsById: Record<string, React.ReactElement | null> = { rewards: rewardsCard, trophies: trophiesCard, bonus: bonusCard, starInsights: starInsightsCard };
          const visibleOrderedCards = tasksCardSettings
            .filter(c => c.visible)
            .sort((a, b) => a.order - b.order)
            .map(c => cardsById[c.id])
            // A card can resolve to null (e.g. Star Insights with no profiles
            // in the current selection) — drop it so the length checks and
            // two-column alternation below stay accurate.
            .filter((el): el is React.ReactElement => el != null);

          // Tasks always renders as its own full-width row, and the other
          // cards always render below it in an even 2-column grid — this is
          // deliberately the SAME arrangement regardless of the expand/collapse
          // toggle. That toggle (wideTasksCard) only controls ChoresView's own
          // internal chore-row density (1 vs 2 columns of chore rows inside
          // Tasks itself, via its wideMode prop below) — it used to ALSO
          // reshape this page-level layout (side-by-side with a single stacked
          // column while collapsed, vs. full-width-with-an-even-grid while
          // expanded), which meant the other cards' arrangement changed for a
          // reason unrelated to anything the user did to them, and looked
          // messy/inconsistent switching between the two. Decoupling the two
          // means the order/columns you set in Customize Tasks Page now stay
          // put no matter how Tasks itself is displayed.
          return (
            <div>
              <div className="flex flex-col gap-6">
                {tasksCard}
              </div>
              {visibleOrderedCards.length > 0 && (
                // Two independently-stacking flex columns (alternating by
                // index), not a CSS grid — a grid would pair cards into rows
                // (col1[0]+col2[0], col1[1]+col2[1], ...), and each row's
                // height is set by its TALLER cell, leaving a gap below the
                // shorter one even though the two cards aren't related.
                // E.g. Bonus (col 2, row 2) previously had its position
                // dictated by Trophies' height (col 1, row 2) instead of
                // sitting directly under Rewards with a plain gap. Splitting
                // into two real flex-col columns makes each column's own
                // stack tight regardless of the other column's card heights.
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start mt-6">
                  <div className="flex flex-col gap-6">
                    {visibleOrderedCards.filter((_, i) => i % 2 === 0)}
                  </div>
                  <div className="flex flex-col gap-6">
                    {visibleOrderedCards.filter((_, i) => i % 2 === 1)}
                  </div>
                </div>
              )}
              {/* "Customize Tasks Page" is reached via this bottom bar
                  instead of the gear that used to sit in the date-nav row. */}
              <div className="mt-6">
                <CustomizePageCard
                  label="Customize Tasks Page"
                  onClick={() => setShowTasksCardSettings(true)}
                  testId="customize-tasks-page-card"
                />
              </div>
            </div>
          );
        })()}

        {activeTab === "todos" && (
          <div>
            <TodosView selectedProfiles={selectedProfiles} profiles={profiles} onAddTodo={() => openCreateTask("todo")} />
          </div>
        )}

        {activeTab === "chat" && (
          <ChatView
            key={`${chatProfileKey}-${chatRevision}`}
            profileKey={chatProfileKey}
            isChild={chatIsChild}
            revision={chatRevision}
            profileReady={hasInitialized}
            onSent={() => setChatRevision((n) => n + 1)}
          />
        )}

        {activeTab === "people" && (
          <PeopleView
            selectedProfiles={selectedProfiles}
            profiles={profiles}
            selectedDate={selectedDate}
            onNavigate={(tab) => navigateTo(tab as TabType)}
            onEditChore={openEditTask}
            onDeleteChore={deleteTask}
          />
        )}

        {activeTab === "meals" && (
          <MealsView
            showGrocery={mealsShowGrocery}
            onShowGroceryChange={setMealsShowGrocery}
            weekAnchor={mealsWeekAnchor}
            onWeekAnchorChange={setMealsWeekAnchor}
          />
        )}

        {activeTab === "behaviour" && (
          <BehaviourBoardView
            profiles={profiles}
            selectedProfiles={selectedProfiles}
            onOpenHistory={() => {
              setHistoryTypeFilter(["behaviour_incident"]);
              setFocusHistoryEntryId(null);
              setShowHistory(true);
            }}
          />
        )}

      </main>

      {/* Tasks tab card settings (reorder/show-hide Trophies, Rewards, Bonus Chores) */}
      <TasksPageSettings
        isOpen={showTasksCardSettings}
        onClose={() => setShowTasksCardSettings(false)}
        onSettingsChange={setTasksCardSettings}
        initialHighlightCardId={tasksCardHighlightId}
      />

      {/* "A few things you might have missed" — a one-time nudge shown a
          couple of weeks in, pointing at whichever of a handful of
          lesser-discovered features this family hasn't set up yet. */}
      <FeatureNudgeController
        user={user}
        profiles={profiles}
        hiddenTabs={hiddenTabs}
        starInsightsHidden={
          tasksCardSettings.find((c) => c.id === "starInsights")?.visible === false
        }
        onOpenNotifications={() => openSettings("notifications")}
        onOpenTodosTab={() => openSettings("appearance", undefined, "todos")}
        onOpenStarInsights={() => openTasksCardSettings("starInsights")}
        onOpenPerPersonSettings={() => openSettings("notifications")}
        onOpenShareLinks={() => openSettings("sharing")}
        onOpenMealIdeas={() => navigateTo("meals")}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        profiles={profiles}
        hiddenTabs={Array.from(hiddenTabs)}
        setHiddenTabs={setHiddenTabs}
        defaultTab={defaultTab}
        setDefaultTab={setDefaultTab}
        tabOrder={tabOrder}
        setTabOrder={setTabOrder}
        navIconsOnly={navIconsOnly}
        setNavIconsOnly={setNavIconsOnly}
        onReplayOnboarding={() => { setShowSettings(false); setReplayOnboardingStep("you"); }}
        initialOpenSectionId={settingsInitialSection}
        initialCalendarProfileId={settingsInitialCalendarProfileId}
        initialCalendarSpotlightAll={settingsSpotlightAllCalendarProfiles}
        initialHighlightTabId={settingsInitialHighlightTabId}
      />

      {/* Replaying the onboarding walkthrough on top of the app */}
      {replayOnboardingStep && (
        <div className="fixed inset-0 z-[2000] overflow-y-auto bg-background">
          <OnboardingWizard
            onSignOut={() => setSignOutStep(1)}
            initialStep={replayOnboardingStep}
            onClose={() => setReplayOnboardingStep(null)}
          />
        </div>
      )}

      {/* Privacy Screen */}
      <PrivacyScreen visible={showPrivacy} onDismiss={() => setShowPrivacy(false)} />

      {parentGateDialog}

      {/* Celebration Container */}
      <div 
        id="celebration-container" 
        className="fixed inset-0 pointer-events-none z-40"
        data-testid="celebration-container"
      >
        {/* Celebration animations will be rendered here */}
      </div>

      {/* ── Floating behaviour timer (visible on all tabs except the board) ── */}
      <BehaviourTimerWidget
        profiles={profiles}
        hidden={activeTab === "behaviour"}
        onOpen={() => navigateTo("behaviour" as TabType)}
      />

      {/* ── Event-starting-soon pop-up (visible on all tabs) ── */}
      <EventReminderWatcher profiles={profiles} />
      {/* Single styled confirmation dialog every destructive action routes through. */}
      <ConfirmDialogHost />
      {/* Free-trial-then-subscribe: shown by showUpgradeDialog() from any
          gated action's onError (Snap a Recipe, Import Recipe, redeem a
          reward, request a cash-out). */}
      <UpgradeDialogHost onManageSubscription={() => openSettings("subscription")} />

      {/* Blanks a never-sleeping counter/wall device after an idle period and
          stops all polling while it's up, then refuses to hand the app back
          until the data has actually refreshed. Off unless switched on in
          Settings → Display & Layout. Mounted here, inside the authenticated
          shell, so it can never cover the login or onboarding screens. */}
      <ScreensaverOverlay />

      <nav className="superhub-tabbar" aria-label="Sections" data-testid="bottom-tab-bar">
        {visibleNavTabs.map((tab) => {
          const TabIcon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigateTo(tab.id as TabType)}
              data-active={selected}
              data-testid={tab.testId}
              aria-current={selected ? "page" : undefined}
              className="superhub-tabbar-item"
              style={selected ? { color: "#5E8FAD" } : undefined}
            >
              <span className="relative">
                <TabIcon className="shrink-0" style={{ width: 22, height: 22 }} />
                {tab.id === "home" && unseenShoutoutCount > 0 && activeTab !== "home" && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
                    {unseenShoutoutCount > 9 ? "9+" : unseenShoutoutCount}
                  </span>
                )}
                {tab.id === "chat" && chatUnread > 0 && (
                  <span
                    data-testid="chat-tab-unread"
                    className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5E8FAD] px-0.5 text-[10px] font-bold leading-none text-white"
                  >
                    {chatUnread > 9 ? "9+" : chatUnread}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-medium leading-none">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Global floating + button (visible on all tabs) ──
          hearth-theme + opaque-vars (both classes on this same div, not just
          inherited from the app-scroll-container ancestor that already has
          .hearth-theme) is required for the compound `.hearth-theme.opaque-vars`
          CSS selector to match — without it, bg-primary/ring-primary here
          resolve to hearth-theme's bare "H S% L%" var and render invisible in
          dark mode. See index.css's "hearth-theme opaque-vars fix" comment. */}
      <div className="hearth-theme opaque-vars fixed right-5 z-[41]" style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))" }}>
        <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              className="bg-primary text-primary-foreground rounded-full w-14 h-14 shadow-lg hover:bg-primary/90 p-0 dark:ring-2 dark:ring-primary/60 dark:shadow-[0_0_16px_rgba(139,92,246,0.5)]"
              data-testid="home-main-add-button"
              title="Add something"
              aria-label="Add something"
            >
              <Plus className="w-7 h-7" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Calendar</DropdownMenuLabel>
            <DropdownMenuItem className="cursor-pointer" onClick={openGlobalAddEvent} data-testid="menu-add-event">
              <CalendarPlus className="w-4 h-4 mr-2 text-primary" />
              Add event
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setShowSnapFlyer(true)} data-testid="menu-snap-flyer">
              <Camera className="w-4 h-4 mr-2 text-muted-foreground" />
              Snap a flyer
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setHealthReminderPickerOpen(true)} data-testid="menu-add-health-reminder">
              <span className="mr-2">💊</span>
              Health reminder
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Tasks</DropdownMenuLabel>
            {/* "Create Chore" and "Create Inspiration" are two differently-
                labeled doors into the exact same unified picker (which still
                offers all 5 kinds) — the label just signals intent up front
                instead of the menu promising one narrow thing ("chore") and
                opening something broader. To-Dos have their own tab, so they
                get their own quick entry here that jumps straight to the
                to-do form, skipping the picker. */}
            <DropdownMenuItem className="cursor-pointer" onClick={() => openCreateTask(null)} data-testid="menu-create-task">
              <ListTodo className="w-4 h-4 mr-2 text-orange-500" />
              Create a chore
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => openCreateTask(null)} data-testid="menu-create-inspiration">
              <span className="mr-2">🌱</span>
              Create an inspiration
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => openCreateTask("todo")} data-testid="menu-add-todo">
              <CheckSquare className="w-4 h-4 mr-2 text-sky-500" />
              Add a to-do
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Rewards</DropdownMenuLabel>
            {/* Opens the standalone Add/Remove Stars spotlight directly —
                it no longer lives inside Rewards' Parent Controls (now
                Cash-Out Approvals, cash-outs only), so there's no tab to
                navigate to first. The modal itself is the PIN gate. */}
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => setShowAddRemoveStars(true)}
              data-testid="menu-adjust-stars"
            >
              <Star className="w-4 h-4 mr-2 text-amber-500" />
              Add or remove stars
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Family</DropdownMenuLabel>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setNoteTrigger(n => n + 1)} data-testid="menu-add-note">
              <StickyNote className="w-4 h-4 mr-2 text-amber-500" />
              Post a note
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setShoutoutTrigger(n => n + 1)} data-testid="menu-add-praise">
              <span className="mr-2">👏</span>
              Give praise
            </DropdownMenuItem>
            <form
              className="px-2 pt-1 pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendChatFromMenu();
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <label className="relative block">
                <input
                  data-testid="menu-chat-field"
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      sendChatFromMenu();
                    }
                  }}
                  placeholder="Ask or change the day"
                  className="w-full rounded-full border border-border bg-background py-2 pl-3 pr-8 text-sm"
                />
                {chatUnread > 0 && (
                  <span
                    data-testid="menu-chat-unread"
                    className="absolute right-1.5 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#5E8FAD] px-1 text-[10px] font-bold text-white"
                  >
                    {chatUnread > 9 ? "9+" : chatUnread}
                  </span>
                )}
              </label>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>


      {/* ── Health reminder: profile picker ── */}
      <Dialog open={healthReminderPickerOpen} onOpenChange={(o) => { if (!o) setHealthReminderPickerOpen(false); }}>
        <DialogContent
          className="max-w-xs"
          // Radix focuses the first button on open, which drew a focus ring
          // around the first profile and read as "already selected". Same
          // guard the task-kind picker and both PIN dialogs already carry.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Who is this reminder for?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {profiles.filter(p => !p.isAllFamilyProfile).length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                Add someone in Settings → People first, then you can set a reminder for them.
              </p>
            )}
            {profiles.filter(p => !p.isAllFamilyProfile).map(p => (
              <button
                key={p.id}
                type="button"
                // hover scoped to devices that actually hover: a plain
                // hover:bg-accent leaves the last-tapped row looking selected
                // on touch. Same guard the task-kind cards already use.
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border [@media(hover:hover)]:hover:bg-accent transition-colors text-left"
                onClick={() => { setHealthReminderProfileId(p.id); setHealthReminderPickerOpen(false); }}
              >
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0" style={{ backgroundColor: p.color }}>
                  {p.photoUrl ? <img src={objectUrl(p.photoUrl)} alt={p.name} className="w-full h-full rounded-full object-cover" /> : p.initials}
                </span>
                <span className="font-medium text-sm">{p.name}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Health reminder: editor ── */}
      {healthReminderProfileId && (() => {
        const profile = profiles.find(p => p.id === healthReminderProfileId);
        if (!profile) return null;
        return (
          <ReminderEditor
            profile={profile}
            allProfiles={profiles}
            existing={null}
            onClose={() => setHealthReminderProfileId(null)}
          />
        );
      })()}

      {/* ── Snap a Flyer (global — works from any tab) ── */}
      <FlyerSnapSheet
        open={showSnapFlyer}
        onOpenChange={setShowSnapFlyer}
        // "View" on the import confirmation lands the user on the exact day
        // the event was created, so a successful import is never something
        // they have to go hunting for.
        onViewDate={(d) => { setSelectedDate(d); navigateTo("calendar"); }}
      />

      {/* ── Add/Remove Stars (spotlight, global — reachable only from the +
          button) ── */}
      <AddRemoveStarsModal
        open={showAddRemoveStars}
        onClose={() => setShowAddRemoveStars(false)}
        profiles={profiles}
      />

      {/* ── Announcements dialogs (Post a note / Give praise from + button) ── */}
      <RecentShoutoutsCard profiles={profiles} triggerNote={noteTrigger} triggerShoutout={shoutoutTrigger} dialogsOnly />

      {/* ── Unified "Create a task" modal (picker → tailored form; also edits) ── */}
      <CreateTaskModal
        open={createTask.open}
        onOpenChange={(o) => setCreateTask(s => ({ ...s, open: o }))}
        profiles={profiles}
        selectedProfiles={selectedProfiles}
        initialKind={createTask.kind}
        editChore={createTask.editChore}
        onGoToKind={(k) => {
          navigateTo(k === "todo" ? "todos" : "chores");
          setTimeout(() => robustScrollToTop(), 100);
        }}
      />

      {/* ── Unified "Manage tasks" drawer (Chores-tab cards open this one) ──
          To-Dos are excluded — they have their own tab with inline management
          and a completed-history drawer, so they never appear here. */}
      <ChoreManagementDrawer
        open={manageTasksOpen}
        onOpenChange={(o) => {
          // Keep the drawer mounted under the edit modal (opening the editor
          // registers as an outside-interaction on the sheet, à la the
          // CalendarSelectionModal fix).
          if (!o && createTask.open) return;
          setManageTasksOpen(o);
        }}
        // "tasks", not "chores": this drawer holds every kind except to-dos,
        // including Inspiration items, which the app explicitly defines as
        // not chores and which earn no stars. The header used to count them
        // as "N chores total".
        title="Manage tasks"
        noun="task"
        chores={allTasks.filter(c => c.taskType !== "todo")}
        profiles={profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false)}
        onEdit={openEditTask}
        onDelete={(id) => {
          // Gate delete by the row's own kind.
          const chore = allTasks.find(c => c.id === id);
          const gate = chore ? KIND_GATE[deriveTaskKind(chore)] : "createChore";
          guardParentAction(gate, () => deleteTaskMutation.mutate(id));
        }}
        onAddChore={() => openCreateTask(null)}
      />

      {/* ── History / Audit trail ── */}
      <HistoryView
        open={showHistory}
        onClose={() => { setShowHistory(false); setFocusHistoryEntryId(null); }}
        profiles={profiles}
        initialTypeFilter={historyTypeFilter}
        focusEntryId={focusHistoryEntryId}
      />

      {/* The old global Bulk-Add-Chores modal was retired — every add path
          now goes through the unified CreateTaskModal (picker). */}

      {/* ── Global Add Event modal — accessible from every tab ── */}
      <EventModal
        isOpen={showGlobalAddEvent}
        onClose={() => setShowGlobalAddEvent(false)}
        isEditing={false}
        profiles={profiles}
        formData={globalFormData}
        setFormData={setGlobalFormData}
        selectedSlot={globalSlot}
        setSelectedSlot={setGlobalSlot}
        selectedEvent={null}
        isSubmitting={createGlobalEventMutation.isPending}
        isDeleting={false}
        onSubmit={async () => createGlobalEventMutation.mutate()}
        onDelete={async () => {}}
        testIdPrefix="global-event"
      />

      <Dialog open={signOutStep > 0} onOpenChange={(open) => { if (!open) setSignOutStep(0); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-muted-foreground" />
              {signOutStep === 1 ? "Sign out?" : "Are you sure?"}
            </DialogTitle>
            <DialogDescription>
              {signOutStep === 1
                ? "You'll need to log back in to access Family Hub+. Click Continue to proceed."
                : "This is your final confirmation. Click Sign out to end your session."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSignOutStep(0)}>Cancel</Button>
            {signOutStep === 1
              ? <Button onClick={() => setSignOutStep(2)}>Continue →</Button>
              : <Button variant="destructive" onClick={() => logout()} data-testid="button-logout-confirm">Sign out</Button>
            }
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
