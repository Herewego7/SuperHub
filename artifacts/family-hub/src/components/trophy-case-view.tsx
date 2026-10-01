import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { objectUrl } from "@/lib/apiBase";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { Profile, Achievement, ChoreCompletion } from "@workspace/shared-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Trophy, Star, Flame, Medal, Crown, Target, Zap, Sparkles, Lock,
  ChevronDown, ChevronUp, Gift, DollarSign,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { LevelBadge } from "./level-badge";

interface TrophyCaseViewProps {
  selectedProfiles: string[];
  profiles: Profile[];
  /** When true, hide the view's own page title — it's shown by the enclosing card header. */
  embedded?: boolean;
  /** Called when a profile row is tapped in the all-family summary view. */
  onSelectProfile?: (profileId: string) => void;
}

type AchievementMeta = {
  type: string;
  title: string;
  description: string;
  icon: typeof Trophy;
  image?: string;
};

type FlyingParticle = {
  id: string;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
  rotation: number;
  emoji: string;
  size: number;
};

type StreakData = { streak: number; frozenDates?: string[] };

// Map lucide icon component → celebratory emoji for particle bursts
const ICON_EMOJI = new Map<typeof Trophy, string>([
  [Flame,      "🔥"],
  [Crown,      "👑"],
  [Medal,      "🏅"],
  [Trophy,     "🏆"],
  [Star,       "⭐"],
  [Target,     "🎯"],
  [Zap,        "⚡"],
  [Sparkles,   "✨"],
  [Gift,       "🎁"],
  [DollarSign, "💰"],
]);

const ALL_ACHIEVEMENTS: AchievementMeta[] = [
  // 🔥 Streak — Flame (8)
  { type: "streak_3",    title: "On a Roll",         description: "3 day streak",   icon: Flame, image: "/trophies/streak_3.png" },
  { type: "streak_7",    title: "Week Warrior",      description: "7 day streak",   icon: Flame, image: "/trophies/streak_7.png"  },
  { type: "streak_14",   title: "Two Week Champ",    description: "14 day streak",  icon: Flame, image: "/trophies/streak_14.png" },
  { type: "streak_30",   title: "Monthly Master",    description: "30 day streak",  icon: Flame, image: "/trophies/streak_30.png"  },
  { type: "streak_60",   title: "Unstoppable",       description: "60 day streak",  icon: Flame, image: "/trophies/streak_60.png"  },
  { type: "streak_90",   title: "Legend",            description: "90 day streak",  icon: Flame, image: "/trophies/streak_90.png"  },
  { type: "streak_180",  title: "Half-Year Hero",    description: "180 day streak", icon: Flame, image: "/trophies/streak_180.png" },
  { type: "streak_365",  title: "Year of Dedication",description: "365 day streak", icon: Flame, image: "/trophies/streak_365.png" },

  // 🧹 Chore Count — Broom (8)
  { type: "first_chore", title: "First Steps",       description: "Complete your first chore", icon: Trophy, image: "/trophies/chore_count_1.png"    },
  { type: "chores_10",   title: "Getting Started",   description: "Complete 10 chores",        icon: Trophy, image: "/trophies/chore_count_10.png"   },
  { type: "chores_25",   title: "Hard Worker",       description: "Complete 25 chores",        icon: Trophy, image: "/trophies/chore_count_25.png"   },
  { type: "chores_50",   title: "Super Helper",      description: "Complete 50 chores",        icon: Trophy, image: "/trophies/chore_count_50.png"   },
  { type: "chores_100",  title: "Chore Champion",    description: "Complete 100 chores",       icon: Trophy, image: "/trophies/chore_count_100.png"  },
  { type: "chores_200",  title: "Task Master",       description: "Complete 200 chores",       icon: Trophy, image: "/trophies/chore_count_200.png"  },
  { type: "chores_500",  title: "Hall of Fame",      description: "Complete 500 chores",       icon: Trophy, image: "/trophies/chore_count_500.png"  },
  { type: "chores_1000", title: "Chore Legend",      description: "Complete 1,000 chores",     icon: Trophy, image: "/trophies/chore_count_1000.png" },

  // ⭐ Star — Star (34)
  { type: "points_100",   title: "Star Spark",       description: "Earn 100 stars",       icon: Star, image: "/trophies/star_100.png"  },
  { type: "star_250",     title: "Star Seeker",      description: "Earn 250 stars",       icon: Star, image: "/trophies/star_250.png"  },
  { type: "points_500",   title: "Star Collector",   description: "Earn 500 stars",       icon: Star, image: "/trophies/star_500.png"  },
  { type: "star_750",     title: "Star Chaser",      description: "Earn 750 stars",       icon: Star, image: "/trophies/star_750.png"  },
  { type: "points_1000",  title: "Star Master",      description: "Earn 1,000 stars",     icon: Star, image: "/trophies/star_1000.png" },
  { type: "star_1250",    title: "Star Climber",     description: "Earn 1,250 stars",     icon: Star, image: "/trophies/star_1250.png" },
  { type: "star_1500",    title: "Star Gazer",       description: "Earn 1,500 stars",     icon: Star, image: "/trophies/star_1500.png" },
  { type: "star_1750",    title: "Star Striker",     description: "Earn 1,750 stars",     icon: Star, image: "/trophies/star_1750.png" },
  { type: "star_2000",    title: "Star Legend",      description: "Earn 2,000 stars",     icon: Star, image: "/trophies/star_2000.png" },
  { type: "star_2250",    title: "Star Blazer",      description: "Earn 2,250 stars",     icon: Star, image: "/trophies/star_2250.png" },

  // 🎁 Reward — Gift Box (5)
  { type: "first_reward_redeemed", title: "First Reward",       description: "Redeem your first reward", icon: Gift, image: "/trophies/reward_1.png"  },
  { type: "rewards_redeemed_10",   title: "Reward Regular",     description: "Redeem 10 rewards",        icon: Gift, image: "/trophies/reward_10.png" },
  { type: "rewards_redeemed_25",   title: "Reward Enthusiast",  description: "Redeem 25 rewards",        icon: Gift, image: "/trophies/reward_25.png"  },
  { type: "rewards_redeemed_50",   title: "Reward Connoisseur", description: "Redeem 50 rewards",        icon: Gift, image: "/trophies/reward_50.png"  },
  { type: "rewards_redeemed_100",  title: "Reward Royalty",     description: "Redeem 100 rewards",       icon: Gift, image: "/trophies/reward_100.png" },

  // ⚡ Bonus Chore — Lightning Bolt (24)
  { type: "first_bonus_chore",  title: "Extra Mile",         description: "Complete your first bonus chore", icon: Zap, image: "/trophies/bonus_chore_1.png"   },
  { type: "bonus_chores_10",    title: "Bonus Helper",       description: "Complete 10 bonus chores",        icon: Zap, image: "/trophies/bonus_chore_10.png"  },
  { type: "bonus_chores_25",    title: "Bonus Booster",      description: "Complete 25 bonus chores",        icon: Zap, image: "/trophies/bonus_chore_25.png"  },
  { type: "bonus_chores_50",    title: "Bonus Machine",      description: "Complete 50 bonus chores",        icon: Zap, image: "/trophies/bonus_chore_50.png"  },
  { type: "bonus_chores_100",   title: "Bonus Grinder",      description: "Complete 100 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_100.png" },
  { type: "bonus_chores_150",   title: "Bonus Dynamo",       description: "Complete 150 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_150.png" },
  { type: "bonus_chores_200",   title: "Bonus Charger",      description: "Complete 200 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_200.png" },
  { type: "bonus_chores_250",   title: "Bonus Surge",        description: "Complete 250 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_250.png" },
  { type: "bonus_chores_300",   title: "Bonus Spark",        description: "Complete 300 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_300.png" },
  { type: "bonus_chores_350",   title: "Bonus Blitz",        description: "Complete 350 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_350.png" },
  { type: "bonus_chores_400",   title: "Bonus Striker",      description: "Complete 400 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_400.png"  },
  { type: "bonus_chores_450",   title: "Bonus Voltage",      description: "Complete 450 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_450.png"  },
  { type: "bonus_chores_500",   title: "Bonus Legend",       description: "Complete 500 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_500.png"  },
  { type: "bonus_chores_750",   title: "Bonus Titan",        description: "Complete 750 bonus chores",       icon: Zap, image: "/trophies/bonus_chore_750.png"  },
  { type: "bonus_chores_1000",  title: "Bonus Conqueror",    description: "Complete 1,000 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_1000.png" },
  { type: "bonus_chores_1250",  title: "Bonus Vanguard",     description: "Complete 1,250 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_1250.png" },
  { type: "bonus_chores_1500",  title: "Bonus Apex",         description: "Complete 1,500 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_1500.png" },
  { type: "bonus_chores_1750",  title: "Bonus Pinnacle",     description: "Complete 1,750 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_1750.png" },
  { type: "bonus_chores_2000",  title: "Bonus Champion",     description: "Complete 2,000 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_2000.png" },
  { type: "bonus_chores_2250",  title: "Bonus Ascendant",    description: "Complete 2,250 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_2250.png" },
  { type: "bonus_chores_2500",  title: "Bonus Unstoppable",  description: "Complete 2,500 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_2500.png" },
  { type: "bonus_chores_2750",  title: "Bonus Transcendent", description: "Complete 2,750 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_2750.png" },
  { type: "bonus_chores_3000",  title: "Bonus Infinite",     description: "Complete 3,000 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_3000.png" },
  { type: "bonus_chores_5000",  title: "Bonus Absolute",     description: "Complete 5,000 bonus chores",     icon: Zap, image: "/trophies/bonus_chore_5000.png" },

  // 💰 Cash-Out — Coin (5)
  { type: "first_cashout", title: "First Cash-Out",   description: "Complete your first cash-out", icon: DollarSign, image: "/trophies/cashout_1.png"   },
  { type: "cashout_10",    title: "Cash-Out Regular",  description: "Complete 10 cash-outs",        icon: DollarSign, image: "/trophies/cashout_10.png"  },
  { type: "cashout_25",    title: "Cash-Out Pro",      description: "Complete 25 cash-outs",        icon: DollarSign, image: "/trophies/cashout_25.png"  },
  { type: "cashout_50",    title: "Cash-Out Expert",   description: "Complete 50 cash-outs",        icon: DollarSign, image: "/trophies/cashout_50.png"  },
  { type: "cashout_100",   title: "Cash-Out Legend",   description: "Complete 100 cash-outs",       icon: DollarSign, image: "/trophies/cashout_100.png" },

  // 🎯 Special (1)
  { type: "perfect_day", title: "Perfect Day!", description: "Complete every chore in a day", icon: Target, image: "/trophies/perfect_day.png" },
];

// Tier palette — position within a family maps to tier visuals
const TIER_PALETTE = [
  { cup1: "#c87941", cup2: "#8B4513", stem: "#7a3010", base1: "#7a3b10", base2: "#502205", shadow: "rgba(200,121,65,0.6)",  label: "Bronze"    },
  { cup1: "#d4934e", cup2: "#9a4a1a", stem: "#8B4513", base1: "#8a4515", base2: "#5c2a08", shadow: "rgba(212,147,78,0.6)",  label: "Bronze"    },
  { cup1: "#d8d8d8", cup2: "#8c8c8c", stem: "#6e6e6e", base1: "#5a5a5a", base2: "#363636", shadow: "rgba(180,180,180,0.6)", label: "Silver"    },
  { cup1: "#e6e6e6", cup2: "#a4a4a4", stem: "#808080", base1: "#686868", base2: "#464646", shadow: "rgba(204,204,204,0.6)", label: "Silver"    },
  { cup1: "#FFD700", cup2: "#C8960C", stem: "#A07010", base1: "#8a5e00", base2: "#5a3d00", shadow: "rgba(255,215,0,0.7)",   label: "Gold"      },
  { cup1: "#FFE566", cup2: "#D4A800", stem: "#B88800", base1: "#9a7000", base2: "#705000", shadow: "rgba(255,229,102,0.7)", label: "Gold"      },
  { cup1: "#e8d5ff", cup2: "#9b30ff", stem: "#7020cc", base1: "#3d0070", base2: "#220045", shadow: "rgba(155,48,255,0.7)",  label: "Legendary" },
  { cup1: "#fff5ff", cup2: "#cc88ff", stem: "#9940ee", base1: "#540090", base2: "#320060", shadow: "rgba(255,245,255,0.75)", label: "Legendary" },
] as const;

// Tier index per achievement type → maps to TIER_PALETTE (0=bronze … 7=legendary)
const TIER_INDEX_MAP: Record<string, number> = {
  // 🔥 Streak (8)
  streak_3: 0, streak_7: 1, streak_14: 2, streak_30: 3,
  streak_60: 4, streak_90: 5, streak_180: 6, streak_365: 7,

  // 🧹 Chore count (8)
  first_chore: 0, chores_10: 1, chores_25: 2, chores_50: 3,
  chores_100: 4, chores_200: 5, chores_500: 6, chores_1000: 7,

  // ⭐ Stars (34) — bronze→silver→gold→legendary across the range
  points_100: 0,  star_250: 0,  star_400: 1,  star_450: 1,
  points_500: 1,  star_750: 1,
  points_1000: 2, star_1250: 2,
  star_1500: 3,   star_1750: 3,
  star_2000: 4,   star_2250: 4, points_2500: 4, star_2750: 4,
  star_3000: 5,   star_3250: 5, star_3500: 5,   star_3750: 5,
  star_4000: 5,   star_4250: 5, star_4500: 5,   star_4750: 5,
  points_5000: 6, star_6000: 6, star_7000: 6,   star_8000: 6,
  star_9000: 6,   points_10000: 6,
  star_15000: 7,  star_20000: 7, points_25000: 7, star_30000: 7,
  star_35000: 7,  star_40000: 7, star_45000: 7,   points_50000: 7,

  // 🎁 Reward (5)
  first_reward_redeemed: 0, rewards_redeemed_10: 1, rewards_redeemed_25: 2,
  rewards_redeemed_50: 3, rewards_redeemed_100: 4,

  // ⚡ Bonus chore (24)
  first_bonus_chore: 0, bonus_chores_10: 0,
  bonus_chores_25: 1,   bonus_chores_50: 1,
  bonus_chores_100: 2,  bonus_chores_150: 2,
  bonus_chores_200: 3,  bonus_chores_250: 3,
  bonus_chores_300: 4,  bonus_chores_350: 4, bonus_chores_400: 4,
  bonus_chores_450: 5,  bonus_chores_500: 5, bonus_chores_750: 5,
  bonus_chores_1000: 6, bonus_chores_1250: 6, bonus_chores_1500: 6, bonus_chores_1750: 6,
  bonus_chores_2000: 7, bonus_chores_2250: 7, bonus_chores_2500: 7,
  bonus_chores_2750: 7, bonus_chores_3000: 7, bonus_chores_5000: 7,

  // 💰 Cash-out (5)
  first_cashout: 0, cashout_10: 1, cashout_25: 2, cashout_50: 3, cashout_100: 4,

  // 🎯 Special
  perfect_day: 5,
};

const CONGRATS_MESSAGES = [
  "What a superstar! 🌟",
  "Amazing work! 🎉",
  "You're unstoppable! 🚀",
  "Incredible achievement! 🏆",
  "You crushed it! 💪",
  "So proud of you! ❤️",
  "Absolutely legendary! ✨",
];

// ─── Trophy shape card ───────────────────────────────────────────────────────

interface TrophyCardProps {
  meta: AchievementMeta;
  earnedCount: number;
  earnedAt?: Date;
}

function TrophyCard({ meta, earnedCount, earnedAt }: TrophyCardProps) {
  const tierIndex = TIER_INDEX_MAP[meta.type] ?? 0;
  const pal = TIER_PALETTE[tierIndex];
  const IconComponent = meta.icon;
  const isEarned = earnedCount > 0;

  const cupStyle: React.CSSProperties = isEarned
    ? {
        background: `linear-gradient(145deg, ${pal.cup1} 0%, ${pal.cup2} 100%)`,
        boxShadow: `0 5px 16px ${pal.shadow}, inset 0 2px 5px rgba(255,255,255,0.38), inset 0 -2px 4px rgba(0,0,0,0.22)`,
      }
    : { background: "linear-gradient(145deg, #9a9a9a, #555555)" };

  const stemStyle: React.CSSProperties = {
    background: isEarned ? pal.stem : "#555",
    boxShadow: isEarned ? "inset 1px 0 2px rgba(255,255,255,0.15), inset -1px 0 2px rgba(0,0,0,0.3)" : "none",
  };

  const baseStyle: React.CSSProperties = isEarned
    ? {
        background: `linear-gradient(to bottom, ${pal.base1} 0%, ${pal.base2} 100%)`,
        boxShadow: `0 3px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)`,
      }
    : { background: "linear-gradient(to bottom, #555, #363636)" };

  return (
    <div className={cn("flex flex-col items-center", !isEarned && "opacity-35 grayscale")} style={{ width: 72 }}>
      {/* Trophy shape */}
      <div className="relative flex flex-col items-center">
        {/* ×N badge — only shown when earned multiple times */}
        {earnedCount > 1 && (
          <div
            className="absolute -top-1.5 -right-1 z-20 text-white font-bold rounded-full flex items-center justify-center"
            style={{ fontSize: 8, lineHeight: 1, padding: "2px 4px", background: "#f59e0b", minWidth: 16 }}
          >
            ×{earnedCount}
          </div>
        )}

        {meta.image ? (
          <img
            src={meta.image}
            alt={meta.title}
            style={{ width: 88, height: 96, objectFit: "contain", marginBottom: -8 }}
          />
        ) : (
          <>
            {/* Cup */}
            <div
              className="relative flex items-center justify-center overflow-hidden"
              style={{
                width: 54, height: 48,
                borderRadius: "50% 50% 22% 22% / 44% 44% 14% 14%",
                ...cupStyle,
              }}
            >
              {/* Gloss highlight */}
              <div className="absolute pointer-events-none" style={{
                top: 4, left: 6, width: 16, height: 16,
                background: "radial-gradient(circle, rgba(255,255,255,0.48) 0%, transparent 70%)",
                borderRadius: "50%",
              }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.22) 0%, transparent 55%)",
              }} />

              <IconComponent
                style={{
                  width: 24, height: 24, position: "relative", zIndex: 1,
                  color: isEarned ? "rgba(255,255,255,0.93)" : "rgba(170,170,170,0.7)",
                  filter: isEarned ? "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" : "none",
                }}
              />

              {!isEarned && (
                <Lock style={{
                  width: 10, height: 10, position: "absolute", bottom: 5, right: 5,
                  color: "rgba(160,160,160,0.85)", zIndex: 1,
                }} />
              )}
            </div>

            {/* Stem */}
            <div style={{ width: 9, height: 14, ...stemStyle }} />

            {/* Wing bar */}
            <div style={{
              width: 50, height: 6,
              background: isEarned ? pal.stem : "#555",
              borderRadius: 2,
              opacity: 0.85,
            }} />

            {/* Base — narrow, just visual */}
            <div style={{
              width: 58, height: 12,
              borderRadius: "0 0 6px 6px",
              ...baseStyle,
            }} />
          </>
        )}
      </div>

      {/* Caption — name + date outside the trophy shape */}
      <div className="text-center mt-2 px-0.5" style={{ width: 76 }}>
        <p
          className={cn("font-semibold leading-tight", isEarned ? "text-foreground" : "text-muted-foreground")}
          style={{ fontSize: 10, lineHeight: 1.3 }}
        >
          {meta.title}
        </p>
        {isEarned && earnedAt ? (
          <p className="text-muted-foreground mt-0.5" style={{ fontSize: 8 }}>
            {format(earnedAt, "MMM d, yy")}
          </p>
        ) : !isEarned ? (
          <p className="text-muted-foreground/50 mt-0.5" style={{ fontSize: 8 }}>
            {meta.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ─── Large trophy for dialog ─────────────────────────────────────────────────

function LargeTrophyDisplay({ meta }: { meta: AchievementMeta }) {
  const tierIndex = TIER_INDEX_MAP[meta.type] ?? 0;
  const pal = TIER_PALETTE[tierIndex];
  const IconComponent = meta.icon;

  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ scale: 0.5, rotate: -12 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 18 }}
    >
      {meta.image ? (
        <img
          src={meta.image}
          alt={meta.title}
          style={{ width: 148, height: 160, objectFit: "contain" }}
        />
      ) : (
        <>
          {/* Cup */}
          <div className="relative flex items-center justify-center overflow-hidden" style={{
            width: 88, height: 78,
            borderRadius: "50% 50% 22% 22% / 44% 44% 14% 14%",
            background: `linear-gradient(145deg, ${pal.cup1} 0%, ${pal.cup2} 100%)`,
            boxShadow: `0 10px 28px ${pal.shadow}, inset 0 3px 8px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.25)`,
          }}>
            <div className="absolute pointer-events-none" style={{
              top: 8, left: 11, width: 26, height: 26,
              background: "radial-gradient(circle, rgba(255,255,255,0.52) 0%, transparent 70%)", borderRadius: "50%",
            }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "linear-gradient(160deg, rgba(255,255,255,0.26) 0%, transparent 55%)",
            }} />
            <IconComponent style={{
              width: 40, height: 40, zIndex: 1, position: "relative",
              color: "rgba(255,255,255,0.95)",
              filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.45))",
            }} />
          </div>
          {/* Stem */}
          <div style={{
            width: 14, height: 26, background: pal.stem,
            boxShadow: "inset 2px 0 3px rgba(255,255,255,0.15), inset -2px 0 3px rgba(0,0,0,0.3)",
          }} />
          {/* Wing bar */}
          <div style={{ width: 80, height: 10, background: pal.stem, borderRadius: 3, opacity: 0.85 }} />
          {/* Base */}
          <div style={{
            width: 94, height: 22,
            borderRadius: "0 0 10px 10px",
            background: `linear-gradient(to bottom, ${pal.base1} 0%, ${pal.base2} 100%)`,
            boxShadow: `0 5px 14px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)`,
          }} />
        </>
      )}
      {/* Tier label */}
      <p className="mt-2 text-xs font-semibold text-muted-foreground tracking-wide uppercase">
        {pal.label} Trophy
      </p>
    </motion.div>
  );
}

// ─── Mini trophy cup (summary row, no text) ──────────────────────────────────

/**
 * The summary row's trophy strip, capped at three rows.
 *
 * Flex-wrap can't be asked how many rows it produced, so the strip is
 * measured: the number of children sharing the topmost offset IS the per-row
 * count, which needs no assumption about cup widths or gaps (they vary — an
 * image trophy is 32px, a drawn one 28, the +N chip something else again; an
 * arithmetic estimate got this wrong and let a fourth row through).
 * useLayoutEffect measures before paint, so the full uncapped strip never
 * flashes. Anything past three rows collapses into a "+N" chip; tapping it
 * does what tapping anywhere else on the row does — opens that person's full
 * trophy case.
 */
const MAX_TROPHY_ROWS = 3;

function TrophyStrip({ metas }: { metas: AchievementMeta[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      if (kids.length === 0) return;
      // Bottoms, not tops: items-end aligns the bottom edge, and cups vary in
      // height (an image trophy is 42px tall, a drawn one 25), so items in the
      // same visual row have different tops.
      const bottom = Math.round(kids[0].getBoundingClientRect().bottom);
      // Row one stays full even after capping, so this stays accurate on
      // every later measurement, not just the first.
      const firstRow = kids.filter(k => Math.round(k.getBoundingClientRect().bottom) === bottom).length;
      if (firstRow > 0) setPerRow(firstRow);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [metas.length]);

  const capacity = perRow === null ? metas.length : perRow * MAX_TROPHY_ROWS;
  const overflowing = metas.length > capacity;
  // The chip takes a slot, so one fewer cup is shown when it's there.
  const shown = overflowing ? metas.slice(0, capacity - 1) : metas;
  const hidden = metas.length - shown.length;

  return (
    <div ref={ref} className="flex items-end gap-1.5 flex-wrap" data-testid="trophy-strip">
      {shown.map(meta => (
        <MiniTrophyCup key={meta.type} meta={meta} />
      ))}
      {hidden > 0 && (
        <span
          className="shrink-0 h-[25px] px-1.5 inline-flex items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
          title={`${hidden} more — tap to see them all`}
          data-testid="trophy-strip-more"
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}

function MiniTrophyCup({ meta }: { meta: AchievementMeta }) {
  const tierIndex = TIER_INDEX_MAP[meta.type] ?? 0;
  const pal = TIER_PALETTE[tierIndex];
  const IconComponent = meta.icon;

  if (meta.image) {
    return (
      <div className="shrink-0" title={meta.title}>
        <img src={meta.image} alt={meta.title} style={{ width: 32, height: 42, objectFit: "contain" }} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center shrink-0"
      title={meta.title}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          width: 28, height: 25,
          borderRadius: "50% 50% 22% 22% / 44% 44% 14% 14%",
          background: `linear-gradient(145deg, ${pal.cup1} 0%, ${pal.cup2} 100%)`,
          boxShadow: `0 3px 8px ${pal.shadow}, inset 0 1px 3px rgba(255,255,255,0.38)`,
        }}
      >
        <div className="absolute pointer-events-none" style={{
          top: 3, left: 4, width: 8, height: 8,
          background: "radial-gradient(circle, rgba(255,255,255,0.5) 0%, transparent 70%)",
          borderRadius: "50%",
        }} />
        <IconComponent style={{ width: 12, height: 12, color: "rgba(255,255,255,0.93)", zIndex: 1, position: "relative" }} />
      </div>
      <div style={{ width: 5, height: 7, background: pal.stem }} />
      <div style={{ width: 26, height: 4, background: pal.stem, borderRadius: 1, opacity: 0.85 }} />
      <div style={{
        width: 30, height: 6, borderRadius: "0 0 3px 3px",
        background: `linear-gradient(to bottom, ${pal.base1} 0%, ${pal.base2} 100%)`,
      }} />
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function TrophyCaseView({ selectedProfiles, profiles, embedded = false, onSelectProfile }: TrophyCaseViewProps) {
  const queryClient = useQueryClient();
  const hasCheckedAchievements = useRef(false);
  const [flyingParticles, setFlyingParticles] = useState<FlyingParticle[]>([]);
  const [showLockedFor, setShowLockedFor] = useState<Set<string>>(new Set());
  const [selectedTrophy, setSelectedTrophy] = useState<{
    meta: AchievementMeta;
    earnedCount: number;
    earnedAt?: Date;
    congratsMsg: string;
  } | null>(null);

  const { data: achievements = [] } = useQuery<Achievement[]>({
    queryKey: ["/api/achievements"],
  });

  const { data: choreCompletions = [] } = useQuery<ChoreCompletion[]>({
    queryKey: ["/api/chore-completions"],
  });

  const checkAchievementsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/achievements/check-all");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.newAchievements?.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/achievements"] });
      }
    },
  });

  useEffect(() => {
    if (!hasCheckedAchievements.current && profiles.length > 0) {
      hasCheckedAchievements.current = true;
      checkAchievementsMutation.mutate();
    }
  }, [profiles]);

  const regularProfiles = profiles.filter(p => !p.isAllFamilyProfile);
  const displayProfiles = selectedProfiles.length > 0
    ? regularProfiles.filter(p => selectedProfiles.includes(p.id))
    : regularProfiles;

  // Per-profile streak data (same query keys as Chores tab — served from cache)
  const streakQueries = useQueries({
    queries: displayProfiles.map(p => ({
      queryKey: ["/api/streaks", p.id] as const,
      queryFn: async (): Promise<StreakData> => {
        const res = await apiRequest("GET", `/api/streaks/${p.id}`);
        return res.json();
      },
    })),
  });

  // Points per profile — the authoritative /api/points balance (matches the
  // star pills used everywhere else), not a client-side sum of completion
  // points. A client sum disagrees with the real balance the moment anything
  // besides a plain completion changes it: a redemption, a per_completion
  // checklist bonus, or a manual star adjustment.
  const profilePointsQueries = useQueries({
    queries: displayProfiles.map(profile => ({
      queryKey: ["/api/points", profile.id] as const,
      enabled: !!profile.id,
      staleTime: 15_000,
    })),
  });
  const pointsByProfile = useMemo(() => {
    const map = new Map<string, number>();
    displayProfiles.forEach((profile, i) => {
      const fallback = choreCompletions
        .filter(c => c.profileId === profile.id)
        .reduce((sum, c) => sum + (c.points || 0), 0);
      const authoritative = (profilePointsQueries[i]?.data as { points?: number } | undefined)?.points;
      map.set(profile.id, authoritative ?? fallback);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayProfiles, choreCompletions, profilePointsQueries.map(q => q.dataUpdatedAt).join(",")]);

  const getProfileAchievements = (profileId: string) =>
    achievements.filter(a => a.profileId === profileId);

  // Spawn 30 emoji particles from the click origin flying in all directions
  const triggerParticles = (originX: number, originY: number, meta: AchievementMeta) => {
    const emoji = ICON_EMOJI.get(meta.icon) ?? "⭐";
    const COUNT = 30;

    const particles: FlyingParticle[] = Array.from({ length: COUNT }, (_, i) => {
      const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = 110 + Math.random() * 330;
      return {
        id: `${Date.now()}-${i}`,
        originX,
        originY,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        duration: 0.85 + Math.random() * 0.95,
        delay: Math.random() * 0.22,
        rotation: (Math.random() - 0.5) * 720,
        emoji,
        size: 16 + Math.floor(Math.random() * 22),
      };
    });

    setFlyingParticles(particles);
    setTimeout(() => setFlyingParticles([]), 2400);
  };

  const handleTrophyClick = (
    e: React.MouseEvent,
    meta: AchievementMeta,
    earned: Achievement[],
  ) => {
    if (earned.length === 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    triggerParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, meta);

    const latest = earned.reduce((best, a) =>
      (a.earnedAt && (!best.earnedAt || new Date(a.earnedAt) > new Date(best.earnedAt))) ? a : best
    , earned[0]);
    setSelectedTrophy({
      meta,
      earnedCount: earned.length,
      earnedAt: latest.earnedAt ? new Date(latest.earnedAt) : undefined,
      congratsMsg: CONGRATS_MESSAGES[Math.floor(Math.random() * CONGRATS_MESSAGES.length)],
    });
  };

  const toggleLocked = (profileId: string) => {
    setShowLockedFor(prev => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  };

  // Summary view when more than one profile is selected
  const isAllFamily = selectedProfiles.length !== 1;

  return (
    <div className="space-y-6" data-testid="trophy-case-view">
      {/* Flying particles overlay — fixed, covers entire viewport */}
      <AnimatePresence>
        {flyingParticles.map(p => (
          <motion.span
            key={p.id}
            className="fixed pointer-events-none select-none"
            style={{ left: p.originX, top: p.originY, fontSize: p.size, zIndex: 9999, lineHeight: 1 }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1.6, rotate: 0 }}
            animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.15, rotate: p.rotation }}
            transition={{ duration: p.duration, delay: p.delay, ease: "easeOut" }}
          >
            {p.emoji}
          </motion.span>
        ))}
      </AnimatePresence>

      {!embedded && (
        <div>
          <h2 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            Trophy Case
          </h2>
          <p className="text-muted-foreground mt-1">
            {ALL_ACHIEVEMENTS.length} trophies to collect — there's always another one to earn!
          </p>
        </div>
      )}

      {/* ── All-family summary vs single-person detail ── */}
      <AnimatePresence mode="wait">
      {isAllFamily ? (
        <motion.div
          key="trophy-summary"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="space-y-2"
        >
          {displayProfiles.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Nobody to show yet</p>
          ) : (
            <>
              {displayProfiles.map((profile) => {
                const profileAchievements = getProfileAchievements(profile.id);
                const earnedByType = new Map<string, Achievement[]>();
                for (const a of profileAchievements) {
                  const list = earnedByType.get(a.type) ?? [];
                  list.push(a);
                  earnedByType.set(a.type, list);
                }
                const earnedMeta = ALL_ACHIEVEMENTS.filter(a => earnedByType.has(a.type));

                return (
                  <div
                    key={profile.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent/50 transition-colors cursor-pointer"
                    style={{ borderLeft: `3px solid ${profile.color}` }}
                    onClick={() => onSelectProfile?.(profile.id)}
                    data-testid={`trophy-summary-${profile.id}`}
                  >
                    {/* Avatar */}
                    <div
                      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{ background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` }}
                    >
                      {profile.photoUrl
                        ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" />
                        : profile.initials}
                    </div>

                    {/* Name + count */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-foreground truncate">{profile.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {earnedMeta.length}/{ALL_ACHIEVEMENTS.length} trophies
                        </span>
                      </div>

                      {/* Mini trophies row */}
                      {earnedMeta.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60">No trophies yet</p>
                      ) : (
                        <TrophyStrip metas={earnedMeta} />
                      )}
                    </div>
                  </div>
                );
              })}
              {onSelectProfile && (
                <p className="text-center text-xs text-muted-foreground pt-1 pb-1">
                  Tap a person to see their full trophy case
                </p>
              )}
            </>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="trophy-detail"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="space-y-6"
        >

      {displayProfiles.map((profile, profileIdx) => {
        const profileAchievements = getProfileAchievements(profile.id);

        // Group by type — supports future repeatable achievements
        const earnedByType = new Map<string, Achievement[]>();
        for (const a of profileAchievements) {
          const list = earnedByType.get(a.type) ?? [];
          list.push(a);
          earnedByType.set(a.type, list);
        }

        const earnedMeta  = ALL_ACHIEVEMENTS.filter(a =>  earnedByType.has(a.type));
        const lockedMeta  = ALL_ACHIEVEMENTS.filter(a => !earnedByType.has(a.type));
        const earnedCount = earnedMeta.length;
        const showLocked  = showLockedFor.has(profile.id);

        // Stats for this profile
        const points     = pointsByProfile.get(profile.id) ?? 0;
        const streakData = streakQueries[profileIdx]?.data;
        const streak     = streakData?.streak ?? 0;

        // When embedded (inside the Chores-page card), render flat — no nested card.
        // When standalone, wrap in the full Card/CardHeader.
        const trophyContent = (
          <>
            {/* Slim stats row — streak + collected count only when embedded */}
            {embedded && (
              <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border">
                {streak > 0 && (
                  <div className="flex items-center gap-1 text-orange-500 shrink-0">
                    <Flame className="w-4 h-4" />
                    <span className="text-sm font-bold">{streak}</span>
                    <span className="text-xs text-muted-foreground">day streak</span>
                  </div>
                )}
                <span className={`text-xs text-muted-foreground ${streak > 0 ? 'ml-auto' : ''} shrink-0`}>
                  {earnedCount} / {ALL_ACHIEVEMENTS.length} collected
                </span>
              </div>
            )}

            {earnedMeta.length === 0 ? (
                <div className="text-center py-8">
                  <Trophy className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">No trophies yet — complete chores to earn one.</p>
                </div>
              ) : (
                /* Earned trophies — flat grid, no sub-sections */
                <div className="flex flex-wrap gap-x-3 gap-y-5">
                  {earnedMeta.map((meta) => {
                    const earned = earnedByType.get(meta.type)!;
                    const latest = earned.reduce((best, a) =>
                      (a.earnedAt && (!best.earnedAt || new Date(a.earnedAt) > new Date(best.earnedAt))) ? a : best
                    , earned[0]);
                    return (
                      <motion.div
                        key={meta.type}
                        className="cursor-pointer select-none"
                        whileHover={{ y: -4, scale: 1.05 }}
                        whileTap={{ scale: 0.82, rotate: -3 }}
                        onClick={(e) => handleTrophyClick(e, meta, earned)}
                        data-testid={`achievement-${meta.type}`}
                      >
                        <TrophyCard
                          meta={meta}
                          earnedCount={earned.length}
                          earnedAt={latest.earnedAt ? new Date(latest.earnedAt) : undefined}
                        />
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Locked trophies toggle */}
              {lockedMeta.length > 0 && (
                <div className="mt-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground hover:text-foreground gap-2 border border-dashed border-muted-foreground/30"
                    onClick={() => toggleLocked(profile.id)}
                  >
                    {showLocked ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {showLocked ? "Hide" : `Show ${lockedMeta.length} locked`} trophies
                  </Button>

                  <AnimatePresence>
                    {showLocked && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-wrap gap-x-3 gap-y-5 pt-5">
                          {lockedMeta.map((meta) => (
                            <div key={meta.type} className="select-none" data-testid={`achievement-${meta.type}-locked`}>
                              <TrophyCard
                                meta={meta}
                                earnedCount={0}
                              />
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
          </>
        );

        return embedded ? (
          <div key={profile.id} data-testid={`profile-trophies-${profile.id}`} className="space-y-4">
            {trophyContent}
          </div>
        ) : (
          <div key={profile.id} className="space-y-4">
          <Card className="overflow-hidden" data-testid={`profile-trophies-${profile.id}`}>
            <CardHeader className="pb-3" style={{ backgroundColor: `${profile.color}18` }}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0" style={{ backgroundColor: profile.color }}>
                    {profile.photoUrl ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" /> : profile.initials}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-xl truncate">{profile.name}'s Trophies</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">{earnedCount} / {ALL_ACHIEVEMENTS.length} collected</p>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-2 gap-y-1">
                  <div className="flex items-center gap-1 text-yellow-500 shrink-0">
                    <Star className="w-7 h-7 fill-current" />
                    <span className="text-xl font-bold">{points}</span>
                    <span className="text-base text-muted-foreground hidden sm:inline">stars</span>
                  </div>
                  <span className="shrink-0"><LevelBadge points={points} profileId={profile.id} /></span>
                  {streak > 0 && (
                    <div className="flex items-center gap-1 text-orange-500 shrink-0">
                      <Flame className="w-5 h-5" />
                      <span className="font-bold">{streak}</span>
                      <span className="text-sm text-muted-foreground hidden sm:inline">day streak</span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-5 pb-6">{trophyContent}</CardContent>
          </Card>
          </div>
        );
      })}

      {displayProfiles.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Nobody to show yet</h3>
          </CardContent>
        </Card>
      )}
        </motion.div>
      )}
      </AnimatePresence>

      {/* Trophy detail dialog */}
      <Dialog open={!!selectedTrophy} onOpenChange={(open) => { if (!open) setSelectedTrophy(null); }}>
        {selectedTrophy && (
          <DialogContent className="max-w-xs text-center">
            <DialogHeader className="sr-only">
              <DialogTitle>{selectedTrophy.meta.title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 pt-2 pb-2">
              <LargeTrophyDisplay meta={selectedTrophy.meta} />

              {selectedTrophy.earnedCount > 1 && (
                <div className="px-3 py-1 rounded-full text-sm font-bold text-white bg-amber-500">
                  ×{selectedTrophy.earnedCount} earned
                </div>
              )}

              <div className="space-y-1">
                <p className="text-2xl">{selectedTrophy.congratsMsg}</p>
                <p className="font-semibold text-base text-foreground">{selectedTrophy.meta.title}</p>
                <p className="text-muted-foreground text-sm">{selectedTrophy.meta.description}</p>
                {selectedTrophy.earnedAt && (
                  <p className="text-xs text-muted-foreground">
                    Earned {format(selectedTrophy.earnedAt, "MMMM d, yyyy")}
                  </p>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
