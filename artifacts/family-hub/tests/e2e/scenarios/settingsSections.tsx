import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SettingsModal } from "@/components/settings-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "ava", name: "Ava", initials: "A", color: "#ec4899", role: "child" },
] as any;

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      // No `country` on purpose: this is the shape of a row saved before the
      // column was ever written, which is what every existing family has. The
      // form must still come up as United States rather than blank.
      "/api/location-settings": { city: "Farmington", state: "MN" },
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsModal
        isOpen
        onClose={() => {}}
        profiles={profiles}
        setHiddenTabs={() => {}}
        setDefaultTab={() => {}}
        tabOrder={["home", "calendar", "chores", "todos", "meals"]}
        setTabOrder={() => {}}
        setNavIconsOnly={() => {}}
      />
    </QueryClientProvider>
  );
}
