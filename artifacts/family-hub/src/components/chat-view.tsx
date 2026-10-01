import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore } from "@workspace/shared-types";
import { checkOffTitle, createEventTitle, deleteEventTitle, familyCalendarOffer, importedEventNeedsConfirm, pointsProfileId, toolsForRole } from "@/lib/chatTools";
import { dinnerReply, groceryAlreadyHave, groceryHaveAction } from "@/lib/mealCalendar";
import type { Meal } from "@workspace/shared-types";
import { appendUserMessage, noteChatUnread, readThread, type ChatBubble } from "@/lib/chatThread";

const PLAN_KEY = "superhub_evening_plan";

export function stageEveningPlan(text: string) {
  sessionStorage.setItem(PLAN_KEY, text);
  noteChatUnread();
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
  const [bubbles, setBubbles] = useState<ChatBubble[]>(() => readThread(profileKey));
  useEffect(() => {
    if (!profileReady || typeof sessionStorage === "undefined") return;
    const plan = sessionStorage.getItem(PLAN_KEY);
    if (!plan) return;
    sessionStorage.removeItem(PLAN_KEY);
    setBubbles((current) => {
      if (current.some((bubble) => bubble.text === plan)) return current;
      const next = [{ id: "evening-plan", role: "assistant" as const, text: plan }, ...current];
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
      return next;
    });
  }, [profileReady, profileKey]);
  const tools = toolsForRole(isChild);
  const { data: chores = [] } = useQuery<Chore[]>({ queryKey: ["/api/chores"] });
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
  const { data: events = [] } = useQuery<{ id: string; title: string; source?: string | null }[]>({ queryKey: ["/api/events"] });
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
    const title = checkOffTitle(text);
    const chore = title ? chores.find((item) => item.title.toLowerCase() === title.toLowerCase() && item.taskType !== "todo") : undefined;
    if (chore && tools.includes("complete_task")) {
      complete.mutate(chore);
      next.push({ id: `${Date.now()}-a`, role: "assistant", text: `Checked off ${chore.title}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const dinner = dinnerReply(text, meals, new Date());
    if (dinner) {
      next.push({ id: `${Date.now()}-d`, role: "assistant", text: dinner });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    const removeTitle = deleteEventTitle(text);
    const target = removeTitle ? events.find((event) => event.title.toLowerCase() === removeTitle.toLowerCase()) : undefined;
    if (target && tools.includes("delete_event") && importedEventNeedsConfirm(target.source)) {
      setPendingDeleteId(target.id);
      next.push({ id: `${Date.now()}-c`, role: "assistant", text: `Delete ${target.title}? It came from outside the app. Reply yes to delete it.` });
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
