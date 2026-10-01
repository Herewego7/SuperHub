import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { ScreensaverOverlay } from "@/components/screensaver-overlay";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

/**
 * The idle screensaver (2026-09-16). Two seconds instead of ten minutes, via
 * the documented override, so the test doesn't sit and wait.
 *
 * The mocked profiles route is deliberately SLOW (400ms) and its payload
 * changes on every call, which is what makes the important assertion
 * possible: that the app is not handed back until the new value has arrived.
 * With an instant mock the stale render and the fresh one are the same frame
 * and the handshake can't be observed.
 */
let serves = 0;

/**
 * The screensaver draws its pictures from the privacy-screen library, which is
 * a list of REMOTE urls — no use in a sandbox with no network. So the
 * scenario stores an "uploaded" photo instead, which is both the simpler code
 * path and the one a family with their own photo actually gets. A data URI
 * rather than a file, because the test asserts that NOTHING goes on the wire
 * while the screensaver is up, and a real URL would make that ambiguous.
 */
const PX = (hex: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${hex}"/></svg>`,
  )}`;

export function setup(): void {
  try {
    localStorage.setItem("familyHub_screensaver", "true");
    localStorage.setItem("familyHub_screensaverIdleMs", "2000");
    // A real built-in-shaped url, so the orientation crop is exercised. The
    // test intercepts the request and serves a local image — this sandbox has
    // no network, and the point is which URL is asked for, not what comes back.
    localStorage.setItem(
      "familyHub_privacyImageUrl",
      "https://images.unsplash.com/photo-1490750967868-88df5691240b?w=1920&h=1080&fit=crop&q=80",
    );
  } catch { /* private mode */ }
  serves = 0;
  installMockApi(
    baselineRoutes({
      "/api/profiles": async () => {
        serves += 1;
        await new Promise(r => setTimeout(r, 400));
        return ok([
          { id: "p1", name: `Serve ${serves}`, initials: "S", color: "#3b82f6", role: "parent", isActive: true },
        ]);
      },
    }),
  );
}

function Body() {
  const { data } = useQuery<{ name: string }[]>({
    queryKey: ["/api/profiles"],
    // The polling this feature exists to stop.
    refetchInterval: 1000,
  });
  return (
    <div style={{ padding: 24, fontSize: 24 }} data-testid="body">
      <span data-testid="served">{data?.[0]?.name ?? "…"}</span>
    </div>
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <Body />
      <ScreensaverOverlay />
    </QueryClientProvider>
  );
}
