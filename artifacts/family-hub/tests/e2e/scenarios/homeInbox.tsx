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

/** A date this many days ahead, as "M/D/YYYY", the way mail notes write it. */
const ahead = (days: number) => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return `${at.getMonth() + 1}/${at.getDate()}/${at.getFullYear()}`;
};

let todos = [
  { ...base, id: "planner", title: "Bring planner", category: "school_email", profileIds: ["dad"], displayOrder: 0,
    description: mail("office@school.org", "Front Office", "dad", "m1", "Bring the planner to class. Sign the reading log.\nFor Ava.") },
  { ...base, id: "slip", title: "Sign the zoo trip form", category: "school_email", profileIds: ["mom"], displayOrder: 1,
    description: mail("teacher@school.org", "Ms. Rivera", "mom", "m2", "Return the signed form to the office.") },
  { ...base, id: "fair", title: "Book fair", category: "school_email", profileIds: ["mom"], displayOrder: 4,
    description: `From: office@school.org\nPlan: keydate\nRef: m3\nSender: Front Office\n${ahead(9)}\nBook fair in the library.` },
  { ...base, id: "conf", title: "Conferences", category: "school_email", profileIds: ["dad"], displayOrder: 5,
    description: `From: office@school.org\nPlan: keydate\nRef: m4\nSender: Front Office\n${ahead(12)}\nParent-teacher conferences.` },
  { ...base, id: "linkedin", title: "Respond to Roderick Lee's LinkedIn invitation", category: "school_email", profileIds: ["dad"], displayOrder: 6,
    description: mail("messages-noreply@linkedin.com", "LinkedIn", "dad", "m5", "Roderick Lee is waiting for a response.\nFor Dad.") },
  { ...base, id: "reset", title: "Reset your password", category: "school_email", profileIds: ["dad"], displayOrder: 7,
    description: mail("no-reply@accounts.example.com", "Accounts", "dad", "m6", "Use this link to reset your password. It expires in 30 minutes.") },
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
      // Like a server from before kinds existed: no such route.
      "/api/ingest/mute-kind": () => new Response(JSON.stringify({ message: "Not found" }), { status: 404, headers: { "content-type": "application/json" } }),
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
