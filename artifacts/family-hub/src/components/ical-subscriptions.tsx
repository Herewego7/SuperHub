import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { confirmDialog } from "@/lib/confirmDialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Profile, IcalSubscription } from "@workspace/shared-types";
import { Link2, Trash2, Plus, AlertCircle, ChevronDown } from "lucide-react";
import { DISCONNECT_CALENDAR_BODY } from "@/lib/copy";

const ICAL_COLORS = [
  "#5E8FAD", "#E07B6A", "#6DB98A", "#A67BB9",
  "#D4A843", "#5BA9A9", "#D97DB5", "#7B9E6B",
];

interface ProfileCalendarRowProps {
  profile: Profile;
  /** Start (or re-start) the Google OAuth flow for this profile. */
  onGoogleConnect: (profileId: string) => void;
  onGoogleDisconnect: (profileId: string) => void;
  /** Start (or re-start) the Outlook OAuth flow for this profile. */
  onOutlookConnect: (profileId: string) => void;
  onOutlookDisconnect: (profileId: string) => void;
}

/**
 * One row per family member covering ALL calendar connection types:
 * Google & Outlook (OAuth, two-way) plus iCal/URL feeds (read-only). The
 * OAuth handlers are passed down from the settings modal; iCal feeds are
 * managed locally here since they need no OAuth.
 */
export function ProfileCalendarRow({
  profile,
  onGoogleConnect,
  onGoogleDisconnect,
  onOutlookConnect,
  onOutlookDisconnect,
}: ProfileCalendarRowProps) {
  const { toast } = useToast();
  const googleConnected = !!profile.googleCalendarConnected;
  const outlookConnected = !!profile.outlookCalendarConnected;

  const { data: subs = [] } = useQuery<IcalSubscription[]>({
    queryKey: ["/api/ical-calendar/subscriptions", profile.id],
    queryFn: async () => (await apiRequest("GET", `/api/ical-calendar/subscriptions/${profile.id}`)).json(),
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(ICAL_COLORS[0]);
  const resetForm = () => { setUrl(""); setName(""); setColor(ICAL_COLORS[0]); setIsFormOpen(false); };

  const subscribeMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/ical-calendar/subscribe", {
        profileId: profile.id,
        feedUrl: url.trim(),
        calendarName: name.trim(),
        calendarColor: color,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ical-calendar/subscriptions", profile.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ical-calendar/events", profile.id] });
      toast({ title: "Calendar subscribed", description: "Events will appear on the calendar shortly." });
      resetForm();
    },
    onError: (e: any) => toast({ title: "Couldn't add calendar", description: e?.message || "Check the URL and try again.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ical-calendar/subscriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ical-calendar/subscriptions", profile.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ical-calendar/events", profile.id] });
      toast({ title: "Calendar removed" });
    },
    onError: () => toast({ title: "Couldn't remove calendar", variant: "destructive" }),
  });

  const hasAnything = googleConnected || outlookConnected || subs.length > 0;

  return (
    // No border/rounding of its own — this renders inside the single
    // unified per-person calendar card in settings-modal.tsx now, which
    // supplies the outer border. (Previously this was its own separate
    // bordered card, stacked above a second, separately-bordered list for
    // calendar assignment — merged into one card per the 2026-08-18 redesign.)
    <div className="p-3">
      {/* Header: name + Connect menu */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: profile.color }} />
        <span className="text-sm font-medium flex-1 min-w-[4rem]">{profile.name}</span>
        {/* modal={false}: a real, reproducible bug (2026-08-27) — this
            dropdown lives inside pages that ALREADY manage their own
            overlay/pointer-lock state (Settings' own Dialog, and the
            onboarding wizard's full-screen replay overlay). Radix's default
            modal DropdownMenu applies its OWN scroll-lock/pointer-blocking
            on open, which conflicts with the ancestor's — dismissing the
            menu by clicking OUTSIDE it (not Escape, not picking an option)
            left `document.body`/`<html>` permanently `pointer-events: none`,
            silently freezing every click on the entire page until a full
            reload. Confirmed with a real (non-forced) Playwright click that
            failed with "<html>...intercepts pointer events" in BOTH
            Settings' Calendar Connections and the onboarding calendar step
            — a pre-existing bug, not something new to either. `modal=false`
            tells Radix this menu doesn't need its own focus-trap/pointer-
            lock since it's always nested inside a page that already handles
            that, which is the standard fix for this exact Radix issue class. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            {/* "Add another" once something is already connected: this menu is
                per-profile (it also offers the other provider and iCal), but
                labelled a bare "Connect" it read as contradicting the
                "Disconnect" sitting right beside it. It's also de-emphasised
                in that state, since the common case is already done. */}
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              variant={hasAnything ? "outline" : "default"}
              data-testid={`connect-calendar-${profile.id}`}
            >
              <Plus className="w-3 h-3" />
              {hasAnything ? "Add another" : "Connect"}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!googleConnected && (
              <DropdownMenuItem onClick={() => onGoogleConnect(profile.id)} data-testid={`connect-google-calendar-${profile.id}`}>
                <i className="fab fa-google mr-2"></i> Google Calendar
              </DropdownMenuItem>
            )}
            {!outlookConnected && (
              <DropdownMenuItem onClick={() => onOutlookConnect(profile.id)} data-testid={`connect-outlook-calendar-${profile.id}`}>
                <i className="fab fa-microsoft mr-2"></i> Outlook
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => { resetForm(); setIsFormOpen(true); }} data-testid={`ical-add-${profile.id}`}>
              <Link2 className="w-3.5 h-3.5 mr-2" /> iCal / URL feed (read-only)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Connected items: Google / Outlook (two-way) + iCal feeds (read-only) */}
      {hasAnything && (
        <div className="space-y-1.5 mt-2">
          {googleConnected && (
            <div className="flex items-center justify-between gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-background text-muted-foreground flex items-center gap-1 shrink-0">
                <i className="fab fa-google"></i> Google
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm" className="h-7 px-2 text-xs" variant="outline"
                  onClick={async () => {
                    if (await confirmDialog({ title: "Disconnect Google Calendar?", description: DISCONNECT_CALENDAR_BODY, confirmLabel: "Disconnect" })) {
                      onGoogleDisconnect(profile.id);
                    }
                  }}
                  data-testid={`disconnect-google-calendar-${profile.id}`}
                >
                  Disconnect
                </Button>
                <Button
                  size="sm" className="h-7 px-2 text-xs" variant="outline"
                  onClick={() => onGoogleConnect(profile.id)}
                  data-testid={`reconnect-google-calendar-${profile.id}`}
                >
                  Reconnect
                </Button>
              </div>
            </div>
          )}
          {outlookConnected && (
            <div className="flex items-center justify-between gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-background text-muted-foreground flex items-center gap-1 shrink-0">
                <i className="fab fa-microsoft"></i> Outlook
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm" className="h-7 px-2 text-xs" variant="outline"
                  onClick={async () => {
                    if (await confirmDialog({ title: "Disconnect Outlook Calendar?", description: DISCONNECT_CALENDAR_BODY, confirmLabel: "Disconnect" })) {
                      onOutlookDisconnect(profile.id);
                    }
                  }}
                  data-testid={`disconnect-outlook-calendar-${profile.id}`}
                >
                  Disconnect
                </Button>
                <Button
                  size="sm" className="h-7 px-2 text-xs" variant="outline"
                  onClick={() => onOutlookConnect(profile.id)}
                  data-testid={`reconnect-outlook-calendar-${profile.id}`}
                >
                  Reconnect
                </Button>
              </div>
            </div>
          )}
          {subs.map(sub => (
            <div key={sub.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sub.calendarColor || profile.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate flex items-center gap-1.5">
                  {sub.calendarName}
                  <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-background text-muted-foreground border border-border flex items-center gap-0.5 flex-shrink-0">
                    <Link2 className="w-2.5 h-2.5" /> Read-only
                  </span>
                </p>
                {sub.lastError ? (
                  <p className="text-[10px] text-destructive flex items-center gap-1 truncate">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {sub.lastError}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground truncate">{sub.feedUrl}</p>
                )}
              </div>
              <Button
                variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={async () => { if (await confirmDialog({ title: `Remove the "${sub.calendarName}" calendar feed?`, confirmLabel: "Remove" })) deleteMutation.mutate(sub.id); }}
                aria-label={`Remove the ${sub.calendarName} calendar feed`}
                title={`Remove the ${sub.calendarName} calendar feed`}
                data-testid={`ical-remove-${sub.id}`}
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* iCal add-feed form */}
      {isFormOpen && (
        <div className="space-y-2 pt-2 mt-2 border-t border-border/60">
          <p className="text-[11px] text-muted-foreground">
            Subscribe to any calendar's <span className="font-mono">.ics</span> link — school, sports, or shared calendars. These are <span className="font-medium">read-only</span> and may take a little while to reflect changes from the source.
          </p>
          <Input
            autoFocus
            placeholder="Paste .ics or webcal:// URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="text-sm"
          />
          <Input
            placeholder="Calendar name (e.g. School Calendar)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm"
            maxLength={120}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Color:</span>
            {ICAL_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-foreground scale-110" : "hover:scale-110"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!url.trim() || !name.trim() || subscribeMutation.isPending}
              onClick={() => subscribeMutation.mutate()}
            >
              {subscribeMutation.isPending ? "Checking feed…" : "Subscribe"}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
