import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest } from "@/lib/queryClient";
import { suggestionForNewEvent, type ScannableEvent } from "@/lib/celebrationDetect";
import type { Profile } from "@workspace/shared-types";
import type { CelebrationListItem } from "@/components/celebrations-view";

/**
 * Offers to add a just-created event to the Celebrations tracker when its
 * title reads like a birthday or anniversary.
 *
 * Design constraint that shapes everything here: **this must never affect
 * event creation.** It runs only after the event has already saved
 * successfully, it never blocks or re-opens the form, and every step is
 * wrapped so that a failure (detection bug, offline, bad data) can only ever
 * mean "no suggestion appears" — never a broken save. Accepting the
 * suggestion fires a completely separate request; if that fails, the event
 * that was just created is untouched.
 *
 * Deliberately silent when:
 *  - the title doesn't match, or reads as a prep task ("Buy birthday gift")
 *  - a celebration already covers that day (see celebrationDetect's dedup)
 *  - no name could be read out of the title — with nothing to call it, a
 *    one-tap add would create a junk entry like "Happy birthday!"'s
 *    Birthday". Those still get picked up by Celebrations → "Scan calendar",
 *    where the name can be typed in before saving.
 */
export function useCelebrationSuggestion() {
  const { toast } = useToast();
  const qc = useQueryClient();

  return useCallback(
    async (event: { title?: string | null; startTime?: Date | string | null }) => {
      try {
        const title = (event.title ?? "").trim();
        if (!title || !event.startTime) return;
        const startTime = event.startTime instanceof Date ? event.startTime : new Date(event.startTime);
        if (Number.isNaN(startTime.getTime())) return;

        // Read from cache when fresh; only hits the network if it isn't.
        const [celebrations, profiles] = await Promise.all([
          qc.fetchQuery<CelebrationListItem[]>({ queryKey: ["/api/celebrations"], staleTime: 60_000 }),
          qc.fetchQuery<Profile[]>({ queryKey: ["/api/profiles"], staleTime: 60_000 }),
        ]);

        const scannable: ScannableEvent = { id: "new-event", title, startTime };
        const candidate = suggestionForNewEvent(scannable, celebrations ?? [], profiles ?? []);
        if (!candidate || !candidate.name) return;

        const typeLabel = candidate.type === "birthday" ? "birthday" : "anniversary";
        toast({
          title: `Looks like a ${typeLabel}`,
          description: `Track ${candidate.name}'s ${typeLabel} in Celebrations so you get a reminder every year?`,
          duration: 10000,
          action: (
            <ToastAction
              altText={`Add ${candidate.name} to Celebrations`}
              onClick={() => {
                void (async () => {
                  try {
                    await apiRequest("POST", "/api/celebrations", {
                      name: candidate.name,
                      monthDay: candidate.monthDay,
                      year: candidate.year,
                      type: candidate.type,
                      profileIds: candidate.profileIds,
                      // Only show an age/anniversary number when a year was
                      // actually stated in the title — never a guess.
                      showYear: candidate.year !== null,
                      notes: null,
                      customLabel: null,
                    });
                    qc.invalidateQueries({ queryKey: ["/api/celebrations"] });
                    qc.invalidateQueries({ queryKey: ["/api/celebrations/upcoming"] });
                    qc.invalidateQueries({ queryKey: ["/api/celebrations/calendar"] });
                    toast({
                      title: "Added to Celebrations",
                      description: "You can edit or remove it from the Celebrations screen.",
                    });
                  } catch (err: any) {
                    toast({
                      title: err?.message || "Couldn't add to Celebrations",
                      variant: "destructive",
                    });
                  }
                })();
              }}
            >
              Add
            </ToastAction>
          ),
        });
      } catch {
        // Never let a suggestion failure surface as an event-creation error.
      }
    },
    [qc, toast],
  );
}
