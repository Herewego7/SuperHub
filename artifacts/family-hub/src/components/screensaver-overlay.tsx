import { useCallback, useEffect, useRef, useState } from "react";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  SCREENSAVER_ACTIVITY_EVENTS,
  screensaverPollMs,
  SCREENSAVER_WAKE_TIMEOUT_MS,
  isScreensaverEnabled,
  screensaverIdleMs,
  shouldShowScreensaver,
} from "@/lib/screensaver";
import { getPrivacyImageUrl, displayBackgroundUrl } from "@/components/privacy-screen";
import { useSignedObjectUrl } from "@/lib/signedObjectUrl";
import { useIsPortrait } from "@/hooks/use-orientation";

/**
 * See `lib/screensaver.ts` for why this exists. In short: a device that never
 * sleeps polls all day, which costs money and shows stale data to anyone
 * walking past. This blanks the screen after an idle period, stops the
 * polling, and refuses to hand the app back until the data is fresh.
 */

/**
 * The one picture this device shows, read fresh each time the screensaver
 * appears so a change made in the privacy screen's picker is picked up
 * without a reload.
 *
 * ⚠️ Deliberately not a rotation. A picture someone chose is a picture they
 * like; cycling others past it means the wall sometimes shows one they don't.
 * It changes when they change it, and not otherwise.
 */
function usePrivacyImage(active: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(active ? getPrivacyImageUrl() : null);
  }, [active]);
  return url;
}

export function ScreensaverOverlay() {
  const qc = useQueryClient();
  const [showing, setShowing] = useState(false);
  const [waking, setWaking] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const chosen = usePrivacyImage(showing);
  // The built-ins are 16:9; on a portrait screen a centre crop of one shows
  // about a thirteenth of its width. Ask the same photo for the other crop.
  const portrait = useIsPortrait();
  // The built-in backgrounds are remote images, and the app has been bitten
  // by that before: the privacy screen once rendered a featureless black
  // rectangle offline, because a CSS background-image has no onError. Fall
  // back to the plain clock rather than a black hole.
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (showing) setFailed(false); }, [showing]);
  // Same as the privacy screen: an uploaded background comes from this
  // device's localStorage, so it needs signing at render. Returns null until
  // it resolves, which lands on the existing "no image" fallback rather than
  // a broken one.
  const signedPhoto = useSignedObjectUrl(chosen ? displayBackgroundUrl(chosen, portrait) : null);
  const photo = failed || !chosen ? null : signedPhoto;
  const lastInteraction = useRef(Date.now());
  // Read through a ref so the activity listeners never need re-binding.
  const showingRef = useRef(false);
  showingRef.current = showing;

  // ── Activity: any of these means somebody is here ────────────────────────
  useEffect(() => {
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    for (const ev of SCREENSAVER_ACTIVITY_EVENTS) {
      // Capture phase: a tap consumed by a button still counts as presence.
      document.addEventListener(ev, touch, { passive: true, capture: true });
    }
    return () => {
      for (const ev of SCREENSAVER_ACTIVITY_EVENTS) {
        document.removeEventListener(ev, touch, { capture: true } as EventListenerOptions);
      }
    };
  }, []);

  // ── Should it be up? Checked on a slow local timer AND on every return to
  //    visibility, which is what makes a sleeping device behave correctly.
  useEffect(() => {
    const evaluate = () => {
      if (showingRef.current || !isScreensaverEnabled()) return;
      if (shouldShowScreensaver(lastInteraction.current, Date.now(), screensaverIdleMs())) {
        setShowing(true);
        // Stop every interval refetch in the app at the source, rather than
        // unpicking `refetchInterval` at a dozen call sites. React Query
        // treats an unfocused app as not worth polling, which is exactly the
        // state this is.
        focusManager.setFocused(false);
      }
    };
    const id = setInterval(evaluate, screensaverPollMs(screensaverIdleMs()));
    const onVisible = () => { if (!document.hidden) evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    evaluate();
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // The clock is the only moving thing on the screensaver, and it is local —
  // nothing here may touch the network, or the whole point is lost.
  useEffect(() => {
    if (!showing) return;
    setClock(new Date());
    const id = setInterval(() => setClock(new Date()), 10_000);
    return () => clearInterval(id);
  }, [showing]);

  // ── Waking: refresh FIRST, hand back the app second ──────────────────────
  const wake = useCallback(() => {
    if (waking) return;
    lastInteraction.current = Date.now();
    setWaking(true);
    // Resume the app's own interval polling...
    focusManager.setFocused(true);

    const finish = () => {
      setShowing(false);
      setWaking(false);
      lastInteraction.current = Date.now();
    };

    // ...and force a refetch of everything on screen rather than relying on
    // focus semantics. `refetchOnWindowFocus` only refetches queries it
    // considers STALE, so with a staleTime longer than the idle period —
    // or a short idle period — regaining focus refreshes NOTHING and the
    // screensaver hands back the very stale screen it exists to prevent.
    // This promises fresh data, so it asks for it.
    let settled = false;
    const done = () => { if (!settled) { settled = true; finish(); } };
    qc.refetchQueries({ type: "active" }).then(done).catch(done);
    // Nobody is ever trapped behind the screensaver: past the timeout the app
    // comes back regardless, stale or not. A blocked screen is a worse
    // failure than an old one, and offline has to land somewhere.
    window.setTimeout(done, SCREENSAVER_WAKE_TIMEOUT_MS);
  }, [qc, waking]);

  if (!showing) return null;

  const hasPhoto = !!photo;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 overflow-hidden ${
        hasPhoto ? "bg-black" : "bg-background"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      onPointerDown={wake}
      onKeyDown={wake}
      role="button"
      tabIndex={0}
      aria-label="Screensaver. Tap to show the family hub."
      data-testid="screensaver"
      data-waking={waking ? "true" : "false"}
      data-photos={hasPhoto ? 1 : 0}
    >
      {photo && (
        <img
          src={photo}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="screensaver-photo-0"
        />
      )}

      {/* A scrim, so the time is legible over a bright photo as well as a
          dark one. Without it the clock disappears into a snowy driveway or
          a white birthday cake. */}
      {hasPhoto && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/25 to-black/55" aria-hidden="true" />
      )}

      <div className="relative flex flex-col items-center gap-2">
        <p
          className={`text-6xl sm:text-7xl font-bold tabular-nums ${hasPhoto ? "text-white" : "text-foreground"}`}
          style={hasPhoto ? { textShadow: "0 2px 18px rgba(0,0,0,.6)" } : undefined}
          data-testid="screensaver-clock"
        >
          {format(clock, "h:mm")}
          <span className={`text-2xl sm:text-3xl font-semibold ml-2 ${hasPhoto ? "text-white/80" : "text-muted-foreground"}`}>
            {format(clock, "a")}
          </span>
        </p>
        <p
          className={`text-base ${hasPhoto ? "text-white/90" : "text-muted-foreground"}`}
          style={hasPhoto ? { textShadow: "0 1px 12px rgba(0,0,0,.6)" } : undefined}
        >
          {format(clock, "EEEE, MMMM d")}
        </p>
        {/* Deliberately NOT a summary of the day: anything shown here would be
            as stale as the screen it replaced, and unlike the app there would
            be no interaction coming to refresh it. */}
        <p
          className={`mt-6 text-xs ${hasPhoto ? "text-white/70" : "text-muted-foreground"}`}
          data-testid="screensaver-hint"
        >
          {waking ? "Getting the latest…" : "Tap anywhere to wake"}
        </p>
      </div>
    </div>
  );
}
