import { useState, useMemo } from "react";
import { Reward, Profile } from "@workspace/shared-types";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Edit, Trash2, Star, Plus } from "lucide-react";
import { confirmDialog } from "@/lib/confirmDialog";

interface RewardManagementDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rewards: Reward[];
  profiles: Profile[];
  onEdit: (reward: Reward) => void;
  onDelete: (rewardId: string) => void;
  onAddNew: () => void;
}

export function RewardManagementDrawer({
  open,
  onOpenChange,
  rewards,
  profiles,
  onEdit,
  onDelete,
  onAddNew,
}: RewardManagementDrawerProps) {
  const [search, setSearch] = useState("");

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const filtered = useMemo(() => {
    return [...rewards]
      .filter(r => {
        if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.pointsCost - b.pointsCost);
  }, [rewards, search]);

  // Styled confirm (the app-wide pattern) instead of the old "tap again
  // within 3s" toggle, whose only affordance was a hover tooltip — invisible
  // on touch devices.
  const handleDeleteClick = async (reward: { id: string; title: string }) => {
    if (await confirmDialog({ title: `Delete the "${reward.title}" reward?` })) {
      onDelete(reward.id);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col gap-0"
        style={{ width: "100%", maxWidth: "min(100vw, 480px)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border flex-shrink-0 pr-12">
          <div className="flex-1 min-w-0">
            <SheetTitle className="text-lg font-bold leading-tight">Manage Rewards</SheetTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rewards.length} reward{rewards.length !== 1 ? "s" : ""} total
            </p>
          </div>
          <Button size="sm" className="gap-1.5 rounded-full flex-shrink-0" onClick={() => { onOpenChange(false); onAddNew(); }}>
            <Plus className="w-4 h-4" />
            Create new
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search rewards…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm bg-background"
            />
          </div>
        </div>

        {/* Reward list */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-16">
              {rewards.length === 0 ? (
                <p className="text-muted-foreground text-sm">No rewards yet. Add one from the Rewards page.</p>
              ) : (
                <p className="text-muted-foreground text-sm">No rewards match your search.</p>
              )}
            </div>
          ) : (
            <ul>
              {filtered.map(reward => {
                const scopeProfile = reward.scopeProfileId ? profileById.get(reward.scopeProfileId) : null;

                return (
                  <li
                    key={reward.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-border/60 hover:bg-accent/30 transition-colors"
                    style={{ minHeight: 60 }}
                  >
                    {/* Icon */}
                    <span className="text-2xl leading-none shrink-0 w-8 text-center">{reward.icon ?? "🎁"}</span>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground truncate max-w-[180px]">
                          {reward.title}
                        </span>
                        <div className="flex items-center gap-0.5 text-yellow-500 shrink-0">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          <span className="text-xs font-bold">{reward.pointsCost}</span>
                        </div>
                      </div>
                      {reward.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                          {reward.description}
                        </p>
                      )}
                      {scopeProfile && (
                        <div className="flex items-center gap-1 mt-1">
                          <div
                            className="w-3.5 h-3.5 rounded-full border border-white"
                            style={{ backgroundColor: scopeProfile.color }}
                          />
                          <span className="text-[10px] text-muted-foreground">{scopeProfile.name} only</span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          onEdit(reward);
                          onOpenChange(false);
                        }}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
                        title="Edit reward"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(reward)}
                        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                        aria-label="Delete reward"
                        title="Delete reward"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer count when filtered */}
        {search ? (
          <div className="px-4 py-2 border-t border-border bg-muted/20 flex-shrink-0">
            <p className="text-xs text-muted-foreground text-center">
              Showing {filtered.length} of {rewards.length} rewards
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
