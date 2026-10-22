import { withoutUnwatched } from "@/lib/outlookAttribution";
import { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import { hapticSuccess } from "@/lib/haptics";
import { hasCelebratedAllDone, markCelebratedAllDone } from "@/lib/allDoneCelebration";
import { isKidContext } from "@/lib/parentGate";
import { maybeRequestReview } from "@/lib/reviewPrompt";
import { robustScrollIntoView, stickyHeaderOffset, waitForElement } from "@/lib/scroll";
import { useSpotlight } from "@/lib/spotlight";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Profile, ChoreCompletion, Chore, InsertEvent, isRequiredChoreTaskType } from "@workspace/shared-types";
import { EventDisplay, TabType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { queryClient, apiRequest, LIVE_REFRESH_MS } from "@/lib/queryClient";
import { useFamilyEvents } from "@/hooks/use-family-events";
import { confirmDialog } from "@/lib/confirmDialog";
import { applySavedEventToCache, removeEventFromCache, applyGoogleAssignmentToCache } from "@/lib/eventCache";
import { useToast } from "@/hooks/use-toast";
import { EventModal } from "@/components/event-modal";
import type { EventFormData } from "@/components/event-modal";

import { TodayPageSettings } from "@/components/today-page-settings";
import { getCardSettings, type CardConfig } from "@/components/home/registry";
import type { SkippableStep } from "@/lib/onboardingSteps";
import { HealthReminderInbox } from "@/components/health-reminder-inbox";
import { useCelebrationSuggestion } from "@/hooks/use-celebration-suggestion";
import { HomeDay } from "@/components/home-day";
import { CustomizePageCard } from "@/components/customize-page-card";
import { DELETE_SERIES_BODY } from "@/lib/copy";
import { driverIdsOf, sameIds } from "@/lib/eventDrivers";

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
  /** Opens the app's Settings modal directly to "Calendar" — used by Today's
   * Schedule when no calendar is connected, or one has stopped syncing. */
  onOpenCalendarSettings?: () => void;
  /** Opens everyone's health reminders, with this person first. */
  onManageHealthReminders?: (profileId: string | null) => void;
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
  /** Opens the unified Create/Edit task modal for this chore (used by
   * PersonCard's inspiration-item detail popup) and deletes it (PIN-gated
   * by kind), respectively. */
  onEditChore?: (chore: Chore) => void;
  onDeleteChore?: (chore: Chore) => void;
  onAddTodo?: () => void;
  onShiftDay?: (by: number) => void;
}

export function HomeView({ selectedProfiles, profiles, setActiveTab, onSelectProfile, selectedDate, onNavigateToRewards, onNavigateToBonusChores, onOpenHistory, onOpenActivityEntry, addEventTrigger, onNavigateToEvent, onNavigateToParentControls, onNavigateToRewardSuggestions, onReplayOnboarding, onOpenCalendarSettings, healthReminderSpotlightTrigger, onHealthReminderSpotlightHandled, praiseSpotlightTrigger, onPraiseSpotlightHandled, notesSpotlightTrigger, onNotesSpotlightHandled, onManageHealthReminders, onEditChore, onDeleteChore, onAddTodo, onShiftDay }: HomeViewProps) {
  const { spotlight, spotlightOverlay } = useSpotlight();

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

  const [homeCards, setHomeCards] = useState<CardConfig[]>(getCardSettings);
  const { toast } = useToast();
  const suggestCelebration = useCelebrationSuggestion();

  const { data: chores = [] } = useQuery<Chore[]>({
    queryKey: ["/api/chores"],
  });

  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

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

  // The same events, ids and colors as the Calendar tab — see hooks/use-family-events.ts.
  // A broken connection must not read as "no events", so each sync state is kept.
  const familyEvents = useFamilyEvents(profiles, { refetchInterval: LIVE_REFRESH_MS });
  const allEvents = familyEvents.events;
  const googleSyncError = familyEvents.google.failing;
  const outlookSyncError = familyEvents.outlook.failing;
  const icalSyncError = familyEvents.ical.failing;

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
        // reminder itself still exists, and landing on it beats landing
        // nowhere (2026-09-29).
        onManageHealthReminders?.(selectedProfiles[0] ?? null);
      });
      onHealthReminderSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthReminderSpotlightTrigger]);

  // Praise and notes live in Notes & Praise. Open it if it was folded, then
  // light the newest row of that kind once its query has loaded, or the
  // whole card when there is no such row to find.
  const [openNotesKey, setOpenNotesKey] = useState(0);
  const revealNotes = (rowId: string) => {
    setOpenNotesKey((k) => k + 1);
    waitForElement(rowId, 4000).then((found) => {
      const target = found ? rowId : "home-notes";
      if (!document.getElementById(target)) return;
      robustScrollIntoView(target, stickyHeaderOffset(), "auto");
      spotlight(target);
    });
  };

  useEffect(() => {
    if (praiseSpotlightTrigger) {
      revealNotes("home-notes-praise");
      onPraiseSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [praiseSpotlightTrigger]);

  useEffect(() => {
    if (notesSpotlightTrigger) {
      revealNotes("home-notes-note");
      onNotesSpotlightHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesSpotlightTrigger]);



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
        onSettingsChange={setHomeCards}
      />

      <HealthReminderInbox
        profiles={profiles}
        selectedProfiles={selectedProfiles}
        onManage={onManageHealthReminders}
      />
      <HomeDay
        chores={chores}
        completions={choreCompletions}
        events={withoutUnwatched(allEvents, familyEvents.calendarAssignments)}
        cards={homeCards}
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
        familyColor={profiles.find((p) => p.isAllFamilyProfile)?.color ?? null}
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
        calendarStatus={{
          connected: profiles.some((p) => p.googleCalendarConnected || p.outlookCalendarConnected || (p as any).icalConnected),
          failing: [
            googleSyncError && "Google",
            outlookSyncError && "Outlook",
            icalSyncError && "a subscribed calendar",
          ].filter((name): name is string => !!name),
        }}
        onOpenCalendarSettings={onOpenCalendarSettings}
        familyProfileId={profiles.find((p) => p.isAllFamilyProfile)?.id ?? null}
        openNotesKey={openNotesKey}
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
