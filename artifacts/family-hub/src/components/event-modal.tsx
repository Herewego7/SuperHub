import { useState, useEffect, useRef } from "react";
import { objectUrl } from "@/lib/apiBase";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profile } from "@workspace/shared-types";
import { CommentThread } from "./comment-thread";
import { ChevronDown, X } from "lucide-react";

// See the descriptionRef auto-grow effect below for why this cap exists.
const MAX_DESCRIPTION_HEIGHT_PX = 240;

// Outlook's wording, deliberately: "Repeat every 2 weeks on Mon, Tue" is the
// pattern every other calendar uses (iCalendar FREQ=WEEKLY;INTERVAL=2;BYDAY),
// and anything synced out has to round-trip as that. Calling it "daily, on
// these days" would quietly mean something different from the calendars these
// events sit next to.
const RECURRENCE_UNIT: Record<string, string> = {
  none: "", daily: "day", weekly: "week", monthly: "month", annually: "year",
};

const WEEKDAYS = [
  { value: 0, label: "S", name: "Sunday" },
  { value: 1, label: "M", name: "Monday" },
  { value: 2, label: "T", name: "Tuesday" },
  { value: 3, label: "W", name: "Wednesday" },
  { value: 4, label: "T", name: "Thursday" },
  { value: 5, label: "F", name: "Friday" },
  { value: 6, label: "S", name: "Saturday" },
];

// "Repeat every N". Its own text state on purpose: a controlled number input
// clamped on every keystroke can never be emptied — the 1 comes straight back,
// so the only reachable values are the ones that start with 1, and typing a
// third digit clamps the lot to 99. Reported 2026-09-12. Digits only, two of
// them, empty allowed while typing, and the clamp happens on blur.
function IntervalInput({
  value, onChange, testIdPrefix,
}: { value: number; onChange: (n: number) => void; testIdPrefix: string }) {
  const [text, setText] = useState(String(value));
  // Follow the form when it changes underneath (a different event opened),
  // but never while the field is being typed into.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <Input
      id={`${testIdPrefix}-repeat-every`}
      type="text"
      inputMode="numeric"
      maxLength={2}
      className="h-10 w-16 text-center"
      value={text}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
        setText(digits);
        const n = Number(digits);
        if (n >= 1) onChange(n);
      }}
      onBlur={() => {
        focused.current = false;
        const n = Math.max(1, Math.min(99, Number(text) || 1));
        setText(String(n));
        onChange(n);
      }}
      aria-label="Repeat every"
      data-testid={`${testIdPrefix}-repeat-interval-input`}
    />
  );
}

// ⚠️ Module scope, not inside the modal's render body. A component declared
// in a render body remounts on every keystroke — dropped focus, dismissed
// keyboards — and this codebase has been bitten by exactly that four times
// (SettingsSection, DayToggle, ChoreForm, AvatarToggle).
function WeekdayPicker({
  value, onChange, testIdPrefix,
}: { value: number[]; onChange: (days: number[]) => void; testIdPrefix: string }) {
  return (
    // relative + z-10 and 44px targets: one specific day was reported as hard
    // to hit (2026-09-12) while its neighbours were fine, which is the
    // signature of something sitting over part of the row rather than of the
    // handler. This lifts the row above anything that might, and brings the
    // buttons up to the 44px minimum touch target they were under at 36px.
    <div
      className="relative z-10 flex gap-1.5 flex-wrap touch-manipulation"
      data-testid={`${testIdPrefix}-weekday-picker`}
    >
      {WEEKDAYS.map((d) => {
        const on = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={d.name}
            onClick={() => onChange(on ? value.filter(v => v !== d.value) : [...value, d.value].sort((a, b) => a - b))}
            className={`h-11 w-11 rounded-full text-sm font-semibold transition-colors border ${
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-input hover:bg-accent"
            }`}
            data-testid={`${testIdPrefix}-weekday-${d.value}`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}


/**
 * Picking people. Used for both "Assign to" and "Who's driving?", which ask the
 * same question and so should look and behave the same — the driver field used
 * to be a single-value native select, which is also why only one person could
 * drive.
 */
function PeoplePicker({
  label, profiles, selectedIds, onChange, allowEmpty, placeholder, testIdPrefix,
}: {
  label: string;
  profiles: Profile[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allowEmpty: boolean;
  placeholder: string;
  testIdPrefix: string;
}) {
  const selectable = profiles.filter((p) => !p.isAllFamilyProfile);
  const allSelected = selectable.length > 0 && selectable.every((p) => selectedIds.includes(p.id));
  const canRemoveLast = allowEmpty || selectedIds.length > 1;

  const avatar = (profile: Profile, size: string) => (
    <div
      className={`${size} rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0`}
      style={{ background: `linear-gradient(135deg, ${profile.color}, ${profile.color}90)` }}
    >
      {profile.photoUrl
        ? <img src={objectUrl(profile.photoUrl)} alt={profile.name} className="w-full h-full rounded-full object-cover" />
        : profile.initials}
    </div>
  );

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2">
        {/* DropdownMenu (not Select) so picking several people is one
            continuous session — Radix's Select closes on every selection by
            design, which made assigning multiple people a repeated
            open/pick/reopen/pick cycle. onSelect's preventDefault keeps this
            menu open across checks. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal text-muted-foreground"
              data-testid={`${testIdPrefix}-assign-dropdown`}
            >
              <span>
                {selectedIds.length === 0 ? placeholder : `${selectedIds.length} selected`}
              </span>
              {/* Without a caret this read as a filled text field rather than
                  something that opens a menu. */}
              <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuCheckboxItem
              checked={allSelected}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => {
                if (!checked && !allowEmpty) return;
                onChange(checked ? selectable.map((p) => p.id) : []);
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                  👨‍👩‍👧‍👦
                </div>
                <span className="text-sm font-medium">All Family Members</span>
              </div>
            </DropdownMenuCheckboxItem>
            {selectable.map((profile) => (
              <DropdownMenuCheckboxItem
                key={profile.id}
                checked={selectedIds.includes(profile.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => {
                  if (!checked && !canRemoveLast) return;
                  onChange(
                    checked
                      ? [...selectedIds, profile.id]
                      : selectedIds.filter((id) => id !== profile.id),
                  );
                }}
              >
                <div className="flex items-center gap-2">
                  {avatar(profile, "w-6 h-6")}
                  <span className="text-sm">{profile.name}</span>
                </div>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {selectedIds.map((profileId) => {
              const profile = profiles.find((p) => p.id === profileId);
              if (!profile) return null;
              return (
                <div
                  key={profileId}
                  className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-1"
                  data-testid={`${testIdPrefix}-selected-${profile.name.toLowerCase()}`}
                >
                  {avatar(profile, "w-5 h-5")}
                  <span className="text-sm font-medium">{profile.name}</span>
                  {canRemoveLast && (
                    <button
                      type="button"
                      onClick={() => onChange(selectedIds.filter((id) => id !== profileId))}
                      className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                      data-testid={`${testIdPrefix}-remove-${profile.name.toLowerCase()}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

export interface EventFormData {
  title: string;
  location: string;
  description: string;
  isAllDay: boolean;
  profileIds: string[];
  /**
   * Who is driving. A set, not an order — one person may drop off and another
   * pick up, and the app doesn't distinguish. Empty means nobody's driving.
   */
  drivingProfileIds: string[];
  recurrenceType: "none" | "daily" | "weekly" | "monthly" | "annually";
  recurrenceEndDate: string | null;
  /** "Repeat every N days/weeks/months/years" — Outlook's Recur every N box. */
  recurrenceInterval?: number;
  /** Weekly only: which weekdays it lands on (0=Sunday). Empty/undefined means
   *  the start date's own weekday, which is what every event created before
   *  2026-09-12 means. */
  daysOfWeek?: number[];
}

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: EventFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  isEditing: boolean;
  profiles: Profile[];
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  selectedSlot: { start: Date; end: Date } | null;
  setSelectedSlot: (slot: { start: Date; end: Date } | null) => void;
  selectedEvent?: any;
  isSubmitting?: boolean;
  isDeleting?: boolean;
  resetForm?: () => void;
  testIdPrefix?: string;
  imagePreviewUrl?: string | null;
  highlightDrivingField?: boolean;
}

/**
 * EDIT-1: `<input type="date">` only accepts "yyyy-MM-dd". The events table
 * stores a timestamp, so over JSON recurrenceEndDate arrives as a full ISO
 * string ("2026-12-30T00:00:00.000Z") — which the input silently rejects and
 * renders BLANK, so a bounded series looks like it repeats forever.
 *
 * Three of the four call sites remembered to slice it; calendar3-view didn't.
 * Rather than patch the fourth (which is how this happened), the modal now
 * accepts either form, so no future caller can get it wrong.
 *
 * Read the UTC date part of an ISO string rather than going through `new
 * Date()` — these are date-only values stored at UTC midnight, and parsing
 * then re-formatting in local time shifts them back a day west of UTC. That
 * is the same bug already fixed for celebrations and all-day events.
 */
function toDateInputValue(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : format(v, "yyyy-MM-dd");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;           // already right
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(v);
  if (m) return m[1];                                      // ISO — take the date part
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
}

/**
 * Stand-in for the Start/End time inputs while "All day" is checked.
 *
 * A native <input type="time"> renders its own "--:--" when empty and has no
 * settable placeholder, so a blank field read as broken rather than as
 * deliberate. This is a plain box, sized to match the input it replaces, that
 * says what's actually true. The real time isn't lost — it lives on in
 * selectedSlot and reappears the moment the box is unchecked.
 */
function AllDayTimeBox({ testId }: { testId: string }) {
  return (
    <div
      className="flex h-10 w-[8rem] md:w-36 shrink-0 items-center rounded-md border border-input bg-background px-3 text-base text-muted-foreground md:text-sm"
      data-testid={testId}
      aria-hidden
    >
      All day
    </div>
  );
}


export function EventModal({
  isOpen,
  onClose,
  onSubmit,
  onDelete,
  isEditing,
  profiles,
  formData,
  setFormData,
  selectedSlot,
  setSelectedSlot,
  selectedEvent,
  isSubmitting = false,
  isDeleting = false,
  resetForm = () => {},
  testIdPrefix = "event",
  imagePreviewUrl = null,
  highlightDrivingField = false,
}: EventModalProps) {
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);
  const drivingFieldRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && highlightDrivingField && drivingFieldRef.current) {
      drivingFieldRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isOpen, highlightDrivingField]);

  // Who's driving / Location / Description are collapsed behind "More
  // details" by default for a plain quick event — but auto-expand
  // whenever they're already relevant: the driving field was specifically
  // flagged (highlightDrivingField, e.g. from a reminder deep-link), or an
  // Who's driving / Location / Description used to sit behind a "More
  // details" toggle. They're ordinary fields people expect to see, so they're
  // always shown now — Notes below is the one collapsed section, because it's
  // a conversation rather than a field.

  // A plain <textarea> scrolls internally by default once its content
  // overflows its visible rows — a long pasted/imported description (e.g. a
  // Teams/Outlook meeting invite) reliably overflows the 3-row box. Left
  // fully unbounded, auto-growing the textarea removes that internal scroll
  // entirely, but for a REALLY long synced description (a full Google
  // Calendar HTML body, hundreds of words) it grows tall enough to fill
  // nearly the whole dialog — and a touch that starts on/within a native
  // <textarea> is captured by the textarea itself, even once it has nothing
  // left to scroll; the browser does not chain that gesture up to the
  // dialog's own scrollable ancestor the way it does for a plain non-form
  // element. Net effect: with an unbounded-height textarea covering most of
  // the visible dialog, touching almost anywhere to scroll silently did
  // nothing — reported directly ("I can't scroll to read the content in the
  // description box").
  //
  // Fixed with a cap: the textarea grows up to MAX_DESCRIPTION_HEIGHT_PX
  // (about a dozen lines) and re-enables its OWN internal scroll only once
  // content exceeds that — so a normal-length description still has no
  // internal scroll at all (matching the original fix's default case, and
  // never re-introducing a second scrollable region for the common case),
  // while a very long one becomes its own directly-scrollable box — a
  // touch that starts inside it scrolls IT (an ordinary, expected way to
  // read a long text field), and a touch anywhere else in the dialog still
  // scrolls the dialog, since a genuinely-scrollable nested element is fine
  // as long as it lives inside DialogPrimitive.Content's own subtree (see
  // ui/dialog.tsx's react-remove-scroll notes) — only an unbounded one that
  // swallows nearly the whole touch surface caused a problem.
  useEffect(() => {
    // Deferred a frame: without it the only run happens before the dialog has
    // its final width — scrollHeight is then measured against a near-zero-width
    // box, comes back huge, and a short description wrongly gets its own
    // scrollbar.
    const raf = requestAnimationFrame(() => {
      const el = descriptionRef.current;
      if (!el) return;
      el.style.height = "auto";
      const capped = Math.min(el.scrollHeight, MAX_DESCRIPTION_HEIGHT_PX);
      el.style.height = `${capped}px`;
      el.style.overflowY = el.scrollHeight > MAX_DESCRIPTION_HEIGHT_PX ? "auto" : "hidden";
    });
    return () => cancelAnimationFrame(raf);
  }, [formData.description, isOpen]);

  const handleClose = () => {
    onClose();
    resetForm();
  };

  // A recurring event is one row (the first occurrence) expanded into many
  // occurrences server-side. Editing a LATER one used to be blocked outright,
  // which meant a series that began months ago could not be touched from the
  // occurrence in front of you (reported 2026-09-12). Saving now asks whether
  // the change is for this one, this and everything after, or the series.
  //
  // The repeat RULE itself stays anchored to the first occurrence: "this event
  // only" detaches a single non-repeating copy, so a rule change made there
  // would be silently thrown away. Better to say so than to drop it.
  const isRecurringInstance = isEditing && !!(selectedEvent as any)?.isRecurringInstance;
  // Cosmetic only — the `fieldset disabled` below is what actually blocks the
  // controls. Applied per field group rather than to their container; see the
  // comment at the Repeat grid.
  const repeatFade = isRecurringInstance ? "opacity-60" : "";
  const seriesStartLabel = (() => {
    const d = (selectedEvent as any)?.seriesStartTime;
    if (!d) return null;
    try { return format(new Date(d), "MMM d, yyyy"); } catch { return null; }
  })();

  // Every event belongs to someone — block whichever change (unchecking the
  // last box, removing the last chip) would leave profileIds empty.
  const setProfileIds = (next: string[]) => {
    if (next.length === 0) return;
    setFormData({ ...formData, profileIds: next });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLocal(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  const handleDelete = async () => {
    if (onDelete) {
      setIsSubmittingLocal(true);
      try {
        await onDelete();
      } finally {
        setIsSubmittingLocal(false);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleClose();
    }}>
      <DialogContent
        className="w-full max-w-lg md:max-w-2xl bg-card rounded-2xl border border-border shadow-xl"
        data-testid={`${testIdPrefix}-modal`}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            {isEditing ? "Edit Event" : "Add Event"}
          </DialogTitle>
        </DialogHeader>

        {imagePreviewUrl && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-accent/40 border border-border" data-testid="flyer-thumbnail-block">
            <img
              src={imagePreviewUrl}
              alt="Source flyer"
              className="w-16 h-16 rounded-lg object-cover border border-border"
            />
            <div className="flex-1 text-xs text-muted-foreground">
              Pre-filled from your flyer photo. Double-check the details before saving.
            </div>
          </div>
        )}

        <form onSubmit={handleFormSubmit}>
        {/* space-y-4 lives on the fieldset, not the form: with `display:
            contents` collapsing the fieldset out of the box model, Tailwind's
            space-y utility (`.space-y-4 > * ~ *`) only matches DIRECT
            children of the element carrying the class — since the form's
            only real DOM child is this one fieldset, putting space-y-4 on
            the form applied margin-top to nothing at all, silently
            collapsing the gap between every field to ~0. This was most
            visible right below the Start/End row (the "All Day event"
            checkbox sat flush against it), but affected every field in this
            form equally. The class still works fine here because the
            selector only needs `display: contents` on the AUTHOR (fieldset),
            not on the matched children — their own margin-top is honored
            normally once they're laid out in the form's flow. */}
        <fieldset className="contents space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor={`${testIdPrefix}-title`}>Title</Label>
            <Input
              id={`${testIdPrefix}-title`}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Event title"
              data-testid={`${testIdPrefix}-title-input`}
            />
          </div>

          {/* Start and End — split into separate Date + Time inputs rather than
              one combined `type="datetime-local"` field. iOS Safari renders a
              datetime-local as one uncompromising single-line native control
              (full "Mon, Jan 1, 2026" + "12:00 AM" together) with a fixed
              minimum width that min-w-0/w-full can't shrink — on an iPhone's
              narrower screen that control itself is wider than the dialog,
              so it visually bled past the right edge (and iOS lets you touch
              -drag inside an overflowing native control's own rendering,
              which is what made the whole popup feel swipeable/draggable
              sideways even though the dialog's own scroll container already
              blocks horizontal scroll). Separate `date`/`time` inputs render
              far more compactly on iOS and reliably fit on one line even on
              the smallest phone widths. `appearance-none` on all four is
              needed too: iOS Safari renders its native `date` and `time`
              widgets at slightly different intrinsic heights unless the
              browser's own control chrome is stripped, which made the two
              rows visibly mismatched even with the same h-10 class.

              Widths are a separate, desktop-specific concern: an
              unconstrained `flex-1` date field absorbs ALL the spare width a
              wide dialog has (it hit 510px in the md-lg single-column range),
              while the fixed-width time field stays narrow no matter how much
              room there is. That's not only lopsided — Chrome silently drops
              the AM/PM indicator below ~128px at text-sm (~144px at
              text-base), so a 6.5rem time field read "04:30" with no way to
              tell morning from evening. Hence `md:max-w-sm` on the pair (stops
              the date runaway) and `md:w-36` on the time field (guarantees the
              meridiem renders). Phone widths keep their original sizing, which
              iOS renders compactly and correctly. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="min-w-0">
              <Label>Start</Label>
              <div className="flex gap-2 md:max-w-sm">
                <Input
                  type="date"
                  className="flex-1 min-w-0 appearance-none"
                  value={selectedSlot ? format(selectedSlot.start, "yyyy-MM-dd") : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const timeStr = selectedSlot ? format(selectedSlot.start, "HH:mm") : "09:00";
                    const newStart = new Date(`${e.target.value}T${timeStr}`);
                    if (!selectedSlot) {
                      const end = new Date(newStart);
                      end.setHours(newStart.getHours() + 1);
                      setSelectedSlot({ start: newStart, end });
                    } else {
                      setSelectedSlot({ ...selectedSlot, start: newStart });
                    }
                  }}
                  data-testid={`${testIdPrefix}-start-date-input`}
                />
                {formData.isAllDay ? <AllDayTimeBox testId={`${testIdPrefix}-start-all-day`} /> : (
                <Input
                  type="time"
                  className="w-[8rem] md:w-36 shrink-0 appearance-none"
                  value={selectedSlot ? format(selectedSlot.start, "HH:mm") : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const dateStr = selectedSlot ? format(selectedSlot.start, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
                    const newStart = new Date(`${dateStr}T${e.target.value}`);
                    if (!selectedSlot) {
                      const end = new Date(newStart);
                      end.setHours(newStart.getHours() + 1);
                      setSelectedSlot({ start: newStart, end });
                    } else {
                      setSelectedSlot({ ...selectedSlot, start: newStart });
                    }
                  }}
                  data-testid={`${testIdPrefix}-start-time-input`}
                />
                )}
              </div>
            </div>
            <div className="min-w-0">
              <Label>End</Label>
              <div className="flex gap-2 md:max-w-sm">
                <Input
                  type="date"
                  className="flex-1 min-w-0 appearance-none"
                  value={selectedSlot ? format(selectedSlot.end, "yyyy-MM-dd") : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const timeStr = selectedSlot ? format(selectedSlot.end, "HH:mm") : "10:00";
                    const newEnd = new Date(`${e.target.value}T${timeStr}`);
                    if (!selectedSlot) {
                      const start = new Date(newEnd);
                      start.setHours(newEnd.getHours() - 1);
                      setSelectedSlot({ start, end: newEnd });
                    } else {
                      setSelectedSlot({ ...selectedSlot, end: newEnd });
                    }
                  }}
                  data-testid={`${testIdPrefix}-end-date-input`}
                />
                {formData.isAllDay ? <AllDayTimeBox testId={`${testIdPrefix}-end-all-day`} /> : (
                <Input
                  type="time"
                  className="w-[8rem] md:w-36 shrink-0 appearance-none"
                  value={selectedSlot ? format(selectedSlot.end, "HH:mm") : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const dateStr = selectedSlot ? format(selectedSlot.end, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
                    const newEnd = new Date(`${dateStr}T${e.target.value}`);
                    if (!selectedSlot) {
                      const start = new Date(newEnd);
                      start.setHours(newEnd.getHours() - 1);
                      setSelectedSlot({ start, end: newEnd });
                    } else {
                      setSelectedSlot({ ...selectedSlot, end: newEnd });
                    }
                  }}
                  data-testid={`${testIdPrefix}-end-time-input`}
                />
                )}
              </div>
            </div>
          </div>

          {/* All Day Checkbox — moved out of "More details" and placed right
              after Start/End (rather than buried behind an extra tap) since
              it directly controls whether the Start/End time fields above
              are even relevant; available when editing too, so a timed
              event can be converted to all-day (or back) after creation. */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`${testIdPrefix}-isAllDay`}
              checked={formData.isAllDay || false}
              onChange={(e) => setFormData({ ...formData, isAllDay: e.target.checked })}
              data-testid={`${testIdPrefix}-all-day-checkbox`}
            />
            <Label htmlFor={`${testIdPrefix}-isAllDay`}>All day event</Label>
          </div>

          {/* Repeat — the rule belongs to the series, so it is editable from a
              brand-new event or the series' first occurrence only. Everything
              else on this form is editable from any occurrence. */}
          {/* The fade sits on each FIELD GROUP, not on the grid, so the notice
              below can live inside the same grid — directly under the Repeat
              control it is about (asked for 2026-09-14) — without inheriting
              the fade. Opacity on an ancestor cannot be undone by a child. */}
          <fieldset disabled={isRecurringInstance} className="contents">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`min-w-0 ${repeatFade}`}>
              <Label htmlFor={`${testIdPrefix}-repeat`}>Repeat</Label>
              <select
                id={`${testIdPrefix}-repeat`}
                data-testid={`${testIdPrefix}-repeat-select`}
                // ?? "none": the API sends null for a non-repeating event.
                // Every caller coalesces it today, so a null here is latent
                // rather than live — but the whole point of this fix is that
                // callers shouldn't have to remember.
                value={formData.recurrenceType ?? "none"}
                onChange={(e) => setFormData({ ...formData, recurrenceType: e.target.value as EventFormData["recurrenceType"] })}
                className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            {/* Deliberately NOT muted: it sits among controls that ARE faded,
                and a muted treatment would read as more unavailable text
                rather than as the one instruction for getting at them. */}
            {isRecurringInstance && (
              <p className="text-xs text-foreground md:col-span-2 -mt-2" data-testid={`${testIdPrefix}-recurring-lock-notice`}>
                To change this, edit the first event in this series
                {seriesStartLabel ? ` (occurring on ${seriesStartLabel})` : ""}.
              </p>
            )}
            {(formData.recurrenceType ?? "none") !== "none" && (
              // "Repeat every" and "Until" share one wrapping row rather than
              // taking a full-width block each: two stacked rows made the
              // Add/Edit Event dialog noticeably longer for no benefit
              // (2026-09-12).
              <div className={`min-w-0 md:col-span-2 ${repeatFade}`}>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <Label htmlFor={`${testIdPrefix}-repeat-every`}>Repeat every</Label>
                    <div className="flex items-center gap-2">
                      <IntervalInput
                        value={formData.recurrenceInterval ?? 1}
                        onChange={(n) => setFormData({ ...formData, recurrenceInterval: n })}
                        testIdPrefix={testIdPrefix}
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {RECURRENCE_UNIT[formData.recurrenceType ?? "none"]}
                        {(formData.recurrenceInterval ?? 1) === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${testIdPrefix}-repeat-until`}>Until (optional)</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={`${testIdPrefix}-repeat-until`}
                        type="date"
                        className="h-10 w-[9.5rem] min-w-0"
                        value={toDateInputValue(formData.recurrenceEndDate)}
                        onChange={(e) => setFormData({ ...formData, recurrenceEndDate: e.target.value || null })}
                        data-testid={`${testIdPrefix}-repeat-until-input`}
                      />
                      {/* iOS's own date picker offers Reset, not Clear — it
                          jumps to roughly a month out and there is no way back
                          to "no end date" from inside it. This is that way
                          back, and it uses the app's own ghost button rather
                          than inventing a control. */}
                      {formData.recurrenceEndDate && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2 text-muted-foreground"
                          onClick={() => setFormData({ ...formData, recurrenceEndDate: null })}
                          aria-label="Clear the until date"
                          data-testid={`${testIdPrefix}-repeat-until-clear`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leave blank to repeat for about a year.</p>
              </div>
            )}
            {(formData.recurrenceType ?? "none") === "weekly" && (
              <div className={`min-w-0 md:col-span-2 ${repeatFade}`}>
                <Label>Repeat on</Label>
                <WeekdayPicker
                  value={formData.daysOfWeek ?? []}
                  onChange={(days) => setFormData({ ...formData, daysOfWeek: days })}
                  testIdPrefix={testIdPrefix}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave all off to repeat on the start date's own day.
                </p>
              </div>
            )}
          </div>
          </fieldset>

          {/* Calendar source — read-only, shown only for events imported FROM an
              external Google calendar so users know where they originated. App
              events have no calendar picker; their color comes from assignment. */}
          {isEditing && selectedEvent && (selectedEvent as any).isGoogleCalendar && (selectedEvent as any).googleCalendarName && (
            <div>
              <Label>Calendar Name</Label>
              <div className="mt-2 p-2 bg-muted rounded text-sm text-foreground">
                {(selectedEvent as any).googleCalendarName}
              </div>
            </div>
          )}

          {/* Assign to */}
          <PeoplePicker
            label="Assign to"
            profiles={profiles}
            selectedIds={formData.profileIds}
            onChange={setProfileIds}
            // An event with nobody on it is unreachable from every list in the
            // app, so the last assignee can't be removed.
            allowEmpty={false}
            placeholder="Select family members"
            testIdPrefix={testIdPrefix}
          />

          {/* Who's driving — same control as Assign to, because it is the same
              question (which people). Several drivers are allowed: one person
              may drop off and another pick up. It's a set, not an order. */}
          <div
            ref={drivingFieldRef}
            className={highlightDrivingField ? "rounded-lg ring-2 ring-amber-400 ring-offset-2 ring-offset-card p-2 -m-2 transition-shadow" : ""}
            data-testid="driving-field-container"
          >
            <PeoplePicker
              label="Who's driving?"
              profiles={profiles}
              selectedIds={formData.drivingProfileIds}
              onChange={(ids) => setFormData({ ...formData, drivingProfileIds: ids })}
              // Unlike assignees, nobody driving is a normal state — the
              // trigger says so ("None selected") instead of a line of help
              // text under an already-obvious empty field.
              allowEmpty
              placeholder="None selected"
              testIdPrefix={`${testIdPrefix}-driving`}
            />
          </div>

          {/* Location */}
          <div>
            <Label htmlFor={`${testIdPrefix}-location`}>Location</Label>
            <Input
              id={`${testIdPrefix}-location`}
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="Event location (optional)"
              data-testid={`${testIdPrefix}-location-input`}
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor={`${testIdPrefix}-description`}>Description</Label>
            <Textarea
              ref={descriptionRef}
              id={`${testIdPrefix}-description`}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Event description (optional)"
              rows={3}
              className="resize-none overscroll-contain"
              style={{ overflowX: "hidden" }}
              data-testid={`${testIdPrefix}-description-input`}
            />
          </div>
        </fieldset>

          {/* Action Buttons. Edit mode: Delete (left half) + Cancel (right
              half) share a row, with Save Event as its own full-width
              primary button below — the save action reads as the one clear
              default option, and Delete/Cancel sit together above it at
              equal, lower visual weight instead of three same-size buttons
              competing for attention. Create mode (no delete) keeps the
              simpler Cancel + Create Event pair. */}
          <div className={isEditing ? "flex flex-col gap-2 pt-4" : "flex justify-end gap-2 pt-4"}>
            {isEditing ? (
              <>
                {/* EDIT-2: Delete was a filled red button, equal in size to
                    Cancel and leftmost — the strongest treatment and the
                    easiest thumb reach went to the irreversible action. It's
                    now a de-emphasised text button on the right of the row,
                    matching how "Delete this profile" / "Delete this
                    reminder" are already handled elsewhere. It still opens
                    the same confirmation. */}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={handleClose}
                    data-testid={`${testIdPrefix}-cancel-button`}
                  >
                    Cancel
                  </Button>
                  {onDelete && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={handleDelete}
                      disabled={isSubmittingLocal || isDeleting}
                      data-testid={`${testIdPrefix}-delete-button`}
                    >
                      {isSubmittingLocal || isDeleting ? "Deleting…" : "Delete event"}
                    </Button>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmittingLocal || isSubmitting}
                  data-testid={`${testIdPrefix}-submit-button`}
                >
                  {isSubmittingLocal || isSubmitting ? "Saving…" : "Save event"}
                </Button>
              </>
            ) : (
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  data-testid={`${testIdPrefix}-cancel-button`}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingLocal || isSubmitting}
                  data-testid={`${testIdPrefix}-submit-button`}
                >
                  {isSubmittingLocal || isSubmitting ? "Creating…" : "Create event"}
                </Button>
              </div>
            )}
          </div>
        </form>
        {isEditing && selectedEvent?.id ? (
          <CommentThread
            entityType="event"
            entityId={selectedEvent.id}
            profiles={profiles}
            entityTitle={formData.title || selectedEvent?.title}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
