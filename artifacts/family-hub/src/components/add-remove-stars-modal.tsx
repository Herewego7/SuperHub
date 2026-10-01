import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lock, Minus, Plus, Star } from "lucide-react";
import type { Profile, RewardSettings } from "@workspace/shared-types";

interface Props {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
}

/**
 * Full-screen spotlight for adding/removing a family member's stars — same
 * "one focused screen, everything else dimmed away" treatment as the Parent
 * PIN dialog. Reachable only from the global "+" button (moved out of
 * Rewards → Parent Controls, which is now cash-out approvals only). Always
 * requires the Parent PIN itself, the same "no exceptions" rule cash-out
 * approval already follows — it doesn't share the app's rolling PIN-unlock
 * window used elsewhere, and re-prompts every time this spotlight opens.
 */
export function AddRemoveStarsModal({ open, onClose, profiles }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"], enabled: open });

  const [verified, setVerified] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  const regularProfiles = profiles.filter((p) => !p.isAllFamilyProfile);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  // Fresh start every time this spotlight opens — a PIN entered a moment ago
  // for something else shouldn't carry over, and a stale delta from the last
  // visit shouldn't either.
  useEffect(() => {
    if (!open) return;
    setVerified(false);
    setPin("");
    setPinError("");
    setDelta(0);
    setReason("");
    setProfileId(regularProfiles[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const verifyPinMutation = useMutation({
    mutationFn: async (value: string) => (await apiRequest("POST", "/api/reward-settings/verify-pin", { pin: value })).json(),
    onSuccess: (data: { ok: boolean }) => {
      if (data.ok) {
        setVerified(true);
      } else {
        setPinError("Incorrect PIN. Try again.");
      }
    },
    onError: (err: any) => setPinError(err?.message || "Couldn't verify PIN."),
  });

  const adjustMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/points/${profileId}/adjust`, { delta, reason: reason.trim() || undefined })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet", profileId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} ⭐` });
      onClose();
    },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't adjust stars", variant: "destructive" }),
  });

  const selectedProfile = regularProfiles.find((p) => p.id === profileId);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Autofocus only on the PIN step — on the wheel step the first
          focusable is a profile chip, whose focus ring would read as an
          already-made choice. */}
      <DialogContent className="max-w-xs" autoFocusFirst={!verified}>
        {!verified ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-4 h-4" /> Parent PIN
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {rewardSettings?.hasParentPin ? (
                <p className="text-xs text-muted-foreground">
                  Enter the Parent PIN to add or remove stars.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No PIN is set — tap Unlock to continue. You can set one in Settings → Rewards &amp; Approvals.
                </p>
              )}
              <PasswordInput
                inputMode="numeric"
                maxLength={4}
                placeholder="Enter 4-digit PIN"
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                className="tracking-widest text-center text-lg"
                data-testid="add-remove-stars-pin-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (!rewardSettings?.hasParentPin || pin.length === 4)) verifyPinMutation.mutate(pin);
                }}
              />
              {pinError && <p className="text-xs text-destructive">{pinError}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                onClick={() => verifyPinMutation.mutate(pin)}
                disabled={verifyPinMutation.isPending || (!!rewardSettings?.hasParentPin && pin.length !== 4)}
                data-testid="add-remove-stars-unlock"
              >
                {verifyPinMutation.isPending ? "Checking…" : "Unlock"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-500" /> Add/Remove Stars
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground -mt-1">
              Scroll the wheel up to add stars, down to remove them.
            </p>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">For</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {regularProfiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProfileId(p.id)}
                    className={`shrink-0 flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      profileId === p.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                    }`}
                    data-testid={`add-remove-stars-who-${p.id}`}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <StarsWheel value={delta} onChange={setDelta} />

            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={140}
              className="w-full h-9"
              data-testid="add-remove-stars-reason"
            />

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                onClick={() => adjustMutation.mutate()}
                disabled={adjustMutation.isPending || delta === 0 || !profileId}
                data-testid="add-remove-stars-apply"
              >
                {adjustMutation.isPending
                  ? "Applying…"
                  : delta === 0
                    ? "Apply"
                    : `${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} ⭐${selectedProfile ? ` for ${selectedProfile.name}` : ""}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The wheel ────────────────────────────────────────────────────────────
// Replaces the old Add/Remove toggle + a positive-amount field with one
// control: drag or scroll away from 0 in either direction (or tap ± to nudge
// by one). Positive tints green, negative tints rose, matching the reviewed
// mockup.
const MIN_DELTA = -50;
const MAX_DELTA = 50;

function StarsWheel({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const dragState = useRef<{ startY: number; startVal: number } | null>(null);

  const clamp = (v: number) => Math.max(MIN_DELTA, Math.min(MAX_DELTA, v));

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    onChange(clamp(value + (e.deltaY < 0 ? 1 : -1)));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { startY: e.clientY, startVal: value };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dy = dragState.current.startY - e.clientY;
    onChange(clamp(dragState.current.startVal + Math.round(dy / 8)));
  };
  const onPointerUp = () => { dragState.current = null; };

  const tone = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const toneClass = tone === "up" ? "text-emerald-500" : tone === "down" ? "text-rose-500" : "text-foreground";
  const ringClass = tone === "up" ? "ring-emerald-500" : tone === "down" ? "ring-rose-500" : "ring-transparent";

  return (
    <div className="flex flex-col items-center py-2 select-none" style={{ touchAction: "none" }}>
      <p className="text-[11px] text-muted-foreground mb-2.5 flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        Scroll or drag to adjust
      </p>
      <div
        className={`relative w-40 h-40 rounded-full bg-muted grid place-items-center cursor-grab active:cursor-grabbing ring-4 transition-[box-shadow] ${ringClass}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="stars-wheel"
      >
        <div className="flex flex-col items-center pointer-events-none">
          <span className={`text-xs font-bold h-4 ${toneClass}`}>
            {value > 0 ? "ADD" : value < 0 ? "REMOVE" : " "}
          </span>
          <span className={`text-4xl font-extrabold tabular-nums leading-none ${toneClass}`} data-testid="stars-wheel-value">
            {Math.abs(value)}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-1">stars</span>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={() => onChange(clamp(value - 1))}
          aria-label="Remove one star"
          data-testid="stars-wheel-minus"
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <button
          type="button"
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => onChange(0)}
          data-testid="stars-wheel-reset"
        >
          Reset to 0
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={() => onChange(clamp(value + 1))}
          aria-label="Add one star"
          data-testid="stars-wheel-plus"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
