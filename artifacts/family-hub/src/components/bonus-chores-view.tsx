import { useState, useEffect } from "react";
import { objectUrl } from "@/lib/apiBase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Chore, ChoreCompletion, Profile } from "@workspace/shared-types";
import { useParentGate } from "@/lib/parentGate";
import { useTriggerEffect } from "@/lib/useTriggerEffect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Star, Check, Sparkles, Lock, ArrowUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import confetti from "canvas-confetti";
import { hapticSuccess } from "@/lib/haptics";

// Same multi-burst confetti finale used elsewhere in the app (reward
// redemption, finishing all chores) — claiming a bonus chore deserves the
// same celebratory moment, not a single smaller burst.
function fireBonusChoreConfetti() {
  hapticSuccess();
  confetti({ particleCount: 120, spread: 80, origin: { x: 0.5, y: 0.55 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 45, gravity: 0.9, ticks: 200 });
  setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], startVelocity: 50, ticks: 180 }), 150);
  setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899'], startVelocity: 50, ticks: 180 }), 300);
  setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { x: 0.5, y: 0.3 }, colors: ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'], startVelocity: 20, gravity: 1.2, ticks: 250 }), 500);
}

// The server enriches bonus chores with these computed fields
type BonusChore = Chore & { completionCount: number; isLocked: boolean };

interface BonusChoresViewProps {
  profiles: Profile[];
  selectedProfiles: string[];
  /** When true, hide the view's own page title and action toolbar — card header owns them. */
  embedded?: boolean;
  /** Increment to programmatically open the Add Bonus Chore dialog. */
  triggerAdd?: number;
  /** Increment to programmatically open the Manage Bonus Chores drawer. */
  triggerManage?: number;
  /** When set, "add a bonus chore" opens the unified Create-a-task picker
   *  (bonus form) instead of this view's legacy inline form. */
  onRequestCreate?: () => void;
}

function lockedLabel(chore: BonusChore): string {
  const { bonusFrequencyType: ft, bonusFrequencyCount: fc, bonusFrequencyPeriod: fp, completionCount, isLocked } = chore;
  if (!ft || ft === "unlimited") return "";
  if (ft === "total") {
    return isLocked
      ? `Done! ${completionCount}/${fc} lifetime`
      : `${completionCount}/${fc} claimed ever`;
  }
  // per_period
  const periodLabel = fp === "day" ? "today" : fp === "week" ? "this week" : "this month";
  return isLocked
    ? `Claimed for ${fp === "day" ? "today" : fp === "week" ? "this week" : "this month"}`
    : `${completionCount}/${fc} ${periodLabel}`;
}

export function BonusChoresView({ profiles, selectedProfiles, embedded = false, triggerAdd = 0, triggerManage = 0, onRequestCreate }: BonusChoresViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { gateDialog: parentGateDialog } = useParentGate(profiles, selectedProfiles);
  const [completeChoreId, setCompleteChoreId] = useState<string | null>(null);
  // Which person the claim is being submitted for — drives the spinner on that
  // one button instead of greying out the whole grid.
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  // Add Bonus Chore always opens the unified Create-a-task picker now (it
  // gates its own save via the "createBonusChore" PIN feature) — the legacy
  // inline add/edit dialogs and Manage sheet this component used to own
  // directly are gone, along with the guard this used to need to open them.
  const openAddForm = () => onRequestCreate?.();

  // External trigger from card header — useTriggerEffect so a remount with a
  // stale nonzero counter (tab revisit, card reorder) doesn't reopen this.
  useTriggerEffect(triggerAdd, openAddForm);

  // No custom queryFn: fall back to the app's default (getQueryFn), which
  // resolves the URL through apiUrl() and attaches the native bearer token.
  // A raw fetch("/api/chores/bonus") used a RELATIVE path — on the Capacitor
  // iOS app that resolves against capacitor://localhost, not the backend, so
  // the list always came back empty even though creation (via apiRequest,
  // which does prefix the backend origin) succeeded. That's exactly why a
  // newly-created bonus chore never appeared on native.
  const { data: bonusChores = [] } = useQuery<BonusChore[]>({
    queryKey: ["/api/chores/bonus"],
  });

  const { data: completions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  const completeMutation = useMutation({
    mutationFn: async ({ choreId, profileId, points }: { choreId: string; profileId: string; points: number }) => {
      const res = await apiRequest("POST", "/api/chore-completions", { choreId, profileId, points });
      if (res.status === 409) {
        const body = await res.json();
        throw new Error(body.message ?? "Limit reached");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chores/bonus"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      // Bonus chores award real points — refresh the star pills and cash-out
      // availability (they read the backend totals in per_completion mode and
      // would otherwise sit stale until reload).
      queryClient.invalidateQueries({ queryKey: ["/api/points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
      const profile = profiles.find(p => p.id === vars.profileId);
      toast({
        title: vars.points > 0
          ? `+${vars.points} stars for ${profile?.name ?? "them"}! 🌟`
          : `Claimed by ${profile?.name ?? "them"}! 🌟`,
      });
      fireBonusChoreConfetti();
      setCompleteChoreId(null);
      setPendingProfileId(null);
    },
    onError: (err: any) => {
      setPendingProfileId(null);
      toast({
        title: err?.message ?? "Failed to record completion",
        variant: "destructive",
      });
    },
  });

  // Shown for at most 3 days, and never more than the 3 most recent — a claim
  // ages out of this list on its own after 3 days even if nobody else has
  // claimed the chore since, instead of only ever being pushed out by a 4th
  // completion.
  const RECENT_COMPLETION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  const recentCompletions = (choreId: string) => {
    const cutoff = Date.now() - RECENT_COMPLETION_MAX_AGE_MS;
    return completions
      .filter(c => c.choreId === choreId && c.completedAt && new Date(c.completedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
      .slice(0, 3);
  };

  const formatWhen = (date: Date | string) => {
    const d = new Date(date);
    // No "at": this sits in a narrow column beside the Claim button, and the
    // extra word was reliably enough to push the time onto its own line.
    if (isToday(d)) return `today, ${format(d, "h:mm a")}`;
    if (isYesterday(d)) return `yesterday, ${format(d, "h:mm a")}`;
    return format(d, "MMM d");
  };

  const activeProfiles = profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false);
  const displayProfiles = selectedProfiles.length > 0
    ? activeProfiles.filter(p => selectedProfiles.includes(p.id))
    : activeProfiles;

  // A bonus chore's profileIds now means "who it's an option for" (empty =
  // everyone, the original behavior). When viewing a single person, hide bonus
  // chores scoped to other people; the all-family view shows them all.
  const scopedBonusChores = bonusChores.filter(c => {
    const ids = (c.profileIds ?? []) as string[];
    if (ids.length === 0) return true;              // everyone
    if (selectedProfiles.length === 0) return true; // all-family view
    return ids.some(id => selectedProfiles.includes(id));
  });
  const sortedBonusChores = [...scopedBonusChores].sort((a, b) => {
    const diff = (a.points ?? 1) - (b.points ?? 1);
    return sortAsc ? diff : -diff;
  });

  const choreToComplete = bonusChores.find(c => c.id === completeChoreId);

  return (
    <div className="space-y-4">
      {/* Header — hidden when embedded; card header owns the buttons */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Bonus Chores
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">Pick one up any time for extra stars</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSortAsc(v => !v)} className="gap-1.5 text-xs" title={sortAsc ? "Showing lowest stars first" : "Showing highest stars first"}>
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortAsc ? "Low → High" : "High → Low"}
            </Button>
            <Button onClick={openAddForm} size="sm" className="gap-1.5" data-testid="add-bonus-chore-button">
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Bonus chore cards */}
      {sortedBonusChores.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
            <Sparkles className="w-8 h-8 opacity-40" />
            <p className="text-sm">
              {bonusChores.length === 0
                ? <>No bonus chores yet.<br />Add one for the family to earn extra stars!</>
                : <>No bonus chores for these people.<br />They may be set up for someone else.</>}
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={openAddForm}
              data-testid="add-first-bonus-chore-button-card"
            >
              <Plus className="w-4 h-4" />
              Add a bonus chore
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedBonusChores.map(chore => {
            const recent = recentCompletions(chore.id);
            const label = lockedLabel(chore);
            return (
              <Card key={chore.id} className={cn("overflow-hidden", chore.isLocked && "opacity-75")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Points badge */}
                    <div className={cn(
                      "flex-shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center border",
                      chore.isLocked
                        ? "bg-muted border-border"
                        : "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800"
                    )}>
                      {chore.isLocked
                        ? <Lock className="w-4 h-4 text-muted-foreground" />
                        : <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                      }
                      <span className={cn(
                        "text-sm font-bold leading-none mt-0.5",
                        chore.isLocked ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"
                      )}>
                        {chore.points ?? 1}
                      </span>
                    </div>

                    {/* Title + description + status */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground leading-tight">{chore.title}</p>
                      {chore.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{chore.description}</p>
                      )}
                      {label && (
                        <p className={cn(
                          "text-xs mt-1 font-medium",
                          chore.isLocked ? "text-destructive/70" : "text-muted-foreground"
                        )}>
                          {chore.isLocked && <Lock className="w-3 h-3 inline mr-1" />}
                          {label}
                        </p>
                      )}

                      {/* Recent completions */}
                      {recent.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {recent.map(c => {
                            const p = profiles.find(pr => pr.id === c.profileId);
                            return (
                              // One wrapping sentence, not three flex items.
                              // As separate items the name held its own line
                              // while "completed yesterday at 6:18 PM" was
                              // squeezed into the leftover width and broke
                              // across three lines, and `items-center` then
                              // centred the tick and the name against that
                              // block — reported on a device 2026-09-11.
                              // The text now flows and wraps like prose, with
                              // the tick pinned to its first line.
                              <div key={c.id} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Check className="w-3 h-3 text-green-500 flex-shrink-0 mt-[3px]" />
                                <p className="min-w-0 leading-snug">
                                  <span className="font-medium text-foreground">{p?.name ?? "Someone"}</span>
                                  {" "}completed{" "}
                                  {/* The WHEN moves as one unit. Left to wrap
                                      freely it broke mid-date — "completed Sep /
                                      10", "today, / 3:03 PM" — which reads as a
                                      layout fault rather than a line break
                                      (2026-09-12). Breaking before the whole
                                      phrase is the natural place. */}
                                  <span className="whitespace-nowrap">{formatWhen(c.completedAt!)}</span>
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => setCompleteChoreId(chore.id)}
                        disabled={chore.isLocked}
                        className={cn(
                          "gap-1.5 text-xs font-semibold rounded-full px-3",
                          chore.isLocked
                            ? "opacity-50 cursor-not-allowed"
                            : "bg-amber-400 hover:bg-amber-500 text-amber-900 border-0"
                        )}
                        data-testid={`complete-bonus-${chore.id}`}
                      >
                        <Star className="w-3.5 h-3.5 fill-current" />
                        Claim
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Profile picker — who completed it? */}
      <Dialog open={!!completeChoreId} onOpenChange={open => { if (!open) { setCompleteChoreId(null); setPendingProfileId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Who completed this?</DialogTitle>
          </DialogHeader>
          {choreToComplete && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                Select the family member who did <span className="font-semibold text-foreground">{choreToComplete.title}</span> (+{choreToComplete.points ?? 1} ⭐)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  // Respect who-can-claim-it: a scoped bonus chore can only be
                  // claimed FOR one of its people (empty scope = everyone).
                  const scope = (choreToComplete.profileIds ?? []) as string[];
                  const claimProfiles = scope.length > 0
                    ? activeProfiles.filter(p => scope.includes(p.id))
                    : displayProfiles;
                  return claimProfiles.map(profile => (
                  // aria-disabled + pointer-events-none, not `disabled`: the
                  // Button's disabled styling is opacity-40 AND saturate-0, so
                  // the moment the claim was submitted every avatar in this
                  // grid drained to grey — which read as "nothing happened"
                  // for the second or so before the confetti fired. The
                  // buttons stop responding either way; they just keep their
                  // colour, and the one that was pressed says so.
                  <Button
                    key={profile.id}
                    variant="outline"
                    className={`flex items-center gap-2 h-auto py-2.5 justify-start ${
                      completeMutation.isPending ? "pointer-events-none" : ""
                    } ${pendingProfileId === profile.id ? "border-primary ring-1 ring-primary" : ""}`}
                    aria-disabled={completeMutation.isPending}
                    onClick={() => {
                      setPendingProfileId(profile.id);
                      completeMutation.mutate({
                        choreId: choreToComplete.id,
                        profileId: profile.id,
                        points: choreToComplete.points ?? 1,
                      });
                    }}
                    data-testid={`pick-profile-${profile.id}`}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: profile.color }}
                    >
                      {profile.photoUrl
                        ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-7 h-7 rounded-full object-cover" />
                        : profile.initials}
                    </div>
                    <span className="text-sm font-medium truncate">{profile.name}</span>
                    {pendingProfileId === profile.id && (
                      <Loader2 className="w-4 h-4 ml-auto shrink-0 animate-spin text-primary" />
                    )}
                  </Button>
                  ));
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {parentGateDialog}
    </div>
  );
}
