import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, StickyNote, ChevronDown, ChevronUp, Check, ExternalLink, Gift, ArrowRight, BellOff, BellRing, PartyPopper, Compass, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { objectUrl } from "@/lib/apiBase";
import {
  type CelebrationSnoozes,
  loadCelebrationSnoozes,
  saveCelebrationSnoozes,
  nextCelebrationCheckpoint,
} from "@/lib/celebrationSnooze";
import type { Profile, DailyContent, DailyContentAssignment, OnboardingStatus, RewardSettings } from "@workspace/shared-types";
import { format } from "date-fns";
import { CelebrationDetailDialog, CelebrationFormDialog, TYPE_META, type CelebrationListItem } from "@/components/celebrations-view";
import type { SkippableStep } from "@/lib/onboardingSteps";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Shoutout {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  emoji: string;
  message: string;
  createdAt: string;
  seenAt: string | null;
}

interface WishlistItem {
  id: string;
  title: string;
  status: string;
  submittedByProfileId: string | null;
  suggestedPriceCoins: number;
}

interface PendingCashout {
  id: string;
  profileId: string;
  requestedPoints: number;
}

interface Props {
  selectedProfiles: string[];
  profiles: Profile[];
  /** Called when the user clicks "View Event" on an event-linked note */
  onNavigateToEvent?: (eventId: string) => void;
  /** Called when the user clicks "Go to Parent Controls" on a reward-approval alert */
  onNavigateToParentControls?: () => void;
  onNavigateToRewardSuggestions?: () => void;
  /** Called when the user clicks "Finish now" on a skipped-onboarding-step reminder */
  onReplayOnboarding?: (step: SkippableStep) => void;
  /** Set once (from a tapped celebration-reminder push notification) to open
   *  that celebration's detail dialog immediately, same as tapping its row. */
  initialOpenCelebrationId?: string | null;
}

// ── Snooze helpers ─────────────────────────────────────────────────────────────
const SNOOZE_KEY = "familyHub_announcementsSnooze";

function loadSnoozeUntil(): number {
  try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0); } catch { return 0; }
}

function saveSnoozeUntil(ms: number) {
  try { localStorage.setItem(SNOOZE_KEY, String(ms)); } catch {}
}

function clearSnooze() {
  try { localStorage.removeItem(SNOOZE_KEY); } catch {}
}

// ── localStorage helpers ───────────────────────────────────────────────────────
function loadDismissed(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveDismissed(storageKey: string, ids: Set<string>) {
  try { localStorage.setItem(storageKey, JSON.stringify([...ids])); } catch {}
}

// ── Small reusable row ────────────────────────────────────────────────────────
// Every announcement type uses this same layout:
//   [○ checkbox]  [● Name(s)]  [content]
interface RowProps {
  id: string;
  nameEl: React.ReactNode;   // always the "for whom" — same column position
  contentEl: React.ReactNode;
  onDismiss: (id: string) => void;
}

function AnnouncementRow({ id, nameEl, contentEl, onDismiss }: RowProps) {
  const [checked, setChecked] = useState(false);

  const handleCheck = () => {
    setChecked(true);
    setTimeout(() => onDismiss(id), 380);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 1, height: "auto" }}
      animate={checked ? { opacity: 0, height: 0, marginBottom: 0 } : { opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex items-start gap-2.5 overflow-hidden"
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={handleCheck}
        aria-label={checked ? "Undo — bring this back" : "Check off and dismiss"}
        title={checked ? "Undo" : "Check off and dismiss"}
        // Stable hook so tests don't pin to the visible copy, which changed
        // when this button stopped being an unlabelled circle.
        data-testid="announcement-dismiss"
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-green-500 border-green-500 text-white"
            : "border-muted-foreground/60 text-muted-foreground/50 hover:border-primary hover:text-primary hover:bg-primary/10"
        }`}
      >
        {/* Only once checked. A faint tick in the EMPTY state read as
            already-done — the opposite of what it was there to say. */}
        {checked && <Check className="w-3 h-3" />}
      </button>

      {/* Name column — fixed width so content always starts at the same x.
          Narrowed from w-24 (2026-08-14) — names are usually short (Mom,
          Dad, a kid's name), so the old width left a wide, unused gap
          between the name and the content on phones before the content
          column even started. */}
      <div className="w-16 sm:w-20 lg:w-32 shrink-0 pt-0.5">
        {nameEl}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        {contentEl}
      </div>
    </motion.div>
  );
}

// ── Section wrapper with left-accent border ───────────────────────────────────
interface SectionProps {
  icon: React.ReactNode;
  label: string;
  accentClass: string; // e.g. "border-rose-400"
  children: React.ReactNode;
  id?: string;
  /** Small muted note under the header — used to flag "device"-scoped
   * sections (see DISMISS_SCOPE below) so it's clear checking one off here
   * doesn't clear it for the rest of the family. */
  caption?: string;
}

function AnnouncementSection({ icon, label, accentClass, children, id, caption }: SectionProps) {
  return (
    <div id={id} className={`border-l-2 pl-3 ${accentClass}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        {/* `caption` is now carried by a glyph, not a line of italic text —
            the wording lives in its tooltip for anyone who wants it. */}
        {caption && <Smartphone className="h-3 w-3 text-muted-foreground shrink-0" aria-label={caption} />}
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const ONBOARDING_STEP_META: Record<SkippableStep, { label: string; emoji: string }> = {
  you: { label: "Add your photo & email", emoji: "🙋" },
  location: { label: "Add your location", emoji: "📍" },
  calendar: { label: "Connect your calendars", emoji: "📅" },
  rewards: { label: "Set up Rewards & Approvals", emoji: "🎁" },
  invite: { label: "Invite the rest of your family", emoji: "👨‍👩‍👧" },
};
const ONBOARDING_STEP_KEYS: SkippableStep[] = ["you", "location", "calendar", "rewards", "invite"];

// ── Dismiss scope ──────────────────────────────────────────────────────────────
// Checking an announcement off can mean one of two things: "this device
// doesn't need to see it anymore" (per-device, localStorage-backed — nothing
// changes for anyone else's device), or "the whole family is done with this"
// (server-persisted — clears everywhere at once). Per an explicit product
// decision (2026-08-20), every section defaults to "device" now: on a shared
// device like a kitchen iPad, one person's dismissal (e.g. Mom checking off
// a shoutout TO Paisley because she's already seen it on her own phone)
// shouldn't hide it before Paisley ever sees it on the shared iPad. Flipping
// any one of these back to "family" is a one-line change here — the
// "family"-scope code path for each section is kept in place below, not
// deleted, specifically so that revert is cheap.
type DismissScope = "device" | "family";
const DISMISS_SCOPE: Record<"notes" | "praise" | "celebrations" | "redemptions" | "finishSetup", DismissScope> = {
  notes: "device",
  praise: "device",
  celebrations: "device", // already was device-only before this change
  redemptions: "device", // already was device-only before this change
  finishSetup: "device",
};
import { DEVICE_SCOPE_CAPTION } from "@/lib/copy";
/** True when any section dismisses per-device, so the caveat is worth stating. */
const ANY_DEVICE_SCOPED = Object.entries(DISMISS_SCOPE)
  .filter(([k]) => k !== "finishSetup")
  .some(([, v]) => v === "device");

export function AnnouncementsBanner({ selectedProfiles, profiles, onNavigateToEvent, onNavigateToParentControls, onNavigateToRewardSuggestions, onReplayOnboarding, initialOpenCelebrationId }: Props) {
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(false);
  // One-line explainer for the two glyphs in this header, shown only when
  // the phone is tapped. Not a permanent caption — that's what it replaced.
  const [glyphHelp, setGlyphHelp] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState<number>(() => loadSnoozeUntil());

  const isSnoozed = snoozeUntil > Date.now();

  const snooze = (minutes: number) => {
    const until = Date.now() + minutes * 60_000;
    setSnoozeUntil(until);
    saveSnoozeUntil(until);
  };

  const unsnooze = () => {
    setSnoozeUntil(0);
    clearSnooze();
  };

  // Per-device dismiss sets, persisted to localStorage (device scope — see
  // DISMISS_SCOPE above) — or, in family scope, an optimistic local overlay
  // while the server request that actually clears it for everyone is in
  // flight (unchanged from before).
  const [dismissedNotesLocal, setDismissedNotesLocal] = useState<Set<string>>(
    () => DISMISS_SCOPE.notes === "device" ? loadDismissed("familyHub_dismissedNotes") : new Set()
  );
  const [dismissedShoutoutsLocal, setDismissedShoutoutsLocal] = useState<Set<string>>(
    () => DISMISS_SCOPE.praise === "device" ? loadDismissed("familyHub_dismissedShoutouts") : new Set()
  );
  // Celebrations recur annually, so the dismiss key is scoped by year — dismissing
  // this year's "upcoming birthday" notice shouldn't hide next year's.
  const celebrationYearKey = `familyHub_dismissedCelebrations_${new Date().getFullYear()}`;
  const [celebrationSnoozes, setCelebrationSnoozes] = useState<CelebrationSnoozes>(
    () => loadCelebrationSnoozes(celebrationYearKey)
  );
  const [openCelebrationId, setOpenCelebrationId] = useState<string | null>(null);
  // Set when "Edit Details" is tapped on the read-only detail dialog above —
  // opens the same CelebrationFormDialog used by the Celebrations tab itself,
  // so editing works identically no matter where the celebration was opened
  // from, instead of Announcements being a dead end with no way to edit.
  const [editingCelebrationId, setEditingCelebrationId] = useState<string | null>(null);
  useEffect(() => {
    if (initialOpenCelebrationId) setOpenCelebrationId(initialOpenCelebrationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenCelebrationId]);
  // Redeemed-reward notices are one-off (no annual recurrence like
  // celebrations), so dismissing one hides it for good.
  const [dismissedRedemptions, setDismissedRedemptions] = useState<Set<string>>(
    () => loadDismissed("familyHub_dismissedRedemptions")
  );

  // Keyed by `${contentId}:${profileId}` — one note assigned to N people is
  // now N independently-completable items (see the `notes` computation
  // below), so dismissing one person's copy must not hide anyone else's.
  const dismissNote = (key: string, profileId: string | null) => {
    if (DISMISS_SCOPE.notes === "device") {
      const next = new Set(dismissedNotesLocal).add(key);
      setDismissedNotesLocal(next);
      saveDismissed("familyHub_dismissedNotes", next);
      return;
    }
    // Family scope: mark completed server-side so it clears for everyone.
    // Note: marking a note "done" from Home/People's own Notes checkbox is a
    // completely separate action from this Announcements dismiss either
    // way — that one keeps working regardless of DISMISS_SCOPE here.
    setDismissedNotesLocal((prev) => new Set(prev).add(key));
    if (profileId) {
      const contentId = key.split(":")[0];
      apiRequest("POST", "/api/daily-content-completions", { contentId, profileId })
        .catch(() => {
          // Rollback the optimistic dismiss so the note reappears
          setDismissedNotesLocal((prev) => { const next = new Set(prev); next.delete(key); return next; });
        })
        .finally(() => qc.invalidateQueries({ queryKey: ["/api/daily-content-completions"] }));
    }
  };

  const dismissCelebration = (id: string, daysUntil: number) => {
    const next = { ...celebrationSnoozes, [id]: nextCelebrationCheckpoint(daysUntil) };
    setCelebrationSnoozes(next);
    saveCelebrationSnoozes(celebrationYearKey, next);
  };

  const dismissRedemption = (id: string) => {
    const next = new Set(dismissedRedemptions).add(id);
    setDismissedRedemptions(next);
    saveDismissed("familyHub_dismissedRedemptions", next);
  };

  const dismissShoutout = (id: string) => {
    if (DISMISS_SCOPE.praise === "device") {
      const next = new Set(dismissedShoutoutsLocal).add(id);
      setDismissedShoutoutsLocal(next);
      saveDismissed("familyHub_dismissedShoutouts", next);
      return;
    }
    // Family scope: mark seen server-side so it doesn't reappear anywhere.
    setDismissedShoutoutsLocal((prev) => new Set(prev).add(id));
    apiRequest("POST", `/api/shoutouts/${id}/seen`)
      .catch(() => {
        // Rollback the optimistic dismiss so the shoutout reappears
        setDismissedShoutoutsLocal((prev) => { const next = new Set(prev); next.delete(id); return next; });
      })
      .finally(() => qc.invalidateQueries({ queryKey: ["/api/shoutouts"] }));
  };

  const toggleCollapsed = () => setCollapsed((c) => !c);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: locationSettings, isPending: locationSettingsPending } = useQuery<{ timezone?: string; city?: string; state?: string } | null>({ queryKey: ["/api/location-settings"] });
  // Data-based fallbacks for the "rewards"/"invite" reminder rows — same
  // reasoning as the location/you fallbacks below: the wizard's "skipped"
  // flag only ever clears via markOnboardingStepDone(), which only fires
  // from a fresh save/invite. A family that already had a PIN or an invite
  // in place before that wiring existed (or that completed the step through
  // some other path) would otherwise be dismissed-then-reminded forever,
  // since "skipped" alone can never resolve to "done" on its own.
  const { data: rewardSettingsForReminder, isPending: rewardSettingsPending } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const { data: familyInvitesForReminder = [], isPending: familyInvitesPending } = useQuery<{ id: string }[]>({ queryKey: ["/api/family/invites"] });
  const { data: allContent = [] } = useQuery<DailyContent[]>({ queryKey: ["/api/daily-content"] });
  const { data: assignments = [], isPending: assignmentsPending } = useQuery<DailyContentAssignment[]>({ queryKey: ["/api/daily-content-assignments"] });
  const { data: completions = [] } = useQuery<{ contentId: string; profileId: string }[]>({ queryKey: ["/api/daily-content-completions"] });
  const { data: shoutouts = [] } = useQuery<Shoutout[]>({
    queryKey: ["/api/shoutouts", { limit: 5 }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/shoutouts?limit=5");
      return res.json();
    },
  });
  const { data: wishlistItems = [] } = useQuery<WishlistItem[]>({ queryKey: ["/api/wishlist-items"] });
  const { data: pendingCashouts = [] } = useQuery<PendingCashout[]>({ queryKey: ["/api/wallet/pending"] });
  // Recent reward redemptions, so admins are aware without opening Rewards.
  const { data: rewardRedemptions = [] } = useQuery<Array<{ id: string; rewardId: string; profileId: string; status: string; redeemedAt: string | null; createdAt: string | null }>>({ queryKey: ["/api/reward-redemptions"] });
  const { data: rewardsList = [] } = useQuery<Array<{ id: string; title: string; pointsCost: number }>>({ queryKey: ["/api/rewards"] });
  // Full list (not /upcoming) so gift ideas + photos are attached — the detail
  // pop-up this section links to needs both.
  const { data: allCelebrations = [] } = useQuery<CelebrationListItem[]>({ queryKey: ["/api/celebrations"] });
  const { data: onboardingStatus } = useQuery<OnboardingStatus>({ queryKey: ["/api/onboarding-status"] });

  // Per-device 3-day snooze for "Finish Setting Up" steps, mirroring the
  // server's own dismiss-for-3-days behavior (kept as the "family" fallback
  // below) but scoped to just this device — one parent dismissing "set up
  // Rewards" on their phone shouldn't also silence the reminder on the
  // shared kitchen iPad.
  const [dismissedStepsLocal, setDismissedStepsLocal] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("familyHub_dismissedOnboardingSteps");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const dismissOnboardingStep = (step: SkippableStep) => {
    if (DISMISS_SCOPE.finishSetup === "device") {
      const until = Date.now() + 3 * 24 * 60 * 60 * 1000;
      const next = { ...dismissedStepsLocal, [step]: until };
      setDismissedStepsLocal(next);
      try { localStorage.setItem("familyHub_dismissedOnboardingSteps", JSON.stringify(next)); } catch {}
      return;
    }
    apiRequest("PATCH", "/api/onboarding-status", { step: step === "you" ? "profile" : step, action: "dismiss" })
      .finally(() => qc.invalidateQueries({ queryKey: ["/api/onboarding-status"] }));
  };

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const visibleProfileIds = useMemo(() => {
    const real = profiles.filter((p) => !p.isAllFamilyProfile);
    if (selectedProfiles.length === 0) return new Set(real.map((p) => p.id));
    return new Set(real.filter((p) => selectedProfiles.includes(p.id)).map((p) => p.id));
  }, [profiles, selectedProfiles]);

  const allFamilyProfileId = useMemo(
    () => profiles.find((p) => p.isAllFamilyProfile)?.id,
    [profiles],
  );

  // ── Filtered data ─────────────────────────────────────────────────────────────
  // One item per (note, assignment) pair — this is the actual unit of
  // completion now. A note "assigned to All Family" has exactly one
  // assignment row (targeting the pseudo All-Family profile), so it
  // naturally renders as a single row with one shared checkbox — checking it
  // off resolves it for everyone at once, same as before. A note assigned to
  // multiple individuals (or posted via "All Family Members," which expands
  // to every real profile at creation time) has one row per real profileId,
  // each completed/dismissed fully independently of the others.
  interface NoteItem {
    key: string; // `${contentId}:${profileId}`, or `${contentId}:none` for the legacy/no-assignment fallback
    note: DailyContent;
    profileId: string | null;
  }

  const noteItems = useMemo<NoteItem[]>(() => {
    // ⚠️ Notes and their assignments are two separate queries, and whichever
    // lands first wins. While assignments are still in flight this list is
    // EMPTY, which is indistinguishable from "this note genuinely has no
    // assignment rows" — and that fallback below broadcasts the note to
    // everyone under a `:none` key that no stored dismissal can match. So if
    // /api/daily-content resolved first, every note the family had ever
    // written reappeared at once, already-dismissed or not, until the second
    // query arrived a beat later. That is the "old notes flash up for a split
    // second on a cold start, with a badge counting them" report (2026-09-10).
    // Render nothing until we actually know what the assignments are.
    if (assignmentsPending) return [];
    const items: NoteItem[] = [];
    for (const c of allContent) {
      if (c.type !== "note" || c.isActive === false) continue;
      const noteAssignments = assignments.filter((a) => a.contentId === c.id);
      if (noteAssignments.length === 0) {
        // No assignment rows at all — defensive fallback for legacy data;
        // shown to everyone, dismiss is local-only (no profile to attribute
        // a server-side completion to).
        items.push({ key: `${c.id}:none`, note: c, profileId: null });
        continue;
      }
      for (const a of noteAssignments) {
        items.push({ key: `${c.id}:${a.profileId}`, note: c, profileId: a.profileId });
      }
    }
    return items;
  }, [allContent, assignments, assignmentsPending]);

  const completedKeys = useMemo(
    () => new Set(completions.map((c) => `${c.contentId}:${c.profileId}`)),
    [completions],
  );

  // Notes are scoped to who they're assigned to, same as health reminders —
  // a note for Linnea only shows while Linnea (or nobody specific / "All
  // Family," which shows everyone's) is the active header selection, not
  // while e.g. Dad is exclusively selected. The one exception is a note
  // actually assigned to the "All Family" pseudo-profile (the broadcast
  // target "All Family" produces, distinct from "All Family Members," which
  // expands to individual per-person rows) — that's a genuine whole-family
  // notice, not tied to any one real person, so it always shows regardless
  // of selection. Same for the legacy no-assignment-row fallback.
  const notes = useMemo(() =>
    noteItems.filter((item) => {
      // In "family" scope, completing a note anywhere (its own Home/People
      // checkbox, or dismissing here) hides it for everyone. In "device"
      // scope, only THIS device's own local dismiss matters — someone else
      // completing it on their device/profile shouldn't silently clear it
      // here before this device has seen it.
      if (DISMISS_SCOPE.notes === "family" && completedKeys.has(item.key)) return false;
      if (dismissedNotesLocal.has(item.key)) return false;
      if (item.profileId === null || item.profileId === allFamilyProfileId) return true;
      return visibleProfileIds.has(item.profileId);
    }),
    [noteItems, completedKeys, dismissedNotesLocal, visibleProfileIds, allFamilyProfileId]
  );

  // Who posted a note — stored in its own `reference` field as the plain
  // author profileId (not prefixed, unlike the "event:<id>" form the same
  // field can also hold — see the eventId check in the Notes render below;
  // notes are never both at once). Same helper/logic as
  // `recent-shoutouts-card.tsx`'s own `authorLabel`, which already shows
  // this in its "who posted" feed — this was just missing from Announcements.
  const authorLabel = (note: DailyContent): string => {
    if (!note.reference || note.reference.startsWith("event:")) return "Family";
    return profileMap.get(note.reference)?.name ?? "Family";
  };

  // Same fix as notes above (2026-08-14): a shoutout is praise given IN
  // FRONT OF the family, not a personal item scoped to whoever the header
  // happens to be filtered to right now — a "Dad → Jett" shoutout should
  // show up while viewing Dad, Mom, everyone, or nobody in particular, not
  // only while Jett specifically is the active selection. Previously
  // filtered by `visibleProfileIds.has(s.toProfileId)`, which hid it (and,
  // if it was the only pending announcement, collapsed the whole banner)
  // any time the header's selection didn't happen to include the recipient.
  //
  // `!s.seenAt` (2026-08-18): dismissing a shoutout here marks it seen
  // server-side (persisted) but ALSO adds it to `dismissedShoutoutsLocal` —
  // pure in-memory component state, reset to empty every time this banner
  // remounts (navigating away from Home and back). Without checking the
  // server's own `seenAt` too, a dismissed item's only "stay hidden" signal
  // was that local set, so it reliably reappeared on the very next
  // navigation even though the dismiss itself had succeeded. Safe to check
  // seenAt here specifically because shoutout creation no longer stamps it
  // at creation time (fixed the same session as the "praise never shows up"
  // bug) — a brand-new, never-dismissed shoutout still starts with
  // `seenAt: null` and shows normally until someone actually dismisses it.
  const recentShoutouts = useMemo(() =>
    shoutouts
      // In "device" scope, dismissedShoutoutsLocal is now itself persisted
      // to localStorage (not just in-memory), so it's a reliable "stay
      // hidden on this device" signal on its own — no need to also lean on
      // the server's shared seenAt, which is exactly the cross-device
      // effect this scope is meant to avoid (someone else's device marking
      // it seen shouldn't hide it here). In "family" scope, seenAt is still
      // checked, same as before.
      .filter((s) => (DISMISS_SCOPE.praise === "family" ? !s.seenAt : true) && !dismissedShoutoutsLocal.has(s.id))
      .slice(0, 5),
    [shoutouts, dismissedShoutoutsLocal]
  );

  const pendingWishlist = useMemo(() => wishlistItems.filter(w => w.status === "pending"), [wishlistItems]);
  const pendingApprovalCount = pendingWishlist.length + pendingCashouts.length;

  // Surface a celebration once it's within a week out, until it's dismissed
  // (per-year — see celebrationYearKey above) or has passed.
  const upcomingCelebrations = useMemo(() =>
    allCelebrations
      .filter(c => {
        if (c.daysUntil < 0 || c.daysUntil > 7) return false;
        const showAtOrBelow = celebrationSnoozes[c.id];
        if (showAtOrBelow === undefined) return true;
        return c.daysUntil <= showAtOrBelow;
      })
      .sort((a, b) => a.daysUntil - b.daysUntil),
    [allCelebrations, celebrationSnoozes]
  );

  // Recently redeemed rewards (last 3 days, not yet dismissed) so admins get a
  // heads-up in-app. Joined to the reward for its title/cost; newest first.
  const rewardById = useMemo(() => new Map(rewardsList.map(r => [r.id, r])), [rewardsList]);
  const recentRedemptions = useMemo(() => {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return rewardRedemptions
      .filter(r => r.status === "redeemed" && !dismissedRedemptions.has(r.id))
      .map(r => ({ ...r, when: r.redeemedAt ? new Date(r.redeemedAt) : r.createdAt ? new Date(r.createdAt) : null }))
      .filter((r): r is typeof r & { when: Date } => !!r.when && r.when.getTime() >= cutoff)
      .sort((a, b) => b.when.getTime() - a.when.getTime());
  }, [rewardRedemptions, dismissedRedemptions]);

  // Skipped onboarding steps still pending a reminder — not currently snoozed
  // via a "dismiss" (which just pushes dismissedUntil out 3 days; the step
  // stays "skipped" until actually completed, at which point the server
  // clears it entirely and it stops showing up here).
  const pendingOnboardingSteps = useMemo(() => {
    // Real bug (2026-08-27), user-reported: on a fresh login, every
    // previously-skipped step briefly showed up here — even ones already
    // genuinely completed — then disappeared a moment later. Root cause:
    // this list is only as accurate as its "is this actually already done"
    // data-based fallback checks below (location/rewards/invite/calendar),
    // and those each read a SEPARATE query that can resolve later than
    // `onboardingStatus` itself. Until they've all settled, a step that's
    // truly done (e.g. a Parent PIN already set) still reads as "not done
    // yet" — since `rewardSettingsForReminder` is `undefined` while
    // loading, not the real object — so it flashed into the list and then
    // vanished the instant its own query caught up. Bailing out to `[]`
    // (show nothing) until every one of these has resolved is the fix: a
    // step legitimately still pending is only ever a few hundred ms late to
    // appear, which is unnoticeable, versus a completed one incorrectly
    // flashing in and out, which is exactly what was reported.
    if (!onboardingStatus || locationSettingsPending || rewardSettingsPending || familyInvitesPending) return [];
    const now = Date.now();
    const realProfileCount = profiles.filter((p) => !p.isAllFamilyProfile).length;
    return ONBOARDING_STEP_KEYS.filter((step) => {
      const statusKey = `${step === "you" ? "profile" : step}Status` as keyof OnboardingStatus;
      const dismissedKey = `${step === "you" ? "profile" : step}DismissedUntil` as keyof OnboardingStatus;
      if (onboardingStatus[statusKey] !== "skipped") return false;
      // The "skipped" flag only ever reflects the wizard's own Skip button —
      // it never gets cleared if the same data was later filled in some
      // other way (e.g. directly in Settings), so also check the real data
      // directly for the one step where that's easy to do.
      if (step === "location" && locationSettings?.city && locationSettings?.state) return false;
      // Same data-based fallback for "Add your photo & email": if a real
      // profile already has both, the step is de-facto done regardless of
      // whether it was completed inside the wizard.
      if (step === "you" && profiles.some((p) => !p.isAllFamilyProfile && p.photoUrl && p.email)) return false;
      // "Set up Rewards & Approvals": a Parent PIN is the one concrete thing
      // this step promises that isn't already pre-filled by the account's
      // auto-created defaults — if one's set, Rewards & Approvals has
      // genuinely been configured regardless of which screen did it.
      if (step === "rewards" && rewardSettingsForReminder?.hasParentPin) return false;
      // "Invite the rest of your family": the actual goal is "does the
      // family already have more than one person set up," not "did they
      // specifically use the invite feature" — a family that would rather
      // just add a spouse/kid as a profile in Settings → People, sharing
      // one login, shouldn't be nagged to send a formal invite they don't
      // want. So this counts as done once either a second real profile
      // exists (you + at least one other person), or an invite was sent —
      // whichever path the family actually took.
      if (step === "invite" && (realProfileCount >= 2 || familyInvitesForReminder.length > 0)) return false;
      // "Connect your calendars": done once ANY real profile already has a
      // Google or Outlook calendar connected — same signal Home's own "no
      // calendar connected yet" empty state uses.
      if (step === "calendar" && profiles.some((p) => !p.isAllFamilyProfile && (p.googleCalendarConnected || p.outlookCalendarConnected))) return false;
      if (DISMISS_SCOPE.finishSetup === "device") {
        const until = dismissedStepsLocal[step];
        return !until || until <= now;
      }
      const dismissedUntil = onboardingStatus[dismissedKey] as string | null;
      return !dismissedUntil || new Date(dismissedUntil).getTime() <= now;
    });
  }, [onboardingStatus, locationSettings, locationSettingsPending, profiles, rewardSettingsForReminder, rewardSettingsPending, familyInvitesForReminder, familyInvitesPending, dismissedStepsLocal]);

  const totalCount = notes.length + recentShoutouts.length + upcomingCelebrations.length + pendingOnboardingSteps.length + recentRedemptions.length + (pendingApprovalCount > 0 ? 1 : 0);
  // A deep-linked celebration (tapped push notification) must open even when
  // the banner itself would otherwise have nothing to show — e.g. a 30-day
  // reminder is well outside the banner's own 7-day display window.
  if (totalCount === 0 && !isSnoozed && !initialOpenCelebrationId && !openCelebrationId) return null;

  // ── Collapsed summary ─────────────────────────────────────────────────────────
  const summaryParts: string[] = [];
  if (notes.length > 0) {
    const assignedNames = [...new Set(
      notes
        .map((item) => (item.profileId && item.profileId !== allFamilyProfileId
          ? profileMap.get(item.profileId)?.name
          : null))
        .filter(Boolean)
    )];
    summaryParts.push(`📌 ${assignedNames.length > 0 ? assignedNames.join(", ") : "everyone"}`);
  }
  if (recentShoutouts.length > 0) {
    const names = [...new Set(recentShoutouts.map((s) => profileMap.get(s.toProfileId)?.name).filter(Boolean))];
    summaryParts.push(`👏 ${names.join(", ")}`);
  }
  if (upcomingCelebrations.length > 0) {
    summaryParts.push(`🎉 ${upcomingCelebrations.map(c => c.name).join(", ")}`);
  }
  if (pendingOnboardingSteps.length > 0) {
    summaryParts.push(`🧭 Finish setting up`);
  }
  if (pendingApprovalCount > 0) {
    summaryParts.push(`🎁 ${pendingApprovalCount} reward approval${pendingApprovalCount !== 1 ? "s" : ""} needed`);
  }

  // ── Shared name chip renderer ─────────────────────────────────────────────────
  const NameChip = ({ profileId }: { profileId: string }) => {
    const p = profileMap.get(profileId);
    if (!p) return null;
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium truncate">
        <span style={{ color: p.color }} className="text-[10px]">●</span>
        <span className="truncate">{p.name}</span>
      </span>
    );
  };

  const snoozeLabel = isSnoozed
    ? `Snoozed until ${format(new Date(snoozeUntil), "h:mm a")}`
    : null;

  // Nothing to show in the banner itself, but a deep-linked celebration is
  // pending — render just the dialog, not an otherwise-empty banner card.
  if (totalCount === 0 && !isSnoozed) {
    const celebration = openCelebrationId ? allCelebrations.find((c) => c.id === openCelebrationId) : null;
    const editingCelebration = editingCelebrationId ? allCelebrations.find((c) => c.id === editingCelebrationId) : null;
    if (editingCelebration) {
      return (
        <CelebrationFormDialog
          key={editingCelebration.id}
          celebration={editingCelebration}
          onClose={() => setEditingCelebrationId(null)}
        />
      );
    }
    if (!celebration) return null;
    return (
      <CelebrationDetailDialog
        celebration={celebration}
        onClose={() => setOpenCelebrationId(null)}
        onEdit={() => { setEditingCelebrationId(celebration.id); setOpenCelebrationId(null); }}
      />
    );
  }

  return (
    <Card className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">

      {/* ── Header / collapse toggle ─────────────────────────────────────────── */}
      <CardHeader
        className="p-4 border-b border-border bg-[#F2DDD3]/70 dark:bg-[#2e2825] cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          {isSnoozed
            ? <BellOff className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            : <Megaphone className="h-5 w-5 text-amber-600 flex-shrink-0" />
          }
          <span className="text-lg font-semibold text-foreground">Announcements</span>
          {!isSnoozed && (
            <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5 text-xs">{totalCount}</Badge>
          )}
          {/* Replaces the italic "Clears on this device only." line. The rule
              is about WHERE a dismissal lands, and a phone is that. Tapping
              it explains both glyphs in this header — a title tooltip never
              appears on touch, which is where this app mostly runs.
              stopPropagation because the whole header row toggles collapse. */}
          {ANY_DEVICE_SCOPED && !isSnoozed && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setGlyphHelp((v) => !v); }}
              className={`p-1 -m-1 rounded transition-colors shrink-0 ${glyphHelp ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="What do these icons mean?"
              aria-expanded={glyphHelp}
              data-testid="announcements-device-scope-icon"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          )}

          {/* "Snoozed until 11:30 PM" doesn't fit on one phone-width row
              beside the title, and truncating it cut the time off — which is
              the only part that carries information. It gets its own row
              below instead. */}
          {isSnoozed ? (
            <span className="flex-1" />
          ) : collapsed && (
            <span className="flex-1 text-xs text-muted-foreground truncate ml-1">
              {summaryParts.join(" · ")}
            </span>
          )}

          {/* Snooze dropdown — stop propagation so it doesn't toggle collapse */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Snooze announcements"
                onClick={(e) => e.stopPropagation()}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  isSnoozed
                    ? "text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                {isSnoozed ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              {isSnoozed ? (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">{snoozeLabel}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={unsnooze} className="gap-2 cursor-pointer">
                    <BellRing className="h-4 w-4 text-amber-500" />
                    Unsnooze now
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel className="text-xs">Snooze for…</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => snooze(60)} className="cursor-pointer">60 minutes</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snooze(120)} className="cursor-pointer">2 hours</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snooze(24 * 60)} className="cursor-pointer">1 day</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="flex-shrink-0 text-muted-foreground">
            {collapsed || isSnoozed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </span>
        </div>

        {isSnoozed && (
          <p className="text-xs text-muted-foreground mt-1.5" data-testid="announcements-snooze-until">{snoozeLabel}</p>
        )}

        {/* Sits under the title row rather than floating over it, so it can't
            cover the count or the snooze button. stopPropagation: a tap
            anywhere in this header otherwise collapses the banner. */}
        {glyphHelp && (
          <div
            className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
            data-testid="announcements-glyph-help"
          >
            <span className="flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              Ticking things off here only clears them on this device.
            </span>
            <span className="flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 shrink-0" />
              Snooze the whole banner for a while.
            </span>
          </div>
        )}
      </CardHeader>

      {/* ── Expanded body ────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {!collapsed && !isSnoozed && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <CardContent className="p-4 space-y-4">

              {/* ── Notes ── */}
              {notes.length > 0 && (
                <AnnouncementSection
                  id="announcements-notes-section"
                  icon={<StickyNote className="h-3.5 w-3.5 text-amber-500" />}
                  label="Notes"
                  accentClass="border-amber-400"
                  >
                  <AnimatePresence>
                    {notes.map((item) => {
                      const isEveryone = item.profileId === null || item.profileId === allFamilyProfileId;
                      return (
                        <AnnouncementRow
                          key={item.key}
                          id={item.key}
                          onDismiss={(key) => dismissNote(key, item.profileId)}
                          nameEl={
                            isEveryone ? (
                              <span className="text-xs text-muted-foreground italic">Everyone</span>
                            ) : (
                              <NameChip profileId={item.profileId!} />
                            )
                          }
                          contentEl={(() => {
                            const note = item.note;
                            const eventId = note.reference?.startsWith("event:")
                              ? note.reference.slice(6)
                              : null;
                            // Notes are created with a hardcoded title of
                            // "Note" (the real text goes in `content`), so
                            // rendering the title printed the word "Note"
                            // above every note — directly under a section
                            // already headed NOTES. Only shown when it is a
                            // real title someone actually typed.
                            const genericTitle = (note.title ?? "").trim().toLowerCase() === "note";
                            return (
                              <div>
                                {!genericTitle && (
                                  <p className="text-sm font-medium leading-snug">{note.title}</p>
                                )}
                                {note.content && (
                                  <p className={genericTitle
                                    ? "text-sm leading-snug"
                                    : "text-xs text-muted-foreground mt-0.5 leading-snug"}>{note.content}</p>
                                )}
                                {eventId && onNavigateToEvent && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onNavigateToEvent(eventId); }}
                                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 hover:underline transition-colors"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    View event
                                  </button>
                                )}
                                {/* Same place and same shape as Praise's:
                                    under the content, no parentheses. */}
                                <p className="text-xs text-muted-foreground mt-0.5" data-testid="note-from">
                                  from{" "}
                                  <span className="font-medium">{authorLabel(item.note)}</span>
                                </p>
                              </div>
                            );
                          })()}
                        />
                      );
                    })}
                  </AnimatePresence>
                </AnnouncementSection>
              )}

              {/* ── Praise / Shoutouts ── */}
              {recentShoutouts.length > 0 && (
                <AnnouncementSection
                  id="announcements-praise-section"
                  icon={<span className="text-sm leading-none">👏</span>}
                  label="Praise"
                  accentClass="border-violet-400"
                  >
                  <AnimatePresence>
                    {recentShoutouts.map((s) => {
                      const from = profileMap.get(s.fromProfileId);
                      return (
                        <AnnouncementRow
                          key={s.id}
                          id={s.id}
                          onDismiss={dismissShoutout}
                          nameEl={<NameChip profileId={s.toProfileId} />}
                          contentEl={
                            <div>
                              <p className="text-sm leading-snug">
                                <span className="mr-1">{s.emoji}</span>
                                {s.message}
                              </p>
                              {from && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  from{" "}
                                  <span style={{ color: from.color }} className="font-medium">
                                    {from.name}
                                  </span>
                                </p>
                              )}
                            </div>
                          }
                        />
                      );
                    })}
                  </AnimatePresence>
                </AnnouncementSection>
              )}

              {/* ── Celebrations ── */}
              {upcomingCelebrations.length > 0 && (
                <AnnouncementSection
                  icon={<PartyPopper className="h-3.5 w-3.5 text-pink-500" />}
                  label="Celebrations"
                  accentClass="border-pink-400"
                  caption="Checking one off brings it back closer to the day, not until next year."
                  >
                  <AnimatePresence>
                    {upcomingCelebrations.map((c) => {
                      const profile = c.profileId ? profileMap.get(c.profileId) : null;
                      const photo = c.photos[0];
                      const countdown = c.daysUntil === 0 ? "Today!" : c.daysUntil === 1 ? "Tomorrow" : `In ${c.daysUntil} days`;
                      return (
                        <AnnouncementRow
                          key={c.id}
                          id={c.id}
                          onDismiss={(id) => dismissCelebration(id, c.daysUntil)}
                          nameEl={profile ? <NameChip profileId={profile.id} /> : (
                            <span className="text-xs text-muted-foreground italic">
                              {(TYPE_META[c.type] ?? TYPE_META.other).label}
                            </span>
                          )}
                          contentEl={
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenCelebrationId(c.id); }}
                              className="flex items-center gap-2 text-left w-full hover:opacity-80 transition-opacity"
                            >
                              {photo && (
                                <img
                                  src={objectUrl(photo.imageUrl)}
                                  alt=""
                                  className="w-8 h-8 rounded-md object-cover shrink-0"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-medium leading-snug truncate">{c.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{countdown}</p>
                              </div>
                            </button>
                          }
                        />
                      );
                    })}
                  </AnimatePresence>
                </AnnouncementSection>
              )}

              {/* ── Finish setting up (skipped onboarding steps) ── */}
              {pendingOnboardingSteps.length > 0 && (
                <AnnouncementSection
                  icon={<Compass className="h-3.5 w-3.5 text-teal-500" />}
                  label="Finish setting up"
                  accentClass="border-teal-400"
                  caption={DISMISS_SCOPE.finishSetup === "device" ? "Snoozes on this device for 3 days." : undefined}
                >
                  <AnimatePresence>
                    {pendingOnboardingSteps.map((step) => {
                      const meta = ONBOARDING_STEP_META[step];
                      return (
                        <AnnouncementRow
                          key={step}
                          id={step}
                          onDismiss={() => dismissOnboardingStep(step)}
                          nameEl={<span className="text-xs text-muted-foreground italic">Setup</span>}
                          contentEl={
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm leading-snug">
                                <span className="mr-1">{meta.emoji}</span>
                                {meta.label}
                              </p>
                              {onReplayOnboarding && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onReplayOnboarding(step); }}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline shrink-0"
                                >
                                  Finish now
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          }
                        />
                      );
                    })}
                  </AnimatePresence>
                </AnnouncementSection>
              )}

              {/* ── Reward Approvals ── */}
              {pendingApprovalCount > 0 && (
                <AnnouncementSection
                  icon={<Gift className="h-3.5 w-3.5 text-purple-500" />}
                  label="Rewards"
                  accentClass="border-purple-400"
                >
                  {/* Reward suggestions and cash-outs are two different
                      queues in two different cards — one link each, so the
                      link lands on the card that actually holds the thing
                      being approved. */}
                  {pendingWishlist.length > 0 && (
                    <div className="flex items-start justify-between gap-3 py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">
                          {pendingWishlist.length === 1
                            ? "1 reward suggestion to review"
                            : `${pendingWishlist.length} reward suggestions to review`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Someone suggested a new reward for the family
                        </p>
                      </div>
                      {onNavigateToRewardSuggestions && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onNavigateToRewardSuggestions(); }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline flex-shrink-0 mt-0.5"
                        >
                          Reward Suggestions
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {pendingCashouts.length > 0 && (
                    <div className="flex items-start justify-between gap-3 py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">
                          {pendingCashouts.length === 1
                            ? "1 cash-out to approve"
                            : `${pendingCashouts.length} cash-outs to approve`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Trading stars in for real money
                        </p>
                      </div>
                      {onNavigateToParentControls && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onNavigateToParentControls(); }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline flex-shrink-0 mt-0.5"
                        >
                          Cash-Out Approvals
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </AnnouncementSection>
              )}

              {/* ── Redeemed Rewards (heads-up for admins) ── */}
              {recentRedemptions.length > 0 && (
                <AnnouncementSection
                  icon={<Gift className="h-3.5 w-3.5 text-amber-500" />}
                  label="Redeemed"
                  accentClass="border-amber-400"
                  >
                  <AnimatePresence>
                    {recentRedemptions.map((r) => {
                      const profile = profileMap.get(r.profileId);
                      const reward = rewardById.get(r.rewardId);
                      return (
                        <AnnouncementRow
                          key={r.id}
                          id={r.id}
                          onDismiss={dismissRedemption}
                          nameEl={profile ? <NameChip profileId={profile.id} /> : (
                            <span className="text-xs text-muted-foreground italic">Someone</span>
                          )}
                          contentEl={
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-snug truncate">
                                Redeemed {reward?.title ?? "a reward"}
                                {reward ? ` · ${reward.pointsCost} ⭐` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {r.when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </p>
                            </div>
                          }
                        />
                      );
                    })}
                  </AnimatePresence>
                </AnnouncementSection>
              )}

            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>

      {openCelebrationId && (() => {
        const celebration = allCelebrations.find((c) => c.id === openCelebrationId);
        if (!celebration) return null;
        return (
          <CelebrationDetailDialog
            celebration={celebration}
            onClose={() => setOpenCelebrationId(null)}
            onEdit={() => { setEditingCelebrationId(celebration.id); setOpenCelebrationId(null); }}
          />
        );
      })()}

      {editingCelebrationId && (() => {
        const celebration = allCelebrations.find((c) => c.id === editingCelebrationId);
        if (!celebration) return null;
        return (
          <CelebrationFormDialog
            key={celebration.id}
            celebration={celebration}
            onClose={() => setEditingCelebrationId(null)}
          />
        );
      })()}
    </Card>
  );
}
