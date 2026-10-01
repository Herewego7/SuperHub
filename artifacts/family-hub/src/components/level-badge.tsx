import { Trophy } from "lucide-react";
import { levelFor } from "@/lib/levels";

interface Props {
  points: number;
  profileId?: string;
  compact?: boolean;
}

export function LevelBadge({ points, profileId, compact = false }: Props) {
  const info = levelFor(points);
  const testId = profileId ? `level-badge-${profileId}` : "level-badge";

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1 text-xs font-medium text-purple-600"
        data-testid={testId}
      >
        <Trophy className="w-3.5 h-3.5" />
        <span>L{info.level}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-[88px]" data-testid={testId}>
      <div className="flex items-center gap-1 text-purple-600">
        <Trophy className="w-4 h-4" />
        <span className="font-bold text-sm">L{info.level}</span>
        <span className="text-xs text-muted-foreground">· {info.title}</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 transition-all"
          style={{ width: `${Math.round(info.progress * 100)}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {info.pointsForNextLevel} stars to L{info.level + 1}
      </div>
    </div>
  );
}
