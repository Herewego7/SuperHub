import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { objectUrl } from "@/lib/apiBase";
import { Profile, RewardSettings, Chore } from "@workspace/shared-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PointsSuggestionHint } from "@/components/task-types";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmojiPicker } from "@/components/EmojiPicker";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useParentGate } from "@/lib/parentGate";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { PER_DAY_STARS_EXPLAINER } from "@/lib/copy";

// ── The five things a family can create from one place ────────────────────────
// "Regular"/"Target" are both stored as taskType:"chore" (target just has a
// targetCount). "Inspiration" is a family of content taskTypes. Keeping these as
// one picker means the confusing "specific days vs target count" toggle and the
// scattered add-buttons all collapse into "pick the kind, get its fields".
export type TaskKind = "regular" | "target" | "bonus" | "todo" | "inspiration";

const KIND_META: Record<TaskKind, { emoji: string; name: string; earns: boolean }> = {
  regular: { emoji: "🔁", name: "Chore", earns: true },
  target: { emoji: "🎯", name: "Target chore", earns: true },
  bonus: { emoji: "✨", name: "Bonus chore", earns: true },
  todo: { emoji: "✅", name: "To-do", earns: false },
  inspiration: { emoji: "🌱", name: "Inspiration", earns: false },
};

// Which PIN-gate feature each kind's SAVE is guarded by. To-dos and inspiration
// are ungated by default (createTodo isn't in the default set); the chore kinds
// stay gated. See lib/parentGate.tsx.
export const KIND_GATE: Record<TaskKind, string> = {
  regular: "createChore",
  target: "createChore",
  bonus: "createBonusChore",
  todo: "createTodo",
  inspiration: "createTodo",
};

// Inspiration sub-types map straight onto existing taskType values.
const INSPIRATION_TYPES = [
  { value: "affirmation", label: "Affirmation", emoji: "💬" },
  { value: "bible_verse", label: "Bible verse", emoji: "📜" },
  { value: "memory_verse", label: "Memory verse", emoji: "📖" },
  { value: "mission", label: "Mission", emoji: "❤️" },
  { value: "custom", label: "Other", emoji: "📝" },
] as const;

const DAYS = [
  { value: 0, short: "S" }, { value: 1, short: "M" }, { value: 2, short: "T" },
  { value: 3, short: "W" }, { value: 4, short: "T" }, { value: 5, short: "F" }, { value: 6, short: "S" },
];

const INSPIRATION_TASK_TYPES = new Set(INSPIRATION_TYPES.map(t => t.value as string));

const INSPIRATION_CONTENT_LABEL: Record<string, string> = {
  affirmation: "Content",
  bible_verse: "Verse text & reference",
  memory_verse: "Verse to memorize",
  mission: "What to do",
  custom: "Content",
};
const INSPIRATION_CONTENT_PLACEHOLDER: Record<string, string> = {
  affirmation: "e.g. I am kind and brave, and I can handle today.",
  bible_verse: "e.g. \"For I know the plans I have for you...\" — Jeremiah 29:11",
  memory_verse: "The verse to memorize, word for word.",
  mission: "e.g. Give someone a compliment today, or help without being asked.",
  custom: "The full text to show…",
};

// Which kind an existing chore row is, so the drawer can reopen the right form.
export function deriveTaskKind(c: Chore): TaskKind {
  if (c.isBonus) return "bonus";
  if (c.taskType === "todo") return "todo";
  if (c.taskType && INSPIRATION_TASK_TYPES.has(c.taskType)) return "inspiration";
  if (c.targetCount && c.targetCount > 0) return "target";
  return "regular";
}

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
  selectedProfiles: string[];
  /** Skip the picker and open straight to this kind's form (card-level "+"). */
  initialKind?: TaskKind | null;
  /** When set, the modal opens in EDIT mode for this task (kind fixed, fields
   *  prefilled, save PATCHes instead of POSTing). Used by the Manage drawer. */
  editChore?: Chore | null;
  /** Navigate to the tab where a just-created task of this kind lives. When
   *  given, the "created!" toast gets a one-tap action to go see it — the
   *  modal closes on success, so without this the confirmation is a dead end
   *  on whatever screen you happened to launch it from. */
  onGoToKind?: (kind: TaskKind) => void;
}

// Small avatar toggle used by every "who is this for" row.
function AssigneeRow({
  profiles, selected, onToggle,
}: { profiles: Profile[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {profiles.map(p => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            aria-pressed={on}
            className={cn(
              // Deliberately compact (small avatar, text-xs, tight padding):
              // this row wraps, and with the keyboard up the dialog is short
              // enough that a full-size chip put only three people on screen.
              "flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 border transition-colors",
              // bg-accent, not bg-primary/10: opacity-modifier utilities on
              // theme colours currently compile to no CSS, so the selected
              // chip's tint never rendered and only its border changed —
              // barely distinguishable from unselected. Also thickens the
              // border so selection reads without relying on colour alone.
              on
                ? "border-primary border-2 bg-accent font-semibold"
                : "border-border bg-background [@media(hover:hover)]:hover:bg-accent",
            )}
            data-testid={`assignee-${p.id}`}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}90)` }}
            >
              {p.photoUrl ? <img src={objectUrl(p.photoUrl)} alt={p.name} className="w-full h-full object-cover" /> : p.initials}
            </span>
            <span className="text-xs font-medium">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CreateTaskModal({ open, onOpenChange, profiles, selectedProfiles, initialKind = null, editChore = null, onGoToKind }: CreateTaskModalProps) {
  const isEdit = !!editChore;
  const { toast } = useToast();
  /** "Created!" is a dead end once the modal closes — this puts the thing you
   *  just made one tap away, wherever you happened to create it from. */
  const goToAction = (k: TaskKind | null) => {
    if (!k || !onGoToKind) return undefined;
    const label = k === "todo" ? "View To-Dos" : "View";
    return (
      <ToastAction altText={label} onClick={() => onGoToKind(k)}>
        {label}
      </ToastAction>
    );
  };
  const { guard: guardParentAction, gateDialog, gatePending } = useParentGate(profiles, selectedProfiles);
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const perCompletionMode = rewardSettings?.pointsMode === "per_completion";

  const assignable = profiles.filter(p => !p.isAllFamilyProfile && p.isActive !== false);
  // Default assignees: whoever's currently filtered to (a single selected kid,
  // or a genuine subset), else no one — matching the app's existing "assign to
  // whoever you're looking at" convenience without silently assigning to the
  // whole family. The header represents "viewing everyone" two different ways
  // (an empty selection right after "deselect all", or every real profile id
  // right after initial load / "select all") — both mean the same thing here,
  // so both default to no one preselected rather than the full family.
  const defaultAssignees = () => {
    const sel = selectedProfiles.filter(id => assignable.some(p => p.id === id));
    if (sel.length === 0 || sel.length === assignable.length) return [];
    return sel;
  };

  const [kind, setKind] = useState<TaskKind | null>(initialKind);
  // shared
  // One vs. several: in "several" mode the Name field becomes a list of rows
  // and every OTHER setting on the form applies to all of them — the simple
  // replacement for the old (removed) Bulk Add screen. Icon is the one
  // exception: each row gets its own, since a batch of chores ("Make bed",
  // "Feed the dog", "Take out trash") realistically each want a different icon.
  const [multiMode, setMultiMode] = useState(false);
  // `subs` is to-dos only: a to-do can carry one level of sub-to-dos, matching
  // what the To-Dos tab can actually draw. Every other kind leaves it empty.
  const [names, setNames] = useState<{ name: string; icon: string; subs: string[] }[]>([{ name: "", icon: "", subs: [] }]);
  const [singleSubs, setSingleSubs] = useState<string[]>([]);
  // Which name row's "+ sub-to-do" link is showing. Only the row with focus
  // gets one — a link under every row reads as clutter on a long list.
  const [activeRow, setActiveRow] = useState<number | "single" | null>(null);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [points, setPoints] = useState<number>(2);
  // regular / target
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [endDate, setEndDate] = useState<string>(""); // yyyy-MM-dd, "" = no end
  // target
  const [targetCount, setTargetCount] = useState<number>(3);
  const [targetPeriod, setTargetPeriod] = useState<"weekly" | "monthly">("weekly");
  // bonus — frequency is a 3-way like the original (Anytime / per period /
  // fixed total), so editing a "N times ever" chore never silently converts it.
  const [bonusEveryone, setBonusEveryone] = useState(true);
  const [bonusFreq, setBonusFreq] = useState<"unlimited" | "per_period" | "total">("unlimited");
  const [bonusCount, setBonusCount] = useState<number>(1);
  const [bonusPeriod, setBonusPeriod] = useState<"day" | "week" | "month">("week");
  // inspiration
  const [inspType, setInspType] = useState<string>("affirmation");

  // Reset/prefill whenever the modal (re)opens. In edit mode, load the chore's
  // own values; otherwise start fresh honoring initialKind.
  useEffect(() => {
    if (!open) return;
    if (editChore) {
      const k = deriveTaskKind(editChore);
      setKind(k);
      setTitle(editChore.title ?? "");
      setIcon(editChore.icon ?? "");
      setDescription(editChore.description ?? "");
      const ids = (editChore.profileIds ?? []) as string[];
      setAssignees(ids);
      setPoints(editChore.points ?? 0);
      setDays(((editChore.daysOfWeek ?? [0,1,2,3,4,5,6]) as number[]));
      setEndDate(editChore.endDate ? new Date(editChore.endDate).toISOString().slice(0, 10) : "");
      setTargetCount(editChore.targetCount && editChore.targetCount > 0 ? editChore.targetCount : 3);
      setTargetPeriod(editChore.recurrenceType === "monthly" ? "monthly" : "weekly");
      // Bonus frequency → the 3-way (unlimited / per_period / total) so a
      // "fixed total" chore round-trips instead of being downgraded.
      const ft = ((editChore as any).bonusFrequencyType ?? "unlimited") as "unlimited" | "per_period" | "total";
      setBonusFreq(ft);
      setBonusCount((editChore as any).bonusFrequencyCount ?? 1);
      setBonusPeriod(((editChore as any).bonusFrequencyPeriod ?? "week"));
      setBonusEveryone(ids.length === 0);
      setInspType(k === "inspiration" ? (editChore.taskType as string) : "affirmation");
      return;
    }
    setKind(initialKind);
    setMultiMode(false); setNames([{ name: "", icon: "", subs: [] }]); setSingleSubs([]); setActiveRow(null);
    setTitle(""); setIcon(""); setDescription(""); setAssignees(defaultAssignees());
    setPoints(initialKind === "bonus" ? 8 : initialKind === "target" ? 5 : 2);
    setDays([]); setEndDate("");
    setTargetCount(3); setTargetPeriod("weekly");
    setBonusEveryone(true); setBonusFreq("unlimited"); setBonusCount(1); setBonusPeriod("week");
    setInspType("affirmation");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind, editChore]);

  const close = () => onOpenChange(false);

  const createMutation = useMutation({
    mutationFn: async ({ url, body }: { url: string; body: any; label: string }) => {
      // Edit mode PATCHes the existing chore (all kinds share /api/chores/:id);
      // create mode POSTs to the kind's create endpoint.
      if (isEdit && editChore) {
        // Don't resurrect a deactivated task: isActive is a create-time
        // default, never an edit intent, so strip it from the PATCH.
        const { isActive, ...patch } = body;
        const res = await apiRequest("PATCH", `/api/chores/${editChore.id}`, patch);
        return res.json();
      }
      const res = await apiRequest("POST", url, body);
      return res.json();
    },
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/chores/bonus"] });
      toast({
        title: isEdit ? `${vars.label} saved!` : `${vars.label} created!`,
        ...(isEdit ? {} : { action: goToAction(kind) }),
      });
      close();
    },
    onError: (err: any) => toast({ title: isEdit ? "Couldn't save it" : "Couldn't create it", description: err?.message, variant: "destructive" }),
  });

  const toggleAssignee = (id: string) =>
    setAssignees(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const toggleDay = (d: number) =>
    setDays(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]);
  const setNameAt = (i: number, v: string) => setNames(cur => cur.map((n, idx) => idx === i ? { ...n, name: v } : n));
  const setIconAt = (i: number, v: string) => setNames(cur => cur.map((n, idx) => idx === i ? { ...n, icon: v } : n));
  const addNameRow = () => setNames(cur => [...cur, { name: "", icon: "", subs: [] }]);
  const removeNameRow = (i: number) => setNames(cur => cur.length === 1 ? cur : cur.filter((_, idx) => idx !== i));

  // Sub-to-do rows. In "several" mode they hang off a name row; in "just one"
  // mode off the single title field. Same shape either way.
  const subsOf = (i: number | "single") => (i === "single" ? singleSubs : (names[i]?.subs ?? []));
  const setSubs = (i: number | "single", next: string[]) =>
    i === "single" ? setSingleSubs(next) : setNames(cur => cur.map((n, idx) => idx === i ? { ...n, subs: next } : n));
  const addSub = (i: number | "single") => setSubs(i, [...subsOf(i), ""]);
  /**
   * Focus tracking for one name row, so its "+ sub-to-do" link shows only
   * while that row is being used. Tracked on the wrapper, not the input, so
   * the parent field, its sub fields and the link itself all count as "still
   * on this row" — otherwise the link would unmount on blur before the tap
   * that opened it could land.
   *
   * The clear is deferred a tick on purpose: unmounting the link synchronously
   * during focusout swallows the click that was moving focus to another row
   * (Radix's dialog focus scope pulls focus back to the content), so the tap
   * lands nowhere. Letting focus settle first, then re-checking where it
   * actually ended up, avoids that entirely.
   */
  const rowFocusProps = (i: number | "single") => ({
    "data-namerow": String(i),
    onFocusCapture: () => setActiveRow(i),
    onBlurCapture: () => {
      setTimeout(() => {
        if (!document.activeElement?.closest(`[data-namerow="${i}"]`)) {
          setActiveRow(cur => (cur === i ? null : cur));
        }
      }, 0);
    },
  });
  const setSubAt = (i: number | "single", j: number, v: string) => setSubs(i, subsOf(i).map((s, idx) => idx === j ? v : s));
  const removeSub = (i: number | "single", j: number) => setSubs(i, subsOf(i).filter((_, idx) => idx !== j));

  // Build the create payload for ONE title — shared by the single-save and the
  // "several at once" paths so every row gets the identical settings, except
  // icon, which is per-row (rowIcon — the single-mode caller passes the shared
  // `icon` state; the bulk-mode caller passes that row's own icon).
  const buildBody = (name: string, rowIcon: string): { url: string; label: string; body: any } => {
    const desc = description.trim() || null;
    const end = endDate ? new Date(`${endDate}T23:59:59`).toISOString() : null;
    if (kind === "target") return { url: "/api/chores", label: "Target chore", body: {
      title: name, description: desc, icon: rowIcon || null, taskType: "chore", points,
      profileIds: assignees, daysOfWeek: [0,1,2,3,4,5,6], recurrenceType: targetPeriod, targetCount, endDate: end, isActive: true } };
    if (kind === "bonus") return { url: "/api/chores/bonus", label: "Bonus chore", body: {
      title: name, description: desc, icon: rowIcon || null, points,
      profileIds: bonusEveryone ? [] : assignees,
      bonusFrequencyType: bonusFreq,
      bonusFrequencyCount: bonusFreq === "unlimited" ? null : bonusCount,
      bonusFrequencyPeriod: bonusFreq === "per_period" ? bonusPeriod : null } };
    // To-dos/inspiration don't expose points/days/recurrence in this form (the
    // picker treats them as one-off, no-stars items) — but an EXISTING row of
    // either kind can carry values from elsewhere (a legacy to-do with stars,
    // per chores-view's "to-dos keep their points" carve-out). On create there's
    // nothing to preserve, so the create-time defaults apply; on edit, keep
    // whatever the row already had rather than silently overwriting it with a
    // field this form never showed the user.
    if (kind === "todo") return { url: "/api/chores", label: "To-do", body: {
      title: name, description: desc, taskType: "todo",
      points: isEdit && editChore ? (editChore.points ?? 0) : 0,
      profileIds: assignees,
      daysOfWeek: isEdit && editChore ? (editChore.daysOfWeek ?? [0,1,2,3,4,5,6]) : [0,1,2,3,4,5,6],
      recurrenceType: isEdit && editChore ? (editChore.recurrenceType ?? "daily") : "daily",
      isActive: true } };
    if (kind === "inspiration") return { url: "/api/chores", label: "Inspiration", body: {
      title: name, description: desc, taskType: inspType,
      points: isEdit && editChore ? (editChore.points ?? 0) : 0,
      profileIds: assignees,
      daysOfWeek: isEdit && editChore ? (editChore.daysOfWeek ?? [0,1,2,3,4,5,6]) : [0,1,2,3,4,5,6],
      recurrenceType: isEdit && editChore ? (editChore.recurrenceType ?? "daily") : "daily",
      isActive: true } };
    return { url: "/api/chores", label: "Regular chore", body: {
      title: name, description: desc, icon: rowIcon || null, taskType: "chore", points,
      profileIds: assignees, daysOfWeek: days, recurrenceType: "weekly", targetCount: null, endDate: end, isActive: true } };
  };

  // "Several at once" — POST each row in turn (no batch endpoint exists).
  // Each row's outcome is tracked individually rather than a plain for-loop
  // that throws out entirely on the first failure: a mid-batch failure used
  // to leave an unknown number already created with zero feedback, and the
  // old onError never invalidated at all — so even the rows that DID succeed
  // before the failure wouldn't appear until some unrelated refetch happened.
  const bulkMutation = useMutation({
    mutationFn: async (list: { name: string; icon: string; subs: string[] }[]) => {
      let subsCreated = 0;
      let subsFailed = 0;
      const results = await Promise.allSettled(
        list.map(async (row) => {
          const b = buildBody(row.name, row.icon);
          const res = await apiRequest("POST", b.url, b.body);
          const subs = row.subs.map(t => t.trim()).filter(Boolean);
          if (subs.length === 0) return;
          // Children need the parent's id, so they can only go out once it
          // exists. A child that fails leaves the parent standing — the tab's
          // own "add under" covers the gap, which beats unwinding a half-made
          // tree and losing the parent the user did get.
          const parent = await res.json();
          const kids = await Promise.allSettled(
            subs.map(t => apiRequest("POST", "/api/chores", { ...b.body, title: t, description: null, parentChoreId: parent.id })),
          );
          subsCreated += kids.filter(k => k.status === "fulfilled").length;
          subsFailed += kids.filter(k => k.status === "rejected").length;
        }),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;
      return { succeeded, failed, total: list.length, subsCreated, subsFailed };
    },
    onSuccess: async ({ succeeded, failed, total, subsCreated, subsFailed }) => {
      if (succeeded > 0) {
        await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/chores/bonus"] });
      }
      const noun = kind ? KIND_META[kind].name.toLowerCase() : "task";
      const subNote = subsCreated > 0 ? ` and ${subsCreated} sub-to-do${subsCreated === 1 ? "" : "s"}` : "";
      if (failed === 0 && subsFailed === 0) {
        toast({ title: `${succeeded} ${noun}${succeeded === 1 ? "" : "s"}${subNote} created!`, action: goToAction(kind) });
        close();
      } else if (failed === 0) {
        toast({
          title: `${succeeded} ${noun}${succeeded === 1 ? "" : "s"}${subNote} created`,
          description: `${subsFailed} sub-to-do${subsFailed === 1 ? "" : "s"} didn't save — add ${subsFailed === 1 ? "it" : "them"} from the To-Dos tab.`,
          variant: "destructive",
        });
        close();
      } else if (succeeded > 0) {
        toast({
          title: `${succeeded} of ${total} ${noun}s created`,
          description: `${failed} failed to save — the rest are already saved; re-add just the ones that didn't go through.`,
          variant: "destructive",
        });
        close();
      } else {
        toast({ title: `Couldn't create any of the ${total} ${noun}s`, description: "Please try again.", variant: "destructive" });
        // Stay open — nothing was saved, so there's nothing to lose by retrying.
      }
    },
    onError: (err: any) => toast({ title: "Couldn't create them", description: err?.message, variant: "destructive" }),
  });

  function submit() {
    if (!kind) return;

    // One row or a list, depending on mode; blank names dropped.
    // A blank parent takes its sub-to-dos with it rather than orphaning them
    // to the top level — they were only ever meant to sit under that name.
    const list = multiMode
      ? names.map(n => ({ name: n.name.trim(), icon: n.icon, subs: n.subs })).filter(n => n.name)
      : (title.trim() ? [{ name: title.trim(), icon, subs: singleSubs }] : []);
    if (list.length === 0) {
      toast({ title: multiMode ? "Add at least one name" : "Please enter a name", variant: "destructive" }); return;
    }

    // Per-kind validation applies to every name in the batch.
    if (kind === "regular" && days.length === 0) {
      toast({ title: "Pick at least one day", variant: "destructive" }); return;
    }
    if (kind === "bonus" && !bonusEveryone && assignees.length === 0) {
      toast({ title: "Pick who can claim it, or choose Everyone", variant: "destructive" }); return;
    }
    // To-dos and inspiration MUST have an owner: an unassigned to-do shows up
    // nowhere but the drawer, and an unassigned inspiration can't be completed.
    if ((kind === "todo" || kind === "inspiration") && assignees.length === 0) {
      toast({ title: kind === "todo" ? "Pick who this to-do is for" : "Pick who this is for", variant: "destructive" }); return;
    }

    const doSave = () => {
      // Sub-to-dos need the parent's id back, which only the bulk path waits
      // for — so a single to-do WITH children goes through it too.
      const hasSubs = list.some(n => n.subs.some(t => t.trim()));
      if (multiMode || hasSubs) bulkMutation.mutate(list);
      else createMutation.mutate(buildBody(list[0].name, list[0].icon));
    };
    guardParentAction(KIND_GATE[kind], doSave);
  }

  const pending = createMutation.isPending || bulkMutation.isPending;
  // To-dos and inspiration MUST have an owner (see the identical check in
  // submit()) — disable Create up front instead of only toasting on submit,
  // so it's clear before tapping that a person still needs to be picked.
  const needsAssigneeToEnable = (kind === "todo" || kind === "inspiration") && assignees.length === 0;
  const multiCount = names.filter(n => n.name.trim()).length;
  // Sub-to-dos on rows that will actually be created (a blank parent takes
  // its children with it, so its subs don't count).
  const subCount = (multiMode
    ? names.filter(n => n.name.trim()).flatMap(n => n.subs)
    : (title.trim() ? singleSubs : [])
  ).filter(t => t.trim()).length;
  const showStars = (kind === "regular" || kind === "target") && !perCompletionMode;

  /**
   * One name row's sub-to-dos, plus the "+ sub-to-do" link.
   *
   * The link only renders for the row that currently has focus (`activeRow`),
   * so a long list isn't a column of links for rows that will never have
   * children. Focus is tracked on the wrapping div rather than the input, so
   * moving between the parent field, its sub fields and the link itself all
   * count as still being on this row — otherwise the link would disappear on
   * blur before the tap that opened it could land.
   */
  const subBlock = (i: number | "single") => {
    if (kind !== "todo") return null;
    const subs = subsOf(i);
    // A sub-to-do always goes to whoever its parent goes to. Shown as the
    // parent's own avatars, dimmed and not tappable, rather than said in a
    // sentence: the rule is about WHO, and who is a face.
    const inherited = assignees
      .map(id => assignable.find(p => p.id === id))
      .filter((p): p is Profile => !!p);
    const key = (j: number) => `${i === "single" ? "s" : i}-${j}`;
    return (
      <>
        {subs.length > 0 && (
          <div className="ml-3.5 pl-3 border-l-2 border-border space-y-1.5">
            {subs.map((sub, j) => (
              <div key={key(j)} className="flex items-center gap-2">
                <Input
                  autoFocus={sub === "" && j === subs.length - 1}
                  value={sub}
                  onChange={e => setSubAt(i, j, e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSub(i); } }}
                  placeholder="Step or item"
                  className="flex-1 h-8 text-sm"
                  data-testid={`create-sub-${key(j)}`}
                />
                {inherited.length > 0 && (
                  <span className="flex -space-x-1 shrink-0 opacity-50" data-testid={`create-sub-inherited-${key(j)}`}>
                    {inherited.slice(0, 3).map(p => (
                      <span
                        key={p.id}
                        className="w-4 h-4 rounded-full border border-background flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ backgroundColor: p.color ?? "#888" }}
                      >
                        {(p.initials ?? p.name?.[0] ?? "?").slice(0, 1)}
                      </span>
                    ))}
                  </span>
                )}
                <Button type="button" size="sm" variant="ghost" className="px-2 text-muted-foreground shrink-0" onClick={() => removeSub(i, j)} aria-label="Remove sub-to-do">✕</Button>
              </div>
            ))}
          </div>
        )}
        {activeRow === i && (
          <button
            type="button"
            className="ml-3.5 self-start text-[11px] text-primary hover:underline"
            onClick={() => addSub(i)}
            data-testid={`create-add-sub-${i}`}
          >
            + sub-to-do
          </button>
        )}
      </>
    );
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => {
      // Don't let tapping into the PIN dialog (which opens on top of this
      // modal in kid context) dismiss the form underneath it.
      if (!o && gatePending) return;
      onOpenChange(o);
    }}>
      <DialogContent
        className="w-full max-w-md bg-card rounded-2xl border border-border shadow-xl"
        data-testid="create-task-modal"
        // Radix focuses the first focusable element in the dialog by
        // default (here, the "Chore" kind card) the instant it opens —
        // same general class of visual glitch as the sticky-hover fix
        // above: a highlighted-looking card with no real selection behind
        // it. Suppressed the same way other dialogs in this app already
        // do when an unwanted default focus target would look like state
        // that isn't there.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-lg">
            {kind ? (
              <>
                {/* Back to the picker (hidden when opened straight to a kind or editing) —
                    same ghost rounded-full icon-button style used by the app's other
                    back/prev controls (e.g. the persistent header's date-nav arrow). */}
                {!initialKind && !isEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setKind(null)}
                    className="p-1.5 -ml-1.5 h-8 w-8 hover:bg-accent rounded-full shrink-0"
                    aria-label="Back to task types"
                    data-testid="create-back"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                )}
                <span>{KIND_META[kind].emoji}</span>
                <span>{isEdit ? "Edit" : "New"} {KIND_META[kind].name.toLowerCase()}</span>
              </>
            ) : "New task"}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: pick a kind ─────────────────────────────────────────── */}
        {!kind && (
          <div className="space-y-2.5">
            <p className="text-sm text-muted-foreground -mt-1">What would you like to make?</p>
            {/* "todo" is intentionally NOT in this picker — To-Dos are one-off
                items with their own tab; they're created from the To-Dos card's
                inline add or the global "+" → "Add a to-do" (which opens this
                modal pre-set to the todo kind). */}
            {(["regular", "target", "bonus"] as TaskKind[]).map(k => (
              <KindCard key={k} k={k} onPick={() => setKind(k)} />
            ))}
            <div className="flex items-center gap-2.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
              <span className="h-px flex-1 bg-border" /> or add something to reflect on <span className="h-px flex-1 bg-border" />
            </div>
            <KindCard k="inspiration" onPick={() => setKind("inspiration")} />
          </div>
        )}

        {/* ── STEP 2: the tailored form ───────────────────────────────────── */}
        {kind && (
          <div className="space-y-4">
            {/* Just one vs. several at once (create only). "Several" turns the
                name field into a list; every other setting below applies to
                all of them — the simple replacement for the old Bulk Add. */}
            {!isEdit && (
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant={!multiMode ? "default" : "outline"} className="text-xs" onClick={() => setMultiMode(false)} data-testid="mode-one">Just one</Button>
                <Button type="button" size="sm" variant={multiMode ? "default" : "outline"} className="text-xs" onClick={() => setMultiMode(true)} data-testid="mode-several">Several at once</Button>
              </div>
            )}

            {/* Name(s) (+ emoji for chores) */}
            {/* No label: the placeholder ("Task 1" / the single-mode
                placeholder) already says what this field is, and with the
                keyboard up every row of vertical space is one more assignee
                the user can actually see. */}
            <div>
              {multiMode ? (
                <div className="mt-1.5 space-y-2">
                  {names.map((row, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-1.5"
                      {...rowFocusProps(i)}
                    >
                      <div className="flex items-center gap-2">
                        {(kind === "regular" || kind === "target" || kind === "bonus") && (
                          <EmojiPicker value={row.icon} onChange={v => setIconAt(i, v)} compact />
                        )}
                        <Input
                          autoFocus={i === names.length - 1}
                          value={row.name}
                          onChange={e => setNameAt(i, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNameRow(); } }}
                          placeholder={`Task ${i + 1}`}
                          className="flex-1"
                          data-testid={`create-name-${i}`}
                        />
                        {names.length > 1 && (
                          <Button type="button" size="sm" variant="ghost" className="px-2 text-muted-foreground shrink-0" onClick={() => removeNameRow(i)} aria-label={`Remove task ${i + 1}`}>✕</Button>
                        )}
                      </div>
                      {subBlock(i)}
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" className="text-xs" onClick={addNameRow} data-testid="create-add-name">+ Add another</Button>

                </div>
              ) : (
                <div
                  className="mt-1.5 flex flex-col gap-1.5"
                  {...rowFocusProps("single")}
                >
                  <div className="flex items-center gap-2">
                    {(kind === "regular" || kind === "target" || kind === "bonus") && (
                      <EmojiPicker value={icon} onChange={setIcon} compact />
                    )}
                    <Input
                      autoFocus
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder={
                        kind === "bonus" ? "Wash the car" :
                        kind === "todo" ? "Return library books" :
                        kind === "inspiration" ? "I am kind and brave" : "Make bed"
                      }
                      className="flex-1"
                      data-testid="create-title"
                    />
                  </div>
                  {subBlock("single")}
                </div>
              )}
            </div>

            {/* In "several at once" mode every field below is shared by the
                whole batch. Shown structurally — a rail down the left with a
                count at its top, the same visual grammar the sub-to-do rail
                uses — rather than as a sentence under the name list. */}
            <div className={cn("space-y-4", multiMode && multiCount > 1 && "relative border-l-2 border-border pl-3 ml-1 pt-2")}>
            {multiMode && multiCount > 1 && (
              <span
                className="absolute -top-2 -left-[9px] px-1.5 rounded-full bg-background border border-border text-[10px] font-medium text-muted-foreground"
                data-testid="create-shared-scope"
              >
                all {multiCount}
              </span>
            )}

            {/* Description (chore kinds) — optional note/detail. Deliberately
                NOT shown for to-dos: to-dos are meant to stay simple
                one-liners, and — unlike regular/target/bonus chores, whose
                description does show up elsewhere (bonus chores render it
                inline; the others are visible via editing) — a to-do's
                description had nowhere in the app it was ever displayed,
                so the field was a dead end with no way to see what you typed. */}
            {(kind === "regular" || kind === "target" || kind === "bonus") && (
              <div>
                <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Any extra detail…"
                  className="mt-1.5"
                  data-testid="create-description"
                />
              </div>
            )}

            {/* Inspiration content — the actual affirmation/verse/mission text.
                The Name field above is just a short title; without this the
                form had nowhere to enter the real content at all. */}
            {kind === "inspiration" && (
              <div>
                <Label>{INSPIRATION_CONTENT_LABEL[inspType] ?? "Content"}</Label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={INSPIRATION_CONTENT_PLACEHOLDER[inspType] ?? "The full text to show…"}
                  rows={4}
                  className="mt-1.5"
                  data-testid="create-inspiration-content"
                />
              </div>
            )}

            {/* Inspiration kind */}
            {kind === "inspiration" && (
              <div>
                <Label>Kind</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {INSPIRATION_TYPES.map(t => (
                    <button key={t.value} type="button" onClick={() => setInspType(t.value)}
                      className={cn("px-2.5 py-1.5 text-xs rounded-full border transition-colors",
                        inspType === t.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent/40")}
                      data-testid={`insp-type-${t.value}`}>
                      {t.emoji} {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Who it's for (regular / target / todo / inspiration) */}
            {kind !== "bonus" && (
              <div>
                <Label>{kind === "inspiration" ? "Who it's for" : "Assign to"}</Label>
                <div className="mt-1.5">
                  <AssigneeRow profiles={assignable} selected={assignees} onToggle={toggleAssignee} />
                </div>
              </div>
            )}

            {/* Regular: days */}
            {kind === "regular" && (
              <div>
                <Label>Days</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5 mb-2">
                  <Button type="button" size="sm" variant={days.length === 7 ? "default" : "outline"} className="text-xs" onClick={() => setDays([0,1,2,3,4,5,6])}>All</Button>
                  <Button type="button" size="sm" variant={days.length === 5 && days.includes(1) && !days.includes(0) ? "default" : "outline"} className="text-xs" onClick={() => setDays([1,2,3,4,5])}>Weekdays</Button>
                  <Button type="button" size="sm" variant={days.length === 2 && days.includes(0) && days.includes(6) ? "default" : "outline"} className="text-xs" onClick={() => setDays([0,6])}>Weekends</Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(d => (
                    <Button key={d.value} type="button" size="sm" className="text-xs w-9"
                      variant={days.includes(d.value) ? "default" : "outline"} onClick={() => toggleDay(d.value)}
                      data-testid={`create-day-${d.value}`}>{d.short}</Button>
                  ))}
                </div>
              </div>
            )}

            {/* Target: N times per week/month */}
            {kind === "target" && (
              <div>
                <Label>How often</Label>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm">
                  Complete
                  <Input type="number" min={1} value={targetCount}
                    onChange={e => setTargetCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 text-center" data-testid="create-target-count" />
                  times per
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant={targetPeriod === "weekly" ? "default" : "outline"} className="text-xs" onClick={() => setTargetPeriod("weekly")}>Week</Button>
                    <Button type="button" size="sm" variant={targetPeriod === "monthly" ? "default" : "outline"} className="text-xs" onClick={() => setTargetPeriod("monthly")}>Month</Button>
                  </div>
                </div>
              </div>
            )}

            {/* Bonus: who can claim it + how often */}
            {kind === "bonus" && (
              <>
                <div>
                  <Label>Who can claim it</Label>
                  <div className="mt-1.5 flex gap-1.5 mb-2">
                    <Button type="button" size="sm" variant={bonusEveryone ? "default" : "outline"} className="text-xs" onClick={() => setBonusEveryone(true)} data-testid="bonus-everyone">Everyone</Button>
                    <Button type="button" size="sm" variant={!bonusEveryone ? "default" : "outline"} className="text-xs" onClick={() => setBonusEveryone(false)} data-testid="bonus-choose">Choose people</Button>
                  </div>
                  {!bonusEveryone && (
                    <>
                      <AssigneeRow profiles={assignable} selected={assignees} onToggle={toggleAssignee} />
                      <p className="text-xs text-muted-foreground mt-1.5">Only people you pick will see it.</p>
                    </>
                  )}
                </div>
                <div>
                  <Label>How often can it be claimed?</Label>
                  <div className="mt-1.5 flex gap-1.5 mb-2 flex-wrap">
                    <Button type="button" size="sm" variant={bonusFreq === "unlimited" ? "default" : "outline"} className="text-xs" onClick={() => setBonusFreq("unlimited")} data-testid="bonus-anytime">Anytime</Button>
                    <Button type="button" size="sm" variant={bonusFreq === "per_period" ? "default" : "outline"} className="text-xs" onClick={() => setBonusFreq("per_period")} data-testid="bonus-limit">Limit per period</Button>
                    <Button type="button" size="sm" variant={bonusFreq === "total" ? "default" : "outline"} className="text-xs" onClick={() => setBonusFreq("total")} data-testid="bonus-total">Fixed total</Button>
                  </div>
                  {bonusFreq === "per_period" && (
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      Up to
                      <Input type="number" min={1} value={bonusCount}
                        onChange={e => setBonusCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 text-center" data-testid="bonus-count" />
                      times per
                      <div className="flex gap-1.5">
                        {(["day", "week", "month"] as const).map(pd => (
                          <Button key={pd} type="button" size="sm" variant={bonusPeriod === pd ? "default" : "outline"} className="text-xs capitalize" onClick={() => setBonusPeriod(pd)}>{pd}</Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {bonusFreq === "total" && (
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      Only
                      <Input type="number" min={1} value={bonusCount}
                        onChange={e => setBonusCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 text-center" data-testid="bonus-count" />
                      times ever <span className="text-muted-foreground">(family-wide)</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* End date (regular/target) — optional; the chore stops appearing
                after this day. Empty = runs indefinitely. */}
            {(kind === "regular" || kind === "target") && (
              <div>
                <Label>End date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    // Full width like every other field in this form; w-44
                    // left it visibly out of step with the rest.
                    className="w-full appearance-none"
                    data-testid="create-end-date"
                  />
                  {endDate && (
                    <Button type="button" size="sm" variant="ghost" className="text-xs" onClick={() => setEndDate("")}>Clear</Button>
                  )}
                </div>
              </div>
            )}

            {/* Stars — chores that earn (hidden entirely for to-dos/inspiration,
                and hidden for checklist chores in per_completion mode). */}
            {(kind === "regular" || kind === "target") && (
              showStars ? (
                <div>
                  <Label>Stars per completion</Label>
                  <Input type="number" min={0} value={points}
                    onChange={e => setPoints(Math.max(0, parseInt(e.target.value) || 0))}
                    className="mt-1.5 w-24" data-testid="create-points" />
                  {/* Effort tiers + the live "≈ $x.xx at your family's rate"
                      line. This existed on the old add/edit chore forms in
                      chores-view.tsx, but wasn't carried over when this modal
                      became the only reachable creation path — so the helper
                      was live code nobody could reach. */}
                  <PointsSuggestionHint points={points} onPick={setPoints} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {PER_DAY_STARS_EXPLAINER}
                </p>
              )
            )}
            {kind === "bonus" && (
              <div>
                <Label>Stars for claiming it</Label>
                <Input type="number" min={0} value={points}
                  onChange={e => setPoints(Math.max(0, parseInt(e.target.value) || 0))}
                  className="mt-1.5 w-24" data-testid="create-points" />
                <PointsSuggestionHint points={points} onPick={setPoints} />
                {points === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Worth 0 stars — no reward.
                  </p>
                )}
              </div>
            )}
            {/* No "No stars — this is just a task to check off." line: the
                kind picker this form is reached through already puts a "No
                stars" pill on the To-do and Inspiration cards, so this
                repeated it a screen later, in the place with the least room
                to spare. */}
            </div>

            {/* Say why the button is off. It was disabled with nothing on
                screen explaining the requirement, so the only signal that an
                assignee was needed was a greyed-out button. */}
            {needsAssigneeToEnable && (
              <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="create-needs-assignee">
                Pick who this is for above to continue.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="button" onClick={submit} disabled={pending || needsAssigneeToEnable} data-testid="create-submit">
                {pending
                  ? (isEdit ? "Saving…" : "Creating…")
                  : isEdit
                    ? "Save changes"
                    : multiMode
                      ? `Create ${multiCount || ""} ${KIND_META[kind].name.toLowerCase()}${multiCount === 1 ? "" : "s"}`.replace("  ", " ")
                        + (subCount ? ` · ${subCount} sub` : "")
                      : `Create ${KIND_META[kind].name.toLowerCase()}`
                        + (subCount ? ` · ${subCount} sub` : "")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    {gateDialog}
    </>
  );
}

function KindCard({ k, onPick }: { k: TaskKind; onPick: () => void }) {
  const m = KIND_META[k];
  const desc: Record<TaskKind, string> = {
    regular: "A job done on a set schedule — the days you pick each week.",
    target: "Done a set number of times per week or month — any days they like.",
    bonus: "Optional extra job anyone can grab for bonus stars.",
    todo: "A simple task to check off. Not worth stars.",
    inspiration: "An affirmation, Bible verse, memory verse, or mission to reflect on.",
  };
  const tint: Record<TaskKind, string> = {
    regular: "bg-blue-100 dark:bg-blue-950/40",
    target: "bg-violet-100 dark:bg-violet-950/40",
    bonus: "bg-amber-100 dark:bg-amber-950/40",
    todo: "bg-slate-100 dark:bg-slate-800/40",
    inspiration: "bg-teal-100 dark:bg-teal-950/40",
  };
  return (
    // Real (mouse/trackpad) hover only, via the (hover: hover) media
    // feature — plain `hover:` classes stay "stuck" on iOS after a tap
    // (the well-known iOS "sticky hover" quirk), which made whichever card
    // happened to be under the finger when this screen rendered (e.g. the
    // one under the "+" menu's "Create Chore" item) look like it was
    // already selected, even though nothing here is a toggle/selection at
    // all — each card is a one-shot pick. Touch devices report
    // `hover: none`, so this media-scoped variant never applies there.
    <button type="button" onClick={onPick} data-testid={`kind-${k}`}
      className="w-full text-left grid grid-cols-[44px_1fr] gap-3 items-start p-3 rounded-xl border border-border bg-background [@media(hover:hover)]:hover:border-muted-foreground/40 [@media(hover:hover)]:hover:bg-accent transition-colors">
      <span className={cn("w-11 h-11 rounded-xl grid place-items-center text-xl", tint[k])}>{m.emoji}</span>
      <span>
        <span className="flex items-center gap-2 flex-wrap">
          <b className="text-sm">{m.name}</b>
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
            m.earns ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400")}>
            {m.earns ? "Earns ⭐" : "No stars"}
          </span>
        </span>
        <span className="block text-xs text-muted-foreground mt-1">{desc[k]}</span>
      </span>
    </button>
  );
}
