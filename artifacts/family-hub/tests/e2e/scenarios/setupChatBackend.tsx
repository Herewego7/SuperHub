import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { SetupChat, type SetupChatProps } from "@/components/setup-chat/setup-chat";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// A stateful fake backend shared by the setupChat* scenarios. Every write the
// chat sends is recorded in order on window.__setupChat.sent, so a test can
// assert the exact requests and bodies, and reads reflect earlier writes the
// way the real server's would.

export interface FakeProfile {
  id: string;
  name: string;
  color: string;
  initials?: string;
  role?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  isAllFamilyProfile?: boolean;
}

export interface SetupChatSeed {
  user?: Record<string, unknown>;
  profiles?: FakeProfile[];
  location?: Record<string, unknown> | null;
  rewards?: Record<string, unknown>;
  inviteRole?: string | null;
  /** Written to the chat's saved session before it mounts. */
  session?: unknown;
}

export type Sent = [method: string, path: string, body: unknown];

export const OWNER = {
  id: "u1",
  email: "chad@example.com",
  firstName: "Chad",
  lastName: "Giles",
  displayName: "Chad Giles",
  onboardingCompletedAt: null,
  createdAt: new Date(0).toISOString(),
  family: { id: "f1", role: "owner", isOwner: true },
};

const REWARDS = {
  parentPin: null,
  pinGatedFeatures: [],
  hasParentPin: false,
  redemptionMode: "both",
  pointsMode: "per_chore",
  completionBonusPoints: 10,
  centsPerPoint: 8,
  minCashoutPoints: 80,
  currencySymbol: "$",
};

export function installSetupChatBackend(seed: SetupChatSeed = {}): void {
  const sent: Sent[] = [];
  const user = { ...OWNER, ...seed.user };
  const profiles: FakeProfile[] = [{ id: "all", name: "All Family", color: "#888", initials: "AF", isAllFamilyProfile: true }, ...(seed.profiles ?? [])];
  let place = seed.location ?? null;
  let rewards: Record<string, unknown> = { ...REWARDS, ...seed.rewards };
  let nextId = 1;
  let uploads = 0;

  // Seeded on first load only, so a test that reloads sees what the chat saved.
  try {
    const key = `superhub_setup_chat_${user.id}`;
    if (seed.session && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed.session));
  } catch {
    /* no storage */
  }

  const record = (url: string, opts: RequestInit | undefined): unknown => {
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : undefined;
    if (method !== "GET") sent.push([method, new URL(url, window.location.origin).pathname, body]);
    return body;
  };

  (window as unknown as { __setupChat: unknown }).__setupChat = { sent, profiles, user };

  installMockApi(
    baselineRoutes({
      "/api/auth/user": () => ok(user),
      "/api/auth/complete-onboarding": (url: string, opts?: RequestInit) => {
        record(url, opts);
        user.onboardingCompletedAt = new Date().toISOString() as never;
        return ok(user);
      },
      "/api/profiles": (url: string, opts?: RequestInit) => {
        const body = record(url, opts) as Partial<FakeProfile> | undefined;
        const id = /\/api\/profiles\/([^/?]+)/.exec(url)?.[1];
        if (id) {
          const profile = profiles.find((p) => p.id === id);
          if (profile && body) Object.assign(profile, body);
          return ok(profile ?? {});
        }
        if (opts?.method === "POST" && body) {
          const profile: FakeProfile = { id: `p${nextId++}`, name: body.name!, color: body.color!, initials: body.initials, role: body.role ?? null, email: null, photoUrl: null };
          profiles.push(profile);
          return ok(profile);
        }
        return ok(profiles);
      },
      "/api/location-settings": (url: string, opts?: RequestInit) => {
        const body = record(url, opts);
        if (opts?.method === "PUT") place = body as Record<string, unknown>;
        return ok(place);
      },
      "/api/reward-settings": (url: string, opts?: RequestInit) => {
        const body = record(url, opts) as Record<string, unknown> | undefined;
        if (opts?.method === "PUT" && body) {
          const { parentPin, ...rest } = body;
          rewards = { ...rewards, ...rest, ...(parentPin ? { hasParentPin: true } : {}) };
        }
        return ok(rewards);
      },
      "/api/onboarding-status": (url: string, opts?: RequestInit) => {
        record(url, opts);
        return ok({});
      },
      "/api/family/invites": (url: string, opts?: RequestInit) => {
        record(url, opts);
        return opts?.method === "POST" ? ok({ code: "K7M2QX9P" }) : ok([]);
      },
      "/api/family/join": (url: string, opts?: RequestInit) => {
        record(url, opts);
        return ok({});
      },
      "/api/family/my-invite-role": { role: seed.inviteRole ?? null },
      "/api/objects/upload": (url: string, opts?: RequestInit) => {
        record(url, opts);
        uploads += 1;
        return ok({ objectPath: `/objects/uploads/photo-${uploads}` });
      },
    }),
  );
}

export function SetupChatHost(props: Partial<SetupChatProps>) {
  return (
    <QueryClientProvider client={queryClient}>
      <SetupChat
        onSignOut={() => {
          (window as unknown as { __signedOut: boolean }).__signedOut = true;
        }}
        onClose={() => {
          (window as unknown as { __closed: boolean }).__closed = true;
        }}
        {...props}
      />
      <Toaster />
    </QueryClientProvider>
  );
}
