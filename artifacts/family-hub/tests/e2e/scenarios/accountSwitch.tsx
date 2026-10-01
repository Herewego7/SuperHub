import { QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { queryClient } from "@/lib/queryClient";
import { AuthenticatedRouter } from "@/App";
import { installMockApi, baselineRoutes } from "../mockApi";

// Signing in as a DIFFERENT account from the last one on this device. The
// switch clean-up must finish before the app loads, so the new account's data
// is fetched once — not loaded, wiped and loaded again (2026-09-30).
export function setup(): void {
  try { localStorage.setItem("familyHub_lastAccountId", "previous-account"); } catch { /* */ }
  const w = window as unknown as { __profileLoads: number };
  w.__profileLoads = 0;
  const base = baselineRoutes({
    "/api/auth/user": { id: "u1", email: "test@test.com", onboardingCompletedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
  });
  installMockApi((url, opts) => {
    const path = new URL(url, location.href).pathname;
    if (path === "/api/profiles") w.__profileLoads += 1;
    return base(url, opts);
  });
}

export function Component() {
  const { hook } = memoryLocation({ path: "/" });
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter hook={hook}>
        <AuthenticatedRouter />
      </WouterRouter>
    </QueryClientProvider>
  );
}
