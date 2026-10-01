/**
 * The order the sign-out steps have to happen in.
 *
 * ⚠️ THE ORDER IS THE WHOLE THING, and getting it wrong looked exactly like
 * the button being dead (reported 2026-09-30: "I press it a bunch of times and
 * nothing happens", then finding themselves on onboarding step 1 of 9 a moment
 * later).
 *
 * What went wrong: clearTenantState calls `queryClient.clear()`, and the
 * `/api/auth/user` query is mounted, so React Query refetches it the instant
 * the cache empties. On native that refetch still carried a VALID bearer
 * token, because the token was only dropped afterwards — so it came back with
 * the signed-in user and put them straight back. The later invalidate was
 * deduped against that in-flight request, and its result landed after
 * `setQueryData(null)`, overwriting "signed out" with the user again.
 *
 * The onboarding screen was the same cause wearing a different hat: the cache
 * had genuinely been emptied, so for a moment the app saw an account with zero
 * profiles and classified it as a brand-new family.
 *
 * So: end every credential FIRST, so any refetch the clearing provokes can only
 * ever 401; then cancel what is already in flight; only then clear.
 *
 * ⚠️ "Every credential" means TWO, and the first fix only knew about one. Every
 * sign-in path calls `req.logIn()` on the server, which creates a SESSION and
 * a session cookie — in addition to the bearer token it returns. Inside the
 * app the web view keeps that cookie, and every request goes out with
 * `credentials: "include"`, so it rides along on the refetch. Dropping only the
 * bearer token (2026-09-30, first attempt) left the cookie authenticating the
 * very next `/api/auth/user`, and sign-out still bounced straight back. The
 * server has had `POST /api/auth/logout` for exactly this since email and
 * Apple sign-in were added; nothing in the app ever called it.
 *
 * Extracted as a pure sequence over injected steps because the ordering is the
 * only thing worth testing, and testing it in place would need a device.
 */

export interface LogoutSteps {
  /** Native uses a bearer token; web uses a session cookie and a redirect. */
  isNative: boolean;
  /**
   * End the SERVER session, so the session cookie stops authenticating.
   * Native only — the web path's own redirect to /api/logout already does
   * this, and doing it twice would skip Replit's end-session round trip.
   * Must not throw: offline is not a reason to refuse to sign out.
   */
  endServerSession: () => Promise<void>;
  /** Forget the bearer token. Native only. */
  dropToken: () => Promise<void>;
  /** Abandon in-flight requests so none can resolve into the cleared cache. */
  cancelQueries: () => Promise<void>;
  /** Notifications, signed URLs, query cache, tenant-scoped localStorage. */
  clearTenant: () => Promise<void>;
  /** Record "signed out" explicitly, rather than "not fetched yet". */
  markSignedOut: () => void;
  /** Hand off to the server's logout route. Web only. */
  redirectWeb: () => void;
  /**
   * Restart the app from scratch. Native only — the last step, always.
   * See performLogout for why sign-out ends here rather than in-place.
   */
  reload: () => void;
  /**
   * How long the tidy-up may take before the reload goes ahead regardless.
   * Injected so tests need not wait out the real value.
   */
  tidyUpTimeoutMs?: number;
}

/** Long enough for real tidy-up on a slow phone; short enough not to feel stuck. */
export const LOGOUT_TIDY_UP_TIMEOUT_MS = 4000;

/**
 * Wait for `work`, but never longer than `ms`, and never throw. The tidy-up is
 * worth doing but must not be able to hold sign-out hostage.
 */
function bounded(work: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    work.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

export async function performLogout(steps: LogoutSteps): Promise<void> {
  // 1. BOTH credentials go first. Everything below can trigger a refetch, and a
  //    refetch that still carries either one signs the person back in. The
  //    session goes before the token: ending it is a request, and the request
  //    is only identified as this person's session while it can still be.
  if (steps.isNative) {
    await steps.endServerSession();
    await steps.dropToken();
  }

  if (steps.isNative) {
    // ⚠️ On native, sign-out ENDS IN A RELOAD, and the tidy-up is bounded.
    //
    // Two in-place fixes (token first, then ending the server session too)
    // were each reasoned out and each failed on the device the same way: the
    // button seemed dead, then the app fell into onboarding step 1 of 9, and
    // only a force-quit showed the person was signed out after all
    // (2026-09-30). That last detail is the evidence. The credentials WERE
    // cleared — a fresh launch found none — but the in-place update to the
    // screen never arrived, so something after them stalled or raced, and the
    // cache had been wiped just far enough to look like a brand-new family.
    //
    // Rather than guess a third time at which step, sign-out now finishes the
    // way the one path observed to work does: a fresh start. Credentials first,
    // unconditionally; then the tidy-up, allowed a few seconds but never
    // allowed to block; then reload, which rebuilds every piece of in-memory
    // state from nothing — exactly what a relaunch does, and a relaunch is
    // what reliably showed the signed-out screen.
    //
    // The tidy-up still runs first rather than being skipped: it cancels the
    // household's scheduled medication reminders, which live in iOS and would
    // otherwise keep firing for whoever signs in next.
    const timeout = steps.tidyUpTimeoutMs ?? LOGOUT_TIDY_UP_TIMEOUT_MS;
    await bounded(
      (async () => {
        await steps.cancelQueries();
        await steps.clearTenant();
      })(),
      timeout,
    );
    // Harmless before a reload, and it means the instant before the page goes
    // already reads as signed out rather than flashing the old screen.
    try { steps.markSignedOut(); } catch { /* the reload makes it moot */ }
    steps.reload();
    return;
  }

  // Web: the redirect to /api/logout throws the page away anyway, so it is
  // already a fresh start.
  // 2. Anything already in flight was started while signed in, so its result
  //    is a signed-in user waiting to land on top of the cleared cache.
  await steps.cancelQueries();
  // 3. Now it is safe to empty everything.
  await steps.clearTenant();
  steps.redirectWeb();
}
