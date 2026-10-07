import { useQuery } from "@tanstack/react-query";
import type { RewardSettings } from "@workspace/shared-types";
import { cn } from "@/lib/utils";

export const TASK_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: "chore",        label: "Chore",        emoji: "🧹" },
  { value: "todo",         label: "To-Do",        emoji: "✅" },
  { value: "memory_verse", label: "Memory Verse", emoji: "📖" },
  { value: "affirmation",  label: "Affirmation",  emoji: "💬" },
  { value: "bible_verse",  label: "Bible Verse",  emoji: "📜" },
  { value: "mission",      label: "Mission",      emoji: "❤️" },
  { value: "custom",       label: "Other",        emoji: "📝" },
];

export function taskTypeMeta(value: string | null | undefined) {
  return TASK_TYPES.find(t => t.value === value) ?? TASK_TYPES[0];
}

// Rough effort-based point tiers, shown as tappable suggestions next to the
// Points field — families consistently ask "how many points should this be
// worth?" with no anchor to start from. Converts to the family's actual
// $-per-point rate (already configured in Rewards & Approvals) so the
// suggestion reads as a real dollar amount, not an abstract number.
const POINT_TIERS: { label: string; points: number }[] = [
  { label: "Quick (a few min)", points: 1 },
  { label: "Medium (10–20 min)", points: 3 },
  { label: "Big job (30+ min)", points: 6 },
];

export function PointsSuggestionHint({
  points,
  onPick,
}: {
  points: number;
  onPick: (n: number) => void;
}) {
  const { data: rewardSettings } = useQuery<RewardSettings>({ queryKey: ["/api/reward-settings"] });
  const centsPerPoint = rewardSettings?.centsPerPoint ?? 0;
  const dollarValue = (n: number) => ((n * centsPerPoint) / 100).toFixed(2);

  return (
    <div className="mt-1.5 space-y-1">
      {centsPerPoint > 0 && points > 0 && (
        <p className="text-xs text-muted-foreground">≈ ${dollarValue(points)} at your family's rate</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {POINT_TIERS.map((tier) => (
          <button
            key={tier.points}
            type="button"
            onClick={() => onPick(tier.points)}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border transition-colors",
              points === tier.points
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent",
            )}
          >
            {tier.label}: {tier.points}{centsPerPoint > 0 ? ` (~$${dollarValue(tier.points)})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
