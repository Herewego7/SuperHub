import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SettingsModal } from "@/components/settings-modal";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// Settings open on Calendar for a family that stopped one sender and hid one
// newsletter. Undo calls land in window.__undoCalls, in order.
const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult" },
  { id: "ava", name: "Ava", initials: "A", color: "#ec4899", role: "child" },
] as any;

let settings = {
  scanInbox: true,
  shareOriginals: false,
  mutedSenders: ["deals@shop.example"],
  mutedNewsletters: ["news@lincoln.org|lincoln weekly"],
};

export function setup(): void {
  const calls: unknown[] = [];
  (window as unknown as { __undoCalls: unknown[] }).__undoCalls = calls;
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/calendar-settings": () => ok(settings),
      "/api/ingest/unmute": (_url: string, opts?: RequestInit) => {
        const { address } = JSON.parse(opts?.body as string);
        calls.push({ unmute: address });
        settings = { ...settings, mutedSenders: settings.mutedSenders.filter((value) => value !== address) };
        return ok(settings);
      },
      "/api/ingest/newsletter/show": (_url: string, opts?: RequestInit) => {
        const { key } = JSON.parse(opts?.body as string);
        calls.push({ show: key });
        settings = { ...settings, mutedNewsletters: settings.mutedNewsletters.filter((value) => value !== key) };
        return ok(settings);
      },
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
        initialOpenSectionId="calendar"
      />
    </QueryClientProvider>
  );
}
