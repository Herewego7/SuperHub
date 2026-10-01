import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AnnouncementsBanner } from "@/components/announcements-banner";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
  { id: "paisley", name: "Paisley", initials: "P", color: "#ef4444" },
] as any;

const shoutout = { id: "s1", fromProfileId: "dad", toProfileId: "paisley", message: "Great job today!", seenAt: null, createdAt: new Date().toISOString() };

// Notes are created with a hardcoded title of "Note" (see
// recent-shoutouts-card.tsx) — the real text lives in `content`, and
// `reference` holds the author's profileId.
const note = {
  id: "n1", type: "note", title: "Note", content: "Soccer kit is in the hall",
  reference: "dad", date: new Date().toISOString(), isActive: true,
};
const noteAssignment = { id: "na1", contentId: "n1", profileId: "dad", date: new Date().toISOString() };

export function setup(): void {
  installMockApi(
    baselineRoutes({
      "/api/profiles": profiles,
      "/api/shoutouts?limit": [shoutout],
      "/api/shoutouts/": { ok: true },
      "/api/daily-content": [note],
      "/api/daily-content-assignments": [noteAssignment],
      "/api/daily-content-completions": [],
    }),
  );
}

// A remount button lets the test prove a dismissal survives a full
// unmount/remount — i.e. it's genuinely persisted (localStorage), not just
// in-memory component state that resets on tab navigation (the exact bug
// class fixed in this file in an earlier session, 2026-08-18).
export function Component() {
  const [mountKey, setMountKey] = useState(0);
  return (
    <QueryClientProvider client={queryClient}>
      <button data-testid="remount-btn" onClick={() => setMountKey((k) => k + 1)}>Remount</button>
      <AnnouncementsBanner key={mountKey} selectedProfiles={["dad"]} profiles={profiles} />
    </QueryClientProvider>
  );
}
