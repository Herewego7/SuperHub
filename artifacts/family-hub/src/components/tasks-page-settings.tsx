import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Gift, Trophy, Sparkles, Settings, GripVertical, ChevronUp, ChevronDown, TrendingUp } from "lucide-react";
import { useSpotlight } from "@/lib/spotlight";

// The Tasks card itself is deliberately NOT part of this config — it's
// pinned first always (ChoresView must never unmount to preserve its own
// internal animation/state, per the comment at its render site in
// family-hub.tsx), so only the side cards are configurable here.
export interface TasksCardConfig {
  id: "rewards" | "trophies" | "bonus" | "starInsights";
  name: string;
  visible: boolean;
  order: number;
}

// Note: To-Dos used to be a card here; it moved to its own tab. A stored
// "todos" entry from before is dropped automatically by getTasksCardSettings
// (it filters ids not present in this default set), so no migration is needed.
export const DEFAULT_TASKS_CARD_CONFIG: TasksCardConfig[] = [
  { id: "rewards", name: "Rewards", visible: true, order: 0 },
  { id: "trophies", name: "Trophies", visible: true, order: 1 },
  { id: "bonus", name: "Bonus Chores", visible: true, order: 2 },
  // Off by default — a nice-to-have deep dive, not something every family
  // needs cluttering the Chores tab out of the box.
  { id: "starInsights", name: "Star Insights", visible: false, order: 3 },
];

const STORAGE_KEY = "tasksPageCardSettings_v1";

export function getTasksCardSettings(): TasksCardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const defaultById = new Map(DEFAULT_TASKS_CARD_CONFIG.map(d => [d.id, d]));
        const merged: TasksCardConfig[] = (parsed as Partial<TasksCardConfig>[])
          .filter(
            (c): c is TasksCardConfig =>
              typeof c?.id === "string" &&
              typeof c?.visible === "boolean" &&
              typeof c?.order === "number"
          )
          .filter(c => defaultById.has(c.id))
          .map(c => {
            const def = defaultById.get(c.id)!;
            // Rewards can never actually be hidden — it's the only place
            // that card is reachable from — so force it visible even if a
            // stale/tampered localStorage value says otherwise.
            const visible = c.id === "rewards" ? true : c.visible;
            return { ...def, order: c.order, visible };
          });
        const knownIds = new Set(merged.map(c => c.id));
        let nextOrder = merged.length;
        for (const def of DEFAULT_TASKS_CARD_CONFIG) {
          if (!knownIds.has(def.id)) {
            merged.push({ ...def, order: nextOrder++ });
          }
        }
        return merged;
      }
    }
  } catch (e) {
    console.error("Error reading Tasks card settings:", e);
  }
  return DEFAULT_TASKS_CARD_CONFIG;
}

export function saveTasksCardSettings(settings: TasksCardConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Error saving Tasks card settings:", e);
  }
}

interface TasksPageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: TasksCardConfig[]) => void;
  /** A card id (e.g. "starInsights") to scroll to and briefly highlight on
   * open — used by the "features you might have missed" nudge so its
   * action button lands on the exact row instead of just this dialog. */
  initialHighlightCardId?: string | null;
}

const getIcon = (id: TasksCardConfig["id"]) => {
  switch (id) {
    case "rewards":      return <Gift className="w-4 h-4" />;
    case "trophies":     return <Trophy className="w-4 h-4" />;
    case "bonus":        return <Sparkles className="w-4 h-4" />;
    case "starInsights": return <TrendingUp className="w-4 h-4" />;
  }
};

// Mirrors today-page-settings.tsx's TodayPageSettings exactly (same drag
// implementation, same ghost-card portal, same up/down arrows alongside the
// drag handle) — only the card set/copy differs, plus Rewards being
// permanently visible (no Switch) since it's the only place to manage
// rewards/cash-outs.
export function TasksPageSettings({ isOpen, onClose, onSettingsChange, initialHighlightCardId }: TasksPageSettingsProps) {
  const [cardSettings, setCardSettings] = useState<TasksCardConfig[]>(getTasksCardSettings());
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const cardRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragStateRef = useRef<{ id: string; order: TasksCardConfig[]; offsetX: number; offsetY: number } | null>(null);

  const { spotlight, spotlightOverlay } = useSpotlight();
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !initialHighlightCardId) return;
    setHighlightedCardId(initialHighlightCardId);
    const t = setTimeout(() => {
      cardRowRefs.current.get(initialHighlightCardId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      spotlight(`tasks-card-row-${initialHighlightCardId}`);
    }, 250);
    const clear = setTimeout(() => setHighlightedCardId(null), 3000);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [isOpen, initialHighlightCardId]);

  const reorder = (sorted: TasksCardConfig[], from: number, to: number) => {
    const next = [...sorted];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    return next.map((card, idx) => ({ ...card, order: idx }));
  };

  // Window-level listeners while dragging
  useEffect(() => {
    if (!draggedItem) return;
    const onMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const { offsetX, offsetY } = dragStateRef.current;
      setGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });
      let targetId: string | null = null;
      for (const [id, el] of cardRowRefs.current.entries()) {
        if (id === dragStateRef.current.id) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) { targetId = id; break; }
      }
      if (!targetId) return;
      const cur = dragStateRef.current.order;
      const from = cur.findIndex(c => c.id === dragStateRef.current!.id);
      const to = cur.findIndex(c => c.id === targetId);
      if (from === -1 || to === -1) return;
      const next = reorder(cur, from, to);
      dragStateRef.current.order = next;
      setCardSettings(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      setDraggedItem(null);
      setGhostPos(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [draggedItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = (e: React.PointerEvent, cardId: string) => {
    if ((e.target as HTMLElement).closest('[data-testid^="tasks-move-"], button, input, label, [role="switch"]')) return;
    e.preventDefault();
    const offsetX = 10;
    const offsetY = 16;
    const sorted = [...cardSettings].sort((a, b) => a.order - b.order);
    dragStateRef.current = { id: cardId, order: sorted, offsetX, offsetY };
    setDraggedItem(cardId);
    setGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  useEffect(() => {
    if (isOpen) setCardSettings(getTasksCardSettings());
  }, [isOpen]);

  const handleToggleVisibility = (cardId: string) => {
    if (cardId === "rewards") return; // always visible, no toggle
    setCardSettings(prev => prev.map(card => card.id === cardId ? { ...card, visible: !card.visible } : card));
  };

  const handleMoveUp = (cardId: string) => {
    const sorted = [...cardSettings].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex(c => c.id === cardId);
    if (index <= 0) return;
    [sorted[index - 1], sorted[index]] = [sorted[index], sorted[index - 1]];
    setCardSettings(sorted.map((card, idx) => ({ ...card, order: idx })));
  };

  const handleMoveDown = (cardId: string) => {
    const sorted = [...cardSettings].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex(c => c.id === cardId);
    if (index === -1 || index >= sorted.length - 1) return;
    [sorted[index], sorted[index + 1]] = [sorted[index + 1], sorted[index]];
    setCardSettings(sorted.map((card, idx) => ({ ...card, order: idx })));
  };

  const handleSave = () => {
    saveTasksCardSettings(cardSettings);
    onSettingsChange(cardSettings);
    onClose();
  };

  const handleReset = () => setCardSettings(DEFAULT_TASKS_CARD_CONFIG);

  const sortedCards = [...cardSettings].sort((a, b) => a.order - b.order);

  return (
    <>
    {spotlightOverlay}
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden !p-0" style={{ display: "flex", flexDirection: "column" }}>
        <DialogHeader className="flex-shrink-0 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Customize Tasks Page
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-4 overflow-y-auto overflow-x-hidden flex-1 px-6">
          <p className="text-sm text-muted-foreground mb-2">
            Toggle cards on/off and drag to reorder them below the Tasks card. Rewards always
            stays visible — it's the only place to manage rewards and cash-outs.
          </p>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 opacity-70">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
              <Settings className="w-4 h-4" />
            </div>
            <span className="flex-1 text-sm font-medium">Tasks (always first)</span>
          </div>

          <div className="space-y-2">
            {sortedCards.map((card, index) => (
              <div
                key={card.id}
                id={`tasks-card-row-${card.id}`}
                ref={(el) => { if (el) cardRowRefs.current.set(card.id, el); else cardRowRefs.current.delete(card.id); }}
                data-drag-card-id={card.id}
                onPointerDown={(e) => handlePointerDown(e, card.id)}
                className={`touch-none flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 cursor-move ${
                  draggedItem === card.id
                    ? "opacity-30 scale-95 bg-primary/10 border-primary"
                    : highlightedCardId === card.id
                      ? "bg-primary/10 ring-2 ring-primary border-primary"
                      : "border-border bg-card hover:bg-accent/50"
                } ${!card.visible ? "bg-muted/30" : ""}`}
                data-testid={`tasks-card-setting-${card.id}`}
              >
                <div className="flex items-center gap-1 text-muted-foreground">
                  <GripVertical className="w-4 h-4 cursor-grab" />
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(card.id)}
                      disabled={index === 0}
                      className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      data-testid={`tasks-move-up-${card.id}`}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(card.id)}
                      disabled={index === sortedCards.length - 1}
                      className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      data-testid={`tasks-move-down-${card.id}`}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-r from-yellow-500 to-orange-500 text-white">
                  {getIcon(card.id)}
                </div>

                <Label htmlFor={`tasks-toggle-${card.id}`} className="flex-1 text-sm font-medium cursor-pointer">
                  {card.name}
                </Label>

                {card.id === "rewards" ? (
                  <span className="text-[11px] text-muted-foreground">Always on</span>
                ) : (
                  <Switch
                    id={`tasks-toggle-${card.id}`}
                    checked={card.visible}
                    onCheckedChange={() => handleToggleVisibility(card.id)}
                    data-testid={`tasks-toggle-${card.id}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Ghost card portalled to body to escape modal transform */}
        {draggedItem && ghostPos && (() => {
          const card = cardSettings.find(c => c.id === draggedItem);
          if (!card) return null;
          return createPortal(
            <div
              style={{ position: 'fixed', left: ghostPos.x, top: ghostPos.y, pointerEvents: 'none', zIndex: 9999, width: 220 }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-primary bg-card shadow-2xl opacity-95 rotate-1"
            >
              <GripVertical className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-medium">{card.name}</span>
            </div>,
            document.body
          );
        })()}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 px-4 sm:px-6 py-4 border-t border-border flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive self-start sm:self-auto"
            onClick={handleReset}
            data-testid="reset-tasks-card-settings"
          >
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none" data-testid="cancel-tasks-card-settings">
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex-1 sm:flex-none" data-testid="save-tasks-card-settings">
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
