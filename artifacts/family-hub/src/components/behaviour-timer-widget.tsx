import { useEffect, useState } from "react";
import { objectUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Timer, ChevronRight } from "lucide-react";
import { Profile, BehaviourIncident, BehaviourRule, BehaviourBoardSettings } from "@workspace/shared-types";

interface BoardData {
  settings: BehaviourBoardSettings | null;
  rules: BehaviourRule[];
  activeIncidents: BehaviourIncident[];
  recentIncidents: BehaviourIncident[];
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Floating mini-timer that keeps a running behaviour-board countdown visible
 * after the user leaves the Behaviour tab. Sits just above the global + button
 * in the lower-right corner. Tapping it jumps back to the board. Hidden when
 * already on the board or when no timer is running.
 */
export function BehaviourTimerWidget({
  profiles,
  hidden,
  onOpen,
}: {
  profiles: Profile[];
  hidden: boolean;
  onOpen: () => void;
}) {
  const { data } = useQuery<BoardData>({
    queryKey: ["/api/behaviour-board"],
    queryFn: async () => (await apiRequest("GET", "/api/behaviour-board")).json(),
    refetchInterval: 30_000,
  });

  const active = data?.activeIncidents ?? [];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active.length]);

  if (hidden || active.length === 0) return null;

  // Show the most urgent (soonest-ending) timer; note how many others are running.
  const sorted = [...active].sort(
    (a, b) => new Date(a.timerEndsAt).getTime() - new Date(b.timerEndsAt).getTime(),
  );
  const soonest = sorted[0];
  const profile = profiles.find((p) => p.id === soonest.profileId);
  const remaining = new Date(soonest.timerEndsAt).getTime() - now;
  const expired = remaining <= 0;
  const more = active.length - 1;

  return (
    <button
      onClick={onOpen}
      data-testid="behaviour-timer-widget"
      title="Behavior timer running — tap to open the board"
      style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
      className={`fixed right-5 z-40 flex items-center gap-2 rounded-2xl border-2 px-3 py-2 shadow-lg transition-colors ${
        expired
          ? "border-destructive bg-destructive/10 animate-pulse"
          : "border-amber-400 bg-amber-50/95 dark:bg-amber-950/90"
      }`}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ backgroundColor: profile?.color || "#888" }}
      >
        {profile?.photoUrl ? (
          <img src={objectUrl(profile.photoUrl)} alt="" className="w-full h-full rounded-full object-cover" />
        ) : (
          profile?.initials || "?"
        )}
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span
          className={`flex items-center gap-1 text-base font-black tabular-nums ${
            expired ? "text-destructive" : "text-amber-700 dark:text-amber-300"
          }`}
        >
          <Timer className="w-3.5 h-3.5" />
          {expired ? "Time's up" : fmtRemaining(remaining)}
        </span>
        <span className="text-[10px] text-muted-foreground max-w-[8rem] truncate">
          {profile?.name || "In progress"}
          {more > 0 ? ` +${more} more` : ""}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}
