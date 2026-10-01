import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { objectUrl } from "@/lib/apiBase";
import { isKidProfile } from "@/lib/parentGate";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Moon, Sunrise, CalendarDays, Flame, Star } from "lucide-react";
import type { Profile } from "@workspace/shared-types";

const WEEKDAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const BRIEF_SECTIONS: Array<[string, string]> = [
  ["events", "Events"],
  ["chores", "Chores"],
  ["meals", "Meals"],
  ["driving", "Driving"],
  ["celebrations", "Celebrations"],
];

/**
 * One place for everything that's set per-person — bedtime reminder, daily
 * morning brief (time + which sections), weekly recap (day + time), and streak
 * days-off. Previously these were scattered across the Notifications and
 * Streaks sections and grouped by control (all bedtimes together, etc.); here
 * they're grouped by PERSON (expand a person → see all of their settings),
 * which is far easier to reason about. Every control PATCHes /api/profiles/:id
 * and invalidates ["/api/profiles"] — the same source of truth the rest of the
 * app reads, so edits show up everywhere.
 */
export function PerPersonSettingsSection({
  profiles,
  sections = "all",
}: {
  profiles: Profile[];
  /**
   * Which blocks to render. These controls now live in two different Settings
   * sections (reminders under Notifications, stars/streaks under Rewards &
   * Approvals) but share this one accordion so every control keeps its exact
   * behaviour, testid, and save path. "all" is the original everything-in-one
   * rendering, kept for any caller that wants it.
   */
  sections?: "all" | "reminders" | "rewards";
}) {
  const showReminders = sections !== "rewards";
  const showRewards = sections !== "reminders";
  const { toast } = useToast();
  const qc = useQueryClient();
  const realProfiles = profiles.filter((p) => !p.isAllFamilyProfile);
  // Nothing expanded by default. Auto-opening the first person made the list
  // look like it was already showing you something, and put that one person's
  // settings in front of you whether or not they were the one you came for.
  const [openId, setOpenId] = useState<string | null>(null);

  // Only needed to decide whether to show the per-person daily-checklist
  // bonus (it only means anything in per_completion stars mode) and to show
  // the family-wide default as the placeholder.
  const { data: rewardSettings } = useQuery<{ pointsMode?: string; completionBonusPoints?: number }>({
    queryKey: ["/api/reward-settings"],
  });
  const perCompletionMode = rewardSettings?.pointsMode === "per_completion";
  const familyBonus = rewardSettings?.completionBonusPoints ?? 10;

  const patchProfile = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/profiles/${id}`, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/profiles"] });
      // Brief/recap scheduling is derived from these, so nudge those too.
      if ("dailyBriefTime" in vars.body || "dailyBriefSections" in vars.body) {
        qc.invalidateQueries({ queryKey: ["/api/daily-brief"] });
      }
      // The profile editor toasts on save; match it so a change here doesn't
      // feel like it silently vanished.
      toast({ title: "Saved" });
    },
    onError: (err: any) => toast({ title: err?.message || "Couldn't save that setting", variant: "destructive" }),
  });
  const save = (id: string, body: Record<string, unknown>) => patchProfile.mutate({ id, body });

  if (realProfiles.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">Add a person first to configure their reminders and streaks.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {showReminders && !showRewards
          ? "When each person's reminders fire. Leave a time blank to turn that reminder off. Whether a reminder actually arrives on a given phone or tablet is set per device, above."
          : showRewards && !showReminders
            ? "Stars and streak days for each person."
            : "Reminders and streak days for each person, all in one place. Leave a time blank to turn that reminder off."}
      </p>
      {realProfiles.map((p) => {
        const open = openId === p.id;
        const sections = {
          events: true, chores: true, meals: true, driving: true, celebrations: true,
          ...(((p as unknown as { dailyBriefSections?: Record<string, boolean> }).dailyBriefSections) ?? {}),
        };
        const weeklyRecapDay = (p as unknown as { weeklyRecapDay?: number }).weeklyRecapDay ?? 0;
        const weeklyRecapTime = (p as unknown as { weeklyRecapTime?: string }).weeklyRecapTime ?? "";
        const skipDays = p.streakSkipDays ?? [];
        return (
          <div key={p.id} className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : p.id)}
              className="w-full flex items-center gap-2.5 p-2.5 bg-accent/30 hover:bg-accent/50 transition-colors text-left"
              data-testid={`per-person-header-${p.id}`}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 overflow-hidden"
                style={{ backgroundColor: p.color }}
              >
                {p.photoUrl ? <img src={objectUrl(p.photoUrl)} alt="" className="w-full h-full object-cover" /> : p.initials}
              </div>
              <span className="font-medium text-sm text-foreground flex-1 min-w-0 truncate">{p.name}</span>
              {isKidProfile(p) && (
                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">Kid</span>
              )}
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>

            {open && (
              <div className="p-3 space-y-4 border-t border-border">
                {showReminders && (<>
                {/* Bedtime */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-sm font-medium">Bedtime chore reminder</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    A push at this local time if any chores are still unchecked.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      type="time"
                      className="w-32 h-8 shrink-0 appearance-none"
                      defaultValue={p.bedtimeCutoff ?? ""}
                      onBlur={(e) => { const v = e.target.value || null; if (v !== (p.bedtimeCutoff ?? null)) save(p.id, { bedtimeCutoff: v }); }}
                      data-testid={`input-bedtime-${p.id}`}
                    />
                    {/* A native time input's own "Reset"/clear control is
                        the BROWSER's chrome, not this app's — it doesn't
                        reliably fire a real onChange/onBlur, so tapping it
                        never actually saved the field back to blank/off.
                        This explicit button directly clears the input's
                        value and saves null, same pattern already used
                        elsewhere in the app for a native date input's
                        equally-unreliable clear "x". */}
                    {p.bedtimeCutoff && (
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.parentElement?.querySelector('input[type="time"]') as HTMLInputElement | null;
                          if (input) input.value = "";
                          save(p.id, { bedtimeCutoff: null });
                        }}
                        className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                        data-testid={`clear-bedtime-${p.id}`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Daily brief */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Sunrise className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-sm font-medium">Daily morning brief</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    A morning push with today's items.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      type="time"
                      className="w-32 h-8 shrink-0 appearance-none"
                      defaultValue={p.dailyBriefTime ?? ""}
                      onBlur={(e) => { const v = e.target.value || null; if (v !== (p.dailyBriefTime ?? null)) save(p.id, { dailyBriefTime: v }); }}
                      data-testid={`input-brief-${p.id}`}
                    />
                    {p.dailyBriefTime && (
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.parentElement?.querySelector('input[type="time"]') as HTMLInputElement | null;
                          if (input) input.value = "";
                          save(p.id, { dailyBriefTime: null });
                        }}
                        className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                        data-testid={`clear-brief-${p.id}`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {p.dailyBriefTime ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {BRIEF_SECTIONS.map(([key, label]) => (
                        <label key={key} className="inline-flex items-center gap-1.5 text-xs cursor-pointer rounded-md border px-2 py-1">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={!!sections[key as keyof typeof sections]}
                            onChange={(e) => save(p.id, { dailyBriefSections: { ...sections, [key]: e.target.checked } })}
                            data-testid={`brief-section-${p.id}-${key}`}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Weekly recap */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-sm font-medium">Weekly recap</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    A weekly summary of chores done and stars earned.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={weeklyRecapDay}
                      onChange={(e) => save(p.id, { weeklyRecapDay: Number(e.target.value) })}
                      className="w-28 h-8 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                      data-testid={`select-weekly-recap-day-${p.id}`}
                    >
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => (
                        <option key={i} value={i}>{day}</option>
                      ))}
                    </select>
                    <Input
                      type="time"
                      className="w-32 h-8 shrink-0 appearance-none"
                      defaultValue={weeklyRecapTime}
                      onBlur={(e) => { const v = e.target.value || null; if (v !== (weeklyRecapTime || null)) save(p.id, { weeklyRecapTime: v }); }}
                      data-testid={`input-weekly-recap-${p.id}`}
                    />
                    {weeklyRecapTime && (
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.parentElement?.querySelector('input[type="time"]') as HTMLInputElement | null;
                          if (input) input.value = "";
                          save(p.id, { weeklyRecapTime: null });
                        }}
                        className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                        data-testid={`clear-weekly-recap-${p.id}`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                </>)}

                {showRewards && (<>
                {/* Daily checklist bonus (per_completion stars mode only) */}
                {perCompletionMode && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-sm font-medium">Daily checklist bonus</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      Stars {p.name} earns for finishing all their chores. Set here, it beats the family default ({familyBonus}) — leave blank to use that instead.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        inputMode="numeric"
                        className="w-24 h-8"
                        placeholder={String(familyBonus)}
                        defaultValue={p.completionBonusPoints ?? ""}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === "" ? null : Math.max(0, Math.min(10000, parseInt(raw, 10) || 0));
                          if (next !== (p.completionBonusPoints ?? null)) save(p.id, { completionBonusPoints: next });
                        }}
                        data-testid={`input-completion-bonus-${p.id}`}
                      />
                      <span className="text-xs text-muted-foreground">⭐ per finished day</span>
                    </div>
                  </div>
                )}

                {/* Streak days off */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-sm font-medium">Streak days off</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Days that don't count as chore days — missing one won't break their streak.
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pt-0.5">
                    {WEEKDAYS.map((day) => {
                      const checked = skipDays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => {
                            const next = checked ? skipDays.filter((d) => d !== day.value) : [...skipDays, day.value].sort((a, b) => a - b);
                            save(p.id, { streakSkipDays: next });
                          }}
                          className={`h-7 px-2 rounded text-xs font-medium border transition-colors ${
                            checked ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"
                          }`}
                          data-testid={`skip-day-${p.id}-${day.value}`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                </>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
