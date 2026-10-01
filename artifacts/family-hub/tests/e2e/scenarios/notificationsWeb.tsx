import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { NotificationsSection } from "@/components/notifications-section";
import { installMockApi, baselineRoutes } from "../mockApi";

// The web-push branch of Settings → Notifications, which is where the
// collapsible NotificationGroup cards live (the native branch has its own
// layout). Covers the 2026-08 audit's NOTIF-1 (the section looked empty on
// open because every group was collapsed) and NOTIF-2 (the nested groups
// used a different accordion style from the section header containing them).
const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
] as any;

export function setup(): void {
  installMockApi(baselineRoutes({
    "/api/profiles": profiles,
    "/api/push/subscriptions": [],
    "/api/push/native-tokens": [],
  }));
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="p-4 max-w-md">
        <NotificationsSection profiles={profiles} />
      </div>
    </QueryClientProvider>
  );
}
