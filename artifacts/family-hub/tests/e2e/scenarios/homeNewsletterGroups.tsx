import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Newsletters from several senders that are really fewer (2026-10-22): the
// school's weekly and its PTA (same address, combine on their own), a
// boosters club (maybe the same school: asked about), a church's office and
// youth group (combine on their own), and one unrelated. Saved groupings land
// in window.__grouping; "Stop showing" calls in window.__hideCalls.
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
  issue("w1", "This week at Lincoln", "Lincoln Weekly", "news@lincoln.org", "Lincoln Elementary", 1, "Picture day is coming up.", 0),
  issue("w2", "Last week at Lincoln", "Lincoln Weekly", "news@lincoln.org", "Lincoln Elementary", 8, "Spirit wear orders are due.", 1),
  issue("p1", "PTA update", "PTA News", "pta@lincoln.org", "Lincoln PTA", 3, "Volunteers are needed for the fall festival.", 2),
  issue("b1", "Boosters", "Lincoln Boosters", "hello@lincolnathletics.org", "Lincoln Boosters", 4, "Concessions sign-up is open.", 3),
  issue("g1", "Grace this week", "Grace Weekly", "office@gracechurch.org", "Grace Church", 2, "Fall picnic on Sunday.", 4),
  issue("g2", "Grace last week", "Grace Weekly", "office@gracechurch.org", "Grace Church", 9, "Choir starts again.", 5),
  issue("y1", "Youth night", "Grace Youth", "youth@gracechurch.org", "Grace Youth", 5, "Youth night is Friday.", 6),
  issue("f1", "Forward Future", "Forward Future", "news@forwardfuture.ai", "Forward Future", 6, "Agents are getting better.", 7),
];

let grouping = { groups: [] as unknown[], apart: [] as string[] };

export function setup(): void {
  const w = window as unknown as { __hideCalls: unknown[]; __grouping: unknown };
  w.__hideCalls = [];
  w.__grouping = null;
  installMockApi(
    baselineRoutes({
      "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      "/api/calendar-settings/newsletter-grouping": (_url: string, opts?: RequestInit) => {
        grouping = JSON.parse(opts?.body as string);
        w.__grouping = grouping;
        return ok({ shareOriginals: false, mutedNewsletters: [], newsletterGrouping: grouping });
      },
      "/api/calendar-settings": () => ok({ shareOriginals: false, mutedNewsletters: [], newsletterGrouping: grouping }),
      "/api/chores": () => ok(chores),
      "/api/ingest/newsletter/hide": (_url: string, opts?: RequestInit) => {
        const body = JSON.parse(opts?.body as string);
        w.__hideCalls.push(body);
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
