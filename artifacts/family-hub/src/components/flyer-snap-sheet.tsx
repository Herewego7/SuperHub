import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ObjectUploader } from "@/components/ObjectUploader";
import { objectUrl } from "@/lib/apiBase";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Camera, ImageIcon, Loader2, CalendarDays, MapPin, Clock, CheckSquare, Square, AlertTriangle } from "lucide-react";
import type { Profile } from "@workspace/shared-types";

export type FlyerConfidence = "high" | "medium" | "low";

export interface ExtractedFlyerEvent {
  title: string;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  description: string | null;
  /** Server rolled a guessed past year forward; holds the original date. */
  yearAdjustedFrom?: string | null;
  /** Still in the past (flyer explicitly printed an old year). */
  isPastDate?: boolean;
  confidence: {
    title: FlyerConfidence;
    date: FlyerConfidence;
    time: FlyerConfidence;
    location: FlyerConfidence;
  };
}

export interface FlyerExtractionResult {
  imageUrl: string;
  events: ExtractedFlyerEvent[];
  warning: string | null;
}

interface FlyerSnapSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (count: number) => void;
  /** Jump the calendar to a date — powers the "View" action on the success toast. */
  onViewDate?: (date: Date) => void;
}

type Step = "upload" | "selecting" | "importing";

function formatDate(date: string | null): string {
  if (!date) return "No date";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function formatTime(start: string | null, end: string | null, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  if (!start) return "Time TBD";
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

/** The user's own local calendar day as YYYY-MM-DD (never UTC — see below). */
function localTodayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function FlyerSnapSheet({ open, onOpenChange, onImported, onViewDate }: FlyerSnapSheetProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("upload");
  const [extractedResult, setExtractedResult] = useState<FlyerExtractionResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  // Who each extracted event is assigned to, keyed by its index in
  // extractedResult.events — defaults to everyone (see below) so the
  // existing "just tap Add" flow keeps working with zero extra taps;
  // picking specific people is optional, not required.
  const [eventAssignees, setEventAssignees] = useState<Record<number, string[]>>({});

  const { data: profiles = [] } = useQuery<Profile[]>({ queryKey: ["/api/profiles"] });
  const realProfiles = profiles.filter((p) => !p.isAllFamilyProfile && p.isActive !== false);
  const allProfileIds = realProfiles.map((p) => p.id);

  const extractMutation = useMutation({
    mutationFn: async (imageURL: string) => {
      // Send OUR local date. The server usually runs in UTC, so near midnight
      // its "today" can be a different calendar day than the family's — which
      // is exactly the boundary where the year-resolution guard would pick the
      // wrong side.
      const response = await apiRequest("POST", "/api/flyer-extract", {
        imageURL,
        today: localTodayISO(),
      });
      return (await response.json()) as FlyerExtractionResult;
    },
    onSuccess: (result) => {
      setExtractedResult(result);
      if (result.events.length === 0) {
        toast({
          title: "No events found",
          description: result.warning ?? "Try a clearer photo.",
          variant: "destructive",
        });
        setStep("upload");
        return;
      }
      // Pre-select all events, each defaulted to everyone.
      setSelectedIndices(new Set(result.events.map((_, i) => i)));
      setEventAssignees(Object.fromEntries(result.events.map((_, i) => [i, allProfileIds])));
      if (result.warning) {
        toast({ title: "Heads up", description: result.warning });
      }
      setStep("selecting");
    },
    onError: (err: any) => {
      setStep("upload");
      toast({
        title: "Could not read flyer",
        description: err?.message || "Please try a clearer photo.",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (eventsToImport: { event: ExtractedFlyerEvent; profileIds: string[] }[]) => {
      const results = await Promise.allSettled(
        eventsToImport.map(({ event: ev, profileIds }) => {
          let start: string;
          let end: string;
          if (ev.date) {
            const [sy, sM, sd] = ev.date.split("-").map(Number);
            const endDateStr = ev.endDate || ev.date;
            const [ey, eM, ed] = endDateStr.split("-").map(Number);
            if (ev.isAllDay) {
              start = new Date(sy, sM - 1, sd, 0, 0, 0, 0).toISOString();
              end = new Date(ey, eM - 1, ed, 23, 59, 0, 0).toISOString();
            } else {
              const [sh, sm] = (ev.startTime ?? "09:00").split(":").map(Number);
              const startDate = new Date(sy, sM - 1, sd, sh, sm, 0, 0);
              start = startDate.toISOString();
              const [eh, em] = (ev.endTime ?? `${String(sh + 1).padStart(2, "0")}:${String(sm).padStart(2, "0")}`).split(":").map(Number);
              const endDate = new Date(ey, eM - 1, ed, eh, em, 0, 0);
              end = endDate <= startDate
                ? new Date(startDate.getTime() + 60 * 60 * 1000).toISOString()
                : endDate.toISOString();
            }
          } else {
            const now = new Date();
            now.setMinutes(0, 0, 0, 0);
            start = now.toISOString();
            end = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
          }

          return apiRequest("POST", "/api/events", {
            title: ev.title,
            description: ev.description ?? "",
            location: ev.location ?? "",
            startTime: start,
            endTime: end,
            isAllDay: ev.isAllDay,
            profileIds,
            calendarId: null,
            color: null,
            source: "scan",
          });
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      // Earliest date among the events that actually saved — what the
      // confirmation names and what "View" jumps to.
      const firstDate = eventsToImport
        .filter((_, i) => results[i].status === "fulfilled")
        .map(({ event }) => event.date)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;
      return { succeeded, failed, firstDate };
    },
    onSuccess: ({ succeeded, failed, firstDate }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      // Always state the date the event actually landed on. A bare "added!"
      // is what made a wrong-year import read as total data loss — the user
      // had no way to tell a save had happened somewhere they'd never scroll.
      const where = firstDate ? ` on ${formatDate(firstDate)}` : "";
      const msg = failed > 0
        ? `${succeeded} event${succeeded !== 1 ? "s" : ""} added${where}, ${failed} failed.`
        : succeeded === 1
          ? `Added${where}.`
          : `${succeeded} events added, starting${where}.`;
      toast({
        title: "Added to your calendar",
        description: msg,
        // Deep-link straight to the date so "did it actually save?" is one tap
        // to answer instead of a scroll hunt.
        action: firstDate && onViewDate
          ? (
            <ToastAction
              altText="View on calendar"
              onClick={() => {
                const [y, m, d] = firstDate.split("-").map(Number);
                onViewDate(new Date(y, m - 1, d));
              }}
            >
              View
            </ToastAction>
          )
          : undefined,
      });
      onImported?.(succeeded);
      handleClose(true);
    },
    onError: (err: any) => {
      toast({
        title: "Import failed",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
      setStep("selecting");
    },
  });

  const handleUploadComplete = (result: { objectPath: string }) => {
    if (!result.objectPath) {
      toast({ title: "Upload failed", variant: "destructive" });
      return;
    }
    setStep("selecting"); // show spinner
    extractMutation.mutate(result.objectPath);
  };

  const toggleSelect = (i: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (!extractedResult) return;
    if (selectedIndices.size === extractedResult.events.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(extractedResult.events.map((_, i) => i)));
    }
  };

  const toggleEventAssignee = (i: number, profileId: string) => {
    setEventAssignees((prev) => {
      const current = prev[i] ?? allProfileIds;
      const next = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
      return { ...prev, [i]: next };
    });
  };

  // A selected event with nobody picked would either 400 server-side or
  // (per this same POST route's existing "no assignees = everyone" fallback
  // elsewhere) silently default back to everyone — neither is what an
  // explicit empty selection here should mean, so it's blocked up front
  // instead, matching how the same requirement is enforced when creating a
  // to-do/inspiration item via CreateTaskModal.
  const hasEmptyAssignees = extractedResult
    ? [...selectedIndices].some((i) => (eventAssignees[i] ?? allProfileIds).length === 0)
    : false;

  const handleImport = () => {
    if (!extractedResult || selectedIndices.size === 0 || hasEmptyAssignees) return;
    const eventsToImport = [...selectedIndices].map((i) => ({
      event: extractedResult.events[i],
      profileIds: eventAssignees[i] ?? allProfileIds,
    }));
    setStep("importing");
    importMutation.mutate(eventsToImport);
  };

  const handleClose = (force = false) => {
    const busy = step === "selecting" && extractMutation.isPending;
    if (busy && !force) return;
    onOpenChange(false);
    // Reset state after close animation
    setTimeout(() => {
      setStep("upload");
      setExtractedResult(null);
      setSelectedIndices(new Set());
      setEventAssignees({});
    }, 300);
  };

  const isExtracting = extractMutation.isPending;
  const isImporting = step === "importing" || importMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent
        className="w-full max-w-md bg-card rounded-2xl border border-border shadow-xl"
        data-testid="flyer-snap-sheet"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Snap a flyer
          </DialogTitle>
          <DialogDescription>
            {step === "selecting" && extractedResult
              ? `Found ${extractedResult.events.length} event${extractedResult.events.length !== 1 ? "s" : ""}. Select the ones to add to your calendar.`
              : "Take a photo of a school flyer, party invite, or schedule and we'll find all the dates for you."}
          </DialogDescription>
        </DialogHeader>

        {/* Upload step */}
        {step === "upload" && (
          // flex+gap, not space-y: ObjectUploader renders a display:none input
          // and a display:contents label, neither of which generates a box, so
          // space-y's margin-top had nothing to land on and the two upload
          // buttons sat flush against each other. Flex gap spaces the real
          // items (the buttons get promoted through display:contents).
          <div className="flex flex-col gap-3 py-2">
            <ObjectUploader
              accept="image/*"
              capture="environment"
              maxFileSize={12 * 1024 * 1024}
              downscaleTo={1600}
              onComplete={handleUploadComplete}
              buttonClassName="w-full justify-center bg-primary text-primary-foreground hover:bg-primary/90 h-12 rounded-xl"
            >
              <span className="inline-flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Take a photo
              </span>
            </ObjectUploader>

            <ObjectUploader
              accept="image/*"
              maxFileSize={12 * 1024 * 1024}
              downscaleTo={1600}
              onComplete={handleUploadComplete}
              buttonClassName="w-full justify-center bg-card border border-border hover:bg-accent text-foreground h-12 rounded-xl"
            >
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="w-5 h-5" />
                Choose from photos
              </span>
            </ObjectUploader>

            <p className="text-xs text-muted-foreground text-center pt-2">
              Up to 12 MB. JPG, PNG, HEIC and WebP supported.
            </p>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleClose(true)}
              data-testid="flyer-snap-cancel"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Extracting spinner */}
        {isExtracting && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reading your flyer…</p>
          </div>
        )}

        {/* Event selection step */}
        {step === "selecting" && !isExtracting && extractedResult && (
          <div className="space-y-3 py-1">
            {/* Select all toggle */}
            <button
              type="button"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={toggleAll}
            >
              {selectedIndices.size === extractedResult.events.length
                ? <CheckSquare className="w-4 h-4 text-primary" />
                : <Square className="w-4 h-4" />}
              {selectedIndices.size === extractedResult.events.length ? "Deselect all" : "Select all"}
            </button>

            {/* Event cards */}
            <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {extractedResult.events.map((ev, i) => {
                const selected = selectedIndices.has(i);
                const assignees = eventAssignees[i] ?? allProfileIds;
                const emptyAssignees = selected && assignees.length === 0;
                return (
                  <li key={i}>
                    {/* This used to be a single <button> wrapping the whole
                        card. The assignee picker below is its own set of
                        buttons (one per person) — nesting a <button> inside
                        a <button> is invalid HTML, and since React events
                        bubble through the component tree, tapping an
                        avatar would ALSO fire the outer button's
                        toggle-for-import handler. Split into a plain
                        wrapper div with the toggle-button and the picker as
                        SIBLINGS instead, so they can never interfere. */}
                    <div
                      className={`rounded-xl border transition-colors ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                    <button
                      type="button"
                      className="w-full text-left p-3"
                      onClick={() => toggleSelect(i)}
                      data-testid={`flyer-event-${i}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {selected
                            ? <CheckSquare className="w-4 h-4 text-primary" />
                            : <Square className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* line-clamp-2, not truncate: a flyer title is
                              routinely 60+ chars ("Back to School Bash: BBQ,
                              Bonfire, and Backyard Games") and one clipped
                              line is unreadable. This also deliberately avoids
                              white-space:nowrap, which reports the whole
                              string as min-content and is what inflated this
                              dialog's grid track past the screen edge (see
                              ui/dialog.tsx's [&>*]:min-w-0 note). */}
                          <p className="font-medium text-sm leading-tight line-clamp-2 break-words">{ev.title}</p>
                          {/* Each metadata span needs its own min-w-0: a flex
                              item's default min-width is "auto" (its own
                              content's natural size), not 0 — without it, a
                              long unwrapped string (e.g. a multi-day flyer
                              event's date range) can't shrink OR wrap and
                              pushes past the card's edge instead of
                              truncating inside it, regardless of the outer
                              row's own flex-wrap. */}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                              <CalendarDays className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {formatDate(ev.date)}
                                {ev.endDate && ev.endDate !== ev.date && ` – ${formatDate(ev.endDate)}`}
                              </span>
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span className="truncate">{formatTime(ev.startTime, ev.endTime, ev.isAllDay)}</span>
                            </span>
                            {ev.location && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span className="truncate">{ev.location}</span>
                              </span>
                            )}
                          </div>
                          {/* A date the server had to correct, or one that's
                              still in the past, is called out inline rather
                              than sliding through silently — a wrong year is
                              invisible once the event is buried in a past
                              month. */}
                          {ev.isPastDate && (
                            <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                              <span>This date is in the past — check it before adding.</span>
                            </p>
                          )}
                          {!ev.isPastDate && ev.yearAdjustedFrom && (
                            <p className="flex items-start gap-1 text-[11px] text-muted-foreground mt-1">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                              <span>The flyer didn't show a year — we used the next one coming up.</span>
                            </p>
                          )}
                          {ev.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ev.description}</p>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Who this event is assigned to — only worth showing a
                        picker when there's an actual choice to make.
                        Defaults to everyone (see eventAssignees' init in
                        extractMutation's onSuccess), so this is purely
                        optional to touch. */}
                    {realProfiles.length > 1 && (
                      <div className="px-3 pb-3 pt-0.5 border-t border-border/60 mt-2.5">
                        <p className="text-[11px] text-muted-foreground mb-1.5 mt-2">Who is this for?</p>
                        <div className="flex flex-wrap gap-1.5">
                          {realProfiles.map((p) => {
                            const on = assignees.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => toggleEventAssignee(i, p.id)}
                                aria-pressed={on}
                                className={`flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 border text-[11px] transition-colors ${
                                  on ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent/40"
                                }`}
                                data-testid={`flyer-event-${i}-assignee-${p.id}`}
                              >
                                <span
                                  className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0 overflow-hidden"
                                  style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}90)` }}
                                >
                                  {p.photoUrl ? <img src={objectUrl(p.photoUrl)} alt={p.name} className="w-full h-full object-cover" /> : p.initials}
                                </span>
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                        {emptyAssignees && (
                          <p className="text-[11px] text-destructive mt-1.5">Pick at least one person, or uncheck this event.</p>
                        )}
                      </div>
                    )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-between items-center pt-1">
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>
                Try another photo
              </Button>
              <Button
                size="sm"
                disabled={selectedIndices.size === 0 || hasEmptyAssignees}
                onClick={handleImport}
                data-testid="flyer-import-btn"
              >
                Add {selectedIndices.size > 0 ? `${selectedIndices.size} ` : ""}event{selectedIndices.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* Importing spinner */}
        {isImporting && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Adding events to your calendar…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
