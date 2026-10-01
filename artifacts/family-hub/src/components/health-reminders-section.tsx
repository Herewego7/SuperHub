import { Capacitor } from "@capacitor/core";
import { invalidateHealthReminders } from "@/lib/healthReminderQueries";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pill, Stethoscope, RefreshCw, Bell, Plus, Pause, Play, Trash2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@workspace/shared-types";

type ScheduleKind = "once" | "daily" | "weekly" | "monthly";
type Schedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "monthly"; time: string; dayOfMonth: number };

interface HealthReminder {
  id: string;
  profileId: string;
  type: "medication" | "appointment" | "refill" | "generic";
  title: string;
  dose: string | null;
  location: string | null;
  notes: string | null;
  scheduleJson: Schedule;
  recipientsJson: string[];
  snoozeMinutes: number;
  isPaused: boolean;
  startsAt: string;
  endsAt: string | null;
}

const TYPE_META: Record<HealthReminder["type"], { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  medication: { icon: Pill, label: "Medication", color: "text-rose-500" },
  appointment: { icon: Stethoscope, label: "Appointment", color: "text-blue-500" },
  refill: { icon: RefreshCw, label: "Refill", color: "text-amber-500" },
  generic: { icon: Bell, label: "Reminder", color: "text-violet-500" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * `<input type="time">` always yields 24-hour "HH:MM" regardless of locale,
 * so printing it raw showed a military-time schedule on the card while the
 * editor's own picker showed am/pm. Nothing else in this app uses 24-hour
 * time.
 */
function formatTime12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h) || h < 0 || h > 23) return hhmm;
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${min} ${suffix}`;
}

function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case "once":
      return `Once · ${new Date(s.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    case "daily":
      return `Every day at ${formatTime12h(s.time)}`;
    case "weekly":
      return `${s.days.map((d) => WEEKDAYS[d]).join(", ")} at ${formatTime12h(s.time)}`;
    case "monthly":
      return `Day ${s.dayOfMonth} of each month at ${formatTime12h(s.time)}`;
  }
}

interface Props {
  profile: Profile;
  allProfiles: Profile[];
}

export function HealthRemindersSection({ profile, allProfiles }: Props) {
  const [editing, setEditing] = useState<HealthReminder | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { toast } = useToast();

  const { data: reminders = [] } = useQuery<HealthReminder[]>({
    queryKey: [`/api/health-reminders?profileId=${profile.id}&includePaused=true`],
  });

  const togglePause = useMutation({
    mutationFn: async (r: HealthReminder) => {
      const res = await apiRequest("POST", `/api/health-reminders/${r.id}/${r.isPaused ? "resume" : "pause"}`);
      return res.json();
    },
    onSuccess: () => invalidateHealthReminders(queryClient),
    onError: (err: any) => toast({ title: "Couldn't update the reminder", description: err?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/health-reminders/${id}`);
    },
    onSuccess: () => {
      invalidateHealthReminders(queryClient);
      toast({ title: "Reminder deleted" });
    },
    onError: (err: any) => toast({ title: "Couldn't delete the reminder", description: err?.message, variant: "destructive" }),
  });

  const open = editing ?? (showAdd ? null : undefined);

  return (
    // The id is the scroll/spotlight target for the "Manage" button on Home's
    // "Health reminders to acknowledge" card. That used to aim at the whole
    // Tasks card, which on a phone is chores, to-dos, bonus, goals and
    // inspiration stacked above this — so it dimmed most of the screen and
    // left the reminders themselves half off the bottom (2026-09-29).
    <section id={`health-reminders-${profile.id}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {/* Same colour as the heading beside it, which is what every other
            section in a person's card does — To-dos, Bonus, Goals,
            Inspiration and Chores all use a muted glyph. A red pill made this
            one heading read as a warning rather than as a section
            (2026-09-14). The individual reminder rows below still carry their
            own type colours. */}
        <Pill className="w-3.5 h-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Health reminders</h4>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => setShowAdd(true)}
          data-testid={`button-add-health-reminder-${profile.id}`}
        >
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>
      {/* Web only, and deliberately: in the app these reminders are handed to
          iOS and fire on their own, so there is nothing to warn about. In a
          browser they depend on the server being awake to send them, which is
          not something we can promise — saying so is better than a reminder
          quietly not arriving. */}
      {!Capacitor.isNativePlatform() && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="health-reminders-web-notice">
          Reminders are most reliable in the Family&nbsp;Hub+ app, which can alert
          you even when it&rsquo;s closed. In a browser they may arrive late or
          not at all.
        </p>
      )}
      {reminders.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No reminders yet — tap Add to set up a medication, appointment, or refill reminder.</p>
      ) : (
        <ul className="space-y-1.5">
          {reminders.map((r) => {
            const meta = TYPE_META[r.type] ?? TYPE_META.generic;
            const Icon = meta.icon;
            return (
              <li
                key={r.id}
                className={`p-2 rounded-lg border ${
                  r.isPaused ? "bg-muted/30 border-muted" : "bg-card border-border"
                }`}
                data-testid={`health-reminder-${r.id}`}
              >
                {/* Single row: icon + title/badge on the left, both controls
                    inline on the right — was a 3-icon vertical stack
                    (pause/edit/delete) that made every card as tall as three
                    stacked buttons regardless of how little text it had.
                    Delete moved into the Edit dialog itself (bottom, next to
                    Cancel/Save) — Pause and Edit are the only actions common
                    enough to deserve a one-tap spot on the card. */}
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 flex-shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    {r.isPaused && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">Paused</Badge>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => togglePause.mutate(r)}
                    title={r.isPaused ? "Resume" : "Pause"}
                  >
                    {r.isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setEditing(r)} title="Edit">
                    <Pencil className="w-3 h-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground pl-6">{describeSchedule(r.scheduleJson)}</p>
                {(r.dose || r.location) && (
                  <p className="text-xs text-muted-foreground pl-6">
                    {[r.dose, r.location].filter(Boolean).join(" • ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(showAdd || editing) && (
        <ReminderEditor
          key={editing?.id ?? "new"}
          profile={profile}
          allProfiles={allProfiles}
          existing={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onDelete={editing ? () => remove.mutate(editing.id) : undefined}
        />
      )}
      {/* avoid unused-warning: open variable used implicitly above */}
      <span hidden>{open === null ? "" : ""}</span>
    </section>
  );
}

export function ReminderEditor({
  profile,
  allProfiles,
  existing,
  onClose,
  onDelete,
}: {
  profile: Profile;
  allProfiles: Profile[];
  existing: HealthReminder | null;
  onClose: () => void;
  /** Only ever set when editing a real reminder (never on create) — deletes
   * it and closes the dialog. Undefined hides the Delete link entirely. */
  onDelete?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const initialKind: ScheduleKind = existing?.scheduleJson.kind ?? "daily";
  const [kind, setKind] = useState<ScheduleKind>(initialKind);
  const [type, setType] = useState<HealthReminder["type"]>(existing?.type ?? "medication");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [dose, setDose] = useState(existing?.dose ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [snoozeMinutes, setSnoozeMinutes] = useState(existing?.snoozeMinutes ?? 15);
  const [time, setTime] = useState(
    existing?.scheduleJson.kind && existing.scheduleJson.kind !== "once"
      ? (existing.scheduleJson as { time: string }).time
      : "09:00",
  );
  // Separate date + time inputs (not one datetime-local): the combined iOS
  // control has a fixed intrinsic width that overflows narrow dialogs — the
  // exact bug event-modal.tsx was migrated off this pattern for. Formatted
  // LOCALLY on purpose; the old code used toISOString().slice(0,16) (UTC),
  // which prefilled the picker shifted by the timezone offset.
  const onceInitial =
    existing?.scheduleJson.kind === "once"
      ? new Date(existing.scheduleJson.at)
      : new Date(Date.now() + 60 * 60 * 1000);
  const [onceDate, setOnceDate] = useState(
    `${onceInitial.getFullYear()}-${String(onceInitial.getMonth() + 1).padStart(2, "0")}-${String(onceInitial.getDate()).padStart(2, "0")}`,
  );
  const [onceTime, setOnceTime] = useState(
    `${String(onceInitial.getHours()).padStart(2, "0")}:${String(onceInitial.getMinutes()).padStart(2, "0")}`,
  );
  const [days, setDays] = useState<number[]>(
    existing?.scheduleJson.kind === "weekly" ? existing.scheduleJson.days : [1, 2, 3, 4, 5],
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(
    existing?.scheduleJson.kind === "monthly" ? existing.scheduleJson.dayOfMonth : 1,
  );
  const [recipients, setRecipients] = useState<string[]>(
    existing?.recipientsJson?.length ? existing.recipientsJson : [profile.id],
  );

  const save = useMutation({
    mutationFn: async () => {
      const scheduleJson: Schedule =
        kind === "once" ? { kind: "once", at: new Date(`${onceDate}T${onceTime}`).toISOString() }
        : kind === "daily" ? { kind: "daily", time }
        : kind === "weekly" ? { kind: "weekly", time, days: days.slice().sort() }
        : { kind: "monthly", time, dayOfMonth };
      const body = {
        profileId: profile.id,
        type,
        title: title.trim(),
        dose: dose.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        scheduleJson,
        recipientsJson: recipients,
        snoozeMinutes,
      };
      if (existing) {
        const res = await apiRequest("PATCH", `/api/health-reminders/${existing.id}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/health-reminders", body);
      return res.json();
    },
    onSuccess: () => {
      invalidateHealthReminders(qc);
      qc.invalidateQueries({ queryKey: ["/api/health-reminder-events?unack=true"] });
      toast({ title: existing ? "Reminder updated" : "Reminder created" });
      onClose();
    },
    onError: (err) => {
      toast({ title: "Could not save", description: String(err), variant: "destructive" });
    },
  });

  const canSave = title.trim().length > 0 && (kind !== "weekly" || days.length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit reminder" : "New health reminder"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as HealthReminder["type"])} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="health-reminder-type-select">
              <option value="medication">💊 Medication</option>
              <option value="appointment">🩺 Appointment</option>
              <option value="refill">🔁 Refill</option>
              <option value="generic">🔔 Generic</option>
            </select>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Take Lisinopril" />
          </div>
          {type === "medication" && (
            <div>
              <Label>Dose</Label>
              <Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 10mg, 1 tablet" />
            </div>
          )}
          {type === "appointment" && (
            <div>
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Dr. Patel's office" />
            </div>
          )}
          <div>
            <Label>Schedule</Label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="health-reminder-schedule-select">
              <option value="once">One time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {kind === "once" && (
            <div>
              <Label>When</Label>
              {/* Same sizing rules as the event modal's Start/End rows: on a
                  wide screen an unconstrained flex-1 date field stretches to
                  fill the whole dialog while the fixed-width time field stays
                  too narrow to render "04:30 PM" (Chrome drops the AM/PM
                  entirely below ~128px). Cap the pair and widen the time field
                  from md: up; phone widths keep their existing sizing. */}
              <div className="flex gap-2 md:max-w-sm">
                <Input type="date" value={onceDate} onChange={(e) => setOnceDate(e.target.value)} className="flex-1 min-w-0 appearance-none" />
                <Input type="time" value={onceTime} onChange={(e) => setOnceTime(e.target.value)} className="w-28 md:w-36 shrink-0 appearance-none" />
              </div>
            </div>
          )}
          {kind !== "once" && (
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="appearance-none" />
            </div>
          )}
          {kind === "weekly" && (
            <div>
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {WEEKDAYS.map((d, i) => {
                  const active = days.includes(i);
                  return (
                    <button
                      type="button"
                      key={d}
                      onClick={() =>
                        setDays(active ? days.filter((x) => x !== i) : [...days, i])
                      }
                      className={`px-2 py-1 text-xs rounded border ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {kind === "monthly" && (
            <div>
              <Label>Day of month</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
          )}
          <div>
            <Label>Notify</Label>
            <div className="space-y-1 mt-1 max-h-32 overflow-y-auto rounded border p-2">
              {allProfiles.filter((p) => !p.isAllFamilyProfile).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={recipients.includes(p.id)}
                    onCheckedChange={(c) =>
                      setRecipients(c ? [...recipients, p.id] : recipients.filter((x) => x !== p.id))
                    }
                  />
                  <span style={{ color: p.color }}>●</span>
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Snooze (minutes)</Label>
            <Input
              type="number"
              min={1}
              max={240}
              value={snoozeMinutes}
              onChange={(e) => setSnoozeMinutes(Math.min(240, Math.max(1, Number(e.target.value) || 15)))}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        {/* Matches Edit Event's footer: in edit mode Delete and Cancel share
            a row at equal, lower weight with Save as its own full-width
            primary button below, so the save action reads as the one default
            rather than three same-size buttons competing. Create mode has
            nothing to delete, so it keeps the simpler Cancel + Create pair. */}
        <div className={existing && onDelete ? "flex flex-col gap-2 pt-1" : "flex items-center gap-2 pt-1"}>
          {existing && onDelete ? (
            <>
              {/* Cancel left, Delete right — same order as Edit Event, where
                  keeping the irreversible action off the easiest thumb reach
                  was a deliberate call (audit finding EDIT-2). */}
              <div className="flex items-center gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (await confirmDialog({ title: "Delete this reminder?" })) {
                      onDelete();
                      onClose();
                    }
                  }}
                  data-testid={`delete-health-reminder-${existing.id}`}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete
                </Button>
              </div>
              <Button
                className="w-full font-semibold shadow-sm"
                disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}
                data-testid="save-health-reminder"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1 font-semibold shadow-sm"
                disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}
                data-testid="save-health-reminder"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {save.isPending ? "Saving…" : "Create"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
