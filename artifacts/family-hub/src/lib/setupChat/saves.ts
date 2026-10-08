// Every save the setup chat makes. Each one sends the same request, with the
// same body, as the setup button or Settings control it stands in for, so an
// answer lands exactly where the old walkthrough put it.
import { COUNTRIES, deviceTimezone, regionToTimezone } from "../regions";
import { STEP_TO_ONBOARDING_KEY, type SkippableStep } from "../onboardingSteps";
import { initialsOf, type Region } from "./parse";

export type RequestFn = (method: "POST" | "PATCH" | "PUT", url: string, body?: unknown) => Promise<any>;

export interface SaveDeps {
  request: RequestFn;
  /** Invalidates one query key, e.g. "/api/profiles". */
  invalidate: (key: string) => void;
}

export async function createProfile(
  d: SaveDeps,
  p: { name: string; color: string; role: "adult" | "child" },
): Promise<{ id: string }> {
  const created = await d.request("POST", "/api/profiles", {
    name: p.name,
    color: p.color,
    initials: initialsOf(p.name),
    role: p.role,
  });
  d.invalidate("/api/profiles");
  return created;
}

export async function updateProfile(
  d: SaveDeps,
  id: string,
  patch: { photoUrl?: string; email?: string; name?: string; initials?: string },
): Promise<void> {
  await d.request("PATCH", `/api/profiles/${id}`, patch);
  d.invalidate("/api/profiles");
}

export async function renameProfile(d: SaveDeps, id: string, name: string): Promise<void> {
  await updateProfile(d, id, { name, initials: initialsOf(name) });
}

export interface SavedLocation {
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string | undefined;
}

export function locationBody(city: string, region: Region): SavedLocation {
  return {
    city,
    state: region.abbr,
    country: COUNTRIES.find((c) => c.code === region.country)!.name,
    // The server geocodes city/state/country on save; 0/0 means "no better
    // guess" and is overwritten.
    latitude: 0,
    longitude: 0,
    timezone: deviceTimezone() ?? regionToTimezone(region.abbr, region.country),
  };
}

export async function saveLocation(d: SaveDeps, city: string, region: Region): Promise<SavedLocation> {
  const body = locationBody(city, region);
  await d.request("PUT", "/api/location-settings", body);
  d.invalidate("/api/location-settings");
  d.invalidate("/api/weather");
  return body;
}

export interface RewardsAnswers {
  pointsMode: "per_chore" | "per_completion";
  redemptionMode: "rewards_only" | "cashout_only" | "both";
  completionBonusPoints?: number;
  starsPerDollar?: number;
}

export function rewardsBody(a: RewardsAnswers): Record<string, unknown> {
  const body: Record<string, unknown> = { redemptionMode: a.redemptionMode, pointsMode: a.pointsMode };
  if (a.pointsMode === "per_completion" && a.completionBonusPoints && a.completionBonusPoints >= 1) {
    body.completionBonusPoints = a.completionBonusPoints;
  }
  if (a.redemptionMode !== "rewards_only" && a.starsPerDollar && a.starsPerDollar > 0) {
    body.centsPerPoint = Math.round(100 / a.starsPerDollar);
  }
  return body;
}

export async function saveRewards(d: SaveDeps, a: RewardsAnswers): Promise<void> {
  await d.request("PUT", "/api/reward-settings", rewardsBody(a));
  d.invalidate("/api/reward-settings");
  d.invalidate("/api/points");
  d.invalidate("/api/chores");
  d.invalidate("/api/chore-completions");
  markStep(d, "rewards", "done");
}

/** A new PIN and what it locks, or (with no PIN) just what it locks. An
 *  empty list turns the PIN off, as "I don't need a PIN right now" did. */
export async function savePin(d: SaveDeps, pinGatedFeatures: string[], parentPin?: string): Promise<void> {
  await d.request("PUT", "/api/reward-settings", parentPin ? { pinGatedFeatures, parentPin } : { pinGatedFeatures });
  d.invalidate("/api/reward-settings");
}

export type InviteeRole = "parent" | "child" | "shared_device";

export async function createInvite(d: SaveDeps, invite: { email?: string; role?: InviteeRole }): Promise<string> {
  const created = await d.request("POST", "/api/family/invites", invite.email ? { email: invite.email, role: invite.role } : {});
  d.invalidate("/api/family/invites");
  return created?.code;
}

export async function joinFamily(d: SaveDeps, code: string): Promise<void> {
  await d.request("POST", "/api/family/join", { code });
}

/** Fire-and-forget, like the walkthrough's own: a failed status write only
 *  means a "Finish setting up" reminder may linger. */
export function markStep(d: SaveDeps, step: SkippableStep, action: "skip" | "done"): void {
  d.request("PATCH", "/api/onboarding-status", { step: STEP_TO_ONBOARDING_KEY[step], action })
    .catch(() => {})
    .finally(() => d.invalidate("/api/onboarding-status"));
}

/** Retried once, as the walkthrough's was: if it fails, setup shows again on
 *  the next launch. */
export async function completeOnboarding(d: SaveDeps): Promise<void> {
  try {
    await d.request("POST", "/api/auth/complete-onboarding");
  } catch {
    await d.request("POST", "/api/auth/complete-onboarding");
  }
  d.invalidate("/api/auth/user");
  d.invalidate("/api/profiles");
}
