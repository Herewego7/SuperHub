import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Link2, FileText, Calendar, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ObjectUploader } from "./ObjectUploader";
import type { Profile } from "@workspace/shared-types";

interface CalendarImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
}

interface PreviewEvent {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
}

interface PreviewPayload {
  events: PreviewEvent[];
  rangeStart: string | null;
  rangeEnd: string | null;
  totalCount: number;
}

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "school", label: "School" },
  { value: "sports", label: "Sports" },
  { value: "activity", label: "Activity" },
  { value: "holiday", label: "Holidays" },
  { value: "other", label: "Other" },
];

export function CalendarImportModal({ open, onOpenChange, profiles }: CalendarImportModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"ics" | "pdf">("ics");
  const [icsUrl, setIcsUrl] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewMethod, setPreviewMethod] = useState<"ics" | "pdf" | null>(null);
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [sourceLabel, setSourceLabel] = useState("School");
  const [sourceKey, setSourceKey] = useState("school");

  const reset = () => {
    setIcsUrl("");
    setPreview(null);
    setPreviewMethod(null);
    setSelectedExternalIds(new Set());
    setSelectedProfileIds([]);
    setSourceLabel("School");
    setSourceKey("school");
    setActiveTab("ics");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const applyPreview = (data: PreviewPayload, method: "ics" | "pdf") => {
    setPreview(data);
    setPreviewMethod(method);
    setSelectedExternalIds(new Set(data.events.map(e => e.externalId)));
    // Default: All Family (all profile ids) if profiles exist
    if (selectedProfileIds.length === 0 && profiles.length > 0) {
      const allFamily = profiles.find(p => p.isAllFamilyProfile);
      setSelectedProfileIds(allFamily ? [allFamily.id] : profiles.map(p => p.id));
    }
  };

  const icsPreviewMutation = useMutation({
    mutationFn: async () => {
      const trimmed = icsUrl.trim();
      if (!trimmed) throw new Error("Paste an ICS URL first");
      const response = await apiRequest("POST", "/api/calendar-imports/ics/preview", { url: trimmed });
      return (await response.json()) as PreviewPayload;
    },
    onSuccess: (data) => {
      if (data.events.length === 0) {
        toast({ title: "No events found in that feed", variant: "destructive" });
        return;
      }
      applyPreview(data, "ics");
    },
    onError: (err: any) => {
      toast({ title: "Could not load ICS feed", description: err?.message || String(err), variant: "destructive" });
    },
  });

  const pdfPreviewMutation = useMutation({
    mutationFn: async (objectURL: string) => {
      const response = await apiRequest("POST", "/api/calendar-imports/pdf/preview", { objectURL });
      return (await response.json()) as PreviewPayload;
    },
    onSuccess: (data) => {
      if (data.events.length === 0) {
        toast({ title: "No events found in that PDF", variant: "destructive" });
        return;
      }
      applyPreview(data, "pdf");
    },
    onError: (err: any) => {
      toast({ title: "Could not read PDF", description: err?.message || String(err), variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("No preview available");
      const events = preview.events.filter(e => selectedExternalIds.has(e.externalId));
      if (events.length === 0) throw new Error("Select at least one event to import");
      const response = await apiRequest("POST", "/api/calendar-imports/confirm", {
        source: sourceKey,
        sourceLabel,
        profileIds: selectedProfileIds,
        events,
      });
      return (await response.json()) as { importedCount: number; skippedCount: number };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/events"] });
      const desc = result.skippedCount > 0
        ? `${result.importedCount} added, ${result.skippedCount} skipped (already imported)`
        : `${result.importedCount} added to your calendar`;
      toast({ title: "Calendar imported", description: desc });
      handleClose(false);
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err?.message || String(err), variant: "destructive" });
    },
  });

  const toggleExternalId = (id: string) => {
    setSelectedExternalIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    if (selectedExternalIds.size === preview.events.length) {
      setSelectedExternalIds(new Set());
    } else {
      setSelectedExternalIds(new Set(preview.events.map(e => e.externalId)));
    }
  };

  const toggleProfile = (id: string) => {
    setSelectedProfileIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const isLoading = icsPreviewMutation.isPending || pdfPreviewMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-3xl bg-card rounded-2xl border border-border shadow-xl max-h-[90vh] flex flex-col" data-testid="calendar-import-modal">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Import calendar
          </DialogTitle>
        </DialogHeader>

        {!preview && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "ics" | "pdf")} className="flex-1">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="ics" data-testid="tab-ics">
                <Link2 className="w-4 h-4 mr-2" />
                ICS link
              </TabsTrigger>
              <TabsTrigger value="pdf" data-testid="tab-pdf">
                <FileText className="w-4 h-4 mr-2" />
                PDF upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ics" className="space-y-4 mt-4">
              <div>
                <Label htmlFor="ics-url">ICS feed URL</Label>
                <Input
                  id="ics-url"
                  placeholder="https://example.com/school-calendar.ics"
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  data-testid="input-ics-url"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Most school districts publish a calendar feed link in their portal. Recurring events are expanded for the next 12 months.
                </p>
              </div>
              <Button
                onClick={() => icsPreviewMutation.mutate()}
                disabled={isLoading || !icsUrl.trim()}
                data-testid="button-fetch-ics"
              >
                {icsPreviewMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Preview events
              </Button>
            </TabsContent>

            <TabsContent value="pdf" className="space-y-4 mt-4">
              <div>
                <Label>School calendar PDF</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Upload a PDF and we'll automatically pull out every dated event using AI.
                </p>
                <ObjectUploader
                  accept="application/pdf"
                  maxFileSize={20 * 1024 * 1024}
                  onComplete={(result) => {
                    if (result.objectPath) pdfPreviewMutation.mutate(result.objectPath);
                  }}
                  buttonClassName="bg-primary text-primary-foreground"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Choose PDF
                  </span>
                </ObjectUploader>
                {pdfPreviewMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading PDF and extracting events… this can take 30-60 seconds.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {preview && (
          <div className="flex flex-col flex-1 min-h-0 gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <strong>{preview.totalCount}</strong> events found
                {preview.rangeStart && preview.rangeEnd && (
                  <span className="text-muted-foreground ml-2">
                    ({format(parseISO(preview.rangeStart), "MMM d, yyyy")} – {format(parseISO(preview.rangeEnd), "MMM d, yyyy")})
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={toggleAll} data-testid="button-toggle-all">
                {selectedExternalIds.size === preview.events.length ? "Deselect all" : "Select all"}
              </Button>
            </div>

            <ScrollArea className="flex-1 min-h-[200px] max-h-[40vh] border border-border rounded-md">
              <div className="divide-y divide-border">
                {preview.events.map((event) => {
                  const start = parseISO(event.startTime);
                  return (
                    <label
                      key={event.externalId}
                      className="flex items-start gap-3 p-3 hover:bg-accent cursor-pointer"
                      data-testid={`row-event-${event.externalId}`}
                    >
                      <Checkbox
                        checked={selectedExternalIds.has(event.externalId)}
                        onCheckedChange={() => toggleExternalId(event.externalId)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{event.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span>{format(start, "EEE, MMM d, yyyy")}</span>
                          {event.isAllDay ? (
                            <Badge variant="outline" className="text-xs">All day</Badge>
                          ) : (
                            <span>{format(start, "h:mm a")}</span>
                          )}
                          {event.location && <span>· {event.location}</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Tag as</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {SOURCE_OPTIONS.map(opt => (
                    <Button
                      key={opt.value}
                      type="button"
                      size="sm"
                      variant={sourceKey === opt.value ? "default" : "outline"}
                      onClick={() => { setSourceKey(opt.value); setSourceLabel(opt.label); }}
                      data-testid={`button-source-${opt.value}`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-sm">Assign to family members</Label>
                <div className="flex flex-wrap gap-2 mt-2 max-h-32 overflow-y-auto">
                  {profiles.map(profile => (
                    <label
                      key={profile.id}
                      className="flex items-center gap-2 px-2 py-1 border border-border rounded-md cursor-pointer text-sm"
                      data-testid={`profile-toggle-${profile.id}`}
                    >
                      <Checkbox
                        checked={selectedProfileIds.includes(profile.id)}
                        onCheckedChange={() => toggleProfile(profile.id)}
                      />
                      <span style={{ color: profile.color }}>●</span>
                      {profile.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {previewMethod === "pdf" && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-accent/40 p-2 rounded-md">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>AI extraction may miss or misread some dates. Review the list and uncheck anything that doesn't look right before importing.</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <Button variant="ghost" onClick={() => { setPreview(null); setPreviewMethod(null); }} data-testid="button-back">
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button
                  onClick={() => confirmMutation.mutate()}
                  disabled={confirmMutation.isPending || selectedExternalIds.size === 0}
                  data-testid="button-confirm-import"
                >
                  {confirmMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Import {selectedExternalIds.size} event{selectedExternalIds.size === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
