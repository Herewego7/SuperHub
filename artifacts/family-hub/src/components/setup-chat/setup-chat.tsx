// First-run setup as a chat. The script (lib/setupChat/script.ts) decides what
// to ask and sends the same requests the old wizard's buttons did; this file
// draws it and feeds it answers.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@workspace/shared-types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SkippableStep } from "@/lib/onboardingSteps";
import { PIN_GATE_DEFAULT_FEATURES, PIN_GATE_FEATURES } from "@/lib/parentGate";
import {
  answer,
  knownPeople,
  progress,
  resumeState,
  startState,
  summary,
  view,
  type Answer,
  type Deps,
  type Entry,
  type Mode,
  type Person,
  type RewardsNow,
  type SetupContext,
  type SetupState,
} from "@/lib/setupChat/script";
import { clearSession, loadSession, saveSession } from "@/lib/setupChat/session";
import { CalendarConnectionsSection } from "@/components/settings-modal";
import { OnboardingTour } from "@/components/onboarding-tour";
import {
  Answers,
  BotBubble,
  BotRow,
  CalendarLiveCard,
  CalendarsCard,
  CodeCard,
  Composer,
  LocationCard,
  MeBubble,
  MePhoto,
  MePin,
  PictureCard,
  PinChooseCard,
  PinLocksCard,
  ProfileCard,
  RewardsCard,
  RosterCard,
  SummaryCard,
  Typing,
} from "./setup-chat-cards";
import { BotAvatar, ROUNDED_FONT } from "./illustrations";

export interface SetupChatProps {
  onSignOut: () => void;
  /** Signed in to a family someone else set up. */
  forJoiner?: boolean;
  /** Set when replaying from Settings or Announcements: start at this chapter. */
  initialStep?: SkippableStep;
  /** Ends a replay. */
  onClose?: () => void;
}

type LocationNow = SetupContext["location"];
interface WeatherNow {
  temperature: number;
  condition: string;
}

const isMine = (entry: Entry) => entry.kind === "me" || entry.kind === "me-pin" || entry.kind === "me-photo";

/** Typing dots only for waits long enough to notice. */
const TYPING_DELAY_MS = 250;

export function SetupChat({ onSignOut, forJoiner = false, initialStep, onClose }: SetupChatProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const userId = user?.id ?? "";
  const isReplay = initialStep !== undefined;

  const saved = useMemo(() => (isReplay || !userId ? null : loadSession(userId)), [isReplay, userId]);
  const mode: Mode = isReplay ? "replay" : saved?.mode ?? (forJoiner && user?.family?.isOwner !== true ? "joiner" : "fresh");

  const profilesQuery = useQuery<Profile[]>({ queryKey: ["/api/profiles"] });
  const locationQuery = useQuery<LocationNow>({ queryKey: ["/api/location-settings"] });
  const rewardsQuery = useQuery<RewardsNow>({ queryKey: ["/api/reward-settings"] });
  const inviteRoleQuery = useQuery<{ role: string | null }>({ queryKey: ["/api/family/my-invite-role"], enabled: mode === "joiner" });

  const realProfiles = useMemo(() => (profilesQuery.data ?? []).filter((p) => !p.isAllFamilyProfile), [profilesQuery.data]);
  const ctx = useMemo<SetupContext>(
    () => ({
      user: { id: userId, email: user?.email, firstName: user?.firstName, displayName: user?.displayName },
      profiles: realProfiles.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        role: p.role,
        photoUrl: p.photoUrl,
        email: p.email,
        googleCalendarConnected: p.googleCalendarConnected,
        outlookCalendarConnected: p.outlookCalendarConnected,
        icalConnected: p.icalConnected,
      })),
      location: locationQuery.data ?? null,
      rewards: rewardsQuery.data
        ? {
            hasParentPin: !!rewardsQuery.data.hasParentPin,
            pinGatedFeatures: rewardsQuery.data.pinGatedFeatures ?? [],
            redemptionMode: rewardsQuery.data.redemptionMode,
            pointsMode: rewardsQuery.data.pointsMode,
            centsPerPoint: rewardsQuery.data.centsPerPoint,
            completionBonusPoints: rewardsQuery.data.completionBonusPoints,
            currencySymbol: rewardsQuery.data.currencySymbol,
          }
        : null,
      inviteRole: inviteRoleQuery.data?.role ?? null,
      pinFeatures: PIN_GATE_FEATURES.map(({ key, label }) => ({ key, label })),
      pinDefaults: PIN_GATE_DEFAULT_FEATURES,
    }),
    [userId, user?.email, user?.firstName, user?.displayName, realProfiles, locationQuery.data, rewardsQuery.data, inviteRoleQuery.data],
  );

  const deps = useMemo<Deps>(
    () => ({
      ctx,
      request: async (method, url, body) => {
        const res = await apiRequest(method, url, body);
        if (res.status === 204) return null;
        return res.json().catch(() => null);
      },
      invalidate: (key) => {
        void queryClient.invalidateQueries({ queryKey: [key] });
      },
    }),
    [ctx],
  );
  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const ready =
    !!user &&
    profilesQuery.isFetched &&
    locationQuery.isFetched &&
    rewardsQuery.isFetched &&
    (mode !== "joiner" || inviteRoleQuery.isFetched);

  const [state, setState] = useState<SetupState | null>(null);
  const stateRef = useRef<SetupState | null>(null);
  // Set once the chat has handed off (joined, finished, closed): nothing after
  // that may answer or overwrite the saved session.
  const endedRef = useRef(false);

  useEffect(() => {
    if (!ready || stateRef.current) return;
    if (isReplay) clearSession(userId);
    const first = saved?.state ? resumeState(saved.state) : startState(mode, depsRef.current, initialStep);
    stateRef.current = first;
    setState(first);
  }, [ready, isReplay, userId, saved, mode, initialStep]);

  useEffect(() => {
    if (state && !endedRef.current && userId) saveSession(userId, mode, state);
  }, [state, userId, mode]);

  // Answers run one at a time, in order, so a photo that finishes uploading
  // while a save is in flight still lands.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!busy) {
      setTyping(false);
      return;
    }
    const timer = setTimeout(() => setTyping(true), TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const send = useCallback(
    (a: Answer) => {
      pendingRef.current += 1;
      setBusy(true);
      queueRef.current = queueRef.current.then(async () => {
        try {
          const current = stateRef.current;
          if (!current || endedRef.current) return;
          const out = await answer(current, a, depsRef.current);
          if (out.after === "joined") {
            endedRef.current = true;
            saveSession(userId, "joiner", null);
            toast({ title: "Joined family!" });
            window.location.href = "/";
          } else if (out.after === "finish") {
            endedRef.current = true;
            clearSession(userId);
          } else if (out.after === "close") {
            endedRef.current = true;
          }
          stateRef.current = out.state;
          setState(out.state);
          if (out.after === "close") onClose?.();
        } catch (error) {
          console.error("Setup chat answer failed", error);
        } finally {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) setBusy(false);
        }
      });
    },
    [userId, toast, onClose],
  );

  const people = useMemo(() => (state ? knownPeople(state, ctx) : []), [state, ctx]);
  const current = useMemo(() => (state ? view(state, ctx) : null), [state, ctx]);
  const chapters = state ? progress(state) : { labels: [], at: -1 };

  const hasPlace = !!state?.savedLocation || !!ctx.location?.city;
  const weatherQuery = useQuery<WeatherNow>({ queryKey: ["/api/weather"], enabled: hasPlace && state?.q === "done", retry: false, staleTime: 10 * 60 * 1000 });
  const weather =
    weatherQuery.data && typeof weatherQuery.data.temperature === "number"
      ? `${Math.round(weatherQuery.data.temperature)}°${weatherQuery.data.condition ? ` ${weatherQuery.data.condition.toLowerCase()}` : ""}`
      : null;

  // ── Scrolling: new content scrolls into view, and the log stays pinned to
  // the bottom while the keyboard opens and closes.
  const logRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef(0);
  const pinnedRef = useRef(true);
  const transcriptLength = state?.transcript.length ?? 0;
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || !state) return;
    const firstNew = seenRef.current;
    seenRef.current = state.transcript.length;
    const bottom = log.scrollHeight - log.clientHeight;
    const fresh = firstNew > 0 ? log.querySelector<HTMLElement>(`[data-entry="${firstNew}"]`) : null;
    // A long reply (a roster, a summary) starts at its top instead of its end.
    const target = fresh && log.scrollHeight - fresh.offsetTop > log.clientHeight ? fresh.offsetTop - 12 : bottom;
    log.scrollTo({ top: Math.max(0, target), behavior: firstNew === 0 ? "auto" : "smooth" });
  }, [transcriptLength, state?.q, typing]);
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    if (log.firstElementChild) observer.observe(log.firstElementChild);
    return () => observer.disconnect();
  }, [state === null]);

  const pick = useCallback((id: string) => send({ kind: "choice", id }), [send]);
  const type = useCallback((text: string) => send({ kind: "text", text }), [send]);
  const photo = useCallback((profileId: string, photoUrl: string) => send({ kind: "photo", profileId, photoUrl }), [send]);

  const summaryNow = state && state.transcript.some((e) => e.kind === "summary") ? summary(state, ctx) : null;
  const lastIndex = (kind: Entry["kind"]) => (state ? state.transcript.map((e) => e.kind).lastIndexOf(kind) : -1);
  const liveLocation = lastIndex("location");
  const liveSummary = lastIndex("summary");
  const liveRoster = lastIndex("roster");

  const renderEntry = (entry: Entry, index: number, avatar: boolean): ReactNode => {
    switch (entry.kind) {
      case "bot":
        return <BotBubble avatar={avatar} text={entry.text} />;
      case "me":
        return <MeBubble>{entry.text}</MeBubble>;
      case "me-pin":
        return <MePin />;
      case "me-photo":
        return <MePhoto photoUrl={entry.photoUrl} />;
      case "picture":
        return <PictureCard avatar={avatar} art={entry.art} tint={entry.tint} title={entry.title} body={entry.body} />;
      case "profile": {
        const person = people.find((p) => p.id === entry.id);
        return person ? <ProfileCard avatar={avatar} person={person} line={entry.line} /> : null;
      }
      case "roster": {
        const shown = entry.ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
        return <RosterCard avatar={avatar} people={shown} drafts={entry.draft} roles={entry.roles} camera={entry.camera && index === liveRoster && state!.q === "family-review"} onPhoto={photo} />;
      }
      case "location":
        return <LocationCard avatar={avatar} city={entry.city} region={entry.region} timezone={entry.timezone} live={index === liveLocation} />;
      case "calendars":
        return <CalendarsCard avatar={avatar} people={people} />;
      case "rewards":
        return <RewardsCard avatar={avatar} rewards={ctx.rewards} />;
      case "pin-locks":
        return (
          <PinLocksCard
            avatar={avatar}
            title={entry.title}
            features={entry.features}
            labels={Object.fromEntries(ctx.pinFeatures.map((f) => [f.key, f.label]))}
          />
        );
      case "code":
        return <CodeCard avatar={avatar} code={entry.code} email={entry.email} />;
      case "summary":
        return summaryNow ? (
          <SummaryCard
            avatar={avatar}
            {...summaryNow}
            weather={weather}
            onChange={index === liveSummary && state!.q === "done" && !busy ? (id) => pick(`change:${id}`) : undefined}
          />
        ) : null;
    }
  };

  const liveCard = (() => {
    if (!current?.card || !state) return null;
    if (current.card === "calendar-live") {
      return (
        <CalendarLiveCard>
          <CalendarConnectionsSection
            profiles={realProfiles}
            onBeforeWebRedirect={() => {
              if (stateRef.current && userId) saveSession(userId, mode, stateRef.current);
            }}
          />
        </CalendarLiveCard>
      );
    }
    if (current.card === "pin-choose") {
      return <PinChooseCard features={ctx.pinFeatures} on={state.pinChoice ?? ctx.pinDefaults} onToggle={(key) => send({ kind: "toggle", key })} disabled={busy} />;
    }
    return (
      <BotRow wide>
        <div className="rounded-2xl bg-white p-3 dark:bg-card" data-testid="setup-card-tour">
          <OnboardingTour onDone={() => send({ kind: "tour-done" })} />
        </div>
      </BotRow>
    );
  })();

  const chapterLabel = state ? chapters.labels[chapters.at] ?? "Getting started" : "";

  return (
    <div
      className="hearth-theme opaque-vars fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      data-testid="setup-chat"
      data-question={state?.q}
      data-busy={busy ? "" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Set up SuperHub"
    >
      <header className="shrink-0 border-b border-border bg-background px-4 pb-2.5" style={{ paddingTop: "calc(14px + env(safe-area-inset-top, 0px))" }}>
        <div className="mx-auto flex w-full max-w-lg items-center gap-2.5">
          <BotAvatar size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold leading-5" style={{ fontFamily: ROUNDED_FONT }}>
              Set up SuperHub
            </div>
            <div className="text-xs leading-4 text-muted-foreground" data-testid="setup-chat-chapter">
              {chapterLabel}
            </div>
          </div>
          {isReplay ? (
            <button type="button" onClick={() => onClose?.()} data-testid="setup-chat-close" className="shrink-0 rounded-full px-2 py-1 text-[13px] font-semibold text-[#5E8FAD]">
              Close
            </button>
          ) : (
            <button type="button" onClick={onSignOut} data-testid="setup-chat-signout" className="shrink-0 rounded-full px-2 py-1 text-[13px] text-muted-foreground">
              Sign out
            </button>
          )}
        </div>
        {chapters.labels.length ? (
          <div className="mx-auto mt-2.5 flex w-full max-w-lg gap-1" data-testid="setup-chat-progress" aria-label={`Step ${chapters.at + 1} of ${chapters.labels.length}`}>
            {chapters.labels.map((label, index) => (
              <div key={label} className={`h-1 flex-1 rounded-full ${index <= chapters.at ? "bg-[#5E8FAD]" : "bg-border"}`} />
            ))}
          </div>
        ) : null}
      </header>

      <div
        ref={logRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        data-testid="setup-chat-log"
        role="log"
        aria-label="Setup conversation"
        onScroll={(event) => {
          const log = event.currentTarget;
          pinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-end gap-2 px-3.5 pb-1.5 pt-3">
          {!state ? <Typing /> : null}
          {state?.transcript.map((entry, index) => {
            const previous = state.transcript[index - 1];
            const avatar = !isMine(entry) && (!previous || isMine(previous));
            return (
              <div key={index} data-entry={index}>
                {renderEntry(entry, index, avatar)}
              </div>
            );
          })}
          {state && typing ? <Typing /> : null}
          {state && current && !typing ? (
            <>
              {liveCard}
              <Answers view={current} people={people} disabled={busy} onPick={pick} onPhoto={photo} photoFor={state.meId} />
            </>
          ) : null}
        </div>
      </div>

      {current && current.input !== "none" ? (
        <footer className="shrink-0 bg-background px-3.5 pt-2" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto w-full max-w-lg">
            <Composer question={state?.q ?? ""} view={current} disabled={busy} onSend={type} />
          </div>
        </footer>
      ) : null}
    </div>
  );
}

