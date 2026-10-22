import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore, ChoreCompletion, Meal } from "@workspace/shared-types";
import type { FamilyEvent } from "@/lib/familyEvents";
import { recentShoutoutsQuery, type DailyContentAssignment, type DailyContentItem, type Shoutout } from "@/components/recent-shoutouts-card";
import { type NewsletterGroup, dinnerName, driverNamesFor, drivesOnHomeDay, eventsOnHomeDay, forecastFor, forPeople, homeBirthdayLine, horizonBirthdays, horizonDatedTodos, horizonMail, horizonWithoutChecked, mailClockParts, mailKeyDates, mailOffCalendar, mailVisibleToKid, clearedTodos, newsletterGroups, newsletterRowIds, notesForHome, PLAN_KEY_DATES, PLAN_NEWSLETTERS, PLAN_TODO_FOLD, planTodoRows, plainEventDetail, praiseForHome, schoolEmailNames, schoolSlipsHeldOnHome, todosForHome } from "@/lib/homeDay";
import { type CombinedLetters, type NewsletterGrouping, EMPTY_GROUPING, combineNewsletters, combineRows, declinePair, renameRow, separateRow } from "@/lib/newsletterGroups";
import { pointsProfileId } from "@/lib/chatTools";
import { confirmDialog } from "@/lib/confirmDialog";
import { hapticLight } from "@/lib/haptics";
import { fromStoppedSender, slipSender, slipSenderName } from "@/lib/slipMail";
import { ownerFixes, teachSender, type OwnerPerson } from "@/lib/mailOwners";
import { KIND_PREFIX, kindKeptOut, mailKindsOf, stoppedKinds, type MailKindId } from "@/lib/mailKinds";
import { toast } from "@/hooks/use-toast";
import { readCollapsed, saveCollapsed, type CardConfig, type HomeCardId } from "./registry";

export type Person = { id: string; name: string; color?: string | null; school?: string | null; isChild?: boolean | null; role?: string | null; connected?: boolean };

export type HomeDayProps = {
  chores: Chore[];
  completions: ChoreCompletion[];
  events: FamilyEvent[];
  /** This device's card order and on/off, from Customize Home Page. */
  cards?: CardConfig[];
  selectedIds: string[];
  familyIds: string[];
  day: Date;
  kidName?: string | null;
  personId?: string | null;
  people?: Person[];
  onAddTodo?: () => void;
  onEditTodo?: (chore: Chore) => void;
  onDeleteTodo?: (chore: Chore) => void;
  onOpenCalendar?: () => void;
  onOpenEvent?: (eventId: string) => void;
  onShiftDay?: (by: number) => void;
  onRefresh?: () => void;
  /** `failing` names each source whose events could not be fetched. */
  calendarStatus?: { connected: boolean; failing: string[] };
  onOpenCalendarSettings?: () => void;
  familyProfileId?: string | null;
  /** The All Family profile's color, for anything that is for everyone. */
  familyColor?: string | null;
  /** Bumped to open Notes & Praise, for a praise or note push. */
  openNotesKey?: number;
};

export type Letters = CombinedLetters<Chore>;
export type SheetState = { chore: Chore; mode: "actions" | "snooze" | "source" | "letter" | "issues"; keyDate?: boolean; letters?: Letters };

const SNOOZE_KEY = "superhub_home_snooze";
const TICK_MS = 60_000;
/** How long a ticked to-do stays in place, green, before it moves into Done. */
export const CHECK_HOLD_MS = 600;
/** How long a date just added to the calendar stays in Key Dates. */
export const KEY_DATE_ADDED_MS = 60_000;
const CHORES_KEY = ["/api/chores"];

function readSnooze(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useHomeDay(props: HomeDayProps) {
  const { chores: allChores, completions, events, selectedIds, familyIds, day, kidName, people = [], familyProfileId = null, familyColor = null, openNotesKey = 0, onDeleteTodo } = props;
  const reduced = useReducedMotion() === true;
  // Rows removed here, and senders stopped here, stay gone even when a refresh
  // that started before the server finished brings them back for a moment —
  // removed cards used to vanish, reappear, then vanish again (2026-10-19).
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [stopping, setStopping] = useState<string[]>([]);
  // Senders stopped on this phone when the server couldn't save them. Home
  // hides their mail either way, and saving is tried again on the next visit.
  const [localSenders, setLocalSenders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_SENDERS_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const keepLocalSenders = (next: string[]) => {
    setLocalSenders(next);
    try { localStorage.setItem(LOCAL_SENDERS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const chores = gone.size === 0 ? allChores : allChores.filter((chore) => !gone.has(chore.id));
  const [showAllTodos, setShowAllTodos] = useState(false);
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const [showAllHorizon, setShowAllHorizon] = useState(false);
  const [showAllLetters, setShowAllLetters] = useState(false);
  const [kept, setKept] = useState<Record<string, string>>({});
  // A date added to the calendar stays a minute, green at the bottom of Key
  // Dates so the add is plain and can be undone, then leaves (2026-10-22).
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const keptIds = Object.keys(kept).join(",");
  useEffect(() => {
    const ids = keptIds.split(",").filter((id) => id && !settled.has(id));
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => setSettled((current) => new Set([...current, ...ids])), KEY_DATE_ADDED_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptIds]);
  const [snooze, setSnooze] = useState<Record<string, number>>(readSnooze);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [holding, setHolding] = useState<Set<string>>(() => new Set());
  const holdTimers = useRef(new Map<string, number>());
  useEffect(() => () => holdTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const release = (id: string) => {
    const timer = holdTimers.current.get(id);
    if (timer != null) window.clearTimeout(timer);
    holdTimers.current.delete(id);
    setHolding((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const isCollapsed = (id: HomeCardId) => collapsed.has(id);
  // A praise or note push opens Notes & Praise even if it was left folded.
  useEffect(() => {
    if (!openNotesKey) return;
    setCollapsed((current) => {
      if (!current.has("notes")) return current;
      const next = new Set(current);
      next.delete("notes");
      saveCollapsed(next);
      return next;
    });
  }, [openNotesKey]);
  const toggleCard = (id: HomeCardId) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveCollapsed(next);
  };
  const hidden = (id: string) => (snooze[id] ?? 0) > Date.now();
  const snoozeItem = (id: string, until: number | null) => {
    if (until == null) return;
    const next = { ...snooze, [id]: until };
    setSnooze(next);
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    setSheet(null);
    setRevealed(null);
  };
  const now = new Date();
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const { data: calendarSettings } = useQuery<{ shareOriginals?: boolean | null; familyCalendarId?: string | null; mutedNewsletters?: string[] | null; mutedSenders?: string[] | null; dismissedSlipKeys?: string[] | null; newsletterGrouping?: NewsletterGrouping | null }>({
    queryKey: ["/api/calendar-settings"],
  });
  const { data: celebrations = [] } = useQuery<{ name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[]>({
    queryKey: ["/api/celebrations"],
  });
  const { data: meals = [] } = useQuery<Meal[]>({
    queryKey: ["/api/meals", dayKey, dayKey],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals?start=${dayKey}&end=${dayKey}`);
      return res.json();
    },
  });
  const { data: weather } = useQuery<{ high: number; low: number; condition: string; days?: { date: string; high: number; low: number; condition: string }[] }>({
    queryKey: ["/api/weather"],
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const { data: praiseList = [] } = useQuery<Shoutout[]>(recentShoutoutsQuery);
  const { data: dailyContent = [] } = useQuery<DailyContentItem[]>({ queryKey: ["/api/daily-content"] });
  const { data: contentAssignments = [] } = useQuery<DailyContentAssignment[]>({ queryKey: ["/api/daily-content-assignments"] });

  // Rows leave the list the moment they're acted on, so they can slide away;
  // the server's answer then confirms it, or the list is put back.
  const dropChores = async (keep: (chore: Chore) => boolean) => {
    const dropped = (queryClient.getQueryData<Chore[]>(CHORES_KEY) ?? allChores).filter((chore) => !keep(chore)).map((chore) => chore.id);
    setGone((current) => new Set([...current, ...dropped]));
    await queryClient.cancelQueries({ queryKey: CHORES_KEY });
    const prev = queryClient.getQueryData<Chore[]>(CHORES_KEY);
    queryClient.setQueryData<Chore[]>(CHORES_KEY, (old = []) => old.filter(keep));
    return { prev, dropped };
  };
  const restoreChores = (context?: { prev?: Chore[] }) => {
    if (context?.prev) queryClient.setQueryData(CHORES_KEY, context.prev);
  };
  /** When the server only skipped future mail, delete the open rows that already left Home. */
  const removeLeftovers = async (removedByServer: boolean, context?: { dropped?: string[] }) => {
    if (removedByServer || !context?.dropped?.length) return;
    await Promise.all(context.dropped.map((id) => apiRequest("DELETE", `/api/chores/${id}`).catch(() => null)));
  };
  const settleInbox = async () => {
    await queryClient.invalidateQueries({ queryKey: CHORES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
  };
  // A removal the server answered with an error often went through anyway,
  // and putting the row straight back made it vanish, return, then vanish
  // again (2026-10-19). Rows stay gone until a fresh list says otherwise.
  const settleDrop = async (failed: boolean, context?: { dropped?: string[] }) => {
    await settleInbox();
    if (!context?.dropped?.length) return;
    const back = new Set(context.dropped);
    setGone((current) => new Set([...current].filter((id) => !back.has(id))));
    const list = queryClient.getQueryData<Chore[]>(CHORES_KEY) ?? [];
    if (failed && list.some((chore) => back.has(chore.id))) {
      toast({ title: "Couldn't remove that", description: "Check your connection and try again." });
    }
  };
  const stopEmails = useMutation({
    mutationFn: async (address: string) => {
      let body: { removed?: number } = {};
      try {
        const res = await apiRequest("POST", "/api/ingest/mute", { address });
        body = await res.json().catch(() => ({})) as { removed?: number };
      } catch {
        // A failed save used to put every item straight back (2026-10-19).
        const from = address.toLowerCase();
        setLocalSenders((current) => {
          const next = current.includes(from) ? current : [...current, from];
          try { localStorage.setItem(LOCAL_SENDERS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
          return next;
        });
      }
      // A server that only skips future mail leaves the open items behind,
      // and they came straight back on the next refresh (2026-10-19). When it
      // doesn't say it removed them, remove them here.
      return typeof body.removed === "number";
    },
    onMutate: (address) => {
      const from = address.toLowerCase();
      setStopping((current) => current.includes(from) ? current : [...current, from]);
      const done = new Set(completions.map((completion) => completion.choreId));
      return dropChores((chore) => !(chore.category === "school_email" && !done.has(chore.id) && slipSender(chore.description)?.toLowerCase() === from));
    },
    // The rows to delete come from the list as it was before they left Home.
    onSuccess: (removedByServer, _address, context) => removeLeftovers(removedByServer, context),
    onError: (_error, address) => setStopping((current) => current.filter((item) => item !== address.toLowerCase())),
    onSettled: async (_data, error, _address, context) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
      await settleDrop(!!error, context);
    },
  });
  const savedSenders = calendarSettings?.mutedSenders;
  useEffect(() => {
    if (!savedSenders || localSenders.length === 0) return;
    const saved = new Set(savedSenders.map((address) => address.toLowerCase()));
    const unsaved = localSenders.filter((address) => !saved.has(address));
    if (unsaved.length < localSenders.length) keepLocalSenders(unsaved);
    if (unsaved.length === 0) return;
    void Promise.all(unsaved.map((address) => apiRequest("POST", "/api/ingest/mute", { address }).then(() => address, () => null)))
      .then((done) => {
        if (done.some(Boolean)) void queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
      });
  // Once per visit to Home, when the saved list first arrives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!savedSenders]);
  // Kinds of email turned off on this phone when the server couldn't save
  // them (one from before kinds existed). Home hides them either way.
  const [localKinds, setLocalKinds] = useState<MailKindId[]>(() => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KINDS_KEY) ?? "[]") as MailKindId[]; } catch { return []; }
  });
  const keepLocalKinds = (next: MailKindId[]) => {
    setLocalKinds(next);
    try { localStorage.setItem(LOCAL_KINDS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  // Email filters: a Home panel for what Home skips from every sender. It
  // sat in one item's menu, where it read as a choice about that email, then
  // in Settings, where nobody would find it (2026-10-20).
  const [filtersOpen, setFiltersOpen] = useState(false);
  type MailSettings = { mutedSenders?: string[] | null; dismissedSlipKeys?: string[] | null; newsletterGrouping?: NewsletterGrouping | null } | undefined;
  const editSettings = (change: (old: NonNullable<MailSettings>) => NonNullable<MailSettings>) =>
    queryClient.setQueryData<MailSettings>(["/api/calendar-settings"], (old) => (old ? change(old) : old));
  /** Turn a kind off (skip it from every sender, and clear its open items) or back on (future mail only). */
  const setKind = useMutation({
    mutationFn: async ({ kind, off }: { kind: MailKindId; off: boolean }) => {
      if (!off) {
        keepLocalKinds(localKinds.filter((item) => item !== kind));
        await apiRequest("POST", "/api/ingest/unmute-kind", { kind }).catch(() => null);
        return;
      }
      try {
        await apiRequest("POST", "/api/ingest/mute-kind", { kind });
      } catch {
        // A server from before kinds: this phone keeps it, and Home hides it.
        keepLocalKinds([...new Set([...localKinds, kind])]);
      }
    },
    onMutate: ({ kind, off }) => {
      const key = `${KIND_PREFIX}${kind}`;
      editSettings((old) => {
        const kept = (old.dismissedSlipKeys ?? []).filter((item) => item !== key);
        return { ...old, dismissedSlipKeys: off ? [...kept, key] : kept };
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
      await queryClient.invalidateQueries({ queryKey: CHORES_KEY });
    },
  });
  /** Undo Stop emails for a sender. Only their future email comes back. */
  const resumeSender = useMutation({
    mutationFn: async (address: string) => {
      const from = address.toLowerCase();
      keepLocalSenders(localSenders.filter((item) => item !== from));
      setStopping((current) => current.filter((item) => item !== from));
      await apiRequest("POST", "/api/ingest/unmute", { address });
    },
    onMutate: (address) => editSettings((old) => ({ ...old, mutedSenders: (old.mutedSenders ?? []).filter((item) => item.toLowerCase() !== address.toLowerCase()) })),
    onError: () => toast({ title: "Couldn't undo that", description: "Check your connection and try again." }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] }),
  });
  const hideLetters = useMutation({
    // A combined row stops every newsletter in it.
    mutationFn: async (letters: Letters) => {
      for (const member of letters.members) {
        if (member.sender) await apiRequest("POST", "/api/ingest/newsletter/hide", { address: member.sender, name: member.muteName });
      }
    },
    onMutate: (letters) => {
      const ids = new Set(letters.issues.map((issue) => issue.id));
      return dropChores((chore) => !ids.has(chore.id));
    },
    onSettled: async (_data, error, _letters, context) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
      await settleDrop(!!error, context);
    },
  });
  const saveSchool = useMutation({
    mutationFn: async (offer: { profileId: string; school: string }) => {
      await apiRequest("POST", "/api/ingest/school", offer);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
    },
  });
  const removeItem = useMutation({
    mutationFn: async (chore: Chore) => {
      await apiRequest("POST", "/api/ingest/not-relevant", { title: chore.title });
    },
    onMutate: (chore) => dropChores((item) => item.id !== chore.id),
    onSettled: (_data, error, _chore, context) => settleDrop(!!error, context),
  });
  const profileFor = (choreId: string) => {
    const chore = chores.find((item) => item.id === choreId);
    return pointsProfileId(chore?.profileIds ?? [], selectedIds.join(",")) || completions.find((item) => item.choreId === choreId)?.profileId || "";
  };
  const complete = useMutation({
    mutationFn: async (choreId: string) => {
      const chore = chores.find((item) => item.id === choreId);
      const profileId = profileFor(choreId);
      if (!profileId) return;
      const at = new Date();
      const localDayStart = new Date(at);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("POST", "/api/chore-completions", {
        choreId,
        profileId,
        points: chore?.points ?? 0,
        completedAt: at.toISOString(),
        localDayStart: localDayStart.toISOString(),
      });
    },
    onMutate: async (choreId) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      hapticLight();
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      const points = chores.find((item) => item.id === choreId)?.points ?? 0;
      const temp = { id: `temp-${Date.now()}`, choreId, profileId, points, completedAt: new Date() } as ChoreCompletion;
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) => [...old, temp]);
      return { prev };
    },
    onError: (_error, _choreId, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/chore-completions"], context.prev);
    },
    onSuccess: async (_data, choreId) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      const profileId = profileFor(choreId);
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });
  const undo = useMutation({
    mutationFn: async (choreId: string) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      await apiRequest("DELETE", `/api/chore-completions/${choreId}/${profileId}`);
    },
    onMutate: async (choreId) => {
      const profileId = profileFor(choreId);
      if (!profileId) return;
      await queryClient.cancelQueries({ queryKey: ["/api/chore-completions"] });
      const prev = queryClient.getQueryData<ChoreCompletion[]>(["/api/chore-completions"]);
      queryClient.setQueryData<ChoreCompletion[]>(["/api/chore-completions"], (old = []) =>
        old.filter((item) => !(item.choreId === choreId && item.profileId === profileId)));
      return { prev };
    },
    onError: (_error, _choreId, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/chore-completions"], context.prev);
    },
    onSuccess: async (_data, choreId) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      const profileId = profileFor(choreId);
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });
  const assign = useMutation({
    mutationFn: async (change: { choreId: string; profileIds: string[] }) => {
      await apiRequest("PATCH", `/api/chores/${change.choreId}`, { profileIds: change.profileIds });
    },
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: CHORES_KEY });
      const prev = queryClient.getQueryData<Chore[]>(CHORES_KEY);
      queryClient.setQueryData<Chore[]>(CHORES_KEY, (old = []) =>
        old.map((chore) => (chore.id === change.choreId ? { ...chore, profileIds: change.profileIds } : chore)));
      return { prev };
    },
    onError: (_error, _change, context) => restoreChores(context),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: CHORES_KEY });
    },
  });
  // Who each email to-do belongs to. Profiles carry what the family taught the
  // app ("Mail from x is for Mom."); rows still on everyone move to the people
  // their note names. A row picked by hand is never moved again.
  const { data: ownerProfiles = [] } = useQuery<(OwnerPerson & { isAllFamilyProfile?: boolean | null; isActive?: boolean | null })[]>({ queryKey: ["/api/profiles"] });
  const owners = ownerProfiles.filter((person) => !person.isAllFamilyProfile && person.isActive !== false);
  const [handPicked, setHandPicked] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HAND_PICKED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const fixing = useRef(new Set<string>());
  const fixes = owners.length > 0 ? ownerFixes(chores, owners, slipSender, handPicked).filter((fix) => !fixing.current.has(fix.id)) : [];
  const fixKey = fixes.map((fix) => `${fix.id}:${fix.profileIds.join("+")}`).join(",");
  useEffect(() => {
    if (fixes.length === 0) return;
    fixes.forEach((fix) => fixing.current.add(fix.id));
    void Promise.all(fixes.map((fix) => apiRequest("PATCH", `/api/chores/${fix.id}`, { profileIds: fix.profileIds }).catch(() => null)))
      .then(() => queryClient.invalidateQueries({ queryKey: CHORES_KEY }))
      .finally(() => fixes.forEach((fix) => fixing.current.delete(fix.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey]);
  /** Hand a to-do to someone, and when it came from an email, send that sender's mail to them from now on. */
  const reassign = (todo: Chore, ids: string[]) => {
    assign.mutate({ choreId: todo.id, profileIds: ids });
    const picked = new Set(handPicked).add(todo.id);
    setHandPicked(picked);
    try { localStorage.setItem(HAND_PICKED_KEY, JSON.stringify([...picked].slice(-500))); } catch { /* private mode */ }
    const sender = todo.category === "school_email" ? slipSender(todo.description) : null;
    if (!sender || owners.length === 0) return;
    const changes = teachSender(sender, ids, owners);
    if (changes.length === 0) return;
    void Promise.all(changes.map((change) => apiRequest("PATCH", `/api/profiles/${change.id}`, { facts: change.facts })))
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        const names = owners.filter((person) => ids.includes(person.id)).map((person) => person.name);
        toast({
          title: names.length > 0 ? `Mail from ${sender} goes to ${names.join(" and ")} from now on` : `Mail from ${sender} won't go to anyone in particular`,
          description: "You can change this in each person's settings.",
        });
      })
      .catch(() => toast({ title: "Couldn't remember that sender", description: "This to-do moved, but new mail from them may not." }));
  };
  // The whole arrangement is saved each time; the change shows at once.
  const saveGrouping = useMutation({
    mutationFn: async (next: NewsletterGrouping) => {
      await apiRequest("PATCH", "/api/calendar-settings/newsletter-grouping", next);
    },
    onMutate: (next) => editSettings((old) => ({ ...old, newsletterGrouping: next })),
    onError: () => toast({ title: "Couldn't save that", description: "Check your connection and try again." }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] }),
  });
  const currentGrouping = () => queryClient.getQueryData<{ newsletterGrouping?: NewsletterGrouping | null }>(["/api/calendar-settings"])?.newsletterGrouping ?? EMPTY_GROUPING;
  const combineLetters = (rows: Letters[], name: string | null = null) => saveGrouping.mutate(combineRows(currentGrouping(), rows, name, newGroupId()));
  const renameLetters = (row: Letters, name: string) => saveGrouping.mutate(renameRow(currentGrouping(), row, name.trim(), newGroupId()));
  const separateLetters = (row: Letters) => saveGrouping.mutate(separateRow(currentGrouping(), row));
  const declineLetters = (pair: string) => saveGrouping.mutate(declinePair(currentGrouping(), pair));
  /** Hand every issue of a newsletter to someone; each sender's later issues follow. */
  const reassignLetters = (letters: Letters, ids: string[]) => {
    const firsts = letters.members.map((member) => member.issues[0]).filter(Boolean);
    if (firsts.length === 0) return;
    firsts.forEach((issue) => reassign(issue, ids));
    const leads = new Set(firsts.map((issue) => issue.id));
    const rest = letters.issues.filter((issue) => !leads.has(issue.id));
    if (rest.length === 0) return;
    rest.forEach((issue) => assign.mutate({ choreId: issue.id, profileIds: ids }));
    setHandPicked((current) => {
      const next = new Set([...current, ...rest.map((issue) => issue.id)]);
      try { localStorage.setItem(HAND_PICKED_KEY, JSON.stringify([...next].slice(-500))); } catch { /* private mode */ }
      return next;
    });
  };
  const removeTodo = useMutation({
    mutationFn: async (choreId: string) => {
      await apiRequest("DELETE", `/api/chores/${choreId}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    },
  });
  const addToCalendar = useMutation({
    mutationFn: async (body: { choreId: string; title: string; description: string | null; start: Date; end: Date; allDay: boolean; profileIds: string[] }) => {
      const res = await apiRequest("POST", "/api/events", {
        title: body.title,
        description: body.description,
        startTime: body.start.toISOString(),
        endTime: body.end.toISOString(),
        isAllDay: body.allDay,
        profileIds: body.profileIds,
        source: "school",
        calendarId: calendarSettings?.familyCalendarId ?? null,
      });
      const created = await res.json() as { id?: string };
      return { choreId: body.choreId, eventId: created.id ?? "" };
    },
    onSuccess: async (created) => {
      if (created.eventId) setKept((current) => ({ ...current, [created.choreId]: created.eventId }));
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
  });
  const removeFromCalendar = useMutation({
    mutationFn: async (change: { choreId: string; eventId: string }) => {
      await apiRequest("DELETE", `/api/events/${change.eventId}`);
      return change.choreId;
    },
    onSuccess: async (choreId) => {
      setKept((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    },
  });

  const stoppedSenders = [...(calendarSettings?.mutedSenders ?? []), ...stopping, ...localSenders];
  const kindsOff = [...new Set([...stoppedKinds(calendarSettings?.dismissedSlipKeys), ...localKinds])];
  const visibleChores = todosForHome(chores, selectedIds, familyIds, familyProfileId)
    .filter((todo) => !kidName || schoolEmailNames(todo, kidName))
    .filter((todo) => !fromStoppedSender(todo, stoppedSenders))
    .filter((todo) => todo.category !== "school_email" || !kindKeptOut(kindsOfChore(todo), kindsOff));
  const stillOpen = visibleChores.filter((todo) => !completions.some((completion) => completion.choreId === todo.id));
  const homeEvents = forPeople(events, selectedIds, familyIds, familyProfileId).filter((event) => mailVisibleToKid(event, kidName ?? null));
  const letterSources = newsletterGroups(stillOpen, now, calendarSettings?.mutedNewsletters ?? [])
    .map((letters) => ({ ...letters, issues: letters.issues.filter((issue) => !hidden(issue.id)) }))
    .filter((letters) => letters.issues.length > 0);
  const grouping = calendarSettings?.newsletterGrouping ?? EMPTY_GROUPING;
  const { letters: newsletters, suggestion: letterSuggestion } = combineNewsletters(
    letterSources,
    grouping,
    people.map((person) => person.school ?? "").filter(Boolean),
  );
  const keyDates = mailKeyDates(
    stillOpen,
    homeEvents.filter((event) => !Object.values(kept).includes(event.id)),
    now,
  )
    .filter((row) => !hidden(row.id) && !(settled.has(row.id) && kept[row.id]))
    // Added ones sink below the dates still to add; sort is stable, so each group keeps its date order.
    .sort((a, b) => Number(!!kept[a.id]) - Number(!!kept[b.id]));
  const heldIds = new Set([...newsletterRowIds(visibleChores, now), ...keyDates.map((row) => row.id)]);
  const todoRows = planTodoRows(visibleChores.filter((todo) => !heldIds.has(todo.id)), completions, day, now).filter((todo) => !hidden(todo.id));
  const dinner = dinnerName(meals, day);
  const birthday = homeBirthdayLine(celebrations, day);
  const todayEvents = eventsOnHomeDay(
    forPeople(events, selectedIds, familyIds, familyProfileId),
    day,
    kidName ?? null,
    dinner,
    schoolSlipsHeldOnHome(todosForHome(chores, selectedIds, familyIds, familyProfileId), completions, day),
  );
  const offCalendar = mailOffCalendar(stillOpen, homeEvents, day, now).filter((row) => !hidden(row.id));
  const drives = drivesOnHomeDay(events, day, selectedIds, kidName ?? null);
  const checkedSlips = todosForHome(chores, selectedIds, familyIds, familyProfileId).filter((todo) => todo.category === "school_email" && completions.some((completion) => completion.choreId === todo.id));
  const horizon = horizonWithoutChecked(homeEvents, day, checkedSlips);
  const comingEvents = [
    ...horizonBirthdays(celebrations, day).map((row) => ({ key: row.id, title: row.title, startTime: row.startTime as Date | string, allDay: true, location: null as string | null, drivers: [] as string[], calendarName: null as string | null, color: "#5E8FAD", eventId: "", profileIds: [] as string[], calendarColor: null as string | null })),
    ...horizon.map((event) => ({
      key: event.id,
      title: event.title,
      startTime: event.startTime,
      allDay: event.isAllDay === true,
      location: event.location ?? null,
      drivers: driverNamesFor(event.drivingProfileIds, people),
      calendarName: event.calendarName ?? null,
      color: event.color,
      eventId: event.id,
      profileIds: event.profileIds,
      calendarColor: event.calendarColor ?? null,
    })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const laterMail = horizonMail(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const laterTodos = horizonDatedTodos(stillOpen, homeEvents, day).filter((row) => !hidden(row.id));
  const allSelected = familyIds.length > 0 && familyIds.every((id) => selectedIds.includes(id));
  const everyone = selectedIds.length === 0 || allSelected;
  const praise = praiseForHome(praiseList, selectedIds, everyone, now);
  const notes = notesForHome(dailyContent, contentAssignments, selectedIds, everyone, familyProfileId, now);
  const messages = [...praise, ...notes].sort((a, b) => b.at.getTime() - a.at.getTime());
  const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name;
  const daysOut = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const todosTitle = daysOut === 0 ? "Today's To-dos" : daysOut === 1 ? "Tomorrow's To-dos" : `${day.toLocaleDateString("en-US", { weekday: "long" })}'s To-dos`;
  const scheduleTitle = daysOut === 0 ? "Today's Schedule" : "Schedule";
  const openTodos = todoRows.filter((todo) => !todo.done || holding.has(todo.id));
  const doneTodos = todoRows.filter((todo) => todo.done && !holding.has(todo.id)).sort((a, b) => {
    const at = (id: string) => completions
      .filter((completion) => completion.choreId === id && completion.completedAt)
      .reduce((latest, completion) => Math.max(latest, new Date(completion.completedAt ?? 0).getTime()), 0);
    return at(b.id) - at(a.id);
  });
  // To-dos past due before yesterday leave the list. The ones the person
  // hasn't been told about yet are counted in a note at the top of the card.
  const [clearedSeen, setClearedSeen] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CLEARED_SEEN_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const cleared = daysOut === 0
    ? clearedTodos(visibleChores.filter((todo) => !heldIds.has(todo.id)), completions, now).filter((todo) => !hidden(todo.id) && !clearedSeen.includes(todo.id))
    : [];
  const ackCleared = () => {
    const next = [...new Set([...clearedSeen, ...cleared.map((todo) => todo.id)])].slice(-200);
    setClearedSeen(next);
    try { localStorage.setItem(CLEARED_SEEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const folded = !showAllTodos && openTodos.length > PLAN_TODO_FOLD;
  const visibleTodos = folded ? openTodos.slice(0, PLAN_TODO_FOLD) : openTodos;
  const dayStamp = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  useEffect(() => {
    setShowAllTodos(false);
    setShowDoneTodos(false);
  }, [dayStamp]);
  const visibleKeys = showAllKeys ? keyDates : keyDates.slice(0, PLAN_KEY_DATES);
  const visibleNewsletters = showAllLetters ? newsletters : newsletters.slice(0, PLAN_NEWSLETTERS);
  const forecast = forecastFor(weather?.days, day) ?? (daysOut === 0 && weather ? { high: weather.high, low: weather.low, condition: weather.condition } : null);

  const placeMail = (todo: Chore, start: Date, allDay: boolean) => {
    const clock = mailClockParts(`${todo.title}\n${todo.description ?? ""}`);
    const at = new Date(start);
    const end = new Date(start);
    if (!allDay && clock) {
      at.setHours(clock.hours, clock.minutes, 0, 0);
      end.setTime(at.getTime() + 60 * 60 * 1000);
    } else {
      at.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
      end.setHours(0, 0, 0, 0);
    }
    addToCalendar.mutate({
      choreId: todo.id,
      title: todo.title,
      description: plainEventDetail(todo.description),
      start: at,
      end,
      allDay,
      profileIds: todo.profileIds ?? [],
    });
  };
  const askStopEmails = async (chore: Chore) => {
    const address = slipSender(chore.description);
    if (!address) return;
    const name = slipSenderName(chore.description) ?? address;
    const ok = await confirmDialog({
      title: `Stop emails from ${name}?`,
      description: `Their open items leave Home now, and their future email is skipped. You can undo this in Settings.`,
      confirmLabel: "Stop emails",
    });
    if (ok) stopEmails.mutate(address);
  };
  const askHideLetters = async (letters: Letters) => {
    if (!letters.sender) return;
    const ok = await confirmDialog({
      title: `Stop showing ${letters.name}?`,
      description: "Its issues leave Home now, and new ones are skipped. You can undo this in Settings.",
      confirmLabel: "Stop showing",
    });
    if (ok) hideLetters.mutate(letters);
  };
  /** An inbox item is removed for good; a to-do someone made is deleted the usual way. */
  const removeRow = (chore: Chore) => {
    setRevealed(null);
    setSheet(null);
    if (chore.category === "school_email") removeItem.mutate(chore);
    else if (onDeleteTodo) onDeleteTodo(chore);
    else removeTodo.mutate(chore.id);
  };
  const checkOff = (id: string) => {
    complete.mutate(id);
    if (reduced) return;
    release(id);
    setHolding((current) => new Set(current).add(id));
    holdTimers.current.set(id, window.setTimeout(() => release(id), CHECK_HOLD_MS));
  };
  const uncheck = (id: string) => {
    release(id);
    undo.mutate(id);
  };
  const colorPeople = [
    ...people,
    ...(familyProfileId ? [{ id: familyProfileId, name: "Everyone", color: familyColor, isAllFamilyProfile: true }] : []),
  ];

  return {
    props: { ...props, people, familyProfileId, familyColor },
    reduced,
    colorPeople,
    now,
    daysOut,
    todosTitle,
    scheduleTitle,
    calendarSettings,
    isCollapsed,
    toggleCard,
    showAllTodos, setShowAllTodos,
    showDoneTodos, setShowDoneTodos,
    showAllKeys, setShowAllKeys,
    showAllHorizon, setShowAllHorizon,
    showAllLetters, setShowAllLetters,
    kept,
    sheet, setSheet,
    revealed, setRevealed,
    snoozeItem,
    checkOff, uncheck, removeRow, askStopEmails, filtersOpen, setFiltersOpen, kindsOff, setKind, stoppedSenders, resumeSender,
    saveSchool, complete, undo, assign, reassign, removeTodo, removeItem, stopEmails, addToCalendar, removeFromCalendar,
    newsletters, visibleNewsletters, hideLetters, askHideLetters, reassignLetters,
    letterSuggestion, combineLetters, renameLetters, separateLetters, declineLetters,
    keyDates, visibleKeys,
    openTodos, doneTodos, folded, visibleTodos,
    cleared, ackCleared,
    dinner, birthday,
    todayEvents, offCalendar,
    drives,
    comingEvents, laterMail, laterTodos,
    messages, praise, notes, nameOf,
    forecast,
    placeMail,
  };
}

export type HomeModel = ReturnType<typeof useHomeDay>;

const CLEARED_SEEN_KEY = "superhub_cleared_todos_seen";

function newGroupId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
const HAND_PICKED_KEY = "superhub_todo_hand_picked";
const LOCAL_KINDS_KEY = "superhub_stopped_mail_kinds";
const LOCAL_SENDERS_KEY = "superhub_stopped_senders";

/** The kinds an inbox item's email was, read from its title and note. */
export function kindsOfChore(chore: { title: string; description?: string | null }): MailKindId[] {
  return mailKindsOf({ subject: chore.title, text: chore.description, from: slipSender(chore.description) });
}
