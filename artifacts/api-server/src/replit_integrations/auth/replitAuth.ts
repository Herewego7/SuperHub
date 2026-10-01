import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { signMobileToken, verifyMobileToken } from "./mobileTokens";
import { isSafeMobileRedirect } from "../../lib/mobileRedirect";

const getOidcConfig = memoize(
  async () => {
    const issuer = new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc");
    // openid-client refuses a plaintext issuer unless told otherwise, which is
    // the right default. The only way to reach this branch is to point
    // ISSUER_URL at an http:// URL deliberately — the tenant-isolation tests
    // do, against a local stub, so booting the real app does not depend on
    // Replit's OIDC endpoint being reachable. Production's issuer is
    // https://replit.com/oidc, so this is inert there.
    const insecure = issuer.protocol === "http:";
    return await client.discovery(
      issuer,
      process.env.REPL_ID!,
      undefined,
      undefined,
      insecure ? { execute: [client.allowInsecureRequests] } : undefined,
    );
  },
  { maxAge: 3600 * 1000 }
);

// ─── Family resolution hook ──────────────────────────────────────────────────
// The app injects a resolver that maps an authenticated account id to its
// family's owner id (so multiple accounts can share one family's data). Kept as
// an injected function to avoid coupling this generic auth module to app code.
type FamilyResolver = (authUserId: string) => Promise<{
  familyId: string;
  ownerUserId: string;
  role: string;
} | null>;
let familyResolver: FamilyResolver | null = null;

export function setFamilyResolver(fn: FamilyResolver): void {
  familyResolver = fn;
}

// Resolve the family for the authenticated account and attach it to the request,
// then continue. Failures fall back to the raw account id (user sees only their
// own data — never another family's), so resolution can never leak across tenants.
async function attachFamilyAndContinue(
  req: any,
  next: (err?: any) => void,
): Promise<void> {
  try {
    const authUserId = req.user?.claims?.sub;
    if (authUserId && familyResolver) {
      const resolved = await familyResolver(authUserId);
      if (resolved) {
        req.familyOwnerId = resolved.ownerUserId;
        req.familyId = resolved.familyId;
        req.familyRole = resolved.role;
      }
    }
  } catch {
    /* fall back to raw account id via getUserId() */
  }
  next();
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
  // Distinguishes this session from email/Apple sessions (see
  // localAuthRoutes.ts) so /api/logout only redirects through Replit's
  // end-session endpoint for accounts that actually authenticated via Replit.
  user.authProvider = "replit";
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// isSafeMobileRedirect lives in lib/mobileRedirect.ts, where it can be tested
// without starting Express. Every destination it accepts receives a bearer
// token, so it is deliberately narrow — see that file before widening it.

function appendToken(redirectUrl: string, token: string): string {
  const sep = redirectUrl.includes("?") ? "&" : "?";
  return `${redirectUrl}${sep}token=${encodeURIComponent(token)}`;
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      const user = {};
      updateUserSession(user, tokens);
      await upsertUser(tokens.claims());
      verified(null, user);
    } catch (err) {
      console.error("[auth verify] error:", err);
      verified(err as Error);
    }
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Use REPLIT_DOMAINS if available to ensure the correct callback URL
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const effectiveDomain = replitDomain || domain;
    const strategyName = `replitauth:${effectiveDomain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${effectiveDomain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
    return strategyName;
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/auth/login-url", (req, res) => {
    const domain = replitDomain || req.hostname;
    res.json({ url: `https://${domain}/api/login` });
  });

  app.get("/api/login", (req, res, next) => {
    // If the request comes from a non-canonical domain (e.g. the workspace preview),
    // redirect to the canonical domain first so the full auth flow stays on one domain.
    if (replitDomain && req.hostname !== replitDomain) {
      const qIdx = req.url.indexOf("?");
      const qs = qIdx >= 0 ? req.url.substring(qIdx) : "";
      return res.redirect(`https://${replitDomain}/api/login${qs}`);
    }

    // Mobile flow: capture deep-link redirect target so we can hand back a JWT
    // after the OIDC handshake completes.
    const mobileRedirect =
      typeof req.query["redirect"] === "string"
        ? (req.query["redirect"] as string)
        : undefined;
    if (mobileRedirect && isSafeMobileRedirect(mobileRedirect)) {
      // Store in both session and a standalone cookie. The session approach has
      // proven unreliable across the OIDC round-trip on iOS (ephemeral WebKit
      // context); the cookie is a belt-and-suspenders fallback.
      (req.session as any).mobileRedirect = mobileRedirect;
      res.cookie("fh_mr", mobileRedirect, {
        httpOnly: true,
        secure: true,
        maxAge: 10 * 60 * 1000, // 10 min — long enough for a slow login
        sameSite: "lax",
      });
    } else if ((req.session as any).mobileRedirect && !mobileRedirect) {
      // Clear stale values from a previous attempt.
      delete (req.session as any).mobileRedirect;
      res.clearCookie("fh_mr");
    }

    const strategyName = ensureStrategy(req.hostname);
    console.log(
      "[auth login] hostname:",
      req.hostname,
      "strategy:",
      strategyName,
      "mobile:",
      !!(req.session as any).mobileRedirect,
    );

    const doAuthenticate = () =>
      passport.authenticate(strategyName, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);

    if ((req.session as any).mobileRedirect) {
      req.session.save((err) => {
        if (err) console.error("[auth login] session save error:", err);
        doAuthenticate();
      });
    } else {
      doAuthenticate();
    }
  });

  app.get("/api/callback", (req, res, next) => {
    if (req.query.error) {
      console.error(
        "[auth callback] OIDC error:",
        req.query.error,
        req.query.error_description,
      );
      return res.redirect("/api/login");
    }
    const strategyName = ensureStrategy(req.hostname);

    // Try session first; fall back to the standalone cookie set in /api/login.
    const mobileRedirectFromSession = (req.session as any).mobileRedirect as string | undefined;
    const mobileRedirectFromCookie = (() => {
      for (const part of (req.headers.cookie ?? "").split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        if (part.slice(0, eq).trim() === "fh_mr") {
          const val = decodeURIComponent(part.slice(eq + 1).trim());
          return isSafeMobileRedirect(val) ? val : undefined;
        }
      }
      return undefined;
    })();
    const mobileRedirect = mobileRedirectFromSession ?? mobileRedirectFromCookie;

    console.log(
      "[auth callback] sessionID:",
      req.sessionID,
      "session-mr:",
      mobileRedirectFromSession ?? "(none)",
      "cookie-mr:",
      mobileRedirectFromCookie ?? "(none)",
    );

    passport.authenticate(strategyName, (err: any, user: any) => {
      if (err || !user) {
        console.error("[auth callback] passport error:", err);
        return res.redirect("/api/login");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);

        if (mobileRedirect) {
          delete (req.session as any).mobileRedirect;
          res.clearCookie("fh_mr");
          const claims = user.claims ?? {};
          const token = signMobileToken({
            sub: claims.sub,
            email: claims.email,
            first_name: claims.first_name,
            last_name: claims.last_name,
            profile_image_url: claims.profile_image_url,
          });
          // Replit's reverse proxy rewrites non-HTTP Location headers, so we
          // can't use res.redirect("familyhub://...") directly. Instead, serve
          // a tiny HTML page that does the navigation client-side via JS — the
          // proxy has no say over what the browser's JS engine does.
          const deepLink = appendToken(mobileRedirect, token);
          const safeDeepLink = JSON.stringify(deepLink); // escapes for JS string literal
          return res.send(`<!DOCTYPE html><html><head><title>Signing in...</title>
<script>window.location=${safeDeepLink};</script>
</head><body><p>Completing sign-in, returning to app...</p></body></html>`);
        }

        // No mobileRedirect — this is a normal web login. Complete it by
        // redirecting into the app. (A temporary debug page lived here while
        // diagnosing the iOS session/cookie issue; it dead-ended web logins.)
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    // Only Replit-authenticated sessions need the round trip through Replit's
    // own end-session endpoint; email/Apple sessions (see
    // localAuthRoutes.ts) never went through Replit's OIDC provider in the
    // first place, so redirecting them there would be wrong (and would 404 /
    // error at Replit's end).
    const isReplitSession = (req.user as any)?.authProvider === "replit";
    req.logout(() => {
      if (!isReplitSession) {
        return res.redirect("/");
      }
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Mobile path: bearer token issued by signMobileToken().
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.substring(7).trim();
    const payload = verifyMobileToken(token);
    if (!payload) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    (req as any).user = { claims: payload, expires_at: payload.exp };
    return attachFamilyAndContinue(req, next);
  }

  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return attachFamilyAndContinue(req, next);
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return attachFamilyAndContinue(req, next);
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
