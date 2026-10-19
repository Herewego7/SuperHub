import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Home's To-Dos for a family with two parents: an inbox item in each parent's
// mailbox, one to-do nobody has taken and one for everyone. Removing an item
// takes the server 1.5 seconds, so a row that waits for it moves late.
export const REMOVE_MS = 1500;

const profiles = [
  { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF", color: "#7c5cbf" },
  { id: "mom", name: "Mom", initials: "M", color: "#e07a5f", role: "adult" },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "kid1", name: "Ava", initials: "A", color: "#ef4444", role: "child" },
];

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, parentChoreId: null, category: null, createdAt: new Date().toISOString(),
};

const mail = (from: string, sender: string, owner: string, ref: string, body: string) =>
  `From: ${from}\nPlan: todo\nRef: ${ref}\nSender: ${sender}\nSent: ${new Date().toISOString()}\nMail: gmail:${owner}:${ref}\n${body}`;

let todos = [
  { ...base, id: "planner", title: "Bring planner", category: "school_email", profileIds: ["dad"], displayOrder: 0,
    description: mail("office@school.org", "Front Office", "dad", "m1", "Bring the planner to class. Sign the reading log.\nFor Ava.") },
  { ...base, id: "slip", title: "Sign the zoo trip form", category: "school_email", profileIds: ["mom"], displayOrder: 1,
    description: mail("teacher@school.org", "Ms. Rivera", "mom", "m2", "Return the signed form to the office.") },
  { ...base, id: "dentist", title: "Call the dentist", profileIds: [], description: null, displayOrder: 2 },
  { ...base, id: "weekend", title: "Plan the weekend", profileIds: ["all"], description: null, displayOrder: 3 },
];

let stopped: string[] = [];

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/profiles": profiles,
      "/api/calendar-settings": () => ok({ shareOriginals: false, mutedSenders: stopped }),
      // Like the server before 2026-10: it only skips the sender's future
      // mail and leaves their open items, so the app has to remove them.
      "/api/ingest/mute": (_url: string, opts?: RequestInit) => {
        const { address } = JSON.parse(opts?.body as string);
        stopped = [...stopped, address];
        return ok({ shareOriginals: false, mutedSenders: stopped });
      },
      "/api/chores": (url: string, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          const id = new URL(url, window.location.origin).pathname.split("/").pop();
          todos = todos.filter((todo) => todo.id !== id);
          return ok({});
        }
        if (opts?.method === "PATCH") {
          const id = new URL(url, window.location.origin).pathname.split("/").pop();
          const body = JSON.parse(opts.body as string);
          todos = todos.map((todo) => (todo.id === id ? { ...todo, ...body } : todo));
          return ok(todos.find((todo) => todo.id === id));
        }
        return ok(todos);
      },
      "/api/ingest/not-relevant": async (_url: string, opts?: RequestInit) => {
        await new Promise((resolve) => setTimeout(resolve, REMOVE_MS));
        const { title } = JSON.parse(opts?.body as string);
        todos = todos.filter((todo) => todo.title !== title);
        return ok({});
      },
      "/api/ingest/original": {
        subject: "Planner reminder",
        from: "Front Office <office@school.org>",
        sentAt: new Date().toISOString(),
        text: "Hi families,\n\nPlease send your child to class with their planner every day this week.",
        webUrl: "https://mail.google.com/mail/u/0/#all/m1",
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
