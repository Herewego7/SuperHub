import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Chore } from "@workspace/shared-types";
import { checkOffTitle, toolsForRole } from "@/lib/chatTools";
import { dinnerReply, groceryAlreadyHave } from "@/lib/mealCalendar";
import type { Meal } from "@workspace/shared-types";
import { appendUserMessage, readThread, type ChatBubble } from "@/lib/chatThread";

const PLAN_KEY = "superhub_evening_plan";

export function stageEveningPlan(text: string) {
  sessionStorage.setItem(PLAN_KEY, text);
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
      const profileId = chore.profileIds[0];
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/chore-completions"] });
    },
  });

  function send(text: string) {
    const next = appendUserMessage(profileKey, text);
    if (!next) return;
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
    const have = groceryAlreadyHave(text);
    const grocery = have ? groceries.find((item) => item.name.toLowerCase() === have.toLowerCase()) : undefined;
    if (grocery) {
      void apiRequest("DELETE", `/api/grocery-items/${grocery.id}`);
      void queryClient.invalidateQueries({ queryKey: ["/api/grocery-items"] });
      next.push({ id: `${Date.now()}-g`, role: "assistant", text: `Removed ${grocery.name}.` });
      localStorage.setItem(`superhub_chat_thread_${profileKey}`, JSON.stringify(next));
    }
    setBubbles(next);
    setDraft("");
    onSent();
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
