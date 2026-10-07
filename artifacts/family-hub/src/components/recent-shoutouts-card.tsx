import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Megaphone, EyeOff, StickyNote } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, LIVE_REFRESH_MS } from "@/lib/queryClient";
import type { Profile, CustomProfileGroup } from "@workspace/shared-types";

interface Shoutout {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  emoji: string;
  message: string;
  createdAt: string;
  seenAt?: string | null;
}

interface DailyContentItem {
  id: string;
  type: string;
  title: string;
  content: string;
  reference: string | null; // stores fromProfileId
  isActive: boolean | null;
  createdAt: string | null;
}

interface DailyContentAssignment {
  id: string;
  contentId: string;
  profileId: string;
}

interface Props {
  profiles: Profile[];
  /** Increment to open the Note dialog (driven by Home's main + button) */
  triggerNote?: number;
  /** Increment to open the Praise dialog (driven by Home's main + button) */
  triggerShoutout?: number;
  /** When true, renders only the dialogs with no visible card UI */
  dialogsOnly?: boolean;
}

const EMOJI_CHOICES = ["👏", "🎉", "⭐", "💪", "❤️", "🙌"];
const SHOUTOUT_MAX_LEN = 140;
const NOTE_MAX_LEN = 400;
const MAX_STORED = 200;

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadDismissedShoutouts(): Set<string> {
  try {
    const raw = localStorage.getItem("dismissedShoutoutIds");
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch { return new Set<string>(); }
}

function saveDismissedShoutouts(ids: Set<string>) {
  try {
    let arr = [...ids];
    if (arr.length > MAX_STORED) arr = arr.slice(arr.length - MAX_STORED);
    localStorage.setItem("dismissedShoutoutIds", JSON.stringify(arr));
  } catch { /* quota exceeded */ }
}

function loadDismissedNotes(): Set<string> {
  try {
    const raw = localStorage.getItem("dismissedNoteIds");
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch { return new Set<string>(); }
}

function saveDismissedNotes(ids: Set<string>) {
  try {
    let arr = [...ids];
    if (arr.length > MAX_STORED) arr = arr.slice(arr.length - MAX_STORED);
    localStorage.setItem("dismissedNoteIds", JSON.stringify(arr));
  } catch { /* quota exceeded */ }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Recipient resolution ─────────────────────────────────────────────────────
// "to" value encoding:
//   "all"         → all real profile IDs
//   "group:{id}"  → all profileIds in that group
//   anything else → treat as a single profile ID

function resolveToProfileIds(
  toValue: string,
  realProfiles: Profile[],
  groups: CustomProfileGroup[],
): string[] {
  if (toValue === "all") return realProfiles.map((p) => p.id);
  if (toValue.startsWith("group:")) {
    const gid = toValue.slice(6);
    const g = groups.find((g) => g.id === gid);
    return g ? g.profileIds : [];
  }
  return toValue ? [toValue] : [];
}

// Notes get their own resolver, distinct from shoutouts' resolveToProfileIds
// above. Shoutouts already fan out to one row per recipient that each person
// dismisses independently, so "all" there is fine as "every real profile."
// Notes previously reused that same expansion for "All Family," which meant
// a note "for everyone" was really N separate per-person assignment rows —
// completing it (buggily) only marked ONE of those rows done and hid the
// note for everyone regardless. Now:
//   "all"         → the single pseudo All-Family profile (announcements-banner.tsx
//                   renders this as one shared row/checkbox for the whole family)
//   "all-members" → every real profile individually (what "all" used to do) —
//                   each person gets their own copy to check off separately
function resolveNoteRecipientIds(
  toValue: string,
  realProfiles: Profile[],
  allFamilyProfile: Profile | undefined,
  groups: CustomProfileGroup[],
): string[] {
  if (toValue === "all") {
    return allFamilyProfile ? [allFamilyProfile.id] : realProfiles.map((p) => p.id);
  }
  if (toValue === "all-members") return realProfiles.map((p) => p.id);
  if (toValue.startsWith("group:")) {
    const gid = toValue.slice(6);
    const g = groups.find((g) => g.id === gid);
    return g ? g.profileIds : [];
  }
  return toValue ? [toValue] : [];
}

function resolveToLabel(
  toValue: string,
  profileMap: Map<string, Profile>,
  groups: CustomProfileGroup[],
): string {
  if (toValue === "all") return "All Family";
  if (toValue.startsWith("group:")) {
    const gid = toValue.slice(6);
    return groups.find((g) => g.id === gid)?.name ?? "Group";
  }
  return profileMap.get(toValue)?.name ?? "someone";
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecentShoutoutsCard({ profiles, triggerNote = 0, triggerShoutout = 0, dialogsOnly = false }: Props) {
  const { toast } = useToast();

  const realProfiles = useMemo(
    () => profiles.filter((p) => !p.isAllFamilyProfile),
    [profiles],
  );
  const allFamilyProfile = useMemo(
    () => profiles.find((p) => p.isAllFamilyProfile),
    [profiles],
  );
  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  // ── Dialog state ─────────────────────────────────────────────────────────────
  const [shoutoutOpen, setShoutoutOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // ── Shoutout form ─────────────────────────────────────────────────────────────
  const [fromId, setFromId] = useState<string>("");
  const [toValue, setToValue] = useState<string>("");     // profile id | "all" | "group:{id}"
  const [emoji, setEmoji] = useState<string>("👏");
  const [shoutoutMsg, setShoutoutMsg] = useState<string>("");
  const shoutoutMsgRef = useRef<HTMLTextAreaElement>(null);

  // A fixed-rows textarea becomes its OWN scrollable element once typed text
  // wraps past those rows (up to 140 chars easily does on a narrow field) —
  // a second scroll container competing with the dialog's own, which defeats
  // iOS's touch-scroll-lock ancestor walk and reads as "the dialog goes off
  // the top of the screen and won't scroll" once the keyboard is up. Same
  // fix already used for event-modal.tsx's Description field: auto-grow the
  // textarea to fit its content so there's only ever the one intended
  // scroll container (the dialog itself).
  useEffect(() => {
    const el = shoutoutMsgRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [shoutoutMsg, shoutoutOpen]);

  // ── Note form ─────────────────────────────────────────────────────────────────
  const [noteFromId, setNoteFromId] = useState<string>("");  // author (stored in `reference`)
  const [noteToValue, setNoteToValue] = useState<string>("all"); // recipient(s)
  const [noteContent, setNoteContent] = useState<string>("");

  // ── Dismissed IDs ─────────────────────────────────────────────────────────────
  const [dismissedShoutoutIds, setDismissedShoutoutIds] = useState<Set<string>>(loadDismissedShoutouts);
  const [dismissedNoteIds, setDismissedNoteIds] = useState<Set<string>>(loadDismissedNotes);

  const dismissShoutout = (id: string) => {
    const next = new Set(dismissedShoutoutIds);
    next.add(id);
    setDismissedShoutoutIds(next);
    saveDismissedShoutouts(next);
  };
  const dismissNote = (id: string) => {
    const next = new Set(dismissedNoteIds);
    next.add(id);
    setDismissedNoteIds(next);
    saveDismissedNotes(next);
  };

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: shoutouts = [], isLoading: shoutoutsLoading } = useQuery<Shoutout[]>({
    queryKey: ["/api/shoutouts", { limit: 10 }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/shoutouts?limit=10");
      return res.json();
    },
    refetchInterval: LIVE_REFRESH_MS,
  });

  const { data: allDailyContent = [], isLoading: contentLoading } = useQuery<DailyContentItem[]>({
    queryKey: ["/api/daily-content"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/daily-content");
      return res.json();
    },
    refetchInterval: LIVE_REFRESH_MS,
  });

  const { data: assignments = [] } = useQuery<DailyContentAssignment[]>({
    queryKey: ["/api/daily-content-assignments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/daily-content-assignments");
      return res.json();
    },
  });

  const { data: groups = [] } = useQuery<CustomProfileGroup[]>({
    queryKey: ["/api/custom-profile-groups"],
  });

  // ── Derived maps ──────────────────────────────────────────────────────────────
  // recipients per note: contentId → profileId[]
  const recipientsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const list = map.get(a.contentId) ?? [];
      list.push(a.profileId);
      map.set(a.contentId, list);
    }
    return map;
  }, [assignments]);

  // ── Combined + sorted feed ────────────────────────────────────────────────────
  type NoteItem  = { kind: "note";     id: string; sortKey: number; note: DailyContentItem };
  type ShoutItem = { kind: "shoutout"; id: string; sortKey: number; shoutout: Shoutout };
  type FeedItem  = NoteItem | ShoutItem;

  const feedItems = useMemo((): FeedItem[] => {
    const noteItems: FeedItem[] = allDailyContent
      .filter(n => n.type === "note" && n.isActive !== false && !dismissedNoteIds.has(n.id))
      .map(note => ({
        kind: "note" as const,
        id: note.id,
        sortKey: note.createdAt ? new Date(note.createdAt).getTime() : 0,
        note,
      }));

    const shoutItems: FeedItem[] = shoutouts
      .filter(s => !dismissedShoutoutIds.has(s.id))
      .map(s => ({
        kind: "shoutout" as const,
        id: s.id,
        sortKey: new Date(s.createdAt).getTime(),
        shoutout: s,
      }));

    return [...noteItems, ...shoutItems]
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 8);
  }, [allDailyContent, shoutouts, dismissedNoteIds, dismissedShoutoutIds]);

  const isLoading = shoutoutsLoading || contentLoading;

  // ── Mark shoutouts as seen ────────────────────────────────────────────────────
  const markedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const shoutoutsInFeed = feedItems
      .filter((f): f is ShoutItem => f.kind === "shoutout")
      .map(f => f.shoutout);

    const toMark = shoutoutsInFeed.filter(s => !s.seenAt && !markedRef.current.has(s.id));
    if (toMark.length === 0) return;
    toMark.forEach(s => markedRef.current.add(s.id));
    Promise.all(
      toMark.map(s =>
        apiRequest("POST", `/api/shoutouts/${s.id}/seen`, {}).catch(() => null),
      ),
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/shoutouts/unseen-count"] });
    });
  }, [feedItems]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const sendShoutoutMutation = useMutation({
    mutationFn: async () => {
      const recipientIds = resolveToProfileIds(toValue, realProfiles, groups)
        .filter(id => id !== fromId); // can't praise yourself

      if (recipientIds.length === 0) throw new Error("No valid recipients");

      // Send one shoutout per recipient (covers groups / all-family expansions)
      await Promise.all(
        recipientIds.map(toProfileId =>
          apiRequest("POST", "/api/shoutouts", {
            fromProfileId: fromId,
            toProfileId,
            emoji,
            message: shoutoutMsg.trim(),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shoutouts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/shoutouts/unseen-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Praise sent!", description: `${emoji} on its way.` });
      setShoutoutMsg("");
      setShoutoutOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't send",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const postNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/daily-content", {
        type: "note",
        title: "Note",
        content: noteContent.trim(),
        reference: noteFromId || null,  // author's profileId stored in reference
        isActive: true,
      });
      const note = await res.json();
      const recipientIds = resolveNoteRecipientIds(noteToValue, realProfiles, allFamilyProfile, groups);
      await apiRequest("POST", `/api/daily-content/${note.id}/assignments`, {
        profileIds: recipientIds,
      });
      return note;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-content"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-content-assignments"] });
      // Notes are a Family Activity entry now, so the feed has to refetch.
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Note posted!" });
      setNoteContent("");
      setNoteOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't post note",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  // ── Derived validity ──────────────────────────────────────────────────────────
  const canSendShoutout =
    !!fromId && !!toValue &&
    resolveToProfileIds(toValue, realProfiles, groups).filter(id => id !== fromId).length > 0 &&
    shoutoutMsg.trim().length > 0 &&
    !sendShoutoutMutation.isPending;

  // noteFromId is now required: a note posted with no author was stored with
  // reference: null, and Announcements' authorLabel() falls back to the
  // literal string "Family" for that — which reads like a real sender but
  // isn't one, and isn't something you could pick. Making the field required
  // removes the fallback case rather than dressing it up.
  const canPostNote =
    noteContent.trim().length > 0 && !!noteFromId && !postNoteMutation.isPending;

  // ── Dialog openers ────────────────────────────────────────────────────────────
  const openShoutoutDialog = () => {
    const first = realProfiles[0]?.id ?? "";
    const second = realProfiles.find(p => p.id !== first)?.id ?? "";
    if (!fromId) setFromId(first);
    if (!toValue) setToValue(second);
    setShoutoutOpen(true);
  };

  const openNoteDialog = () => {
    // Deliberately does NOT preselect the first profile any more: a note
    // silently attributed to whoever happens to sort first is the same
    // problem as attributing it to "Family". The author is now a required,
    // explicit choice (see canPostNote).
    setNoteOpen(true);
  };

  // External triggers from Home's main + button (trigger-counter pattern)
  useEffect(() => {
    if (triggerNote > 0) openNoteDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerNote]);
  useEffect(() => {
    if (triggerShoutout > 0) openShoutoutDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerShoutout]);

  // ── Recipient label helpers ───────────────────────────────────────────────────
  const recipientLabel = (note: DailyContentItem): string => {
    const ids = recipientsMap.get(note.id) ?? [];
    if (ids.length === 0) return "All Family";
    // Expanded to every real profile individually ("All Family Members" at
    // posting time) — distinct from a single assignment to the pseudo
    // All-Family profile, which the ids.length === 1 case below already
    // labels correctly via profileMap (that profile's own name is "All Family").
    if (ids.length === realProfiles.length && ids.length > 1) return "All Family Members";
    if (ids.length === 1) return profileMap.get(ids[0])?.name ?? "someone";
    // Check if it matches a named group
    const matchedGroup = groups.find(
      (g) => g.profileIds.length === ids.length && ids.every(id => g.profileIds.includes(id))
    );
    if (matchedGroup) return matchedGroup.name;
    return ids.map(id => profileMap.get(id)?.name ?? "?").join(", ");
  };

  const authorLabel = (note: DailyContentItem): string => {
    if (!note.reference) return "Family";
    return profileMap.get(note.reference)?.name ?? "Family";
  };

  // ── Shared To-select options ──────────────────────────────────────────────────
  // Plain native <select>/<option> (not the Radix Select used everywhere else
  // in this app) — same fix as every other picker converted for this reason:
  // iOS renders it as a real wheel picker, and it sidesteps whatever WebKit
  // rendering quirk was producing the "extra dots" before each name (Radix's
  // own SelectValue clone of a richly-nested SelectItem, on-device). A plain
  // <option> can only hold text, so the colored dot becomes a plain "●"
  // character prefix instead of a colored span — everywhere else that's
  // already made this same tradeoff for the same reason.
  const ToOptions = ({ excludeId, showAllMembersOption }: { excludeId?: string; showAllMembersOption?: boolean }) => (
    <>
      {realProfiles
        .filter(p => p.id !== excludeId)
        .map(p => (
          <option key={p.id} value={p.id}>● {p.name}</option>
        ))}
      {groups.length > 0 && (
        <optgroup label="Groups">
          {groups.map(g => (
            <option key={`group:${g.id}`} value={`group:${g.id}`}>
              ● {g.name} ({g.profileIds.length})
            </option>
          ))}
        </optgroup>
      )}
      {/* All Family / All Family Members — only notes distinguish these two;
          shoutouts don't pass showAllMembersOption since they already fan out
          to one dismissible-per-person copy regardless. */}
      <optgroup label="Special">
        {showAllMembersOption && (
          <option value="all-members">● All Family Members</option>
        )}
        <option value="all">● All Family</option>
      </optgroup>
    </>
  );

  // ── Dialogs (always rendered so + menu works even when card is hidden) ────────
  const dialogs = (
    <>
      {/* ── Shoutout / Praise dialog ─────────────────────────────────────────── */}
      <Dialog open={shoutoutOpen} onOpenChange={setShoutoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give praise</DialogTitle>
          </DialogHeader>
          {/* space-y-3 (was 4) + a smaller emoji row below — this whole form
              (2 fields, an emoji picker, and a message box) can exceed the
              visible space once the on-screen keyboard shrinks it, and the
              dialog's own "scroll the focused field into view" behavior
              then has to scroll the title/close-button out of view to reach
              a field near the bottom. Trimming the form's total height
              directly reduces how often that scroll needs to travel far
              enough to take the header off-screen with it. */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-from-profile"
                >
                  {realProfiles.map((p) => (
                    <option key={p.id} value={p.id}>● {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <select
                  value={toValue}
                  onChange={(e) => setToValue(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-to-profile"
                >
                  <ToOptions excludeId={fromId} />
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Emoji</label>
              <div className="flex gap-1.5 flex-wrap">
                {EMOJI_CHOICES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={`text-lg rounded-md p-1 border ${
                      emoji === e ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                    }`}
                    data-testid={`emoji-${e}`}
                    aria-label={`Choose ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Message ({shoutoutMsg.length}/{SHOUTOUT_MAX_LEN})
              </label>
              <Textarea
                ref={shoutoutMsgRef}
                value={shoutoutMsg}
                onChange={(e) => setShoutoutMsg(e.target.value.slice(0, SHOUTOUT_MAX_LEN))}
                placeholder="What did they do?"
                rows={3}
                className="resize-none overflow-hidden"
                data-testid="input-shoutout-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShoutoutOpen(false)}>Cancel</Button>
            <Button
              onClick={() => sendShoutoutMutation.mutate()}
              disabled={!canSendShoutout}
              data-testid="button-send-shoutout"
            >
              {sendShoutoutMutation.isPending ? "Sending…" : "Give praise"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Note dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post a note</DialogTitle>
          </DialogHeader>
          {/* space-y-3 (was 4) + a shorter textarea below — same fix as the
              Give Praise dialog right above: this form defaults to
              noteToValue="all", which shows the explainer paragraph right
              away, so it was tall enough by default (before typing
              anything) to push the header off-screen once the keyboard
              opened. Trimming height directly reduces how far that
              keyboard-driven scroll ever needs to travel. */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <select
                  value={noteFromId}
                  onChange={(e) => setNoteFromId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-note-from"
                >
                  <option value="">Who it's from…</option>
                  {realProfiles.map((p) => (
                    <option key={p.id} value={p.id}>● {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <select
                  value={noteToValue}
                  onChange={(e) => setNoteToValue(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  data-testid="select-note-to"
                >
                  <ToOptions showAllMembersOption />
                </select>
              </div>
            </div>
            {(noteToValue === "all" || noteToValue === "all-members") && (
              <p className="text-xs text-muted-foreground -mt-2">
                {noteToValue === "all"
                  ? "One shared note for the whole family — anyone can check it off, and it's done for everyone."
                  : "Everyone gets their own copy — each person checks off their own, independently of the others."}
              </p>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Note ({noteContent.length}/{NOTE_MAX_LEN})
              </label>
              <Textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value.slice(0, NOTE_MAX_LEN))}
                placeholder="What do you want to share?"
                rows={3}
                data-testid="input-note-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button
              onClick={() => postNoteMutation.mutate()}
              disabled={!canPostNote}
              data-testid="button-post-note"
            >
              {postNoteMutation.isPending ? "Posting…" : "Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  if (dialogsOnly) return dialogs;

  return (
    <>
      <Card data-testid="card-announcements">
        <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Announcements</h3>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : feedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet — post a note or send some praise!
            </p>
          ) : (
            <ul className="space-y-3 overflow-hidden">
              <AnimatePresence initial={false}>
                {feedItems.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 1, x: 0 }}
                    exit={{ x: "-110%", opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={{ left: 0.5, right: 0 }}
                    whileDrag={{ cursor: "grabbing" }}
                    onDragEnd={(_, info) => {
                      if (info.offset.x < -80) {
                        if (item.kind === "shoutout") dismissShoutout(item.id);
                        else dismissNote(item.id);
                      }
                    }}
                    className="flex items-start gap-3 select-none touch-pan-y"
                    data-testid={`feed-item-${item.id}`}
                  >
                    {item.kind === "note" ? (
                      <StickyNote className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <div className="text-2xl leading-none mt-0.5 shrink-0">{item.shoutout.emoji}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      {item.kind === "note" ? (
                        <>
                          <div className="text-sm flex items-center gap-1 flex-wrap">
                            <span className="font-medium">{authorLabel(item.note)}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">{recipientLabel(item.note)}</span>
                            <span className="text-muted-foreground text-xs ml-1">{relativeTime(item.note.createdAt)}</span>
                          </div>
                          <p className="text-sm text-foreground/90 break-words">{item.note.content}</p>
                        </>
                      ) : (
                        <>
                          <div className="text-sm flex items-center gap-1 flex-wrap">
                            <span className="font-medium">{profileMap.get(item.shoutout.fromProfileId)?.name ?? "Someone"}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">{profileMap.get(item.shoutout.toProfileId)?.name ?? "someone"}</span>
                            <span className="text-muted-foreground text-xs ml-1">{relativeTime(item.shoutout.createdAt)}</span>
                          </div>
                          <p className="text-sm text-foreground/90 break-words">{item.shoutout.message}</p>
                        </>
                      )}
                    </div>
                    <button
                      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 mt-0.5 flex-shrink-0 touch-manipulation"
                      title="Dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.kind === "shoutout") dismissShoutout(item.id);
                        else dismissNote(item.id);
                      }}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>
      {dialogs}
    </>
  );
}
