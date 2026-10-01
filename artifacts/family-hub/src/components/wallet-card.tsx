import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Wallet, PiggyBank, Coins, Hourglass, Plus, Trash2,
  ArrowUpRight, ArrowDownLeft, BadgeDollarSign, Check, X, Trophy, History, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import type { Profile } from "@workspace/shared-types";

interface WalletTransaction {
  id: string;
  profileId: string;
  type: string;
  status: string;
  deltaCents: number;
  deltaPoints: number;
  requestedPoints: number;
  requestedCents: number;
  goalId: string | null;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
}
interface Payout {
  id: string;
  profileId: string;
  points: number;
  amountCents: number;
  note: string | null;
  createdAt: string;
}
interface SavingsGoal {
  id: string;
  profileId: string;
  name: string;
  targetCents: number;
  savedCents: number;
  photoUrl: string | null;
  completedAt: string | null;
}
interface WalletState {
  balance: { availableCents: number; savingsCents: number; pendingCents: number; pendingPoints: number };
  availablePoints: number;
  centsPerPoint: number;
  currencySymbol: string;
  minCashoutCents: number;
  transactions: WalletTransaction[];
  payouts: Payout[];
  goals: SavingsGoal[];
}

function fmt(cents: number, sym = "$"): string {
  return `${sym}${(cents / 100).toFixed(2)}`;
}

const TYPE_LABEL: Record<string, string> = {
  cashout_requested: "Cash-out requested",
  cashout_approved: "Cash-out approved",
  cashout_declined: "Cash-out declined",
  paid: "Paid out",
  savings_deposit: "Saved",
  savings_withdraw: "Withdrew from savings",
  goal_completed: "Goal complete",
};

interface Props {
  profiles: Profile[];
}

export function WalletCard({ profiles }: Props) {
  const { toast } = useToast();
  const real = profiles.filter((p) => !p.isAllFamilyProfile);
  const [profileId, setProfileId] = useState<string>(real[0]?.id ?? "");
  const [paidAmount, setPaidAmount] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState("");
  const [minCashoutInput, setMinCashoutInput] = useState("");
  const [adjPoints, setAdjPoints] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [moveModalGoalId, setMoveModalGoalId] = useState<string | null>(null);
  const [moveDirection, setMoveDirection] = useState<"deposit" | "withdraw">("deposit");
  const [moveAmount, setMoveAmount] = useState("");

  const walletKey = ["/api/wallet", profileId] as const;
  const pendingKey = ["/api/wallet/pending"] as const;

  const { data, isLoading } = useQuery<WalletState>({
    queryKey: walletKey,
    queryFn: async () => (await apiRequest("GET", `/api/wallet/${profileId}`)).json(),
    enabled: !!profileId,
  });

  const { data: pendingRequests = [] } = useQuery<WalletTransaction[]>({
    queryKey: pendingKey,
    queryFn: async () => (await apiRequest("GET", "/api/wallet/pending")).json(),
  });

  const sym = data?.currencySymbol ?? "$";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: walletKey });
    queryClient.invalidateQueries({ queryKey: pendingKey });
    queryClient.invalidateQueries({ queryKey: ["/api/allowance", profileId] });
  }

  const cashout = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/wallet/${profileId}/cashout`, {})).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Cash-out complete!", description: "Stars converted to money in your wallet." });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't cash out", variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/wallet/requests/${id}/approve`, {})).json(),
    onSuccess: () => { invalidate(); toast({ title: "Approved" }); },
    onError: () => toast({ title: "Couldn't approve", variant: "destructive" }),
  });

  const decline = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/wallet/requests/${id}/decline`, {})).json(),
    onSuccess: () => { invalidate(); toast({ title: "Declined" }); },
    onError: () => toast({ title: "Couldn't decline", variant: "destructive" }),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(paidAmount || "0") * 100);
      return (await apiRequest("POST", `/api/wallet/${profileId}/mark-paid`, { amountCents: cents })).json();
    },
    onSuccess: () => { setPaidAmount(""); invalidate(); toast({ title: "Marked as paid" }); },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't mark paid", variant: "destructive" }),
  });

  const saveRate = useMutation({
    mutationFn: async () => {
      const dollars = parseFloat(rateInput || "0");
      const centsPerPoint = Math.max(0, Math.round(dollars * 100));
      return (await apiRequest("PUT", `/api/allowance/${profileId}`, { centsPerPoint })).json();
    },
    onSuccess: () => {
      setRateInput("");
      invalidate();
      toast({ title: "Rate saved" });
    },
    onError: () => toast({ title: "Couldn't save rate", variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {};
      if (currencyInput.trim()) body.currencySymbol = currencyInput.trim();
      if (minCashoutInput) body.minCashoutCents = Math.round(parseFloat(minCashoutInput) * 100);
      if (Object.keys(body).length === 0) return null;
      return (await apiRequest("PUT", `/api/wallet-settings`, body)).json();
    },
    onSuccess: () => {
      setCurrencyInput("");
      setMinCashoutInput("");
      invalidate();
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Couldn't save settings", variant: "destructive" }),
  });

  const createGoal = useMutation({
    mutationFn: async () => {
      const targetCents = Math.round(parseFloat(goalTarget || "0") * 100);
      return (await apiRequest("POST", `/api/savings-goals`, {
        profileId,
        name: goalName.trim(),
        targetCents,
      })).json();
    },
    onSuccess: () => {
      setShowGoalModal(false);
      setGoalName("");
      setGoalTarget("");
      invalidate();
      toast({ title: "Savings goal added" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't save", variant: "destructive" }),
  });

  const deleteGoal = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/savings-goals/${id}`)),
    onSuccess: () => { invalidate(); toast({ title: "Goal removed" }); },
    onError: () => toast({ title: "Couldn't remove goal", variant: "destructive" }),
  });

  const moveSavings = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(moveAmount || "0") * 100);
      const path = moveDirection === "deposit" ? "deposit" : "withdraw";
      return (await apiRequest("POST", `/api/wallet/${profileId}/savings/${path}`, {
        amountCents: cents,
        goalId: moveModalGoalId,
      })).json();
    },
    onSuccess: () => {
      setMoveModalGoalId(null);
      setMoveAmount("");
      invalidate();
      toast({ title: moveDirection === "deposit" ? "Saved" : "Withdrew" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't move money", variant: "destructive" }),
  });

  const adjustPoints = useMutation({
    mutationFn: async () => {
      const delta = parseInt(adjPoints || "0", 10);
      return (await apiRequest("POST", `/api/points/${profileId}/adjust`, {
        delta,
        reason: adjReason || undefined,
      })).json();
    },
    onSuccess: () => {
      setAdjPoints("");
      setAdjReason("");
      invalidate();
      toast({ title: "Stars adjusted" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Couldn't adjust stars", variant: "destructive" }),
  });

  if (real.length === 0) return null;

  const familyPending = pendingRequests;

  const activity = data
    ? [
        ...data.transactions.map((t) => ({ id: t.id, type: "tx", data: t, date: new Date(t.createdAt) })),
        ...data.payouts.map((p) => ({ id: p.id, type: "payout", data: p, date: new Date(p.createdAt) })),
      ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 20)
    : [];

  return (
    <div className="space-y-4">
      {familyPending.length > 0 && (
        <Card data-testid="wallet-approvals-card" className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BadgeDollarSign className="h-4 w-4 text-primary" />
              Pending requests
              <Badge variant="secondary" className="ml-auto" data-testid="pending-count-badge">
                {familyPending.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {familyPending.map((tx) => {
              const who = real.find((p) => p.id === tx.profileId);
              return (
                <div key={tx.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`pending-request-${tx.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {who?.name ?? "Someone"} · {fmt(tx.requestedCents, sym)} ({tx.requestedPoints} ⭐)
                    </div>
                    {tx.note && <div className="text-xs text-muted-foreground truncate">{tx.note}</div>}
                    <div className="text-[10px] text-muted-foreground">{new Date(tx.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="default" onClick={() => approve.mutate(tx.id)} disabled={approve.isPending} data-testid={`approve-${tx.id}`}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decline.mutate(tx.id)} disabled={decline.isPending} data-testid={`decline-${tx.id}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card data-testid="wallet-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Wallet
            <Button size="sm" variant="ghost" className="ml-auto h-7 w-7 p-0" onClick={() => setShowSettings(true)} data-testid="wallet-settings-btn">
              <Settings className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Profile</Label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="wallet-profile-select">
              {real.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {isLoading || !data ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 [&>div]:min-w-0">
                <div className="bg-muted rounded-lg p-2" data-testid="balance-available">
                  <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <Coins className="h-3 w-3" /> Available
                  </div>
                  <div className="text-lg font-bold truncate">{fmt(data.balance.availableCents, sym)}</div>
                </div>
                <div className="bg-muted rounded-lg p-2" data-testid="balance-pending">
                  <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <Hourglass className="h-3 w-3" /> Stars
                  </div>
                  <div className="text-lg font-bold truncate">{data.balance.pendingPoints}</div>
                  <div className="text-[10px] text-muted-foreground">{fmt(data.balance.pendingCents, sym)}</div>
                </div>
                <div className="bg-muted rounded-lg p-2" data-testid="balance-savings">
                  <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <PiggyBank className="h-3 w-3" /> Saved
                  </div>
                  <div className="text-lg font-bold truncate">{fmt(data.balance.savingsCents, sym)}</div>
                </div>
              </div>

              {data.availablePoints > 0 && data.centsPerPoint > 0 && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-[11px] text-muted-foreground">
                    {data.availablePoints} stars waiting at {fmt(data.centsPerPoint, sym)}/star
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => cashout.mutate()}
                    disabled={cashout.isPending}
                    data-testid="cashout-btn"
                  >
                    {cashout.isPending
                      ? "Cashing out…"
                      : `Cash out ${data.availablePoints} ⭐ → ${fmt(data.availablePoints * data.centsPerPoint, sym)}`}
                  </Button>
                </div>
              )}

              {data.balance.availableCents > 0 && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs font-medium">Mark as paid (parent)</div>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder={`${(data.balance.availableCents / 100).toFixed(2)}`}
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      data-testid="paid-amount-input"
                    />
                    <Button variant="outline" onClick={() => markPaid.mutate()} disabled={!paidAmount || markPaid.isPending} data-testid="mark-paid-btn">
                      Mark paid
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium flex items-center gap-1">
                    <Trophy className="h-3 w-3" /> Savings goals
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setShowGoalModal(true)} data-testid="add-goal-btn">
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                {data.goals.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No goals yet — add one to start saving toward something.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.goals.map((g) => {
                      const pct = Math.min(100, Math.round((g.savedCents / g.targetCents) * 100));
                      return (
                        <li key={g.id} className="rounded-lg border border-border p-2 space-y-1" data-testid={`goal-${g.id}`}>
                          <div className="flex items-center justify-between text-xs">
                            <div className="font-medium">
                              {g.name}
                              {g.completedAt && <Badge variant="secondary" className="ml-2 text-[9px]">Complete</Badge>}
                            </div>
                            <div className="text-muted-foreground">
                              {fmt(g.savedCents, sym)} / {fmt(g.targetCents, sym)}
                            </div>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { setMoveModalGoalId(g.id); setMoveDirection("deposit"); }} data-testid={`deposit-${g.id}`}>
                              <ArrowUpRight className="h-3 w-3 mr-1" /> Save
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { setMoveModalGoalId(g.id); setMoveDirection("withdraw"); }} data-testid={`withdraw-${g.id}`}>
                              <ArrowDownLeft className="h-3 w-3 mr-1" /> Take
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={async () => { if (await confirmDialog({ title: `Delete the "${g.name}" savings goal?`, description: "Progress toward it is lost. This can't be undone." })) deleteGoal.mutate(g.id); }} disabled={deleteGoal.isPending} aria-label="Delete savings goal" data-testid={`delete-goal-${g.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {activity.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                    <History className="h-3 w-3" /> Recent activity
                  </div>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {activity.map((item) => {
                      if (item.type === "tx") {
                        const t = item.data as WalletTransaction;
                        const sign = t.deltaCents > 0 ? "+" : t.deltaCents < 0 ? "−" : "";
                        return (
                          <li key={t.id} className="text-[11px] flex justify-between gap-2" data-testid={`tx-${t.id}`}>
                            <span className="text-muted-foreground truncate">
                              {new Date(t.createdAt).toLocaleDateString()} · {TYPE_LABEL[t.type] ?? t.type}
                              {t.note && <> · <span className="italic">{t.note}</span></>}
                            </span>
                            <span className="font-medium shrink-0">
                              {t.deltaCents !== 0 ? `${sign}${fmt(Math.abs(t.deltaCents), sym)}` : ""}
                              {t.status === "pending" && <Badge variant="secondary" className="ml-1 text-[9px]">pending</Badge>}
                              {t.status === "declined" && <Badge variant="outline" className="ml-1 text-[9px]">declined</Badge>}
                            </span>
                          </li>
                        );
                      }
                      const p = item.data as Payout;
                      return (
                        <li key={p.id} className="text-[11px] flex justify-between gap-2" data-testid={`payout-${p.id}`}>
                          <span className="text-muted-foreground truncate">
                            {new Date(p.createdAt).toLocaleDateString()} · Stars cashed out
                            {p.note && <> · <span className="italic">{p.note}</span></>}
                          </span>
                          <span className="font-medium shrink-0">
                            {fmt(p.amountCents, sym)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent data-testid="wallet-settings-dialog">
          <DialogHeader>
            <DialogTitle>Wallet settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Rate per star ({sym})</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={data ? fmt(data.centsPerPoint, sym) : "0.10"}
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  data-testid="settings-rate-input"
                />
                <Button size="sm" variant="outline" onClick={() => saveRate.mutate()} disabled={!rateInput || saveRate.isPending}>
                  Save
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Currency symbol</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={data?.currencySymbol ?? "$"}
                  value={currencyInput}
                  onChange={(e) => setCurrencyInput(e.target.value)}
                  data-testid="settings-currency-input"
                />
                <Button size="sm" variant="outline" onClick={() => saveSettings.mutate()} disabled={!currencyInput.trim() || saveSettings.isPending}>
                  Save
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Minimum cash-out ({sym})</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={data ? fmt(data.minCashoutCents, sym) : "0.00"}
                  value={minCashoutInput}
                  onChange={(e) => setMinCashoutInput(e.target.value)}
                  data-testid="settings-min-input"
                />
                <Button size="sm" variant="outline" onClick={() => saveSettings.mutate()} disabled={!minCashoutInput || saveSettings.isPending}>
                  Save
                </Button>
              </div>
            </div>

            <div className="border-t pt-3 mt-3">
              <Label className="text-xs font-semibold">Adjust stars</Label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Add or remove stars for this profile. Positive = add, negative = remove.
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="+/- stars"
                  value={adjPoints}
                  onChange={(e) => setAdjPoints(e.target.value)}
                  data-testid="adjust-points-input"
                />
                <Input
                  placeholder="Reason (optional)"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  maxLength={140}
                  data-testid="adjust-reason-input"
                />
                <Button
                  variant="outline"
                  onClick={() => adjustPoints.mutate()}
                  disabled={!adjPoints || adjustPoints.isPending}
                  data-testid="adjust-points-btn"
                >
                  {adjustPoints.isPending ? "Saving..." : "Adjust"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goal Modal */}
      <Dialog open={showGoalModal} onOpenChange={setShowGoalModal}>
        <DialogContent data-testid="goal-modal">
          <DialogHeader>
            <DialogTitle>New savings goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="goal-name" className="text-xs">Name</Label>
              <Input id="goal-name" value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="e.g. New skateboard" data-testid="goal-name-input" />
            </div>
            <div>
              <Label htmlFor="goal-target" className="text-xs">Target ({sym})</Label>
              <Input id="goal-target" type="number" step="0.01" min="0.01" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} data-testid="goal-target-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoalModal(false)}>Cancel</Button>
            <Button onClick={() => createGoal.mutate()} disabled={!goalName.trim() || !goalTarget || createGoal.isPending} data-testid="goal-save-btn">
              Add goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Savings Modal */}
      <Dialog open={moveModalGoalId !== null} onOpenChange={(o) => { if (!o) { setMoveModalGoalId(null); setMoveAmount(""); } }}>
        <DialogContent data-testid="move-modal">
          <DialogHeader>
            <DialogTitle>{moveDirection === "deposit" ? "Move to savings" : "Take from savings"}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="move-amount" className="text-xs">Amount ({sym})</Label>
            <Input id="move-amount" type="number" step="0.01" min="0.01" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} data-testid="move-amount-input" />
            <p className="text-[11px] text-muted-foreground mt-1">
              {moveDirection === "deposit"
                ? `Available: ${data ? fmt(data.balance.availableCents, sym) : "—"}`
                : `Saved: ${data ? fmt(data.balance.savingsCents, sym) : "—"}`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMoveModalGoalId(null); setMoveAmount(""); }}>Cancel</Button>
            <Button onClick={() => moveSavings.mutate()} disabled={!moveAmount || moveSavings.isPending} data-testid="move-confirm-btn">
              {moveDirection === "deposit" ? "Save it" : "Take it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
