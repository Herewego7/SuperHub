// Pure derived level system based on chore points.
// Cumulative threshold for reaching level n is 25 * n * (n - 1).
// L1=0, L2=50, L3=150, L4=300, L5=500, L6=750, L7=1050, L8=1400, L9=1800, L10=2250...

export interface LevelInfo {
  level: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number;
  progress: number; // 0..1
  title: string;
}

const TITLES = [
  "Sprout",
  "Helper",
  "Apprentice",
  "Doer",
  "Ace",
  "Champion",
  "Hero",
  "Star",
  "Legend",
  "Hall of Famer",
];

function thresholdFor(level: number): number {
  return 25 * level * (level - 1);
}

export function levelFor(points: number): LevelInfo {
  const safePoints = Math.max(0, Math.floor(points || 0));
  let level = 1;
  while (thresholdFor(level + 1) <= safePoints) level++;
  const base = thresholdFor(level);
  const next = thresholdFor(level + 1);
  const span = Math.max(1, next - base);
  const pointsIntoLevel = safePoints - base;
  const pointsForNextLevel = next - safePoints;
  return {
    level,
    pointsIntoLevel,
    pointsForNextLevel,
    progress: Math.min(1, pointsIntoLevel / span),
    title: TITLES[Math.min(TITLES.length - 1, level - 1)],
  };
}
