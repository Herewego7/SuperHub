import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import type { Profile, RewardSettings } from "@workspace/shared-types";

/**
 * Parent/child divide: certain actions require the Parent PIN when the
 * screen is currently being viewed through a specific child profile's lens
 * (a shared family iPad left on a kid's profile, for instance). Cash-out and
 * reward-request approval are intentionally NOT configurable here — they're
 * always PIN-gated unconditionally via rewards-view.tsx's own existing
 * Parent Controls unlock, never optional.
 */
// Ordered so the checklist can render "recommended" items first, then a
// visually separate "only if you want a tighter lock" group below — see
// `recommended` on each entry, used by settings-modal.tsx to split the
// checklist into those two labeled groups instead of one flat list.
export const PIN_GATE_FEATURES: { key: string; label: string; recommended: boolean }[] = [
  { key: "createChore", label: "Creating & managing chores", recommended: true },
  { key: "createBonusChore", label: "Creating & managing bonus chores", recommended: true },
  { key: "createReward", label: "Creating & managing rewards", recommended: true },
  { key: "calendarSettings", label: "Calendar display settings (the Calendar tab's gear)", recommended: true },
  // Deliberately NOT recommended/pre-checked: to-dos are low-stakes one-off
  // tasks, and opening Settings itself is something most families are fine
  // with a kid doing — both are still available to lock for a family that
  // wants a tighter, more secure setup for their kids.
  { key: "createTodo", label: "Creating & managing to-dos", recommended: false },
  { key: "settings", label: "Opening Settings", recommended: false },
];

// The 4 recommended items above are checked by default; "createTodo" and
// "settings" are deliberately left unchecked — see the comment above.
export const PIN_GATE_DEFAULT_FEATURES: string[] = PIN_GATE_FEATURES.filter((f) => f.recommended).map((f) => f.key);

// Session unlock, shared across every useParentGate instance (chores, bonus
// chores, rewards, settings). Once the Parent PIN is entered correctly, all
// gated actions stay unlocked for a short rolling window so a parent isn't
// re-prompted for each step — e.g. opening the Manage drawer AND then adding
// an item inside it. The window auto-relocks after inactivity, and being
// time-based it survives across separate hook instances and native
// backgrounding without extra bookkeeping.
const UNLOCK_WINDOW_MS = 5 * 60 * 1000;
let parentUnlockedUntil = 0;
function isParentUnlocked(): boolean {
  return Date.now() < parentUnlockedUntil;
}
function refreshParentUnlock(): void {
  parentUnlockedUntil = Date.now() + UNLOCK_WINDOW_MS;
}

/**
 * Is this profile a kid (restricted)? A profile is a kid if its explicit
 * role is "child", OR (for pre-role legacy data) it's a COPPA under-13
 * `isChild` profile — so under-13s stay restricted without a data backfill.
 * An adult is anything else.
 */
export function isKidProfile(profile: { role?: string | null; isChild?: boolean | null } | undefined | null): boolean {
  if (!profile) return false;
  return profile.role === "child" || !!profile.isChild;
}

/**
 * Whether a kid is most likely the one actually using the app right now.
 *
 * Only true when exactly one, specific kid profile is selected — viewing "All
 * Family" or several profiles at once doesn't count, since a parent could
 * easily be among the viewers there.
 *
 * Exported because this is the app's single definition of "kid context" and
 * more than one feature keys off it (the PIN gate below, and the App Store
 * review prompt, which must never ask a child to rate the app).
 */
export function isKidContext(profiles: Profile[], selectedProfiles: string[]): boolean {
  if (selectedProfiles.length !== 1) return false;
  return isKidProfile(profiles.find((p) => p.id === selectedProfiles[0]));
}

export function useParentGate(profiles: Profile[], selectedProfiles: string[]) {
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const [pendingFeature, setPendingFeature] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const isChildContext = isKidContext(profiles, selectedProfiles);

  const gatedFeatures = rewardSettings?.pinGatedFeatures ?? PIN_GATE_DEFAULT_FEATURES;

  function guard(feature: string, action: () => void) {
    const needsPin = isChildContext && gatedFeatures.includes(feature);
    if (needsPin && !isParentUnlocked()) {
      setPendingFeature(feature);
      setPendingAction(() => action);
      setPin("");
      setError("");
      return;
    }
    // Already unlocked (or not gated): run it. If it was a gated action passing
    // on an existing unlock, keep the window alive so a batch of edits doesn't
    // relock mid-flow.
    if (needsPin) refreshParentUnlock();
    action();
  }

  async function submitPin() {
    setChecking(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/reward-settings/verify-pin", { pin });
      const data = await res.json();
      if (data.ok) {
        // Unlock all gated actions for the rolling window before running the
        // pending action, so the very next step (e.g. add inside the drawer
        // we just unlocked to open) doesn't immediately re-prompt.
        refreshParentUnlock();
        pendingAction?.();
        setPendingFeature(null);
        setPendingAction(null);
      } else {
        setError("Incorrect PIN. Try again.");
      }
    } catch {
      setError("Couldn't verify PIN.");
    } finally {
      setChecking(false);
    }
  }

  const gateDialog = (
    <Dialog
      open={!!pendingFeature}
      onOpenChange={(o) => { if (!o) { setPendingFeature(null); setPendingAction(null); } }}
    >
      <DialogContent className="max-w-sm" autoFocusFirst>
        <DialogHeader>
          <DialogTitle>{rewardSettings?.hasParentPin ? "Parent PIN required" : "Continue as a parent?"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* No body copy. With a PIN set, the title plus a 4-digit field is
              already the whole message. With none set, there IS no field —
              the server accepts any (or no) PIN in that case — and an empty
              box you're told to ignore was what needed explaining, so the
              dialog becomes a plain confirm and the button says Continue. */}
          {rewardSettings?.hasParentPin && (
          <PasswordInput
            inputMode="numeric"
            maxLength={4}
            placeholder="Enter 4-digit PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
            className="tracking-widest text-center text-lg"
            data-testid="parent-gate-pin-input"
            onKeyDown={(e) => { if (e.key === "Enter" && (!rewardSettings?.hasParentPin || pin.length === 4)) submitPin(); }}
          />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {/* A parent who's forgotten the PIN isn't locked out — they can
              reset it from Settings by confirming their account password (or
              a code emailed to their own address). Say so here, since this
              dialog is exactly where someone realizes they've forgotten it. */}
          {rewardSettings?.hasParentPin && (
            <p className="text-[11px] text-muted-foreground">
              Forgot it? Reset in Settings → Rewards &amp; Approvals.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setPendingFeature(null); setPendingAction(null); }}>
            Cancel
          </Button>
          <Button
            onClick={submitPin}
            disabled={checking || (!!rewardSettings?.hasParentPin && pin.length !== 4)}
            data-testid="parent-gate-unlock-button"
          >
            {checking ? "Checking…" : rewardSettings?.hasParentPin ? "Unlock" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // gatePending: the PIN dialog is currently up. A caller that opens the gate
  // from inside its own Radix Dialog/Sheet can use this to ignore the
  // close-on-outside-interaction that tapping into the PIN dialog would
  // otherwise trigger on the layer beneath it.
  return { guard, gateDialog, isChildContext, gatePending: !!pendingFeature };
}
