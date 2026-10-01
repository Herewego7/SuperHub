import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PerPersonSettingsSection } from "@/components/per-person-settings";
import { installMockApi, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult", bedtimeCutoff: "20:00", dailyBriefTime: "09:30", weeklyRecapTime: "13:30", weeklyRecapDay: 0, streakSkipDays: [0] },
] as any;

// Every PATCH, not just the last — the contract test walks all seven controls
// in one pass and needs to see each body it produced.
(window as unknown as { __allPatchBodies?: unknown[] }).__allPatchBodies = [];

let currentProfiles = profiles;
(window as unknown as { __lastPatchBody?: unknown }).__lastPatchBody = undefined;

export function setup(): void {
  currentProfiles = profiles;
  (window as unknown as { __allPatchBodies?: unknown[] }).__allPatchBodies = [];
  installMockApi((url: string, opts?: RequestInit) => {
    if (url.includes("/api/profiles/dad") && opts?.method === "PATCH") {
      const body = JSON.parse(opts.body as string);
      (window as unknown as { __lastPatchBody?: unknown }).__lastPatchBody = body;
      ((window as unknown as { __allPatchBodies?: unknown[] }).__allPatchBodies ??= []).push(body);
      currentProfiles = currentProfiles.map((p) => (p.id === "dad" ? { ...p, ...body } : p));
      return ok(currentProfiles[0]);
    }
    if (url.includes("/api/profiles")) return ok(currentProfiles);
    if (url.includes("/api/reward-settings")) return ok({ pointsMode: "per_completion", completionBonusPoints: 10 });
    return ok([]);
  });
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ maxWidth: 480, margin: "20px auto" }}>
        <PerPersonSettingsSection profiles={profiles} />
      </div>
    </QueryClientProvider>
  );
}
