import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Two newsletters in Dad's mailbox: three issues of the school's weekly from
// the last three weeks, and one from a scout troop. "Stop showing" calls land in
// window.__hideCalls.
const DAY = 24 * 60 * 60 * 1000;

const base = {
  userId: "u1", icon: "✅", points: 0, isActive: true, isBonus: false,
  targetCount: 0, taskType: "todo", daysOfWeek: [], recurrenceType: null,
  endDate: null, parentChoreId: null, category: "school_email", profileIds: ["dad"],
};

const issue = (id: string, title: string, name: string, from: string, sender: string, daysAgo: number, body: string, order: number) => {
  const sent = new Date(Date.now() - daysAgo * DAY).toISOString();
  return {
    ...base, id, title, displayOrder: order, createdAt: sent,
    description: `From: ${from}\nPlan: newsletter\nName: ${name}\nSender: ${sender}\nSent: ${sent}\nMail: gmail:dad:${id}\n${body}`,
  };
};

let chores = [
  issue("w1", "This week at Lincoln", "Lincoln Weekly", "news@lincoln.org", "Lincoln Elementary", 1, "Picture day is coming up. Bring a canned good for the food drive.\nThe book fair opens in the library.", 0),
  issue("w2", "Last week at Lincoln", "Lincoln Weekly", "news@lincoln.org", "Lincoln Elementary", 8, "Thank you for a great open house. Spirit wear orders are due.", 1),
  issue("w3", "Lincoln news", "Lincoln Weekly", "news@lincoln.org", "Lincoln Elementary", 15, "Welcome back, families. Car line starts at the side door.", 2),
  issue("p1", "Troop update", "Troop 12 News", "leader@troop12scouts.org", "Troop 12", 3, "Volunteers are needed for the fall festival.", 3),
];

export function setup(): void {
  (window as unknown as { __hideCalls: unknown[] }).__hideCalls = [];
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/calendar-settings": { shareOriginals: false, mutedNewsletters: [] },
      "/api/chores": (url: string, opts?: RequestInit) => {
        if (opts?.method === "PATCH") {
          const id = new URL(url, window.location.origin).pathname.split("/").pop();
          const body = JSON.parse(opts.body as string);
          (window as unknown as { __patched?: unknown[] }).__patched = [...((window as unknown as { __patched?: unknown[] }).__patched ?? []), { id, ...body }];
          chores = chores.map((chore) => (chore.id === id ? { ...chore, ...body } : chore));
          return ok(chores.find((chore) => chore.id === id));
        }
        return ok(chores);
      },
      "/api/ingest/newsletter/hide": (_url: string, opts?: RequestInit) => {
        const body = JSON.parse(opts?.body as string);
        (window as unknown as { __hideCalls: unknown[] }).__hideCalls.push(body);
        chores = chores.filter((chore) => !chore.description.includes(`From: ${body.address}\n`) || !chore.description.includes(`Name: ${body.name}\n`));
        return ok({});
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
