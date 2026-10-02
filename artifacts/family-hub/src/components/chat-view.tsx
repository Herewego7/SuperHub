import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { chatGoogleEvents, chatIcalEvents, chatOutlookEvents, googleChatWrite, googleDeleteChoice, googleMoveBody } from "@/lib/chatGoogle";
import type { Chore } from "@workspace/shared-types";
import { anniversaryReply, assignChange, birthdayReply, checkOffTitle, confirmedReply, createEventCast, createEventClock, createEventPlace, createEventTitle, createTodoTitle, dayReply, todoCreate, declinedReply, deleteEventAction, deleteEventTitle, driverChange, drivingReply, eventPeople, eventStaysPut, familyCalendarOffer, familyReply, feedbackNote, forgetFact, memoryFact, memoryReply, moveEventAction, moveEventWhen, muteAddress, newsletterTitles, notRelevantTitle, placeAnswer, placeChange, pointsProfileId, titleChange, rememberedFacts, reminderRequest, schoolFact, schoolReply, searchHits, selectedProfileIds, toolsForRole, unknownReply, weatherReply } from "@/lib/chatTools";
import { chatVisibleEvents, eventsForDayPlan, eventsForDrivingQuestion, openTodos, schoolEmailNames } from "@/lib/homeDay";
import { withoutUnwatched } from "@/lib/outlookAttribution";
import { dinnerReply, groceryAlreadyHave, groceryHaveAction } from "@/lib/mealCalendar";
import type { Meal } from "@workspace/shared-types";
import { appendUserMessage, noteChatUnread, readPendingConfirm, readThread, savePendingConfirm, threadWithPlan, type ChatBubble, type PendingConfirm } from "@/lib/chatThread";

const PLAN_KEY = "superhub_evening_plan";
const PENDING_KEY = "superhub_chat_pending";
const PLAN_REPLY_KEY = "superhub_evening_plan_reply";

export function stagePendingChat(text: string) {
  const trimmed = text.trim();
  if (!trimmed || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PENDING_KEY, trimmed);
}

export function stageEveningPlan(text: string, reply?: string | null, profileKey?: string | null) {
  sessionStorage.setItem(PLAN_KEY, text);
  const said = reply?.trim();
  if (said) sessionStorage.setItem(PLAN_REPLY_KEY, said);
  else sessionStorage.removeItem(PLAN_REPLY_KEY);
  noteChatUnread(profileKey || "*");
}

type Props = {
  profileKey: string;
  isChild: boolean;
  revision: number;
  profileReady: boolean;
  onSent: () => void;
};

export function ChatView({ profileKey, isChild, revision, profileReady, onSent }: Props) {
  const [draft, setDraft] = useState("");
  const storedConfirm = readPendingConfirm(profileKey);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(storedConfirm?.kind === "delete" ? storedConfirm.id : null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(storedConfirm?.kind === "delete" ? storedConfirm.path ?? null : null);
  const [pendingMove, setPendingMove] = useState<Extract<PendingConfirm, { kind: "move" }> | null>(storedConfirm?.kind === "move" ? storedConfirm : null);
  const storePending = (pending: PendingConfirm | null) => {
    savePendingConfirm(profileKey, pending);
    setPendingDeleteId(pending?.kind === "delete" ? pending.id : null);
    setPendingDeletePath(pending?.kind === "delete" ? pending.path ?? null : null);
    setPendingMove(pending?.kind === "move" ? pending : null);
  };
  const [bubbles, setBubbles] = useState<ChatBubble[]>(() => readThread(profileKey));
  const sentPending = useRef(false);
  useEffect(() => {
    if (!profileReady || typeof sessionStorage === "undefined") return;
    const plan = sessionStorage.getItem(PLAN_KEY);
    if (!plan) return;
    const reply = sessionStorage.getItem(PLAN_REPLY_KEY);
    sessionStorage.removeItem(PLAN_KEY);
    sessionStorage.removeItem(PLAN_REPLY_KEY);
    setBubbles((current) => {
      const next = threadWithPlan(current, plan, reply);
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      return next;
    });
  }, [profileReady, profileKey]);
  const tools = toolsForRole(isChild);
  const { data: chores = [], isFetched: choresFetched } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
  const { data: completions = [] } = useQuery<{ choreId: string; completedAt?: string | null }[]>({ queryKey: ["/api/chore-completions"] });
  const { data: groceries = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/grocery-items"] });
  const { data: mealGroceries = [] } = useQuery<{ name: string }[]>({
    queryKey: ["/api/grocery-list/aggregate", "chat"],
    queryFn: async () => {
      const start = new Date();
      const end = new Date();
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() + 7);
      const key = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const res = await apiRequest("GET", `/api/grocery-list/aggregate?start=${key(start)}&end=${key(end)}`);
      return res.json();
    },
  });
  const { data: events = [], isFetched: eventsFetched } = useQuery<{ id: string; title: string; description?: string | null; location?: string | null; source?: string | null; drivingProfileIds?: string[] | null; profileIds?: string[] | null; startTime?: string | null; endTime?: string | null; googleCalendarId?: string | null; outlookCalendarId?: string | null; category?: string | null; movedFrom?: string | null }[]>({ queryKey: ["/api/events"] });
  const { data: calendarAssignments = [] } = useQuery<{ calendarId: string; calendarType?: string; profileId?: string; audienceProfileIds?: string[] | null; watched?: boolean | null; isActive?: boolean | null }[]>({ queryKey: ["/api/calendar-assignments"] });
  const { data: profiles = [] } = useQuery<{ id: string; name: string; school?: string | null; facts?: string[] | null; isAllFamilyProfile?: boolean | null; googleCalendarConnected?: boolean | null; outlookCalendarConnected?: boolean | null; icalConnected?: boolean | null }[]>({ queryKey: ["/api/profiles"] });
  const googleProfiles = profiles.filter((profile) => profile.googleCalendarConnected && !profile.isAllFamilyProfile);
  const outlookProfiles = profiles.filter((profile) => profile.outlookCalendarConnected && !profile.isAllFamilyProfile);
  const icalProfiles = profiles.filter((profile) => profile.icalConnected && !profile.isAllFamilyProfile);
  const externalQueries = useQueries({
    queries: [
      ...googleProfiles.map((profile) => ({
        queryKey: ["/api/google-calendar/events", profile.id],
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        staleTime: 60_000,
      })),
      ...outlookProfiles.map((profile) => ({
        queryKey: ["/api/outlook-calendar/events", profile.id],
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        staleTime: 60_000,
      })),
      ...icalProfiles.map((profile) => ({
        queryKey: ["/api/ical-calendar/events", profile.id],
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        staleTime: 60_000,
      })),
    ],
  });
  const knownEvents = useMemo(() => {
    const googleData = externalQueries.slice(0, googleProfiles.length);
    const outlookData = externalQueries.slice(googleProfiles.length, googleProfiles.length + outlookProfiles.length);
    const icalData = externalQueries.slice(googleProfiles.length + outlookProfiles.length);
    const assignments = calendarAssignments.filter((assignment): assignment is typeof assignment & { calendarType: string; profileId: string } => !!assignment.calendarType && !!assignment.profileId);
    return [
      ...events,
      ...chatGoogleEvents(googleProfiles.map((profile, index) => ({
        profileId: profile.id,
        events: googleData[index]?.data as unknown[] | null | undefined,
      }))),
      ...chatOutlookEvents(
        outlookProfiles.map((profile, index) => ({
          profileId: profile.id,
          events: outlookData[index]?.data as unknown[] | null | undefined,
        })),
        assignments,
        profiles.map((profile) => profile.id),
      ),
      ...chatIcalEvents(icalProfiles.map((profile, index) => ({
        profileId: profile.id,
        events: icalData[index]?.data as unknown[] | null | undefined,
      }))),
    ];
  }, [calendarAssignments, events, externalQueries, googleProfiles, icalProfiles, outlookProfiles, profiles]);
  const { data: weather } = useQuery<{ location?: string; temperature?: number; condition?: string }>({ queryKey: ["/api/weather"], retry: false });
  const { data: calendarSettings } = useQuery<{ familyCalendarId?: string | null }>({ queryKey: ["/api/calendar-settings"] });
  const { data: celebrations = [], isFetched: celebrationsFetched } = useQuery<{ name: string; monthDay: string; year?: number | null; type?: string | null; customLabel?: string | null }[]>({ queryKey: ["/api/celebrations"] });
  const { data: meals = [], isFetched: mealsFetched } = useQuery<Meal[]>({
    queryKey: ["/api/meals", "chat-dinner"],
    queryFn: async () => {
      const start = new Date();
      const end = new Date();
      end.setDate(start.getDate() + 30);
      const key = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const res = await apiRequest("GET", `/api/meals?start=${key(start)}&end=${key(end)}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (!profileReady || !choresFetched || !eventsFetched || !mealsFetched || !celebrationsFetched || sentPending.current) return;
    if (typeof sessionStorage === "undefined") return;
    const pending = sessionStorage.getItem(PENDING_KEY);
    if (!pending) return;
    sentPending.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    send(pending, true);
  }, [profileReady, choresFetched, eventsFetched, mealsFetched, celebrationsFetched, profileKey]);

  const complete = useMutation({
    mutationFn: async (chore: Chore) => {
      const profileId = pointsProfileId(chore.profileIds, profileKey);
      if (!profileId) return;
      const at = new Date();
      const localDayStart = new Date(at);
      localDayStart.setHours(0, 0, 0, 0);
      await apiRequest("POST", "/api/chore-completions", {
        choreId: chore.id,
        profileId,
        points: chore.points ?? 0,
        completedAt: at.toISOString(),
        localDayStart: localDayStart.toISOString(),
      });
    },
    onSuccess: async (_data, chore) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
      const profileId = pointsProfileId(chore.profileIds, profileKey);
      if (profileId) await queryClient.invalidateQueries({ queryKey: ["/api/points", profileId] });
    },
  });

  function send(text: string, alreadyAppended = false) {
    const next = alreadyAppended ? readThread(profileKey) : appendUserMessage(profileKey, text);
    if (!next) return;
    const replyAfter = (request: Promise<unknown>, ok: string, remount = false) => {
      setBubbles(next);
      setDraft("");
      void request
        .then(() => {
          const saved = [...next, { id: `${Date.now()}-ok`, role: "assistant" as const, text: ok }];
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(saved));
          if (remount) onSent();
          else setBubbles(saved);
        })
        .catch(() => {
          const failed = [...next, { id: `${Date.now()}-ok`, role: "assistant" as const, text: "I couldn't save that yet." }];
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(failed));
          if (remount) onSent();
          else setBubbles(failed);
        });
    };
    if ((pendingDeleteId || pendingMove) && declinedReply(text)) {
      storePending(null);
      next.push({ id: `${Date.now()}-n`, role: "assistant", text: "Left it where it is." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    if (pendingDeleteId && confirmedReply(text)) {
      const id = pendingDeleteId;
      storePending(null);
      replyAfter(
        apiRequest("DELETE", pendingDeletePath ?? `/api/events/${id}`).then(() => {
          void queryClient.invalidateQueries({ queryKey: pendingDeletePath ? ["/api/google-calendar/events"] : ["/api/events"] });
        }),
        "Deleted.",
        true,
      );
      return;
    }
    if (pendingMove && confirmedReply(text)) {
      const move = pendingMove;
      storePending(null);
      replyAfter(
        apiRequest("PATCH", `/api/events/${move.id}`, { startTime: move.start, endTime: move.end }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        "Moved.",
        true,
      );
      return;
    }
    if (tools.includes("send_feedback") && feedbackNote(text)) {
      next.push({ id: `${Date.now()}-b`, role: "assistant", text: "I can't send feedback yet." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const selectedIds = profileKey.split(",").filter((id) => id && id !== "family");
    const kid = isChild ? profiles.find((profile) => selectedIds.includes(profile.id)) : undefined;
    const watchedEvents = withoutUnwatched(knownEvents, calendarAssignments);
    const talkEvents = chatVisibleEvents(knownEvents, calendarAssignments, selectedIds, kid?.name ?? null);
    const talkChores = chores.filter((item) => !kid || schoolEmailNames(item, kid.name));
    const title = checkOffTitle(text);
    const titled = title ? talkChores.filter((item) => item.title.toLowerCase() === title.toLowerCase()) : [];
    const chore = titled.find((item) => item.taskType !== "todo") ?? titled[0];
    if (chore && tools.includes("complete_task") && pointsProfileId(chore.profileIds ?? [], profileKey)) {
      replyAfter(complete.mutateAsync(chore), `Checked off ${chore.title}.`);
      return;
    }
    const forgotten = isChild ? null : forgetFact(text, profiles);
    if (forgotten && tools.includes("remember_fact")) {
      if ("reply" in forgotten) {
        next.push({ id: `${Date.now()}-s`, role: "assistant", text: forgotten.reply });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      replyAfter(
        apiRequest("PATCH", `/api/profiles/${forgotten.profileId}`, { facts: forgotten.facts }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        }),
        `Forgot ${forgotten.name} ${forgotten.fact}.`,
      );
      return;
    }
    const memory = isChild ? null : memoryFact(text, profiles);
    if (memory && tools.includes("remember_fact")) {
      const existing = profiles.find((person) => person.id === memory.profileId)?.facts ?? [];
      if (existing.some((item) => item.toLowerCase() === memory.fact.toLowerCase())) {
        next.push({ id: `${Date.now()}-s`, role: "assistant", text: `I already remember ${memory.name} ${memory.fact}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      replyAfter(
        apiRequest("PATCH", `/api/profiles/${memory.profileId}`, { facts: rememberedFacts(existing, memory.fact) }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        }),
        `I'll remember ${memory.name} ${memory.fact}.`,
      );
      return;
    }
    const remembered = memoryReply(text, profiles);
    if (remembered) {
      next.push({ id: `${Date.now()}-s`, role: "assistant", text: remembered });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const fact = isChild ? null : schoolFact(text, profiles);
    if (fact && tools.includes("remember_fact")) {
      replyAfter(
        apiRequest("PATCH", `/api/profiles/${fact.profileId}`, { school: fact.school }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        }),
        `Saved ${fact.name}'s school as ${fact.school}.`,
      );
      return;
    }
    if (/^when(?:'s| is)\s+(?:the next birthday|.+?['’]s birthday|our anniversary|the next anniversary|.+?['’]s anniversary)\??$/i.test(text.trim())) {
      const sayBirthday = (rows: { name: string; monthDay: string; year?: number | null; type?: string | null }[]) =>
        birthdayReply(text, rows, new Date()) ?? anniversaryReply(text, rows, new Date()) ?? "I don't have that saved.";
      if (celebrationsFetched) {
        next.push({ id: `${Date.now()}-b`, role: "assistant", text: sayBirthday(celebrations) });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      setBubbles(next);
      setDraft("");
      void queryClient.fetchQuery({ queryKey: ["/api/celebrations"] }).then((rows) => {
        const saved = [...next, { id: `${Date.now()}-b`, role: "assistant" as const, text: sayBirthday(rows as { name: string; monthDay: string; year?: number | null; type?: string | null }[]) }];
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(saved));
        setBubbles(saved);
      }).catch(() => {
        const failed = [...next, { id: `${Date.now()}-b`, role: "assistant" as const, text: "I couldn't look up birthdays yet." }];
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(failed));
        setBubbles(failed);
      });
      return;
    }
    const school = schoolReply(text, profiles, kid?.name ?? profiles.find((profile) => selectedIds.length === 1 && profile.id === selectedIds[0])?.name);
    if (school) {
      next.push({ id: `${Date.now()}-h`, role: "assistant", text: school });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const family = tools.includes("get_profile") ? familyReply(text, profiles) : null;
    if (family) {
      next.push({ id: `${Date.now()}-f`, role: "assistant", text: family });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const place = tools.includes("maps_link") ? placeAnswer(text, events, calendarAssignments, selectedIds, kid?.name ?? null) : null;
    if (place) {
      next.push({ id: `${Date.now()}-o`, role: "assistant", text: place });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const driving = drivingReply(text, eventsForDrivingQuestion(knownEvents, calendarAssignments, selectedIds, kid?.name ?? null), profiles);
    if (driving) {
      next.push({ id: `${Date.now()}-r`, role: "assistant", text: driving });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const selfName = selectedIds.length === 1
      ? profiles.find((profile) => profile.id === selectedIds[0])?.name ?? null
      : null;
    const drivingChange = tools.includes("update_event") ? driverChange(text, profiles, selfName) : null;
    if (drivingChange) {
      const target = talkEvents.find((event) => event.title.toLowerCase() === drivingChange.title.toLowerCase());
      if (!target) {
        next.push({ id: `${Date.now()}-r`, role: "assistant", text: `I don't see ${drivingChange.title}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      if (!("profileIds" in drivingChange)) {
        next.push({ id: `${Date.now()}-r`, role: "assistant", text: drivingChange.reply });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const stays = target.source === "google" ? null : eventStaysPut(target.source, target.id);
      if (stays) {
        next.push({ id: `${Date.now()}-r`, role: "assistant", text: `${target.title} stays on ${stays}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const google = target as typeof target & { googleProfileId?: string; googleCalendarId?: string | null; googleEventId?: string; recurringEventId?: string | null };
      if (target.source === "google") {
        if (!google.googleProfileId || !google.googleCalendarId || !google.googleEventId) {
          next.push({ id: `${Date.now()}-r`, role: "assistant", text: `${target.title} stays on Google Calendar.` });
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
          setBubbles(next);
          setDraft("");
          return;
        }
        const path = googleChatWrite(google);
        if (!path) {
          next.push({ id: `${Date.now()}-r`, role: "assistant", text: `${target.title} stays on Google Calendar.` });
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
          setBubbles(next);
          setDraft("");
          return;
        }
        replyAfter(
          apiRequest("PATCH", path, {
            drivingProfileIds: drivingChange.profileIds,
            recurringEventId: google.recurringEventId ?? null,
          }).then(() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
          }),
          drivingChange.reply,
        );
        return;
      }
      const already = target.profileIds ?? [];
      const profileIds = already.length > 0 && drivingChange.profileIds.length > 0
        ? [...new Set([...already, ...drivingChange.profileIds])]
        : undefined;
      replyAfter(
        apiRequest("PATCH", `/api/events/${target.id}`, {
          drivingProfileIds: drivingChange.profileIds,
          ...(profileIds ? { profileIds } : {}),
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        drivingChange.reply,
      );
      return;
    }
    const planChores = talkChores.filter((chore) => {
      const people = chore.profileIds ?? [];
      return selectedIds.length === 0 || people.length === 0 || people.some((id) => selectedIds.includes(id));
    });
    const planEvents = eventsForDayPlan(knownEvents, calendarAssignments, selectedIds, kid?.name ?? null);
    const plan = tools.includes("get_plan")
      ? dayReply(text, {
          chores: planChores,
          events: planEvents.map((event) => ({
            ...event,
            drivers: (event.drivingProfileIds ?? [])
              .map((id) => profiles.find((person) => person.id === id)?.name)
              .filter((name): name is string => !!name),
          })),
          completions,
          meals,
          celebrations,
          day: new Date(),
        })
      : null;
    if (plan) {
      next.push({ id: `${Date.now()}-p`, role: "assistant", text: plan });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const dinner = dinnerReply(text, meals, new Date());
    if (dinner) {
      next.push({ id: `${Date.now()}-d`, role: "assistant", text: dinner });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const removeTitle = deleteEventTitle(text);
    const target = removeTitle ? talkEvents.find((event) => event.title.toLowerCase() === removeTitle.toLowerCase()) : undefined;
    if (target && tools.includes("delete_event")) {
      const googleDelete = googleDeleteChoice(target);
      if (googleDelete === "confirm") {
        const path = googleChatWrite(target);
        if (path) {
          storePending({ kind: "delete", id: target.id, path });
          next.push({ id: `${Date.now()}-c`, role: "assistant", text: `Delete ${target.title}? It is on Google Calendar. Reply yes to delete it.` });
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
          setBubbles(next);
          setDraft("");
          return;
        }
      }
      const action = deleteEventAction(target.source, target.id);
      if (googleDelete === "keep" || action === "keep") {
        next.push({ id: `${Date.now()}-c`, role: "assistant", text: `${target.title} stays on ${eventStaysPut(target.source, target.id) ?? "Google Calendar"}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      } else if (action === "confirm") {
        storePending({ kind: "delete", id: target.id });
        next.push({ id: `${Date.now()}-c`, role: "assistant", text: `Delete ${target.title}? It came from outside the app. Reply yes to delete it.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      } else {
        storePending(null);
        replyAfter(
          apiRequest("DELETE", `/api/events/${target.id}`).then(() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          }),
          `Deleted ${target.title}.`,
        );
        return;
      }
    }
    const renaming = tools.includes("update_event") ? titleChange(text) : null;
    if (renaming) {
      const target = talkEvents.find((event) => event.title.toLowerCase() === renaming.title.toLowerCase());
      if (!target) {
        next.push({ id: `${Date.now()}-n`, role: "assistant", text: `I don't see ${renaming.title}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const stays = eventStaysPut(target.source, target.id);
      const googlePath = stays === "Google Calendar" ? googleChatWrite(target) : null;
      if (stays && !googlePath) {
        next.push({ id: `${Date.now()}-n`, role: "assistant", text: `${target.title} stays on ${stays}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      replyAfter(
        apiRequest("PATCH", googlePath ?? `/api/events/${target.id}`, { title: renaming.next }).then(() => {
          void queryClient.invalidateQueries({ queryKey: googlePath ? ["/api/google-calendar/events"] : ["/api/events"] });
        }),
        `${target.title} is now ${renaming.next}.`,
      );
      return;
    }
    const placing = tools.includes("update_event") ? placeChange(text) : null;
    if (placing) {
      const target = talkEvents.find((event) => event.title.toLowerCase() === placing.title.toLowerCase());
      if (!target) {
        next.push({ id: `${Date.now()}-p`, role: "assistant", text: `I don't see ${placing.title}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const stays = eventStaysPut(target.source, target.id);
      const googlePath = stays === "Google Calendar" ? googleChatWrite(target) : null;
      if (stays && !googlePath) {
        next.push({ id: `${Date.now()}-p`, role: "assistant", text: `${target.title} stays on ${stays}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      replyAfter(
        apiRequest("PATCH", googlePath ?? `/api/events/${target.id}`, { location: placing.location }).then(() => {
          void queryClient.invalidateQueries({ queryKey: googlePath ? ["/api/google-calendar/events"] : ["/api/events"] });
        }),
        `${target.title} is at ${placing.location}.`,
      );
      return;
    }
    const moving = moveEventWhen(text);
    const moved = moving ? talkEvents.find((event) => event.title.toLowerCase() === moving.title.toLowerCase()) : undefined;
    if (moved && moving && tools.includes("update_event")) {
      const action = moveEventAction(moved.source, moved.id);
      const start = new Date(moved.startTime ?? Date.now());
      const end = moved.endTime ? new Date(moved.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
      const duration = Math.max(end.getTime() - start.getTime(), 60 * 60 * 1000);
      if (moving.on) start.setFullYear(moving.on.getFullYear(), moving.on.getMonth(), moving.on.getDate());
      if (moving.hours != null && moving.minutes != null) start.setHours(moving.hours, moving.minutes, 0, 0);
      const finish = new Date(start.getTime() + duration);
      if (action === "keep-google") {
        const path = googleChatWrite(moved);
        const body = googleMoveBody(moved, start, finish, moving.hours != null);
        if (body === "series") {
          next.push({ id: `${Date.now()}-m`, role: "assistant", text: `${moved.title} repeats on Google Calendar, so I left the time.` });
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
          setBubbles(next);
          setDraft("");
          return;
        }
        if (path && body) {
          replyAfter(
            apiRequest("PATCH", path, body).then(() => {
              void queryClient.invalidateQueries({ queryKey: ["/api/google-calendar/events"] });
            }),
            `Moved ${moved.title}.`,
          );
          return;
        }
      }
      if (action === "keep-meal" || action === "keep-google" || action === "keep-outlook" || action === "keep-ical") {
        next.push({ id: `${Date.now()}-m`, role: "assistant", text: `${moved.title} stays on ${eventStaysPut(moved.source, moved.id) ?? "Google Calendar"}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      } else {
        if (action === "confirm") {
          storePending({ kind: "move", id: moved.id, start: start.toISOString(), end: finish.toISOString() });
          next.push({ id: `${Date.now()}-m`, role: "assistant", text: `Move ${moved.title}? It came from outside the app. Reply yes to move it.` });
          localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
          setBubbles(next);
          setDraft("");
          return;
        } else {
          storePending(null);
          replyAfter(
            apiRequest("PATCH", `/api/events/${moved.id}`, { startTime: start.toISOString(), endTime: finish.toISOString() }).then(() => {
              void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
            }),
            `Moved ${moved.title}.`,
          );
          return;
        }
      }
    }
    const createdTitle = createEventTitle(text);
    const cast = createdTitle ? createEventCast(createdTitle, profiles) : null;
    const created = cast ? createEventClock(cast.title) : null;
    if (created && cast && tools.includes("create_event")) {
      const placed = createEventPlace(created.title);
      const named = cast.profileIds.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
      const drivers = cast.drivingProfileIds.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
      const peopleLabel = named.length <= 2 ? named.join(" and ") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
      const driverLabel = drivers.length <= 2 ? drivers.join(" and ") : `${drivers.slice(0, -1).join(", ")} and ${drivers[drivers.length - 1]}`;
      const calendarId = familyCalendarOffer(calendarSettings?.familyCalendarId);
      const start = new Date();
      if (created.on) start.setFullYear(created.on.getFullYear(), created.on.getMonth(), created.on.getDate());
      else if (created.day !== "today") start.setDate(start.getDate() + 1);
      start.setHours(created.hours ?? 9, created.minutes ?? 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      if (created.endHours != null) {
        end.setHours(created.endHours, created.endMinutes ?? 0, 0, 0);
        if (end.getTime() <= start.getTime()) end.setTime(start.getTime() + 60 * 60 * 1000);
      }
      replyAfter(
        apiRequest("POST", "/api/events", {
          title: placed.title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          profileIds: cast.profileIds.length > 0 ? cast.profileIds : selectedProfileIds(profileKey),
          drivingProfileIds: cast.drivingProfileIds,
          ...(placed.location ? { location: placed.location } : {}),
          calendarId,
          source: "app",
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        `${calendarId ? `Added ${placed.title}${placed.location ? ` at ${placed.location}` : ""} on the family calendar` : `Added ${placed.title}${placed.location ? ` at ${placed.location}` : ""}`}${named.length ? ` for ${peopleLabel}` : ""}${drivers.length ? `, ${driverLabel} driving` : ""}.`,
      );
      return;
    }
    const reminder = tools.includes("create_reminder") ? reminderRequest(text, profiles) : null;
    if (reminder) {
      if ("reply" in reminder) {
        next.push({ id: `${Date.now()}-t`, role: "assistant", text: reminder.reply });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const profileIds = reminder.profileIds.length > 0 ? reminder.profileIds : profileKey.split(",").filter((id) => id && id !== "family");
      replyAfter(
        apiRequest("POST", "/api/chores", {
          title: reminder.title,
          taskType: "todo",
          points: 0,
          profileIds,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          recurrenceType: "daily",
          isActive: true,
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
        }),
        `Added ${reminder.title}.`,
      );
      return;
    }
    const todo = tools.includes("create_task")
      ? todoCreate(text, profiles, profileKey.split(",").filter((id) => id && id !== "family"))
      : null;
    if (todo) {
      const named = createEventCast(createTodoTitle(text) ?? "", profiles).profileIds.length > 0;
      const who = todo.profileIds.map((id) => profiles.find((person) => person.id === id)?.name).filter((name): name is string => !!name);
      const peopleLabel = who.length <= 2 ? who.join(" and ") : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
      replyAfter(
        apiRequest("POST", "/api/chores", {
          title: todo.title,
          taskType: "todo",
          points: 0,
          profileIds: todo.profileIds,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          recurrenceType: "daily",
          isActive: true,
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
        }),
        named && who.length ? `Added ${todo.title} for ${peopleLabel}.` : `Added ${todo.title}.`,
      );
      return;
    }
    const assigned = tools.includes("assign") ? assignChange(text, talkChores, profiles) : null;
    if (assigned && "choreId" in assigned) {
      replyAfter(
        apiRequest("PATCH", `/api/chores/${assigned.choreId}`, { profileIds: assigned.profileIds }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
        }),
        assigned.reply,
      );
      return;
    }
    const people = tools.includes("update_event") ? eventPeople(text, profiles) : null;
    if (people) {
      const target = talkEvents.find((event) => event.title.toLowerCase() === people.title.toLowerCase());
      if (!target) {
        next.push({ id: `${Date.now()}-n`, role: "assistant", text: assigned && !("choreId" in assigned) ? assigned.reply : `I don't see ${people.title}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      if (!("profileIds" in people)) {
        next.push({ id: `${Date.now()}-n`, role: "assistant", text: people.reply });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      const stays = eventStaysPut(target.source, target.id);
      const googlePath = stays === "Google Calendar" ? googleChatWrite(target) : null;
      if (stays && !googlePath) {
        next.push({ id: `${Date.now()}-n`, role: "assistant", text: `${target.title} stays on ${stays}.` });
        localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
        setBubbles(next);
        setDraft("");
        return;
      }
      replyAfter(
        apiRequest("PATCH", googlePath ?? `/api/events/${target.id}`, { profileIds: people.profileIds }).then(() => {
          void queryClient.invalidateQueries({ queryKey: googlePath ? ["/api/google-calendar/events"] : ["/api/events"] });
        }),
        people.reply,
      );
      return;
    }
    if (assigned) {
      next.push({ id: `${Date.now()}-n`, role: "assistant", text: assigned.reply });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const sky = tools.includes("get_weather") ? weatherReply(text, weather ?? null) : null;
    if (sky) {
      next.push({ id: `${Date.now()}-w`, role: "assistant", text: sky });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const letters = tools.includes("get_newsletters") ? newsletterTitles(text, openTodos(chores, completions)) : null;
    if (letters) {
      next.push({ id: `${Date.now()}-l`, role: "assistant", text: letters.length ? letters.join("\n") : "No newsletters." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const hits = tools.includes("search") ? searchHits(text, [...chores, ...watchedEvents]) : null;
    if (hits) {
      next.push({ id: `${Date.now()}-q`, role: "assistant", text: hits.length ? hits.join("\n") : "Nothing matches." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      return;
    }
    const muted = tools.includes("mute_sender") ? muteAddress(text) : null;
    if (muted) {
      replyAfter(
        apiRequest("POST", "/api/ingest/mute", { address: muted }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
        }),
        `Muted ${muted}.`,
      );
      return;
    }
    const dismissed = tools.includes("mark_not_relevant") ? notRelevantTitle(text) : null;
    if (dismissed) {
      replyAfter(
        apiRequest("POST", "/api/ingest/not-relevant", { title: dismissed }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        `Removed ${dismissed}.`,
      );
      return;
    }
    const have = groceryAlreadyHave(text);
    const grocery = have ? groceryHaveAction(have, groceries, mealGroceries) : null;
    if (grocery) {
      const request = grocery.kind === "delete"
        ? apiRequest("DELETE", `/api/grocery-items/${grocery.id}`)
        : grocery.kind === "check"
          ? apiRequest("PATCH", `/api/grocery-items/${grocery.id}`, { alreadyHave: true })
          : apiRequest("POST", "/api/grocery-items", { name: grocery.name, alreadyHave: true });
      const label = grocery.kind === "have" ? grocery.name : have;
      replyAfter(
        request.then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/aggregate"] });
        }),
        `Removed ${label}.`,
      );
      return;
    }
    const saved = [...next, { id: `${Date.now()}-u`, role: "assistant" as const, text: unknownReply(isChild) }];
    localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(saved));
    setBubbles(saved);
    setDraft("");
  }

  const shown = bubbles;

  return (
    <div data-testid="chat-panel" className="flex flex-col gap-3 pb-4" data-revision={revision}>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Ask or change the day</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((bubble) => (
            <li
              key={bubble.id}
              data-testid={bubble.role === "user" ? "chat-user-bubble" : "chat-assistant-bubble"}
              className={bubble.role === "user" ? "ml-auto max-w-[80%] rounded-2xl bg-[#5E8FAD] px-3 py-2 text-sm text-white" : "max-w-[80%] rounded-2xl bg-card px-3 py-2 text-sm"}
            >
              {bubble.text}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <input
          data-testid="chat-composer"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask or change the day"
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-full bg-[#5E8FAD] px-3 text-sm text-white">Send</button>
      </form>
    </div>
  );
}
