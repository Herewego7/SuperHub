import { useState } from "react";
import { Bell, ListTodo, Sparkles, Users, Link2, ChefHat, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FeatureNudgeId =
  | "notifications"
  | "todos"
  | "starInsights"
  | "perPerson"
  | "shareLinks"
  | "mealIdeas";

export interface FeatureNudgeCard {
  id: FeatureNudgeId;
  title: string;
  description: string;
}

const CARD_META: Record<FeatureNudgeId, { icon: React.ElementType; title: string; description: string }> = {
  notifications: {
    icon: Bell,
    title: "Get reminders on this device",
    description: "Push notifications aren't fully set up yet — turn them on so nobody misses a reminder.",
  },
  todos: {
    icon: ListTodo,
    title: "Try the To-Dos tab",
    description: "One-time to-dos, separate from recurring chores. Hidden right now.",
  },
  starInsights: {
    icon: Sparkles,
    title: "See stars over time",
    description: "See how stars are earned and spent over time. Off by default.",
  },
  perPerson: {
    icon: Users,
    title: "Set up per-person schedules",
    description: "Bedtime and daily brief times can be tailored to each family member — nobody's set theirs yet.",
  },
  shareLinks: {
    icon: Link2,
    title: "Share with caretakers",
    description: "Make a read-only link to this week's schedule for a grandparent or babysitter.",
  },
  mealIdeas: {
    icon: ChefHat,
    title: "Import a recipe",
    description: "Snap a photo or paste a link — we'll pull in the recipe.",
  },
};

interface FeatureNudgeSheetProps {
  open: boolean;
  cards: FeatureNudgeId[];
  onDismiss: () => void;
  onAction: (id: FeatureNudgeId) => void;
}

export function FeatureNudgeSheet({ open, cards, onDismiss, onAction }: FeatureNudgeSheetProps) {
  if (!open || cards.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[1900] flex items-end sm:items-center justify-center bg-black/50" onClick={onDismiss}>
      <div
        className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl bg-card border border-border shadow-xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-xs font-medium text-primary uppercase tracking-wide">A few weeks in</p>
            <h2 className="text-lg font-bold">A few things you might have missed</h2>
          </div>
          <button
            onClick={onDismiss}
            className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Quick wins based on how your family's been using SuperHub so far.
        </p>

        <div className="space-y-3">
          {cards.map((id) => {
            const meta = CARD_META[id];
            const Icon = meta.icon;
            return (
              <div key={id} className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon className="h-4.5 w-4.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{meta.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => onAction(id)}>
                    Turn it on
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={onDismiss}
          className="w-full text-center text-sm text-muted-foreground mt-4 py-1 hover:text-foreground"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
