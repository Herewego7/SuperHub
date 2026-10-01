/**
 * Where the server is allowed to send a bearer token after sign-in.
 *
 * `/api/login?redirect=<url>` takes the destination straight from the query
 * string, and once the OIDC handshake completes the server appends a JWT to it
 * and redirects there. Anything this function lets through therefore RECEIVES
 * A LOGIN TOKEN — a destination an attacker controls is account takeover.
 *
 * ⚠️ Only the Capacitor iOS app's own scheme is accepted, and that is
 * deliberate (2026-09-30). This used to also accept every destination the
 * retired Expo app needed:
 *
 *   - `exp://`, `exps://` and `expo-development-client://` to any
 *     `*.exp.direct` host, plus `https://*.exp.direct`. `exp.direct` is Expo's
 *     PUBLIC tunnel service — anyone can create `whatever.exp.direct` in a
 *     minute. A sign-in link with `redirect=exp://evil.exp.direct/...` would
 *     have handed the victim's token to that tunnel.
 *   - `exp://` to any localhost or RFC1918 LAN address, and plain
 *     `http://localhost` — whatever happened to be listening there.
 *   - `family-hub-mobile://`, the Expo app's scheme. A custom URL scheme is not
 *     owned by anyone on iOS; with no legitimate app claiming it, any app that
 *     registered it would have been the only taker.
 *
 * The Expo app was never used and has stopped being deployed. Every one of
 * those entries existed only for it, so they went with it.
 *
 * Do not widen this for convenience. A new entry here is a new place a token
 * can be delivered, and it needs to be one the app itself controls.
 *
 * Known remaining limit: `familyhub://` is itself a custom scheme, and iOS does
 * not guarantee a custom scheme belongs to one app either. The robust fix is a
 * Universal Link (an https URL the OS verifies belongs to this app), which is a
 * larger change than this one and not attempted here.
 */
export function isSafeMobileRedirect(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol.toLowerCase() === "familyhub:";
}
