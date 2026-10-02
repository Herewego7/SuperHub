import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { objectUrl, apiUrl, isNativePlatform } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import { WebAuth } from "@/lib/webAuth";
import { ShareLinksSection } from "./share-links-section";
import { PIN_GATE_FEATURES, PIN_GATE_DEFAULT_FEATURES, isKidProfile } from "@/lib/parentGate";
import { canOpenStoreReviewPage, openStoreReviewPage } from "@/lib/reviewPrompt";
import { sentryEnabled, captureTestError } from "@/lib/sentry";
import { markOnboardingStepDone } from "@/lib/onboardingStatus";
import { useSpotlight } from "@/lib/spotlight";
import { Button } from "@/components/ui/button";
import { ColorSpectrumPicker } from "@/components/color-spectrum-picker";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import { Profile, InsertProfile, LocationSettings, insertLocationSettingsSchema, CustomProfileGroup, RewardSettings } from "@workspace/shared-types";
import { regionToTimezone, deviceTimezone, guessCountry, countryFromName, regionLabel, COUNTRIES, type CountryCode } from "@/lib/regions";
import { familyCalendarSelectValue, parseFamilyCalendarOption, familyCalendarOptionValue } from "@/lib/familyCalendarChoice";
import { personRecordLines, savedSchool } from "@/lib/slipMail";
import { ObjectUploader } from "./ObjectUploader";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Plus, Edit, X, Upload, User, Users, UserPlus, MapPin, Calendar, ChevronDown, ChevronUp, Lock, LogOut, Trash2, AlertTriangle, Bell, LayoutDashboard, GripVertical, Gift, ShieldCheck, CheckCircle, XCircle, Sun, Moon, Monitor, Camera, Save, Compass, Search, Share2, KeyRound, Star, HelpCircle, Link2, Bug, Sparkles, Home, ListTodo, UtensilsCrossed, MessageCircle } from "lucide-react";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { isScreensaverEnabled, setScreensaverEnabled, SCREENSAVER_IDLE_MS } from "@/lib/screensaver";
import { EmojiPicker } from "./EmojiPicker";
import { useAuth } from "@/hooks/use-auth";
import { requestPasswordReset } from "@/lib/emailAuth";
import { FamilyManager, FamilyInviteManager, LoginOnlyMembers } from "./family-manager";
import { ProfileCalendarRow } from "./ical-subscriptions";
import { NotificationsSection } from "./notifications-section";
import { PerPersonSettingsSection } from "./per-person-settings";
import { SubscriptionSettingsSection } from "./subscription-settings-section";
import { KbPanel } from "./kb/kb-panel";
import { ADULT_ROLE_EXPLAINER, KID_ROLE_EXPLAINER, KID_NEEDS_PIN_NUDGE } from "@/lib/copy";
import { LocationWeatherChip } from "@/components/location-weather-chip";

// All tabs in canonical order — used for Default Tab select + sortable reorder list.
// "behaviour" deliberately omitted — the Behavior Board tab is hidden from
// Settings entirely for now (still fully functional, just not discoverable
// here); see the matching note in family-hub.tsx's ALL_NAV_TAB_CONFIGS.
// icon/shortLabel mirror ALL_NAV_TAB_CONFIGS in family-hub.tsx — kept here
// rather than imported because that's a page which imports this modal. They
// only feed the preview below; the nav itself still reads its own copy.
const ALL_TABS: {
  id: string; label: string; alwaysVisible?: boolean;
  icon: React.ComponentType<{ className?: string }>; shortLabel?: string;
}[] = [
  { id: "home",      label: "Home",        alwaysVisible: true,  icon: Home },
  { id: "calendar", label: "Calendar",    alwaysVisible: true, icon: Calendar, shortLabel: "Cal" },
  { id: "chores",    label: "Chores",      alwaysVisible: true, icon: ListTodo },
  { id: "meals",     label: "Meals",       alwaysVisible: true, icon: UtensilsCrossed },
  { id: "chat",      label: "Chat",        alwaysVisible: true, icon: MessageCircle },
];
const FIXED_NAV_IDS = ["home", "calendar", "chores", "meals", "chat"];

function formatStarsPerDollar(centsPerPoint: number): string {
  const perDollar = 100 / centsPerPoint;
  // Trim to at most 2 decimals without trailing zeros (12.5, not 12.50; 8, not 8.00).
  return String(Math.round(perDollar * 100) / 100);
}

export function RewardsSettingsSection({
  wizard = false,
  onWizardComplete,
}: {
  /** Walks the same fields one question at a time (Next/Back), instead of
   * showing every block at once — used by the onboarding wizard's Rewards
   * step so it isn't overwhelming. Settings' own permanent home for this
   * section renders every block together as before (wizard defaults off). */
  wizard?: boolean;
  /** Called once the final step saves successfully — only meaningful in
   * wizard mode. */
  onWizardComplete?: () => void;
} = {}) {
  const { toast } = useToast();
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const qc = useQueryClient();
  const [mode, setMode] = useState<string>("");
  const [pointsMode, setPointsMode] = useState<string>("");
  const [completionBonusPoints, setCompletionBonusPoints] = useState("");
  const [centsPerPoint, setCentsPerPoint] = useState("");
  const [currencySymbol, setCurrencySymbol] = useState("");
  const [currencySymbolTouched, setCurrencySymbolTouched] = useState(false);
  const [minCashoutPoints, setMinCashoutPoints] = useState("");
  // Whether the user has actually edited these fields this session — while
  // untouched, their value is just the server's auto-created default
  // (see the /api/reward-settings GET route), so it's shown in muted grey
  // to signal "this is a starting point, feel free to change it."
  const [centsPerPointTouched, setCentsPerPointTouched] = useState(false);
  const [minCashoutTouched, setMinCashoutTouched] = useState(false);

  useEffect(() => {
    if (rewardSettings) {
      setMode(rewardSettings.redemptionMode);
      setPointsMode(rewardSettings.pointsMode ?? "per_chore");
      setCompletionBonusPoints(String(rewardSettings.completionBonusPoints ?? 10));
      // Field shows STARS PER DOLLAR (the reciprocal of stored cents-per-star)
      // — "how many stars does $1 cost to redeem" reads more directly than a
      // fractional dollar-per-star rate.
      setCentsPerPoint(rewardSettings.centsPerPoint > 0 ? formatStarsPerDollar(rewardSettings.centsPerPoint) : "");
      setCurrencySymbol(rewardSettings.currencySymbol);
      setMinCashoutPoints(rewardSettings.minCashoutPoints > 0 ? String(rewardSettings.minCashoutPoints) : "");
    }
  }, [rewardSettings]);

  // PUT /api/reward-settings does a partial update — only the fields present
  // in the body are changed, everything else (incl. the Parent PIN section's
  // own fields, saved separately by ParentPinSettingsSection below) is left
  // exactly as it was. Same endpoint, same behavior as before this section
  // and the PIN section were visually split apart.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = { redemptionMode: mode || "both" };
      if (pointsMode) body.pointsMode = pointsMode;
      const bonus = parseInt(completionBonusPoints, 10);
      if (!Number.isNaN(bonus) && bonus >= 1) body.completionBonusPoints = bonus;
      const starsPerDollar = parseFloat(centsPerPoint);
      if (centsPerPoint && starsPerDollar > 0) body.centsPerPoint = Math.round(100 / starsPerDollar);
      if (currencySymbol.trim()) body.currencySymbol = currencySymbol.trim();
      if (minCashoutPoints) body.minCashoutPoints = parseInt(minCashoutPoints, 10);
      return (await apiRequest("PUT", "/api/reward-settings", body)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reward-settings"] });
      // Switching earning modes changes how point totals are computed/displayed,
      // so refresh the point pills and chore views.
      qc.invalidateQueries({ queryKey: ["/api/points"] });
      qc.invalidateQueries({ queryKey: ["/api/chores"] });
      qc.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      toast({ title: "Rewards settings saved" });
      // This section is shared between onboarding and its permanent home
      // here in Settings — saving it here should clear a stale "skipped"
      // onboarding reminder just as completing it in the wizard would.
      markOnboardingStepDone("rewards");
      if (wizard) onWizardComplete?.();
    },
    onError: (err: any) => toast({ title: err?.message || "Couldn't save settings", variant: "destructive" }),
  });

  const currentMode = mode || rewardSettings?.redemptionMode || "both";
  const showCashout = currentMode !== "rewards_only";

  // "What can they do with stars?" was a three-way choice where one option
  // ("Either one") was just the other two combined — so it read as a spectrum
  // when it's really two independent yes/no questions. Two switches say the
  // same thing; redemptionMode is still what gets saved, just derived.
  const canRewards = currentMode !== "cashout_only";
  const canCash = currentMode !== "rewards_only";
  const setRedemption = (rewardsOn: boolean, cashOn: boolean) => {
    // Both off would leave kids earning stars with nowhere to spend them, and
    // isn't representable in redemptionMode anyway. Turning off the last one
    // switches the other on.
    if (!rewardsOn && !cashOn) return;
    setMode(rewardsOn && cashOn ? "both" : rewardsOn ? "rewards_only" : "cashout_only");
  };

  const currentPointsMode = pointsMode || rewardSettings?.pointsMode || "per_chore";

  // Wizard mode shows one question at a time: earning mode → redemption
  // mode → (cash-out fields, only if redemption mode allows cash-out).
  // A single sub-step index drives all three — the number of steps just
  // varies with whether cash-out fields are relevant.
  const [subStep, setSubStep] = useState(0);
  const lastWizardStep = showCashout ? 2 : 1;
  const showEarningBlock = !wizard || subStep === 0;
  const showRedemptionBlock = !wizard || subStep === 1;
  const showCashoutBlock = showCashout && (!wizard || subStep === 2);
  const isLastWizardStep = subStep >= lastWizardStep;

  // Live plain-English summary of the current configuration.
  const rateNum = Number(centsPerPoint || (rewardSettings ? formatStarsPerDollar(rewardSettings.centsPerPoint) : 0)) || 0;
  const symbol = currencySymbol || rewardSettings?.currencySymbol || "$";
  const minNum = Number(minCashoutPoints || rewardSettings?.minCashoutPoints || 0) || 0;
  const perStar = rateNum > 0 ? 1 / rateNum : 0;
  /* Short bullets, not a paragraph: this box exists to be glanced at after
     changing a control, and a run-on sentence is the one shape that can't be.
     One line per decision the family actually made. */
  const rewardsSummary: string[] = [
    currentPointsMode === "per_chore"
      ? "Stars for every chore finished"
      : "One bonus for finishing the whole day",
    ...(currentMode === "rewards_only"
      ? ["Spend on rewards you add", "No cash-out"]
      : [
          currentMode === "cashout_only"
            ? `Cash out at ${symbol}${perStar.toFixed(2)} a star`
            : `Spend on rewards, or cash out at ${symbol}${perStar.toFixed(2)} a star`,
          ...(minNum > 0
            ? [`Cash out from ${minNum} stars (${symbol}${(minNum * perStar).toFixed(2)})`]
            : []),
        ]),
  ];

  return (
    <div className="space-y-2">
      {/* Labels are questions, not noun phrases: a question can be answered
          without knowing the vocabulary ("Redemption mode" can't). Each option
          carries its own example, so the two can be compared without selecting
          one — the old explainer sat below the picker and only described
          whichever was already chosen. */}
      {showEarningBlock && (
      <div>
        <Label className="text-sm font-medium mb-1.5 block">How do kids earn stars?</Label>
        {/* Genuinely binary and mutually exclusive, so a two-way pill fits —
            unlike the redemption question below, which is two independent
            switches. A pill is too small to carry an example, so the example
            sits under it and changes with the selection. */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {/* Explicit two-line split rather than letting each label wrap on its
              own — natural wrapping left one button on a single line and the
              other broken as "…chores for / a day", so the pair looked
              lopsided and the buttons were different heights. */}
          {[
            { value: "per_chore", lines: ["Completing", "each chore"] },
            { value: "per_completion", lines: ["Completing all", "chores for a day"] },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPointsMode(opt.value)}
              className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                currentPointsMode === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`points-mode-${opt.value}`}
            >
              {opt.lines.map(line => <span key={line} className="block leading-tight">{line}</span>)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {currentPointsMode === "per_chore"
            ? "Make bed → 2⭐, walk dog → 3⭐"
            : "All of today's chores done → one bonus"}
        </p>
        {currentPointsMode === "per_completion" && (
          <div className="mt-2">
            <Label className="text-xs">Stars for finishing the day (family default)</Label>
            <Input
              type="number"
              min="1"
              placeholder="10"
              value={completionBonusPoints}
              onChange={(e) => setCompletionBonusPoints(e.target.value)}
              className="mt-0.5 h-8 text-xs w-28"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Used for everyone, unless a person has their own number set under
              <strong> Each person</strong> — that one wins.
            </p>
          </div>
        )}
      </div>
      )}

      {showRedemptionBlock && (
      <div className={wizard ? "" : "border-t pt-3"}>
        <Label className="text-sm font-medium mb-1.5 block">What can they do with stars?</Label>
        <div className="space-y-1.5">
          <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer">
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium block">Spend on rewards</span>
              <span className="text-xs text-muted-foreground block">Things you add to the reward list</span>
            </span>
            <Switch
              checked={canRewards}
              onCheckedChange={(v) => setRedemption(v, canCash)}
              data-testid="toggle-rewards-enabled"
            />
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer">
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium block">Cash out for money</span>
              <span className="text-xs text-muted-foreground block">Stars convert to money you pay out</span>
            </span>
            <Switch
              checked={canCash}
              onCheckedChange={(v) => setRedemption(canRewards, v)}
              data-testid="toggle-cashout-enabled"
            />
          </label>
        </div>
      </div>
      )}

      {/* The rate as a sentence rather than a labelled reciprocal. "Stars per
          dollar: 10" is a number you have to reason about; "10 stars = $1"
          is the same number read left to right. */}
      {showCashoutBlock && (
        <div className={wizard ? "space-y-2" : "border-t pt-3 space-y-2"}>
          <Label className="text-sm font-medium block">What are stars worth?</Label>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={rewardSettings && rewardSettings.centsPerPoint > 0 ? formatStarsPerDollar(rewardSettings.centsPerPoint) : "10"}
              value={centsPerPoint}
              onChange={(e) => { setCentsPerPoint(e.target.value); setCentsPerPointTouched(true); }}
              className={`h-8 text-sm w-20 ${!centsPerPointTouched ? "text-muted-foreground" : ""}`}
              data-testid="input-stars-per-dollar"
            />
            <span className="text-muted-foreground">stars =</span>
            {/* Symbol and the fixed "1" share one bordered box so the pair reads
                as "$1". The 1 used to sit outside the field, looking like a
                stray example value. */}
            <span className="inline-flex items-center h-8 rounded-md border border-input bg-background pr-2 text-sm">
              <input
                placeholder={rewardSettings?.currencySymbol ?? "$"}
                value={currencySymbol}
                onChange={(e) => { setCurrencySymbol(e.target.value); setCurrencySymbolTouched(true); }}
                maxLength={4}
                aria-label="Currency symbol"
                className={`h-full w-9 bg-transparent px-2 text-sm text-right outline-none ${!currencySymbolTouched ? "text-muted-foreground" : ""}`}
              />
              <span>1</span>
            </span>
          </div>
          {/* Label on its own line so the trailing "stars" can't wrap alone. */}
          <div className="text-sm">
            <span className="text-muted-foreground">Can cash out once they have</span>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min="0"
                placeholder={String(rewardSettings?.minCashoutPoints ?? 10)}
                value={minCashoutPoints}
                onChange={(e) => { setMinCashoutPoints(e.target.value); setMinCashoutTouched(true); }}
                className={`h-8 text-sm w-20 shrink-0 ${!minCashoutTouched ? "text-muted-foreground" : ""}`}
              />
              <span className="text-muted-foreground">stars</span>
            </div>
          </div>
        </div>
      )}

      {/* One sentence restating what's actually configured, in the family's own
          numbers. This is what lets the five explainer paragraphs go: they
          existed because each control was opaque alone. */}
      {!wizard && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2.5" data-testid="rewards-preview">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            What this means
          </p>
          <ul className="text-xs leading-relaxed space-y-0.5">
            {rewardsSummary.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span aria-hidden className="text-muted-foreground">•</span>
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {wizard ? (
        <div className="flex gap-2 pt-1">
          {subStep > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setSubStep((s) => Math.max(0, s - 1))}
            >
              ← Back
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 h-8"
            disabled={saveMutation.isPending}
            onClick={() => {
              if (isLastWizardStep) saveMutation.mutate();
              else setSubStep((s) => s + 1);
            }}
          >
            {isLastWizardStep ? (saveMutation.isPending ? "Saving…" : "Save & Continue →") : "Next →"}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full h-8"
        >
          {saveMutation.isPending ? "Saving…" : "Save rewards settings"}
        </Button>
      )}
    </div>
  );
}

// Split out of RewardsSettingsSection so the Parent PIN + "what it locks"
// controls can live in their own Settings section — same underlying data
// (both PUT the same /api/reward-settings endpoint, which only touches the
// fields present in each request) and identical logic, just a separate
// component so it can be shown/collapsed on its own instead of buried inside
// a "Rewards & Approvals" section most people wouldn't think to open for a
// permissions setting.
export function ParentPinSettingsSection({
  lockPinIfSet = false,
  wizard = false,
  onWizardComplete,
}: {
  lockPinIfSet?: boolean;
  /** Relabels the Save button and calls onWizardComplete on success instead
   * of just toasting — used when this is one step of the onboarding wizard's
   * Rewards & Approvals flow. Fields/behavior are otherwise unchanged. */
  wizard?: boolean;
  onWizardComplete?: () => void;
} = {}) {
  const { toast } = useToast();
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const qc = useQueryClient();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinGatedFeatures, setPinGatedFeatures] = useState<string[]>(PIN_GATE_DEFAULT_FEATURES);
  // Master on/off for the whole "lock these actions behind the PIN" feature
  // — not its own DB column, just whether pinGatedFeatures is empty. Kept
  // separate from the checklist state itself so switching it off and back on
  // in the same session doesn't lose whatever was checked. Doesn't affect
  // cash-out/reward-request approval, which stays always-protected by
  // design — this only covers the optional per-feature checklist below.
  const [pinEnabled, setPinEnabled] = useState(true);
  // Proof-of-identity for CHANGING an existing PIN (not for setting the first
  // one). Password is the fast path; the emailed code is the fallback for a
  // parent who's forgotten the PIN itself.
  const [accountPassword, setAccountPassword] = useState("");
  const [useEmailCode, setUseEmailCode] = useState(false);
  const [pinResetCode, setPinResetCode] = useState("");
  const [codeSent, setCodeSent] = useState<string | null>(null);

  useEffect(() => {
    if (rewardSettings) {
      const stored = rewardSettings.pinGatedFeatures ?? PIN_GATE_DEFAULT_FEATURES;
      setPinGatedFeatures(stored);
      // An explicit empty array is how "off" is represented server-side —
      // null/undefined falls back to the default set above, which is
      // non-empty, so this correctly reads as "on" for a family that's
      // never touched this setting.
      setPinEnabled(stored.length > 0);
    }
  }, [rewardSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = { pinGatedFeatures: pinEnabled ? pinGatedFeatures : [] };
      if (newPin && newPin === confirmPin && /^\d{4}$/.test(newPin)) {
        body.parentPin = newPin;
        // Only sent when changing an EXISTING PIN — the server ignores these
        // when there's no PIN to take over yet.
        if (rewardSettings?.hasParentPin) {
          if (useEmailCode) body.pinResetCode = pinResetCode;
          else body.accountPassword = accountPassword;
        }
      }
      return (await apiRequest("PUT", "/api/reward-settings", body)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reward-settings"] });
      setNewPin("");
      setConfirmPin("");
      setAccountPassword("");
      setPinResetCode("");
      setUseEmailCode(false);
      setCodeSent(null);
      toast({ title: "Parent PIN settings saved" });
      if (wizard) onWizardComplete?.();
    },
    onError: (err: any) => toast({ title: err?.message || "Couldn't save settings", variant: "destructive" }),
  });

  const requestCodeMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/reward-settings/request-pin-reset-code", {})).json(),
    onSuccess: (data: any) => {
      setCodeSent(data?.sentTo ?? "your email");
      toast({ title: "Code sent", description: "Check your email for a 6-digit code." });
    },
    onError: (err: any) => toast({ title: err?.message || "Couldn't send the code", variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <div>
        {/* No "Parent PIN" label here: the section header directly above
            already says it, and the duplicate sub-title sat close enough to
            the first input that its focus ring overlapped the text. The lock
            glyph (the "a PIN is already set" signal) moved onto the explainer
            line so it isn't lost with the label. */}
        {rewardSettings?.hasParentPin && !lockPinIfSet && (
          <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Lock className="w-3 h-3" data-testid="parent-pin-set-lock" />
            A PIN is already set. Enter a new one below to change it.
          </p>
        )}
        {lockPinIfSet && rewardSettings?.hasParentPin ? (
          <p className="text-[11px] text-muted-foreground mt-1">
            A PIN is already set. Ask whoever set it up, or change it in Settings → Rewards &amp; Approvals.
          </p>
        ) : (
          <>
            {!rewardSettings?.hasParentPin && (
              <p className="text-[11px] text-muted-foreground mb-1">
                Set a 4-digit PIN to protect cash-out approvals, and anything else you lock below.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PasswordInput
                inputMode="numeric"
                maxLength={4}
                placeholder="New PIN"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="tracking-widest h-8 text-xs"
              />
              <PasswordInput
                inputMode="numeric"
                maxLength={4}
                placeholder={rewardSettings?.hasParentPin ? "••••" : "Confirm PIN"}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="tracking-widest h-8 text-xs"
              />
            </div>
            {newPin && confirmPin && newPin !== confirmPin && (
              <p className="text-[11px] text-destructive mt-1">PINs don't match</p>
            )}
            {newPin.length > 0 && newPin.length < 4 && (
              <p className="text-[11px] text-muted-foreground mt-1">PIN must be 4 digits</p>
            )}

            {/* Changing an EXISTING PIN requires proving you're the parent —
                otherwise anyone using the family's shared login (a kid on the
                un-gated "All Family" profile, say) could just overwrite it.
                Setting the very first PIN needs no proof: there's nothing to
                take over yet. */}
            {rewardSettings?.hasParentPin && newPin.length > 0 && (
              <div className="mt-2 rounded-lg border border-border bg-background/60 p-2 space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  {useEmailCode
                    ? "Enter the 6-digit code we emailed you."
                    : "Confirm it's you: enter your account password."}
                </p>
                {useEmailCode ? (
                  <>
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={pinResetCode}
                      onChange={(e) => setPinResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="tracking-widest h-8 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => requestCodeMutation.mutate()}
                        disabled={requestCodeMutation.isPending}
                        className="text-[11px] text-primary hover:underline disabled:opacity-50"
                      >
                        {requestCodeMutation.isPending ? "Sending…" : codeSent ? "Resend code" : "Email me a code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setUseEmailCode(false); setPinResetCode(""); }}
                        className="text-[11px] text-muted-foreground hover:underline ml-auto"
                      >
                        Use password instead
                      </button>
                    </div>
                    {codeSent && (
                      <p className="text-[11px] text-muted-foreground">
                        Sent to {codeSent}. It expires in 10 minutes.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <PasswordInput
                      placeholder="Account password"
                      value={accountPassword}
                      onChange={(e) => setAccountPassword(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => { setUseEmailCode(true); setAccountPassword(""); }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Forgot your PIN? Email me a code
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t pt-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-xs font-medium">Require a Parent PIN for locked actions</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Off is fine if no kids use their own profile. Cash-outs and reward suggestions stay
              protected either way.
            </p>
          </div>
          <Switch
            checked={pinEnabled}
            onCheckedChange={setPinEnabled}
            data-testid="pin-gate-master-toggle"
            className="shrink-0"
          />
        </div>
        {pinEnabled && (
          // PINLIST-3: indented under the switch that controls it, with a
          // rule line. All three labels in this section were the same size
          // and weight, so a real parent-child structure read as a flat list
          // of three peers — nothing showed that this checklist only exists
          // because the toggle above is on. Same left-rule treatment the
          // Announcements sections already use; no labels or sizes changed.
          <div className="mt-2 pl-3.5 border-l-2 border-border">
            <Label className="text-xs font-medium">Lock behind the Parent PIN</Label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              When a kid's own profile is the only one selected, these require the PIN above.
            </p>
            <p className="text-[11px] font-medium text-muted-foreground mt-2 mb-1">
              Recommended — checked by default
            </p>
            <div className="space-y-1">
              {PIN_GATE_FEATURES.filter((f) => f.recommended).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-background/60 text-sm cursor-pointer">
                  <Checkbox
                    checked={pinGatedFeatures.includes(key)}
                    onCheckedChange={(checked) =>
                      setPinGatedFeatures((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-[11px] font-medium text-muted-foreground mt-3 mb-1">
              Only lock these if you want a more secure app for your kids
            </p>
            <div className="space-y-1">
              {PIN_GATE_FEATURES.filter((f) => !f.recommended).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-background/60 text-sm cursor-pointer">
                  <Checkbox
                    checked={pinGatedFeatures.includes(key)}
                    onCheckedChange={(checked) =>
                      setPinGatedFeatures((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <Button
        size="sm"
        onClick={() => saveMutation.mutate()}
        disabled={
          saveMutation.isPending ||
          (newPin.length > 0 && (newPin !== confirmPin || newPin.length !== 4)) ||
          // Changing an existing PIN needs proof of identity first.
          (newPin.length > 0 &&
            !!rewardSettings?.hasParentPin &&
            (useEmailCode ? pinResetCode.length !== 6 : accountPassword.length === 0))
        }
        className="w-full h-8"
      >
        {saveMutation.isPending ? "Saving…" : wizard ? "Save & Continue →" : "Save PIN settings"}
      </Button>
    </div>
  );
}

interface PendingCashout {
  id: string;
  profileId: string;
  requestedPoints: number;
  requestedCents: number;
  note: string | null;
  createdAt: string;
}


function ParentControlsSettingsSection({ profiles }: { profiles: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/reward-settings/verify-pin", { pin: pinInput })).json(),
    onSuccess: (data: { ok: boolean }) => {
      if (data.ok) { setUnlocked(true); setPinError(""); setPinDialogOpen(false); setPinInput(""); }
      else { setPinError("Incorrect PIN"); setPinInput(""); }
    },
    onError: (err: any) => setPinError(err?.message ?? "Couldn't check the PIN — please try again."),
  });

  const { data: pendingCashouts = [] } = useQuery<PendingCashout[]>({
    queryKey: ["/api/wallet/pending"],
    enabled: unlocked,
  });

  // These previously POSTed to /api/wallet/cashout/:id/... — endpoints that
  // never existed (the real ones are /api/wallet/requests/:id/...), so every
  // button in this panel 404'd and, with no onError, silently did nothing.
  const approveMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/wallet/requests/${id}/approve`, {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wallet"] });
      qc.invalidateQueries({ queryKey: ["/api/points"] });
      toast({ title: "Cash-out approved" });
    },
    onError: (err: any) => toast({ title: "Couldn't approve cash-out", description: err?.message, variant: "destructive" }),
  });

  const declineMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/wallet/requests/${id}/decline`, {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wallet"] });
      qc.invalidateQueries({ queryKey: ["/api/points"] });
      toast({ title: "Request declined" });
    },
    onError: (err: any) => toast({ title: "Couldn't decline cash-out", description: err?.message, variant: "destructive" }),
  });

  const hasPin = rewardSettings?.hasParentPin;
  const profileName = (id: string) => profiles.find(p => p.id === id)?.name ?? "Unknown";

  if (!hasPin) {
    return (
      <p className="text-xs text-muted-foreground">
        No parent PIN set. Add one in the <strong>Rewards &amp; Approvals</strong> section below.
      </p>
    );
  }

  if (!unlocked) {
    // The PIN is entered in a dialog, not inline here — matching the Chores
    // tab's own Cash-Out Approvals unlock exactly. An inline PIN box sitting
    // in a settings list reads as "why am I being asked for this?"; a button
    // that opens a PIN prompt states the reason at the moment it's asked.
    return (
      <>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Cash-out approvals</span>
          </span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setPinInput(""); setPinError(""); setPinDialogOpen(true); }} data-testid="approvals-unlock-button">
            Unlock
          </Button>
        </div>
        <Dialog open={pinDialogOpen} onOpenChange={(o) => { if (!o) { setPinDialogOpen(false); setPinInput(""); setPinError(""); } }}>
          <DialogContent className="max-w-xs" autoFocusFirst>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" /> Parent PIN required
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter the Parent PIN to review and approve cash-out requests.</p>
              <PasswordInput
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit PIN"
                value={pinInput}
                onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                onKeyDown={(e) => e.key === "Enter" && pinInput.length === 4 && verifyMutation.mutate()}
                data-testid="approvals-pin-input"
              />
              {pinError && <p className="text-xs text-destructive">{pinError}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setPinDialogOpen(false); setPinInput(""); setPinError(""); }}>Cancel</Button>
              <Button onClick={() => verifyMutation.mutate()} disabled={pinInput.length !== 4 || verifyMutation.isPending}>
                {verifyMutation.isPending ? "Checking…" : "Unlock"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-green-600 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Unlocked</p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setUnlocked(false); setPinInput(""); }}>
          <Lock className="w-3 h-3 mr-1" /> Lock
        </Button>
      </div>

      <div>
        <p className="text-xs font-medium mb-2">Pending cash-out requests</p>
        {pendingCashouts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pending requests.</p>
        ) : (
          <div className="space-y-2">
            {pendingCashouts.map(tx => {
              const dollars = (tx.requestedCents / 100).toFixed(2);
              const symbol = rewardSettings?.currencySymbol ?? "$";
              return (
                <div key={tx.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 text-xs">
                  <div>
                    <span className="font-medium">{profileName(tx.profileId)}</span>
                    <span className="text-muted-foreground ml-1">— {tx.requestedPoints} ⭐ ({symbol}{dollars})</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-green-600 hover:text-green-700"
                      onClick={() => approveMutation.mutate(tx.id)} disabled={approveMutation.isPending}>
                      <CheckCircle className="w-3 h-3 mr-0.5" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                      onClick={() => declineMutation.mutate(tx.id)} disabled={declineMutation.isPending}>
                      <XCircle className="w-3 h-3 mr-0.5" /> Decline
                    </Button>
                    {/* No per-request "Paid" button: marking money as handed
                        over is a per-profile wallet action (the Wallet card's
                        "Mark paid"), not a pending-request action — the old
                        button here called an endpoint that never existed. */}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: Profile[];
  hiddenTabs?: string[];
  setHiddenTabs?: (tabs: string[]) => void;
  defaultTab?: string;
  setDefaultTab?: (tab: string) => void;
  tabOrder?: string[];
  setTabOrder?: (order: string[]) => void;
  navIconsOnly?: boolean;
  setNavIconsOnly?: (value: boolean) => void;
  onReplayOnboarding?: () => void;
  /** Section id (matches each SettingsSection's own `id`) to auto-expand the
   * next time the modal opens — e.g. a "Connect your calendar" link from a
   * Home card deep-linking straight to "Calendars & Sharing". */
  initialOpenSectionId?: string | null;
  /** Profile id to auto-expand within the Calendar section's per-person
   * calendar list — e.g. tapping a "Google Calendar couldn't sync" banner
   * should land directly on the affected person's row, not just the section. */
  initialCalendarProfileId?: string | null;
  /** Spotlights the whole Calendar Connections list (rather than one
   * profile's row) the next time the modal opens — used when there's no
   * single specific person to point at, e.g. Home's "no calendar connected
   * yet" empty state, where any of several profiles could be the one to
   * connect. */
  initialCalendarSpotlightAll?: boolean;
  /** A tab id (e.g. "todos") to scroll to and briefly highlight within
   * Display & Layout's Tab Order & Visibility list — used by the "features
   * you might have missed" nudge so its "Turn it on" button lands on the
   * exact checkbox instead of just the general section. */
  initialHighlightTabId?: string | null;
}

function deriveInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// "behaviour" deliberately omitted — see the matching note on ALL_TABS above.
const TOGGLEABLE_TABS: { id: string; label: string }[] = [];

// Keyword index for the Settings search box — each section's list is a
// superset of its title plus the individual features/fields it contains, so
// searching "PIN" or "timezone" finds the right section without the user
// needing to know its exact heading.
const SECTION_KEYWORDS: Record<string, string[]> = {
  groups: ["custom groups", "groups", "group", "adults", "kids", "select several"],
  people: ["people", "profiles", "profile", "kids", "children", "add person", "avatar", "initials", "role", "kid", "grown-up"],
  account: ["account", "family", "display name", "city", "state", "location", "timezone", "replay setup", "walkthrough", "password", "family name", "leave family", "rename family"],
  sharing: ["sharing", "invite", "invite code", "invite someone", "join", "share link", "caretaker", "grandparent"],
  calendar: ["calendar", "google calendar", "outlook", "ical", "sync", "write target", "two-way sync"],
  appearance: ["display", "layout", "theme", "dark mode", "tab order", "tabs", "visibility", "nav", "screensaver", "screen saver", "idle", "sleep", "clock"],
  rewards: ["rewards", "approvals", "cash-out", "cashout", "cash out", "redemption", "points", "stars", "cents per point", "per star", "parent pin", "pin", "permissions", "lock", "kid restrictions", "gate", "streaks", "streak freeze", "skip days", "days off", "checklist bonus"],
  notifications: ["notifications", "push", "devices", "this device", "notification types", "event reminders", "test notification", "per-person", "per person", "bedtime", "daily brief", "morning brief", "weekly recap", "reminders"],
  subscription: ["subscription", "trial", "free trial", "manage subscription", "billing", "upgrade", "subscribe"],
};

// Declared at module scope (not inside SettingsModal) so it keeps a stable
// component identity across renders — an inline component redeclared inside
// a parent's render body gets treated by React as a brand-new component type
// on every re-render, forcing a full unmount/remount of its subtree. That
// broke every Input inside these sections (e.g. Display Name, City, State):
// each keystroke updated SettingsModal's state, which redeclared this
// component, which remounted the Input and dropped keyboard focus.
/**
 * A collapsible block *inside* a settings section. Same visual weight as the
 * uppercase labels it replaces, so a section reads as a list of named parts
 * rather than one long scroll. Module scope on purpose: declaring a component
 * inside another component's body gives it a new identity every render, which
 * unmounts and remounts its whole subtree (see SettingsSection/DayToggle).
 */
const SubSection = ({
  title,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  testId: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left mb-2"
        aria-expanded={open}
        data-testid={`subsection-${testId}`}
      >
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex-1">{title}</span>
        {open
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && children}
    </div>
  );
};

const SettingsSection = ({
  id,
  title,
  icon,
  isOpen: sectionOpen,
  onToggle,
  children,
  hidden,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  hidden?: boolean;
}) => hidden ? null : (
  <div data-section-id={id} className="rounded-xl overflow-hidden border border-border shrink-0">
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between py-3 px-4 text-left transition-colors ${
        sectionOpen
          ? "bg-primary/20 text-primary border-b border-primary/30 font-semibold"
          : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-foreground"
      }`}
    >
      <span className="flex items-center gap-2 font-semibold text-sm">
        <span className={sectionOpen ? "text-primary" : "text-muted-foreground"}>
          {icon}
        </span>
        {title}
      </span>
      <ChevronDown
        className={`w-4 h-4 transition-transform duration-200 ${sectionOpen ? "rotate-180 text-primary" : "text-muted-foreground"}`}
      />
    </button>
    <AnimatePresence initial={false}>
      {sectionOpen && (
        <motion.div
          key={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } }}
          style={{ overflow: "hidden" }}
        >
          <div className="px-2 pb-4 pt-3 bg-card border-l-2 border-primary/20">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// Shared "connected calendars, assigned to family members" list — used for
// both Google and Outlook so the two look and behave identically (same
// loading/error/empty states, same card layout, same "Primary" badge
// styling) regardless of which provider a family happens to use. Previously
// these were two hand-rolled, drifted-apart blocks: only Google showed a
// per-connection reconnect card and an empty-state message, only Outlook
// grouped calendars under a collapsible per-email header (redundant here
// since each connected profile only ever has one linked account either way),
// and Outlook's "default calendar" badge used a hardcoded brand-blue instead
// of the same theme-aware primary color Google's "Primary" badge used.
interface CalendarAssignmentCalendar {
  id: string;
  name: string;
  color?: string;
  isPrimary: boolean;
  profileId: string;
  // Carried straight through from the available-calendars endpoint (same
  // data CalendarSelectionModal used to read in its own separate popup) —
  // lets this same expanded row show + edit "does this calendar sync at
  // all" and "is this where new events get pushed" alongside assignment.
  selected?: boolean;
  isWriteTarget?: boolean;
  canWrite?: boolean;
}

// Sentinel for "use the account's primary/default calendar" (writeCalendarId
// null server-side) — the write-target Select needs a non-empty string value.
const DEFAULT_WRITE_TARGET = "__default__";

// Per-(person, provider) calendar list — checkboxes for which calendars
// sync, Assign-to, and "Create new events in". One component instance per
// profile+type (mirrors the GroceryRow/StapleRow pattern already used
// elsewhere in this app: a list item owns its own mutations/local state,
// rather than one component instance internally looping every row), so it
// can be dropped straight into a single unified per-person row instead of
// living in its own separate list. Same endpoints, same save-on-change
// behavior as before — only the calling shape changed (one profile at a
// time instead of a whole connectedProfiles array).
function PersonCalendarTypeSection({
  calendarType,
  profile,
  query,
  calendars,
  profiles,
  calendarAssignments,
  pendingAudiences,
  setPendingAudiences,
  saveCalendarAssignmentMutation,
  onReconnect,
  isExpanded,
}: {
  calendarType: "google" | "outlook";
  profile: Profile;
  query: { isLoading: boolean; isError: boolean; data: unknown } | undefined;
  /** Full flat list across every connected profile of this type — filtered
   * to this one profile internally, same as the old calendarsByProfile map. */
  calendars: CalendarAssignmentCalendar[];
  profiles: Profile[];
  calendarAssignments: any[];
  pendingAudiences: Record<string, string[]>;
  setPendingAudiences: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  saveCalendarAssignmentMutation: ReturnType<typeof useMutation<any, Error, { calendarId: string; profileId: string; profileIds: string[]; calendarType: "google" | "outlook"; calendarName: string; calendarColor: string; emailAddress: string }>>;
  onReconnect: (profileId: string) => void;
  /** Controlled by the single chevron on the unified per-person row above —
   * this component no longer owns its own expand/collapse state. */
  isExpanded: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const FALLBACK_COLOR = "#888888";
  const base = calendarType === "google" ? "google-calendar" : "outlook-calendar";
  const providerLabel = calendarType === "google" ? "Google" : "Outlook";

  // Which calendars sync at all, and where new events get pushed — this used
  // to live in a separate "Manage" popup (CalendarSelectionModal), hitting
  // these exact same two endpoints from its own Save button. Saves
  // immediately on each change, matching how the "Assign to" dropdown right
  // below it already auto-saves with no separate Save step. Scoped to a
  // single profile now (plain values, not a Record keyed by profileId).
  const [pendingSelected, setPendingSelected] = useState<Set<string> | null>(null);
  const [pendingWriteTarget, setPendingWriteTarget] = useState<string | null>(null);

  const saveSelectedCalendarsMutation = useMutation({
    mutationFn: async (calendarIds: string[]) => {
      await apiRequest("POST", `/api/${base}/selected-calendars/${profile.id}`, { calendarIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${base}/available-calendars`, profile.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/${base}/events`, profile.id] });
    },
    onError: () => {
      toast({ title: `Couldn't save which ${providerLabel} calendars sync`, variant: "destructive" });
    },
  });

  const saveWriteTargetMutation = useMutation({
    mutationFn: async (calendarId: string | null) => {
      await apiRequest("POST", `/api/${base}/write-target/${profile.id}`, { calendarId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${base}/available-calendars`, profile.id] });
    },
    onError: () => {
      toast({ title: `Couldn't save where new ${providerLabel} events go`, variant: "destructive" });
    },
  });

  const profileCalendars = calendars.filter((c) => (c.profileId || "") === profile.id);

  const toggleCalendarSelected = (calendarId: string) => {
    const current = pendingSelected ?? new Set(profileCalendars.filter((c) => c.selected).map((c) => c.id));
    const next = new Set(current);
    if (next.has(calendarId)) next.delete(calendarId);
    else next.add(calendarId);
    setPendingSelected(next);
    saveSelectedCalendarsMutation.mutate(Array.from(next));
  };

  const setWriteTarget = (calendarId: string) => {
    setPendingWriteTarget(calendarId);
    saveWriteTargetMutation.mutate(calendarId === DEFAULT_WRITE_TARGET ? null : calendarId);
  };

  // Reconnection needed, loading, and "no calendars found" all rendered
  // unconditionally (not gated by isExpanded) — same as before this merge,
  // so a problem is visible without needing to expand the row first.
  if (query?.isError || (query?.data && !Array.isArray(query.data))) {
    return (
      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">
              {providerLabel} Calendar needs reconnection
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The connection has expired or been revoked.
            </p>
          </div>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={() => onReconnect(profile.id)}
            data-testid={`reconnect-${calendarType}-calendar-${profile.id}`}
          >
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  if (query?.isLoading) {
    return <p className="text-xs text-muted-foreground px-1">Loading {providerLabel} calendars…</p>;
  }

  if (profileCalendars.length === 0) {
    // Was plain muted body text with no icon, colour, or action — a broken
    // connection read as a footnote. Same treatment as the reconnect state
    // above, since it usually means the same thing.
    return (
      <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-md">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              No {providerLabel} calendars found
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {providerLabel} didn't return any calendars for this account — usually a permissions problem. Reconnecting re-asks for access.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={() => onReconnect(profile.id)}
            data-testid={`recheck-${calendarType}-calendar-${profile.id}`}
          >
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  if (!isExpanded) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
        {providerLabel} calendars
      </p>
      {profileCalendars.map((calendar) => {
        const assignment = calendarAssignments.find(
          (a: any) => a.calendarId === calendar.id && a.calendarType === calendarType,
        );
        const ownerProfile = profiles.find((p) => p.id === calendar.profileId);
        // Use pending assignment if exists, then a saved assignment, then default to
        // the connecting profile — the calendar view already implicitly treats an
        // unassigned calendar's events as belonging to whoever connected it, so
        // showing "unassigned" here was misleading, not neutral.
        const assignedProfileId = assignment?.profileId || ownerProfile?.id || "";
        const isSelected = (pendingSelected ?? new Set(profileCalendars.filter((c) => c.selected).map((c) => c.id))).has(calendar.id);

        return (
          <div key={calendar.id} className={`flex flex-col gap-2 p-2 rounded-md bg-muted/50 border ${isSelected ? "" : "opacity-60"}`}>
            {/* First row: calendar info + whether it syncs into Family Hub at all
                (previously only editable in a separate "Manage" popup). */}
            <div className="flex items-center gap-3">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleCalendarSelected(calendar.id)}
                data-testid={`calendar-checkbox-${calendar.id}`}
                aria-label="Watch"
              />
              <span className="text-xs text-muted-foreground">Watch</span>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: calendar.color || FALLBACK_COLOR }}
                />
                <span className="text-sm font-medium truncate">{calendar.name}</span>
                {calendar.isPrimary && (
                  <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                    Primary
                  </span>
                )}
              </div>
            </div>

            {/* Second row: Assignment dropdown */}
            <div className="flex items-center gap-2 pl-8 flex-wrap">
              <span className="text-xs text-muted-foreground min-w-fit">Who it's for</span>
              {profiles.filter((p) => !p.isAllFamilyProfile).map((p) => {
                const savedAudience: string[] = Array.isArray(assignment?.audienceProfileIds) && assignment.audienceProfileIds.length > 0
                  ? assignment.audienceProfileIds
                  : assignedProfileId ? [assignedProfileId] : [];
                const audience = pendingAudiences[calendar.id] ?? savedAudience;
                const on = audience.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    data-testid={`who-for-${calendar.id}-${p.id}`}
                    className="rounded-full px-2 py-0.5 text-xs border border-border"
                    style={on ? { background: "#5E8FAD", color: "white" } : undefined}
                    onClick={() => {
                      const next = on ? audience.filter((id) => id !== p.id) : [...audience, p.id];
                      if (next.length === 0) return;
                      setPendingAudiences((prev) => ({ ...prev, [calendar.id]: next }));
                      saveCalendarAssignmentMutation.mutate({
                        calendarId: calendar.id,
                        profileId: next[0],
                        profileIds: next,
                        calendarType,
                        calendarName: calendar.name,
                        calendarColor: calendar.color || FALLBACK_COLOR,
                        emailAddress: ownerProfile?.email || "",
                      });
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Where new Family Hub events get pushed for this account (previously
          the bottom half of the same separate "Manage" popup). */}
      {(() => {
        const writableCalendars = profileCalendars.filter((c) => c.canWrite);
        if (writableCalendars.length === 0) return null;
        const currentWriteTarget = pendingWriteTarget ?? (profileCalendars.find((c) => c.isWriteTarget)?.id ?? DEFAULT_WRITE_TARGET);
        return (
          <div className="pt-2 mt-1 border-t border-border">
            <p className="text-xs font-medium text-foreground">Create new events in</p>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              When Family Hub+ pushes a new event to {providerLabel}, it goes here.
            </p>
            <Select value={currentWriteTarget} onValueChange={setWriteTarget}>
              <SelectTrigger className="h-7 text-xs" data-testid={`select-write-target-${profile.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_WRITE_TARGET}>
                  {calendarType === "google" ? "Primary calendar" : "Default calendar"}
                </SelectItem>
                {writableCalendars.map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    {cal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Everything needed to connect each family member's Google/Outlook calendar,
 * choose which of their calendars sync, who they're assigned to, and where
 * new events go — the exact same UI/logic Settings' own "Calendar" section
 * has always used, extracted into a standalone component (2026-08-27) so
 * onboarding's new "Connect your calendars" step can render the real thing
 * instead of a stripped-down copy. Fully self-contained: owns its own
 * queries/mutations, so it can be dropped in anywhere a `profiles` list is
 * available.
 */
export function CalendarConnectionsSection({
  profiles,
  isOpen = true,
  initialCalendarProfileId,
  initialCalendarSpotlightAll,
  onBeforeWebRedirect,
}: {
  profiles: Profile[];
  /** Whether the host screen is currently visible — gates the two
   * auto-expand-driven-by-prop effects below (Settings passes its own
   * Dialog `isOpen`; a host with no such concept, like an onboarding step,
   * can just leave this at its default of `true`). */
  isOpen?: boolean;
  /** Auto-expands and spotlights one specific profile's row — e.g. right
   * after finishing a connect, or a "couldn't sync" banner deep-linking to
   * the affected person. */
  initialCalendarProfileId?: string | null;
  /** Spotlights the whole list instead of one row — used when there's no
   * single specific person to point at (e.g. Home's "no calendar connected
   * yet" empty state). */
  initialCalendarSpotlightAll?: boolean;
  /** Called immediately before a WEB (non-native) OAuth connect navigates
   * the whole page away — native uses an in-app browser session and never
   * needs this. Lets a host that has its own in-memory step/flow state (the
   * onboarding wizard) stash where to resume once the redirect comes back,
   * since a full page navigation would otherwise silently reset it. */
  onBeforeWebRedirect?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { spotlight, spotlightOverlay } = useSpotlight();

  const [pendingAudiences, setPendingAudiences] = useState<Record<string, string[]>>({});

  // Find ALL profiles with Google Calendar connections
  const googleConnectedProfiles = profiles.filter(p => p.googleCalendarConnected);
  // Find ALL profiles with Outlook Calendar connections
  const outlookConnectedProfiles = profiles.filter(p => p.outlookCalendarConnected);

  // Fetch available Google calendars for ALL connected profiles using useQueries
  const googleCalendarQueries = useQueries({
    queries: googleConnectedProfiles.map(profile => ({
      queryKey: ["/api/google-calendar/available-calendars", profile.id],
      enabled: !!profile.googleCalendarConnected,
      retry: false,
    }))
  });

  // Combine all Google calendars from all connected profiles
  const allGoogleCalendars = googleConnectedProfiles.flatMap((profile, index) => {
    const calendars = googleCalendarQueries[index]?.data;
    if (!Array.isArray(calendars)) return [];
    return calendars.map((calendar: any) => ({
      ...calendar,
      profileId: profile.id,
      profileName: profile.name,
      profileColor: profile.color,
    }));
  });

  // Fetch available Outlook calendars for ALL connected profiles using useQueries
  const outlookCalendarQueries = useQueries({
    queries: outlookConnectedProfiles.map(profile => ({
      queryKey: ["/api/outlook-calendar/available-calendars", profile.id],
      enabled: !!profile.outlookCalendarConnected,
      retry: false,
    }))
  });

  // Combine all Outlook calendars from all connected profiles
  const allOutlookCalendars = outlookConnectedProfiles.flatMap((profile, index) => {
    const calendars = outlookCalendarQueries[index]?.data;
    if (!Array.isArray(calendars)) return [];
    return calendars.map((calendar: any) => ({
      ...calendar,
      profileId: profile.id,
      profileName: profile.name,
      profileColor: profile.color,
    }));
  });


  // Fetch existing calendar assignments
  const { data: calendarAssignments = [] } = useQuery<any[]>({
    queryKey: ["/api/calendar-assignments"],
    enabled: googleConnectedProfiles.length > 0 || outlookConnectedProfiles.length > 0,
    retry: false,
  });

  // Two-way sync: read current setting + toggle mutation
  const { data: calendarSettingsData } = useQuery<{
    twoWaySyncEnabled?: boolean | null;
    familyCalendarId?: string | null;
    familyCalendarProfileId?: string | null;
    familyCalendarProvider?: string | null;
    scanInbox?: boolean | null;
    shareOriginals?: boolean | null;
  }>({
    queryKey: ["/api/calendar-settings"],
  });
  // `!== false`, not `=== true`: the DB column defaults to true, but a family
  // with no calendar_settings row yet returns undefined here — which read as
  // OFF, contradicting the documented default. An explicit false still wins.
  const twoWaySyncEnabled = calendarSettingsData?.twoWaySyncEnabled !== false;
  const scanInbox = calendarSettingsData?.scanInbox !== false;
  const shareOriginals = calendarSettingsData?.shareOriginals === true;

  // Recent two-way-sync failures — these were previously written to the
  // database (event_calendar_syncs.syncState/lastError) on every write-path
  // failure but never read by any frontend code, so a revoked OAuth consent
  // or a stale token could silently stop sync forever with no visible sign.
  const { data: syncErrors } = useQuery<{
    id: string; eventId: string; eventTitle: string; eventStartTime: string;
    provider: string; lastError: string | null; updatedAt: string; profileNames: string[];
  }[]>({
    queryKey: ["/api/calendar-sync-errors"],
    staleTime: 60_000,
  });

  const dismissSyncErrorMutation = useMutation({
    mutationFn: async ({ eventId, provider }: { eventId: string; provider: string }) => {
      await apiRequest("POST", `/api/calendar-sync-errors/${eventId}/${provider}/dismiss`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-sync-errors"] });
    },
    onError: () => {
      toast({ title: "Couldn't dismiss that error", variant: "destructive" });
    },
  });

  const twoWaySyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", "/api/calendar-settings/two-way-sync", { enabled });
    },
    onMutate: async (enabled: boolean) => {
      // Optimistic update so the switch responds instantly.
      await queryClient.cancelQueries({ queryKey: ["/api/calendar-settings"] });
      const prev = queryClient.getQueryData<any>(["/api/calendar-settings"]);
      queryClient.setQueryData(["/api/calendar-settings"], (old: any) => ({ ...(old ?? {}), twoWaySyncEnabled: enabled }));
      return { prev };
    },
    onError: (_err, _enabled, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(["/api/calendar-settings"], ctx.prev);
      toast({ title: "Couldn't update sync setting", variant: "destructive" });
    },
    onSuccess: (_data, enabled) => {
      toast({
        title: enabled ? "Two-way sync on" : "Two-way sync off",
        description: enabled
          ? "New events will be added to each assignee's connected calendar."
          : "App events will no longer be added to connected calendars.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
    },
  });

  const inboxMutation = useMutation({
    mutationFn: async (patch: { scanInbox?: boolean; shareOriginals?: boolean }) => {
      await apiRequest("PATCH", "/api/calendar-settings/inbox", patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
    },
  });
  const [scanNote, setScanNote] = useState<string | null>(null);
  const scanNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ingest/scan");
      return res.json() as Promise<{ todos: unknown[]; needsReconnect?: boolean; connected?: number; scanOff?: boolean }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      if (data.scanOff) setScanNote("Scan is off.");
      else if (data.needsReconnect) setScanNote("Reconnect the account to read mail.");
      else if (!data.connected) setScanNote("Connect an account first.");
      else setScanNote(data.todos.length ? `Added ${data.todos.length}.` : "No new school mail.");
    },
  });

  const familyCalendars = [
    ...allGoogleCalendars.map((calendar) => ({ provider: "google" as const, profileId: String(calendar.profileId), calendarId: String(calendar.id), name: String(calendar.name ?? calendar.id) })),
    ...allOutlookCalendars.map((calendar) => ({ provider: "outlook" as const, profileId: String(calendar.profileId), calendarId: String(calendar.id), name: String(calendar.name ?? calendar.id) })),
  ];
  const rememberedFamilyCalendar = useRef<string | null>(null);
  const familyCalendarMutation = useMutation({
    mutationFn: async (choice: { calendarId: string; profileId: string; provider: "google" | "outlook" } | null) => {
      await apiRequest("PATCH", "/api/calendar-settings/family-calendar", choice ?? { calendarId: null, profileId: null, provider: null });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
    },
  });
  useEffect(() => {
    const id = calendarSettingsData?.familyCalendarId;
    if (!id || calendarSettingsData?.familyCalendarProfileId) return;
    const matches = familyCalendars.filter((calendar) => calendar.calendarId === id);
    if (matches.length !== 1 || rememberedFamilyCalendar.current === id) return;
    rememberedFamilyCalendar.current = id;
    familyCalendarMutation.mutate({ calendarId: id, profileId: matches[0].profileId, provider: matches[0].provider });
  }, [calendarSettingsData?.familyCalendarId, calendarSettingsData?.familyCalendarProfileId, familyCalendars, familyCalendarMutation]);

  // Google Calendar disconnect mutation
  const disconnectGoogleCalendarMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await apiRequest("DELETE", `/api/google-calendar/disconnect/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({
        title: "Disconnected successfully",
        description: "You can now reconnect with updated permissions.",
      });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to disconnect", variant: "destructive" });
    },
  });

  // Outlook Calendar disconnect mutation
  const disconnectOutlookCalendarMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await apiRequest("DELETE", `/api/outlook-calendar/disconnect/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Disconnected successfully" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to disconnect", variant: "destructive" });
    },
  });

  // Calendar assignment mutation (supports both Google and Outlook)
  const saveCalendarAssignmentMutation = useMutation({
    mutationFn: async ({ calendarId, profileId, calendarType, calendarName, calendarColor, emailAddress }: { 
      calendarId: string; 
      profileId: string; 
      calendarType: 'google' | 'outlook';
      calendarName: string;
      calendarColor: string;
      emailAddress: string;
    }) => {
      const response = await apiRequest("POST", "/api/calendar-assignments", {
        calendarId,
        profileId,
        calendarType,
        calendarName,
        calendarColor,
        emailAddress,
      });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate calendar assignments query - when it refetches, the real data will be used
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-assignments"] });
      // Invalidate all Google Calendar event queries
      googleConnectedProfiles.forEach(profile => {
        queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events", profile.id] });
      });
      // Invalidate all Outlook Calendar event queries
      outlookConnectedProfiles.forEach(profile => {
        queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/events", profile.id] });
      });
      toast({ title: "Calendar assigned successfully!" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to assign calendar", variant: "destructive" });
    },
  });

  // Auto-expands a profile's calendar list (which calendars sync + who
  // they're assigned to + where new events go, all inline in the unified
  // per-person calendar card) right after a Google/Outlook connect
  // completes — previously this opened a separate "Manage" popup instead.
  const [autoExpandProfileId, setAutoExpandProfileId] = useState<string | null>(null);

  // One shared expand/collapse set for the unified Calendar Connections
  // list (moved here from being owned separately inside each of the two
  // now-removed CalendarAssignmentSection instances) — a single chevron per
  // person now controls both their Google and Outlook calendar details at
  // once, so there's one shared source of truth instead of two independent
  // ones that could disagree about whether a given person's row is open.
  const [expandedCalendarProfiles, setExpandedCalendarProfiles] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!autoExpandProfileId) return;
    setExpandedCalendarProfiles((prev) => new Set(prev).add(autoExpandProfileId));
    const t = setTimeout(() => {
      document.getElementById(`calendar-profile-row-${autoExpandProfileId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      spotlight(`calendar-profile-row-${autoExpandProfileId}`);
    }, 250);
    return () => clearTimeout(t);
  }, [autoExpandProfileId]);
  const toggleCalendarProfileExpanded = (profileId: string) => {
    setExpandedCalendarProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  };

  // Same auto-expand, but driven from OUTSIDE this component — e.g. tapping
  // a "Google Calendar couldn't sync" banner on the Calendar tab, which
  // deep-links straight to the affected person's row instead of just the
  // section. Re-fires whenever the modal opens with a fresh target, matching
  // the initialOpenSectionId effect's own [isOpen] pattern.
  useEffect(() => {
    if (isOpen && initialCalendarProfileId) {
      setAutoExpandProfileId(initialCalendarProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialCalendarProfileId]);

  // Spotlight the WHOLE Calendar Connections list (not one profile's row) —
  // used when there's no single specific person to point at, e.g. Home's
  // "no calendar connected yet" empty state. Mirrors the single-profile
  // auto-expand effect above, just targeting the list's own container id.
  useEffect(() => {
    if (!isOpen || !initialCalendarSpotlightAll) return;
    const t = setTimeout(() => {
      document.getElementById("calendar-connections-list")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      spotlight("calendar-connections-list");
    }, 250);
    return () => clearTimeout(t);
  }, [isOpen, initialCalendarSpotlightAll]);

  // Handle OAuth callback success and refresh calendar queries
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const googleCalendarConnected = urlParams.get('google_calendar_connected');
    const connectedProfileId = urlParams.get('profileId');

    if (googleCalendarConnected === 'true') {
      // Invalidate profile query to update connection status
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      
      // Invalidate calendar queries for the connected profile
      if (connectedProfileId) {
        queryClient.invalidateQueries({ 
          queryKey: ["/api/google-calendar/available-calendars", connectedProfileId] 
        });
        queryClient.invalidateQueries({ 
          queryKey: ["/api/google-calendar/events", connectedProfileId] 
        });
      }
      
      // Invalidate all calendar-related queries to be safe
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/accounts"] });

      // Show success toast
      toast({
        title: "Google Calendar connected successfully!",
        description: "Choose which calendars to sync below."
      });
      if (connectedProfileId) {
        setAutoExpandProfileId(connectedProfileId);
      }

      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (urlParams.get('outlook_calendar_connected') === 'true') {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      if (connectedProfileId) {
        queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/available-calendars", connectedProfileId] });
        queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/events", connectedProfileId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-assignments"] });
      toast({
        title: "Outlook Calendar connected successfully!",
        description: "Choose which calendars to sync below.",
      });
      if (connectedProfileId) {
        setAutoExpandProfileId(connectedProfileId);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // The web return path handled success only, so a failed connection came
    // back to a silent app — nothing said anything had gone wrong. Reachable
    // now that a connection link can legitimately expire.
    const webError =
      urlParams.get("google_calendar_error") ?? urlParams.get("outlook_calendar_error");
    if (webError) {
      toast({
        title: "Calendar connection failed",
        description: webError === "invalid_state"
          ? "That connection link expired. Tap Connect to start again."
          : webError === "access_denied"
            ? "You didn't finish signing in to that calendar account."
            : "Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [queryClient, toast]);

  const handleOAuthCallback = (callbackUrl: string) => {
    try {
      const qIndex = callbackUrl.indexOf("?");
      if (qIndex === -1) return;
      const params = new URLSearchParams(callbackUrl.slice(qIndex + 1));
      const connectedProfileId = params.get("profileId");
      if (params.get("google_calendar_connected") === "true") {
        queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        if (connectedProfileId) {
          queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/available-calendars", connectedProfileId] });
          queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events", connectedProfileId] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/calendar-assignments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/accounts"] });
        toast({ title: "Google Calendar connected successfully!", description: "Choose which calendars to sync below." });
        if (connectedProfileId) setAutoExpandProfileId(connectedProfileId);
      } else if (params.get("outlook_calendar_connected") === "true") {
        queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        if (connectedProfileId) {
          queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/available-calendars", connectedProfileId] });
          queryClient.invalidateQueries({ queryKey: ["/api/outlook-calendar/events", connectedProfileId] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/calendar-assignments"] });
        toast({ title: "Outlook Calendar connected successfully!", description: "Choose which calendars to sync below." });
        if (connectedProfileId) setAutoExpandProfileId(connectedProfileId);
      } else {
        const err = params.get("google_calendar_error") ?? params.get("outlook_calendar_error");
        if (err) {
          toast({
            title: "Calendar connection failed",
            // invalid_state means the link expired or was already used —
            // starting again fixes it, whereas "try again" on its own reads
            // as if something is broken.
            description: err === "invalid_state"
              ? "That connection link expired. Tap Connect to start again."
              : "Please try again.",
            variant: "destructive",
          });
        }
      }
    } catch { /* ignore malformed URL */ }
  };

  /**
   * Ask the server for a signed OAuth state.
   *
   * The client used to build this itself as bare JSON, which meant anyone who
   * knew a profile id could start a flow for it and have the resulting tokens
   * attached to someone else's profile. Minting is now an authenticated
   * server call that checks the profile really belongs to the caller; see
   * lib/oauthState.ts.
   *
   * Returns null and has already shown a message when it fails.
   */
  const mintCalendarState = async (
    profileId: string,
    provider: "google" | "outlook",
    native: boolean,
  ): Promise<string | null> => {
    try {
      // No redirect URL is sent any more — `native` is a flag and the server
      // derives the familyhub:// target itself, so nothing a client sends can
      // steer where the callback sends the browser.
      const res = await apiRequest("POST", "/api/auth/calendar/state", { profileId, provider, native });
      const { state } = await res.json();
      if (typeof state === "string" && state) return state;
      throw new Error("No state returned");
    } catch (err: any) {
      // apiRequest already unwraps the server's own sentence (it cannot see
      // the status code), so show that when there is one — a rejected
      // profile says why, rather than "try again", which would never work.
      const reason = typeof err?.message === "string" ? err.message.trim() : "";
      toast({
        title: "Couldn't start connecting your calendar",
        description: reason && !reason.startsWith("{") ? reason : "Please try again in a moment.",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleGoogleCalendarConnect = async (profileId: string) => {
    if (isNativePlatform()) {
      const state = await mintCalendarState(profileId, "google", true);
      if (!state) return;
      try {
        const loginUrl = apiUrl(`/api/auth/google?state=${encodeURIComponent(state)}`);
        const { url: callbackUrl } = await WebAuth.authenticate({ url: loginUrl, callbackScheme: "familyhub", ephemeral: true });
        handleOAuthCallback(callbackUrl);
      } catch (err: any) {
        if (err?.message !== "USER_CANCELLED") {
          toast({ title: "Calendar connection failed", description: "Please try again.", variant: "destructive" });
        }
      }
      return;
    }
    const state = await mintCalendarState(profileId, "google", false);
    if (!state) return;
    onBeforeWebRedirect?.();
    window.location.href = `/api/auth/google?state=${encodeURIComponent(state)}`;
  };

  const handleOutlookConnect = async (profileId: string) => {
    if (isNativePlatform()) {
      const state = await mintCalendarState(profileId, "outlook", true);
      if (!state) return;
      try {
        const loginUrl = apiUrl(`/api/auth/outlook?state=${encodeURIComponent(state)}`);
        const { url: callbackUrl } = await WebAuth.authenticate({ url: loginUrl, callbackScheme: "familyhub", ephemeral: true });
        handleOAuthCallback(callbackUrl);
      } catch (err: any) {
        if (err?.message !== "USER_CANCELLED") {
          toast({ title: "Calendar connection failed", description: "Please try again.", variant: "destructive" });
        }
      }
      return;
    }
    // The old web path used a bare ?profileId= query parameter, which the
    // server no longer accepts at all.
    const state = await mintCalendarState(profileId, "outlook", false);
    if (!state) return;
    onBeforeWebRedirect?.();
    window.location.href = `/api/auth/outlook?state=${encodeURIComponent(state)}`;
  };

  return (
    <>
      {spotlightOverlay}
            <div className="space-y-6">
            {/* Unified Per-Profile Calendar Connections — Google, Outlook & iCal.
                2026-08-18: connecting a person's calendar and configuring which
                of their calendars sync / where new events go used to be two
                separate lists, one stacked below the other — this merges them
                into a single row per person (connect from it, and once
                connected, the same row expands to reveal the calendar
                checkboxes, assignment, and write-target that used to live in a
                second list further down). No settings changed, no endpoints
                changed — see PersonCalendarTypeSection above, which now
                renders one profile's calendar details at a time instead of a
                whole list internally. */}
              <div>
                <h3 className="text-sm font-semibold mb-1" data-testid="connected-accounts-heading">Connected accounts</h3>
                <p className="text-[11px] text-muted-foreground mb-2">
                  One adult connects Google or Outlook. That account brings mail and calendars. A kid is not an account owner.
                </p>
                {/* Two-way sync toggle — compact, sits right under the section's own sub-text */}
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md bg-muted/50 mb-3">
                  <p className="text-xs text-foreground">
                    Add app events to watched calendars that can be written
                  </p>
                  <Switch
                    checked={twoWaySyncEnabled}
                    onCheckedChange={(checked) => twoWaySyncMutation.mutate(!!checked)}
                    disabled={twoWaySyncMutation.isPending}
                    data-testid="toggle-two-way-sync"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md bg-muted/50 mb-2">
                  <p className="text-xs text-foreground">
                    Scan inbox
                    <span className="ml-2 text-muted-foreground" data-testid="scan-inbox-state">{scanInbox ? "On" : "Scan off"}</span>
                  </p>
                  <Switch
                    checked={scanInbox}
                    onCheckedChange={(checked) => inboxMutation.mutate({ scanInbox: !!checked })}
                    data-testid="toggle-scan-inbox"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 mb-2">
                  <button
                    type="button"
                    className="text-xs underline"
                    data-testid="scan-inbox-now"
                    disabled={scanNow.isPending}
                    onClick={() => scanNow.mutate()}
                  >
                    Scan now
                  </button>
                  {scanNote && <span className="text-xs text-muted-foreground" data-testid="scan-inbox-note">{scanNote}</span>}
                </div>
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md bg-muted/50 mb-3">
                  <p className="text-xs text-foreground">Share originals with other adults</p>
                  <Switch
                    checked={shareOriginals}
                    onCheckedChange={(checked) => inboxMutation.mutate({ shareOriginals: !!checked })}
                    data-testid="toggle-share-originals"
                  />
                </div>
                <div className="mb-3">
                  <p className="text-xs font-medium mb-1">Family calendar</p>
                  <Select
                    value={familyCalendars.length === 0 ? (calendarSettingsData?.familyCalendarId || "none") : familyCalendarSelectValue(calendarSettingsData?.familyCalendarId, calendarSettingsData?.familyCalendarProfileId, familyCalendars)}
                    onValueChange={(value) => {
                      if (value === "none") {
                        familyCalendarMutation.mutate(null);
                        return;
                      }
                      const choice = parseFamilyCalendarOption(value);
                      if (choice) familyCalendarMutation.mutate(choice);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-family-calendar">
                      <SelectValue placeholder="Where new events are written" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not chosen yet</SelectItem>
                      {familyCalendars.length === 0 && calendarSettingsData?.familyCalendarId && (
                        <SelectItem value={calendarSettingsData.familyCalendarId}>{calendarSettingsData.familyCalendarId}</SelectItem>
                      )}
                      {familyCalendars.map((calendar) => (
                        <SelectItem key={familyCalendarOptionValue(calendar)} value={familyCalendarOptionValue(calendar)}>{calendar.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {syncErrors && syncErrors.length > 0 && (
                  <div className="mb-3 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 space-y-1.5">
                    <p className="text-xs font-medium text-destructive">
                      {syncErrors.length} event{syncErrors.length === 1 ? "" : "s"} recently failed to sync to Google/Outlook
                    </p>
                    <ul className="space-y-2">
                      {syncErrors.slice(0, 5).map((e) => (
                        <li key={`${e.eventId}:${e.provider}`} className="text-[11px] text-muted-foreground">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-medium text-foreground">{e.eventTitle}</span>{" "}
                              ({e.provider === "google" ? "Google" : "Outlook"}
                              {e.profileNames.length > 0 ? ` — ${e.profileNames.join(", ")}` : ""})
                              <br />
                              {e.eventStartTime && (
                                <>
                                  On your Family Hub+ calendar: {new Date(e.eventStartTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                  <br />
                                </>
                              )}
                              {e.lastError || "unknown error"}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] shrink-0"
                              disabled={dismissSyncErrorMutation.isPending}
                              onClick={() => dismissSyncErrorMutation.mutate({ eventId: e.eventId, provider: e.provider })}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      These events are still on your Family Hub+ calendar — only the copy pushed to Google/Outlook failed. Reconnect that calendar if it keeps happening.
                    </p>
                  </div>
                )}
                <div id="calendar-connections-list" className="space-y-2">
                  {(() => {
                    const realProfiles = profiles.filter(p => !p.isAllFamilyProfile);
                    if (realProfiles.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground">
                          Add family members in Profile Management above to connect their calendars.
                        </p>
                      );
                    }
                    // Computed once, reused for every profile below — same
                    // mapping the two separate lists used to do independently.
                    const mappedGoogleCalendars = allGoogleCalendars.map((c: any) => ({ ...c, isPrimary: !!c.primary }));
                    const mappedOutlookCalendars = allOutlookCalendars.map((c: any) => ({ ...c, isPrimary: !!c.isDefault }));
                    return realProfiles.map((profile) => {
                      const googleIdx = googleConnectedProfiles.findIndex(p => p.id === profile.id);
                      const outlookIdx = outlookConnectedProfiles.findIndex(p => p.id === profile.id);
                      const googleCalCount = mappedGoogleCalendars.filter(c => (c.profileId || "") === profile.id).length;
                      const outlookCalCount = mappedOutlookCalendars.filter(c => (c.profileId || "") === profile.id).length;
                      const totalCalCount = googleCalCount + outlookCalCount;
                      const isExpanded = expandedCalendarProfiles.has(profile.id);
                      // PersonCalendarTypeSection renders unconditionally
                      // (regardless of isExpanded) only for a reconnect-
                      // needed/loading/empty state — otherwise, once
                      // collapsed with nothing to report, it returns null.
                      // The detail wrapper below it must mirror that same
                      // condition, or a connected-but-collapsed-and-healthy
                      // profile renders an empty padded, bordered box with
                      // nothing inside it (exactly the "extra empty section"
                      // reported after reconnecting a calendar).
                      const googleQuery = googleIdx >= 0 ? googleCalendarQueries[googleIdx] : undefined;
                      const outlookQuery = outlookIdx >= 0 ? outlookCalendarQueries[outlookIdx] : undefined;
                      const queryNeedsAttention = (q: typeof googleQuery) =>
                        !!q && (q.isError || (q.data && !Array.isArray(q.data)) || q.isLoading);
                      const showCalendarDetail =
                        isExpanded ||
                        (googleIdx >= 0 && (queryNeedsAttention(googleQuery) || googleCalCount === 0)) ||
                        (outlookIdx >= 0 && (queryNeedsAttention(outlookQuery) || outlookCalCount === 0));
                      return (
                        <div key={profile.id} id={`calendar-profile-row-${profile.id}`} className="rounded-lg border border-border overflow-hidden">
                          <ProfileCalendarRow
                            profile={profile}
                            allowConnect={!(profile.role === "child" || profile.isChild)}
                            onGoogleConnect={handleGoogleCalendarConnect}
                            onGoogleDisconnect={(id) => disconnectGoogleCalendarMutation.mutate(id)}
                            onOutlookConnect={handleOutlookConnect}
                            onOutlookDisconnect={(id) => disconnectOutlookCalendarMutation.mutate(id)}
                          />
                          {totalCalCount > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleCalendarProfileExpanded(profile.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                              data-testid={`toggle-calendar-profile-${profile.id}`}
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                              <span className="text-xs text-muted-foreground flex-1">
                                {totalCalCount} calendar{totalCalCount === 1 ? "" : "s"}
                              </span>
                            </button>
                          )}
                          {showCalendarDetail && (googleIdx >= 0 || outlookIdx >= 0) && (
                            <div className="px-3 pb-3 pt-2 border-t border-border space-y-3">
                              {/* Was on every collapsed row, three lines each. It
                                  only matters once you've opened one. */}
                              {isExpanded && (
                                <p className="text-xs text-muted-foreground">
                                  Choose which calendars sync, who they're assigned to, and where new events go.
                                </p>
                              )}
                              {googleIdx >= 0 && (
                                <PersonCalendarTypeSection
                                  calendarType="google"
                                  profile={profile}
                                  query={googleCalendarQueries[googleIdx]}
                                  calendars={mappedGoogleCalendars}
                                  profiles={profiles}
                                  calendarAssignments={calendarAssignments}
                                  pendingAudiences={pendingAudiences}
                                  setPendingAudiences={setPendingAudiences}
                                  saveCalendarAssignmentMutation={saveCalendarAssignmentMutation}
                                  onReconnect={handleGoogleCalendarConnect}
                                  isExpanded={isExpanded}
                                />
                              )}
                              {outlookIdx >= 0 && (
                                <PersonCalendarTypeSection
                                  calendarType="outlook"
                                  profile={profile}
                                  query={outlookCalendarQueries[outlookIdx]}
                                  calendars={mappedOutlookCalendars}
                                  profiles={profiles}
                                  calendarAssignments={calendarAssignments}
                                  pendingAudiences={pendingAudiences}
                                  setPendingAudiences={setPendingAudiences}
                                  saveCalendarAssignmentMutation={saveCalendarAssignmentMutation}
                                  onReconnect={handleOutlookConnect}
                                  isExpanded={isExpanded}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

            </div>
    </>
  );
}

export function SettingsModal({ isOpen, onClose, profiles, hiddenTabs = [], setHiddenTabs, defaultTab = 'home', setDefaultTab, tabOrder, setTabOrder, navIconsOnly = false, setNavIconsOnly, onReplayOnboarding, initialOpenSectionId, initialCalendarProfileId, initialCalendarSpotlightAll, initialHighlightTabId }: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);
  const [passwordResetMsg, setPasswordResetMsg] = useState("");
  const { theme, setTheme } = useTheme();
  // Per-device, like the other display preferences — a family's counter iPad
  // wants this and their phones do not.
  const [screensaverOn, setScreensaverOn] = useState(isScreensaverEnabled);
  const themeCycle: ThemeMode[] = ["light", "dark", "system"];
  const cycleTheme = () => setTheme(themeCycle[(themeCycle.indexOf(theme) + 1) % 3]);
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Match device";
  const [kbOpen, setKbOpen] = useState(false);
  const { spotlight, spotlightOverlay } = useSpotlight();
  // One-off verification for the Sentry wiring (2026-08-24) — fires both a
  // frontend-captured exception and a backend one (via the new
  // /api/debug/sentry-test route) in a single tap, so a real event can be
  // confirmed in both Sentry dashboards. Button only renders when
  // sentryEnabled (i.e. VITE_SENTRY_DSN is actually set) — see below.
  const sendSentryTest = useMutation({
    mutationFn: async () => {
      captureTestError();
      await apiRequest("POST", "/api/debug/sentry-test");
    },
    onSuccess: () => toast({ title: "Test error sent", description: "Check both Sentry dashboards — it can take a minute to show up." }),
    onError: (err: any) => toast({ title: "Couldn't send the test", description: err?.message, variant: "destructive" }),
  });
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  // COPPA parental-consent gate (shown when saving a child profile without consent)
  const [consentGateOpen, setConsentGateOpen] = useState(false);
  const [consentAffirmed, setConsentAffirmed] = useState(false);
  // Parent PIN gate specifically for switching an existing profile between
  // Grown-up and Kid — always required, independent of the optional
  // PIN_GATE_FEATURES checklist (see handleSubmit).
  const [roleChangePinOpen, setRoleChangePinOpen] = useState(false);
  // After the role-change PIN gate saves, the profile list re-renders with the
  // editor closed — leaving you somewhere else in a long list with no sign of
  // what just happened. Remember which profile it was so we can reopen its
  // editor and scroll back to it.
  const resumeEditProfileIdRef = useRef<string | null>(null);
  const [roleChangePinInput, setRoleChangePinInput] = useState("");
  const [roleChangePinError, setRoleChangePinError] = useState("");

  // Tab drag-to-reorder state (pointer-events based — works reliably inside modals)
  const buildOrder = (base: string[] | undefined) => {
    const arr = base && base.length > 0 ? base : ALL_TABS.map(t => t.id);
    const withHome = arr.includes('home') ? arr : ['home', ...arr];
    // Append any known tabs not yet in the saved order (e.g. newly added tabs)
    const allKnownIds = ALL_TABS.map(t => t.id);
    const missing = allKnownIds.filter(id => !withHome.includes(id));
    return [...withHome, ...missing];
  };
  const [localTabOrder, setLocalTabOrderState] = useState<string[]>(() => buildOrder(tabOrder));
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    id: string;
    order: string[];
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dragId) return;
    setLocalTabOrderState(buildOrder(tabOrder));
  }, [tabOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach window-level listeners when a drag is active
  useEffect(() => {
    if (!dragId) return;

    const onMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const { offsetX, offsetY } = dragStateRef.current;
      setGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });

      // reorder based on pointer Y vs item rects
      const { id } = dragStateRef.current;
      let targetId: string | null = null;
      tabListRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]').forEach(el => {
        const tid = el.dataset.tabId!;
        if (tid === id) return;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY >= rect.top && e.clientY < rect.bottom) targetId = tid;
        void mid;
      });
      if (!targetId) return;
      const next = [...dragStateRef.current.order];
      const from = next.indexOf(id);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return;
      next.splice(from, 1);
      next.splice(to, 0, id);
      dragStateRef.current.order = next;
      setLocalTabOrderState(next);
      setTabOrder?.(next);
    };

    const onUp = () => {
      if (dragStateRef.current) setTabOrder?.(dragStateRef.current.order);
      dragStateRef.current = null;
      setDragId(null);
      setGhostPos(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGripPointerDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    // Capture the pointer so move/up events keep firing even if the finger
    // drifts off the small handle (key for smooth dragging on touch screens).
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    // anchor ghost so grip icon sits right under the cursor
    const offsetX = 10;
    const offsetY = 16;
    dragStateRef.current = { id, order: [...localTabOrder], offsetX, offsetY };
    setDragId(id);
    setGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  // ── Profile drag-to-reorder ─────────────────────────────────────────────
  const PROFILE_ORDER_KEY = "familyHub_profileOrder";
  const getProfileOrder = () => { try { return JSON.parse(localStorage.getItem(PROFILE_ORDER_KEY) || "[]"); } catch { return []; } };
  const [profileDragId, setProfileDragId] = useState<string | null>(null);
  const [profileGhostPos, setProfileGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [profileOrder, setProfileOrder] = useState<string[]>(getProfileOrder);
  const profileDragStateRef = useRef<{ id: string; order: string[]; offsetX: number; offsetY: number } | null>(null);
  const profileRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Which login accounts exist — powers the key badge on matching profiles
  // in the merged Family Members list.
  const { data: familyDetailsForBadges } = useQuery<{ members: { email: string | null }[] }>({
    queryKey: ["/api/family"],
    queryFn: async () => (await apiRequest("GET", "/api/family")).json(),
    enabled: isOpen,
  });
  const loginEmails = new Set(
    (familyDetailsForBadges?.members ?? [])
      .map((m) => (m.email ?? "").toLowerCase())
      .filter(Boolean),
  );

  useEffect(() => {
    if (!profileDragId) return;
    const onMove = (e: PointerEvent) => {
      if (!profileDragStateRef.current) return;
      const { offsetX, offsetY } = profileDragStateRef.current;
      setProfileGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });
      let targetId: string | null = null;
      for (const [id, el] of profileRowRefs.current.entries()) {
        if (id === profileDragStateRef.current.id) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) { targetId = id; break; }
      }
      if (!targetId) return;
      const cur = profileDragStateRef.current.order;
      const from = cur.indexOf(profileDragStateRef.current.id);
      const to = cur.indexOf(targetId);
      if (from === -1 || to === -1) return;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, profileDragStateRef.current.id);
      profileDragStateRef.current.order = next;
      setProfileOrder(next);
    };
    const onUp = () => {
      if (profileDragStateRef.current) {
        localStorage.setItem(PROFILE_ORDER_KEY, JSON.stringify(profileDragStateRef.current.order));
      }
      profileDragStateRef.current = null;
      setProfileDragId(null);
      setProfileGhostPos(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [profileDragId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProfileGripDown = (e: React.PointerEvent, id: string, currentOrder: string[]) => {
    e.preventDefault();
    // Capture the pointer so move/up events keep firing even if the finger
    // drifts off the small handle (key for smooth dragging on touch screens).
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    profileDragStateRef.current = { id, order: [...currentOrder], offsetX: 10, offsetY: 16 };
    setProfileDragId(id);
    setProfileGhostPos({ x: e.clientX - 10, y: e.clientY - 16 });
  };

  // Sort profiles according to stored order
  const sortedProfiles = [...profiles].sort((a, b) => {
    const ao = profileOrder.indexOf(a.id);
    const bo = profileOrder.indexOf(b.id);
    if (ao === -1 && bo === -1) return 0;
    if (ao === -1) return 1;
    if (bo === -1) return -1;
    return ao - bo;
  });

  const [signOutStep, setSignOutStep] = useState(0); // 0=closed 1=step1 2=step2
  // Reset Data / Delete Account are rare, destructive actions — collapsed
  // behind a reveal so they don't sit at the same visual weight as the
  // everyday Display Name/Sign Out controls in this section.
  const [showDestructiveActions, setShowDestructiveActions] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  // Rarely used, so collapsed by default to keep Calendars & Sharing shorter.
  const [showCaretakerLinks, setShowCaretakerLinks] = useState(false);
  // "closed" | "choice" (reset everything vs. specific data) | "all-warning" |
  // "all-confirm" (typed RESET) | "categories" (checkbox picker) | "categories-confirm" (typed RESET)
  const [resetStep, setResetStep] = useState<"closed" | "choice" | "all-warning" | "all-confirm" | "categories" | "categories-confirm">("closed");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetCategories, setResetCategories] = useState<string[]>([]);
  // "behaviour" deliberately omitted — the underlying category reset
  // (storage.resetUserDataCategories("behaviour")) still exists and works,
  // just not offered as a checkbox here, matching the tab being hidden.
  const RESET_CATEGORY_OPTIONS: { key: string; label: string; description: string }[] = [
    { key: "chores", label: "Chores & Tasks", description: "Chores, spins, streak freezes, star adjustments" },
    { key: "profiles", label: "Profiles", description: "All family member profiles and custom groups" },
    { key: "calendar", label: "Calendar", description: "Events, Google/Outlook/iCal connections, calendar settings" },
    { key: "meals", label: "Meal Planning", description: "Meals, grocery lists, saved meal ideas" },
    { key: "rewards", label: "Rewards & Wallet", description: "Rewards, wishlist, allowance, wallet, savings goals" },
    { key: "notes", label: "Notes, Reminders & Praise", description: "Notes, health reminders, shoutouts, comments, celebrations" },
  ];
  const [deleteStep, setDeleteStep] = useState(0);  // 0=closed 1=warning 2=confirm
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  
  // Custom profile groups state
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CustomProfileGroup | null>(null);
  const [groupFormData, setGroupFormData] = useState({
    name: "",
    icon: "👥",
    color: "#6366f1",
    profileIds: [] as string[],
  });

  const { data: customGroups = [] } = useQuery<CustomProfileGroup[]>({
    queryKey: ["/api/custom-profile-groups"],
  });

  // Drag-to-reorder for Custom Groups. Was HTML5 drag-and-drop, which never
  // worked here — it doesn't fire at all from a touch screen, and even with a
  // mouse the row's own controls swallowed the gesture. Replaced with the
  // pointer-event grip this file already uses for the profile list right
  // above it (and To-Dos elsewhere): a grip handle, pointer capture, and a
  // live reorder as you pass each row's midpoint.
  const [groupDragId, setGroupDragId] = useState<string | null>(null);
  const [groupGhostPos, setGroupGhostPos] = useState<{ x: number; y: number } | null>(null);
  const groupDragStateRef = useRef<{ id: string; order: string[] } | null>(null);
  const groupRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const reorderGroupsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest("POST", "/api/custom-profile-groups/reorder", { orderedIds });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-profile-groups"] });
      toast({ title: err?.message || "Failed to save the new group order", variant: "destructive" });
    },
  });
  const applyGroupOrder = (orderedIds: string[]) => {
    queryClient.setQueryData<CustomProfileGroup[]>(["/api/custom-profile-groups"], (old = []) => {
      const byId = new Map(old.map((g) => [g.id, g]));
      return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
    });
  };
  const handleGroupGripDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    groupDragStateRef.current = { id, order: customGroups.map((g) => g.id) };
    setGroupDragId(id);
    setGroupGhostPos({ x: e.clientX - 10, y: e.clientY - 16 });
  };
  useEffect(() => {
    if (!groupDragId) return;
    const onMove = (e: PointerEvent) => {
      const st = groupDragStateRef.current;
      if (!st) return;
      setGroupGhostPos({ x: e.clientX - 10, y: e.clientY - 16 });
      let targetId: string | null = null;
      for (const [id, el] of groupRowRefs.current.entries()) {
        if (id === st.id) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) { targetId = id; break; }
      }
      if (!targetId) return;
      const from = st.order.indexOf(st.id);
      const to = st.order.indexOf(targetId);
      if (from === -1 || to === -1) return;
      const next = [...st.order];
      next.splice(from, 1);
      next.splice(to, 0, st.id);
      st.order = next;
      applyGroupOrder(next);
    };
    const onUp = () => {
      const st = groupDragStateRef.current;
      if (st) reorderGroupsMutation.mutate(st.order);
      groupDragStateRef.current = null;
      setGroupDragId(null);
      setGroupGhostPos(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [groupDragId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Default colors for new profiles
  const defaultColors = [
    "#A78BFA", // Violet
    "#FB7185", // Rose
    "#34D399", // Emerald
    "#FBBF24", // Amber
    "#38BDF8", // Sky
    "#F472B6", // Pink
    "#2DD4BF", // Teal
    "#FB923C", // Orange
    "#818CF8", // Indigo
    "#C084FC", // Purple
    "#60A5FA", // Blue
    "#E879F9", // Fuchsia
    "#A3E635", // Lime
    "#F87171", // Red
    "#22D3EE", // Cyan
  ];

  const getNextColor = () => {
    const usedColors = profiles.map(p => p.color);
    const availableColors = defaultColors.filter(color => !usedColors.includes(color));
    return availableColors.length > 0 ? availableColors[0] : defaultColors[profiles.length % defaultColors.length];
  };

  const [formData, setFormData] = useState({
    name: "",
    color: "#A78BFA",
    initials: "",
    email: "",
    photoUrl: null as string | null,
    role: "adult" as "adult" | "child",
    isChild: false,
    school: "",
  });
  // For the kid-restrictions "you need a Parent PIN" nudge in the profile form.
  const { data: profileFormRewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });

  // Location settings state
  const [locationData, setLocationData] = useState({
    city: "",
    state: "",
    // Pre-selected from the device's own timezone until a saved value loads.
    country: guessCountry() as CountryCode,
    latitude: "",
    longitude: "",
  });

  // Calendar assignment state  
  const [selectedProfileForCalendars, setSelectedProfileForCalendars] = useState<string | null>(null);
  // Track pending calendar assignments for immediate UI updates (maps calendarId to profileId)

  // Section collapse/expand state — all sections start collapsed
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const scrollableRef = useRef<HTMLDivElement>(null);
  // Set when the search box is cleared; see the clear button's own comment.
  const resetScrollOnClear = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!resetScrollOnClear.current) return;
    resetScrollOnClear.current = false;
    if (scrollableRef.current) scrollableRef.current.scrollTop = 0;
  });

  // If the user closed Settings and comes back more than a minute later,
  // collapse whatever was left open — otherwise a section left expanded
  // from a much earlier visit stays expanded indefinitely.
  const lastClosedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen) {
      lastClosedAtRef.current = Date.now();
      return;
    }
    const wasAwayTooLong = lastClosedAtRef.current !== null && Date.now() - lastClosedAtRef.current > 60_000;
    if (wasAwayTooLong) {
      setOpenSections(new Set());
    }
    if (initialOpenSectionId) {
      setOpenSections(new Set([initialOpenSectionId]));
    }
    // Only re-run when the modal transitions to open — not on every
    // initialOpenSectionId identity change, so the user can still freely
    // collapse/switch sections afterward without being snapped back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Scrolls to and briefly rings the matching row in Tab Order & Visibility
  // — used by the feature-nudge sheet's "Turn it on" button so it lands on
  // the exact checkbox, not just the general Display & Layout section.
  const [highlightedTabId, setHighlightedTabId] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !initialHighlightTabId) return;
    setHighlightedTabId(initialHighlightTabId);
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-tab-id="${initialHighlightTabId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      spotlight(`tab-visibility-row-${initialHighlightTabId}`);
    }, 250);
    const clear = setTimeout(() => setHighlightedTabId(null), 3000);
    return () => { clearTimeout(t); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialHighlightTabId]);

  // Drives the collapsing family-name row in the sticky header (see below).
  // Wired with React's own onScroll on the list rather than an addEventListener
  // in an effect: Radix mounts this dialog's content through a Portal +
  // Presence, so on the effect's only run (deps: [isOpen], true from mount)
  // scrollableRef.current was still null — the listener silently never
  // attached and the header never collapsed. An onScroll prop has no such
  // attachment-timing dependency.
  const [headerCondensed, setHeaderCondensed] = useState(false);
  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    // Hysteresis: collapse past 24px, only restore at the very top. A single
    // threshold makes the header flicker when the list settles right on it.
    setHeaderCondensed((prev) => (prev ? top > 4 : top > 24));
  };

  const toggleSection = (id: string) => {
    const wasOpen = openSections.has(id);
    const savedTop = scrollableRef.current?.scrollTop ?? 0;
    // Single-open accordion: opening one closes all others
    setOpenSections(prev => {
      const next = new Set<string>();
      if (!prev.has(id)) next.add(id);
      return next;
    });
    if (!scrollableRef.current) return;
    if (wasOpen) {
      // Collapsing: hold the scroll position so the list doesn't jump.
      const el = scrollableRef.current;
      el.scrollTop = savedTop;
      requestAnimationFrame(() => { el.scrollTop = savedTop; });
      return;
    }
    // Opening: bring the section's OWN header to the top of the list. Simply
    // restoring the previous scrollTop used to leave you partway (often most
    // of the way) down the section you just opened, because closing the other
    // sections removes height above it — the same scrollTop then points at a
    // completely different place in the content.
    const container = scrollableRef.current;
    const settle = (tries: number) => {
      const section = container.querySelector(`[data-section-id="${id}"]`) as HTMLElement | null;
      if (section) {
        container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top;
      }
      // The section expands with a height animation, so the first frame's
      // geometry is mid-transition; re-settle for a few frames.
      if (tries > 0) requestAnimationFrame(() => settle(tries - 1));
    };
    requestAnimationFrame(() => settle(12));
  };

  // Search across all sections — while active, overrides the normal
  // single-open accordion so every matching section shows expanded at once
  // and non-matches disappear entirely, instead of forcing one-at-a-time.
  const [settingsSearch, setSettingsSearch] = useState("");
  const searchQuery = settingsSearch.trim().toLowerCase();
  const isSearching = searchQuery.length > 0;
  const matchingSectionIds = isSearching
    ? new Set(
        Object.entries(SECTION_KEYWORDS)
          .filter(([, keywords]) => keywords.some((kw) => kw.includes(searchQuery)))
          .map(([id]) => id),
      )
    : null;
  const sectionIsOpen = (id: string) => (isSearching ? matchingSectionIds!.has(id) : openSections.has(id));
  const sectionHidden = (id: string) => isSearching && !matchingSectionIds!.has(id);

  // Delete-profile confirmation state
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  // Fetch current location settings
  const { data: locationSettings } = useQuery<LocationSettings>({
    queryKey: ["/api/location-settings"],
    retry: false,
  });


  const createProfileMutation = useMutation({
    mutationFn: async (profileData: InsertProfile) => {
      const response = await apiRequest("POST", "/api/profiles", profileData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile created successfully!" });
      setIsAddingProfile(false);
      const nextColor = getNextColor();
      setFormData({ name: "", color: nextColor, initials: "", email: "", photoUrl: null, role: "adult", isChild: false, school: "" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to create profile", variant: "destructive" });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertProfile> }) => {
      const response = await apiRequest("PATCH", `/api/profiles/${id}`, data);
      return response.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile updated successfully!" });
      const resumeId = resumeEditProfileIdRef.current;
      resumeEditProfileIdRef.current = null;
      if (resumeId) {
        // Came through the role-change PIN gate: stay on this profile with its
        // editor open, and bring it back into view.
        if (updated?.id) setEditingProfile(updated);
        const scrollTo = (tries: number) => {
          const row = profileRowRefs.current.get(resumeId);
          const container = scrollableRef.current;
          if (row && container) {
            container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
          }
          if (tries > 0) requestAnimationFrame(() => scrollTo(tries - 1));
        };
        requestAnimationFrame(() => scrollTo(8));
        return;
      }
      setEditingProfile(null);
      const nextColor = getNextColor();
      setFormData({ name: "", color: nextColor, initials: "", email: "", photoUrl: null, role: "adult", isChild: false, school: "" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to update profile", variant: "destructive" });
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile deleted successfully!" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to delete profile", variant: "destructive" });
    },
  });

  // COPPA: record verifiable parental consent for a child profile (server stamps
  // the timestamp + affirming account id).
  const grantConsentMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await apiRequest("POST", `/api/profiles/${profileId}/parental-consent`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Couldn't record parental consent", variant: "destructive" });
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (data: { profileImageURL: string; profileId: string }) => {
      const response = await apiRequest("PUT", "/api/profile-images", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile image updated successfully!" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to update profile image", variant: "destructive" });
    },
  });


  // Location settings mutation
  const updateLocationMutation = useMutation({
    mutationFn: async (locationSettings: typeof locationData) => {
      const parsedData = insertLocationSettingsSchema.parse({
        city: locationSettings.city,
        state: locationSettings.state,
        country: COUNTRIES.find((c) => c.code === locationSettings.country)!.name,
        latitude: parseFloat(locationSettings.latitude),
        longitude: parseFloat(locationSettings.longitude),
        // Every timed push (daily brief, bedtime, weekly recap, health
        // reminders) reads this to compute local time. The device's own
        // timezone is correct by construction — a region map is a guess,
        // since several states and provinces span two zones. The map stays as
        // the fallback, and both may be undefined, in which case the field is
        // omitted and whatever is already stored stands.
        timezone: deviceTimezone() ?? regionToTimezone(locationSettings.state, locationSettings.country),
      });
      const response = await apiRequest("PUT", "/api/location-settings", parsedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/location-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weather"] }); // Refresh weather with new location
      toast({
        title: "Location updated successfully",
        description: "Weather will now show data for the new location.",
      });
    },
    onError: (err: any) => {
      toast({
        title: err?.message || "Failed to update location",
        description: err?.message ? undefined : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Custom profile group mutations
  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; profileIds: string[]; color: string; icon: string }) => {
      const response = await apiRequest("POST", "/api/custom-profile-groups", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-profile-groups"] });
      toast({ title: "Custom group created!" });
      setIsAddingGroup(false);
      setGroupFormData({ name: "", icon: "👥", color: "#6366f1", profileIds: [] });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to create group", variant: "destructive" });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ name: string; profileIds: string[]; color: string; icon: string }> }) => {
      const response = await apiRequest("PATCH", `/api/custom-profile-groups/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-profile-groups"] });
      toast({ title: "Custom group updated!" });
      setEditingGroup(null);
      setGroupFormData({ name: "", icon: "👥", color: "#6366f1", profileIds: [] });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to update group", variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/custom-profile-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-profile-groups"] });
      toast({ title: "Custom group deleted!" });
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to delete group", variant: "destructive" });
    },
  });

  const handleGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupFormData.name.trim() || groupFormData.profileIds.length === 0) {
      toast({ title: "Please enter a name and select at least one family member", variant: "destructive" });
      return;
    }

    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, data: groupFormData });
    } else {
      createGroupMutation.mutate(groupFormData);
    }
  };

  const startEditGroup = (group: CustomProfileGroup) => {
    setEditingGroup(group);
    setGroupFormData({
      name: group.name,
      icon: group.icon || "👥",
      color: group.color || "#6366f1",
      profileIds: group.profileIds || [],
    });
    setIsAddingGroup(true);
  };

  const cancelGroupEdit = () => {
    setEditingGroup(null);
    setIsAddingGroup(false);
    setGroupFormData({ name: "", icon: "👥", color: "#6366f1", profileIds: [] });
  };

  const toggleProfileInGroup = (profileId: string) => {
    setGroupFormData(prev => ({
      ...prev,
      profileIds: prev.profileIds.includes(profileId)
        ? prev.profileIds.filter(id => id !== profileId)
        : [...prev.profileIds, profileId]
    }));
  };

  // Performs the actual create/update. When `grantConsent` is true, records
  // verifiable parental consent for the (child) profile afterwards.
  const performProfileSave = async (grantConsent: boolean) => {
    if (editingProfile) {
      await updateProfileMutation.mutateAsync({
        id: editingProfile.id,
        data: {
          name: formData.name.trim(),
          color: formData.color,
          initials: editingProfile.isAllFamilyProfile ? editingProfile.initials : formData.initials.trim(),
          email: formData.email.trim() || null,
          photoUrl: formData.photoUrl,
          isActive: true,
          role: formData.role,
          // isChild (COPPA under-13) only applies to kids; force false for adults.
          isChild: formData.role === "child" ? formData.isChild : false,
          school: savedSchool(formData.school),
        },
      });
      if (grantConsent) await grantConsentMutation.mutateAsync(editingProfile.id);
    } else {
      const created = await createProfileMutation.mutateAsync({
        name: formData.name.trim(),
        color: formData.color,
        initials: formData.initials.trim(),
        email: formData.email.trim() || null,
        photoUrl: formData.photoUrl,
        isActive: true,
        role: formData.role,
        isChild: formData.role === "child" ? formData.isChild : false,
      });
      if (grantConsent && created?.id) await grantConsentMutation.mutateAsync(created.id);
    }
  };

  // Runs the actual save once any PIN gate / COPPA consent gate has already
  // been cleared (or doesn't apply). Split out of handleSubmit so the
  // role-change PIN dialog's own success handler can resume the same flow
  // without re-deriving it.
  const proceedWithProfileSubmit = () => {
    // COPPA: an under-13 child profile requires verifiable parental consent.
    // Only applies when the profile is a Kid AND marked under-13; a 13–17 Kid
    // (role="child" but isChild=false) does not trigger the consent flow.
    const alreadyConsented = !!editingProfile?.parentalConsentAt;
    if (formData.role === "child" && formData.isChild && !alreadyConsented) {
      setConsentGateOpen(true);
      return;
    }

    // Errors surface via the individual mutations' onError toasts.
    void performProfileSave(false).catch(() => {});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.initials.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    // Switching an EXISTING profile between Grown-up and Kid changes what
    // that profile can do unsupervised — always require the Parent PIN for
    // that specific change (same "always gated, never optional" precedent as
    // changing an existing PIN itself), regardless of whether this family has
    // opted any of the optional PIN_GATE_FEATURES in. A brand-new profile
    // (editingProfile null) has nothing to escalate yet, so it's exempt.
    if (editingProfile) {
      const originalRole: "adult" | "child" =
        (editingProfile.role === "child" || editingProfile.isChild) ? "child" : "adult";
      if (formData.role !== originalRole) {
        setRoleChangePinError("");
        setRoleChangePinInput("");
        setRoleChangePinOpen(true);
        return;
      }
    }

    proceedWithProfileSubmit();
  };

  const verifyRoleChangePinMutation = useMutation({
    mutationFn: async (pin: string) =>
      (await apiRequest("POST", "/api/reward-settings/verify-pin", { pin })).json(),
    onSuccess: (data: { ok: boolean }) => {
      if (data.ok) {
        setRoleChangePinOpen(false);
        setRoleChangePinInput("");
        setRoleChangePinError("");
        resumeEditProfileIdRef.current = editingProfile?.id ?? null;
        proceedWithProfileSubmit();
      } else {
        setRoleChangePinError("Incorrect PIN. Try again.");
      }
    },
    onError: () => setRoleChangePinError("Couldn't verify PIN — try again."),
  });

  const startEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      color: profile.color,
      initials: profile.initials,
      email: profile.email || "",
      photoUrl: profile.photoUrl,
      // A legacy under-13 (isChild) profile with no explicit role is a Kid.
      role: (profile.role === "child" || profile.isChild) ? "child" : "adult",
      isChild: !!profile.isChild,
      school: profile.school ?? "",
    });
    setIsAddingProfile(false);
  };

  // Tracks whether the user has manually typed their own Initials value in
  // the Add Profile form — once they have, typing in Name stops overwriting
  // it. Only applies to adding a new profile, not editing an existing one
  // (an existing profile's initials are left exactly as saved).
  const [initialsTouched, setInitialsTouched] = useState(false);

  const startAdd = () => {
    setIsAddingProfile(true);
    setEditingProfile(null);
    setInitialsTouched(false);
    const nextColor = getNextColor();
    setFormData({ name: "", color: nextColor, initials: "", email: "", photoUrl: null, role: "adult", isChild: false, school: "" });
  };

  const cancelEdit = () => {
    setEditingProfile(null);
    setIsAddingProfile(false);
    setInitialsTouched(false);
    const nextColor = getNextColor();
    setFormData({ name: "", color: nextColor, initials: "", email: "", photoUrl: null, role: "adult", isChild: false, school: "" });
  };

  const handleImageUploadComplete = (result: { objectPath: string }) => {
    setFormData({ ...formData, photoUrl: result.objectPath });
  };


  const handleDelete = async (profileId: string) => {
    if (await confirmDialog({ title: "Delete this profile?", description: "Their chores, stars, and history go with it. This can't be undone.", confirmLabel: "Delete profile" })) {
      deleteProfileMutation.mutate(profileId);
    }
  };

  // Initialize location data when location settings are loaded
  useEffect(() => {
    if (locationSettings) {
      setLocationData({
        city: locationSettings.city || "",
        state: locationSettings.state || "",
        // A saved country wins over the device guess; a row saved before the
        // column was ever written falls back to its own default (US).
        country: countryFromName(locationSettings.country),
        latitude: locationSettings.latitude?.toString() || "",
        longitude: locationSettings.longitude?.toString() || "",
      });
    }
  }, [locationSettings]);

  const handleTabVisibilityToggle = (tabId: string, visible: boolean) => {
    if (!setHiddenTabs) return;
    if (visible) {
      setHiddenTabs(hiddenTabs.filter(id => id !== tabId));
    } else {
      setHiddenTabs([...hiddenTabs.filter(id => id !== tabId), tabId]);
    }
  };


  const handleLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!locationData.city.trim() || !locationData.state.trim()) {
      toast({
        title: `Please fill in city and ${regionLabel(locationData.country).toLowerCase()}`,
        variant: "destructive"
      });
      return;
    }

    // ⚠️ These used to fall back to 44.6402/-93.1468 — Farmington, Minnesota —
    // whenever coordinates were blank, which for anyone who onboarded was
    // always, since onboarding hardcoded the same pair. The weather endpoint
    // reads coordinates, so every family saw Minnesota's weather whatever city
    // they had typed. The server now geocodes city/state/country on save; 0/0
    // means "nothing better to offer", and the server replaces it.
    const submitData = {
      ...locationData,
      latitude: locationData.latitude || "0",
      longitude: locationData.longitude || "0"
    };

    updateLocationMutation.mutate(submitData);
  };


  return (
    <>
    {spotlightOverlay}
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // The Help panel (KbPanel) is a REAL nested Radix Dialog mounted
        // while this one is still open — Radix recognizes its own tracked
        // layers and exempts it from this Dialog's dismissable layer on its
        // own, so no special-casing is needed for that anymore (an earlier
        // version of KbPanel was a plain portal div, which needed toggling
        // this Dialog's `modal` prop off — that caused a worse bug, Settings
        // freezing greyed-out after closing the panel, since toggling modal
        // on an already-open Dialog put Radix in a stuck animation state).
        // This guard is kept only as defense in depth.
        if (!open && kbOpen) return;
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-full max-w-lg md:max-w-2xl max-h-[90vh] bg-card rounded-2xl border border-border shadow-xl overflow-hidden flex flex-col"
        data-testid="settings-modal"
        onInteractOutside={(e) => {
          // Belt-and-suspenders for the same class of bug: any pop-up that
          // opens on top of Settings as its own dialog/alertdialog (the
          // calendar picker, a confirmation, the Help panel, anything added
          // later) shouldn't be able to dismiss Settings just because its
          // content lives outside Settings' own DOM subtree.
          const t = (e.detail as any)?.originalEvent?.target as Element | null;
          if (t && t.closest('[role="dialog"],[role="alertdialog"]')) e.preventDefault();
        }}
      >
        <DialogHeader className="pb-2 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Settings className="w-5 h-5" />
              Settings
            </DialogTitle>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setKbOpen(true)}
                title="Help & Knowledge Base"
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors text-muted-foreground hover:text-foreground touch-manipulation"
                data-testid="kb-help-button"
              >
                <HelpCircle className="w-5 h-5" />
              </button>
              <button
                onClick={cycleTheme}
                title={`Theme: ${theme} — click to cycle`}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors text-muted-foreground hover:text-foreground touch-manipulation"
                data-testid="theme-cycle-button"
              >
                <ThemeIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </DialogHeader>
        
        {/* Family Name at the very top — it names the whole account, so it's
            the most obvious thing to show first and the easiest place to find
            when you want to change it. Same row and pencil as before, just
            lifted out of Account & Family (which now passes hideName so it
            isn't shown twice). */}
        {/* The family name collapses away once you start scrolling. The
            header is sticky, so every fixed row in it is permanently spent
            screen space — and with a keyboard up (editing Location, a PIN, a
            profile) there was almost nothing left to work in. Only the
            Settings title and the search box stay pinned; the family name is
            reference, not navigation. */}
        <div
          className="px-4 shrink-0 overflow-hidden transition-all duration-200"
          style={
            headerCondensed
              ? { maxHeight: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }
              : { maxHeight: "3rem", opacity: 1, paddingTop: "0.375rem", paddingBottom: "0.25rem" }
          }
          aria-hidden={headerCondensed}
          data-testid="settings-family-name-row"
        >
          <FamilyManager nameOnly />
        </div>

        <div className="px-2 pt-1 pb-1.5 shrink-0">
          {/* The icon's `left-3` is relative to THIS inner div (not the
              outer px-2 container above) — nesting it here keeps the icon
              centered within the Input's own pl-9 gap regardless of the
              outer container's padding. */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              value={settingsSearch}
              onChange={(e) => setSettingsSearch(e.target.value)}
              placeholder="Search settings…"
              className={settingsSearch ? "pl-9 pr-9" : "pl-9"}
              data-testid="input-settings-search"
            />
            {/* Clearing by hand meant selecting the text and deleting it —
                on a phone, with the keyboard covering half the screen. */}
            {settingsSearch && (
              <button
                type="button"
                // Don't let the tap take focus off the field. Losing it closes
                // the iOS keyboard, which resizes the visual viewport at the
                // same moment clearing the search grows the list back to full
                // height — two layout changes at once, which is the judder
                // reported on pressing the X (2026-09-12). preventDefault on
                // the press keeps the caret (and the keyboard) where it was,
                // so only the list changes.
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  // Reset the scroll AFTER the re-render, not here: clearing
                  // brings every section back, so scrolling the still-filtered
                  // (short) list to 0 first and letting it grow underneath is
                  // exactly what produced the lurch. resetScrollOnClear is
                  // consumed by a useLayoutEffect below, which runs after the
                  // full list is laid out but before the browser paints.
                  resetScrollOnClear.current = true;
                  setSettingsSearch("");
                  // preventDefault above stops the blur, but Safari can still
                  // drop the caret; asking for it back is harmless when it
                  // never left.
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                data-testid="clear-settings-search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {isSearching && matchingSectionIds!.size === 0 && (
            <p className="text-xs text-muted-foreground mt-1.5 px-1">No settings match "{settingsSearch.trim()}".</p>
          )}
        </div>

        <div ref={scrollableRef} onScroll={handleListScroll} className="flex flex-col gap-1.5 min-h-0 overflow-y-auto overflow-x-hidden flex-1 px-2 py-2 [overflow-anchor:none]">
          {/* Account & Family */}
          <SettingsSection id="account" title="Account & Family" icon={<User className="w-4 h-4" />} isOpen={sectionIsOpen("account")} onToggle={() => toggleSection("account")} hidden={sectionHidden("account")}>
            <div className="space-y-3">

              {/* Change password. Was a standing note telling you to sign out
                  and use the sign-in screen's "Forgot password?" — an
                  instruction where an action belongs. This is the convention
                  most apps use: the recovery option lives inside the change-
                  password flow, at the moment you're stuck. Reuses the exact
                  existing reset path (POST /api/auth/forgot-password →
                  emailed link → /reset-password), so nothing new was added
                  server-side, and it mirrors the Parent PIN's own
                  "email me a code" fallback. */}
              <div className="rounded-lg border border-border px-3 py-2.5">
                {/* Stacks on a phone — the non-shrinking button left the copy a
                    narrow column that wrapped to one or two words a line. */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {/* No "Password" heading — the button beside it already
                        says "Change password", so the title only restated it. */}
                    <p className="text-xs text-muted-foreground">
                      {passwordResetMsg
                        ? passwordResetMsg
                        : "We'll email you a link to set a new password. You'll stay signed in here."}
                    </p>
                  </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 sm:w-auto w-full"
                    disabled={sendingPasswordReset || !user?.email}
                    onClick={async () => {
                      if (!user?.email) return;
                      setSendingPasswordReset(true);
                      try {
                        await requestPasswordReset(user.email);
                        setPasswordResetMsg(`Sent to ${user.email}. Check your inbox for the link.`);
                        toast({ title: "Reset link sent" });
                      } catch (e: any) {
                        toast({ title: "Couldn't send the link", description: e?.message, variant: "destructive" });
                      } finally {
                        setSendingPasswordReset(false);
                      }
                    }}
                    data-testid="settings-change-password"
                  >
                    {sendingPasswordReset ? "Sending…" : "Change password"}
                  </Button>
                </div>
                {!user?.email && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Your account signs in with Apple, so there's no password to change.
                  </p>
                )}
              </div>

              {/* No Separator here — the Password block is a bordered card
                  now, so a rule directly under it read as a double divider. */}

              {/* ONE merged "Family Members" list (user decision 2026-07-11):
                  the old separate Members sub-section duplicated the People
                  list for anyone whose profile and login matched. Profiles
                  carry a key badge when they have their own login; accounts
                  with no matching profile render at the bottom via
                  LoginOnlyMembers. FamilyManager here only contributes the
                  Family Name field (+ leave-family for non-owners). */}
              <div>
                <FamilyManager hideMembers hideName />
              </div>

              <Separator />

              {/* Location — a one-time setup field, rarely revisited once
                  filled in, so it's tucked behind a reveal at the bottom of
                  this section instead of sitting up top. */}
              {!showLocation ? (
                <button
                  type="button"
                  onClick={() => setShowLocation(true)}
                  // Was bare underlined grey text next to two bordered cards —
                  // three blocks in one section, three different chromes.
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  data-testid="show-location-section"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {locationSettings?.city ? `Location: ${locationSettings.city}${locationSettings.state ? ", " + locationSettings.state : ""}` : "Set your location"}
                    </span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                </button>
              ) : (
                <form onSubmit={handleLocationSubmit}>
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                    <Label className="text-xs font-medium text-muted-foreground whitespace-nowrap sm:w-24 sm:shrink-0 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Location
                    </Label>
                    {/* Order follows how it is actually filled in: country
                        decides what the region field even means, the region
                        narrows the country, and the city is last. Country and
                        region share a row; the city gets its own, because four
                        controls on one phone row left it 68px wide and pushed
                        Save off the edge (2026-09-11). */}
                    <div className="flex flex-col gap-2 min-w-0 sm:max-w-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <Select
                          value={locationData.country}
                          onValueChange={(v) => setLocationData({
                            ...locationData,
                            country: v as CountryCode,
                            // Clear what the old country's answers were. A
                            // Minnesota "MN" left sitting under Canada is not a
                            // province, and a city that only exists in the old
                            // country silently geocodes to the wrong place.
                            state: "",
                            city: "",
                          })}
                        >
                          <SelectTrigger className="h-9 min-w-0 flex-1 text-sm" aria-label="Country" data-testid="location-country-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRIES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* Select-on-focus: this holds exactly two characters, so
                            tapping it always means replacing them. The caret
                            otherwise lands to the LEFT of the existing letters and
                            both have to be deleted one at a time. */}
                        <Input
                          id="state"
                          value={locationData.state}
                          onChange={(e) => setLocationData({ ...locationData, state: e.target.value.toUpperCase() })}
                          onFocus={(e) => e.currentTarget.select()}
                          placeholder={locationData.country === "CA" ? "ON" : "MN"}
                          maxLength={2}
                          aria-label={regionLabel(locationData.country)}
                          className="h-9 w-16 shrink-0 text-base text-center font-medium tracking-wide placeholder:text-muted-foreground/50"
                          data-testid="location-state-input"
                        />
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <Input
                          id="city"
                          value={locationData.city}
                          onChange={(e) => setLocationData({ ...locationData, city: e.target.value })}
                          placeholder="City"
                          className="h-9 flex-1 min-w-0 text-sm placeholder:text-muted-foreground/50"
                          data-testid="location-city-input"
                        />
                        <Button type="submit" size="sm" className="h-8 px-3 shrink-0" disabled={updateLocationMutation.isPending} data-testid="save-location-button">
                          {updateLocationMutation.isPending ? "…" : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <input type="hidden" value={locationData.latitude} />
                  <input type="hidden" value={locationData.longitude} />
                  {/* The live weather chip is the "what is this for" answer —
                      it appears as soon as the saved city resolves. Only the
                      part that CAN'T show itself is left as words. */}
                  <div className="flex items-center gap-2 mt-1.5 sm:pl-[6.5rem]">
                    <LocationWeatherChip />
                    <span className="text-[11px] text-muted-foreground">Also sets your time zone.</span>
                  </div>
                </form>
              )}

              {/* Reset Data / Delete Account moved here from the footer
                  (2026-09-01): they're account-level actions, and the footer
                  existed mostly to hold them. Sign Out deliberately stays at
                  the very bottom of Settings — that's where people look. */}
              <Separator />
            {/* The toggle stays put whether open or closed. It used to be
                replaced by the buttons it revealed, so once you looked inside
                there was no way to close it again — Reset data and Delete
                account then sat exposed for the rest of the session. */}
            <button
              type="button"
              onClick={() => setShowDestructiveActions(v => !v)}
              // Was bare grey underlined text — the least visible control on
              // the screen, and the only way to reach Reset Data and Delete
              // Account. Now a real bordered control with a disclosure caret.
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              data-testid="show-destructive-actions"
              aria-expanded={showDestructiveActions}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                Delete Account &amp; Reset Data
              </span>
              {showDestructiveActions
                ? <ChevronUp className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showDestructiveActions && (
              <div className="space-y-2 pt-1">
                <Button variant="outline" size="sm" className="w-full min-w-0 h-auto py-2 justify-start whitespace-normal text-left text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setResetStep("choice")} data-testid="settings-reset-button">
                  <Trash2 className="w-4 h-4 mr-2 shrink-0" /> Reset data
                </Button>
                <Button variant="outline" size="sm" className="w-full min-w-0 h-auto py-2 justify-start whitespace-normal text-left text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setDeleteStep(1)} data-testid="settings-delete-account-button">
                  <Trash2 className="w-4 h-4 mr-2 shrink-0" /> Delete account
                </Button>
                <p className="text-xs text-muted-foreground px-0.5">
                  <strong>Reset Data</strong> clears your family's content but keeps your login.{" "}
                  <strong>Delete Account</strong> permanently removes your login and, if you're the sole owner, all family data.
                </p>
              </div>
            )}
            </div>
          </SettingsSection>

          {/* People — split out of Account & Family (2026-09-01). That
              section had grown to seven unrelated features and ~776 lines;
              the profile list and its add/edit forms were most of it. */}
          <SettingsSection id="people" title="People" icon={<Users className="w-4 h-4" />} isOpen={sectionIsOpen("people")} onToggle={() => toggleSection("people")} hidden={sectionHidden("people")}>
            <div className="space-y-3">

              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Everyone the app tracks — kids included. A <KeyRound className="w-3 h-3 inline -mt-0.5" /> badge means that person also has their own login to this family.
                </p>

            {/* Add Profile Form — only shown when adding a new profile */}
            {isAddingProfile && (
              <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-accent/30 rounded-lg mb-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Add New Profile</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelEdit}
                    data-testid="cancel-profile-form"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="name" className="text-sm">Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        setFormData({
                          ...formData,
                          name,
                          initials: initialsTouched ? formData.initials : deriveInitials(name),
                        });
                      }}
                      placeholder="Profile name"
                      className="h-8"
                      data-testid="profile-name-input"
                      disabled={editingProfile?.isAllFamilyProfile}
                    />
                  </div>
                  <div>
                    <Label htmlFor="initials" className="text-sm">Initials</Label>
                    <Input
                      id="initials"
                      value={formData.initials}
                      onChange={(e) => { setInitialsTouched(true); setFormData({ ...formData, initials: e.target.value }); }}
                      placeholder="M"
                      maxLength={2}
                      className="h-8"
                      data-testid="profile-initials-input"
                      disabled={editingProfile?.isAllFamilyProfile}
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="email" className="text-sm">Email (Optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="example@email.com"
                    className="h-8"
                    data-testid="profile-email-input"
                  />
                </div>

                                {/* Photo and colour sit side by side (2026-09-04): the photo
                    circle used to take a whole centered row of its own, which
                    pushed everything below it further down a form that already
                    has to fit above a keyboard. */}
                <div className="flex items-start gap-3">
<div className="flex justify-center shrink-0">
                  <div className="relative">
                    <ObjectUploader
                      onComplete={handleImageUploadComplete}
                      buttonClassName="h-16 w-16 p-0 rounded-full bg-transparent hover:bg-transparent shadow-none"
                      withCrop
                    >
                      <div
                        className="w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-xl p-1 shadow-sm transition-colors"
                        style={{ backgroundColor: `${formData.color}20`, border: `3px solid ${formData.color}` }}
                        title={formData.photoUrl ? "Change photo" : "Add photo"}
                      >
                        {formData.photoUrl ? (
                          <img
                            src={objectUrl(formData.photoUrl)}
                            alt="Profile preview"
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-full h-full rounded-full flex items-center justify-center shadow-inner"
                            style={{ backgroundColor: formData.color }}
                          >
                            {formData.initials || "?"}
                          </div>
                        )}
                      </div>
                    </ObjectUploader>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center shadow-sm pointer-events-none">
                      <Camera className="w-3 h-3 text-muted-foreground" />
                    </div>
                    {formData.photoUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFormData({ ...formData, photoUrl: null })}
                        className="absolute -top-1 -right-1 h-5 w-5 p-0 rounded-full"
                        data-testid="remove-profile-photo"
                      >
                        <X className="w-2.5 h-2.5" />
                      </Button>
                    )}
                  </div>
                </div>
                  <div className="flex-1 min-w-0">
<div>
                  <Label className="text-sm">Profile Color</Label>
                  <div className="grid grid-cols-6 gap-2 mt-2">
                    {defaultColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-full h-8 rounded-md border-2 transition-all ${
                          formData.color === color
                            ? "border-primary scale-110 shadow-sm"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                        data-testid={`color-option-${color}`}
                      />
                    ))}
                    <ColorSpectrumPicker
                      compact
                      value={formData.color}
                      selected={!defaultColors.includes(formData.color)}
                      onChange={(color) => setFormData({ ...formData, color })}
                      testId="profile-custom-color-input"
                    />
                  </div>
                </div>
                  </div>
                </div>

{/* Adult vs Kid role (drives Parent-PIN gating) + COPPA under-13 sub-question */}
                {!editingProfile?.isAllFamilyProfile && (
                  <div className="rounded-lg border border-border/60 bg-accent/20 p-3 space-y-2">
                    <div>
                      <Label className="text-sm">This person is a…</Label>
                      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                        {(["adult", "child"] as const).map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setFormData({ ...formData, role: r, ...(r === "adult" ? { isChild: false } : {}) })}
                            className={cn(
                              "px-2 py-1.5 text-xs rounded-lg border transition-colors",
                              formData.role === r
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:bg-accent/40",
                            )}
                            data-testid={`profile-role-${r}`}
                          >
                            {r === "adult" ? "🧑 Grown-up" : "🧒 Kid"}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                        {formData.role === "adult"
                          ? ADULT_ROLE_EXPLAINER
                          : KID_ROLE_EXPLAINER}
                      </p>
                    </div>

                    {formData.role === "child" && (
                      <div className="pt-2 border-t border-border/40 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <Label htmlFor="is-child" className="text-sm">Is this kid under 13?</Label>
                            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                              Required for children's privacy (COPPA). You'll be asked to confirm parental consent.
                            </p>
                          </div>
                          <Switch
                            id="is-child"
                            checked={formData.isChild}
                            onCheckedChange={(v) => setFormData({ ...formData, isChild: v })}
                            data-testid="profile-is-child-toggle"
                          />
                        </div>
                        {/* Tied to the toggle directly above, not shown on its own: a profile
    switched back to Grown-up (or out of under-13) keeps its historical
    consent row, and showing "consent recorded" beside an off switch read
    as the two disagreeing about the same question. */}
                                  {editingProfile?.parentalConsentAt && formData.isChild && (
                          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Parental consent recorded
                            {` on ${new Date(editingProfile.parentalConsentAt).toLocaleDateString()}`}
                          </p>
                        )}
                        {/* Kid restrictions only bite once a Parent PIN exists — nudge to set one. */}
                        {!profileFormRewardSettings?.hasParentPin && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>{KID_NEEDS_PIN_NUDGE}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

<Button
                  type="submit"
                  className="w-full h-8"
                  disabled={createProfileMutation.isPending || updateProfileMutation.isPending}
                  data-testid="save-profile-button"
                >
                  Create profile
                </Button>
              </form>
            )}
            
            {/* Add Profile Button */}
            {!isAddingProfile && (
              <Button
                onClick={startAdd}
                variant="outline"
                // Was a dashed-border one-off that appears nowhere else in
                // the app; uses the normal outline add-button treatment now.
                className="w-full h-8 mb-3"
                data-testid="add-profile-button"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add person
              </Button>
            )}
            
            {/* Profile List - Include All Family profile but with a note */}
            <div className="space-y-2">
              {sortedProfiles.map((profile) => {
                const currentOrder = sortedProfiles.map(p => p.id);
                const isEditingThis = editingProfile?.id === profile.id;
                return (
                <div
                  key={profile.id}
                  ref={(el) => { if (el) profileRowRefs.current.set(profile.id, el); else profileRowRefs.current.delete(profile.id); }}
                  className={`flex flex-col gap-1 rounded-lg transition-all ${
                    isEditingThis ? "ring-2 ring-primary/70 bg-primary/5 p-1" : ""
                  }`}
                >
                  <div className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-150 ${profileDragId === profile.id ? 'opacity-30 scale-95 bg-primary/10' : 'bg-accent/30'}`}>
                    <span
                      className="flex items-center justify-center -my-1 -ml-1 p-2 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
                      style={{ touchAction: 'none' }}
                      onPointerDown={(e) => handleProfileGripDown(e, profile.id, currentOrder)}
                      data-testid={`profile-drag-handle-${profile.id}`}
                    >
                      <GripVertical className="w-5 h-5 text-muted-foreground" />
                    </span>
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-xs p-0.5 shadow-sm"
                      style={{ border: `2px solid ${profile.color}`, backgroundColor: `${profile.color}20` }}
                    >
                      {profile.photoUrl ? (
                        <img
                          src={objectUrl(profile.photoUrl)}
                          alt={profile.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <div 
                          className="w-full h-full rounded-full flex items-center justify-center"
                          style={{ backgroundColor: profile.color }}
                        >
                          {profile.initials}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-foreground text-sm truncate">{profile.name}</p>
                        {!profile.isAllFamilyProfile && isKidProfile(profile) && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
                            Kid
                          </span>
                        )}
                        {!profile.isAllFamilyProfile && profile.email && loginEmails.has(profile.email.toLowerCase()) && (
                          <span title="Has their own login" className="shrink-0 text-muted-foreground">
                            <KeyRound className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      {profile.email && (
                        <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                      )}
                      {personRecordLines(profile).map((line, index) => (
                        <p key={`${profile.id}-${index}`} data-testid="profile-memory" className="text-xs text-muted-foreground truncate">{line}</p>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant={isEditingThis ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => (isEditingThis ? cancelEdit() : startEdit(profile))}
                        className="h-6 w-6 p-0"
                        data-testid={`edit-profile-${profile.name.toLowerCase()}`}
                      >
                        {isEditingThis ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                  {/* Inline edit form — slides open directly below the clicked profile row */}
                  <AnimatePresence initial={false}>
                    {editingProfile?.id === profile.id && (
                      <motion.div
                        key={`edit-${profile.id}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1, transition: { duration: 0.75, ease: [0.4, 0, 0.2, 1] } }}
                        exit={{ height: 0, opacity: 0, transition: { duration: 0.75, ease: [0.4, 0, 0.2, 1] } }}
                        style={{ overflow: "hidden" }}
                      >
                        <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-accent/30 rounded-lg mt-1">
                          <h4 className="font-medium text-sm">Edit Profile</h4>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="edit-name" className="text-sm">Name</Label>
                              <Input id="edit-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Profile name" className="h-8" data-testid="profile-name-input" disabled={!!editingProfile?.isAllFamilyProfile} />
                            </div>
                            <div>
                              <Label htmlFor="edit-initials" className="text-sm">Initials</Label>
                              <Input id="edit-initials" value={formData.initials} onChange={(e) => setFormData({ ...formData, initials: e.target.value })} placeholder="M" maxLength={2} className="h-8" data-testid="profile-initials-input" disabled={!!editingProfile?.isAllFamilyProfile} />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="edit-email" className="text-sm">Email (Optional)</Label>
                            <Input id="edit-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="example@email.com" className="h-8" data-testid="profile-email-input" />
                          </div>
                          {!editingProfile?.isAllFamilyProfile && (
                            <div>
                              <Label htmlFor="edit-school" className="text-sm">School</Label>
                              <Input id="edit-school" value={formData.school} onChange={(e) => setFormData({ ...formData, school: e.target.value })} placeholder="Lincoln Elementary" className="h-8" data-testid="profile-school-input" />
                            </div>
                          )}

                                                    <div className="flex items-start gap-3">
<div className="flex justify-center shrink-0">
                            <div className="relative">
                              <ObjectUploader onComplete={handleImageUploadComplete} buttonClassName="h-16 w-16 p-0 rounded-full bg-transparent hover:bg-transparent shadow-none" withCrop>
                                <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-xl p-1 shadow-sm transition-colors" style={{ backgroundColor: `${formData.color}20`, border: `3px solid ${formData.color}` }} title={formData.photoUrl ? "Change photo" : "Add photo"}>
                                  {formData.photoUrl ? (
                                    <img src={objectUrl(formData.photoUrl)} alt="Profile preview" className="w-full h-full rounded-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full rounded-full flex items-center justify-center shadow-inner" style={{ backgroundColor: formData.color }}>{formData.initials || "?"}</div>
                                  )}
                                </div>
                              </ObjectUploader>
                              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center shadow-sm pointer-events-none">
                                <Camera className="w-3 h-3 text-muted-foreground" />
                              </div>
                              {formData.photoUrl && (
                                <Button type="button" variant="outline" size="sm" onClick={() => setFormData({ ...formData, photoUrl: null })} className="absolute -top-1 -right-1 h-5 w-5 p-0 rounded-full" data-testid="remove-profile-photo">
                                  <X className="w-2.5 h-2.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                            <div className="flex-1 min-w-0">
<div>
                            <Label className="text-sm">Profile Color</Label>
                            <div className="grid grid-cols-6 gap-2 mt-2">
                              {defaultColors.map((color) => (
                                <button key={color} type="button" onClick={() => setFormData({ ...formData, color })} className={`w-full h-8 rounded-md border-2 transition-all ${formData.color === color ? "border-primary scale-110 shadow-sm" : "border-transparent hover:scale-105"}`} style={{ backgroundColor: color }} title={color} data-testid={`color-option-${color}`} />
                              ))}
                              <ColorSpectrumPicker
                                compact
                                value={formData.color}
                                selected={!defaultColors.includes(formData.color)}
                                onChange={(color) => setFormData({ ...formData, color })}
                                testId="profile-custom-color-input"
                              />
                            </div>
                          </div>
                            </div>
                          </div>

{/* Adult vs Kid role (drives Parent-PIN gating) + COPPA under-13
                              sub-question — switching this on an EXISTING profile is always
                              PIN-gated at submit time (see handleSubmit), regardless of the
                              optional PIN_GATE_FEATURES checklist. */}
                          {!editingProfile?.isAllFamilyProfile && (
                            <div className="rounded-lg border border-border/60 bg-accent/20 p-3 space-y-2">
                              <div>
                                <Label className="text-sm">This person is a…</Label>
                                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                                  {(["adult", "child"] as const).map(r => (
                                    <button
                                      key={r}
                                      type="button"
                                      onClick={() => setFormData({ ...formData, role: r, ...(r === "adult" ? { isChild: false } : {}) })}
                                      className={cn(
                                        "px-2 py-1.5 text-xs rounded-lg border transition-colors",
                                        formData.role === r
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "border-border text-muted-foreground hover:bg-accent/40",
                                      )}
                                      data-testid={`profile-edit-role-${r}`}
                                    >
                                      {r === "adult" ? "🧑 Grown-up" : "🧒 Kid"}
                                    </button>
                                  ))}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                                  {formData.role === "adult"
                                    ? ADULT_ROLE_EXPLAINER
                                    : KID_ROLE_EXPLAINER}
                                </p>
                              </div>

                              {formData.role === "child" && (
                                <div className="pt-2 border-t border-border/40 space-y-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <Label htmlFor="edit-is-child" className="text-sm">Is this kid under 13?</Label>
                                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                                        {editingProfile?.parentalConsentAt
                                          ? "Required for children's privacy (COPPA). Consent is already on file, so you won't be asked again."
                                          : "Required for children's privacy (COPPA). You'll be asked to confirm parental consent."}
                                      </p>
                                    </div>
                                    <Switch
                                      id="edit-is-child"
                                      checked={formData.isChild}
                                      onCheckedChange={(v) => setFormData({ ...formData, isChild: v })}
                                      data-testid="profile-edit-is-child-toggle"
                                    />
                                  </div>
                                  {/* Tied to the toggle directly above, not shown on its own: a profile
    switched back to Grown-up (or out of under-13) keeps its historical
    consent row, and showing "consent recorded" beside an off switch read
    as the two disagreeing about the same question. */}
                                  {editingProfile?.parentalConsentAt && formData.isChild && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3" />
                                      Parental consent recorded
                                      {` on ${new Date(editingProfile.parentalConsentAt).toLocaleDateString()}`}
                                    </p>
                                  )}
                                  {!profileFormRewardSettings?.hasParentPin && (
                                    <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                      <span>{KID_NEEDS_PIN_NUDGE}</span>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <Button type="submit" className="w-full h-10 text-base font-semibold shadow-sm" disabled={createProfileMutation.isPending || updateProfileMutation.isPending} data-testid="save-profile-button">
                            <Save className="w-4 h-4 mr-1.5" />
                            {createProfileMutation.isPending || updateProfileMutation.isPending ? "Saving…" : "Save profile"}
                          </Button>
                          {!editingProfile?.isAllFamilyProfile && (
                            <div className="pt-2 mt-1 border-t border-border/60 flex justify-center">
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => setDeletingProfileId(editingProfile?.id ?? null)}
                                data-testid={`delete-profile-${editingProfile?.name?.toLowerCase()}`}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Delete this profile
                              </Button>
                            </div>
                          )}
                        </form>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {profile.isAllFamilyProfile && (
                    // Pulled tight against its own row (the list's own
                    // space-y-2 then puts a clear gap before the NEXT row), and
                    // indented to line up with the row's text rather than its
                    // avatar, so it reads as a footnote to the row above.
                    <p className="text-[10px] text-muted-foreground ml-11 -mt-0.5 italic">
                      This is a default profile for the entire family. You can customize its look but not delete it.
                    </p>
                  )}
                </div>
              );
              })}
            </div>

            {/* Login accounts with no matching profile (merged Members view) */}
            <LoginOnlyMembers profileEmails={profiles.map((p) => p.email ?? "").filter(Boolean)} />

            {/* Profile ghost card portalled to body */}
            {profileDragId && profileGhostPos && (() => {
              const p = profiles.find(x => x.id === profileDragId);
              if (!p) return null;
              return createPortal(
                <div
                  style={{ position: 'fixed', left: profileGhostPos.x, top: profileGhostPos.y, pointerEvents: 'none', zIndex: 9999, width: 200 }}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card border border-primary shadow-2xl opacity-95 rotate-1"
                >
                  <GripVertical className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="w-6 h-6 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-sm font-medium truncate">{p.name}</span>
                </div>,
                document.body
              );
            })()}
            </div>
            </div>
          </SettingsSection>

          {/* Custom Groups — its own section (2026-09-01). It was the last
              block of People, below the profile list and both add/edit forms,
              which made it effectively undiscoverable. */}
          <SettingsSection id="groups" title="Custom Groups" icon={<Users className="w-4 h-4" />} isOpen={sectionIsOpen("groups")} onToggle={() => toggleSection("groups")} hidden={sectionHidden("groups")}>
            {/* No "Custom Groups" label here — it restated the section header
                directly above it. */}
            <p className="text-xs text-muted-foreground mb-2">
              Groups like "Adults" or "Kids", to select several people at once.
            </p>
            <div>
            {!isAddingGroup && (
              <div className="flex justify-end mb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAddingGroup(true)}
                  className="h-7 text-xs"
                  data-testid="add-custom-group-button"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add group
                </Button>
              </div>
            )}

            {/* Add/Edit Group Form */}
            {isAddingGroup && (
              <form onSubmit={handleGroupSubmit} className="space-y-3 p-3 bg-accent/30 rounded-lg ring-2 ring-primary/70 mb-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">
                    {editingGroup ? "Edit Group" : "Add New Group"}
                  </h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelGroupEdit}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                
                {/* Name and icon on one row, but the icon picker is a compact
                    square button rather than a third of a 3-column grid — at
                    that width its label clipped mid-word ("Change i"). */}
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="group-name" className="text-sm">Group Name</Label>
                    <Input
                      id="group-name"
                      value={groupFormData.name}
                      onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
                      placeholder="e.g., Adults, Kids"
                      className="h-9"
                      data-testid="group-name-input"
                    />
                  </div>
                  <div className="shrink-0">
                    <Label className="text-sm">Icon</Label>
                    <EmojiPicker
                      compact
                      value={groupFormData.icon}
                      onChange={(v) => setGroupFormData({ ...groupFormData, icon: v })}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm">Select Family Members</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {profiles.filter(p => !p.isAllFamilyProfile).map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => toggleProfileInGroup(profile.id)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                          groupFormData.profileIds.includes(profile.id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:bg-accent/40",
                        )}
                      >
                        <div 
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: profile.color }}
                        />
                        {profile.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={cancelGroupEdit}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 font-semibold shadow-sm"
                    disabled={createGroupMutation.isPending || updateGroupMutation.isPending}
                    data-testid="save-group-button"
                  >
                    <Save className="w-4 h-4 mr-1.5" />
                    {createGroupMutation.isPending || updateGroupMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            )}

            {/* Existing Groups List — draggable to reorder when there's more than one. */}
            <div className="space-y-2">
              {customGroups.map((group) => (
                <div
                  key={group.id}
                  ref={(el) => { if (el) groupRowRefs.current.set(group.id, el); else groupRowRefs.current.delete(group.id); }}
                  className={cn(
                    "flex items-center gap-2 p-2 bg-accent/30 rounded-lg transition-all duration-150",
                    groupDragId === group.id && "opacity-30 scale-95 bg-primary/10",
                  )}
                  data-testid={`custom-group-row-${group.id}`}
                >
                  {customGroups.length > 1 && (
                    <span
                      className="flex items-center justify-center -my-1 -ml-1 p-2 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
                      style={{ touchAction: "none" }}
                      onPointerDown={(e) => handleGroupGripDown(e, group.id)}
                      data-testid={`custom-group-drag-handle-${group.id}`}
                    >
                      <GripVertical className="w-5 h-5 text-muted-foreground" />
                    </span>
                  )}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0"
                    style={{ backgroundColor: group.color || '#6366f1' }}
                  >
                    {group.icon || '👥'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(group.profileIds || []).length} member{(group.profileIds || []).length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEditGroup(group)}
                      aria-label={`Edit the ${group.name} group`}
                      title={`Edit the ${group.name} group`}
                      className="h-6 w-6 p-0"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => { if (await confirmDialog({ title: `Delete the "${group.name}" group?` })) deleteGroupMutation.mutate(group.id); }}
                      aria-label={`Delete the ${group.name} group`}
                      title={`Delete the ${group.name} group`}
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {groupDragId && groupGhostPos && (() => {
                const g = customGroups.find((x) => x.id === groupDragId);
                if (!g) return null;
                return createPortal(
                  <div
                    style={{ position: "fixed", left: groupGhostPos.x, top: groupGhostPos.y, pointerEvents: "none", zIndex: 9999, width: 200 }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card border border-primary shadow-2xl opacity-95 rotate-1"
                  >
                    <GripVertical className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-base">{g.icon || "👥"}</span>
                    <span className="text-sm font-medium truncate">{g.name}</span>
                  </div>,
                  document.body,
                );
              })()}
              {customGroups.length === 0 && !isAddingGroup && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No custom groups yet. Create one to quickly select multiple family members!
                </p>
              )}
            </div>
            </div>
          </SettingsSection>

          {/* Sharing — invite codes + read-only caretaker links. Both moved out
              of "Account & Family" and "Calendars & Sharing" respectively, since
              they're both about giving access to someone else, not personal
              account/calendar configuration. */}
          <SettingsSection id="sharing" title="Sharing" icon={<Share2 className="w-4 h-4" />} isOpen={sectionIsOpen("sharing")} onToggle={() => toggleSection("sharing")} hidden={sectionHidden("sharing")}>
            <div className="space-y-4">
              <FamilyInviteManager />
              <Separator />
              <div>
                {/* Styled like a real expandable section (icon, title,
                    always-visible one-line explainer, chevron) instead of a
                    small uppercase text label — that read as a section
                    heading with nothing under it rather than something
                    tappable. The explainer is shown here, BEFORE expanding,
                    so it's possible to decide whether to open this at all
                    without guessing — it used to live inside
                    ShareLinksSection itself, only visible after the tap. */}
                <button
                  type="button"
                  onClick={() => setShowCaretakerLinks((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50 transition-colors"
                  data-testid="toggle-caretaker-links"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Share with Caretakers</p>
                      <p className="text-xs text-muted-foreground">
                        Make a read-only link to this week's schedule for a babysitter or grandparent — no login needed.
                      </p>
                    </div>
                  </div>
                  {showCaretakerLinks ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
                {showCaretakerLinks && (
                  <div className="mt-3">
                    <ShareLinksSection />
                  </div>
                )}
              </div>
            </div>
          </SettingsSection>

          {/* Calendar */}
          <SettingsSection id="calendar" title="Calendar" icon={<Calendar className="w-4 h-4" />} isOpen={sectionIsOpen("calendar")} onToggle={() => toggleSection("calendar")} hidden={sectionHidden("calendar")}>
            <CalendarConnectionsSection
              profiles={profiles}
              isOpen={isOpen}
              initialCalendarProfileId={initialCalendarProfileId}
              initialCalendarSpotlightAll={initialCalendarSpotlightAll}
            />
          </SettingsSection>

          {/* Display */}
          <SettingsSection id="appearance" title="Display & Layout" icon={<LayoutDashboard className="w-4 h-4" />} isOpen={sectionIsOpen("appearance")} onToggle={() => toggleSection("appearance")} hidden={sectionHidden("appearance")}>

            <div className="space-y-4">

              {/* Theme lives as an icon in this modal's header, not in here —
                  which is the first place people look for dark mode. Rather
                  than add a second control (a duplicate was deliberately
                  removed once already), point at the real one. */}
              <button
                type="button"
                onClick={cycleTheme}
                className="w-full flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent transition-colors"
                data-testid="appearance-theme-row"
              >
                <span className="text-sm font-medium text-foreground">Theme</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {themeLabel}
                  <ThemeIcon className="w-4 h-4" />
                </span>
              </button>

              {/* Only earns its keep on a device set never to sleep: one that
                  sleeps already stops polling on its own when the screen goes
                  off. Off by default — it changes what an existing family's
                  dashboard does. */}
              <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Screensaver on this device</p>
                  <p className="text-xs text-muted-foreground">
                    After {Math.round(SCREENSAVER_IDLE_MS / 60_000)} minutes untouched, show the clock over
                    your privacy screen picture instead of the hub. Tap to bring it back — it
                    refreshes before it does, so nothing on screen is ever out of date.
                  </p>
                </div>
                <Switch
                  checked={screensaverOn}
                  onCheckedChange={(on) => { setScreensaverOn(on); setScreensaverEnabled(on); }}
                  data-testid="toggle-screensaver"
                  aria-label="Screensaver on this device"
                />
              </div>

              {/* Visible Tabs + Default Tab */}
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Tabs</p>
                {/* The nav bar as it will actually look, updating as the list
                    below is reordered, unchecked, or switched to icons-only.
                    It replaces two sentences that narrated those controls —
                    neither of which had any visible effect on this screen,
                    which is precisely why they needed narrating. */}
                <div
                  // flex-nowrap: this is a preview of a single nav ROW, so
                  // wrapping it 4-and-1 misrepresents what it's previewing.
                  // The real nav shrinks to fit rather than wrapping, so the
                  // preview does the same (tighter gap/padding, and each
                  // label may truncate before the row ever breaks).
                  className="flex items-center justify-center gap-0.5 flex-nowrap overflow-hidden mb-3 px-1.5 py-2 rounded-lg bg-background/60 border border-border"
                  data-testid="nav-preview"
                >
                  {FIXED_NAV_IDS.map(tabId => {
                    const tab = ALL_TABS.find(t => t.id === tabId);
                    if (!tab) return null;
                    if (!tab.alwaysVisible && hiddenTabs.includes(tabId)) return null;
                    const Icon = tab.icon;
                    return (
                      <span
                        key={tabId}
                        className={`flex items-center min-w-0 shrink rounded-full px-1 py-1 text-[10px] ${
                          tabId === defaultTab ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                        }`}
                        data-testid={`nav-preview-${tabId}`}
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        {!navIconsOnly && <span className="ml-0.5 truncate">{tab.shortLabel ?? tab.label}</span>}
                      </span>
                    );
                  })}
                </div>
                <div ref={tabListRef}>
                {FIXED_NAV_IDS.map(tabId => {
                  const tab = ALL_TABS.find(t => t.id === tabId);
                  if (!tab) return null;
                  const isVisible = tab.alwaysVisible || !hiddenTabs.includes(tabId);
                  const isDragging = dragId === tabId;
                  return (
                    <div
                      key={tabId}
                      id={`tab-visibility-row-${tabId}`}
                      data-tab-id={tabId}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-md mb-1 select-none transition-all duration-300 ${
                        isDragging
                          ? 'opacity-30 bg-primary/10 scale-95'
                          : highlightedTabId === tabId
                            ? 'bg-primary/10 ring-2 ring-primary'
                            : 'bg-background/60 hover:bg-background'
                      }`}
                    >
                      <Checkbox
                        id={`tab-${tabId}`}
                        checked={isVisible}
                        disabled={tab.alwaysVisible}
                        onCheckedChange={tab.alwaysVisible ? undefined : (checked) => handleTabVisibilityToggle(tabId, !!checked)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`tab-visibility-${tabId}`}
                      />
                      <Label
                        htmlFor={`tab-${tabId}`}
                        className={`text-sm select-none flex-1 ${tab.alwaysVisible ? 'cursor-default' : 'cursor-pointer'}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {tab.label}
                        {tab.alwaysVisible && (
                          <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                            Always shown
                          </span>
                        )}
                      </Label>
                    </div>
                  );
                })}
                </div>
                {/* Ghost card — portalled to body to escape modal transform stacking context */}
                {dragId && ghostPos && (() => {
                  const tab = ALL_TABS.find(t => t.id === dragId);
                  if (!tab) return null;
                  return createPortal(
                    <div
                      style={{ position: 'fixed', left: ghostPos.x, top: ghostPos.y, pointerEvents: 'none', zIndex: 9999, width: 180 }}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-card border border-primary shadow-2xl opacity-95 rotate-1"
                    >
                      <GripVertical className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium">{tab.label}</span>
                    </div>,
                    document.body
                  );
                })()}
                {/* Icons-only nav — for when enough tabs are turned on that
                    the labeled pill row no longer fits on one line without
                    scrolling; hiding the text shrinks it back down. */}
                <div className="flex items-center justify-between gap-2 mt-2 px-2.5 py-2 rounded-md bg-background/60">
                  <div>
                    <Label htmlFor="nav-icons-only" className="text-sm cursor-pointer">Icons only in nav bar</Label>
                  </div>
                  <Switch
                    id="nav-icons-only"
                    checked={navIconsOnly}
                    onCheckedChange={(checked) => setNavIconsOnly?.(checked)}
                    data-testid="nav-icons-only-toggle"
                  />
                </div>
                {/* Default Tab — compact inline selector directly below the drag list */}
                <div className="flex items-center gap-2 mt-2 px-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Default tab:</span>
                  <Select value={defaultTab} onValueChange={(val) => setDefaultTab?.(val)}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_TABS.filter(t => t.id === 'home' || !hiddenTabs.includes(t.id)).map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

            </div>
          </SettingsSection>

          {/* Rewards & Approvals */}
          <SettingsSection id="rewards" title="Rewards & Approvals" icon={<Gift className="w-4 h-4" />} isOpen={sectionIsOpen("rewards")} onToggle={() => toggleSection("rewards")} hidden={sectionHidden("rewards")}>
            <div className="space-y-4">
              {/* "Everyone" / "Each person" are deliberately parallel: the same
                  settings, family-wide vs. per-person. Both collapsed, so the
                  section opens as a short list of named parts instead of one
                  expanded form followed by three headings. */}
              <SubSection title="Everyone" testId="rewards-everyone">
                <RewardsSettingsSection />
              </SubSection>
              <Separator />
              <SubSection title="Each person" testId="rewards-each-person">
                <PerPersonSettingsSection profiles={profiles} sections="rewards" />
              </SubSection>
              <Separator />
              {/* Parent PIN — briefly its own top-level section (2026-08), now
                  back here (2026-09-01). It sits directly above Approvals
                  because the PIN is what gates them. */}
              <SubSection title="Parent PIN" testId="rewards-parent-pin">
                <ParentPinSettingsSection />
              </SubSection>
              <Separator />
              <SubSection title="Approvals" testId="rewards-approvals">
                <ParentControlsSettingsSection profiles={profiles} />
              </SubSection>
            </div>
          </SettingsSection>

          {/* Notifications — device setup, notification types, and each
              person's reminder times (bedtime / daily brief / weekly recap),
              which used to live in a separate "Per-Person Settings" section. */}
          <SettingsSection id="notifications" title="Notifications" icon={<Bell className="w-4 h-4" />} isOpen={sectionIsOpen("notifications")} onToggle={() => toggleSection("notifications")} hidden={sectionHidden("notifications")}>
            <NotificationsSection profiles={profiles} />
          </SettingsSection>

          {/* Subscription sits last, next to the other account-admin
              actions in the footer below. It used to sit between Parent PIN
              and Per-Person Settings, breaking up two groups of things people
              actually configure with one they touch once. */}
          <SettingsSection id="subscription" title="Subscription" icon={<Sparkles className="w-4 h-4" />} isOpen={sectionIsOpen("subscription")} onToggle={() => toggleSection("subscription")} hidden={sectionHidden("subscription")}>
            <SubscriptionSettingsSection />
          </SettingsSection>

          {/* Sign Out / Reset Data / Delete Account / policy links — inside
              the normal scrollable flow at the very bottom (not a fixed/sticky
              footer) so the user has to scroll to reach them, same as any
              other section. Sign Out stays visually prominent; Reset Data /
              Delete Account stay behind the existing "Show advanced/
              destructive actions" reveal since they're rare, destructive
              actions that shouldn't sit at the same visual weight by default. */}
          <div className="border-t border-border px-1 pt-3 pb-2 space-y-1.5 mt-2">
            {onReplayOnboarding && (
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={onReplayOnboarding} data-testid="settings-replay-onboarding-button">
                <Compass className="w-4 h-4 mr-2" /> Replay setup walkthrough
              </Button>
            )}

            {/* Deliberate "rate the app" path. This deep-links to the App Store
                rather than calling requestReview() — Apple's guidelines forbid
                triggering the native prompt from a button tap, and the native
                prompt is reserved for the all-chores-done moment (see
                lib/reviewPrompt.ts). Renders nothing until APP_STORE_ID is
                filled in there, which can only happen once the app exists in
                App Store Connect. */}
            {canOpenStoreReviewPage() && (
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => openStoreReviewPage()} data-testid="settings-rate-app-button">
                <Star className="w-4 h-4 mr-2" /> Rate Family Hub+
              </Button>
            )}

            {/* One-off verification button for the Sentry wiring — only
                renders once VITE_SENTRY_DSN is actually set, so it
                disappears again on its own once confirmed working (there's
                nothing to remember to remove). */}
            {sentryEnabled && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => sendSentryTest.mutate()}
                disabled={sendSentryTest.isPending}
                data-testid="settings-sentry-test-button"
              >
                <Bug className="w-4 h-4 mr-2" /> {sendSentryTest.isPending ? "Sending…" : "Send test error to Sentry"}
              </Button>
            )}

            <Button variant="default" className="w-full h-auto py-2.5 whitespace-nowrap text-sm font-semibold" onClick={() => setSignOutStep(1)} data-testid="settings-sign-out-button">
              <LogOut className="w-5 h-5 mr-2" /> Sign out
            </Button>

            <div className="flex gap-3 text-xs text-muted-foreground pt-1">
              <a href="/privacy" className="hover:underline">Privacy Policy</a>
              <a href="/terms" className="hover:underline">Terms of Service</a>
              <a href="/support" className="hover:underline">Support</a>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* ── COPPA parental consent gate ── */}
      <Dialog
        open={consentGateOpen}
        onOpenChange={(open) => { if (!open) { setConsentGateOpen(false); setConsentAffirmed(false); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              Parental consent required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground leading-relaxed">
              For children under 13, COPPA requires a parent or guardian to consent
              before we store any information.
            </p>
            <div className="rounded-lg border border-border/60 bg-accent/20 p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What we store for a child</p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                <li>Profile name, initials, color, and optional photo</li>
                <li>Chores, tasks, stars, rewards, and completion history</li>
                <li>Birth year, only if you choose to provide it</li>
              </ul>
              <p className="text-xs text-muted-foreground pt-1">
                We never use this data for advertising or share it with third parties
                for their own purposes. You can delete this profile at any time.{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                  Privacy Policy
                </a>
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <Checkbox
                checked={consentAffirmed}
                onCheckedChange={(v) => setConsentAffirmed(v === true)}
                className="mt-0.5"
                data-testid="parental-consent-checkbox"
              />
              <span className="text-xs leading-snug">
                I am this child's parent or legal guardian, and I consent to Family Hub+
                collecting and storing the information described above.
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => { setConsentGateOpen(false); setConsentAffirmed(false); }}
            >
              Cancel
            </Button>
            <Button
              disabled={!consentAffirmed || createProfileMutation.isPending || updateProfileMutation.isPending || grantConsentMutation.isPending}
              onClick={async () => {
                try {
                  await performProfileSave(true);
                  setConsentGateOpen(false);
                  setConsentAffirmed(false);
                } catch {
                  // Errors are surfaced via the mutations' onError toasts;
                  // keep the gate open so the parent can retry.
                }
              }}
              data-testid="parental-consent-confirm"
            >
              {(createProfileMutation.isPending || updateProfileMutation.isPending || grantConsentMutation.isPending)
                ? "Saving…"
                : "I consent — save profile"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Parent PIN gate for switching a profile's Grown-up/Kid role ── */}
      <Dialog
        open={roleChangePinOpen}
        onOpenChange={(open) => { if (!open) { setRoleChangePinOpen(false); setRoleChangePinInput(""); setRoleChangePinError(""); } }}
      >
        {/* autoFocusFirst, not a bare autoFocus on the input: an explicit
            onOpenAutoFocus={preventDefault} here cancelled Radix's open-focus
            AFTER React had applied the input's autoFocus, so focus landed back
            on the dialog and the keyboard never came up. Every other PIN
            dialog in the app (parentGate, Cash-Out Approvals, Add/Remove
            Stars) already uses autoFocusFirst — this one was the outlier. */}
        <DialogContent className="max-w-xs" autoFocusFirst>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              Parent PIN required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {profileFormRewardSettings?.hasParentPin
                ? "Changing whether this profile is a Grown-up or a Kid changes what they can do unsupervised. Enter the Parent PIN to confirm."
                : "No PIN is set — tap Confirm to continue as a parent. You can set a Parent PIN in Settings → Rewards & Approvals."}
            </p>
            <PasswordInput
              value={roleChangePinInput}
              onChange={(e) => { setRoleChangePinInput(e.target.value); setRoleChangePinError(""); }}
              placeholder="4-digit PIN"
              inputMode="numeric"
              maxLength={4}
              onKeyDown={(e) => { if (e.key === "Enter") verifyRoleChangePinMutation.mutate(roleChangePinInput); }}
              data-testid="role-change-pin-input"
            />
            {roleChangePinError && <p className="text-xs text-destructive">{roleChangePinError}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => { setRoleChangePinOpen(false); setRoleChangePinInput(""); setRoleChangePinError(""); }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => verifyRoleChangePinMutation.mutate(roleChangePinInput)}
              disabled={verifyRoleChangePinMutation.isPending || (!!profileFormRewardSettings?.hasParentPin && roleChangePinInput.length !== 4)}
              data-testid="role-change-pin-confirm"
            >
              {verifyRoleChangePinMutation.isPending ? "Checking…" : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete profile confirmation ── */}
      <Dialog open={!!deletingProfileId} onOpenChange={(open) => { if (!open) setDeletingProfileId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete profile?
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              This will permanently delete <strong>{profiles.find(p => p.id === deletingProfileId)?.name ?? "this profile"}</strong> and remove them from all chores, events, and rewards. This cannot be undone.
            </p>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeletingProfileId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteProfileMutation.isPending}
              data-testid="delete-profile-confirm"
              onClick={() => {
                if (deletingProfileId) {
                  deleteProfileMutation.mutate(deletingProfileId, {
                    onSuccess: () => {
                      setDeletingProfileId(null);
                      cancelEdit();
                    },
                  });
                }
              }}
            >
              {deleteProfileMutation.isPending ? "Deleting…" : "Yes, delete profile"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Sign-out confirmation (2 steps) ── */}
      <Dialog open={signOutStep > 0} onOpenChange={(open) => { if (!open) setSignOutStep(0); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-muted-foreground" />
              {signOutStep === 1 ? "Sign out?" : "Are you sure?"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              {signOutStep === 1
                ? "You'll need to log back in to access Family Hub+. Click Continue to proceed."
                : "This is your final confirmation. Click Sign out to end your session."}
            </p>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSignOutStep(0)}>Cancel</Button>
            {signOutStep === 1
              ? <Button onClick={() => setSignOutStep(2)}>Continue →</Button>
              : <Button variant="destructive" onClick={() => logout()} data-testid="settings-logout-confirm">Sign out</Button>
            }
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reset all data (2 steps) ── */}
      <Dialog open={resetStep !== "closed"} onOpenChange={(open) => { if (!open) { setResetStep("closed"); setResetConfirmText(""); setResetCategories([]); } }}>
        <DialogContent className="max-w-sm">
          {resetStep === "choice" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Reset data
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Choose whether to reset everything, or only specific categories of data.
                </p>
              </DialogHeader>
              <div className="flex flex-col gap-2 pt-2">
                <Button variant="outline" className="justify-start" onClick={() => { setResetCategories([]); setResetStep("categories"); }}>
                  Reset specific data…
                </Button>
                <Button variant="destructive" className="justify-start" onClick={() => setResetStep("all-warning")}>
                  Reset everything
                </Button>
                <Button variant="ghost" onClick={() => setResetStep("closed")}>Cancel</Button>
              </div>
            </>
          )}
          {resetStep === "all-warning" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Reset all data?
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Permanently deletes every family member, chore, event, reward, meal, and everything else in your account. Cannot be undone.
                </p>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setResetStep("choice")}>Back</Button>
                <Button variant="destructive" onClick={() => setResetStep("all-confirm")}>I understand, continue →</Button>
              </div>
            </>
          )}
          {resetStep === "all-confirm" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Final confirmation
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Type <strong>RESET</strong> below to permanently delete all your data and start from scratch.
                </p>
              </DialogHeader>
              <input
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder="Type RESET to confirm"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
                data-testid="reset-confirm-input"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setResetStep("closed"); setResetConfirmText(""); }}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={resetConfirmText !== "RESET"}
                  data-testid="reset-confirm-button"
                  onClick={async () => {
                    try {
                      await apiRequest("DELETE", "/api/account/reset");
                      localStorage.removeItem("familyHub_hiddenTabs");
                      await queryClient.invalidateQueries();
                      setResetStep("closed");
                      setResetConfirmText("");
                    } catch {
                      toast({ title: "Reset failed", description: "Please try again.", variant: "destructive" });
                    }
                  }}
                >
                  Delete everything
                </Button>
              </div>
            </>
          )}
          {resetStep === "categories" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Reset specific data
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Categories you check are permanently deleted.
                </p>
              </DialogHeader>
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {RESET_CATEGORY_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={resetCategories.includes(opt.key)}
                      onChange={e => {
                        setResetCategories(prev => e.target.checked ? [...prev, opt.key] : prev.filter(k => k !== opt.key));
                      }}
                      data-testid={`reset-category-${opt.key}`}
                    />
                    <span>
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setResetStep("choice")}>Back</Button>
                <Button
                  variant="destructive"
                  disabled={resetCategories.length === 0}
                  onClick={() => setResetStep("categories-confirm")}
                >
                  Continue →
                </Button>
              </div>
            </>
          )}
          {resetStep === "categories-confirm" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Final confirmation
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Type <strong>RESET</strong> below to permanently delete data in: {resetCategories.map(k => RESET_CATEGORY_OPTIONS.find(o => o.key === k)?.label).join(", ")}.
                </p>
              </DialogHeader>
              <input
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder="Type RESET to confirm"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
                data-testid="reset-categories-confirm-input"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setResetStep("categories"); setResetConfirmText(""); }}>Back</Button>
                <Button
                  variant="destructive"
                  disabled={resetConfirmText !== "RESET"}
                  data-testid="reset-categories-confirm-button"
                  onClick={async () => {
                    try {
                      await apiRequest("POST", "/api/account/reset-categories", { categories: resetCategories });
                      localStorage.removeItem("familyHub_hiddenTabs");
                      await queryClient.invalidateQueries();
                      setResetStep("closed");
                      setResetConfirmText("");
                      setResetCategories([]);
                    } catch {
                      toast({ title: "Reset failed", description: "Please try again.", variant: "destructive" });
                    }
                  }}
                >
                  Delete selected data
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete account confirmation (2 steps + typed confirmation) ── */}
      <Dialog open={deleteStep > 0} onOpenChange={(open) => { if (!open) { setDeleteStep(0); setDeleteConfirmText(""); } }}>
        <DialogContent className="max-w-sm">
          {deleteStep === 1 && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Delete your account?
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  {user?.family && user.family.isOwner === false ? (
                    <>
                      This permanently deletes your login and removes you from your family. The
                      family's shared data stays with the owner. This cannot be undone.
                    </>
                  ) : (
                    <>
                      Deletes your login and, because you're the family owner, all your family's
                      data. This cannot be undone.
                    </>
                  )}
                </p>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDeleteStep(0)}>Cancel</Button>
                <Button variant="destructive" onClick={() => setDeleteStep(2)}>I understand, continue →</Button>
              </div>
            </>
          )}
          {deleteStep === 2 && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Final confirmation
                </DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">
                  Type <strong>DELETE</strong> below to permanently delete your account.
                </p>
              </DialogHeader>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
                data-testid="delete-account-confirm-input"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setDeleteStep(0); setDeleteConfirmText(""); }}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={deleteConfirmText !== "DELETE" || deleteSubmitting}
                  data-testid="delete-account-confirm-button"
                  onClick={async () => {
                    setDeleteSubmitting(true);
                    try {
                      // apiRequest (not a raw relative fetch) so this reaches
                      // the backend origin with the native bearer token on iOS.
                      await apiRequest("DELETE", "/api/auth/account");
                      window.location.href = "/";
                    } catch (err: any) {
                      toast({ title: "Couldn't delete account", description: err?.message || "Please try again.", variant: "destructive" });
                      setDeleteSubmitting(false);
                    }
                  }}
                >
                  {deleteSubmitting ? "Deleting…" : "Delete My Account"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
    {kbOpen && <KbPanel onClose={() => setKbOpen(false)} />}
    </>
  );
}
