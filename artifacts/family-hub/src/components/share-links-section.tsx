import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";

interface ShareToken {
  id: string;
  token: string;
  label: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastViewedAt: string | null;
}

function shareUrl(token: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/share/${token}`;
}

export function ShareLinksSection() {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<string>("30");

  const { data: tokens = [] } = useQuery<ShareToken[]>({
    queryKey: ["/api/share-tokens"],
    queryFn: async () => (await apiRequest("GET", "/api/share-tokens")).json(),
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: { label?: string; expiresInDays?: number } = {};
      if (label.trim()) body.label = label.trim();
      const n = parseInt(days, 10);
      if (Number.isFinite(n) && n > 0) body.expiresInDays = n;
      return (await apiRequest("POST", "/api/share-tokens", body)).json();
    },
    onSuccess: () => {
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/share-tokens"] });
      toast({ title: "Share link created" });
    },
    onError: () => toast({ title: "Couldn't create link", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/share-tokens/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/share-tokens"] });
      toast({ title: "Share link revoked" });
    },
    onError: (err: any) => toast({ title: "Couldn't revoke the link", description: err?.message, variant: "destructive" }),
  });

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  };

  const active = tokens.filter((t) => !t.revokedAt);

  // No header/description here — the parent (settings-modal.tsx's "Share
  // with Caretakers" toggle) already shows the icon, title, and explainer
  // BEFORE this section is ever expanded, so repeating them here would just
  // be the same text twice once opened.
  return (
    <div className="space-y-3" data-testid="share-links-section">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div className="sm:col-span-2">
          <Label htmlFor="share-label" className="text-xs">Label (optional)</Label>
          <Input
            id="share-label"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 80))}
            placeholder="e.g., Grandma & the babysitter"
            data-testid="share-link-label-input"
          />
        </div>
        <div>
          <Label htmlFor="share-days" className="text-xs">Expires (days)</Label>
          <Input
            id="share-days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            data-testid="share-link-days-input"
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        data-testid="create-share-link-btn"
      >
        {create.isPending ? "Creating…" : "Create share link"}
      </Button>

      {active.length > 0 && (
        <ul className="space-y-2 mt-2">
          {active.map((t) => (
            <li
              key={t.id}
              className="border border-border rounded-lg p-2 flex items-start gap-2"
              data-testid={`share-link-${t.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{t.label ?? "Untitled link"}</div>
                <div className="text-xs text-muted-foreground truncate">{shareUrl(t.token)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {t.expiresAt ? `Expires ${new Date(t.expiresAt).toLocaleDateString()}` : "No expiry"}
                  {t.lastViewedAt ? ` · Last viewed ${new Date(t.lastViewedAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => copyLink(t.token)}
                aria-label="Copy this share link"
                title="Copy this share link"
                data-testid={`copy-share-link-${t.id}`}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={async () => { if (await confirmDialog({ title: "Revoke this share link?", description: "Anyone using it will lose access.", confirmLabel: "Revoke" })) revoke.mutate(t.id); }}
                aria-label="Revoke this share link"
                title="Revoke this share link"
                data-testid={`revoke-share-link-${t.id}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
