import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SettingsModal } from "@/components/settings-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
] as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

/** Settings with the Help (KB) panel reachable — mirrors the real nesting:
 *  KbPanel is a nested Radix Dialog on top of Settings' own modal Dialog. */
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
