import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Profile, BehaviourRule, BehaviourIncident, BehaviourBoardSettings } from "@workspace/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  ScrollText, Pencil, Plus, Trash2, Timer, HandHeart, Ban, Check, X,
  AlertTriangle, Sparkles, ChevronRight, Hourglass,
} from "lucide-react";
import { objectUrl } from "@/lib/apiBase";
import { confirmDialog } from "@/lib/confirmDialog";

interface BoardData {
  settings: BehaviourBoardSettings | null;
  rules: BehaviourRule[];
  activeIncidents: BehaviourIncident[];
  recentIncidents: BehaviourIncident[];
}

const DEFAULT_MOTTO = "We respect everybody.";
const DEFAULT_SUBTITLE = "Calm leadership — a rule and a consequence for everyone, parents included.";

function profileById(profiles: Profile[], id: string): Profile | undefined {
  return profiles.find((p) => p.id === id);
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Active consequence card (the live two-step process) ──────────────────────
function ActiveIncidentCard({
  incident,
  profile,
  now,
  onResolve,
  onCancel,
  busy,
}: {
  incident: BehaviourIncident;
  profile: Profile | undefined;
  now: number;
  onResolve: (outcome: "positive" | "negative") => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const endsAt = new Date(incident.timerEndsAt).getTime();
  const remaining = endsAt - now;
  const expired = remaining <= 0;
  const totalMs = incident.timerMinutes * 60_000;
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  // "Skip to consequence" jumps straight to the consequence view without resolving.
  // The consequence then stays on screen until the follow-through button is pressed.
  const [skipped, setSkipped] = useState(false);
  const showConsequence = expired || skipped;

  return (
    <div className={`rounded-2xl border-2 p-4 shadow-sm ${expired ? "border-destructive/60 bg-destructive/5" : "border-amber-400/60 bg-amber-50 dark:bg-amber-950/20"}`}>
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: profile?.color || "#888" }}
        >
          {profile?.photoUrl ? (
            <img src={objectUrl(profile.photoUrl)} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (profile?.initials || "?")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{profile?.name || "Family member"}</p>
          <p className="text-xs text-muted-foreground truncate">Broke: {incident.ruleText}</p>
        </div>
        <button onClick={onCancel} disabled={busy} className="text-muted-foreground hover:text-foreground p-1" title="Cancel (started by mistake)">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Countdown */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex items-center gap-1.5 text-2xl font-black tabular-nums ${expired ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
          <Timer className="w-5 h-5" />
          {expired ? "Time's up" : fmtRemaining(remaining)}
        </div>
        <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
          <div
            className={`h-full transition-[width] duration-1000 ease-linear ${expired ? "bg-destructive" : "bg-amber-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {!showConsequence ? (
        <>
          <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 mb-3">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-0.5">
              <HandHeart className="w-3.5 h-3.5 text-emerald-600" /> Good deed to do
            </p>
            <p className="text-sm font-semibold text-foreground">{incident.positiveConsequence}</p>
          </div>
          <p className="text-[11px] text-muted-foreground italic mb-3">
            You're the timekeeper now — set it and walk away. No nagging, no reminders. Stay calm.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => onResolve("positive")}
              disabled={busy}
            >
              <Check className="w-4 h-4 mr-1" /> They did it
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSkipped(true)} disabled={busy}>
              Skip to consequence
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-lg bg-white/70 dark:bg-black/20 p-3 mb-3">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-0.5">
              <Ban className="w-3.5 h-3.5 text-destructive" /> Now apply the consequence
            </p>
            <p className="text-sm font-semibold text-foreground">{incident.negativeConsequence}</p>
          </div>
          <p className="text-[11px] text-muted-foreground italic mb-3">
            {expired
              ? "The good deed wasn't done in time."
              : "Skipping straight to the consequence."}{" "}
            Follow through calmly — mean what you say. Then move on and reconnect.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={() => onResolve("negative")}
            disabled={busy}
          >
            <Ban className="w-4 h-4 mr-1" /> Consequence applied — follow through
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Rule editor dialog ───────────────────────────────────────────────────────
function RuleDialog({
  open, onOpenChange, profiles, rules, editing, defaultTimer, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profiles: Profile[];
  rules: BehaviourRule[];
  editing: BehaviourRule | null;
  defaultTimer: number;
  onSaved: () => void;
}) {
  // Suggestions pulled from every consequence already used across every
  // rule (any kid, any card) — so setting up a new rule doesn't mean
  // retyping "no screen time" from scratch just because it's a different
  // child or a new rule, not the same card as last time.
  const dedupe = (values: (string | null | undefined)[]) => {
    const seen = new Map<string, string>();
    for (const v of values) {
      const trimmed = v?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
    return Array.from(seen.values());
  };
  const positiveSuggestions = dedupe(rules.map((r) => r.positiveConsequence));
  const negativeSuggestions = dedupe(rules.map((r) => r.negativeConsequence));
  const { toast } = useToast();
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [ruleText, setRuleText] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [timer, setTimer] = useState(defaultTimer);

  useEffect(() => {
    if (open) {
      const initial = editing
        ? (editing.profileIds && editing.profileIds.length > 0 ? editing.profileIds : [editing.profileId])
        : (profiles[0] ? [profiles[0].id] : []);
      setProfileIds(initial);
      setRuleText(editing?.ruleText || "");
      setPositive(editing?.positiveConsequence || "");
      setNegative(editing?.negativeConsequence || "");
      setTimer(editing?.timerMinutes ?? defaultTimer);
    }
  }, [open, editing, defaultTimer, profiles]);

  const toggleProfile = (id: string) =>
    setProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        profileIds,
        ruleText: ruleText.trim(),
        positiveConsequence: positive.trim(),
        negativeConsequence: negative.trim(),
        timerMinutes: timer,
      };
      if (editing) {
        return (await apiRequest("PATCH", `/api/behaviour-rules/${editing.id}`, body)).json();
      }
      return (await apiRequest("POST", "/api/behaviour-rules", body)).json();
    },
    onSuccess: () => { onSaved(); onOpenChange(false); toast({ title: editing ? "Rule updated" : "Rule added" }); },
    onError: (e: any) => toast({ title: "Couldn't save rule", description: e?.message, variant: "destructive" }),
  });

  const valid = profileIds.length > 0 && ruleText.trim() && positive.trim() && negative.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit rule" : "Add a rule"}</DialogTitle>
          <DialogDescription>
            Keep rules observable and specific (e.g. "put shoes away within 10 minutes") — not attitude-based like "no being disrespectful".
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Who does this apply to? <span className="font-normal">(tap to select one or more)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => {
                const selected = profileIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProfile(p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-all ${selected ? "text-white border-transparent" : "bg-background border-border hover:border-primary/50"}`}
                    style={selected ? { backgroundColor: p.color } : {}}
                  >
                    <span className="w-4 h-4 rounded-full text-[9px] text-white font-bold flex items-center justify-center" style={{ backgroundColor: p.color }}>{p.initials?.[0]}</span>
                    {p.name}
                    {selected && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Rule</label>
            <Input value={ruleText} onChange={(e) => setRuleText(e.target.value)} placeholder="e.g. Put shoes away within 10 min of arriving home" maxLength={200} />
          </div>
          <div>
            <label className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1">
              <HandHeart className="w-3.5 h-3.5" /> Good deed (happens first)
            </label>
            <Input value={positive} onChange={(e) => setPositive(e.target.value)} placeholder="e.g. Sweep the kitchen floor / give a foot rub" maxLength={200} list="positive-consequence-suggestions" />
            <datalist id="positive-consequence-suggestions">
              {positiveSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
              <Ban className="w-3.5 h-3.5" /> Consequence (if not done in time)
            </label>
            <Input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="e.g. 24-hour media blackout" maxLength={200} list="negative-consequence-suggestions" />
            <datalist id="negative-consequence-suggestions">
              {negativeSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Timer (minutes)</label>
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="number" min={1} max={120} value={timer} onChange={(e) => setTimer(Math.max(1, Math.min(120, parseInt(e.target.value) || 15)))} className="w-24" />
              <div className="flex gap-1 flex-wrap">
                {[5, 10, 15, 30].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={timer === mins ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setTimer(mins)}
                  >
                    {mins}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : editing ? "Save" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export function BehaviourBoardView({ profiles, selectedProfiles, onOpenHistory }: { profiles: Profile[]; selectedProfiles?: string[]; onOpenHistory?: () => void }) {
  const { toast } = useToast();
  const regular = useMemo(() => profiles.filter((p) => !p.isAllFamilyProfile), [profiles]);
  // Follow the globally selected profile(s): when a subset is selected, only show
  // the board for those people. When everyone (or no one) is selected, show all.
  const visibleProfiles = useMemo(() => {
    if (!selectedProfiles || selectedProfiles.length === 0) return regular;
    const sel = new Set(selectedProfiles);
    const filtered = regular.filter((p) => sel.has(p.id));
    return filtered.length > 0 ? filtered : regular;
  }, [regular, selectedProfiles]);
  const visibleIds = useMemo(() => new Set(visibleProfiles.map((p) => p.id)), [visibleProfiles]);

  const { data, isLoading } = useQuery<BoardData>({
    queryKey: ["/api/behaviour-board"],
    queryFn: async () => (await apiRequest("GET", "/api/behaviour-board")).json(),
    // Keep the active timers fresh even if left open.
    refetchInterval: 30_000,
  });

  // 1-second ticker for the live countdowns.
  const [now, setNow] = useState(Date.now());
  const hasActive = (data?.activeIncidents?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasActive]);

  const [editingMotto, setEditingMotto] = useState(false);
  const [mottoDraft, setMottoDraft] = useState("");
  const [editingSubtitle, setEditingSubtitle] = useState(false);
  const [subtitleDraft, setSubtitleDraft] = useState("");
  const [editingDefaultTimer, setEditingDefaultTimer] = useState(false);
  const [defaultTimerDraft, setDefaultTimerDraft] = useState(15);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<BehaviourRule | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/behaviour-board"] });
    // Family History synthesizes "behaviour_incident" entries from resolved
    // incidents — without this, resolving one wouldn't show up there until
    // its 30s staleTime happened to lapse.
    queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
  };

  const mottoMutation = useMutation({
    mutationFn: async (familyMotto: string) => (await apiRequest("PUT", "/api/behaviour-board/settings", { familyMotto })).json(),
    onSuccess: () => { invalidate(); setEditingMotto(false); toast({ title: "Motto updated" }); },
    onError: () => toast({ title: "Couldn't save motto", variant: "destructive" }),
  });

  const subtitleMutation = useMutation({
    mutationFn: async (boardSubtitle: string) => (await apiRequest("PUT", "/api/behaviour-board/settings", { boardSubtitle })).json(),
    onSuccess: () => { invalidate(); setEditingSubtitle(false); toast({ title: "Description updated" }); },
    onError: () => toast({ title: "Couldn't save description", variant: "destructive" }),
  });

  const defaultTimerMutation = useMutation({
    mutationFn: async (defaultTimerMinutes: number) => (await apiRequest("PUT", "/api/behaviour-board/settings", { defaultTimerMinutes })).json(),
    onSuccess: () => { invalidate(); setEditingDefaultTimer(false); toast({ title: "Default timer updated" }); },
    onError: () => toast({ title: "Couldn't save default timer", variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: async ({ ruleId, profileId }: { ruleId: string; profileId: string }) =>
      (await apiRequest("POST", "/api/behaviour-incidents", { ruleId, profileId })).json(),
    onSuccess: () => { invalidate(); setNow(Date.now()); },
    onError: (e: any) => toast({ title: "Couldn't start", description: e?.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, outcome }: { id: string; outcome: "positive" | "negative" }) =>
      (await apiRequest("POST", `/api/behaviour-incidents/${id}/resolve`, { outcome })).json(),
    onSuccess: (_d, { outcome }) => {
      invalidate();
      toast({
        title: outcome === "positive" ? "Good deed done! 🌟" : "Consequence applied",
        description: "Now move on and reconnect with them.",
      });
    },
    onError: (e: any) => { invalidate(); toast({ title: "Couldn't resolve", description: e?.message, variant: "destructive" }); },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/behaviour-incidents/${id}`),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast({ title: "Couldn't cancel the incident", description: err?.message, variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/behaviour-rules/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Rule removed" }); },
    onError: (err: any) => toast({ title: "Couldn't delete the rule", description: err?.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-12">Loading the board…</div>;
  }

  const settings = data?.settings;
  const motto = settings?.familyMotto || DEFAULT_MOTTO;
  const subtitle = settings?.boardSubtitle || DEFAULT_SUBTITLE;
  const defaultTimer = settings?.defaultTimerMinutes ?? 15;
  const rules = data?.rules ?? [];
  // Honour the selected-profile filter for incidents/history too.
  const activeIncidents = (data?.activeIncidents ?? []).filter((i) => visibleIds.has(i.profileId));
  const recentIncidents = (data?.recentIncidents ?? [])
    .filter((i) => i.status !== "positive_pending")
    .filter((i) => visibleIds.has(i.profileId));

  // The profile ids a rule applies to (falls back to [profileId] for legacy rules).
  const ruleProfileIds = (r: BehaviourRule) =>
    (r.profileIds && r.profileIds.length > 0) ? r.profileIds : [r.profileId];
  // Each rule is shown once. When a subset of people is selected, only show rules
  // that apply to at least one of them.
  const filteredRules = rules.filter((r) => ruleProfileIds(r).some((id) => visibleIds.has(id)));
  const activeByProfile = new Set(activeIncidents.map((i) => i.profileId));
  const visibleHasRules = filteredRules.length > 0;
  const isFiltered = !!selectedProfiles && visibleProfiles.length < regular.length;

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-6" data-testid="behaviour-board-view">
      {/* Header + Motto */}
      <div className="text-center rounded-2xl border border-border bg-gradient-to-b from-primary/5 to-transparent p-5">
        <div className="flex items-center justify-center gap-2 text-primary mb-1">
          <ScrollText className="w-5 h-5" />
          <h2 className="text-lg font-bold">Behavior Board</h2>
        </div>
        {editingSubtitle ? (
          <div className="flex items-center gap-2 max-w-md mx-auto mb-3">
            <Input value={subtitleDraft} onChange={(e) => setSubtitleDraft(e.target.value)} maxLength={200} className="text-center text-xs h-8" autoFocus />
            <Button size="sm" onClick={() => subtitleMutation.mutate(subtitleDraft.trim() || DEFAULT_SUBTITLE)} disabled={subtitleMutation.isPending}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingSubtitle(false)}>Cancel</Button>
            {settings?.boardSubtitle && (
              <Button size="sm" variant="outline" onClick={() => subtitleMutation.mutate(DEFAULT_SUBTITLE)} disabled={subtitleMutation.isPending} data-testid="reset-subtitle-default">
                Reset to default
              </Button>
            )}
          </div>
        ) : (
          <button
            className="group inline-flex items-center gap-1.5 mb-3"
            onClick={() => { setSubtitleDraft(subtitle); setEditingSubtitle(true); }}
            title="Edit description"
            data-testid="edit-board-subtitle"
          >
            <p className="text-xs text-muted-foreground">{subtitle}</p>
            <Pencil className="w-3 h-3 text-muted-foreground opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
        {editingMotto ? (
          <div className="flex items-center gap-2 max-w-md mx-auto">
            <Input value={mottoDraft} onChange={(e) => setMottoDraft(e.target.value)} maxLength={200} className="text-center" autoFocus />
            <Button size="sm" onClick={() => mottoMutation.mutate(mottoDraft.trim() || DEFAULT_MOTTO)} disabled={mottoMutation.isPending}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingMotto(false)}>Cancel</Button>
            {settings?.familyMotto && (
              <Button size="sm" variant="outline" onClick={() => mottoMutation.mutate(DEFAULT_MOTTO)} disabled={mottoMutation.isPending} data-testid="reset-motto-default">
                Reset to default
              </Button>
            )}
          </div>
        ) : (
          <button
            className="group inline-flex items-center gap-2"
            onClick={() => { setMottoDraft(motto); setEditingMotto(true); }}
            title="Edit family motto"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xl font-bold text-foreground italic">"{motto}"</span>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        {editingDefaultTimer ? (
          <div className="flex items-center gap-2 justify-center mt-3">
            <Input
              type="number"
              min={1}
              max={120}
              value={defaultTimerDraft}
              onChange={(e) => setDefaultTimerDraft(Math.max(1, Math.min(120, parseInt(e.target.value) || 15)))}
              className="w-20 text-center h-8"
              autoFocus
            />
            <div className="flex gap-1">
              {[5, 10, 15, 30].map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  variant={defaultTimerDraft === mins ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setDefaultTimerDraft(mins)}
                >
                  {mins}
                </Button>
              ))}
            </div>
            <Button size="sm" onClick={() => defaultTimerMutation.mutate(defaultTimerDraft)} disabled={defaultTimerMutation.isPending}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingDefaultTimer(false)}>Cancel</Button>
          </div>
        ) : (
          <button
            className="group inline-flex items-center gap-1.5 mt-3"
            onClick={() => { setDefaultTimerDraft(defaultTimer); setEditingDefaultTimer(true); }}
            title="Edit default timer for new rules"
            data-testid="edit-default-timer"
          >
            <p className="text-xs text-muted-foreground">Default timer for new rules: {defaultTimer} min</p>
            <Pencil className="w-3 h-3 text-muted-foreground opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>

      {/* Active consequences (live process) */}
      {activeIncidents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Hourglass className="w-4 h-4 text-amber-500" /> In progress
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {activeIncidents.map((inc) => (
              <ActiveIncidentCard
                key={inc.id}
                incident={inc}
                profile={profileById(profiles, inc.profileId)}
                now={now}
                busy={resolveMutation.isPending || cancelMutation.isPending}
                onResolve={(outcome) => resolveMutation.mutate({ id: inc.id, outcome })}
                onCancel={async () => { if (await confirmDialog({ title: "Cancel this incident?", description: "This clears it as if it never happened.", confirmLabel: "Cancel incident", cancelLabel: "Keep It" })) cancelMutation.mutate(inc.id); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* The board: per-person rules */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">The Board</h3>
          <Button size="sm" variant="outline" onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }} disabled={regular.length === 0}>
            <Plus className="w-4 h-4 mr-1" /> Add rule
          </Button>
        </div>

        {regular.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Add family members first, then give each one a rule.</p>
        ) : rules.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground mb-3">No rules yet. Everyone age 3+ gets a rule — including parents (e.g. "no yelling").</p>
            <Button size="sm" onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add the first rule
            </Button>
          </div>
        ) : !visibleHasRules ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground mb-3">
              {isFiltered
                ? "No rules for the selected person yet."
                : "No rules yet."}
            </p>
            <Button size="sm" onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add a rule
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {filteredRules.map((rule) => {
              // The people this rule applies to (in canonical order, existing profiles only).
              const assignees = ruleProfileIds(rule)
                .map((id) => profileById(regular, id))
                .filter((p): p is Profile => !!p);
              const single = assignees.length === 1 ? assignees[0] : null;
              return (
                <div key={rule.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                    {/* Faces of everyone this rule applies to */}
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      {assignees.map((p) => (
                        <div
                          key={p.id}
                          title={p.name}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-card"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.photoUrl ? <img src={objectUrl(p.photoUrl)} alt={p.name} className="w-full h-full rounded-full object-cover" /> : p.initials}
                        </div>
                      ))}
                    </div>
                    <span className="text-sm font-semibold text-foreground flex-1 truncate">
                      {single ? single.name : `${assignees.length} people`}
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-foreground min-w-0 break-words">{rule.ruleText}</p>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => { setEditingRule(rule); setRuleDialogOpen(true); }} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Edit rule" title="Edit rule"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={async () => { if (await confirmDialog({ title: `Delete the "${rule.ruleText}" rule?` })) deleteRuleMutation.mutate(rule.id); }} disabled={deleteRuleMutation.isPending} className="p-1 text-muted-foreground hover:text-destructive" aria-label="Delete rule" title="Delete rule"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2">
                        <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1 mb-0.5"><HandHeart className="w-3 h-3" /> Good deed first</p>
                        <p className="text-xs text-foreground">{rule.positiveConsequence}</p>
                      </div>
                      <div className="rounded-lg bg-destructive/5 p-2">
                        <p className="text-[10px] font-medium text-destructive flex items-center gap-1 mb-0.5"><Ban className="w-3 h-3" /> Then ({rule.timerMinutes ?? 15} min)</p>
                        <p className="text-xs text-foreground">{rule.negativeConsequence}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Rule broken — tap who:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {assignees.map((p) => {
                          const busy = activeByProfile.has(p.id);
                          return (
                            <button
                              key={p.id}
                              disabled={busy || startMutation.isPending}
                              onClick={() => startMutation.mutate({ ruleId: rule.id, profileId: p.id })}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border border-amber-300/50 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={busy ? `${p.name} — consequence in progress` : `${p.name} broke this rule`}
                            >
                              <span className="w-4 h-4 rounded-full text-[9px] text-white font-bold flex items-center justify-center" style={{ backgroundColor: p.color }}>{p.initials?.[0]}</span>
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                      {/* A disabled button's title tooltip never shows on touch —
                          this app is primarily used on iPad/phone, so the reason
                          needs to be visible text, not hover-only. */}
                      {assignees.some((p) => activeByProfile.has(p.id)) && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Dimmed names already have an active incident.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History — same data as the global Family Activity drawer's "Behavior"
          entries; rather than a second, separate history UI, this opens
          that same drawer pre-filtered to Behavior Board activity. */}
      {recentIncidents.length > 0 && onOpenHistory && (
        <button
          onClick={onOpenHistory}
          className="flex items-center gap-1 text-sm font-semibold text-foreground"
          data-testid="behaviour-view-history"
        >
          <ChevronRight className="w-4 h-4" />
          View Activity ({recentIncidents.length})
        </button>
      )}

      <RuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        profiles={regular}
        rules={rules}
        editing={editingRule}
        defaultTimer={defaultTimer}
        onSaved={invalidate}
      />
    </div>
  );
}
