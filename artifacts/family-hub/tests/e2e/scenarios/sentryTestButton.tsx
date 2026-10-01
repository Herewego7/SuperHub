import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SettingsModal } from "@/components/settings-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
] as any;

(window as unknown as { __sentryTestPosted?: boolean }).__sentryTestPosted = false;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/debug/sentry-test": (url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          (window as unknown as { __sentryTestPosted?: boolean }).__sentryTestPosted = true;
        }
        return ok({ ok: true });
      },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsModal isOpen onClose={() => {}} profiles={profiles} />
    </QueryClientProvider>
  );
}
