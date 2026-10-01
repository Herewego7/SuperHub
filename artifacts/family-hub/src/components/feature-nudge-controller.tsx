import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FeatureNudgeSheet, type FeatureNudgeId } from "@/components/feature-nudge-sheet";
import type { Profile, User } from "@workspace/shared-types";

const STORAGE_KEY = "familyHub_featureNudgeShownAt";
const MIN_ACCOUNT_AGE_DAYS = 14;
// Once shown, don't show again for a long while (it's a one-time-ish nudge,
// not a recurring notice) — a fresh account age gate already keeps this from
// firing too early; this just stops it from repeating every session after.
const RESHOW_AFTER_DAYS = 365;

// Preferred order: the three cards shown in the original mockup come first;
// the other three are substitutes for whichever of the first three turns out
// to already be set up for this family.
const PRIORITY_ORDER: FeatureNudgeId[] = [
  "notifications",
  "todos",
  "starInsights",
  "perPerson",
  "shareLinks",
  "mealIdeas",
];

interface FeatureNudgeControllerProps {
  user: User | null | undefined;
  profiles: Profile[];
  hiddenTabs: Set<string>;
  starInsightsHidden: boolean;
  onOpenNotifications: () => void;
  onOpenTodosTab: () => void;
  onOpenStarInsights: () => void;
  onOpenPerPersonSettings: () => void;
  onOpenShareLinks: () => void;
  onOpenMealIdeas: () => void;
}

export function FeatureNudgeController({
  user,
  profiles,
  hiddenTabs,
  starInsightsHidden,
  onOpenNotifications,
  onOpenTodosTab,
  onOpenStarInsights,
  onOpenPerPersonSettings,
  onOpenShareLinks,
  onOpenMealIdeas,
}: FeatureNudgeControllerProps) {
  const [open, setOpen] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  const accountCreatedAt = user?.createdAt ? new Date(user.createdAt) : null;
  const accountAgeDays = accountCreatedAt
    ? (Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const eligibleByAge = accountAgeDays >= MIN_ACCOUNT_AGE_DAYS;
  const onboardingDone = !!user?.onboardingCompletedAt;

  // Only fetch these once we're actually eligible to show something — no
  // point spending network calls on every load for a feature that mostly
  // won't fire.
  const shouldFetch = eligibleByAge && onboardingDone && !dismissedThisSession;

  const { data: webSubs } = useQuery<any[]>({
    queryKey: ["/api/push/subscriptions"],
    queryFn: async () => (await apiRequest("GET", "/api/push/subscriptions")).json(),
    enabled: shouldFetch,
  });
  const { data: nativeTokens } = useQuery<any[]>({
    queryKey: ["/api/push/native-tokens"],
    queryFn: async () => (await apiRequest("GET", "/api/push/native-tokens")).json(),
    enabled: shouldFetch,
  });
  const { data: shareTokens } = useQuery<any[]>({
    queryKey: ["/api/share-tokens"],
    queryFn: async () => (await apiRequest("GET", "/api/share-tokens")).json(),
    enabled: shouldFetch,
  });
  const { data: savedMeals } = useQuery<any[]>({
    queryKey: ["/api/saved-meals"],
    queryFn: async () => (await apiRequest("GET", "/api/saved-meals")).json(),
    enabled: shouldFetch,
  });

  const eligibleCards = useMemo(() => {
    if (!shouldFetch) return [];
    const devices = [...(webSubs ?? []), ...(nativeTokens ?? [])];
    const hasEveryoneDevice = devices.some((d) => !d.profileId);
    const realProfiles = profiles.filter((p) => p.id !== "all-family");
    const coveredProfileIds = new Set(devices.map((d) => d.profileId).filter(Boolean));
    const everyoneCovered =
      hasEveryoneDevice || (realProfiles.length > 0 && realProfiles.every((p) => coveredProfileIds.has(p.id)));
    const notificationsDone = devices.length > 0 && everyoneCovered;

    const todosDone = !hiddenTabs.has("todos");
    const starInsightsDone = !starInsightsHidden;
    const perPersonDone = realProfiles.some((p) => p.bedtimeCutoff || p.dailyBriefTime);
    const shareLinksDone = (shareTokens?.length ?? 0) > 0;
    const mealIdeasDone = (savedMeals?.length ?? 0) > 0;

    const doneMap: Record<FeatureNudgeId, boolean> = {
      notifications: notificationsDone,
      todos: todosDone,
      starInsights: starInsightsDone,
      perPerson: perPersonDone,
      shareLinks: shareLinksDone,
      mealIdeas: mealIdeasDone,
    };

    const notDone = PRIORITY_ORDER.filter((id) => !doneMap[id]);
    return notDone.slice(0, 3);
  }, [shouldFetch, webSubs, nativeTokens, profiles, hiddenTabs, starInsightsHidden, shareTokens, savedMeals]);

  useEffect(() => {
    if (dismissedThisSession || open) return;
    if (eligibleCards.length === 0) return;
    let lastShown: number | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      lastShown = raw ? parseInt(raw, 10) : null;
    } catch {
      // localStorage unavailable — treat as never shown
    }
    const daysSinceShown = lastShown ? (Date.now() - lastShown) / (1000 * 60 * 60 * 24) : Infinity;
    if (daysSinceShown < RESHOW_AFTER_DAYS) return;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleCards.length, dismissedThisSession, open]);

  const dismiss = () => {
    setOpen(false);
    setDismissedThisSession(true);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  const handleAction = (id: FeatureNudgeId) => {
    dismiss();
    switch (id) {
      case "notifications":
        onOpenNotifications();
        break;
      case "todos":
        onOpenTodosTab();
        break;
      case "starInsights":
        onOpenStarInsights();
        break;
      case "perPerson":
        onOpenPerPersonSettings();
        break;
      case "shareLinks":
        onOpenShareLinks();
        break;
      case "mealIdeas":
        onOpenMealIdeas();
        break;
    }
  };

  return <FeatureNudgeSheet open={open} cards={eligibleCards} onDismiss={dismiss} onAction={handleAction} />;
}
