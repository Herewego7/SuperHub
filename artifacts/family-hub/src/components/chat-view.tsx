import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore } from "@workspace/shared-types";
import { assignChange, checkOffTitle, createEventClock, createEventTitle, createTodoTitle, dayReply, deleteEventAction, deleteEventTitle, drivingReply, familyCalendarOffer, familyReply, feedbackNote, forgetFact, memoryFact, memoryReply, moveEventAction, moveEventWhen, muteAddress, newsletterTitles, notRelevantTitle, placeReply, pointsProfileId, rememberedFacts, reminderRequest, schoolFact, schoolReply, searchHits, toolsForRole, weatherReply } from "@/lib/chatTools";
import { mailVisibleToKid, openTodos, schoolEmailNames, visibleForProfiles } from "@/lib/homeDay";
import { dinnerReply, groceryAlreadyHave, groceryHaveAction } from "@/lib/mealCalendar";
import type { Meal } from "@workspace/shared-types";
import { appendUserMessage, noteChatUnread, readThread, threadWithPlan, type ChatBubble } from "@/lib/chatThread";

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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; start: string; end: string } | null>(null);
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
  const { data: events = [], isFetched: eventsFetched } = useQuery<{ id: string; title: string; description?: string | null; location?: string | null; source?: string | null; drivingProfileIds?: string[] | null; profileIds?: string[] | null; startTime?: string | null; endTime?: string | null }[]>({ queryKey: ["/api/events"] });
  const { data: profiles = [] } = useQuery<{ id: string; name: string; school?: string | null; facts?: string[] | null; isAllFamilyProfile?: boolean | null }[]>({ queryKey: ["/api/profiles"] });
  const { data: weather } = useQuery<{ location?: string; temperature?: number; condition?: string }>({ queryKey: ["/api/weather"], retry: false });
  const { data: calendarSettings } = useQuery<{ familyCalendarId?: string | null }>({ queryKey: ["/api/calendar-settings"] });
  const { data: meals = [], isFetched: mealsFetched } = useQuery<Meal[]>({
    queryKey: ["/api/meals", "chat-dinner"],
    queryFn: async () => {
      const start = new Date();
      const end = new Date();
      end.setDate(start.getDate() + 1);
      const key = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const res = await apiRequest("GET", `/api/meals?start=${key(start)}&end=${key(end)}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (!profileReady || !choresFetched || !eventsFetched || !mealsFetched || sentPending.current) return;
    if (typeof sessionStorage === "undefined") return;
    const pending = sessionStorage.getItem(PENDING_KEY);
    if (!pending) return;
    sentPending.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    send(pending);
  }, [profileReady, choresFetched, eventsFetched, mealsFetched, profileKey]);

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

  function send(text: string) {
    const next = appendUserMessage(profileKey, text);
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
    if (pendingDeleteId && /^yes\.?$/i.test(text.trim())) {
      const id = pendingDeleteId;
      setPendingDeleteId(null);
      replyAfter(
        apiRequest("DELETE", `/api/events/${id}`).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        "Deleted.",
        true,
      );
      return;
    }
    if (pendingMove && /^yes\.?$/i.test(text.trim())) {
      const move = pendingMove;
      setPendingMove(null);
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
    const talkEvents = visibleForProfiles(events, selectedIds).filter((event) => mailVisibleToKid(event, kid?.name ?? null));
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
    const school = schoolReply(text, profiles, kid?.name ?? profiles.find((profile) => selectedIds.length === 1 && profile.id === selectedIds[0])?.name);
    if (school) {
      next.push({ id: `${Date.now()}-h`, role: "assistant", text: school });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const family = tools.includes("get_profile") ? familyReply(text, profiles) : null;
    if (family) {
      next.push({ id: `${Date.now()}-f`, role: "assistant", text: family });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const place = tools.includes("maps_link") ? placeReply(text, talkEvents) : null;
    if (place) {
      next.push({ id: `${Date.now()}-o`, role: "assistant", text: place });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const driving = drivingReply(text, talkEvents, profiles);
    if (driving) {
      next.push({ id: `${Date.now()}-r`, role: "assistant", text: driving });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const planChores = talkChores.filter((chore) => {
      const people = chore.profileIds ?? [];
      return selectedIds.length === 0 || people.length === 0 || people.some((id) => selectedIds.includes(id));
    });
    const planEvents = talkEvents;
    const plan = tools.includes("get_plan")
      ? dayReply(text, { chores: planChores, events: planEvents, completions, meals, day: new Date() })
      : null;
    if (plan) {
      next.push({ id: `${Date.now()}-p`, role: "assistant", text: plan });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const dinner = dinnerReply(text, meals, new Date());
    if (dinner) {
      next.push({ id: `${Date.now()}-d`, role: "assistant", text: dinner });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const removeTitle = deleteEventTitle(text);
    const target = removeTitle ? talkEvents.find((event) => event.title.toLowerCase() === removeTitle.toLowerCase()) : undefined;
    if (target && tools.includes("delete_event")) {
      const action = deleteEventAction(target.source, target.id);
      if (action === "keep") {
        next.push({ id: `${Date.now()}-c`, role: "assistant", text: target.source === "meal" ? `${target.title} stays on the meal plan.` : `${target.title} stays on Google Calendar.` });
      } else if (action === "confirm") {
        setPendingMove(null);
        setPendingDeleteId(target.id);
        next.push({ id: `${Date.now()}-c`, role: "assistant", text: `Delete ${target.title}? It came from outside the app. Reply yes to delete it.` });
      } else {
        setPendingDeleteId(null);
        replyAfter(
          apiRequest("DELETE", `/api/events/${target.id}`).then(() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          }),
          `Deleted ${target.title}.`,
        );
        return;
      }
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const moving = moveEventWhen(text);
    const moved = moving ? talkEvents.find((event) => event.title.toLowerCase() === moving.title.toLowerCase()) : undefined;
    if (moved && moving && tools.includes("update_event")) {
      const action = moveEventAction(moved.source, moved.id);
      if (action === "keep-meal") {
        next.push({ id: `${Date.now()}-m`, role: "assistant", text: `${moved.title} stays on the meal plan.` });
      } else if (action === "keep-google") {
        next.push({ id: `${Date.now()}-m`, role: "assistant", text: `${moved.title} stays on Google Calendar.` });
      } else {
        const start = new Date(moved.startTime ?? Date.now());
        const end = moved.endTime ? new Date(moved.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
        const duration = Math.max(end.getTime() - start.getTime(), 60 * 60 * 1000);
        if (moving.on) start.setFullYear(moving.on.getFullYear(), moving.on.getMonth(), moving.on.getDate());
        if (moving.hours != null && moving.minutes != null) start.setHours(moving.hours, moving.minutes, 0, 0);
        const finish = new Date(start.getTime() + duration);
        if (action === "confirm") {
          setPendingDeleteId(null);
          setPendingMove({ id: moved.id, start: start.toISOString(), end: finish.toISOString() });
          next.push({ id: `${Date.now()}-m`, role: "assistant", text: `Move ${moved.title}? It came from outside the app. Reply yes to move it.` });
        } else {
          setPendingMove(null);
          replyAfter(
            apiRequest("PATCH", `/api/events/${moved.id}`, { startTime: start.toISOString(), endTime: finish.toISOString() }).then(() => {
              void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
            }),
            `Moved ${moved.title}.`,
          );
          return;
        }
      }
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const createdTitle = createEventTitle(text);
    const created = createdTitle ? createEventClock(createdTitle) : null;
    if (created && tools.includes("create_event")) {
      const calendarId = familyCalendarOffer(calendarSettings?.familyCalendarId);
      const start = new Date();
      if (created.on) start.setFullYear(created.on.getFullYear(), created.on.getMonth(), created.on.getDate());
      else if (created.day !== "today") start.setDate(start.getDate() + 1);
      start.setHours(created.hours ?? 9, created.minutes ?? 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      replyAfter(
        apiRequest("POST", "/api/events", {
          title: created.title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          profileIds: [],
          drivingProfileIds: [],
          calendarId,
          source: "app",
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        }),
        calendarId ? `Added ${created.title} on the family calendar.` : `Added ${created.title}.`,
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
    const todoTitle = createTodoTitle(text);
    if (todoTitle && tools.includes("create_task")) {
      const profileIds = profileKey.split(",").filter((id) => id && id !== "family");
      replyAfter(
        apiRequest("POST", "/api/chores", {
          title: todoTitle,
          taskType: "todo",
          points: 0,
          profileIds,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          recurrenceType: "daily",
          isActive: true,
        }).then(() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
        }),
        `Added ${todoTitle}.`,
      );
      return;
    }
    const assigned = tools.includes("assign") ? assignChange(text, talkChores, profiles) : null;
    if (assigned) {
      if ("choreId" in assigned) {
        replyAfter(
          apiRequest("PATCH", `/api/chores/${assigned.choreId}`, { profileIds: assigned.profileIds }).then(() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
          }),
          assigned.reply,
        );
        return;
      }
      next.push({ id: `${Date.now()}-n`, role: "assistant", text: assigned.reply });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const sky = tools.includes("get_weather") ? weatherReply(text, weather ?? null) : null;
    if (sky) {
      next.push({ id: `${Date.now()}-w`, role: "assistant", text: sky });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const letters = tools.includes("get_newsletters") ? newsletterTitles(text, openTodos(chores, completions)) : null;
    if (letters) {
      next.push({ id: `${Date.now()}-l`, role: "assistant", text: letters.length ? letters.join("\n") : "No newsletters." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const hits = tools.includes("search") ? searchHits(text, [...chores, ...events]) : null;
    if (hits) {
      next.push({ id: `${Date.now()}-q`, role: "assistant", text: hits.length ? hits.join("\n") : "Nothing matches." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
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
    setBubbles(next);
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
