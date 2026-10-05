import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PlanDraft = {
  kind: string;
  title: string;
  detail: string;
  date: string | null;
  time: string | null;
  who: string[];
};

/**
 * One sentence, then a preview. Nothing is written until Add.
 */
export function AddAnythingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [line, setLine] = useState("");
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setText("");
      setLine("");
      setDraft(null);
    }
  }, [open]);

  useEffect(() => {
    const sentence = text.trim();
    setDraft(null);
    setLine("");
    if (!open || sentence.length < 2) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      setReading(true);
      apiRequest("POST", "/api/plan/draft", { text: sentence })
        .then((res) => res.json())
        .then((body: { draft?: PlanDraft; line?: string }) => {
          if (cancel) return;
          setDraft(body.draft ?? null);
          setLine(body.line ?? "");
        })
        .catch(() => {
          if (!cancel) {
            setDraft(null);
            setLine("");
          }
        })
        .finally(() => {
          if (!cancel) setReading(false);
        });
    }, 600);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [open, text]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/plan/draft/save", { draft });
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Added to your plan" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't add that", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add anything</DialogTitle>
          <DialogDescription>Type it the way you'd say it. Check the preview, then add it.</DialogDescription>
        </DialogHeader>
        <textarea
          data-testid="add-anything-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Picture day Friday, wear a red shirt"
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
        <div className="min-h-16 rounded-md border border-border px-3 py-2 text-sm" data-testid="add-anything-preview">
          {reading && <p className="text-muted-foreground">Reading…</p>}
          {!reading && line && <p className="break-words">{line}</p>}
          {!reading && !line && <p className="text-muted-foreground">The preview shows here before anything is saved.</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="w-full" disabled={!draft || reading || saving} onClick={() => void save()} data-testid="add-anything-save">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
