import { assignmentProfileIds, outlookEventProfileIds, withoutUnwatched } from "@/lib/outlookAttribution";
import { recurringIdFromIcal, recurringIdFromOutlook } from "@/lib/upcoming";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ChoreIcon } from "@/components/customChoreIcons";
import { objectUrl } from "@/lib/apiBase";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { hapticSuccess } from "@/lib/haptics";
import { hasCelebratedAllDone, markCelebratedAllDone } from "@/lib/allDoneCelebration";
import { isKidContext } from "@/lib/parentGate";
import { maybeRequestReview } from "@/lib/reviewPrompt";
import { robustScrollToTop, robustScrollIntoView, stickyHeaderOffset, waitForElement } from "@/lib/scroll";
import { useSpotlight } from "@/lib/spotlight";
import { useQuery, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Profile, Event, Achievement, ChoreCompletion, Chore, DailyContent, InsertEvent, ActivityLogEntry, ActivityLogEntryType, RewardSettings, isRequiredChoreTaskType } from "@workspace/shared-types";
import { EventDisplay, AchievementDisplay, ProgressData, TabType } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, BookOpen, Heart, Book, Bookmark, FileText, Calendar, MapPin, ChevronDown, ChevronUp, ChevronRight, X, SlidersHorizontal, Car, Star, EyeOff, Trophy, Maximize2, Minimize2, History as HistoryIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isToday, formatDistanceToNow, startOfDay, endOfDay } from "date-fns";
import { queryClient, apiRequest, getQueryFn, LIVE_REFRESH_MS } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import { parseGoogleEventDates, parseOutlookEventDates, icalDisplayEnd } from "@/lib/calendarDates";
import { applySavedEventToCache, removeEventFromCache, applyGoogleAssignmentToCache } from "@/lib/eventCache";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { EventModal } from "@/components/event-modal";
import type { EventFormData } from "@/components/event-modal";

import { TodayPageSettings, getCardSettings, CardConfig } from "@/components/today-page-settings";
import type { SkippableStep } from "@/components/onboarding-wizard";
import { HealthReminderInbox } from "@/components/health-reminder-inbox";
import { useCelebrationSuggestion } from "@/hooks/use-celebration-suggestion";
import { HomeDay } from "@/components/home-day";
import { PersonCard } from "@/components/people-view";
import { CustomizePageCard } from "@/components/customize-page-card";
import { DELETE_SERIES_BODY } from "@/lib/copy";
import { driverIdsOf, sameIds, driverIdsFromGoogleEvent } from "@/lib/eventDrivers";

interface HomeViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  setActiveTab: (tab: TabType) => void;
  onSelectProfile?: (profileId: string) => void;
  selectedDate: Date;
  onNavigateToRewards?: () => void;
  onNavigateToBonusChores?: () => void;
  onOpenHistory?: () => void;
  /** Opens Family Activity scrolled/highlighted to one specific entry —
   * used when a Recent Activity row itself is clicked, as opposed to the
   * card header/icon, which opens it unfiltered. */
  onOpenActivityEntry?: (entryId: string) => void;
  addEventTrigger?: number;
  onNavigateToEvent?: (eventId: string) => void;
  onNavigateToParentControls?: () => void;
  onNavigateToRewardSuggestions?: () => void;
  onReplayOnboarding?: (step: SkippableStep) => void;
  /** Opens the app's Settings modal directly to "Calendar" —
   * used by the Events card's empty state when no calendar is connected. */
  onOpenCalendarSettings?: () => void;
  /** Counters bumped by a push-notification tap deep-link (family-hub.tsx),
   * each spotlighting the matching card/section on Home. Fired whenever
   * nonzero (mount included, not a "changed since last render" compare —
   * see the long comment above their effects in this file) — each
   * onXHandled callback tells the parent to reset its counter back to 0
   * once handled, so an ordinary later visit to Home can't re-fire it. */
  healthReminderSpotlightTrigger?: number;
  onHealthReminderSpotlightHandled?: () => void;
  praiseSpotlightTrigger?: number;
  onPraiseSpotlightHandled?: () => void;
  notesSpotlightTrigger?: number;
  onNotesSpotlightHandled?: () => void;
  /** A celebration-reminder push notification's target id, owned by
   * family-hub.tsx (not this component) so it's captured regardless of
   * which tab the app happens to be on when the tap arrives — see the long
   * comment on the equivalent state in family-hub.tsx for why that matters.
   * Passed straight through to AnnouncementsBanner. */
  celebrationDeepLinkId?: string | null;
  /** Opens the unified Create/Edit task modal for this chore (used by
   * PersonCard's inspiration-item detail popup) and deletes it (PIN-gated
   * by kind), respectively. */
  onEditChore?: (chore: Chore) => void;
  onDeleteChore?: (chore: Chore) => void;
  onAddTodo?: () => void;
  onShiftDay?: (by: number) => void;
}

// An event assigned to literally every real profile should show the "All
// Family" pseudo-profile's own color, not just whichever real person happens
// to sort first — same fix as calendar3-view.tsx's getProfileColor. Guarded
// on 2+ real profiles so a single-person household's own color isn't
// silently overridden by this rule.
function getEventDisplayColor(profileIds: string[], allProfiles: Profile[]): string {
  const realProfiles = allProfiles.filter((p) => !p.isAllFamilyProfile);
  const isEveryoneAssigned = realProfiles.length >= 2 && realProfiles.every((p) => profileIds.includes(p.id));
  if (isEveryoneAssigned) {
    const allFamily = allProfiles.find((p) => p.isAllFamilyProfile);
    if (allFamily?.color) return allFamily.color;
  }
  const first = allProfiles.find((p) => profileIds.includes(p.id));
  return first?.color || '#5E8FAD';
}

const CONTENT_TYPE_ICONS = {
  'mission': Heart,
  'affirmation': Bookmark,
  'bible_verse': Book,
  'memory_verse': BookOpen,
  'custom': FileText
};

const CONTENT_TYPE_COLORS = {
  'mission': 'text-red-500',
  'affirmation': 'text-blue-500',
  'bible_verse': 'text-purple-500',
  'memory_verse': 'text-green-500',
  'custom': 'text-gray-500'
};

/**
 * When a given completion was FIRST seen by this session, keyed by
 * profile:chore:completedAt. Module scope, not a ref: HomeView unmounts on
 * every tab switch, so a ref reset the map each time you came back to Home —
 * every already-completed chore then looked brand new and got another fresh
 * 30-second hold before it could move to Done. Leaving Home and returning
 * often enough meant items never reached Done at all.
 */
const completionFirstSeen = new Map<string, number>();

export function HomeView({ selectedProfiles, profiles, setActiveTab, onSelectProfile, selectedDate, onNavigateToRewards, onNavigateToBonusChores, onOpenHistory, onOpenActivityEntry, addEventTrigger, onNavigateToEvent, onNavigateToParentControls, onNavigateToRewardSuggestions, onReplayOnboarding, onOpenCalendarSettings, healthReminderSpotlightTrigger, onHealthReminderSpotlightHandled, praiseSpotlightTrigger, onPraiseSpotlightHandled, notesSpotlightTrigger, onNotesSpotlightHandled, celebrationDeepLinkId, onEditChore, onDeleteChore, onAddTodo, onShiftDay }: HomeViewProps) {
  const { spotlight, spotlightOverlay } = useSpotlight();

  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showEarlierToday, setShowEarlierToday] = useState(false);
  const [wideEventsCard, setWideEventsCard] = useState(() => localStorage.getItem('familyHub_wideEventsCard') === '1');
  // Drives whether the card stack below splits into two side-by-side
  // columns at all — see the 'columns' segment rendering, which only makes
  // sense once there's actually room for two columns next to each other.
  const isMobile = useIsMobile();
  const [selectedEvent, setSelectedEvent] = useState<EventDisplay | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [recurringScope, setRecurringScope] = useState<null | { eventData: any }>(null);
  const [highlightDrivingField, setHighlightDrivingField] = useState(false);
  useEffect(() => {
    if (!selectedEvent && !showAddModal) setHighlightDrivingField(false);
  }, [selectedEvent, showAddModal]);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    profileIds: [] as string[],
    isAllDay: false,
    drivingProfileIds: [] as string[],
    recurrenceType: "none" as "none" | "daily" | "weekly" | "monthly" | "annually",
    recurrenceEndDate: null as string | null,
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [cardSettings, setCardSettings] = useState<CardConfig[]>(getCardSettings());
  const [showDoneProgress, setShowDoneProgress] = useState(false);
  // Ticks every second to drive the 30-second "move to Done" timer
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const { toast } = useToast();
  const suggestCelebration = useCelebrationSuggestion();

  // Swipe-to-dismiss: store dismissed event IDs per calendar date in localStorage
  const dateKey = format(selectedDate, 'yyyy-MM-dd');
  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`dismissedEvents_${dateKey}`);
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`dismissedEvents_${dateKey}`);
      setDismissedEventIds(stored ? new Set<string>(JSON.parse(stored)) : new Set<string>());
    } catch { setDismissedEventIds(new Set<string>()); }
  }, [dateKey]);

  const dismissEvent = (eventId: string) => {
    const next = new Set(dismissedEventIds);
    next.add(eventId);
    setDismissedEventIds(next);
    try {
      localStorage.setItem(`dismissedEvents_${dateKey}`, JSON.stringify([...next]));
    } catch { /* quota exceeded — silent */ }
  };

  // Load card settings on mount
  useEffect(() => {
    setCardSettings(getCardSettings());
  }, []);
  
  // Helper function for consistent profile-based filtering.
  // No profiles selected = no filter (matches Calendar's visibleEvents logic
  // in calendar3-view.tsx) rather than hiding everything, so an empty
  // selection never makes a just-created event disappear from Home.
  const isVisibleForSelection = (itemProfileIds?: string[]) => {
    if (selectedProfiles.length === 0) return true;
    if (!itemProfileIds || itemProfileIds.length === 0) return true; // Whole family/public items visible when profiles are selected
    return itemProfileIds.some(id => selectedProfiles.includes(id)); // ANY overlap
  };

  const { data: events = [], isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  const { data: achievements = [], isLoading: achievementsLoading } = useQuery<Achievement[]>({
    queryKey: ["/api/achievements"],
  });

  const { data: chores = [], isLoading: choresLoading } = useQuery<Chore[]>({
    queryKey: ["/api/chores"],
  });

  const { data: choreCompletions = [], isLoading: completionsLoading } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  const [starburstProfile, setStarburstProfile] = useState<string | null>(null);

  // ── Confetti celebration — mirrors chores-view logic ──────────────────
  const fireConfetti = useCallback(() => {
    hapticSuccess();
    confetti({ particleCount: 120, spread: 80, origin: { x: 0.5, y: 0.55 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 45, gravity: 0.9, ticks: 200 });
    setTimeout(() => confetti({ particleCount: 60, angle: 60,  spread: 55, origin: { x: 0,   y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], startVelocity: 50, ticks: 180 }), 150);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1,   y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'], startVelocity: 50, ticks: 180 }), 300);
    setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { x: 0.5, y: 0.3  }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 20, gravity: 1.2, ticks: 250 }), 500);
  }, []);

  // Track which profiles were already "all done" so confetti fires only once per completion
  const prevDoneProfilesRef = useRef<Set<string>>(new Set());
  // Reset tracking when the selected date changes
  useEffect(() => { prevDoneProfilesRef.current = new Set(); }, [selectedDate]);

  useEffect(() => {
    const dayOfWeek = selectedDate.getDay();
    for (const profileId of selectedProfiles) {
      // Same "required chores" definition as chores-view: non-target, real chores
      // only (no to-dos, no Inspiration), scheduled today
      const requiredChores = chores.filter(c =>
        c.profileIds?.includes(profileId) &&
        c.isActive &&
        (c.targetCount == null || c.targetCount <= 0) &&
        isRequiredChoreTaskType(c.taskType) &&
        (c.recurrenceType === "daily" || c.daysOfWeek.includes(dayOfWeek))
      );
      if (requiredChores.length === 0) { prevDoneProfilesRef.current.delete(profileId); continue; }

      const completedToday = new Set(
        choreCompletions
          .filter(c => c.profileId === profileId && c.completedAt &&
            new Date(c.completedAt).toDateString() === selectedDate.toDateString())
          .map(c => c.choreId)
      );
      const allDone = requiredChores.every(c => completedToday.has(c.id));
      const wasAllDone = prevDoneProfilesRef.current.has(profileId);

      if (allDone && !wasAllDone) {
        prevDoneProfilesRef.current.add(profileId);
        // hasCelebratedAllDone is persisted (localStorage), unlike prevDoneProfilesRef
        // above (a plain ref, which resets every time this component remounts on tab
        // switch) — it's what actually stops this from re-firing every time the user
        // navigates back to Home after already being celebrated once today, including
        // by chores-view.tsx on the Tasks tab marking the same flag.
        if (!hasCelebratedAllDone(profileId, selectedDate)) {
          // Only fire confetti if the most recent completion just happened (within 10s).
          const completionTimes = choreCompletions
            .filter(c => c.profileId === profileId && c.completedAt &&
              new Date(c.completedAt).toDateString() === selectedDate.toDateString())
            .map(c => new Date(c.completedAt!).getTime());
          const mostRecentMs = completionTimes.length > 0 ? Math.max(...completionTimes) : 0;
          if (Date.now() - mostRecentMs < 10_000) {
            markCelebratedAllDone(profileId, selectedDate);
            setTimeout(fireConfetti, 400);
            // Peak "this actually works" moment. maybeRequestReview self-gates
            // (native only, not a kid context, 3+ distinct good days, once a
            // year), so calling it from both celebration sites is safe — and
            // necessary, since either tab can be the one that detects the day
            // finished first. Delayed so it never lands on the confetti.
            setTimeout(
              () => maybeRequestReview({ isKidContext: isKidContext(profiles, selectedProfiles) }, selectedDate),
              2900,
            );
          }
        }
      } else if (!allDone) {
        prevDoneProfilesRef.current.delete(profileId);
      }
    }
  // `profiles` is in the deps because the review-prompt gate reads it. Extra
  // runs are harmless here: the celebration is guarded by both the persisted
  // hasCelebratedAllDone flag and the 10-second recency check above, so it
  // cannot double-fire.
  }, [choreCompletions, chores, selectedDate, selectedProfiles, profiles, fireConfetti]);
  // ─────────────────────────────────────────────────────────────────────

  // The to-do celebration that used to live here has moved to the To-Dos tab
  // (todos-view.tsx), where to-dos are actually listed — Home stopped showing
  // them entirely on 2026-09-08, so confetti here had nothing to point at, and
  // it could only fire on ARRIVING at Home within ten seconds of the last
  // completion. Home keeps the chores celebration above; the two dedup
  // separately, so finishing chores and finishing to-dos are both celebrated.


  // Family points mode: in per_completion the star totals can't be a client
  // sum of completion points (individual chores earn 0) — read the
  // authoritative backend total, which includes the daily completion bonus.
  const { data: rewardSettingsCfg } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const perCompletionMode = rewardSettingsCfg?.pointsMode === "per_completion";
  const pointableProfiles = useMemo(() => profiles.filter(p => !p.isAllFamilyProfile), [profiles]);
  // Always authoritative (server subtracts redeemed rewards); client sum is
  // only the first-paint fallback. See rewards-view for the full rationale.
  const backendPointsQueries = useQueries({
    queries: pointableProfiles.map(p => ({
      queryKey: ["/api/points", p.id],
      staleTime: 15_000,
    })),
  });
  const backendPointsMap = useMemo(
    () => new Map(pointableProfiles.map((p, i) => [p.id, (backendPointsQueries[i]?.data as { points?: number } | undefined)?.points])),
    [pointableProfiles, backendPointsQueries]
  );

  const profilePoints = useMemo(() =>
    profiles
      .filter(p => !p.isAllFamilyProfile)
      .filter(p => selectedProfiles.length === 0 || selectedProfiles.includes(p.id))
      .map(profile => {
        const clientSum = choreCompletions
          .filter(c => c.profileId === profile.id)
          .reduce((sum, c) => sum + (c.points || 0), 0);
        return {
          profile,
          pts: backendPointsMap.get(profile.id) ?? clientSum,
        };
      }),
    [profiles, choreCompletions, selectedProfiles, perCompletionMode, backendPointsMap]
  );

  const singleSelectedProfile = useMemo(() =>
    selectedProfiles.length === 1
      ? profiles.find(p => p.id === selectedProfiles[0]) ?? null
      : null,
    [selectedProfiles, profiles]
  );

  const { data: dailyContent = [] } = useQuery<DailyContent[]>({
    queryKey: ["/api/daily-content"],
  });

  // Get daily content assignments and completions
  const { data: dailyAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/daily-content-assignments'],
  });

  const { data: dailyCompletions = [] } = useQuery<any[]>({
    queryKey: ['/api/daily-content-completions'],
  });

  // Fetch calendar assignments to know which calendars belong to which profiles
  const { data: calendarAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/calendar-assignments'],
    retry: false,
  });
  const { data: googleAccounts = [] } = useQuery<{ profileId: string; email: string }[]>({
    queryKey: ["/api/google-calendar/accounts"],
    retry: false,
    staleTime: 300_000,
  });
  const googleAccountEmailMap = useMemo(
    () => new Map(googleAccounts.map(a => [a.email, a.profileId])),
    [googleAccounts],
  );

  // Fetch Google Calendar events for every CONNECTED profile (not just
  // selected ones) — this prevents data loss when profiles are deselected.
  // Filtering on googleCalendarConnected (added here; calendar3-view.tsx and
  // people-view.tsx already did this) avoids polling profiles that never
  // connected Google Calendar at all, which previously 404'd on every single
  // 60s tick for no reason — confirmed in production logs as wasted
  // round-trips and log noise, not a real error.
  // Memoized (not recomputed inline) because the query results below are
  // matched back to a profile by INDEX into this exact same array — it must
  // stay referentially the one true source of that ordering, not a fresh
  // filter each render that could subtly desync from it.
  const googleConnectedProfiles = useMemo(() => profiles.filter(profile => profile.googleCalendarConnected), [profiles]);
  const googleCalendarQueries = useQueries({
    queries: googleConnectedProfiles.map(profile => ({
      queryKey: ["/api/google-calendar/events", profile.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: LIVE_REFRESH_MS,
      retry: false,
    }))
  });

  // Outlook + iCal connected profiles/events — this card previously only ever
  // queried Google, so an Outlook-only or feed-only family saw an empty
  // Today's Events card while Calendar showed their events correctly.
  const outlookConnectedProfiles = useMemo(() => profiles.filter(profile => (profile as any).outlookCalendarConnected), [profiles]);
  const outlookCalendarQueries = useQueries({
    queries: outlookConnectedProfiles.map(profile => ({
      queryKey: ["/api/outlook-calendar/events", profile.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: LIVE_REFRESH_MS,
      retry: false,
    }))
  });
  const icalConnectedProfiles = useMemo(() => profiles.filter(profile => (profile as any).icalConnected), [profiles]);
  const icalQueries = useQueries({
    queries: icalConnectedProfiles.map(profile => ({
      queryKey: ["/api/ical-calendar/events", profile.id],
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: LIVE_REFRESH_MS,
      retry: false,
    }))
  });
  // Matches the Calendar/People tabs' existing convention: a broken
  // connection previously rendered as "no events," indistinguishable from a
  // profile with nothing scheduled. Google was missing from this entirely
  // (2026-08-28 real bug) — `googleCalendarQueries` was already being
  // fetched right above, its `isError` just never got read anywhere, so a
  // Google connection expiring (the most common of the three — Google
  // refresh tokens routinely need reconnecting) silently showed "No
  // remaining events today" with zero indication anything was wrong.
  const googleSyncError = googleCalendarQueries.some(q => q.isError);
  const outlookSyncError = outlookCalendarQueries.some(q => q.isError);
  const icalSyncError = icalQueries.some(q => q.isError);
  const anyCalendarSyncError = googleSyncError || outlookSyncError || icalSyncError;

  // Create event mutation
  const createEventMutation = useMutation({
    mutationFn: async (eventData: InsertEvent) => {
      const response = await apiRequest("POST", "/api/events", eventData);
      return response.json();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event created successfully!" });
      setShowAddModal(false);
      resetForm();
      // Strictly after the fact, and self-contained: offers to also track a
      // "…'s Birthday" event in Celebrations. Never blocks or alters the
      // save above (see use-celebration-suggestion.tsx).
      void suggestCelebration(saved);
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to create event", variant: "destructive" });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, eventData }: { id: string; eventData: any }) => {
      const response = await apiRequest("PATCH", `/api/events/${id}`, eventData);
      return response.json();
    },
    onSuccess: (saved) => {
      // Show it immediately, then reconcile — see lib/eventCache.ts.
      applySavedEventToCache(queryClient, saved);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event updated successfully!" });
      setSelectedEvent(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to update event", variant: "destructive" });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/events/${id}`);
      return id;
    },
    onSuccess: (id) => {
      removeEventFromCache(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Event deleted successfully!" });
      setSelectedEvent(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to delete event", variant: "destructive" });
    },
  });

  const updateGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId, eventData }: { 
      profileId: string; 
      calendarId: string; 
      eventId: string;
      eventData: any;
    }) => {
      const response = await apiRequest("PATCH", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`, eventData);
      return { saved: await response.json(), eventId, eventData };
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
      toast({ title: "Google Calendar event updated successfully!" });
      setSelectedEvent(null);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to update Google Calendar event", variant: "destructive" });
    },
  });

  const deleteGoogleEventMutation = useMutation({
    mutationFn: async ({ profileId, calendarId, eventId }: { 
      profileId: string; 
      calendarId: string; 
      eventId: string;
    }) => {
      await apiRequest("DELETE", `/api/google-calendar/events/${profileId}/${calendarId}/${eventId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
      toast({ title: "Google Calendar event deleted successfully!" });
      setSelectedEvent(null);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to delete Google Calendar event", variant: "destructive" });
    },
  });

  // Every event belongs to someone — default to whoever's currently
  // filtered to, or everyone if no single person is filtered to.
  const defaultProfileIds = (): string[] => {
    const realSelected = selectedProfiles.filter((id) => {
      const p = profiles.find((pr) => pr.id === id);
      return p && !p.isAllFamilyProfile;
    });
    if (realSelected.length > 0) return realSelected;
    return profiles.filter((p) => !p.isAllFamilyProfile).map((p) => p.id);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      location: "",
      profileIds: defaultProfileIds(),
      isAllDay: false,
      drivingProfileIds: [],
      recurrenceType: "none",
      recurrenceEndDate: null,
    });
    setSelectedSlot(null);
    setSelectedEvent(null);
  };


  const submitGoogleEventUpdate = (eventData: any, applyToSeries: boolean) => {
    if (!selectedEvent) return;
    updateGoogleEventMutation.mutate({
      profileId: (selectedEvent as any).googleProfileId,
      calendarId: (selectedEvent as any).googleCalendarId,
      eventId: (selectedEvent as any).googleEventId,
      eventData: { ...eventData, applyToSeries },
    });
  };

  const handleEditEventSubmit = () => {
    if (!selectedEvent) return;

    if (!formData.title.trim()) {
      toast({ title: "Please enter an event title", variant: "destructive" });
      return;
    }

    if (!selectedSlot) {
      toast({ title: "Please select a time slot", variant: "destructive" });
      return;
    }

    // Drivers are NOT folded in here — see the note in lib/eventDrivers.ts.
    const effectiveProfileIds = formData.profileIds;

    if ((selectedEvent as any).isGoogleCalendar && (selectedEvent as any).googleEventId) {
      // Update Google Calendar event. Mirror the Calendar tab exactly, including
      // the recurring-event scope choice — previously the Home card skipped this
      // and silently wrote a single-occurrence assignment, so removing an
      // assignee from a repeating event never took effect and offered no choice.
      const eventData: any = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        location: formData.location.trim() || null,
        start: selectedSlot.start,
        end: selectedSlot.end,
        profileIds: effectiveProfileIds,
        drivingProfileIds: formData.drivingProfileIds,
        recurringEventId: (selectedEvent as any).recurringEventId ?? null,
        occurrenceStart: selectedEvent.startTime
          ? new Date(selectedEvent.startTime).toISOString()
          : null,
      };

      // Only the assignee/driver changing makes the "this occurrence vs. the
      // whole series" choice meaningful.
      const prevIds = [...((selectedEvent as any).profileIds ?? [])].sort();
      const nextIds = [...effectiveProfileIds].sort();
      const assignmentChanged =
        prevIds.length !== nextIds.length ||
        prevIds.some((id, i) => id !== nextIds[i]) ||
        !sameIds(driverIdsOf(selectedEvent as any), formData.drivingProfileIds);

      if ((selectedEvent as any).recurringEventId && assignmentChanged) {
        setRecurringScope({ eventData });
        return;
      }

      updateGoogleEventMutation.mutate({
        profileId: (selectedEvent as any).googleProfileId,
        calendarId: (selectedEvent as any).googleCalendarId,
        eventId: (selectedEvent as any).googleEventId,
        eventData: { ...eventData, applyToSeries: false },
      });
    } else {
      // Update local event
      updateEventMutation.mutate({
        id: selectedEvent.id,
        eventData: {
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          location: formData.location.trim() || null,
          startTime: selectedSlot.start,
          endTime: selectedSlot.end,
          profileIds: effectiveProfileIds,
          isAllDay: formData.isAllDay,
          drivingProfileIds: formData.drivingProfileIds,
          calendarId: null,
          calendarName: null,
          recurrenceType: formData.recurrenceType === "none" ? null : formData.recurrenceType,
          recurrenceEndDate: formData.recurrenceEndDate ? new Date(formData.recurrenceEndDate) : null,
        }
      });
    }
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;

    if ((selectedEvent as any).isGoogleCalendar && (selectedEvent as any).googleEventId) {
      // Google events previously deleted with no barrier at all.
      if (!(await confirmDialog({ title: "Delete this event?", description: "It will also be removed from the connected Google Calendar.", confirmLabel: "Delete event" }))) return;
      deleteGoogleEventMutation.mutate({
        profileId: (selectedEvent as any).googleProfileId,
        calendarId: (selectedEvent as any).googleCalendarId,
        eventId: (selectedEvent as any).googleEventId,
      });
    } else {
      const isPartOfSeries = selectedEvent.isRecurringInstance || !!selectedEvent.recurrenceType;
      const ok = isPartOfSeries ? await confirmDialog({ title: "Delete this repeating event?", description: DELETE_SERIES_BODY, confirmLabel: "Delete series" }) : await confirmDialog({ title: "Delete this event?", confirmLabel: "Delete event" });
      if (!ok) return;
      deleteEventMutation.mutate(selectedEvent.id);
    }
  };

  const handleAddEventSubmit = () => {
    if (!formData.title.trim()) {
      toast({ title: "Please enter an event title", variant: "destructive" });
      return;
    }

    if (!selectedSlot) {
      toast({ title: "Please select a time slot", variant: "destructive" });
      return;
    }

    createEventMutation.mutate({
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      location: formData.location.trim() || null,
      startTime: selectedSlot.start,
      endTime: selectedSlot.end,
      profileIds: formData.profileIds,
      isAllDay: formData.isAllDay,
      drivingProfileIds: formData.drivingProfileIds,
      calendarId: null,
      calendarName: null,
      recurrenceType: formData.recurrenceType === "none" ? null : formData.recurrenceType,
      recurrenceEndDate: formData.recurrenceEndDate ? new Date(formData.recurrenceEndDate) : null,
    });
  };

  const openAddEventModal = () => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setSelectedSlot({ start, end });
    setFormData({
      title: "",
      description: "",
      location: "",
      profileIds: defaultProfileIds(),
      isAllDay: false,
      drivingProfileIds: [],
      recurrenceType: "none",
      recurrenceEndDate: null,
    });
    setShowAddModal(true);
  };

  // Respond to external triggers from the global + button (family-hub.tsx)
  const addEventTriggerRef = useRef(addEventTrigger ?? 0);
  useEffect(() => {
    const cur = addEventTrigger ?? 0;
    if (cur !== addEventTriggerRef.current) {
      addEventTriggerRef.current = cur;
      openAddEventModal();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addEventTrigger]);

  // Push-notification tap deep links (family-hub.tsx). These deliberately
  // do NOT use a mount-time ref-compare ("did the value change since I last
  // saw it") — the same bug class as the celebration deep-link fix earlier
  // this session: the Announcements/push handler navigates to Home AND
  // increments the trigger in the same render, so HomeView is mounting for
  // the FIRST time with the trigger ALREADY at its incremented value. A
  // ref seeded at that same mount would see "no change" and the spotlight
  // would silently never fire — exactly what happened to
  // triggerParentUnlock before it was fixed the same way this is fixed now.
  // Firing on any nonzero value, then telling the parent to reset it back
  // to 0 once handled, means a later ordinary visit to Home (trigger
  // already 0) can't spuriously re-fire the same spotlight.
  useEffect(() => {
    if (healthReminderSpotlightTrigger) {
      // Wait for the card before scrolling to it: HealthReminderInbox renders
      // null until its own query resolves, and tapping a push COLD-LAUNCHES
      // the app, so on a fixed timeout both the scroll and the spotlight
      // silently no-op on a missing element — the reported "tapped the
      // medication notification and nothing was spotlighted". Scrolling
      // matters too: the card can sit below the fold, and dimming around an
      // off-screen card looks the same as not firing at all.
      waitForElement("health-reminder-inbox-card").then((found) => {
        if (found) {
          robustScrollIntoView("health-reminder-inbox-card", stickyHeaderOffset(), "auto");
          spotlight("health-reminder-inbox-card");
          return;
        }
        // No card to point at. That is not an edge case any more: the card is
        // built from health_reminder_events, which only ever came from the
        // server's scheduler — and the device now fires these reminders while
        // that server is asleep. The app reports the dose so the card can
        // appear, but if it is offline, or the report has not landed yet, the
        // reminder still exists further down the page and landing on it beats
        // landing nowhere (2026-09-29).
        const selected = selectedProfiles[0];
        const fallbackId = selected ? `health-reminders-${selected}` : null;
        if (!fallbackId || !document.getElementById(fallbackId)) return;
        robustScrollIntoView(fallbackId, stickyHeaderOffset(), "auto");
        spotlight(fallbackId);
      });
      onHealthReminderSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthReminderSpotlightTrigger]);

  useEffect(() => {
    if (praiseSpotlightTrigger) {
      // Same cold-launch wait as the health reminder above: the Announcements
      // sections render null until their own queries resolve.
      waitForElement("announcements-praise-section").then((found) => {
        if (found) spotlight("announcements-praise-section");
      });
      onPraiseSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [praiseSpotlightTrigger]);

  useEffect(() => {
    if (notesSpotlightTrigger) {
      // Same cold-launch wait as the health reminder above: the Announcements
      // sections render null until their own queries resolve.
      waitForElement("announcements-notes-section").then((found) => {
        if (found) spotlight("announcements-notes-section");
      });
      onNotesSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesSpotlightTrigger]);

  // Convert Google Calendar events to our Event format and combine with local
  // events. Memoized and keyed on each query's dataUpdatedAt so profile/tab
  // switches don't re-process thousands of events on every render. Dedup across
  // profiles uses a Set (was an O(n²) Array.some scan that dominated render time).
  const googleDataSig = googleCalendarQueries.map(q => q.dataUpdatedAt ?? 0).join("|");
  const allEvents = useMemo<Event[]>(() => {
    const googleCalendarEvents: Event[] = [];
    const seenGoogleIds = new Set<string>();

    googleCalendarQueries.forEach((query, profileIndex) => {
      const profileId = googleConnectedProfiles[profileIndex]?.id;
      if (!profileId) return;
      const profileEvents = (query.data || []) as any[];

      for (const gcEvent of profileEvents) {
        // Dedup the same Google event appearing across multiple profiles' queries.
        if (seenGoogleIds.has(gcEvent.id)) continue;
        seenGoogleIds.add(gcEvent.id);

        // Shared parser: Google all-day end dates are EXCLUSIVE (see
        // lib/calendarDates.ts) — the old inline version spilled a day over.
        const { start: startDate, end: endDate } = parseGoogleEventDates(gcEvent);

        const calendarName = gcEvent.extendedProperties?.private?.['calendar_name'] || 'Unknown Calendar';
        const googleCalendarId = gcEvent.extendedProperties?.private?.['google_calendar_id'];

        let assignedProfileIds: string[] = [];
        let displayName = calendarName;

        // Priority 1: explicit familyhub assignment stored on the event (highest)
        const storedProfileIds = gcEvent.extendedProperties?.private?.['familyhub_profile_ids'];
        if (storedProfileIds) {
          try {
            const parsedIds = JSON.parse(storedProfileIds);
            if (Array.isArray(parsedIds) && parsedIds.length > 0) {
              assignedProfileIds = parsedIds;
              const p = profiles.find(pr => pr.id === parsedIds[0]);
              if (p) displayName = p.name;
            }
          } catch (e) {
            // Invalid JSON, continue to next priority
          }
        }

        // Priority 2: match creator email against OAuth Gmail stored in google_calendar_tokens.
        if (!assignedProfileIds.length && gcEvent.creator?.email) {
          const p2 = googleAccountEmailMap.get(gcEvent.creator.email);
          if (p2) {
            const assignedProfile = profiles.find(p => p.id === p2);
            if (assignedProfile) {
              assignedProfileIds = [p2];
              displayName = assignedProfile.name;
            }
          }
        }

        // Priority 3: match by the event's own google_calendar_id
        if (!assignedProfileIds.length && googleCalendarId) {
          const assignment = calendarAssignments.find((a: any) =>
            a.calendarId === googleCalendarId && a.calendarType === 'google'
          );
          if (assignment) {
            const people = assignmentProfileIds(assignment).filter((id) => profiles.some((profile) => profile.id === id));
            if (people.length > 0) {
              assignedProfileIds = people;
              const assignedProfile = profiles.find(p => p.id === people[0]);
              if (assignedProfile) displayName = assignedProfile.name;
            }
          }
        }

        // Priority 4: fall back to the iterating profile
        if (!assignedProfileIds.length) {
          assignedProfileIds = [profileId];
          const currentProfile = profiles.find(p => p.id === profileId);
          if (currentProfile) displayName = currentProfile.name;
        }

        const gcDrivingProfileIds = driverIdsFromGoogleEvent(gcEvent);
        googleCalendarEvents.push({
          id: `google-${profileId}-${gcEvent.id}`,
          title: gcEvent.summary || 'Untitled Event',
          description: gcEvent.description || '',
          location: gcEvent.location || '',
          startTime: startDate,
          endTime: endDate,
          isAllDay: !gcEvent.start?.dateTime,
          profileIds: assignedProfileIds,
          drivingProfileIds: gcDrivingProfileIds,
          calendarId: displayName,
          calendarName: displayName,
          calendarColor: gcEvent.extendedProperties?.private?.['calendar_color'] || null,
          createdAt: new Date(gcEvent.created || Date.now()),
          updatedAt: new Date(gcEvent.updated || Date.now()),
          isGoogleCalendar: true,
          googleCalendarName: displayName,
          googleCalendarId: googleCalendarId,
          googleEventId: gcEvent.id,
          googleProfileId: profileId,
          recurringEventId: gcEvent.recurringEventId ?? null,
        } as any);
      }
    });

    const outlookCalendarEvents: Event[] = [];
    outlookCalendarQueries.forEach((query, profileIndex) => {
      const profileId = outlookConnectedProfiles[profileIndex]?.id;
      if (!profileId) return;
      const profileEvents = (query.data || []) as any[];
      const known = new Set(profiles.map(p => p.id));
      for (const oe of profileEvents) {
        const { start: startDate, end: endDate } = parseOutlookEventDates(oe);
        const oPids = outlookEventProfileIds(oe, profileId, calendarAssignments, known);
        outlookCalendarEvents.push({
          id: `outlook-${profileId}-${oe.id}`,
          title: oe.subject || 'Untitled Event',
          description: oe.bodyPreview || '',
          location: oe.location?.displayName || '',
          startTime: startDate,
          endTime: endDate,
          isAllDay: oe.isAllDay || false,
          profileIds: oPids,
          calendarId: oe.calendar?.name || 'Outlook Calendar',
          calendarName: oe.calendar?.name || 'Outlook Calendar',
          outlookCalendarId: oe.calendar?.id ?? null,
          recurringEventId: recurringIdFromOutlook(oe),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
      }
    });

    const icalEvents: Event[] = [];
    icalQueries.forEach((query, profileIndex) => {
      const profileId = icalConnectedProfiles[profileIndex]?.id;
      if (!profileId) return;
      const profileEvents = (query.data || []) as any[];
      for (const ie of profileEvents) {
        const isAllDay = ie.isAllDay ?? false;
        const startDate = new Date(ie.start);
        icalEvents.push({
          id: `ical-${profileId}-${ie.id}`,
          title: ie.title || 'Untitled Event',
          description: ie.description || '',
          location: ie.location || '',
          startTime: startDate,
          endTime: icalDisplayEnd(ie.end, isAllDay, startDate),
          isAllDay,
          profileIds: [profileId],
          calendarId: ie.calendarColor ? 'Subscribed Calendar' : 'Subscribed Calendar',
          calendarName: 'Subscribed Calendar',
          calendarColor: ie.calendarColor || null,
          recurringEventId: recurringIdFromIcal(ie),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
      }
    });

    return withoutUnwatched([...events, ...googleCalendarEvents, ...outlookCalendarEvents, ...icalEvents], calendarAssignments);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleDataSig, outlookCalendarQueries, icalQueries, events, profiles, googleAccountEmailMap, calendarAssignments]);

  // When each completion first showed up on this client. The "hold it in place
  // for 30s before it drops into Done" window used to compare against the
  // completion's own timestamp, gated on the selected date being today — so on
  // a backfilled day a chore jumped straight into Done the instant it was
  // ticked. First-seen time is the right clock: it works whatever date the
  // completion is recorded under, and whichever card triggered it.


  const uncompleteChore = useMutation({
    mutationFn: async (data: { choreId: string; profileId: string }) => {
      // Send the day being operated on (Home always works on selectedDate) so
      // per_completion mode can key/remove that day's completion bonus.
      const dateParam = selectedDate.toISOString().split("T")[0];
      const localDayStart = new Date(selectedDate);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("DELETE", `/api/chore-completions/${data.choreId}/${data.profileId}?date=${dateParam}&localDayStart=${encodeURIComponent(localDayStart.toISOString())}`);
    },
    // Optimistic, matching chores-view and people-view. Without it the row
    // only changed once the DELETE round-tripped — about a second on a real
    // connection, long enough that a tap felt ignored and got repeated.
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const previousCompletions = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      // A to-do's completion isn't day-scoped (same rule the backend's own
      // DELETE follows), so drop every one for this chore+profile; a chore
      // stays scoped to the day being viewed.
      const chore = chores.find(c => c.id === variables.choreId);
      const isTodo = (chore as any)?.taskType === "todo";
      const dayStr = selectedDate.toDateString();
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
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      // Un-checking can also change the streak or freeze eligibility.
      queryClient.invalidateQueries({ queryKey: ["/api/streak-freezes", variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/streaks", variables.profileId] });
      // Achievements are awarded server-side the moment a completion lands;
      // without this the cached list sat stale and trophies looked delayed.
      queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previousCompletions) {
        queryClient.setQueryData(["/api/chore-completions"], context.previousCompletions);
      }
      toast({ title: "Failed to update chore", variant: "destructive" });
    },
  });

  // Mutation to toggle daily content completion
  const toggleDailyCompletionMutation = useMutation({
    mutationFn: async (data: { contentId: string; profileId: string; isCompleted: boolean }) => {
      if (data.isCompleted) {
        await apiRequest('DELETE', `/api/daily-content-completions/${data.contentId}/${data.profileId}`);
      } else {
        await apiRequest('POST', '/api/daily-content-completions', {
          contentId: data.contentId,
          profileId: data.profileId
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-content-completions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-content-assignments'] });
    },
    onError: () => {
      toast({ title: "Failed to update", description: "Please try again.", variant: "destructive" });
    },
  });

  // Filter and format today's events (including both local and Google Calendar events)
  const todaysEvents = useMemo<(EventDisplay & { isGoogleCalendar?: boolean; googleCalendarId?: string; googleEventId?: string; googleProfileId?: string; googleCalendarName?: string; eventColor: string })[]>(() => allEvents
    .filter(event => {
      // Check if event overlaps with selected date
      const startOfSelected = startOfDay(selectedDate);
      const endOfSelected = endOfDay(selectedDate);
      const eventStart = new Date(event.startTime);
      const eventEnd = new Date(event.endTime);

      const isEventOverlappingSelected = eventEnd >= startOfSelected && eventStart <= endOfSelected;

      // Use our consistent helper function for profile filtering
      // Include driver in the effective profile list for backward compat with older events
      const effectiveIds = [
        ...(event.profileIds || []),
        ...driverIdsOf(event as any),
      ];
      const matchesProfiles = isVisibleForSelection(effectiveIds.length > 0 ? effectiveIds : undefined);

      return isEventOverlappingSelected && matchesProfiles;
    })
    .map(event => {
      // Attendees come first (so the event's color/primary owner is the person it's
      // assigned to), then the driver is appended only if they aren't already an
      // attendee. assignedProfiles[0] drives the displayed color, so the driver must
      // never jump ahead of the actual assignee here.
      const attendeeIdList = event.profileIds ?? [];
      const driverIds = driverIdsOf(event as any);
      const attendeeProfiles = profiles.filter(p => attendeeIdList.includes(p.id));
      const driverOnlyProfiles = profiles.filter(
        p => driverIds.includes(p.id) && !attendeeIdList.includes(p.id),
      );
      const assignedProfiles = [...attendeeProfiles, ...driverOnlyProfiles];
      const eventColor = getEventDisplayColor(attendeeIdList, profiles);
      const eventDate = new Date(event.startTime);
      const timeUntil = event.isAllDay
        ? 'all day'
        : '';

      return {
        ...event,
        startTime: eventDate,
        endTime: new Date(event.endTime),
        assignedProfiles,
        eventColor,
        timeUntil,
        isGoogleCalendar: (event as any).isGoogleCalendar || false,
        googleCalendarId: (event as any).googleCalendarId,
        googleEventId: (event as any).googleEventId,
        googleProfileId: (event as any).googleProfileId,
        googleCalendarName: (event as any).googleCalendarName,
      };
    })
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [allEvents, selectedDate, selectedProfiles, profiles]);

  // Events visible in the Today card — excludes dismissed items and, when
  // viewing today, timed events that have already ended (all-day events stay).
  const now = new Date();
  const visibleTodaysEvents = todaysEvents.filter(e => {
    if (dismissedEventIds.has(e.id)) return false;
    if (isToday(selectedDate) && !e.isAllDay && e.endTime < now) return false;
    return true;
  });

  // Ended-but-not-dismissed timed events from today — shown in "Earlier today"
  const earlierTodayEvents = isToday(selectedDate)
    ? todaysEvents.filter(e => !dismissedEventIds.has(e.id) && !e.isAllDay && e.endTime < now)
    : [];

  // Filter recent achievements
  const recentAchievements: AchievementDisplay[] = achievements
    .filter(achievement => selectedProfiles.includes(achievement.profileId))
    .map(achievement => {
      const profile = profiles.find(p => p.id === achievement.profileId);
      return {
        ...achievement,
        earnedAt: new Date(achievement.earnedAt!),
        profileName: profile?.name,
        profileColor: profile?.color,
      };
    })
    .sort((a, b) => b.earnedAt.getTime() - a.earnedAt.getTime())
    .slice(0, 3);

  // Helper functions for daily content
  const isDailyContentCompleted = (contentId: string, profileId: string): boolean => {
    return dailyCompletions.some((c: any) =>
      c.contentId === contentId && c.profileId === profileId &&
      c.completedAt && new Date(c.completedAt).toDateString() === selectedDate.toDateString()
    );
  };

  const handleToggleDailyCompletion = (contentId: string, profileId: string) => {
    const completed = isDailyContentCompleted(contentId, profileId);
    toggleDailyCompletionMutation.mutate({
      contentId,
      profileId,
      isCompleted: completed
    });
  };

  // Get daily content assigned to selected profiles
  const assignedDailyContent = dailyContent.filter(content => {
    return Array.isArray(dailyAssignments) && dailyAssignments.some((assignment: any) => 
      assignment.contentId === content.id && 
      selectedProfiles.includes(assignment.profileId)
    );
  });

  // Calculate today's progress (chores + daily content)
  const todaysProgress: ProgressData[] = selectedProfiles.map(profileId => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return null;

    // Chore/todo progress — exclude target-count chores (they have no specific day assignment)
    const todayAssigned = chores.filter(chore =>
      chore.profileIds &&
      chore.profileIds.includes(profileId) &&
      chore.isActive &&
      // Unlike chores-view/people-view's shared isChoreScheduledForDate, this
      // inline copy never checked endDate — an item whose schedule had already
      // ended could still count here. Matched to the shared check.
      !(chore.endDate && new Date(chore.endDate) < selectedDate) &&
      (chore.recurrenceType === "daily" || chore.daysOfWeek.includes(selectedDate.getDay())) &&
      !(chore.targetCount && chore.targetCount > 0)
    );

    const profileChoresAll = todayAssigned.filter(c => c.taskType !== "todo");
    const profileTodosAll  = todayAssigned.filter(c => c.taskType === "todo");

    const todaysCompletions = choreCompletions.filter(completion => {
      const completionDate = new Date(completion.completedAt!);
      return completion.profileId === profileId && completionDate.toDateString() === selectedDate.toDateString();
    });

    // To-dos are one-time items, not daily-recurring, so a completion sticks
    // permanently (any-day counts as done) rather than resetting like a
    // chore's. But that also means a to-do finished on an earlier day never
    // ages out of this count on its own — it just sat here forever as
    // "18/18 to-dos," days after being checked off. Matches the same
    // "Done clears at midnight, not kept forever" fix already applied to the
    // To-Dos tab and PersonCard's own Done section: a to-do completed on a
    // PRIOR day (not today) is dropped from this summary's pool entirely —
    // neither counted as open nor as completed — so it stops showing up
    // here at all once the day rolls over, exactly like it already does
    // everywhere else the app surfaces to-do completion.
    const todoIdsAll = new Set(profileTodosAll.map(c => c.id));
    const priorDayCompletedTodoIds = new Set(
      choreCompletions
        .filter(c => c.profileId === profileId && c.completedAt && todoIdsAll.has(c.choreId) && !isToday(new Date(c.completedAt)))
        .map(c => c.choreId)
    );
    const profileChores = profileChoresAll;
    const profileTodos = profileTodosAll.filter(c => !priorDayCompletedTodoIds.has(c.id));

    const todoIds = new Set(profileTodos.map(c => c.id));
    const completedTodoIds = choreCompletions
      .filter(c => c.profileId === profileId && c.completedAt && todoIds.has(c.choreId))
      .map(c => c.choreId);

    const completedChoreIds = new Set([...todaysCompletions.map(c => c.choreId), ...completedTodoIds]);

    // Daily content progress
    const assignedDailyForProfile = Array.isArray(dailyAssignments) ? dailyAssignments.filter((assignment: any) =>
      assignment.profileId === profileId
    ) : [];

    const completedDailyForProfile = assignedDailyForProfile.filter((assignment: any) =>
      isDailyContentCompleted(assignment.contentId, profileId)
    );

    const choreCompleted = profileChores.filter(c => completedChoreIds.has(c.id)).length;
    const choreTotal     = profileChores.length;
    const todoCompleted  = profileTodos.filter(c => completedChoreIds.has(c.id)).length;
    const todoTotal      = profileTodos.length;
    const dailyCompleted = completedDailyForProfile.length;
    const dailyTotal     = assignedDailyForProfile.length;

    // To-dos are excluded from this card's progress since they no longer
    // appear on it (2026-09-08) — counting invisible items in the bar is what
    // produced the "18/18 to-dos" that never cleared.
    const completed = choreCompleted + dailyCompleted;
    const total     = choreTotal + dailyTotal;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      profileId,
      profileName: profile.name,
      profileColor: profile.color,
      completed,
      total,
      percentage,
      choreCompleted,
      choreTotal,
      todoCompleted,
      todoTotal,
      dailyCompleted,
      dailyTotal,
    };
  }).filter(Boolean) as ProgressData[];

  const overallProgress = todaysProgress.length > 0 
    ? Math.round(todaysProgress.reduce((sum, p) => sum + p.percentage, 0) / todaysProgress.length)
    : 0;

  const { data: activityLogRaw = [], isLoading: activityLoading } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-log"],
    staleTime: 30_000,
    select: (data) => data.map((e) => ({ ...e, timestamp: new Date(e.timestamp) })),
  });

  // v2: the v1 key is deliberately abandoned rather than migrated. Devices
  // were turning up with types unchecked that nobody remembers unchecking
  // (chore_complete/chore_uncomplete, which made the card look empty), and a
  // stale narrower set is indistinguishable from a deliberate one — so every
  // device starts fresh with everything checked. Erring toward showing more
  // is the harmless direction here.
  const ACTIVITY_CARD_LS_KEY = 'familyHub_activityCardFilters_v2';
  const ALL_ACTIVITY_TYPES: ActivityLogEntryType[] = [
    'chore_complete', 'chore_uncomplete', 'reward_redeem', 'shoutout', 'point_adjustment',
    'cashout_requested', 'cashout_approved', 'cashout_declined', 'note_posted',
    'meal_planned',
  ];
  const [activityCardFilters, setActivityCardFiltersState] = useState<Set<ActivityLogEntryType>>(() => {
    try {
      const saved = localStorage.getItem(ACTIVITY_CARD_LS_KEY);
      if (saved) {
        const parsed: ActivityLogEntryType[] = JSON.parse(saved);
        // Any type added to the app AFTER this device last saved can't have
        // been deliberately turned off, so union it in rather than hiding it.
        const known: ActivityLogEntryType[] = JSON.parse(
          localStorage.getItem(ACTIVITY_CARD_LS_KEY + '_known') || '[]',
        );
        const brandNew = ALL_ACTIVITY_TYPES.filter(t => !known.includes(t));
        return new Set([...parsed, ...brandNew]);
      }
    } catch { /* ignore */ }
    return new Set(ALL_ACTIVITY_TYPES);
  });

  const setActivityCardFilters = (next: Set<ActivityLogEntryType>) => {
    setActivityCardFiltersState(next);
    try {
      localStorage.setItem(ACTIVITY_CARD_LS_KEY, JSON.stringify([...next]));
      localStorage.setItem(ACTIVITY_CARD_LS_KEY + '_known', JSON.stringify(ALL_ACTIVITY_TYPES));
    } catch { /* quota exceeded */ }
  };

  const toggleActivityCardFilter = (type: ActivityLogEntryType) => {
    const next = new Set(activityCardFilters);
    if (next.has(type)) {
      if (next.size === 1) return; // keep at least one active
      next.delete(type);
    } else {
      next.add(type);
    }
    setActivityCardFilters(next);
  };

  // Family-wide entries (meals, and anything else attributed to the "All
  // Family" pseudo-profile) have a profileId that is never in
  // selectedProfiles — "All Family" in the header means every REAL profile
  // id, not the pseudo one — so the person filter used to drop them
  // unconditionally, on every selection including All Family.
  const allFamilyProfileId = profiles.find(p => p.isAllFamilyProfile)?.id;
  const visibleByProfile = (e: { profileId: string }) =>
    selectedProfiles.length === 0 ||
    e.profileId === allFamilyProfileId ||
    selectedProfiles.includes(e.profileId);

  const activityMatchingProfile = activityLogRaw.filter(visibleByProfile);
  const recentActivityLog = activityMatchingProfile
    .filter(e => activityCardFilters.has(e.activityType as ActivityLogEntryType))
    .slice(0, 5);
  // There IS activity, it's just all filtered out by this card's own type
  // toggles — worth saying so, since the generic "No recent activity" read
  // as "nothing happened" while Family Activity showed a full list.
  const activityHiddenByFilters = recentActivityLog.length === 0 && activityMatchingProfile.length > 0;

  // Get visible cards sorted by order
  const visibleCards = cardSettings
    .filter(card => card.visible)
    .sort((a, b) => a.order - b.order);

  // Render Events Card
  const renderEventsCard = () => (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative" data-testid="events-card">
      <CardHeader className="p-4 border-b border-border bg-[#D9E3DC]/60 dark:bg-[#2a2e2b] cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setActiveTab("calendar")}>
        <div className="flex items-center justify-between min-h-8">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">Events</h3>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10 hidden md:inline-flex"
            title={wideEventsCard ? "Switch to narrow layout" : "Switch to wide 2-column layout"}
            onClick={(e) => { e.stopPropagation(); const next = !wideEventsCard; setWideEventsCard(next); localStorage.setItem('familyHub_wideEventsCard', next ? '1' : '0'); }}
          >
            {wideEventsCard ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">
          {/* The separator needs its own spaces — JSX collapses the newline
              after "members •" to nothing, so this rendered as "•0 events". */}
          <span data-testid="selected-profiles-count">{selectedProfiles.length}</span> family members
          {" · "}
          <span data-testid="todays-events-count">{visibleTodaysEvents.length}</span> events
        </p>
        {anyCalendarSyncError && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenCalendarSettings?.(); }}
            className="text-xs text-destructive mt-1 underline decoration-dotted text-left hover:text-destructive/80"
            data-testid="calendar-sync-error-cta"
          >
            {[
              googleSyncError && "Google",
              outlookSyncError && "Outlook",
              icalSyncError && "a subscribed calendar",
            ].filter(Boolean).join(" and ")} couldn't sync
          </button>
        )}
      </CardHeader>
      
      <CardContent className="p-4">
        {visibleTodaysEvents.length > 0 ? (
          <div className={wideEventsCard ? "grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4 items-start overflow-hidden" : "space-y-4 overflow-hidden"}>
            <AnimatePresence initial={false}>
              {(showAllEvents ? visibleTodaysEvents : visibleTodaysEvents.slice(0, wideEventsCard ? 6 : 3)).map((event) => (
                <motion.div
                  key={event.id}
                  layout
                  transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
                  initial={{ opacity: 1, x: 0 }}
                  exit={{ x: "-110%", opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={{ left: 0.5, right: 0 }}
                  whileDrag={{ cursor: "grabbing" }}
                  className="flex items-center gap-3 pl-3 pr-3 py-2.5 rounded-lg cursor-pointer hover:opacity-90 transition-opacity select-none touch-pan-y border-l-4 w-full overflow-hidden"
                  style={{
                    backgroundColor: event.eventColor + '28',
                    borderLeftColor: event.eventColor,
                  }}
                  data-testid={`event-${event.id}`}
                  onClick={() => {
                    setSelectedEvent(event);
                    setFormData({
                      title: event.title,
                      description: event.description || "",
                      location: event.location || "",
                      profileIds: event.profileIds || [],
                      isAllDay: event.isAllDay || false,
                      drivingProfileIds: driverIdsOf(event),
                      recurrenceType: event.recurrenceType ?? "none",
                      recurrenceEndDate: event.recurrenceEndDate ? new Date(event.recurrenceEndDate).toISOString().slice(0, 10) : null,
                    });
                    setSelectedSlot({ start: event.startTime, end: event.endTime });
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-foreground truncate flex items-center gap-2">
                      <span className="truncate">{event.title}</span>
                      {(() => {
                        const driverIds = driverIdsOf(event);
                        if (driverIds.length === 0) return null;
                        // Every driver, not just the first — two people can
                        // share a trip and the pill used to name only one of
                        // them, which read as the other having been dropped.
                        const drivers = driverIds
                          .map(id => profiles.find(p => p.id === id))
                          .filter((p): p is NonNullable<typeof p> => !!p);
                        const driver = drivers[0];
                        if (!driver) return null;
                        return (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white flex-shrink-0 cursor-pointer hover:opacity-90"
                            style={{ backgroundColor: driver.color }}
                            title={`${drivers.map(d => d.name).join(" and ")} ${drivers.length > 1 ? "are" : "is"} driving`}
                            data-testid={`driver-indicator-${event.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setHighlightDrivingField(true);
                              setSelectedEvent(event);
                              setFormData({
                                title: event.title,
                                description: event.description || "",
                                location: event.location || "",
                                profileIds: event.profileIds || [],
                                isAllDay: event.isAllDay || false,
                                drivingProfileIds: driverIdsOf(event),
                                recurrenceType: event.recurrenceType ?? "none",
                                recurrenceEndDate: event.recurrenceEndDate ? new Date(event.recurrenceEndDate).toISOString().slice(0, 10) : null,
                              });
                              setSelectedSlot({ start: event.startTime, end: event.endTime });
                            }}
                          >
                            <Car className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate max-w-[70px] sm:max-w-[110px]">{drivers.map(d => d.name).join(", ")}</span>
                          </span>
                        );
                      })()}
                    </h4>
                    <p className="text-muted-foreground text-xs truncate">
                      {event.isAllDay ? 'All Day' : `${format(event.startTime, 'h:mm a')} – ${format(event.endTime, 'h:mm a')}`}
                      {event.assignedProfiles.length > 0 && ` · ${event.assignedProfiles.map(p => p.name).join(', ')}`}
                      {event.location && ` · ${event.location}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {event.assignedProfiles.length > 1 && (
                      <div className="flex -space-x-1">
                        {event.assignedProfiles.slice(0, 3).map(p => (
                          <div key={p.id} className="w-5 h-5 rounded-full border-2 border-background flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: p.color }}>
                            {p.initials?.[0]}
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground">{event.timeUntil}</span>
                    <button
                      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 touch-manipulation"
                      title="Hide from today"
                      onClick={(e) => { e.stopPropagation(); dismissEvent(event.id); }}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          // py-4, not py-8 — a single line of text was floating in a card
          // sized for several events.
          <div className="text-center py-4">
            {eventsLoading ? (
              <div className="text-muted-foreground text-sm">
                <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                Loading…
              </div>
            ) : !profiles.some(p => p.googleCalendarConnected || p.outlookCalendarConnected) ? (
              // Real bug fixed 2026-08-27: this used to check only
              // `googleAccounts`/`calendarAssignments` — with no Outlook
              // signal at all, a family that only ever tried (and didn't
              // finish) connecting a calendar could show a stale non-empty
              // `calendarAssignments` and fall through to "No remaining
              // events today" instead of this empty state, even with zero
              // calendars actually connected. Checking each profile's own
              // `googleCalendarConnected`/`outlookCalendarConnected` flags
              // directly is the same source of truth Settings itself uses.
              <button
                type="button"
                onClick={() => onOpenCalendarSettings?.()}
                className="text-sm text-primary hover:underline font-medium"
                data-testid="connect-calendar-cta"
              >
                No calendars selected — tap to connect
              </button>
            ) : anyCalendarSyncError ? (
              // Real bug (2026-08-28), user-reported: a connection that was
              // set up fine but later expired/got revoked (Google refresh
              // tokens routinely need reconnecting) still has
              // `googleCalendarConnected`/`outlookCalendarConnected` = true
              // — that flag only ever means "was this connected at some
              // point," not "is it working right now" — so this fell
              // straight through to the generic "No remaining events today"
              // with zero indication a calendar had silently stopped
              // syncing. `anyCalendarSyncError` (computed above from the
              // same per-profile event queries this card already fetches)
              // is the real "is it working" signal.
              <button
                type="button"
                onClick={() => onOpenCalendarSettings?.()}
                className="text-sm text-destructive hover:underline font-medium"
                data-testid="calendar-needs-reconnect-cta"
              >
                Reconnect it to see your events again
              </button>
            ) : (
              <p className="text-muted-foreground">No remaining events today</p>
            )}
          </div>
        )}

        {visibleTodaysEvents.length > (wideEventsCard ? 6 : 3) && (
          <div className="mt-6">
            <Button
              variant="ghost"
              onClick={() => setShowAllEvents(!showAllEvents)}
              className="w-full py-3 text-center text-primary hover:bg-primary/5 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
              data-testid="view-all-events-button"
            >
              {showAllEvents ? (
                <>
                  Show Less
                  <ChevronUp className="w-4 h-4" />
                </>
              ) : (
                <>
                  View All {visibleTodaysEvents.length} Events
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {earlierTodayEvents.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => setShowEarlierToday(v => !v)}
              data-testid="earlier-today-toggle"
            >
              {showEarlierToday ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Earlier today ({earlierTodayEvents.length})
            </button>
            <div
              className="overflow-hidden transition-all duration-200 ease-out"
              style={{ maxHeight: showEarlierToday ? earlierTodayEvents.length * 72 + 20 : 0, opacity: showEarlierToday ? 1 : 0 }}
            >
              <div className="space-y-2 mt-3">
                {earlierTodayEvents.map(event => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 pl-3 pr-3 py-2 rounded-lg opacity-60 cursor-pointer hover:opacity-80 transition-opacity border-l-4"
                    style={{
                      backgroundColor: (event.assignedProfiles[0]?.color || '#5E8FAD') + '28',
                      borderLeftColor: event.assignedProfiles[0]?.color || '#5E8FAD',
                    }}
                    data-testid={`earlier-event-${event.id}`}
                    onClick={() => {
                      setSelectedEvent(event);
                      setFormData({
                        title: event.title,
                        description: event.description || "",
                        location: event.location || "",
                        profileIds: event.profileIds || [],
                        isAllDay: event.isAllDay || false,
                        drivingProfileIds: driverIdsOf(event),
                        recurrenceType: event.recurrenceType ?? "none",
                        recurrenceEndDate: event.recurrenceEndDate ? new Date(event.recurrenceEndDate).toISOString().slice(0, 10) : null,
                      });
                      setSelectedSlot({ start: event.startTime, end: event.endTime });
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{event.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.assignedProfiles.map(p => p.name).join(', ') || 'Whole Family'} • {format(event.startTime, 'h:mm a')}–{format(event.endTime, 'h:mm a')}
                      </p>
                    </div>
                    {driverIdsOf(event).length > 0 && (() => {
                      const drivers = driverIdsOf(event)
                        .map(id => profiles.find(p => p.id === id))
                        .filter((p): p is NonNullable<typeof p> => !!p);
                      const driver = drivers[0];
                      return driver ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
                          style={{ backgroundColor: driver.color }}
                        >
                          <Car className="w-3 h-3" />
                          {drivers.map(d => d.name).join(", ")}
                        </span>
                      ) : null;
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Render Progress Card
  const renderProgressCard = () => (
    <Card id="progress-card" className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden" data-testid="progress-card">
      <CardHeader
        className="p-4 border-b border-border bg-[#F2DDD3]/70 dark:bg-[#2e2825] cursor-pointer hover:bg-accent/50 transition-colors"
        // This header was missing the scroll-to-top every other entry point
        // into the Chores tab from this card already has (goToProfileTasks
        // above, the Redeem button below) — without it, switching tabs keeps
        // whatever scroll position Home happened to be at, which looks like
        // landing "in the middle" of the (shorter) Chores page once it
        // renders, instead of at its top like every sibling entry point.
        onClick={() => { setActiveTab("chores"); setTimeout(() => robustScrollToTop(), 100); }}
      >
        <div className="flex items-center gap-2 min-h-8">
          <h3 className="text-lg font-semibold text-foreground">Tasks</h3>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">Chores, to-dos & inspiration</p>
      </CardHeader>
      
      <CardContent className="p-4">
        {choresLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            Loading…
          </div>
        ) : (() => {
          const isIndividualView = selectedProfiles.length === 1;
          const DONE_DELAY_MS = 30_000;

          // Items (chores AND to-dos alike — no taskType exclusion here) completed
          // >30s ago, per selected profile. Computed for every selected profile
          // (not just when exactly one is selected) so a completed item still
          // surfaces in "Done" while viewing multiple/All Family profiles, not
          // only in single-profile view.
          const computeDoneForProfile = (profileId: string) => {
            const todayAssigned = chores.filter(chore =>
              chore.profileIds?.includes(profileId) &&
              chore.isActive &&
              !(chore.endDate && new Date(chore.endDate) < selectedDate) &&
              (chore.recurrenceType === "daily" || chore.daysOfWeek.includes(selectedDate.getDay())) &&
              !(chore.targetCount && chore.targetCount > 0)
            );
            // LATEST completion of the day per chore, not whichever happens to
            // be last in the array — a plain `.map(...)` into a Map silently
            // keeps array order, so a stale/duplicate completion row (e.g. an
            // uncheck whose server delete missed, the same class of bug the
            // completion mutations elsewhere in this app already guard
            // against) could win over the real one and throw off "was this
            // just completed" by minutes or hours instead of seconds.
            const completionMap = new Map<string, number>();
            for (const c of choreCompletions) {
              if (c.profileId !== profileId || !c.completedAt) continue;
              if (new Date(c.completedAt).toDateString() !== selectedDate.toDateString()) continue;
              const ts = new Date(c.completedAt).getTime();
              const existing = completionMap.get(c.choreId);
              if (existing === undefined || ts > existing) completionMap.set(c.choreId, ts);
            }
            // To-dos are no longer shown on this card at all (2026-09-08) —
            // they have their own top-level tab — so a completed one must not
            // turn up in this card's Done list either.
            const done: typeof chores = [];
            for (const chore of todayAssigned) {
              const completedAt = completionMap.get(chore.id);
              if (completedAt === undefined) continue;
              const key = `${profileId}:${chore.id}:${completedAt}`;
              let seen = completionFirstSeen.get(key);
              if (seen === undefined) {
                seen = Date.now();
                completionFirstSeen.set(key, seen);
              }
              const stillSettling = nowMs - seen < DONE_DELAY_MS;
              if (!stillSettling) done.push(chore);
            }
            return done;
          };

          const doneByProfile = selectedProfiles.map(profileId => ({
            profileId,
            profile: profiles.find(p => p.id === profileId),
            items: computeDoneForProfile(profileId),
          }));
          const doneItems = isIndividualView ? (doneByProfile[0]?.items ?? []) : [];
          const doneChoreIds = new Set(doneItems.map(c => c.id));
          const multiProfileDoneEntries = isIndividualView ? [] : doneByProfile.flatMap(
            ({ profileId, profile, items }) => items.map(chore => ({ chore, profileId, profile }))
          );

          const goToProfileTasks = (profileId: string) => {
            // Select just this person, then jump to the top of the Tasks tab —
            // with a single profile selected there's only one section shown,
            // so scrolling further down to "find" it just overshoots.
            onSelectProfile?.(profileId);
            setActiveTab('chores');
            setTimeout(() => robustScrollToTop(), 100);
          };

          const renderProgressRow = (progress: ProgressData) => (
            <div
              key={progress.profileId}
              className="space-y-2 cursor-pointer hover:opacity-80 transition-opacity"
              data-testid={`progress-${progress.profileId}`}
              onClick={() => goToProfileTasks(progress.profileId)}
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex items-center gap-2"
                  data-testid={`progress-name-${progress.profileId}`}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                    style={{
                      background: `linear-gradient(135deg, ${progress.profileColor}, ${progress.profileColor}90)`
                    }}
                  >
                    {progress.profileName[0]}
                  </div>
                  <span className="text-sm font-medium text-foreground hover:text-primary transition-colors">
                    {progress.profileName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {progress.total === 0 && <span>Nothing due today</span>}
                  {progress.choreTotal > 0 && (
                    <span>{progress.choreCompleted}/{progress.choreTotal} chores</span>
                  )}
                  {progress.dailyTotal > 0 && (
                    <span>{progress.dailyCompleted}/{progress.dailyTotal} inspiration</span>
                  )}
                </div>
              </div>
              {/* Hidden when there's nothing due — an empty track next to a
                  person with no tasks reads as "0% done" rather than "nothing
                  to do", which is what the Chores tab says for the same data. */}
              {progress.total > 0 && (
              <div className="w-full rounded-full h-1.5" style={{ backgroundColor: `${progress.profileColor}25` }}>
                <div
                  className="progress-bar-fill h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress.percentage}%`, minWidth: progress.total > 0 && progress.percentage === 0 ? '4px' : undefined }}
                ></div>
              </div>
              )}
            </div>
          );

          if (todaysProgress.length === 0) {
            return (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">Nothing remaining today</p>
              </div>
            );
          }

          return (
            <>
              {/* Progress bars — always at the top */}
              <div className="space-y-4">
                {todaysProgress.map(renderProgressRow)}
              </div>

              {/* Individual view: PersonCard (active + recently-completed chores) + Done section */}
              {singleSelectedProfile && (
                <div className="mt-4 border-t border-border pt-4">
                  <PersonCard
                    noCard
                    profile={singleSelectedProfile}
                    allProfiles={profiles}
                    selectedDate={selectedDate}
                    events={[]}
                    chores={chores.filter(c => !doneChoreIds.has(c.id))}
                    choreCompletions={choreCompletions}
                    dailyContent={dailyContent}
                    dailyAssignments={dailyAssignments}
                    dailyCompletions={dailyCompletions}
                    onNavigate={setActiveTab}
                    showEvents={false}
                    showPastEvents={false}
                    onNavigateToBonusChores={onNavigateToBonusChores}
                    onEditChore={onEditChore}
                    onDeleteChore={onDeleteChore}
                  />

                  {doneItems.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <button
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                        onClick={() => setShowDoneProgress(v => !v)}
                      >
                        {showDoneProgress ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        Done ({doneItems.length})
                      </button>
                      <AnimatePresence initial={false}>
                        {showDoneProgress && (
                          <motion.div
                            key="done-items"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <ul className="mt-2 space-y-1.5">
                              {doneItems.map(chore => (
                                <li
                                  key={chore.id}
                                  className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-accent/30 border-green-400/30 cursor-pointer hover:bg-accent/50 transition-colors"
                                  onClick={() => uncompleteChore.mutate({ choreId: chore.id, profileId: singleSelectedProfile!.id })}
                                >
                                  <div className="w-5 h-5 rounded-full border-2 bg-green-500 border-green-500 text-white flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3 h-3" />
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    {chore.icon && <ChoreIcon icon={chore.icon} className="w-4 h-4" />}
                                    <span className="text-sm line-through text-muted-foreground">{chore.title}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                                    <Trophy className="w-3.5 h-3.5" />
                                    <span className="text-xs font-medium">Done!</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}

              {/* Multiple/All Family profiles selected: no PersonCard (too much to show
                  per-person), but still surface a combined Done list so a completed
                  chore or to-do doesn't just silently vanish until you narrow to one profile. */}
              {!singleSelectedProfile && multiProfileDoneEntries.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <button
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    onClick={() => setShowDoneProgress(v => !v)}
                  >
                    {showDoneProgress ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Done ({multiProfileDoneEntries.length})
                  </button>
                  <AnimatePresence initial={false}>
                    {showDoneProgress && (
                      <motion.div
                        key="done-items-multi"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <ul className="mt-2 space-y-1.5">
                          {multiProfileDoneEntries.map(({ chore, profileId, profile }) => (
                            <li
                              key={`${chore.id}-${profileId}`}
                              className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-accent/30 border-green-400/30 cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={() => uncompleteChore.mutate({ choreId: chore.id, profileId })}
                            >
                              <div className="w-5 h-5 rounded-full border-2 bg-green-500 border-green-500 text-white flex items-center justify-center flex-shrink-0">
                                <Check className="w-3 h-3" />
                              </div>
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                {chore.icon && <ChoreIcon icon={chore.icon} className="w-4 h-4" />}
                                <span className="text-sm line-through text-muted-foreground truncate">{chore.title}</span>
                                {profile && (
                                  <span className="text-xs text-muted-foreground flex-shrink-0">· {profile.name}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-green-600 flex-shrink-0">
                                <Trophy className="w-3.5 h-3.5" />
                                <span className="text-xs font-medium">Done!</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          );
        })()}
      </CardContent>
    </Card>
  );

  const ACTIVITY_EMOJI: Record<string, string> = {
    chore_complete:    '✅',
    chore_uncomplete:  '↩️',
    reward_redeem:     '🎁',
    shoutout:          '👏',
    point_adjustment:  '⭐',
    cashout_requested: '💵',
    cashout_approved:  '✅',
    cashout_declined:  '🚫',
    note_posted:       '📝',
    meal_planned:      '🍽️',
  };
  const ACTIVITY_LABEL: Record<string, string> = {
    chore_complete:    'Chore done',
    chore_uncomplete:  'Chore undone',
    reward_redeem:     'Reward',
    shoutout:          'Shoutout',
    point_adjustment:  'Stars',
    cashout_requested: 'Cash-out requested',
    cashout_approved:  'Cash-out approved',
    cashout_declined:  'Cash-out declined',
    note_posted:       'Note posted',
    meal_planned:      'Meal planned',
  };

  // How many types are currently switched OFF — drives the "you're not seeing
  // everything" state on the filter control.
  const activityFiltersHidden = ALL_ACTIVITY_TYPES.filter(t => !activityCardFilters.has(t)).length;

  // Render Activity Card
  const renderActivityCard = () => (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden" data-testid="activity-card">
      <CardHeader
        className={`p-4 border-b border-border bg-[#E3E9EF]/70 dark:bg-[#252b30] ${onOpenHistory ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
        onClick={onOpenHistory}
      >
        <div className="flex items-center justify-between min-h-8">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">Recent Activity</h3>
            {onOpenHistory && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Settings gear — controls which types appear in this card.
                A filtered card looks identical to a quiet one, so when some
                types are switched off the control says so rather than leaving
                the user to wonder where their chores went. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`flex items-center gap-1 p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                    activityFiltersHidden > 0
                      ? "text-primary bg-primary/10 hover:bg-primary/15"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={activityFiltersHidden > 0
                    ? `Filter activity types — ${activityFiltersHidden} hidden`
                    : "Filter activity types"}
                  data-testid="activity-filter-button"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {activityFiltersHidden > 0 && (
                    <span className="text-[11px] font-semibold leading-none">{activityFiltersHidden}</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Show in card</p>
                  {activityFiltersHidden > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setActivityCardFilters(new Set(ALL_ACTIVITY_TYPES))}
                      data-testid="activity-filter-show-all"
                    >
                      Show all
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {ALL_ACTIVITY_TYPES.map(type => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={activityCardFilters.has(type)}
                        onChange={() => toggleActivityCardFilter(type)}
                        className="rounded"
                      />
                      <span className="text-sm">{ACTIVITY_EMOJI[type]} {ACTIVITY_LABEL[type]}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {/* Same drawer-icon convention as the Chores tab's header buttons —
                opens Family Activity directly, same place a tap on the header
                itself already goes. */}
            {onOpenHistory && (
              <Button
                variant="ghost" size="sm"
                className="h-8 w-8 p-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                onClick={(e) => { e.stopPropagation(); onOpenHistory(); }}
                title="Open Family Activity"
                data-testid="open-family-activity"
              >
                <HistoryIcon className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">Latest actions across the family</p>
      </CardHeader>

      <CardContent className="p-4">
        {activityLoading && recentActivityLog.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            Loading…
          </div>
        ) : recentActivityLog.length > 0 ? (
          <div className="space-y-3">
            {recentActivityLog.map((activity) => (
              <div
                key={activity.id}
                className={`flex items-center gap-3 p-3 bg-accent/20 rounded-lg ${onOpenActivityEntry ? "cursor-pointer hover:bg-accent/40 transition-colors" : ""}`}
                onClick={onOpenActivityEntry ? (e) => { e.stopPropagation(); onOpenActivityEntry(activity.id); } : undefined}
                data-testid="recent-activity-row"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: activity.profileColor + '22' }}>
                  {ACTIVITY_EMOJI[activity.activityType] ?? '📋'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">{activity.profileName}</p>
                  <p className="text-xs text-muted-foreground leading-snug line-clamp-1">{activity.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-muted-foreground text-sm">
              {activityHiddenByFilters ? "Everything recent is hidden by this card's filters" : "No recent activity"}
            </p>
            {activityHiddenByFilters && (
              <button
                type="button"
                className="text-xs text-primary hover:underline mt-1"
                onClick={(e) => { e.stopPropagation(); setActivityCardFilters(new Set(ALL_ACTIVITY_TYPES)); }}
                data-testid="activity-show-all-types"
              >
                Show all types
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Achievement icon mapping
  const getAchievementIcon = (type: string) => {
    const iconMap: Record<string, string> = {
      first_chore: '⭐',
      streak_3: '🔥',
      streak_7: '🔥',
      streak_14: '🔥',
      streak_30: '👑',
      chores_10: '🏅',
      chores_25: '🏅',
      chores_50: '🏆',
      chores_100: '👑',
      points_100: '🎯',
      points_500: '🎯',
      points_1000: '⚡',
      perfect_day: '🎉',
      first_reward_redeemed: '🎁',
      rewards_redeemed_10: '🎁',
      rewards_redeemed_25: '🎁',
      rewards_redeemed_50: '🎁',
      rewards_redeemed_100: '👑',
      first_bonus_chore: '⚡',
      bonus_chores_10: '⚡',
      bonus_chores_25: '⚡',
      bonus_chores_50: '⚡',
      bonus_chores_100: '👑',
      first_cashout: '💰',
      cashout_10: '💰',
      cashout_25: '💰',
      cashout_50: '💰',
      cashout_100: '👑',
    };
    return iconMap[type] || '🏆';
  };

  // Render Achievements Card
  const renderAchievementsCard = () => (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden" data-testid="achievements-card">
      <CardHeader className="p-4 border-b border-border bg-[#E3E9EF]/70 dark:bg-[#252b30]">
        <div className="flex items-center justify-between min-h-8">
          <h3 className="text-lg font-semibold text-foreground">Achievements</h3>
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">Milestones & celebrations</p>
      </CardHeader>
      
      <CardContent className="p-4">
        {achievementsLoading && recentAchievements.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            Loading…
          </div>
        ) : recentAchievements.length > 0 ? (
          <div className="space-y-3">
            {recentAchievements.map((achievement) => (
              <div 
                key={achievement.id} 
                className="flex items-center gap-3 p-3 bg-gradient-to-r from-yellow-400/5 to-orange-400/5 rounded-lg"
                data-testid={`achievement-${achievement.id}`}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-2xl bg-gradient-to-r from-yellow-500 to-orange-500">
                  {getAchievementIcon(achievement.type)}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-foreground">{achievement.title}</p>
                  <p className="text-xs text-muted-foreground">{achievement.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: achievement.profileColor }}
                    ></div>
                    <span className="text-xs text-muted-foreground">{achievement.profileName}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(achievement.earnedAt, { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🏆</div>
            <p className="text-muted-foreground text-sm">No achievements yet!</p>
            <p className="text-muted-foreground text-xs mt-1">Complete chores to earn milestones</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Render Celebrations Card (upcoming birthdays/anniversaries)
  // Render Stars & Points Card
  const renderPointsCard = () => (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden" data-testid="points-card">
      <CardHeader
        className="p-4 border-b border-border bg-[#F7F3EC] dark:bg-[#2a2723] cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => { setActiveTab("chores"); setTimeout(() => robustScrollToTop(), 100); }}
      >
        <div className="flex items-center justify-between min-h-8">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">Stars</h3>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          {/* stopPropagation: without it, this click also fires the
              CardHeader's own onClick above (React bubbles synthetic events
              along the component tree, not the DOM tree), which would
              immediately navigate to the Tasks tab's default section instead
              of Rewards. */}
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4 h-8 text-sm"
              onClick={() => onNavigateToRewards?.()}
            >
              {rewardSettingsCfg?.redemptionMode === "cashout_only" ? "Cash Out ✨" : "Redeem ✨"}
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">Stars earned by each family member</p>
      </CardHeader>
      <CardContent className="p-4">
        {completionsLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            Loading…
          </div>
        ) : (
        <div className="flex flex-wrap gap-3">
          <AnimatePresence>
          {profilePoints.map(({ profile, pts }) => (
            <motion.div
              key={profile.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative flex items-center gap-3 px-4 py-2.5 bg-muted/30 rounded-full cursor-pointer select-none hover:bg-muted/50 transition-colors"
              onClick={() => {
                setStarburstProfile(profile.id);
                setTimeout(() => setStarburstProfile(null), 900);
              }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-white shadow-sm shrink-0"
                style={{ backgroundColor: profile.color }}
              >
                {profile.photoUrl
                  ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" />
                  : profile.initials}
              </div>
              <div>
                <p className="text-base font-medium text-foreground leading-none">{profile.name}</p>
                <motion.p
                  className="text-xl font-bold text-amber-500 flex items-center gap-1 mt-1"
                  animate={starburstProfile === profile.id ? { scale: [1, 1.5, 1] } : {}}
                  transition={{ duration: 0.35 }}
                >
                  <Star className="w-6 h-6 text-yellow-500 fill-yellow-500" />
                  {pts}
                </motion.p>
              </div>
              <AnimatePresence>
                {starburstProfile === profile.id && (
                  <>
                    {[...Array(8)].map((_, i) => {
                      const angle = ((i * 45) - 90) * (Math.PI / 180);
                      const dist = 38 + (i % 2) * 14;
                      const tx = Math.cos(angle) * dist;
                      const ty = Math.sin(angle) * dist;
                      return (
                        <motion.span
                          key={i}
                          className="absolute pointer-events-none"
                          style={{ left: "50%", top: "50%", translateX: "-50%", translateY: "-50%", fontSize: 10 + (i % 3) * 3 }}
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
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
        )}
      </CardContent>
    </Card>
  );

  // Helper to render a card by ID
  const renderCard = (cardId: string) => {
    switch (cardId) {
      case 'events': return renderEventsCard();
      case 'points': return renderPointsCard();
      case 'progress': return renderProgressCard();
      case 'activity': return renderActivityCard();
      case 'achievements': return renderAchievementsCard();
      default: return null;
    }
  };

  return (
    <>
    {spotlightOverlay}
    {/* opaque-vars must accompany every hearth-theme class: this div's own
        .hearth-theme re-declares the broken bare-triple vars over the ones the
        app root already fixed, so without the fix class here the entire Home
        subtree's raw bg-/text-/border- utilities go transparent again. */}
    <div className="hearth-theme opaque-vars bg-background min-h-full overflow-x-hidden">
      {/* "Customize Home Page" is reached via the CustomizePageCard bar at
          the bottom of this card stack (below), which just opens this same
          TodayPageSettings dialog directly. */}
    <div className="space-y-6">

      {/* Settings Modal */}
      <TodayPageSettings
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSettingsChange={setCardSettings}
      />

      <HealthReminderInbox
        profiles={profiles}
        selectedProfiles={selectedProfiles}
        onManage={(profileId) => {
          // HealthRemindersSection only ever renders inside PersonCard,
          // which is part of THIS tab's own Tasks card (once a single
          // profile is selected) — not the Chores tab, which has no such
          // section at all. The previous `setActiveTab("chores")` here was
          // a real bug: it sent people to the one screen guaranteed not to
          // show reminder management, the exact "I don't see any of the
          // medication reminder stuff" report. Selecting the profile is
          // enough to reveal it right here; just scroll down to it.
          onSelectProfile?.(profileId);
          // Selecting a profile can change the Tasks card's own layout —
          // from a generic "all family" summary to the full per-person
          // breakdown — and that re-render doesn't always land within the
          // very next frame. Measuring/scrolling immediately (the first
          // time a profile gets newly selected here) could snapshot the
          // card's stale, pre-selection position, undershooting the real
          // scroll target and leaving the card's top tucked behind the
          // header. A double rAF waits for that re-render (and its layout)
          // to actually settle before anything gets measured. Once the
          // same profile is already selected, this is a same-position
          // no-op and the timing doesn't matter either way.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // "auto" (instant) rather than "smooth" — a smooth scroll's
              // duration isn't predictable (it scales with distance), so a
              // fixed delay before firing the spotlight could easily fire
              // mid-scroll on a long jump. Instant scroll removes that race
              // outright instead of tuning the delay against it.
              // Aim at the health reminders section itself, not the whole
              // Tasks card. The card holds chores, to-dos, bonus, goals and
              // inspiration stacked ABOVE this section, so on a phone
              // spotlighting the card dimmed most of the screen and still
              // left the reminders half off the bottom — reported
              // 2026-09-29 as "it spotlights a huge section and only half
              // the medication reminder was on screen". The card is the
              // right target only when the section is not there to aim at.
              const sectionId = `health-reminders-${profileId}`;
              const target = document.getElementById(sectionId) ? sectionId : "progress-card";
              robustScrollIntoView(target, stickyHeaderOffset(), "auto");
              window.setTimeout(() => spotlight(target), 80);
            });
          });
        }}
      />
      <HomeDay
        chores={chores}
        completions={choreCompletions}
        events={allEvents}
        selectedIds={selectedProfiles}
        familyIds={profiles.filter(p => !p.isAllFamilyProfile).map(p => p.id)}
        day={selectedDate}
        kidName={(() => {
          const picked = profiles.filter((p) => !p.isAllFamilyProfile && selectedProfiles.includes(p.id));
          if (picked.length !== 1) return null;
          const person = picked[0];
          return person.role === "child" || person.isChild ? person.name : null;
        })()}
        personId={(() => {
          const picked = profiles.filter((p) => !p.isAllFamilyProfile && selectedProfiles.includes(p.id));
          return picked.length === 1 ? picked[0].id : null;
        })()}
        people={profiles.filter((p) => !p.isAllFamilyProfile).map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          school: p.school ?? null,
          isChild: p.isChild,
          role: p.role,
          connected: !!(p.googleCalendarConnected || p.outlookCalendarConnected),
        }))}
        onOpenChores={() => setActiveTab("chores")}
        onAddTodo={onAddTodo}
        onEditTodo={onEditChore}
        onDeleteTodo={onDeleteChore}
        onShiftDay={onShiftDay}
        onOpenCalendar={() => setActiveTab("calendar")}
        onOpenEvent={onNavigateToEvent}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/events"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/ical-calendar/events"] });
        }}
      />

      <CustomizePageCard
        label="Customize Home Page"
        onClick={() => setShowSettingsModal(true)}
        testId="customize-home-page-card"
      />

      <EventModal
        isOpen={!!selectedEvent || showAddModal}
        onClose={() => {
          setSelectedEvent(null);
          setShowAddModal(false);
          setHighlightDrivingField(false);
        }}
        highlightDrivingField={highlightDrivingField}
        onSubmit={async (_data: EventFormData) => {
          if (selectedEvent) {
            handleEditEventSubmit();
          } else {
            handleAddEventSubmit();
          }
        }}
        onDelete={async () => {
          if (selectedEvent) {
            await handleDeleteEvent();
          }
        }}
        isEditing={!!selectedEvent}
        profiles={profiles}
        formData={formData}
        setFormData={setFormData}
        selectedSlot={selectedSlot}
        setSelectedSlot={setSelectedSlot}
        selectedEvent={selectedEvent}
        isSubmitting={createEventMutation.isPending || updateEventMutation.isPending || updateGoogleEventMutation.isPending}
        isDeleting={deleteEventMutation.isPending || deleteGoogleEventMutation.isPending}
        resetForm={resetForm}
        testIdPrefix="home-event"
      />

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
              data-testid="home-recurring-scope-this"
              variant="outline"
              onClick={() => {
                if (recurringScope) submitGoogleEventUpdate(recurringScope.eventData, false);
                setRecurringScope(null);
              }}
            >
              This event only
            </Button>
            <Button
              data-testid="home-recurring-scope-following"
              onClick={() => {
                if (recurringScope) submitGoogleEventUpdate(recurringScope.eventData, true);
                setRecurringScope(null);
              }}
            >
              This and all following events
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>

    </>

  );
}
