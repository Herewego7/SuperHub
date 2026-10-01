import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { NotificationsSection } from "@/components/notifications-section";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
] as any;

const nativeDevices = [
  { id: "n1", profileId: null, label: "iPhone/iPad", lastSeenAt: "2026-08-23T12:00:00.000Z", notificationPrefs: {} },
  { id: "n2", profileId: "dad", label: "iPhone/iPad", lastSeenAt: "2026-08-23T12:00:00.000Z", notificationPrefs: {} },
  { id: "n3", profileId: "dad", label: "iPhone/iPad", lastSeenAt: "2026-08-24T12:00:00.000Z", notificationPrefs: {} },
];

export function setup(): void {
  // Force isNativeNotificationsSupported() (@capacitor/core's
  // isNativePlatform()) to true — it reads window.webkit.messageHandlers
  // live at call time, not at module-load time, so setting it here (before
  // React renders) is enough even though @capacitor/core loads eagerly as
  // part of the harness's shared module graph.
  (window as any).webkit = { messageHandlers: { bridge: {} } };

  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/push/subscriptions": [],
      "/api/push/native-tokens": nativeDevices,
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationsSection profiles={profiles} />
    </QueryClientProvider>
  );
}
