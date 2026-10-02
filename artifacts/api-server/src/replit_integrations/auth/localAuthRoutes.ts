import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { authStorage } from "./storage";
import { hashPassword, verifyPassword, isValidEmail, isValidPassword } from "./password";
import { verifyAppleIdentityToken, AppleAuthError } from "./appleAuth";
import { checkRateLimit } from "./rateLimit";
import { signMobileToken } from "./mobileTokens";
import { generateResetToken, hashResetToken, resetTokenHashesMatch, RESET_TOKEN_TTL_MS } from "./resetToken";
import { sendEmail } from "../../lib/email";
import { resolvePublicBaseUrl, escapeHtml } from "../../lib/publicUrl";
import { startTrialForNewAccount } from "../../lib/subscriptionEntitlement";

// Matches the session-user shape the OIDC verify() callback builds (see
// updateUserSession/upsertUser in replitAuth.ts) so isAuthenticated,
// attachFamilyAndContinue, and passport's pass-through
// serializeUser/deserializeUser all work unmodified for every auth method.
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // matches the cookie maxAge

function buildSessionUser(
  provider: "email" | "apple",
  claims: {
    sub: string;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    profile_image_url?: string | null;
  },
) {
  return {
    claims,
    // No refresh_token: when this expires the user must sign in again. That's
    // fine — it lines up with the session cookie's own 7-day maxAge, so both
    // expire together instead of the cookie outliving a "logged out" state.
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    authProvider: provider,
  };
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

// Every successful signup/login/apple response includes a mobile bearer
// token alongside the session cookie. Web clients rely on the cookie and
// ignore this field; the native (Capacitor) client can't use cookies inside
// its WebView (same reason the existing Replit OIDC flow issues one — see
// nativeAuth.ts), so it stores this instead.
function issueMobileToken(claims: {
  sub: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
}): string {
  return signMobileToken({
    sub: claims.sub,
    email: claims.email ?? undefined,
    first_name: claims.first_name ?? undefined,
    last_name: claims.last_name ?? undefined,
    profile_image_url: claims.profile_image_url ?? undefined,
  });
}

export function registerLocalAuthRoutes(app: Express) {
  // Best-effort periodic cleanup of expired-but-never-used reset tokens.
  // .unref() so this timer never keeps the process alive on its own.
  setInterval(
    () => {
      authStorage.deleteExpiredPasswordResetTokens().catch((err) => {
        console.error("[auth] failed to clean up expired reset tokens:", err);
      });
    },
    6 * 60 * 60 * 1000,
  ).unref();

  // ── Email/password signup ────────────────────────────────────────────────
  app.post("/api/auth/signup", async (req, res) => {
    if (!checkRateLimit(`signup:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ message: "Too many signup attempts. Try again later." });
    }

    const { email, password, displayName } = req.body ?? {};
    if (typeof email !== "string" || !isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (typeof password !== "string" || !isValidPassword(password)) {
      return res.status(400).json({ message: "Password must be 8-256 characters." });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await authStorage.getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: "An account with that email already exists." });
    }

    const passwordHash = await hashPassword(password);
    const trimmedName = typeof displayName === "string" ? displayName.trim().slice(0, 120) : "";

    let user;
    try {
      user = await authStorage.createUser({
        id: randomUUID(),
        email: normalizedEmail,
        displayName: trimmedName || null,
        firstName: trimmedName ? trimmedName.split(/\s+/)[0] : null,
        authProvider: "email",
        passwordHash,
        // Overrides the schema's now()-default (which exists to backfill
        // pre-existing accounts as already onboarded) so this genuinely new
        // account actually gets shown the onboarding wizard.
        onboardingCompletedAt: null,
      } as any);
    } catch (err: any) {
      // Unique constraint race: two signups with the same email landed
      // concurrently. Treat it the same as the pre-check duplicate case.
      if (err?.code === "23505") {
        return res.status(409).json({ message: "An account with that email already exists." });
      }
      console.error("[auth signup] failed to create user:", err);
      return res.status(500).json({ message: "Something went wrong creating your account." });
    }

    // Free-trial-then-subscribe (2026-08 launch plan): stamp the trial clock
    // exactly once, for this genuinely-new account. Fire-and-forget with its
    // own error handling — entitlement bookkeeping must never block signup,
    // and getOrCreateEntitlementRow's own lazy fallback means a missed call
    // here still safely defaults to comped rather than leaving the account
    // in an ambiguous state.
    startTrialForNewAccount(user.id).catch((err) => {
      console.error("[auth signup] failed to start trial for new account:", err);
    });

    const claims = {
      sub: user.id,
      email: user.email ?? undefined,
      first_name: user.firstName,
      last_name: user.lastName,
      profile_image_url: user.profileImageUrl,
    };
    const sessionUser = buildSessionUser("email", claims);
    req.logIn(sessionUser as any, (err) => {
      if (err) {
        console.error("[auth signup] session login failed:", err);
        res.status(500).json({ message: "Account created, but signing you in failed. Please log in." });
        return;
      }
      res.status(201).json({ ok: true, token: issueMobileToken(claims) });
    });
    return;
  });

  // ── Email/password login ─────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const normalizedEmail = email.toLowerCase();
    // Rate-limit by IP+email so a single attacker can't lock out the whole
    // service by hammering one IP, while still bounding per-account guesses.
    if (
      !checkRateLimit(`login:ip:${clientIp(req)}`, 20, 15 * 60 * 1000) ||
      !checkRateLimit(`login:email:${normalizedEmail}`, 10, 15 * 60 * 1000)
    ) {
      return res.status(429).json({ message: "Too many login attempts. Try again later." });
    }

    const user = await authStorage.getUserByEmail(normalizedEmail);
    // Constant response shape/timing-ish for "no such user" vs "wrong
    // password" — don't reveal which one it was.
    if (!user || user.authProvider !== "email" || !user.passwordHash) {
      // Still run a hash comparison against a dummy value so the response
      // time doesn't leak whether the email exists.
      await verifyPassword(password, "0".repeat(32) + ":" + "0".repeat(128));
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const claims = {
      sub: user.id,
      email: user.email ?? undefined,
      first_name: user.firstName,
      last_name: user.lastName,
      profile_image_url: user.profileImageUrl,
    };
    const sessionUser = buildSessionUser("email", claims);
    req.logIn(sessionUser as any, (err) => {
      if (err) {
        console.error("[auth login] session login failed:", err);
        res.status(500).json({ message: "Login failed. Please try again." });
        return;
      }
      res.json({ ok: true, token: issueMobileToken(claims) });
    });
    return;
  });

  // ── Sign in with Apple ───────────────────────────────────────────────────
  // Body: { identityToken, firstName?, lastName? }. firstName/lastName are
  // only ever sent by Apple's client SDK on the user's very first
  // authorization — persist them then, since Apple won't send them again.
  app.post("/api/auth/apple", async (req, res) => {
    if (!checkRateLimit(`apple:${clientIp(req)}`, 20, 15 * 60 * 1000)) {
      return res.status(429).json({ message: "Too many attempts. Try again later." });
    }

    const { identityToken, firstName, lastName } = req.body ?? {};
    if (typeof identityToken !== "string" || !identityToken) {
      return res.status(400).json({ message: "Missing Apple identity token." });
    }

    let identity;
    try {
      identity = await verifyAppleIdentityToken(identityToken);
    } catch (err) {
      if (err instanceof AppleAuthError) {
        console.error("[auth apple] verification failed:", err.message);
        return res.status(401).json({ message: "Apple sign-in verification failed." });
      }
      throw err;
    }

    let user = await authStorage.getUserByAppleId(identity.appleUserId);
    if (!user) {
      // Apple's email can collide with an existing email/Replit account if
      // the user signed up differently before; in that case link rather than
      // duplicate, but only when Apple has verified the email address.
      if (identity.email && identity.emailVerified) {
        const existingByEmail = await authStorage.getUserByEmail(identity.email);
        if (existingByEmail && !existingByEmail.appleUserId) {
          // Link Apple's stable id onto the existing row (upsertUser's
          // onConflictDoUpdate only touches the fields passed here, so this
          // can't clobber anything else on the row — see storage.ts).
          user = await authStorage.upsertUser({
            id: existingByEmail.id,
            appleUserId: identity.appleUserId,
          } as any);
        }
      }
      if (!user) {
        const trimmedName = [firstName, lastName]
          .filter((s) => typeof s === "string" && s.trim())
          .join(" ")
          .trim()
          .slice(0, 120);
        user = await authStorage.createUser({
          id: randomUUID(),
          email: identity.email ?? undefined,
          displayName: trimmedName || null,
          firstName: typeof firstName === "string" ? firstName.trim().slice(0, 60) || null : null,
          lastName: typeof lastName === "string" ? lastName.trim().slice(0, 60) || null : null,
          authProvider: "apple",
          appleUserId: identity.appleUserId,
          // See the email-signup call site above for why this is explicit.
          onboardingCompletedAt: null,
        } as any);
        // See the email-signup call site above — same reasoning, same fire-and-forget.
        startTrialForNewAccount(user.id).catch((err) => {
          console.error("[auth apple] failed to start trial for new account:", err);
        });
      }
    }

    const claims = {
      sub: user.id,
      email: user.email ?? undefined,
      first_name: user.firstName,
      last_name: user.lastName,
      profile_image_url: user.profileImageUrl,
    };
    const sessionUser = buildSessionUser("apple", claims);
    req.logIn(sessionUser as any, (err) => {
      if (err) {
        console.error("[auth apple] session login failed:", err);
        res.status(500).json({ message: "Sign in failed. Please try again." });
        return;
      }
      res.json({ ok: true, token: issueMobileToken(claims) });
    });
    return;
  });

  // ── Forgot password ──────────────────────────────────────────────────────
  // Always responds with the same generic message regardless of whether the
  // account exists — email enumeration would let an attacker map out which
  // addresses have accounts. If the account exists and uses password auth, a
  // reset email actually goes out; if it exists but uses Apple/Replit auth,
  // we email a different, helpful message instead (that's safe: it only
  // reaches someone who already controls the mailbox, so it doesn't leak
  // anything to an attacker who doesn't).
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body ?? {};
    const genericResponse = {
      message: "If an account with that email exists, we've sent a password reset link.",
    };

    if (typeof email !== "string" || !isValidEmail(email)) {
      // Still a 200 with the generic message — don't confirm/deny format
      // validity as a side channel either. (A truly malformed body is the
      // caller's bug, not something we need to help them debug via status codes.)
      res.json(genericResponse);
      return;
    }

    const normalizedEmail = email.toLowerCase();
    if (
      !checkRateLimit(`forgot:ip:${clientIp(req)}`, 20, 60 * 60 * 1000) ||
      !checkRateLimit(`forgot:email:${normalizedEmail}`, 5, 60 * 60 * 1000)
    ) {
      // Rate-limited requests still get the generic response — a 429 here
      // would itself leak "this is a real, actively-targeted email".
      res.json(genericResponse);
      return;
    }

    const user = await authStorage.getUserByEmail(normalizedEmail);
    if (user) {
      const baseUrl = resolvePublicBaseUrl(req);
      try {
        if (user.authProvider === "email") {
          const rawToken = generateResetToken();
          // Only one outstanding link at a time — replacing on every request
          // means an attacker can't "collect" multiple valid tokens over time,
          // and it naturally invalidates a link once a newer one is requested.
          await authStorage.deletePasswordResetTokensForUser(user.id);
          await authStorage.createPasswordResetToken({
            userId: user.id,
            tokenHash: hashResetToken(rawToken),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          });
          const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
          const name = user.firstName ? escapeHtml(user.firstName) : "there";
          // Escape for HTML display text even though resetUrl is normally
          // server-controlled (REPLIT_DOMAINS/PASSWORD_RESET_BASE_URL) — the
          // req.hostname fallback path is technically attacker-influenced via
          // the Host header, so this is defense in depth against that edge case.
          const safeResetUrl = escapeHtml(resetUrl);
          await sendEmail({
            to: normalizedEmail,
            subject: "Reset your SuperHub password",
            html: `<p>Hi ${name},</p><p>We received a request to reset your SuperHub password. This link expires in 1 hour:</p><p><a href="${safeResetUrl}">${safeResetUrl}</a></p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
            text: `Hi ${name},\n\nWe received a request to reset your SuperHub password. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
          });
        } else {
          // Account exists but doesn't use a password — tell them how they
          // actually sign in instead of leaving them stuck.
          const method = user.authProvider === "apple" ? "Sign in with Apple" : "your existing sign-in method";
          await sendEmail({
            to: normalizedEmail,
            subject: "About your SuperHub account",
            html: `<p>We received a password reset request for this email, but this account doesn't use a password — it signs in with <strong>${method}</strong>. Use that instead to get back in.</p>`,
            text: `We received a password reset request for this email, but this account doesn't use a password — it signs in with ${method}. Use that instead to get back in.`,
          });
        }
      } catch (err) {
        // Email delivery failures shouldn't surface differently than the
        // "no such account" path, and shouldn't 500 the request either.
        console.error("[auth forgot-password] failed to send email:", err);
      }
    }

    res.json(genericResponse);
  });

  // ── Reset password ───────────────────────────────────────────────────────
  app.post("/api/auth/reset-password", async (req, res) => {
    if (!checkRateLimit(`reset:ip:${clientIp(req)}`, 30, 15 * 60 * 1000)) {
      res.status(429).json({ message: "Too many attempts. Try again later." });
      return;
    }

    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || !token) {
      res.status(400).json({ message: "Missing or invalid reset token." });
      return;
    }
    if (typeof password !== "string" || !isValidPassword(password)) {
      res.status(400).json({ message: "Password must be 8-256 characters." });
      return;
    }

    const tokenHash = hashResetToken(token);
    const tokenRow = await authStorage.getPasswordResetToken(tokenHash);
    // Recompute-and-compare in constant time even though getPasswordResetToken
    // already looked it up by exact hash — defense in depth against any future
    // change to that lookup (e.g. a prefix-based index) reintroducing a timing
    // side channel.
    if (!tokenRow || !resetTokenHashesMatch(tokenRow.tokenHash, tokenHash)) {
      res.status(400).json({ message: "This reset link is invalid or has expired." });
      return;
    }
    if (tokenRow.expiresAt.getTime() < Date.now()) {
      await authStorage.deletePasswordResetTokensForUser(tokenRow.userId);
      res.status(400).json({ message: "This reset link is invalid or has expired." });
      return;
    }

    const user = await authStorage.getUser(tokenRow.userId);
    if (!user) {
      // Account was deleted after the token was issued.
      await authStorage.deletePasswordResetTokensForUser(tokenRow.userId);
      res.status(400).json({ message: "This reset link is invalid or has expired." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const updated = await authStorage.updatePassword(user.id, passwordHash);
    // Single-use: consume this (and any other outstanding) token immediately
    // so the same emailed link can't be replayed.
    await authStorage.deletePasswordResetTokensForUser(user.id);

    // Log the user in immediately — matches the signup/login UX and saves an
    // extra round trip through the login form right after resetting.
    const claims = {
      sub: updated.id,
      email: updated.email ?? undefined,
      first_name: updated.firstName,
      last_name: updated.lastName,
      profile_image_url: updated.profileImageUrl,
    };
    const sessionUser = buildSessionUser("email", claims);
    req.logIn(sessionUser as any, (err) => {
      if (err) {
        console.error("[auth reset-password] session login failed:", err);
        // The password WAS changed successfully — don't report failure for
        // that just because the auto-login step had a problem.
        res.json({ ok: true });
        return;
      }
      res.json({ ok: true, token: issueMobileToken(claims) });
    });
  });

  // ── Provider-agnostic JSON logout ────────────────────────────────────────
  // Used by email/Apple sessions (and safe for Replit sessions too — it just
  // won't hit Replit's end-session endpoint). The existing GET /api/logout
  // stays as-is for the legacy Replit web flow, but now also delegates here
  // for non-Replit sessions so a stray "Replit logout" redirect never fires
  // for an email/Apple user (see replitAuth.ts).
  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.json({ ok: true });
    });
  });
}
