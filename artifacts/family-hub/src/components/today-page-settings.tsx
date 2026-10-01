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
import { GripVertical, Calendar, TrendingUp, Clock, Trophy, Settings, MessageSquare, Megaphone, ChevronUp, ChevronDown } from "lucide-react";

export interface CardConfig {
  id: string;
  name: string;
  icon: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_CARD_CONFIG: CardConfig[] = [
  { id: "events", name: "Events", icon: "calendar", visible: true, order: 0 },
  { id: "progress", name: "Tasks", icon: "trending-up", visible: true, order: 1 },
  { id: "points", name: "Stars", icon: "star", visible: true, order: 2 },
  { id: "activity", name: "Recent Activity", icon: "clock", visible: true, order: 3 },
  { id: "achievements", name: "Achievements", icon: "trophy", visible: false, order: 4 },
];

const STORAGE_KEY = "todayPageCardSettings_v5";

export function getCardSettings(): CardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migrate: keep only well-formed entries, then append any cards from
        // defaults missing in stored config so we never lose user customizations
        // when adding new cards.
        const defaultById = new Map(DEFAULT_CARD_CONFIG.map(d => [d.id, d]));
        const merged: CardConfig[] = (parsed as Partial<CardConfig>[])
          .filter(
            (c): c is CardConfig =>
              typeof c?.id === "string" &&
              typeof c?.name === "string" &&
              typeof c?.icon === "string" &&
              typeof c?.visible === "boolean" &&
              typeof c?.order === "number"
          )
          // Drop ids that no longer exist as a default card (e.g. cards removed in a later release)
          .filter(c => defaultById.has(c.id))
          .map(c => {
            // Always use canonical name/icon from defaults to prevent stale/swapped labels
            const def = defaultById.get(c.id)!;
            return { ...c, name: def.name, icon: def.icon };
          });
        const knownIds = new Set(merged.map(c => c.id));
        let nextOrder = merged.length;
        for (const def of DEFAULT_CARD_CONFIG) {
          if (!knownIds.has(def.id)) {
            merged.push({ ...def, order: nextOrder++ });
          }
        }
        return merged;
      }
    }
  } catch (e) {
    console.error("Error reading card settings:", e);
  }
  return DEFAULT_CARD_CONFIG;
}

export function saveCardSettings(settings: CardConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Error saving card settings:", e);
  }
}

interface TodayPageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: CardConfig[]) => void;
}

const getIconComponent = (iconName: string) => {
  switch (iconName) {
    case "calendar":       return <Calendar className="w-4 h-4" />;
    case "trending-up":    return <TrendingUp className="w-4 h-4" />;
    case "clock":          return <Clock className="w-4 h-4" />;
    case "trophy":         return <Trophy className="w-4 h-4" />;
    case "message-square": return <MessageSquare className="w-4 h-4" />;
    case "megaphone":      return <Megaphone className="w-4 h-4" />;
    default:               return <Settings className="w-4 h-4" />;
  }
};

export function TodayPageSettings({ isOpen, onClose, onSettingsChange }: TodayPageSettingsProps) {
  const [cardSettings, setCardSettings] = useState<CardConfig[]>(getCardSettings());
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const cardRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragStateRef = useRef<{ id: string; order: CardConfig[]; offsetX: number; offsetY: number } | null>(null);

  const reorder = (sorted: CardConfig[], from: number, to: number) => {
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
      // find target row
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
    if ((e.target as HTMLElement).closest('[data-testid^="move-"], button, input, label, [role="switch"]')) return;
    e.preventDefault();
    const offsetX = 10;
    const offsetY = 16;
    const sorted = [...cardSettings].sort((a, b) => a.order - b.order);
    dragStateRef.current = { id: cardId, order: sorted, offsetX, offsetY };
    setDraggedItem(cardId);
    setGhostPos({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  useEffect(() => {
    if (isOpen) {
      setCardSettings(getCardSettings());
    }
  }, [isOpen]);

  const handleToggleVisibility = (cardId: string) => {
    const updated = cardSettings.map(card => 
      card.id === cardId ? { ...card, visible: !card.visible } : card
    );
    setCardSettings(updated);
  };

  const handleMoveUp = (cardId: string) => {
    const sortedCards = [...cardSettings].sort((a, b) => a.order - b.order);
    const index = sortedCards.findIndex(c => c.id === cardId);
    if (index <= 0) return;

    [sortedCards[index - 1], sortedCards[index]] = [sortedCards[index], sortedCards[index - 1]];
    
    const updated = sortedCards.map((card, idx) => ({
      ...card,
      order: idx
    }));
    setCardSettings(updated);
  };

  const handleMoveDown = (cardId: string) => {
    const sortedCards = [...cardSettings].sort((a, b) => a.order - b.order);
    const index = sortedCards.findIndex(c => c.id === cardId);
    if (index === -1 || index >= sortedCards.length - 1) return;

    [sortedCards[index], sortedCards[index + 1]] = [sortedCards[index + 1], sortedCards[index]];
    
    const updated = sortedCards.map((card, idx) => ({
      ...card,
      order: idx
    }));
    setCardSettings(updated);
  };

  const handleSave = () => {
    saveCardSettings(cardSettings);
    onSettingsChange(cardSettings);
    onClose();
  };

  const handleReset = () => {
    setCardSettings(DEFAULT_CARD_CONFIG);
  };

  const sortedCards = [...cardSettings].sort((a, b) => a.order - b.order);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden !p-0" style={{ display: "flex", flexDirection: "column" }}>
        <DialogHeader className="flex-shrink-0 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Customize Home Page
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-4 overflow-y-auto overflow-x-hidden flex-1 px-6">
          <p className="text-sm text-muted-foreground mb-4">
            Toggle cards on/off and drag to reorder them on your Today page.
          </p>

          <div className="space-y-2">
            {sortedCards.map((card, index) => (
              <div
                key={card.id}
                ref={(el) => { if (el) cardRowRefs.current.set(card.id, el); else cardRowRefs.current.delete(card.id); }}
                data-drag-card-id={card.id}
                onPointerDown={(e) => handlePointerDown(e, card.id)}
                className={`touch-none flex items-center gap-3 p-3 rounded-lg border transition-all duration-150 cursor-move ${
                  draggedItem === card.id
                    ? "opacity-30 scale-95 bg-primary/10 border-primary"
                    : "border-border bg-card hover:bg-accent/50"
                } ${!card.visible ? "bg-muted/30" : ""}`}
                data-testid={`card-setting-${card.id}`}
              >
                <div className="flex items-center gap-1 text-muted-foreground">
                  <GripVertical className="w-4 h-4 cursor-grab" />
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(card.id)}
                      disabled={index === 0}
                      className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      data-testid={`move-up-${card.id}`}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(card.id)}
                      disabled={index === sortedCards.length - 1}
                      className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      data-testid={`move-down-${card.id}`}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  card.id === "events" ? "bg-gradient-to-r from-blue-500 to-indigo-500" :
                  card.id === "progress" ? "bg-gradient-to-r from-blue-500 to-indigo-500" :
                  card.id === "activity" ? "bg-gradient-to-r from-green-500 to-teal-500" :
                  "bg-gradient-to-r from-yellow-500 to-orange-500"
                } text-white`}>
                  {getIconComponent(card.icon)}
                </div>

                <Label 
                  htmlFor={`toggle-${card.id}`}
                  className="flex-1 text-sm font-medium cursor-pointer"
                >
                  {card.name}
                </Label>

                <Switch
                  id={`toggle-${card.id}`}
                  checked={card.visible}
                  onCheckedChange={() => handleToggleVisibility(card.id)}
                  data-testid={`toggle-${card.id}`}
                />
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
            data-testid="reset-card-settings"
          >
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 sm:flex-none"
              data-testid="cancel-card-settings"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="flex-1 sm:flex-none"
              data-testid="save-card-settings"
            >
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
