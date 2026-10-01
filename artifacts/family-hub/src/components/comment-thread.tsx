import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, MessageCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import type { Profile } from "@workspace/shared-types";

interface Comment {
  id: string;
  authorProfileId: string | null;
  message: string;
  createdAt: string;
}

interface Props {
  entityType: "chore" | "event";
  entityId: string;
  profiles: Profile[];
  entityTitle?: string;
}

function rel(iso: string): string {
  const t = new Date(iso).getTime();
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CommentThread({ entityType, entityId, profiles, entityTitle }: Props) {
  const { toast } = useToast();
  const real = profiles.filter((p) => !p.isAllFamilyProfile);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const [message, setMessage] = useState("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);

  const toggleRecipient = (id: string) => {
    setRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const key = ["/api/comments", entityType, entityId] as const;
  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: key,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/comments/${entityType}/${entityId}`);
      return res.json();
    },
    enabled: !!entityId,
  });

  const create = useMutation({
    mutationFn: async () => {
      // Create the comment on the event
      const res = await apiRequest("POST", `/api/comments/${entityType}/${entityId}`, {
        message: message.trim(),
      });
      const comment = await res.json();

      // Always create an announcement note for the selected recipients
      const noteTitle = entityTitle ? `Note for "${entityTitle}"` : "Event Note";
      const noteRes = await apiRequest("POST", "/api/daily-content", {
        type: "note",
        title: noteTitle,
        content: message.trim(),
        reference: `${entityType}:${entityId}`,
        isActive: true,
        displayOrder: 0,
      });
      const note = await noteRes.json();

      await apiRequest("POST", `/api/daily-content/${note.id}/assignments`, {
        profileIds: recipientIds,
      });

      return comment;
    },
    onSuccess: () => {
      setMessage("");
      setRecipientIds([]);
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-content"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-content-assignments"] });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't post", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/comments/${id}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (err: any) => toast({ title: "Couldn't delete the note", description: err?.message, variant: "destructive" }),
  });

  const [open, setOpen] = useState(false);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  // Focusing the box opens the section, which inserts the recipient picker
  // and any past notes ABOVE it — so the field you just tapped gets pushed
  // down, out of the shrunken (keyboard-open) viewport. The dialog's own
  // focus-scroll already ran by then, so pull it back once the new content
  // has actually laid out.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() =>
      composeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <div className="border-t border-border pt-4 mt-3" data-testid={`comments-${entityType}-${entityId}`}>
      {/* Collapsed by default: this is a conversation attached to the event,
          not one of its fields, and left open it pushed Save well down the
          dialog. The count on the header means you can see there ARE notes
          without opening it.

          The compose field below stays visible even while collapsed, and
          focusing it opens the section — the header alone read as a piece of
          chrome nobody noticed, whereas an empty "Add a note…" box is
          recognisably somewhere to type. It's the SAME textarea in both
          states (only its siblings and its size change), so the character
          that opened the section is the one that lands in it. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
        data-testid={`comments-toggle-${entityType}`}
      >
        <MessageCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Notes {comments.length > 0 ? `(${comments.length})` : ""}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>

      <div className="space-y-4 pt-3">

      {/* Past notes. No "No notes yet." line — an empty list is self-evident,
          and the compose field below is the only thing worth showing then. */}
      {!open ? null : isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : comments.length === 0 ? null : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {comments.map((c) => {
            const author = c.authorProfileId ? profileMap.get(c.authorProfileId) : null;
            return (
              <li key={c.id} className="text-sm flex items-start gap-2 group" data-testid={`comment-${c.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{author?.name ?? "Family"}</span>
                    <span className="ml-2">{rel(c.createdAt)}</span>
                  </div>
                  <p className="text-foreground/90 break-words">{c.message}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => { if (await confirmDialog({ title: "Delete this note?" })) del.mutate(c.id); }} disabled={del.isPending}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                  aria-label="Delete note"
                  data-testid={`delete-comment-${c.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* New note form */}
      <div className="space-y-3">
        {/* Step 1: Who is this for? */}
        {open && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Who is this note for?</p>
          <div className="flex flex-wrap gap-1.5">
            {real.map((p) => {
              const selected = recipientIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleRecipient(p.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selected
                      ? "border-transparent text-white"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                  style={selected ? { backgroundColor: p.color } : {}}
                  data-testid={`recipient-${p.id}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Step 2: Write the note */}
        <Textarea
          ref={composeRef}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 500))}
          onFocus={() => setOpen(true)}
          placeholder={open ? "Write a note…" : "Add a note…"}
          rows={open ? 2 : 1}
          className="resize-none"
          style={{ scrollMarginTop: "5rem", scrollMarginBottom: "5rem" }}
          data-testid="comment-input"
        />

        {open && (
        <div className="flex justify-end">
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => create.mutate()}
            disabled={!message.trim() || recipientIds.length === 0 || create.isPending}
            data-testid="comment-post-btn"
          >
            {create.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
        )}
      </div>
      </div>
    </div>
  );
}
