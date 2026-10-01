import { useState, useMemo } from "react";
import { objectUrl } from "@/lib/apiBase";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus, Trash2, Cake, Heart, PartyPopper, X, Camera, Edit2, Check, CalendarSearch,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import { ObjectUploader } from "@/components/ObjectUploader";
import {
  scanEventsForCelebrations,
  type CelebrationScanCandidate,
  type ScannableEvent,
} from "@/lib/celebrationDetect";
import type { Profile, InsertCelebration, InsertCelebrationGiftIdea } from "@workspace/shared-types";

type CelebrationCreatePayload = Omit<InsertCelebration, "userId">;
type CelebrationUpdatePayload = Partial<CelebrationCreatePayload>;
type GiftIdeaUpdatePayload = Partial<Omit<InsertCelebrationGiftIdea, "celebrationId">>;

export type CelebrationType = "birthday" | "anniversary" | "other";

export interface CelebrationGiftIdea {
  id: string;
  celebrationId: string;
  text: string;
  isChecked: boolean | null;
  displayOrder: number | null;
}

export interface CelebrationPhoto {
  id: string;
  celebrationId: string;
  imageUrl: string;
  year: number | null;
  caption: string | null;
}

export interface CelebrationListItem {
  id: string;
  userId: string;
  name: string;
  monthDay: string;
  year: number | null;
  type: CelebrationType;
  customLabel: string | null;
  profileId: string | null;
  profileIds: string[] | null;
  notes: string | null;
  showYear: boolean | null;
  nextOccurrence: string;
  daysUntil: number;
  ageThisYear: number | null;
  giftIdeas: CelebrationGiftIdea[];
  photos: CelebrationPhoto[];
}

// profileIds is the source of truth; profileId is only there for rows saved
// before multi-profile linking existed.
function linkedProfileIds(c: { profileId: string | null; profileIds?: string[] | null }): string[] {
  return c.profileIds ?? (c.profileId ? [c.profileId] : []);
}

export const TYPE_META: Record<CelebrationType, { icon: LucideIcon; label: string; color: string }> = {
  birthday: { icon: Cake, label: "Birthday", color: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" },
  // sky, not rose: rose-100 sat right next to birthday's pink-100, so the
  // tile colour carried no information and the icon was the only difference.
  anniversary: { icon: Heart, label: "Anniversary", color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  other: { icon: PartyPopper, label: "Celebration", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
};

// A clear "when + which milestone" line. The milestone number is the age/
// anniversary reached ON the next occurrence (same as birthdays — "turns 18"),
// so we phrase it in the future ("18-year anniversary on Aug 28") and show the
// occurrence's YEAR whenever it isn't this calendar year. Without the year, an
// anniversary that already passed this year rolls to next year's count and
// looks off by one (e.g. a May 26, 2013 anniversary viewed after May 26 shows
// its 14th — on May 26 next year — which reads as wrong next to a bare "May 26").
function celebrationWhen(
  c: { nextOccurrence: string; ageThisYear: number | null; showYear?: boolean | null; type: CelebrationType },
  opts: { dateFormat?: string } = {},
): string {
  // The server sends nextOccurrence as a UTC-instant ISO string (computed in
  // the server's own — effectively UTC — local time; see lib/celebrations.ts).
  // Parsing that instant directly with `new Date(...)` lets the BROWSER apply
  // its own timezone offset, shifting the displayed date back a day for
  // anyone west of UTC (an Aug 11 anniversary would show as Aug 10) — same
  // bug class already fixed for the calendar grid's celebration rendering in
  // calendar3-view.tsx. Read just the UTC DATE portion (the calendar day the
  // server actually intended) and build a fresh LOCAL midnight for it instead.
  const day = c.nextOccurrence.slice(0, 10); // "YYYY-MM-DD"
  const occ = new Date(`${day}T00:00:00`);
  const rolledToLaterYear = occ.getFullYear() !== new Date().getFullYear();
  const base = opts.dateFormat ?? "MMM d";
  const dateStr = format(occ, rolledToLaterYear ? `${base}, yyyy` : base);
  const hasAge = c.ageThisYear !== null && c.showYear !== false;
  // Without a recorded year there's no age to show, but a bare date left
  // this line structurally different from its neighbours ("Turns 37 on
  // Aug 25" above a lone "Aug 26"). Lead with the type instead, so every
  // card reads as "<what> on <when>".
  if (!hasAge) {
    if (c.type === "anniversary") return `Anniversary on ${dateStr}`;
    if (c.type === "birthday") return `Birthday on ${dateStr}`;
    return dateStr;
  }
  if (c.type === "anniversary") return `${c.ageThisYear}-year anniversary on ${dateStr}`;
  if (c.type === "birthday") return `Turns ${c.ageThisYear} on ${dateStr}`;
  return `${c.ageThisYear} years on ${dateStr}`;
}

function countdownLabel(daysUntil: number): string {
  // One convention throughout: exact days up to about seven weeks, then
  // whole months. The old version switched to a fuzzy "in about a month" at
  // 31 days but kept exact days at 30, so neighbouring cards could read
  // "In 18 days" directly above "In about a month" with no way to compare
  // them. Weeks in the middle band keeps every label the same kind of thing.
  if (daysUntil === 0) return "Today!";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil < 14) return `In ${daysUntil} days`;
  if (daysUntil < 50) {
    const weeks = Math.round(daysUntil / 7);
    return `In ${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.round(daysUntil / 30);
  return `In ${months} month${months === 1 ? "" : "s"}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function dateInputToMonthDay(value: string): string {
  // value is "YYYY-MM-DD"
  const [, mm, dd] = value.split("-");
  return `${mm}-${dd}`;
}

interface CelebrationFormState {
  name: string;
  fullDate: string; // "YYYY-MM-DD"
  hasYear: boolean;
  showYear: boolean;
  type: CelebrationType;
  customLabel: string;
  profileIds: string[];
  notes: string;
}

const EMPTY_FORM: CelebrationFormState = {
  name: "",
  fullDate: format(new Date(), "yyyy-MM-dd"),
  hasYear: false,
  showYear: true,
  type: "birthday",
  customLabel: "",
  profileIds: [],
  notes: "",
};

// ── "Scan my calendar" review dialog ─────────────────────────────────────────
// Nothing here saves without an explicit confirm — the scan only ever
// proposes, exactly like the recipe import/snap flows hand off to a
// pre-filled form for review rather than writing straight to the database.
interface ScanRow extends CelebrationScanCandidate {
  checked: boolean;
  editName: string;
  editType: CelebrationType;
}

function monthDayLabel(monthDay: string): string {
  const [mm, dd] = monthDay.split("-").map(Number);
  // Year 2000 is a leap year, so Feb 29 formats correctly.
  return format(new Date(2000, mm - 1, dd), "MMM d");
}

function CelebrationScanDialog({
  events,
  existing,
  profiles,
  onClose,
}: {
  events: ScannableEvent[];
  existing: CelebrationListItem[];
  profiles: Profile[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState<ScanRow[]>(() =>
    scanEventsForCelebrations(events, existing, profiles).map(c => ({
      ...c,
      // Anything already covered, or with no name to save it under, starts
      // unchecked — so re-running the scan is always safe and never
      // silently re-adds what's already there.
      checked: !c.alreadyTracked && !!c.name,
      editName: c.name,
      editType: c.type,
    })),
  );

  const newRows = rows.filter(r => !r.alreadyTracked);
  const trackedRows = rows.filter(r => r.alreadyTracked);
  const selectedCount = rows.filter(r => r.checked).length;

  function update(key: string, patch: Partial<ScanRow>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function addSelected() {
    const selected = rows.filter(r => r.checked);
    if (selected.length === 0) return;
    const unnamed = selected.find(r => !r.editName.trim());
    if (unnamed) {
      toast({
        title: "Give every selected celebration a name",
        description: `"${unnamed.sourceTitle}" needs a name before it can be added.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    let added = 0;
    const failed: string[] = [];
    // Sequential rather than parallel: these are plain creates with no batch
    // endpoint, and a burst of them is exactly the pattern the API's own
    // rate limiting is there to discourage.
    for (const r of selected) {
      try {
        await apiRequest("POST", "/api/celebrations", {
          name: r.editName.trim(),
          monthDay: r.monthDay,
          year: r.year,
          type: r.editType,
          profileIds: r.profileIds,
          // Only offer an age/anniversary count when the event actually
          // stated one — never invent a year.
          showYear: r.year !== null,
          notes: null,
          customLabel: null,
        });
        added++;
      } catch {
        failed.push(r.editName.trim() || r.sourceTitle);
      }
    }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations/upcoming"] });
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations/calendar"] });
    if (added > 0) {
      toast({
        title: `Added ${added} celebration${added === 1 ? "" : "s"}`,
        description: failed.length ? `Couldn't add: ${failed.join(", ")}` : undefined,
        variant: failed.length ? "destructive" : undefined,
      });
    } else {
      toast({ title: "Couldn't add those celebrations", variant: "destructive" });
    }
    if (failed.length === 0) onClose();
  }

  function renderRow(r: ScanRow) {
    return (
      <div
        key={r.key}
        className={`flex items-start gap-3 rounded-lg border p-3 ${r.alreadyTracked ? "opacity-70" : ""}`}
        data-testid={`scan-row-${r.key}`}
      >
        <Checkbox
          className="mt-2 shrink-0"
          checked={r.checked}
          onCheckedChange={v => update(r.key, { checked: v === true })}
          aria-label={`Add ${r.editName || r.sourceTitle}`}
          data-testid={`scan-check-${r.key}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={r.editName}
              onChange={e => update(r.key, { editName: e.target.value })}
              placeholder="Who is it for?"
              className="h-9 min-w-0 flex-1"
              data-testid={`scan-name-${r.key}`}
            />
            <select
              value={r.editType}
              onChange={e => update(r.key, { editType: e.target.value as CelebrationType })}
              className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm sm:w-36"
              aria-label="Celebration type"
              data-testid={`scan-type-${r.key}`}
            >
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="other">Other</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground break-words">
            <span className="font-medium text-foreground">{monthDayLabel(r.monthDay)}</span>
            {r.year !== null && <> · from {r.year}</>}
            {" · "}found in “{r.sourceTitle}”
            {r.profileIds.length > 0 && <> · linked to {
              r.profileIds.map(id => profiles.find(p => p.id === id)?.name).filter(Boolean).join(", ")
            }</>}
          </p>
          {r.alreadyTracked && (
            <Badge variant="secondary" className="text-[10px]">Already tracked</Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !saving) onClose(); }}>
      {/* w-[calc(100vw-2rem)] caps the dialog to the phone's actual viewport
          width — max-w-2xl alone isn't enough: DialogContent is a CSS grid,
          and a grid track's minimum width is set by the widest non-shrinking
          content inside it (here, each row's fixed-width type select), which
          can silently blow the dialog past its max-width. min-w-0 on the
          rows' content column is the other half of that fix. */}
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl" data-testid="celebration-scan-dialog">
        <DialogHeader>
          <DialogTitle>Add celebrations from your calendar</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="py-8 text-center">
            <CalendarSearch className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 font-semibold">No birthdays or anniversaries found</h3>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Nothing new found. You can always add one by hand.
            </p>
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            <p className="text-sm text-muted-foreground">
              These came from event titles on your calendar. Check the ones you want
              to track, fix anything that's off, then add them. Nothing is saved
              until you press Add.
            </p>

            {/* No nested overflow-y-auto here — the shared Dialog's own
                scroll container (ui/dialog.tsx) is the one intended scroll
                owner. A second, nested scrollable ancestor defeats iOS's
                scroll-lock ancestor walk, which is the "can't scroll / top
                of screen looks weird" bug fixed across the app's dialogs. */}
            <div className="space-y-2">
              {newRows.map(renderRow)}

              {trackedRows.length > 0 && (
                <>
                  <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Already tracked ({trackedRows.length})
                  </p>
                  {trackedRows.map(renderRow)}
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="scan-cancel">
            {rows.length === 0 ? "Close" : "Cancel"}
          </Button>
          {rows.length > 0 && (
            <Button onClick={addSelected} disabled={saving || selectedCount === 0} data-testid="scan-submit">
              {saving
                ? "Adding…"
                : `Add ${selectedCount} celebration${selectedCount === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CelebrationsViewProps {
  /**
   * Events to review when "Scan calendar" is pressed. Passed down from the
   * Calendar tab, which has already assembled local + Google + Outlook +
   * iCal events — so the scan covers everything the user actually sees,
   * without this component re-fetching any of it.
   */
  scanEvents?: ScannableEvent[];
}

export function CelebrationsView({ scanEvents }: CelebrationsViewProps = {}) {
  const { toast } = useToast();
  const [showScan, setShowScan] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);

  const { data: celebrations = [], isLoading } = useQuery<CelebrationListItem[]>({
    queryKey: ["/api/celebrations"],
  });

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ["/api/profiles"],
  });

  const familyProfiles = useMemo(
    () => profiles.filter(p => !p.isAllFamilyProfile),
    [profiles],
  );

  function openCreate() {
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(c: CelebrationListItem) {
    setEditingId(c.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  const openDetail = openDetailId ? celebrations.find(c => c.id === openDetailId) : null;
  const editingCelebration = editingId ? celebrations.find(c => c.id === editingId) ?? null : null;

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <PartyPopper className="w-6 h-6 text-violet-600 shrink-0" />
            Celebrations
          </h2>
          <p className="text-sm text-muted-foreground">
            Birthdays, anniversaries, and other recurring days you don't want to miss.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {scanEvents && scanEvents.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowScan(true)}
              title="Find birthdays and anniversaries already on your calendar"
              // The visible label is hidden below sm:, leaving an icon-only
              // button whose glyph doesn't say what it does — and title=
              // never appears on touch, which is where that happens.
              aria-label="Scan calendar for birthdays and anniversaries"
              data-testid="celebration-scan-btn"
            >
              <CalendarSearch className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Scan calendar</span>
            </Button>
          )}
          <Button onClick={openCreate} aria-label="Add a celebration" data-testid="celebration-add-btn">
            <Plus className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>
      </div>

      {showScan && (
        <CelebrationScanDialog
          events={scanEvents ?? []}
          existing={celebrations}
          profiles={familyProfiles}
          onClose={() => setShowScan(false)}
        />
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading celebrations…</div>
      ) : celebrations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Cake className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">Nothing tracked yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add the birthdays and anniversaries you want on the family calendar.
            </p>
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1" /> Add your first celebration
              </Button>
              {scanEvents && scanEvents.length > 0 && (
                <Button variant="outline" onClick={() => setShowScan(true)} data-testid="celebration-scan-empty-btn">
                  <CalendarSearch className="w-4 h-4 mr-1" /> Scan my calendar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 min-w-0">
          {celebrations.map(c => {
            const meta = TYPE_META[c.type] ?? TYPE_META.other;
            const Icon = meta.icon;
            const linkedProfiles = linkedProfileIds(c)
              .map(id => familyProfiles.find(p => p.id === id))
              .filter((p): p is Profile => !!p);
            const lastYearPhoto = c.photos.find(p => p.year === new Date().getFullYear() - 1);
            const hasRowMeta = linkedProfiles.length > 0 || c.giftIdeas.length > 0 || !!lastYearPhoto;
            return (
              <Card
                key={c.id}
                // min-w-0: this Card is a grid ITEM (child of the "grid
                // sm:grid-cols-2" div above) — min-w-0 on the grid
                // CONTAINER doesn't propagate to its items. Without this, a
                // single card with an unusually long, un-wrappable name (no
                // spaces to break on) drives that grid COLUMN's own min
                // width up to fit it — and since every card in a column
                // shares that column's width, EVERY card (and the dialog
                // itself, via the same DialogContent grid-track sizing bug
                // documented elsewhere in this app) got pushed off the
                // right edge of the screen, not just the one long-named
                // card. Confirmed directly: without this class, a 60-char
                // unbroken name blew every card out to 681px wide inside a
                // 356px-wide dialog.
                className="min-w-0 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setOpenDetailId(c.id)}
                data-testid={`celebration-card-${c.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-2.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xl leading-tight truncate" data-testid={`celebration-name-${c.id}`}>
                        {c.name}
                      </div>
                      {c.type === "other" && c.customLabel && (
                        <div className="text-xs text-muted-foreground truncate">{c.customLabel}</div>
                      )}
                    </div>
                  </div>
                  {/* The badge sits on the date line when a card has no other
                      metadata, instead of alone on a row whose left half is
                      empty — which is what made card contents look unevenly
                      distributed next to a card that does have chips. */}
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground pl-[2.875rem]">
                    <span className="min-w-0 truncate">{celebrationWhen(c)}</span>
                    {!hasRowMeta && (
                      <Badge variant={c.daysUntil <= 7 ? "default" : "secondary"} className="shrink-0">
                        {countdownLabel(c.daysUntil)}
                      </Badge>
                    )}
                  </div>
                  {hasRowMeta && (
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs pl-[2.875rem]">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {linkedProfiles.map(profile => (
                        <span
                          key={profile.id}
                          className="px-2 py-0.5 rounded-full text-white text-[10px] font-medium shrink-0"
                          style={{ backgroundColor: profile.color }}
                        >
                          {profile.name}
                        </span>
                      ))}
                      {c.giftIdeas.length > 0 && (
                        <span className="text-muted-foreground truncate">
                          {c.giftIdeas.filter(g => !g.isChecked).length} gift idea
                          {c.giftIdeas.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {lastYearPhoto && (
                        <span className="text-muted-foreground italic shrink-0">throwback</span>
                      )}
                    </div>
                    <Badge variant={c.daysUntil <= 7 ? "default" : "secondary"} className="shrink-0">
                      {countdownLabel(c.daysUntil)}
                    </Badge>
                  </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <CelebrationFormDialog
          key={editingCelebration?.id ?? "create"}
          celebration={editingCelebration}
          onClose={closeForm}
        />
      )}

      {/* Detail dialog */}
      {openDetail && (
        <CelebrationDetailDialog
          key={openDetail.id}
          celebration={openDetail}
          onClose={() => setOpenDetailId(null)}
          onEdit={() => {
            const c = openDetail;
            setOpenDetailId(null);
            openEdit(c);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────── Add / Edit dialog ─────────────────────
// Fully self-contained (own state, own create/update/delete mutations) so it
// can be dropped in from anywhere a celebration needs editing — the
// Celebrations tab itself, or the read-only detail dialog's "Edit Details"
// button when reached from Announcements/Home, which previously had nowhere
// to send that button because this dialog only ever lived inline in
// CelebrationsView.
function toFormState(c: CelebrationListItem | null): CelebrationFormState {
  if (!c) return EMPTY_FORM;
  const [mm, dd] = c.monthDay.split("-");
  const y = c.year ?? new Date().getFullYear();
  return {
    name: c.name,
    fullDate: `${y}-${mm}-${dd}`,
    hasYear: c.year !== null,
    showYear: c.showYear !== false,
    type: c.type,
    customLabel: c.customLabel ?? "",
    profileIds: linkedProfileIds(c),
    notes: c.notes ?? "",
  };
}

export function CelebrationFormDialog({
  celebration,
  onClose,
}: {
  /** null = create a new celebration; otherwise edit this one. */
  celebration: CelebrationListItem | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [formState, setFormState] = useState<CelebrationFormState>(() => toFormState(celebration));

  const { data: profiles = [] } = useQuery<Profile[]>({ queryKey: ["/api/profiles"] });
  const familyProfiles = useMemo(() => profiles.filter(p => !p.isAllFamilyProfile), [profiles]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations/upcoming"] });
    queryClient.invalidateQueries({ queryKey: ["/api/celebrations/calendar"] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: CelebrationCreatePayload) => {
      const res = await apiRequest("POST", "/api/celebrations", payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Celebration added" });
      onClose();
    },
    onError: () => toast({ title: "Could not save celebration", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: CelebrationUpdatePayload }) => {
      const res = await apiRequest("PATCH", `/api/celebrations/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Celebration updated" });
      onClose();
    },
    onError: () => toast({ title: "Could not update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/celebrations/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Removed" });
      onClose();
    },
    onError: () => toast({ title: "Could not delete", variant: "destructive" }),
  });

  function submitForm() {
    if (!formState.name.trim()) {
      toast({ title: "Please enter a name", variant: "destructive" });
      return;
    }
    if (!formState.fullDate) {
      toast({ title: "Please pick a date", variant: "destructive" });
      return;
    }
    const monthDay = dateInputToMonthDay(formState.fullDate);
    const yearVal = formState.hasYear ? Number(formState.fullDate.slice(0, 4)) : null;
    const payload = {
      name: formState.name.trim(),
      monthDay,
      year: yearVal,
      type: formState.type,
      customLabel: formState.type === "other" && formState.customLabel.trim()
        ? formState.customLabel.trim()
        : null,
      profileIds: formState.profileIds,
      notes: formState.notes.trim() || null,
      showYear: formState.hasYear ? formState.showYear : true,
    };
    if (celebration) {
      updateMutation.mutate({ id: celebration.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      {/* w-[calc(100vw-2rem)] caps the dialog to the phone's actual viewport
          width — sm:max-w-md alone isn't enough: DialogContent is a CSS grid,
          and a grid track's minimum width is set by the widest non-shrinking
          content inside it (here, the native date input's own rendered
          minimum width), which can silently blow the dialog past its
          max-width. min-w-0 on the body is the other half of that fix. */}
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{celebration ? "Edit celebration" : "Add a celebration"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <div className="space-y-1">
            <Label htmlFor="celebration-name">Name</Label>
            <Input
              id="celebration-name"
              value={formState.name}
              onChange={e => setFormState(s => ({ ...s, name: e.target.value }))}
              placeholder="Grandma Jane"
              data-testid="celebration-name-input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 min-w-0">
              <Label htmlFor="celebration-date">Date</Label>
              <Input
                id="celebration-date"
                type="date"
                className="w-full min-w-0"
                value={formState.fullDate}
                onChange={e => setFormState(s => ({ ...s, fullDate: e.target.value }))}
                data-testid="celebration-date-input"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <Label htmlFor="celebration-type">Type</Label>
              <select
                id="celebration-type"
                value={formState.type}
                onChange={(e) => setFormState(s => ({ ...s, type: e.target.value as CelebrationType }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                data-testid="celebration-type-select"
              >
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            You'll get a notification 30 days and again 7 days before this date each year.
          </p>

          {formState.type === "other" && (
            <div className="space-y-1">
              <Label htmlFor="celebration-custom-label">Custom label</Label>
              <Input
                id="celebration-custom-label"
                value={formState.customLabel}
                onChange={e => setFormState(s => ({ ...s, customLabel: e.target.value }))}
                placeholder="Pet adoption day, Graduation, Promotion…"
                data-testid="celebration-custom-label-input"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the calendar.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="celebration-has-year"
                checked={formState.hasYear}
                onCheckedChange={(v) => setFormState(s => ({ ...s, hasYear: v === true }))}
              />
              <Label htmlFor="celebration-has-year" className="text-sm cursor-pointer">
                Track the year (calculate age each year)
              </Label>
            </div>
            {formState.hasYear && (
              <div className="flex items-center gap-2 ml-6">
                <Checkbox
                  id="celebration-show-year"
                  checked={formState.showYear}
                  onCheckedChange={(v) => setFormState(s => ({ ...s, showYear: v === true }))}
                />
                <Label htmlFor="celebration-show-year" className="text-sm cursor-pointer">
                  Show age / number on card
                </Label>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Linked profiles (optional)</Label>
            <div className="flex flex-wrap gap-2" data-testid="celebration-profile-select">
              {familyProfiles.map(p => {
                const checked = formState.profileIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      // Auto-fill (but don't overwrite) the Name field the first
                      // time a profile is linked — the common case is tracking
                      // that person's own birthday/anniversary, so typing their
                      // name again right after picking them was redundant.
                      setFormState(s => {
                        const nextIds = checked
                          ? s.profileIds.filter(id => id !== p.id)
                          : [...s.profileIds, p.id];
                        return {
                          ...s,
                          profileIds: nextIds,
                          name: !checked && !s.name.trim() ? p.name : s.name,
                        };
                      });
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border-2 text-sm transition-colors ${
                      checked ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"
                    }`}
                    data-testid={`celebration-profile-option-${p.id}`}
                  >
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                  </button>
                );
              })}
              {familyProfiles.length === 0 && (
                <p className="text-xs text-muted-foreground">No family members yet.</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="celebration-notes">Notes / gift ideas</Label>
            <Textarea
              id="celebration-notes"
              rows={3}
              value={formState.notes}
              onChange={e => setFormState(s => ({ ...s, notes: e.target.value }))}
              placeholder="Loves jazz records, allergic to peanuts…"
            />
          </div>
        </div>
        {/* Same footer as Edit Event, which is this app's pattern for a dialog
            that can also delete: Cancel and Delete as equal-weight peers on one
            row, the primary action full-width below. Delete used to be a `ghost`
            button here, which reads as plain text rather than something you can
            press, and the three-across layout matched nothing else in the app
            (2026-09-14). */}
        <DialogFooter className={celebration ? "flex flex-col gap-2 sm:flex-col sm:space-x-0" : "flex-row justify-end gap-2"}>
          {celebration ? (
            <>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (await confirmDialog({ title: "Remove this celebration?", confirmLabel: "Remove" })) deleteMutation.mutate(celebration.id);
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid="celebration-delete-btn"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  {deleteMutation.isPending ? "Deleting…" : "Delete"}
                </Button>
              </div>
              <Button
                className="w-full"
                onClick={submitForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="celebration-save-btn"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={submitForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="celebration-save-btn"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────── Detail dialog (gifts + photos) ─────────────────────

interface CelebrationDetailDialogProps {
  celebration: CelebrationListItem;
  onClose: () => void;
  onEdit?: () => void;
}

export function CelebrationDetailDialog({ celebration, onClose, onEdit }: CelebrationDetailDialogProps) {
  const { toast } = useToast();
  const [newIdea, setNewIdea] = useState("");
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [editingIdeaText, setEditingIdeaText] = useState("");
  // Set right after picking/cropping a photo — the year prompt happens as
  // part of that flow (a small confirm step), not as a field that sits on
  // the card permanently.
  const [pendingPhoto, setPendingPhoto] = useState<{ imageUrl: string; year: string } | null>(null);

  const meta = TYPE_META[celebration.type] ?? TYPE_META.other;
  const Icon = meta.icon;

  const addIdea = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/celebrations/${celebration.id}/gift-ideas`, {
        text,
        isChecked: false,
        displayOrder: celebration.giftIdeas.length,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] });
      setNewIdea("");
      toast({ title: "Gift idea added" });
    },
    onError: () => toast({ title: "Could not add idea", variant: "destructive" }),
  });

  const updateIdea = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: GiftIdeaUpdatePayload }) => {
      const res = await apiRequest("PATCH", `/api/celebrations/gift-ideas/${id}`, payload);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] }),
  });

  const deleteIdea = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/celebrations/gift-ideas/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] }),
  });

  const addPhoto = useMutation({
    mutationFn: async ({ imageUrl, year }: { imageUrl: string; year: number | null }) => {
      const res = await apiRequest("POST", `/api/celebrations/${celebration.id}/photos`, {
        imageUrl,
        year,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] });
      setPendingPhoto(null);
    },
    onError: () => toast({ title: "Could not save photo", variant: "destructive" }),
  });

  const deletePhoto = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/celebrations/photos/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/celebrations"] }),
    onError: () => toast({ title: "Could not delete photo", variant: "destructive" }),
  });

  const throwback = celebration.photos.find(p => p.year === new Date().getFullYear() - 1);

  return (
    <>
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center ${meta.color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate">{celebration.name}</div>
              <div className="text-xs text-muted-foreground font-normal">
                {celebrationWhen(celebration, { dateFormat: "EEEE, MMMM d" })}
                {" "}·{" "}{countdownLabel(celebration.daysUntil)}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {celebration.notes && (
            <div className="text-sm bg-muted/50 rounded-md p-3 whitespace-pre-wrap">
              {celebration.notes}
            </div>
          )}

          {throwback && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <Camera className="w-4 h-4" /> Throwback ({throwback.year})
              </h4>
              <img
                src={objectUrl(throwback.imageUrl)}
                alt={`${celebration.name} ${throwback.year}`}
                className="w-full max-h-64 object-cover rounded-md"
              />
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold mb-2">Gift ideas</h4>
            <div className="space-y-2">
              {celebration.giftIdeas.length === 0 && (
                <p className="text-xs text-muted-foreground">No ideas yet — add one below.</p>
              )}
              {celebration.giftIdeas.map(idea => (
                <div key={idea.id} className="flex items-center gap-2 group" data-testid={`gift-idea-${idea.id}`}>
                  <Checkbox
                    checked={!!idea.isChecked}
                    onCheckedChange={(v) => updateIdea.mutate({ id: idea.id, payload: { isChecked: v === true } })}
                  />
                  {editingIdeaId === idea.id ? (
                    <>
                      <Input
                        value={editingIdeaText}
                        onChange={e => setEditingIdeaText(e.target.value)}
                        className="flex-1 h-8"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editingIdeaText.trim()) {
                            updateIdea.mutate({ id: idea.id, payload: { text: editingIdeaText.trim() } });
                            setEditingIdeaId(null);
                          }
                          if (e.key === "Escape") setEditingIdeaId(null);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (editingIdeaText.trim()) {
                            updateIdea.mutate({ id: idea.id, payload: { text: editingIdeaText.trim() } });
                          }
                          setEditingIdeaId(null);
                        }}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span
                        className={`flex-1 text-sm ${idea.isChecked ? "line-through text-muted-foreground" : ""}`}
                      >
                        {idea.text}
                      </span>
                      {/* opacity-60 on touch (no hover state), hover-reveal on desktop —
                          the same pattern as the Behavior Board's pencil icons. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-60 sm:opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          setEditingIdeaId(idea.id);
                          setEditingIdeaText(idea.text);
                        }}
                        aria-label="Edit gift idea"
                        title="Edit gift idea"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-destructive"
                        onClick={async () => {
                          // Every other delete in the app confirms first; this
                          // one fired straight through on a single tap.
                          if (await confirmDialog({ title: "Remove this gift idea?", confirmLabel: "Remove" })) deleteIdea.mutate(idea.id);
                        }}
                        aria-label="Remove gift idea"
                        title="Remove gift idea"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  value={newIdea}
                  onChange={e => setNewIdea(e.target.value)}
                  placeholder="Add a gift idea…"
                  className="h-8"
                  // Without this, iOS's own "scroll the focused field into
                  // view" put the field under the dialog's header (and, with
                  // a photo above, jumped to the top of the photo) — you had
                  // to scroll back down to see what you were typing into.
                  style={{ scrollMarginTop: "6rem", scrollMarginBottom: "6rem" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newIdea.trim()) addIdea.mutate(newIdea.trim());
                  }}
                  data-testid="gift-idea-input"
                />
                <Button
                  size="sm"
                  onClick={() => newIdea.trim() && addIdea.mutate(newIdea.trim())}
                  disabled={!newIdea.trim() || addIdea.isPending}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Add a photo from each year's celebration to build a little visual timeline — a photo
              tagged with this year will resurface as a "one year ago" throwback next year.
            </p>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h4 className="text-sm font-semibold flex items-center gap-1">
                <Camera className="w-4 h-4" /> Photo gallery
              </h4>
              <ObjectUploader
                buttonClassName="h-8 px-3 text-xs"
                maxFileSize={10 * 1024 * 1024}
                withCrop
                cropShape="square"
                onComplete={(result) => {
                  if (!result.objectPath) return;
                  // Ask which year this specific photo was taken as the next
                  // step of the upload flow, instead of a field that sits on
                  // the card permanently.
                  setPendingPhoto({ imageUrl: result.objectPath, year: String(new Date().getFullYear()) });
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Photo
              </ObjectUploader>
            </div>
            {celebration.photos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No photos yet. Upload one tagged with the year and a throwback will appear here next year.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {celebration.photos.map(p => (
                  <div key={p.id} className="relative group rounded-md overflow-hidden bg-muted aspect-square">
                    <img src={objectUrl(p.imageUrl)} alt={p.caption ?? celebration.name} className="w-full h-full object-cover" />
                    {p.year && (
                      <Badge className="absolute bottom-1 left-1 text-[10px] py-0 px-1.5">{p.year}</Badge>
                    )}
                    <button
                      onClick={async () => { if (await confirmDialog({ title: "Delete this photo?" })) deletePhoto.mutate(p.id); }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                      aria-label="Delete photo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Everything here already saves as it's added (photos, gift ideas,
            notes) — but a dialog you leave via "Close" reads as discarding,
            so people hesitate. Same behaviour, named for what already
            happened, and on the right where the primary action belongs. */}
        <DialogFooter>
          {onEdit && (
            <Button variant="outline" onClick={onEdit}>
              <Edit2 className="w-4 h-4 mr-1" /> Edit details
            </Button>
          )}
          <Button
            onClick={() => {
              toast({ title: "Saved", description: "We'll remind you about this each year." });
              onClose();
            }}
            data-testid="celebration-detail-save"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Asked right after picking/cropping a photo, as its own step — not a
        field that sits on the card permanently. */}
    <Dialog open={!!pendingPhoto} onOpenChange={(v) => !v && setPendingPhoto(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>What year was this photo taken?</DialogTitle>
        </DialogHeader>
        {pendingPhoto && (
          <div className="space-y-3">
            <div className="w-full aspect-square rounded-lg overflow-hidden bg-muted">
              <img src={objectUrl(pendingPhoto.imageUrl)} alt="New upload preview" className="w-full h-full object-cover" />
            </div>
            <div>
              <Label htmlFor="pending-photo-year" className="text-xs text-muted-foreground">Year</Label>
              <Input
                id="pending-photo-year"
                type="number"
                value={pendingPhoto.year}
                onChange={(e) => setPendingPhoto(p => p && ({ ...p, year: e.target.value }))}
                className="mt-1"
                autoFocus
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => pendingPhoto && addPhoto.mutate({ imageUrl: pendingPhoto.imageUrl, year: null })}
            disabled={addPhoto.isPending}
          >
            Skip
          </Button>
          <Button
            onClick={() => pendingPhoto && addPhoto.mutate({ imageUrl: pendingPhoto.imageUrl, year: pendingPhoto.year ? Number(pendingPhoto.year) : null })}
            disabled={addPhoto.isPending}
          >
            {addPhoto.isPending ? "Saving…" : "Save Photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
