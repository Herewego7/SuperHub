import { createRemoteJWKSet, jwtVerify } from "jose";

// Apple's Sign In With Apple identity token is a standard OIDC id_token. We
// verify it against Apple's published JWKS rather than trusting the client —
// the client only ever hands us the raw signed token from Apple's native SDK
// or JS SDK, never anything we construct ourselves.
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Accepted audiences: the iOS app's bundle id (native Sign In With Apple) and,
// optionally, a web/services id if Apple Sign In is ever added to the web
// build. Comma-separated so ops can add one without a code change.
function getAcceptedAudiences(): string[] {
  const raw = process.env.APPLE_SIGNIN_AUDIENCE ?? process.env.APNS_BUNDLE_ID ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AppleIdentity {
  appleUserId: string; // stable "sub" claim
  email: string | null; // only reliably present on the FIRST sign-in
  emailVerified: boolean;
}

export class AppleAuthError extends Error {}

// Verifies a Sign In With Apple identity token (a JWT) against Apple's JWKS.
// Throws AppleAuthError with a safe-to-log message on any failure — callers
// should treat any thrown error as "reject this login attempt".
export async function verifyAppleIdentityToken(
  identityToken: string,
): Promise<AppleIdentity> {
  const audiences = getAcceptedAudiences();
  if (audiences.length === 0) {
    throw new AppleAuthError(
      "APPLE_SIGNIN_AUDIENCE (or APNS_BUNDLE_ID) is not configured on the server",
    );
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: audiences,
    }));
  } catch (err) {
    throw new AppleAuthError(
      `Apple identity token failed verification: ${(err as Error).message}`,
    );
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new AppleAuthError("Apple identity token is missing a subject claim");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  // Apple sends this as a boolean or the string "true"/"false" depending on flow.
  const emailVerifiedRaw = (payload as any).email_verified;
  const emailVerified = emailVerifiedRaw === true || emailVerifiedRaw === "true";

  return { appleUserId: sub, email, emailVerified };
}
