import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Profile, WishlistItem } from "@workspace/shared-types";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@/components/ObjectUploader";
import { objectUrl } from "@/lib/apiBase";
import {
  CheckCircle2,
  XCircle,
  Archive,
  Clock,
  Star,
  Plus,
  ImageIcon,
  Link as LinkIcon,
  Send,
} from "lucide-react";

interface WishlistViewProps {
  profiles: Profile[];
  defaultSubmitterProfileId?: string | null;
}

const REWARD_ICONS = ["🎁", "🎮", "🍕", "🎬", "🍦", "⭐", "🎈", "🏆", "🎉", "💎", "🌟", "🎯"];

function statusBadgeVariant(status: WishlistItem["status"]): {
  className: string;
  label: string;
} {
  switch (status) {
    case "pending":
      return { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", label: "Pending" };
    case "approved":
      return { className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", label: "Approved" };
    case "declined":
      return { className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", label: "Declined" };
    case "archived":
      return { className: "bg-muted text-muted-foreground", label: "Archived" };
    default:
      return { className: "bg-muted text-muted-foreground", label: String(status) };
  }
}

export function WishlistView({ profiles, defaultSubmitterProfileId }: WishlistViewProps) {
  const { toast } = useToast();
  const regularProfiles = useMemo(() => profiles.filter(p => !p.isAllFamilyProfile), [profiles]);
  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const { data: items = [] } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist-items"],
  });

  const [tab, setTab] = useState<"submit" | "review" | "all">("review");

  // Submit form state
  const [form, setForm] = useState({
    title: "",
    description: "",
    link: "",
    photoUrl: "",
    suggestedPriceCoins: 50,
    submittedByProfileId: defaultSubmitterProfileId ?? regularProfiles[0]?.id ?? "",
  });

  const resetForm = () => setForm({
    title: "",
    description: "",
    link: "",
    photoUrl: "",
    suggestedPriceCoins: 50,
    submittedByProfileId: defaultSubmitterProfileId ?? regularProfiles[0]?.id ?? "",
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/wishlist-items", {
        title: form.title.trim(),
        description: form.description.trim() || null,
        link: form.link.trim() || null,
        photoUrl: form.photoUrl || null,
        suggestedPriceCoins: form.suggestedPriceCoins,
        submittedByProfileId: form.submittedByProfileId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      toast({ title: "Wishlist idea submitted!", description: "A parent will review it soon." });
      resetForm();
      setTab("all");
    },
    onError: () => {
      toast({ title: "Couldn't submit idea", variant: "destructive" });
    },
  });

  // ── Approve / Decline / Archive mutations ─────────────────────────────────
  const [approving, setApproving] = useState<WishlistItem | null>(null);
  const [declining, setDeclining] = useState<WishlistItem | null>(null);
  const [approveData, setApproveData] = useState({
    finalPriceCoins: 50,
    icon: "🎁",
    scopeProfileId: "",
    inventoryCap: "" as string,
  });
  const [declineNote, setDeclineNote] = useState("");

  const approveMutation = useMutation({
    mutationFn: async (vars: { id: string; body: Record<string, unknown> }) => {
      return await apiRequest("POST", `/api/wishlist-items/${vars.id}/approve`, vars.body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
      toast({ title: "Approved!", description: "It's now in the rewards gallery." });
      setApproving(null);
    },
    onError: () => {
      toast({ title: "Couldn't approve", variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (vars: { id: string; parentNote?: string }) => {
      return await apiRequest("POST", `/api/wishlist-items/${vars.id}/decline`, {
        parentNote: vars.parentNote,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      toast({ title: "Declined", description: "The submitter will see your note." });
      setDeclining(null);
      setDeclineNote("");
    },
    onError: (err: any) => {
      toast({ title: "Couldn't decline", description: err?.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/wishlist-items/${id}/archive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist-items"] });
      toast({ title: "Archived" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't archive", description: err?.message, variant: "destructive" });
    },
  });

  const pendingItems = items.filter(i => i.status === "pending");
  const reviewedItems = items.filter(i => i.status !== "pending");

  // ── Render an individual item card ─────────────────────────────────────────
  const renderItemCard = (item: WishlistItem, mode: "review" | "all") => {
    const submitter = item.submittedByProfileId ? profileById.get(item.submittedByProfileId) : null;
    const badge = statusBadgeVariant(item.status);
    return (
      <Card key={item.id} className="overflow-hidden" data-testid={`wishlist-item-${item.id}`}>
        <CardContent className="p-4">
          <div className="flex gap-4">
            {item.photoUrl ? (
              <img
                src={objectUrl(item.photoUrl)}
                alt={item.title}
                className="w-20 h-20 rounded-lg object-cover flex-shrink-0 border border-border"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <ImageIcon className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-semibold text-foreground truncate">{item.title}</h4>
                <Badge className={badge.className} variant="outline">{badge.label}</Badge>
              </div>
              {item.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{item.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {submitter && (
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-flex w-5 h-5 rounded-full items-center justify-center text-white text-[10px] font-bold"
                      style={{ backgroundColor: submitter.color }}
                    >
                      {submitter.photoUrl ? (
                        <img src={objectUrl(submitter.photoUrl)} alt={submitter.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        submitter.initials
                      )}
                    </span>
                    Suggested by {submitter.name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                  {item.status === "approved" && item.finalPriceCoins != null
                    ? `${item.finalPriceCoins} ⭐ (final)`
                    : `${item.suggestedPriceCoins} ⭐ (suggested)`}
                </span>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <LinkIcon className="w-3 h-3" />
                    Link
                  </a>
                )}
              </div>
              {item.parentNote && (
                <p className="mt-2 text-xs italic text-muted-foreground border-l-2 border-border pl-2">
                  Parent's note: {item.parentNote}
                </p>
              )}
            </div>
          </div>

          {mode === "review" && (
            <div className="flex flex-wrap gap-2 mt-4">
              <Button
                size="sm"
                onClick={() => {
                  setApproveData({
                    finalPriceCoins: item.suggestedPriceCoins,
                    icon: "🎁",
                    scopeProfileId: "",
                    inventoryCap: "",
                  });
                  setApproving(item);
                }}
                data-testid={`approve-${item.id}`}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDeclineNote("");
                  setDeclining(item);
                }}
                data-testid={`decline-${item.id}`}
              >
                <XCircle className="w-4 h-4 mr-1" /> Decline
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => archiveMutation.mutate(item.id)}
                disabled={archiveMutation.isPending}
                data-testid={`archive-${item.id}`}
              >
                <Archive className="w-4 h-4 mr-1" /> Archive
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4" data-testid="wishlist-view">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="review" data-testid="tab-review">
            <Clock className="w-4 h-4 mr-1" />
            Pending
            {pendingItems.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs">
                {pendingItems.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="submit" data-testid="tab-submit">
            <Plus className="w-4 h-4 mr-1" />
            Submit Idea
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">
            All ({reviewedItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="space-y-3 mt-4">
          {pendingItems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                No pending wishlist ideas. When kids submit ideas, they'll show up here.
              </CardContent>
            </Card>
          ) : (
            pendingItems.map(item => renderItemCard(item, "review"))
          )}
        </TabsContent>

        <TabsContent value="submit" className="space-y-4 mt-4">
          <div className="space-y-4">
            <div>
              <Label>Who's suggesting this?</Label>
              <select
                value={form.submittedByProfileId}
                onChange={(e) => setForm({ ...form, submittedByProfileId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="wishlist-submitter-select"
              >
                <option value="" disabled>Pick a family member</option>
                {regularProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>What's the reward idea?</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., New Lego set"
                maxLength={200}
                data-testid="wishlist-title-input"
              />
            </div>

            <div>
              <Label>Why do you want it? (optional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Tell your parents why this would be a great reward"
                rows={3}
                maxLength={2000}
                data-testid="wishlist-description-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Link (optional)</Label>
                <Input
                  value={form.link}
                  onChange={(e) => setForm({ ...form, link: e.target.value })}
                  placeholder="https://..."
                  type="url"
                  maxLength={2000}
                  data-testid="wishlist-link-input"
                />
              </div>
              <div>
                <Label>Suggested price (stars)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.suggestedPriceCoins}
                  onChange={(e) =>
                    setForm({ ...form, suggestedPriceCoins: Math.max(1, parseInt(e.target.value) || 1) })
                  }
                  data-testid="wishlist-price-input"
                />
              </div>
            </div>

            <div>
              <Label>Photo (optional)</Label>
              <div className="flex items-center gap-3 mt-1">
                {form.photoUrl ? (
                  <img
                    src={objectUrl(form.photoUrl)}
                    alt="Preview"
                    className="w-16 h-16 rounded-lg object-cover border border-border"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <ObjectUploader
                  buttonClassName=""
                  downscaleTo={1600}
                  onComplete={(result) => {
                    if (result.objectPath) setForm(f => ({ ...f, photoUrl: result.objectPath }));
                  }}
                >
                  {form.photoUrl ? "Change photo" : "Add photo"}
                </ObjectUploader>
                {form.photoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ ...form, photoUrl: "" })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!form.title.trim() || !form.submittedByProfileId || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              data-testid="wishlist-submit-button"
            >
              <Send className="w-4 h-4 mr-2" />
              {submitMutation.isPending ? "Submitting..." : "Submit for parent review"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="all" className="space-y-3 mt-4">
          {items.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                <div className="text-3xl mb-2">🎁</div>
                <p className="font-medium text-foreground mb-1">No reward suggestions yet</p>
                <p>When a kid suggests a reward from the Rewards section, it lands here for a grown-up to approve.</p>
              </CardContent>
            </Card>
          ) : (
            items.map(item => renderItemCard(item, "all"))
          )}
        </TabsContent>
      </Tabs>

      {/* ── Approve modal ───────────────────────────────────────────────── */}
      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve "{approving?.title}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Final price (stars)</Label>
              <Input
                type="number"
                min={1}
                value={approveData.finalPriceCoins}
                onChange={(e) =>
                  setApproveData({
                    ...approveData,
                    finalPriceCoins: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                data-testid="approve-price-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pre-filled with the kid's suggestion ({approving?.suggestedPriceCoins} ⭐).
              </p>
            </div>

            <div>
              <Label>Icon for the reward</Label>
              <div className="grid grid-cols-6 gap-2 mt-2">
                {REWARD_ICONS.map(icon => (
                  <Button
                    key={icon}
                    variant={approveData.icon === icon ? "default" : "outline"}
                    size="sm"
                    onClick={() => setApproveData({ ...approveData, icon })}
                    className="text-xl h-10"
                  >
                    {icon}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Who can earn this? (optional)</Label>
              <select
                value={approveData.scopeProfileId}
                onChange={(e) => setApproveData({ ...approveData, scopeProfileId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="wishlist-scope-select"
              >
                <option value="everyone">Everyone</option>
                {regularProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Inventory cap (optional)</Label>
              <Input
                type="number"
                min={1}
                placeholder="e.g., 1 = single redemption"
                value={approveData.inventoryCap}
                onChange={(e) => setApproveData({ ...approveData, inventoryCap: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!approving) return;
                const cap = approveData.inventoryCap ? parseInt(approveData.inventoryCap) : null;
                approveMutation.mutate({
                  id: approving.id,
                  body: {
                    finalPriceCoins: approveData.finalPriceCoins,
                    icon: approveData.icon,
                    scopeProfileId:
                      !approveData.scopeProfileId || approveData.scopeProfileId === "everyone"
                        ? null
                        : approveData.scopeProfileId,
                    inventoryCap: cap && cap > 0 ? cap : null,
                  },
                });
              }}
              disabled={approveMutation.isPending}
              data-testid="confirm-approve-button"
            >
              {approveMutation.isPending ? "Approving..." : "Approve & add to gallery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Decline modal ───────────────────────────────────────────────── */}
      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline "{declining?.title}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Note for the submitter (optional)</Label>
            <Textarea
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              placeholder="e.g., Maybe next month — let's earn more stars first."
              rows={3}
              maxLength={1000}
              data-testid="decline-note-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!declining) return;
                declineMutation.mutate({
                  id: declining.id,
                  parentNote: declineNote.trim() || undefined,
                });
              }}
              disabled={declineMutation.isPending}
              data-testid="confirm-decline-button"
            >
              {declineMutation.isPending ? "Declining..." : "Decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
