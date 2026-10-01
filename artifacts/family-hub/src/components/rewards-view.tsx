import { useMemo, useState, useRef, useEffect } from "react";
import { objectUrl } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { Profile, Reward, RewardRedemption, ChoreCompletion, WishlistItem, RewardSettings } from "@workspace/shared-types";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { hapticSuccess } from "@/lib/haptics";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { showUpgradeDialog } from "@/lib/upgradeDialog";
import { Plus, Gift, Star, Sparkles, Lightbulb, ListChecks, CheckCircle2, XCircle, Send, Lock, Unlock, ShieldCheck } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "framer-motion";
import { WishlistView } from "./wishlist-view";
import { EmojiPicker } from "./EmojiPicker";
import { RewardManagementDrawer } from "./reward-management-drawer";
import { useParentGate, isKidContext } from "@/lib/parentGate";
import { useTriggerEffect } from "@/lib/useTriggerEffect";
import { useSpotlight } from "@/lib/spotlight";

interface RewardsViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  /** When true, hide the view's own page title and action toolbar — card header owns them. */
  embedded?: boolean;
  /** Increment to programmatically open the Add Reward dialog. */
  triggerAdd?: number;
  /** Increment to programmatically open the Manage Rewards drawer. */
  triggerManage?: number;
  /** Increment to programmatically open the parent PIN unlock dialog. */
  triggerParentUnlock?: number;
  /** Called right after a nonzero triggerParentUnlock has been acted on, so
   *  the caller can reset it back to 0 — see the comment above its effect
   *  below for why this one can't use the shared useTriggerEffect pattern. */
  onParentUnlockTriggerHandled?: () => void;
}

const REWARD_ICONS = [
  { icon: "🎮", label: "Gaming" },
  { icon: "🍕", label: "Pizza" },
  { icon: "🎬", label: "Movie" },
  { icon: "🍦", label: "Ice Cream" },
  { icon: "🎁", label: "Gift" },
  { icon: "⭐", label: "Star" },
  { icon: "🎈", label: "Party" },
  { icon: "🏆", label: "Trophy" },
  { icon: "🎉", label: "Celebration" },
  { icon: "💎", label: "Diamond" },
  { icon: "🌟", label: "Glow Star" },
  { icon: "🎯", label: "Target" },
];

const WISHLIST_ICONS = ["🎁", "🎮", "🍕", "🎬", "🍦", "⭐", "🎈", "🏆", "🎉", "💎", "🌟", "🎯"];

export function RewardsView({ selectedProfiles, profiles, embedded = false, triggerAdd = 0, triggerManage = 0, triggerParentUnlock = 0, onParentUnlockTriggerHandled }: RewardsViewProps) {
  const { toast } = useToast();
  const { guard: guardParentAction, gateDialog: parentGateDialog } = useParentGate(profiles, selectedProfiles);
  // On a kid's own screen the PIN-gated Cash-Out Approvals card rendered
  // above Cash Out Stars, so the first thing they saw was a card they can't
  // use. Collapsed by default in that context (it stays expanded for a
  // parent, and is still reachable — just not leading the screen).
  const kidContext = isKidContext(profiles, selectedProfiles);
  const [showAddReward, setShowAddReward] = useState(false);
  // Every "open Add Reward" entry point routes through this so creating a
  // reward is PIN-gated in one place, not at each trigger.
  const openAddReward = () => guardParentAction("createReward", () => setShowAddReward(true));
  const [showManageDrawer, setShowManageDrawer] = useState(false);
  const [newReward, setNewReward] = useState<{
    title: string;
    description: string;
    pointsCost: number | "";
    icon: string;
    scopeProfileId: string;
  }>({
    title: "",
    description: "",
    pointsCost: 100,
    icon: "🎁",
    scopeProfileId: "",
  });
  const [celebratingRewardId, setCelebratingRewardId] = useState<string | null>(null);
  const [redeemingRewardId, setRedeemingRewardId] = useState<string | null>(null);
  const [recentlyRedeemed, setRecentlyRedeemed] = useState<Set<string>>(new Set());

  // Same multi-burst confetti finale used elsewhere in the app (e.g. finishing
  // all chores) for the moment of redemption/cash-out — the small pulsing
  // sparkle icons on the reward card alone read as underwhelming for this.
  const fireRedeemConfetti = () => {
    hapticSuccess();
    confetti({ particleCount: 120, spread: 80, origin: { x: 0.5, y: 0.55 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 45, gravity: 0.9, ticks: 200 });
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], startVelocity: 50, ticks: 180 }), 150);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'], startVelocity: 50, ticks: 180 }), 300);
    setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { x: 0.5, y: 0.3 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 20, gravity: 1.2, ticks: 250 }), 500);
  };

  const profileOvalRefs = useRef<Map<string, HTMLElement>>(new Map());
  const rewardCardRefs  = useRef<Map<string, HTMLElement>>(new Map());

  type StarParticle = {
    id: string;
    originX: number; originY: number;
    destX: number;   destY: number;
    delay: number;
    size: number;
    duration: number;
    arcOffX: number;
    arcHeight: number;
  };
  const [starParticles, setStarParticles] = useState<StarParticle[]>([]);

  const triggerRedemptionStars = (profileId: string, rewardId: string, pointsCost: number) => {
    const profileEl = profileOvalRefs.current.get(profileId);
    const rewardEl  = rewardCardRefs.current.get(rewardId);
    if (!profileEl || !rewardEl) return;

    const pr = profileEl.getBoundingClientRect();
    const rr = rewardEl.getBoundingClientRect();
    const originX = pr.left + pr.width  / 2;
    const originY = pr.top  + pr.height / 2;
    const destX   = rr.left + rr.width  / 2;
    const destY   = rr.top  + rr.height / 2;

    const count = Math.min(16, Math.max(8, Math.round(pointsCost / 80)));

    const particles: StarParticle[] = Array.from({ length: count }, (_, i) => ({
      id: `rstar-${Date.now()}-${i}`,
      originX: originX + (Math.random() - 0.5) * 28,
      originY: originY + (Math.random() - 0.5) * 18,
      destX:   destX   + (Math.random() - 0.5) * 36,
      destY:   destY   + (Math.random() - 0.5) * 28,
      delay:      i * 0.09 + Math.random() * 0.08,
      size:       14 + Math.floor(Math.random() * 14),
      duration:   1.8 + Math.random() * 0.8,
      arcOffX:    (Math.random() - 0.5) * 60,
      arcHeight:  60 + Math.random() * 80,
    }));

    setStarParticles(particles);
    const maxEnd = Math.max(...particles.map(p => p.delay + p.duration));
    setTimeout(() => setStarParticles([]), (maxEnd + 0.4) * 1000);
  };

  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [editFormData, setEditFormData] = useState<{
    title: string;
    description: string;
    pointsCost: number | "";
    icon: string;
    scopeProfileId: string;
  }>({
    title: "",
    description: "",
    pointsCost: 100,
    icon: "🎁",
    scopeProfileId: "",
  });
  const [starburstProfile, setStarburstProfile] = useState<string | null>(null);

  // Cashout slider state (in cents, $0.25 steps)
  const [cashoutCents, setCashoutCents] = useState(25);
  const [cashoutRequested, setCashoutRequested] = useState(false);

  // Wishlist request form state
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showAllRequests, setShowAllRequests] = useState(false);

  // Parent PIN state
  const [parentUnlocked, setParentUnlocked] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  // Briefly scrolled-to + highlighted right after unlocking — someone who
  // deep-linked straight here from an Announcements "approve this" nudge has
  // never seen this section before, so it wasn't obvious anything had
  // appeared once they entered their PIN.
  const [justUnlocked, setJustUnlocked] = useState(false);
  const parentControlsRef = useRef<HTMLDivElement>(null);
  const { spotlight, spotlightOverlay } = useSpotlight();
  const [pinError, setPinError] = useState("");
  const [requestForm, setRequestForm] = useState({
    title: "",
    description: "",
    link: "",
    suggestedPriceCoins: 50,
    submittedByProfileId: "",
  });

  // useTriggerEffect (not a raw `if (trigger > 0)` effect): a remount with a
  // stale nonzero counter — e.g. after reordering cards in Customize Tasks
  // Page, which changes this component's position and remounts it — would
  // otherwise spuriously reopen the add dialog / drawer / PIN prompt.
  useTriggerEffect(triggerAdd, openAddReward);
  useTriggerEffect(triggerManage, () => setShowManageDrawer(v => !v));
  // triggerParentUnlock deliberately does NOT use useTriggerEffect. That
  // hook exists to ignore a stale nonzero counter already present at mount
  // (so an unrelated remount doesn't spuriously reopen something) — but the
  // Announcements banner's "reward approvals" link needs the OPPOSITE: it
  // navigates to this tab and increments the trigger in the very same
  // render, so RewardsView is mounting for the FIRST time with the trigger
  // ALREADY at its incremented value. useTriggerEffect's mount-time ref
  // would see that as "no change" and never open the PIN dialog — leaving
  // the user on the Chores tab with no indication they still need to tap
  // Unlock. Fixed by firing whenever the trigger is nonzero (mount included)
  // and telling the parent to reset it back to 0 once handled, so a later,
  // ordinary visit to this tab (trigger already 0) can't re-fire it.
  useEffect(() => {
    if (triggerParentUnlock > 0) {
      setPinInput("");
      setPinError("");
      setShowPinDialog(true);
      onParentUnlockTriggerHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerParentUnlock]);

  const { data: rewards = [], isLoading: rewardsLoading } = useQuery<Reward[]>({
    queryKey: ["/api/rewards"],
  });

  const { data: redemptions = [] } = useQuery<RewardRedemption[]>({
    queryKey: ["/api/reward-redemptions"],
  });

  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  const { data: wishlistItems = [] } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist-items"],
  });

  const { data: rewardSettingsData } = useQuery<RewardSettings>({
    queryKey: ["/api/reward-settings"],
  });

  interface PendingCashout {
    id: string;
    profileId: string;
    requestedPoints: number;
    requestedCents: number;
    note: string | null;
    createdAt: string;
  }
  const { data: pendingCashouts = [] } = useQuery<PendingCashout[]>({
    queryKey: ["/api/wallet/pending"],
    enabled: parentUnlocked,
  });

  const redemptionMode = rewardSettingsData?.redemptionMode ?? "both";
  const centsPerPoint = rewardSettingsData?.centsPerPoint ?? 0;
  const currencySymbol = rewardSettingsData?.currencySymbol ?? "$";
  const showRewardCatalog = redemptionMode !== "cashout_only";
  const showCashoutSection = redemptionMode !== "rewards_only";

  const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);

  // per_completion mode: a profile's spendable points come from the backend
  // total (which includes the daily completion bonus), not a client sum of
  // per-chore completion points (which are 0 in that mode).
  const perCompletionMode = rewardSettingsData?.pointsMode === "per_completion";
  // Always read the server's authoritative balance (it subtracts redeemed
  // rewards and includes bonuses/adjustments) — a client-side sum of
  // completions shows earned-not-spent, so redeeming never visibly lowered
  // the count in per_chore mode. Client sum remains only as a first-paint
  // fallback while the query loads.
  const backendPointsQueries = useQueries({
    queries: regularProfiles.map(p => ({
      queryKey: ["/api/points", p.id],
      staleTime: 15_000,
    })),
  });
  const backendPointsMap = new Map<string, number | undefined>(
    regularProfiles.map((p, i) => [p.id, (backendPointsQueries[i]?.data as { points?: number } | undefined)?.points]),
  );

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const pendingWishlistItems = wishlistItems.filter(w => w.status === "pending");

  const profilePoints = regularProfiles
    .filter(p => selectedProfiles.length === 0 || selectedProfiles.includes(p.id))
    .map(profile => {
      const profileCompletions = choreCompletions.filter(c => c.profileId === profile.id);
      const clientSum = profileCompletions.reduce((sum, c) => sum + (c.points || 0), 0);
      const totalPoints = backendPointsMap.get(profile.id) ?? clientSum;
      return { profile, points: totalPoints };
    });

  // Single selected non-all-family profile
  const singleSelectedProfile = useMemo(() => {
    const nonAll = selectedProfiles.filter(id => {
      const p = profiles.find(prof => prof.id === id);
      return p && !p.isAllFamilyProfile;
    });
    if (nonAll.length !== 1) return null;
    return profiles.find(p => p.id === nonAll[0]) ?? null;
  }, [selectedProfiles, profiles]);

  const singleProfilePoints = useMemo(() => {
    if (!singleSelectedProfile) return 0;
    return profilePoints.find(pp => pp.profile.id === singleSelectedProfile.id)?.points ?? 0;
  }, [singleSelectedProfile, profilePoints]);

  // Net points the server will allow cashing out (deducts previously approved cashouts)
  const { data: walletData } = useQuery<{ availablePoints: number } | null>({
    queryKey: ["/api/wallet", singleSelectedProfile?.id],
    enabled: !!singleSelectedProfile,
  });
  const availableForCashout = walletData?.availablePoints ?? singleProfilePoints;

  // Initialize request form submitter to single selected profile
  useEffect(() => {
    if (singleSelectedProfile && !requestForm.submittedByProfileId) {
      setRequestForm(f => ({ ...f, submittedByProfileId: singleSelectedProfile.id }));
    }
  }, [singleSelectedProfile]);

  const createRewardMutation = useMutation({
    mutationFn: async (rewardData: typeof newReward) => {
      return await apiRequest("POST", "/api/rewards", {
        ...rewardData,
        scopeProfileId: rewardData.scopeProfileId && rewardData.scopeProfileId !== "everyone" ? rewardData.scopeProfileId : null,
      });
    },
    onSuccess: async () => {
      // Await before closing (same fix as bonus chores): closing while the
      // list refetch is still in flight made the new reward appear to vanish
      // on a slow connection, inviting a duplicate resubmit.
      await queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      setShowAddReward(false);
      setNewReward({ title: "", description: "", pointsCost: 100, icon: "🎁", scopeProfileId: "" });
      toast({ title: "Reward created!", description: "New reward added successfully." });
    },
    onError: (err: any) => toast({ title: "Couldn't create reward", description: err?.message ?? "Please try again.", variant: "destructive" }),
  });

  const updateRewardMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editFormData }) => {
      return await apiRequest("PATCH", `/api/rewards/${id}`, {
        ...data,
        scopeProfileId: data.scopeProfileId && data.scopeProfileId !== "everyone" ? data.scopeProfileId : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      setEditingReward(null);
      toast({ title: "Reward updated!", description: "Changes saved successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const deleteRewardMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/rewards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      toast({ title: "Reward deleted", description: "The reward has been removed." });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const redeemRewardMutation = useMutation({
    mutationFn: async ({ rewardId, profileId }: { rewardId: string; profileId: string }) => {
      return await apiRequest("POST", "/api/reward-redemptions", {
        rewardId,
        profileId,
        status: "redeemed",
        redeemedAt: new Date().toISOString(),
      });
    },
    onSuccess: (_, { rewardId, profileId }) => {
      fireRedeemConfetti();
      queryClient.invalidateQueries({ queryKey: ["/api/reward-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      // Redeeming now spends points (server debits the shared balance), so the
      // star pills and cash-out availability must refresh too — otherwise they
      // show the pre-redemption total until a manual reload.
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
      setCelebratingRewardId(rewardId);
      setRedeemingRewardId(null);
      setTimeout(() => setCelebratingRewardId(null), 3000);
      const key = `${rewardId}-${profileId}`;
      setRecentlyRedeemed(prev => new Set([...prev, key]));
      setTimeout(() => {
        setRecentlyRedeemed(prev => { const n = new Set(prev); n.delete(key); return n; });
      }, 5000);
      toast({ title: "Reward Redeemed!", description: "Waiting for a parent's approval." });
    },
    onError: (error: any) => {
      setRedeemingRewardId(null);
      if (error?.code === "subscription_required") {
        showUpgradeDialog();
        return;
      }
      let errorMessage = "Please try again.";
      if (error?.message) {
        try {
          const jsonMatch = error.message.match(/\{.*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            errorMessage = parsed.message || errorMessage;
          } else {
            errorMessage = error.message;
          }
        } catch {
          errorMessage = error.message;
        }
      }
      toast({ title: "Could not redeem reward", description: errorMessage, variant: "destructive" });
    },
  });

  const cashoutMutation = useMutation({
    mutationFn: async ({ profileId, points, cents }: { profileId: string; points: number; cents: number }) =>
      (await apiRequest("POST", `/api/wallet/${profileId}/request-cashout`, { points, cents })).json(),
    // Optimistic: the request shows up in Parent Controls / Announcements and
    // the star balance drops the instant the button is tapped, instead of the
    // button hanging on "Requesting…" until a possibly-slow server round-trip
    // returns (which is what left it stuck for minutes). Rolled back on error.
    onMutate: async ({ profileId, points, cents }) => {
      setCashoutRequested(true);
      fireRedeemConfetti();
      await queryClient.cancelQueries({ queryKey: ["/api/wallet/pending"] });
      await queryClient.cancelQueries({ queryKey: ["/api/points", profileId] });
      await queryClient.cancelQueries({ queryKey: ["/api/wallet", profileId] });
      const prevPending = queryClient.getQueryData<any[]>(["/api/wallet/pending"]);
      const prevPoints = queryClient.getQueryData<any>(["/api/points", profileId]);
      const prevWallet = queryClient.getQueryData<any>(["/api/wallet", profileId]);
      const tempId = `temp-cashout-${Date.now()}`;
      queryClient.setQueryData<any[]>(["/api/wallet/pending"], (old = []) => [
        ...old,
        { id: tempId, profileId, requestedPoints: points, requestedCents: cents, note: null, createdAt: new Date().toISOString() },
      ]);
      queryClient.setQueryData<any>(["/api/points", profileId], (old: any) =>
        old ? { ...old, points: Math.max(0, (old.points ?? 0) - points) } : old);
      queryClient.setQueryData<any>(["/api/wallet", profileId], (old: any) =>
        old ? { ...old, availablePoints: Math.max(0, (old.availablePoints ?? 0) - points) } : old);
      return { prevPending, prevPoints, prevWallet, profileId };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData(["/api/wallet/pending"], ctx.prevPending);
        queryClient.setQueryData(["/api/points", ctx.profileId], ctx.prevPoints);
        queryClient.setQueryData(["/api/wallet", ctx.profileId], ctx.prevWallet);
      }
      setCashoutRequested(false);
      if (e?.code === "subscription_required") {
        showUpgradeDialog();
        return;
      }
      toast({ title: e?.message ?? "Couldn't request cash out", variant: "destructive" });
    },
    onSuccess: () => {
      setTimeout(() => setCashoutRequested(false), 4000);
      toast({ title: "Cash-out requested!", description: "A parent will approve it shortly." });
    },
    // Reconcile with the server's real numbers (the temp entry is replaced by
    // the real pending row; points/available settle to the authoritative total).
    onSettled: (_d, _e, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/points", vars.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet", vars.profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
    },
  });

  const submitRequestMutation = useMutation({
    mutationFn: async () =>
      await apiRequest("POST", "/api/wishlist-items", {
        title: requestForm.title.trim(),
        description: requestForm.description.trim() || null,
        link: requestForm.link.trim() || null,
        suggestedPriceCoins: requestForm.suggestedPriceCoins,
        submittedByProfileId: requestForm.submittedByProfileId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      toast({ title: "Reward suggestion sent!", description: "A parent will review it soon." });
      setShowRequestForm(false);
      setRequestForm(f => ({ ...f, title: "", description: "", link: "", suggestedPriceCoins: 50 }));
    },
    onError: () => toast({ title: "Couldn't submit request", variant: "destructive" }),
  });

  const approveWishlistMutation = useMutation({
    mutationFn: async (item: WishlistItem) =>
      await apiRequest("POST", `/api/wishlist-items/${item.id}/approve`, {
        finalPriceCoins: item.suggestedPriceCoins,
        icon: "🎁",
        scopeProfileId: null,
        inventoryCap: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      toast({ title: "Request approved!", description: "Added to the rewards gallery." });
    },
    onError: () => toast({ title: "Couldn't approve", variant: "destructive" }),
  });

  const declineWishlistMutation = useMutation({
    mutationFn: async (id: string) =>
      await apiRequest("POST", `/api/wishlist-items/${id}/decline`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      toast({ title: "Request declined" });
    },
    onError: () => toast({ title: "Couldn't decline", variant: "destructive" }),
  });

  const verifyPinMutation = useMutation({
    mutationFn: async (pin: string) =>
      (await apiRequest("POST", "/api/reward-settings/verify-pin", { pin })).json(),
    onSuccess: (data: { ok: boolean }) => {
      if (data.ok) {
        setParentUnlocked(true);
        setShowPinDialog(false);
        setPinInput("");
        setPinError("");
        setJustUnlocked(true);
        setTimeout(() => {
          parentControlsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          spotlight("parent-controls-card");
        }, 100);
        setTimeout(() => setJustUnlocked(false), 2500);
      } else {
        setPinError("Incorrect PIN. Try again.");
      }
    },
    // The server rate-limits this endpoint (10 tries / 15 min per account) and
    // returns a specific "try again in a few minutes" message on 429 — losing
    // that here meant a locked-out user just saw a generic failure and kept
    // retrying against an endpoint that was already refusing them.
    onError: (err: any) => setPinError(err?.message || "Couldn't verify PIN."),
  });

  const approveCashoutMutation = useMutation({
    mutationFn: async ({ id }: { id: string; profileId: string }) =>
      (await apiRequest("POST", `/api/wallet/requests/${id}/approve`, {})).json(),
    // Approving/declining changes the REQUESTER's star balance, not
    // whichever profile happens to be selected right now (a parent could
    // easily be viewing "All Family" or a different kid while approving) —
    // invalidate by the request's own profileId, not singleSelectedProfile.
    // Star pills read /api/points (the authoritative ledger total, which
    // already accounts for reserved-but-pending cash-out points), so that
    // query specifically has to be invalidated too — it previously wasn't,
    // which is why the balance only ever updated after a manual refresh.
    onSuccess: (_data, { profileId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Cash-out approved" });
    },
    onError: () => toast({ title: "Couldn't approve cash-out", variant: "destructive" }),
  });

  const declineCashoutMutation = useMutation({
    mutationFn: async ({ id }: { id: string; profileId: string }) =>
      (await apiRequest("POST", `/api/wallet/requests/${id}/decline`, {})).json(),
    // Declining releases the reserved points back to the requester's
    // balance server-side — but nothing here previously told the star pill
    // to refetch, so it kept showing the reduced (still-reserved) number
    // until something else happened to refresh it. Same fix as approve.
    onSuccess: (_data, { profileId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Cash-out declined" });
    },
    onError: () => toast({ title: "Couldn't decline cash-out", variant: "destructive" }),
  });

  const getProfilesWhoCanAfford = (reward: Reward) => {
    return profilePoints.filter(({ profile, points }) => {
      if (reward.scopeProfileId && reward.scopeProfileId !== profile.id) return false;
      return points >= reward.pointsCost;
    });
  };

  const hasBeenRedeemed = (rewardId: string, profileId: string) =>
    recentlyRedeemed.has(`${rewardId}-${profileId}`);

  const handleEditReward = (reward: Reward) => {
    setEditingReward(reward);
    setEditFormData({
      title: reward.title,
      description: reward.description ?? "",
      pointsCost: reward.pointsCost,
      icon: reward.icon ?? "🎁",
      scopeProfileId: reward.scopeProfileId ?? "",
    });
  };

  const fmt = (cents: number) => `${currencySymbol}${(cents / 100).toFixed(2)}`;

  return (
    // flex-col + gap rather than space-y so `order` actually applies — the
    // Cash-Out Approvals card moves below Cash Out Stars on a kid's own
    // screen. Visually identical spacing either way.
    <div className="flex flex-col gap-6" data-testid="rewards-view">
      {spotlightOverlay}
      {/* Profile Points Strip — hidden when embedded */}
      {!embedded && (
      <div className="flex items-center gap-3 flex-wrap p-4 bg-muted/20 rounded-xl border border-border">
        <AnimatePresence mode="popLayout">
        {profilePoints.map(({ profile, points }) => (
          <motion.div
            key={profile.id}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            ref={(el) => { if (el) profileOvalRefs.current.set(profile.id, el as HTMLElement); else profileOvalRefs.current.delete(profile.id); }}
            className="relative flex items-center gap-4 px-5 py-3 bg-background/90 rounded-full shadow-sm cursor-pointer select-none hover:shadow-md transition-shadow"
            onClick={() => {
              setStarburstProfile(profile.id);
              setTimeout(() => setStarburstProfile(null), 900);
            }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-base border-2 border-white shadow-sm shrink-0"
              style={{ backgroundColor: profile.color }}
            >
              {profile.photoUrl ? (
                <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                profile.initials
              )}
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground leading-none">{profile.name}</p>
              <motion.p
                className="text-2xl font-bold text-primary flex items-center gap-1 mt-1"
                animate={starburstProfile === profile.id ? { scale: [1, 1.5, 1] } : {}}
                transition={{ duration: 0.35 }}
              >
                <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
                {points}
              </motion.p>
            </div>
            {/* Star burst particles */}
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

      {/* Header — hidden when embedded; card header owns the buttons */}
      {!embedded && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Gift className="w-6 h-6 text-primary" />
            {showRewardCatalog ? "Rewards Gallery" : "Cash Out"}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {showRewardCatalog ? "Earn stars and unlock awesome rewards!" : "Cash out stars for real money!"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Requesting/suggesting a reward and managing the reward catalog
              only make sense when there IS a reward catalog — hidden
              entirely in cashout_only mode, matching the reward cards
              themselves (already gated on showRewardCatalog below). */}
          {showRewardCatalog && singleSelectedProfile && (
            <Button variant="outline" onClick={() => setShowRequestForm(true)} data-testid="request-reward-button">
              <Lightbulb className="w-4 h-4 mr-2" />
              Suggest a reward
            </Button>
          )}
          {showRewardCatalog && (
            <Button variant="outline" onClick={() => setShowManageDrawer(v => !v)} data-testid="manage-rewards-button">
              <ListChecks className="w-4 h-4 mr-2" />
              Manage rewards
            </Button>
          )}
        </div>
      </div>
      )}

      {/* "Request a reward" always has a visible entry point, even when
          embedded (the card header above only renders in the standalone,
          non-embedded page, which the combined Tasks tab never uses) — this
          was previously only reachable once someone else's request was
          already pending. Same showRewardCatalog gating as the header
          buttons above — nothing to request/suggest when there's no catalog. */}
      {embedded && showRewardCatalog && singleSelectedProfile && (
        <Button variant="outline" size="sm" onClick={() => setShowRequestForm(true)} data-testid="request-reward-button-embedded" className="gap-1.5">
          <Lightbulb className="w-4 h-4" />
          Suggest a reward
        </Button>
      )}

      {/* Cashout card moved into the rewards grid below */}

      {/* ── Pending Reward Requests (parent view) ───────────────────────
          Wishlist items ARE reward suggestions, so this whole section is
          moot without a reward catalog — cashout_only families only ever
          see cash-out approvals (handled separately, in Parent Controls). */}
      {showRewardCatalog && pendingWishlistItems.length > 0 && (
        <Card data-testid="pending-requests-section" id="pending-requests-section">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium">Pending reward suggestions</span>
                <Badge variant="secondary" className="text-xs">{pendingWishlistItems.length}</Badge>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowAllRequests(true)}>
                View all
              </Button>
            </div>
            <div className="space-y-2">
              {pendingWishlistItems.map(item => {
                const submitter = item.submittedByProfileId ? profileById.get(item.submittedByProfileId) : null;
                return (
                  <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/40" data-testid={`wishlist-pending-${item.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {submitter ? `${submitter.name} · ` : ""}
                        {item.suggestedPriceCoins} ⭐ suggested
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => approveWishlistMutation.mutate(item)}
                        disabled={approveWishlistMutation.isPending}
                        data-testid={`approve-request-${item.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => declineWishlistMutation.mutate(item.id)}
                        disabled={declineWishlistMutation.isPending}
                        data-testid={`decline-request-${item.id}`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Cash-Out Approvals ───────────────────────────────────────────
          Renamed from "Parent Controls" once Add/Remove Stars moved out to
          its own spotlight screen (behind the floating + button) — this
          card's only remaining job is approving/declining cash-out
          requests, so its name should say that plainly instead of the
          old, now-inaccurate umbrella name. Internal identifiers
          (parentControlsRef, data-testid, triggerParentUnlock, etc.) are
          deliberately left as-is — only the user-facing label changed. */}
      <Card
        id="parent-controls-card"
        ref={parentControlsRef}
        data-testid="parent-controls-section"
        className={cn(
          "border-muted transition-all duration-500",
          justUnlocked && "ring-2 ring-primary shadow-lg",
          // De-emphasised on a kid's own screen so it doesn't lead with a
          // card they can't use. Still present and still unlockable.
          kidContext && !parentUnlocked && "opacity-70",
        )}
        style={kidContext && !parentUnlocked ? { order: 2 } : undefined}
      >
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Cash-Out Approvals</span>
            </div>
            {parentUnlocked ? (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1" onClick={() => setParentUnlocked(false)}>
                <Lock className="w-3 h-3" /> Lock
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1" onClick={() => { setPinInput(""); setPinError(""); setShowPinDialog(true); }}>
                <Unlock className="w-3 h-3" /> Unlock
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Approve or decline cash-out requests for a family member.
          </p>

          {parentUnlocked && (
            <div className="rounded-lg border border-border bg-background/40 p-2.5">
              {pendingCashouts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No pending cash-outs.</p>
              ) : (
                <div className="space-y-1">
                  {pendingCashouts.map(tx => {
                    const profile = profiles.find(p => p.id === tx.profileId);
                    return (
                      <div key={tx.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40" data-testid={`cashout-request-${tx.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold leading-tight truncate">
                            {profile?.name ?? "Unknown"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{fmt(tx.requestedCents)} · {tx.requestedPoints} ⭐</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            className="h-7 w-7 p-0 bg-emerald-400 hover:bg-emerald-500 text-white border-0"
                            onClick={() => approveCashoutMutation.mutate({ id: tx.id, profileId: tx.profileId })}
                            disabled={approveCashoutMutation.isPending}
                            data-testid={`approve-cashout-${tx.id}`}
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 w-7 p-0 bg-rose-400 hover:bg-rose-500 text-white border-0"
                            onClick={() => declineCashoutMutation.mutate({ id: tx.id, profileId: tx.profileId })}
                            disabled={declineCashoutMutation.isPending}
                            data-testid={`decline-cashout-${tx.id}`}
                            title="Decline"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={(o) => { if (!o) { setShowPinDialog(false); setPinInput(""); setPinError(""); } }}>
        <DialogContent className="max-w-xs" autoFocusFirst>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4" /> Parent PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!rewardSettingsData?.hasParentPin && (
              <p className="text-xs text-muted-foreground">No PIN set — tap Unlock. Set one in Settings → Rewards &amp; Approvals.</p>
            )}
            <PasswordInput
              inputMode="numeric"
              maxLength={4}
              placeholder="Enter 4-digit PIN"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
              className="tracking-widest text-center text-lg"
              onKeyDown={(e) => { if (e.key === "Enter" && pinInput.length > 0) verifyPinMutation.mutate(pinInput); }}
            />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>Cancel</Button>
            <Button
              onClick={() => verifyPinMutation.mutate(pinInput)}
              disabled={verifyPinMutation.isPending || (!rewardSettingsData?.hasParentPin ? false : pinInput.length !== 4)}
            >
              {verifyPinMutation.isPending ? "Checking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Reward Dialog */}
      <Dialog open={showAddReward} onOpenChange={setShowAddReward}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Reward</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Reward Name</Label>
                  <Input
                    value={newReward.title}
                    onChange={(e) => setNewReward({ ...newReward, title: e.target.value })}
                    placeholder="e.g., Extra Screen Time"
                    data-testid="reward-title-input"
                  />
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input
                    value={newReward.description}
                    onChange={(e) => setNewReward({ ...newReward, description: e.target.value })}
                    placeholder="e.g., 30 minutes of extra gaming"
                    data-testid="reward-description-input"
                  />
                </div>
                <div>
                  <Label>Stars Required</Label>
                  <Input
                    type="number"
                    value={newReward.pointsCost}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") { setNewReward({ ...newReward, pointsCost: "" }); return; }
                      const n = parseInt(v);
                      if (!Number.isNaN(n)) setNewReward({ ...newReward, pointsCost: n });
                    }}
                    min={1}
                    data-testid="reward-points-input"
                  />
                </div>
                <div>
                  <Label>Icon</Label>
                  <div className="grid grid-cols-6 gap-2 mt-2">
                    {REWARD_ICONS.map(({ icon, label }) => (
                      <Button
                        key={icon}
                        variant={newReward.icon === icon ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNewReward({ ...newReward, icon })}
                        className="text-xl h-10"
                        title={label}
                        data-testid={`icon-${label.toLowerCase()}`}
                      >
                        {icon}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-2">
                    <EmojiPicker value={newReward.icon} onChange={(emoji) => setNewReward({ ...newReward, icon: emoji })} />
                  </div>
                </div>
                <div>
                  <Label>Assign to (optional)</Label>
                  <select
                    value={newReward.scopeProfileId || "everyone"}
                    onChange={(e) => setNewReward({ ...newReward, scopeProfileId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    data-testid="reward-profile-select"
                  >
                    <option value="everyone">Everyone</option>
                    {regularProfiles.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createRewardMutation.mutate({ ...newReward, pointsCost: newReward.pointsCost || 1 })}
                  disabled={!newReward.title || !newReward.pointsCost || createRewardMutation.isPending}
                  data-testid="create-reward-button"
                >
                  {createRewardMutation.isPending ? "Creating..." : "Create Reward"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

      {/* Edit Reward Dialog — opened from Manage drawer */}
      <Dialog open={editingReward !== null} onOpenChange={(open) => { if (!open) setEditingReward(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Reward</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Reward Name</Label>
              <Input
                value={editFormData.title}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                placeholder="e.g., Extra Screen Time"
                data-testid="edit-reward-title-input"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                placeholder="e.g., 30 minutes of extra gaming"
                data-testid="edit-reward-description-input"
              />
            </div>
            <div>
              <Label>Stars Required</Label>
              <Input
                type="number"
                value={editFormData.pointsCost}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") { setEditFormData({ ...editFormData, pointsCost: "" }); return; }
                  const n = parseInt(v);
                  if (!Number.isNaN(n)) setEditFormData({ ...editFormData, pointsCost: n });
                }}
                min={1}
                data-testid="edit-reward-points-input"
              />
            </div>
            <div>
              <Label>Icon</Label>
              <div className="grid grid-cols-6 gap-2 mt-2">
                {REWARD_ICONS.map(({ icon, label }) => (
                  <Button
                    key={icon}
                    variant={editFormData.icon === icon ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEditFormData({ ...editFormData, icon })}
                    className="text-xl h-10"
                    title={label}
                  >
                    {icon}
                  </Button>
                ))}
              </div>
              <div className="mt-2">
                <EmojiPicker value={editFormData.icon} onChange={(emoji) => setEditFormData({ ...editFormData, icon: emoji })} />
              </div>
            </div>
            <div>
              <Label>Assign to (optional)</Label>
              <select
                value={editFormData.scopeProfileId || "everyone"}
                onChange={(e) => setEditFormData({ ...editFormData, scopeProfileId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="edit-reward-profile-select"
              >
                <option value="everyone">Everyone</option>
                {regularProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </div>
            <Button
              className="w-full"
              onClick={() => editingReward && updateRewardMutation.mutate({ id: editingReward.id, data: { ...editFormData, pointsCost: editFormData.pointsCost || 1 } })}
              disabled={!editFormData.title || !editFormData.pointsCost || updateRewardMutation.isPending}
              data-testid="save-reward-button"
            >
              {updateRewardMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request a Reward Dialog (kid-facing) */}
      <Dialog open={showRequestForm} onOpenChange={setShowRequestForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-400" />
              Suggest a reward
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Who's suggesting it?</Label>
              <select
                value={requestForm.submittedByProfileId}
                onChange={(e) => setRequestForm({ ...requestForm, submittedByProfileId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="wishlist-request-submitter-select"
              >
                <option value="" disabled>Pick a family member</option>
                {regularProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>What reward would you like added?</Label>
              <Input
                value={requestForm.title}
                onChange={(e) => setRequestForm({ ...requestForm, title: e.target.value })}
                placeholder="e.g., New Lego set"
                maxLength={200}
                data-testid="request-title-input"
              />
            </div>
            <div>
              <Label>Why do you want it? (optional)</Label>
              <Textarea
                value={requestForm.description}
                onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                placeholder="Why you'd like this"
                rows={3}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Link (optional)</Label>
                <Input
                  value={requestForm.link}
                  onChange={(e) => setRequestForm({ ...requestForm, link: e.target.value })}
                  placeholder="https://..."
                  type="url"
                  maxLength={2000}
                />
              </div>
              <div>
                <Label>Suggested stars</Label>
                <Input
                  type="number"
                  min={1}
                  value={requestForm.suggestedPriceCoins}
                  onChange={(e) =>
                    setRequestForm({ ...requestForm, suggestedPriceCoins: Math.max(1, parseInt(e.target.value) || 1) })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestForm(false)}>Cancel</Button>
            <Button
              onClick={() => submitRequestMutation.mutate()}
              disabled={!requestForm.title.trim() || !requestForm.submittedByProfileId || submitRequestMutation.isPending}
              data-testid="submit-request-button"
            >
              <Send className="w-4 h-4 mr-2" />
              {submitRequestMutation.isPending ? "Submitting…" : "Suggest it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View All Requests Sheet */}
      <Dialog open={showAllRequests} onOpenChange={setShowAllRequests}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" />
              Reward suggestions
            </DialogTitle>
          </DialogHeader>
          <WishlistView profiles={profiles} />
        </DialogContent>
      </Dialog>

      {/* Manage Rewards Drawer */}
      <RewardManagementDrawer
        open={showManageDrawer}
        onOpenChange={setShowManageDrawer}
        rewards={rewards}
        profiles={regularProfiles}
        onEdit={handleEditReward}
        onDelete={(rewardId) => deleteRewardMutation.mutate(rewardId)}
        onAddNew={openAddReward}
      />

      {/* Rewards Gallery + Cashout card in unified grid */}
      {(showRewardCatalog || showCashoutSection) && rewardsLoading && rewards.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="rewards-loading">
          <div className="w-6 h-6 mx-auto mb-2 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
          Loading…
        </div>
      ) : (showRewardCatalog || showCashoutSection) && (
        (showRewardCatalog && rewards.length === 0 && !showCashoutSection) ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Gift className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-medium mb-2">No rewards yet</h3>
              <p className="text-muted-foreground mb-4">
                Create rewards to motivate your family members!
              </p>
              <Button onClick={openAddReward}>
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Reward
              </Button>
            </CardContent>
          </Card>
        ) : (
          // Every grid-item wrapper below carries min-w-0 — the same real
          // bug found and fixed in celebrations-view.tsx's card grid: a
          // reward title is free text and can be a single long unbroken
          // word, which (without min-w-0 on the grid ITEM itself, not just
          // the grid container) drives that whole column's min width up and
          // pushes every card off the right edge, not just the long one.
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* ── Cash Out card — always first ──────────────────────────── */}
            {showCashoutSection && singleSelectedProfile && (() => {
              const maxCents = Math.floor((availableForCashout * centsPerPoint) / 25) * 25;
              const clampedCents = Math.min(cashoutCents, maxCents || 25);
              const pointsNeeded = centsPerPoint > 0 ? Math.ceil(clampedCents / centsPerPoint) : 0;
              const canRequest = centsPerPoint > 0 && availableForCashout > 0 && clampedCents >= 25 && maxCents >= 25;

              return (
                <motion.div
                  key="cashout-card"
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  // col-span-full (not a fixed col-span-2) — this grid also
                  // hosts the reward-catalog tiles and widens to 3/4 columns
                  // at lg:/xl:, so a fixed span-2 only filled half (or a
                  // quarter) of the row at those widths, leaving visible
                  // empty space to the right — most noticeable in
                  // cashout_only mode, where this card is the ONLY item in
                  // the grid. col-span-full always spans however many
                  // columns the grid currently has, matching how
                  // Cash-Out Approvals (a plain full-width Card, not a grid
                  // item at all) always fills the row.
                  className="col-span-full min-w-0"
                  data-testid="cashout-card"
                  id="cash-out-stars-card"
                >
                  <Card className="h-full">
                    <CardContent className="p-3 flex flex-col gap-3">
                      {/* Icon + title row */}
                      <div className="flex items-center gap-2">
                        <span className="text-3xl leading-none">💰</span>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground leading-snug">Cash Out Stars</h3>
                          <p className="text-xs text-muted-foreground">Convert stars to money</p>
                        </div>
                        <div className="ml-auto flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-md">
                          <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
                          <span className="text-sm font-bold text-foreground">{availableForCashout}</span>
                          <span className="text-xs text-muted-foreground">available</span>
                        </div>
                      </div>

                      {centsPerPoint <= 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No cash-out rate set. A parent can configure it in Settings → Rewards &amp; Approvals.
                        </p>
                      ) : maxCents < 25 ? (
                        <p className="text-xs text-muted-foreground">
                          Not enough stars to cash out yet. Keep earning!
                        </p>
                      ) : (
                        <>
                          {/* Slider + live readout */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Select amount</span>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold text-foreground">
                                  {fmt(clampedCents)}
                                </span>
                                <span className="flex items-center gap-0.5 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                  {pointsNeeded} ⭐
                                </span>
                              </div>
                            </div>
                            <Slider
                              min={25}
                              max={maxCents}
                              step={25}
                              value={[clampedCents]}
                              onValueChange={([v]) => setCashoutCents(v)}
                              className="w-full"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>{fmt(25)}</span>
                              <span>{fmt(maxCents)}</span>
                            </div>
                          </div>

                          {/* Request button */}
                          {cashoutRequested ? (
                            <div className="text-center text-sm text-emerald-600 dark:text-emerald-400 font-semibold py-1 flex items-center justify-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" /> Request sent! Waiting for parent approval.
                            </div>
                          ) : (
                            <Button
                              className="w-full h-10 text-sm font-semibold gap-2 bg-emerald-400 hover:bg-emerald-500 text-white"
                              disabled={!canRequest || cashoutMutation.isPending}
                              onClick={() => cashoutMutation.mutate({ profileId: singleSelectedProfile.id, points: pointsNeeded, cents: clampedCents })}
                              data-testid="cashout-btn"
                            >
                              {cashoutMutation.isPending ? "Requesting…" : (
                                <>
                                  Cash out {fmt(clampedCents)}
                                  <span className="flex items-center gap-0.5 text-xs opacity-80 font-normal">
                                    <Star className="w-3 h-3 fill-current" />{pointsNeeded}
                                  </span>
                                </>
                              )}
                            </Button>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })()}

            {showCashoutSection && !singleSelectedProfile && (
              <motion.div key="cashout-card-no-profile" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="col-span-full" data-testid="cashout-card" id="cash-out-stars-card">
                <Card className="h-full">
                  <CardContent className="p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl leading-none">💰</span>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Cash Out Stars</h3>
                        <p className="text-xs text-muted-foreground">Select a profile to cash out</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {showRewardCatalog && [...rewards].sort((a, b) => a.pointsCost - b.pointsCost).map(reward => {
              const affordableProfiles = getProfilesWhoCanAfford(reward);
              const anyCanAfford = affordableProfiles.length > 0;
              const isCelebrating = celebratingRewardId === reward.id;

              // Single profile mode
              if (singleSelectedProfile) {
                const scopedOut = reward.scopeProfileId && reward.scopeProfileId !== singleSelectedProfile.id;
                if (scopedOut) return null;

                const canAfford = singleProfilePoints >= reward.pointsCost;
                const progress = Math.min(100, Math.round((singleProfilePoints / reward.pointsCost) * 100));
                const redeemed = hasBeenRedeemed(reward.id, singleSelectedProfile.id);
                const isConfirmingRedeem = redeemingRewardId === reward.id;

                return (
                  <motion.div
                    key={reward.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative min-w-0"
                    data-testid={`reward-card-${reward.id}`}
                    ref={(el) => { if (el) rewardCardRefs.current.set(reward.id, el); else rewardCardRefs.current.delete(reward.id); }}
                  >
                    <Card className={`h-full transition-all hover:shadow-lg ${canAfford ? "border-emerald-300 shadow-md ring-2 ring-emerald-300/30 bg-emerald-50/60 dark:bg-emerald-900/15" : ""}`}>
                      <CardContent className="p-3 flex flex-col gap-2">
                        <AnimatePresence>
                          {isCelebrating && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 pointer-events-none z-10"
                            >
                              <Sparkles className="absolute top-2 right-2 w-6 h-6 text-amber-400 animate-pulse" />
                              <Sparkles className="absolute bottom-2 left-2 w-5 h-5 text-amber-300 animate-pulse" />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <span className="text-3xl leading-none">{reward.icon}</span>

                        <div className="space-y-0.5">
                          <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{reward.title}</h3>
                          {reward.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{reward.description}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 mt-auto px-2 py-1 bg-muted/50 rounded-md">
                          <Star className="w-5 h-5 text-amber-400 fill-amber-400 shrink-0" />
                          <span className="text-lg font-bold text-foreground">{reward.pointsCost}</span>
                          <span className="text-xs text-muted-foreground">stars</span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {Math.min(singleProfilePoints, reward.pointsCost)} / {reward.pointsCost}
                            </span>
                            <span className={canAfford ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-amber-600 dark:text-amber-400 font-semibold"}>
                              {progress}%
                            </span>
                          </div>
                          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full ${canAfford ? "bg-emerald-400" : "bg-amber-400"}`}
                              initial={{ width: "0%" }}
                              animate={{ width: `${progress}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }}
                            />
                          </div>

                          {canAfford && (
                            <div className="pt-1">
                              {redeemed ? (
                                <div className="text-center py-1">
                                  <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">✓ Redeemed!</div>
                                  <div className="text-xs text-muted-foreground mt-0.5">Now in the approval process</div>
                                </div>
                              ) : isConfirmingRedeem ? (
                                <div className="flex flex-col gap-1.5 w-full">
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs w-full bg-emerald-400 hover:bg-emerald-500"
                                    onClick={() => {
                                      triggerRedemptionStars(singleSelectedProfile.id, reward.id, reward.pointsCost);
                                      redeemRewardMutation.mutate({ rewardId: reward.id, profileId: singleSelectedProfile.id });
                                    }}
                                    disabled={redeemRewardMutation.isPending}
                                    data-testid={`confirm-redeem-${reward.id}-${singleSelectedProfile.id}`}
                                  >
                                    <Gift className="w-3 h-3 mr-1" />
                                    {redeemRewardMutation.isPending ? "..." : "Confirm!"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs w-full"
                                    onClick={() => setRedeemingRewardId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  className="w-full h-8 text-xs bg-emerald-400 hover:bg-emerald-500 text-white"
                                  onClick={() => setRedeemingRewardId(reward.id)}
                                  data-testid={`redeem-${reward.id}`}
                                >
                                  <Gift className="w-3 h-3 mr-1" />
                                  Redeem
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              }

              // All Family / multi-profile mode
              return (
                <motion.div
                  key={reward.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative min-w-0"
                  data-testid={`reward-card-${reward.id}`}
                  ref={(el) => { if (el) rewardCardRefs.current.set(reward.id, el); else rewardCardRefs.current.delete(reward.id); }}
                >
                  <Card className={`h-full transition-all hover:shadow-lg ${
                    anyCanAfford ? "border-primary shadow-md ring-2 ring-primary/25 bg-primary/5" : "opacity-60"
                  }`}>
                    <CardContent className="p-3 flex flex-col gap-2">
                      <AnimatePresence>
                        {isCelebrating && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 pointer-events-none z-10"
                          >
                            <Sparkles className="absolute top-2 right-2 w-6 h-6 text-amber-400 animate-pulse" />
                            <Sparkles className="absolute bottom-2 left-2 w-5 h-5 text-amber-300 animate-pulse" />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <span className="text-3xl leading-none">{reward.icon}</span>

                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{reward.title}</h3>
                        {reward.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{reward.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 mt-auto px-2 py-1 bg-muted/50 rounded-md">
                        <Star className="w-5 h-5 text-amber-400 fill-amber-400 shrink-0" />
                        <span className="text-lg font-bold text-foreground">{reward.pointsCost}</span>
                        <span className="text-xs text-muted-foreground">stars</span>
                      </div>

                      {(() => {
                        const best = Math.min(100, Math.round((Math.max(...profilePoints.map(pp => pp.points), 0) / reward.pointsCost) * 100));
                        return (
                          <div className="space-y-1">
                            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <motion.div
                                className={`h-full rounded-full ${anyCanAfford ? "bg-emerald-400" : "bg-amber-400"}`}
                                initial={{ width: "0%" }}
                                animate={{ width: `${best}%` }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                              />
                            </div>
                            {anyCanAfford && (
                              <p className="text-xs text-primary font-semibold text-center">✓ Unlocked</p>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )
      )}

      {/* Star drain animation — fixed overlay */}
      <AnimatePresence>
        {starParticles.map(p => {
          const dx = p.destX - p.originX;
          const dy = p.destY - p.originY;
          const midX = dx * 0.5 + p.arcOffX;
          const midY = dy * 0.5 - p.arcHeight;
          return (
            <motion.span
              key={p.id}
              className="fixed pointer-events-none select-none"
              style={{ left: p.originX, top: p.originY, fontSize: p.size, zIndex: 9999, lineHeight: 1 }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0.5 }}
              animate={{
                x: [0, midX, dx],
                y: [0, midY, dy],
                opacity: [0, 1, 1, 0],
                scale: [0.5, 1.3, 1, 0.4],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                ease: "easeInOut",
                times: [0, 0.3, 0.75, 1],
              }}
            >
              ⭐
            </motion.span>
          );
        })}
      </AnimatePresence>

      {parentGateDialog}
    </div>
  );
}
