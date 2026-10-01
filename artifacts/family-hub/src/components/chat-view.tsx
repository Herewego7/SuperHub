import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore } from "@workspace/shared-types";
import { assignChange, checkOffTitle, createEventTitle, createTodoTitle, dayReply, deleteEventTitle, drivingReply, familyCalendarOffer, familyReply, importedEventNeedsConfirm, moveEventWhen, muteAddress, newsletterTitles, notRelevantTitle, placeReply, pointsProfileId, schoolFact, schoolReply, searchHits, toolsForRole, weatherReply } from "@/lib/chatTools";
import { dinnerName, mailVisibleToKid, openTodos, schoolEmailNames, visibleForProfiles } from "@/lib/homeDay";
import { dinnerReply, groceryAlreadyHave, groceryHaveAction } from "@/lib/mealCalendar";
import type { Meal } from "@workspace/shared-types";
import { appendUserMessage, noteChatUnread, readThread, threadWithPlan, type ChatBubble } from "@/lib/chatThread";

const PLAN_KEY = "superhub_evening_plan";
const PLAN_REPLY_KEY = "superhub_evening_plan_reply";

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
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
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
  const { data: events = [] } = useQuery<{ id: string; title: string; description?: string | null; location?: string | null; source?: string | null; drivingProfileIds?: string[] | null; profileIds?: string[] | null; startTime?: string | null; endTime?: string | null }[]>({ queryKey: ["/api/events"] });
  const { data: profiles = [] } = useQuery<{ id: string; name: string; school?: string | null; isAllFamilyProfile?: boolean | null }[]>({ queryKey: ["/api/profiles"] });
  const { data: weather } = useQuery<{ location?: string; temperature?: number; condition?: string }>({ queryKey: ["/api/weather"], retry: false });
  const { data: calendarSettings } = useQuery<{ familyCalendarId?: string | null }>({ queryKey: ["/api/calendar-settings"] });
  const { data: meals = [] } = useQuery<Meal[]>({
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
    if (pendingDeleteId && /^yes\.?$/i.test(text.trim())) {
      void apiRequest("DELETE", `/api/events/${pendingDeleteId}`);
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setPendingDeleteId(null);
      next.push({ id: `${Date.now()}-y`, role: "assistant", text: "Deleted." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      onSent();
      return;
    }
    if (pendingMove && /^yes\.?$/i.test(text.trim())) {
      void apiRequest("PATCH", `/api/events/${pendingMove.id}`, { startTime: pendingMove.start, endTime: pendingMove.end });
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setPendingMove(null);
      next.push({ id: `${Date.now()}-m`, role: "assistant", text: "Moved." });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      setBubbles(next);
      setDraft("");
      onSent();
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
      complete.mutate(chore);
      next.push({ id: `${Date.now()}-a`, role: "assistant", text: `Checked off ${chore.title}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const fact = isChild ? null : schoolFact(text, profiles);
    if (fact && tools.includes("remember_fact")) {
      void apiRequest("PATCH", `/api/profiles/${fact.profileId}`, { school: fact.school });
      void queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      next.push({ id: `${Date.now()}-s`, role: "assistant", text: `Saved ${fact.name}'s school as ${fact.school}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
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
      ? dayReply(text, { chores: planChores, events: planEvents, completions, dinner: dinnerName(meals, new Date()), day: new Date() })
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
    if (target && tools.includes("delete_event") && importedEventNeedsConfirm(target.source)) {
      setPendingDeleteId(target.id);
      next.push({ id: `${Date.now()}-c`, role: "assistant", text: `Delete ${target.title}? It came from outside the app. Reply yes to delete it.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const moving = moveEventWhen(text);
    const moved = moving ? talkEvents.find((event) => event.title.toLowerCase() === moving.title.toLowerCase()) : undefined;
    if (moved && moving && tools.includes("update_event")) {
      if (moved.id.startsWith("google-")) {
        next.push({ id: `${Date.now()}-m`, role: "assistant", text: `${moved.title} stays on Google Calendar.` });
      } else {
        const start = new Date(moved.startTime ?? Date.now());
        const end = moved.endTime ? new Date(moved.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
        const duration = Math.max(end.getTime() - start.getTime(), 60 * 60 * 1000);
        start.setHours(moving.hours, moving.minutes, 0, 0);
        const finish = new Date(start.getTime() + duration);
        if (importedEventNeedsConfirm(moved.source)) {
          setPendingDeleteId(null);
          setPendingMove({ id: moved.id, start: start.toISOString(), end: finish.toISOString() });
          next.push({ id: `${Date.now()}-m`, role: "assistant", text: `Move ${moved.title}? It came from outside the app. Reply yes to move it.` });
        } else {
          setPendingMove(null);
          void apiRequest("PATCH", `/api/events/${moved.id}`, { startTime: start.toISOString(), endTime: finish.toISOString() });
          void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          next.push({ id: `${Date.now()}-m`, role: "assistant", text: `Moved ${moved.title}.` });
        }
      }
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const createdTitle = createEventTitle(text);
    if (createdTitle && tools.includes("create_event")) {
      const calendarId = familyCalendarOffer(calendarSettings?.familyCalendarId);
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      void apiRequest("POST", "/api/events", {
        title: createdTitle,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        profileIds: [],
        drivingProfileIds: [],
        calendarId,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      next.push({
        id: `${Date.now()}-e`,
        role: "assistant",
        text: calendarId ? `Added ${createdTitle} on the family calendar.` : `Added ${createdTitle}.`,
      });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const todoTitle = createTodoTitle(text);
    if (todoTitle && tools.includes("create_task")) {
      const profileIds = profileKey.split(",").filter((id) => id && id !== "family");
      void apiRequest("POST", "/api/chores", {
        title: todoTitle,
        taskType: "todo",
        points: 0,
        profileIds,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        recurrenceType: "daily",
        isActive: true,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      next.push({ id: `${Date.now()}-t`, role: "assistant", text: `Added ${todoTitle}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const assigned = tools.includes("assign") ? assignChange(text, talkChores, profiles) : null;
    if (assigned) {
      if ("choreId" in assigned) {
        void apiRequest("PATCH", `/api/chores/${assigned.choreId}`, { profileIds: assigned.profileIds });
        void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
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
      void apiRequest("POST", "/api/ingest/mute", { address: muted });
      void queryClient.invalidateQueries({ queryKey: ["/api/calendar-settings"] });
      next.push({ id: `${Date.now()}-u`, role: "assistant", text: `Muted ${muted}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const dismissed = tools.includes("mark_not_relevant") ? notRelevantTitle(text) : null;
    if (dismissed) {
      void apiRequest("POST", "/api/ingest/not-relevant", { title: dismissed });
      void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
      next.push({ id: `${Date.now()}-i`, role: "assistant", text: `Removed ${dismissed}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const have = groceryAlreadyHave(text);
    const grocery = have ? groceryHaveAction(have, groceries, mealGroceries) : null;
    if (grocery) {
      if (grocery.kind === "delete") void apiRequest("DELETE", `/api/grocery-items/${grocery.id}`);
      if (grocery.kind === "check") void apiRequest("PATCH", `/api/grocery-items/${grocery.id}`, { alreadyHave: true });
      if (grocery.kind === "have") void apiRequest("POST", "/api/grocery-items", { name: grocery.name, alreadyHave: true });
      void queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/grocery-list/aggregate"] });
      const label = grocery.kind === "have" ? grocery.name : have;
      next.push({ id: `${Date.now()}-g`, role: "assistant", text: `Removed ${label}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
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
