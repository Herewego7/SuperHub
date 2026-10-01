# App tour — full visual walkthrough

`app-tour.mjs` drives the **real app** with Playwright: signs up a brand-new
account, walks the entire onboarding wizard, then visits every nav tab, every
Settings section, the global "+" quick-create menu and its dialogs, and a few
edge-case states (an empty-field validation error, empty-list states, a long
text input). It is not a mock — it exercises the actual signup/session flow,
the actual Postgres-backed storage layer, and the actual React app build.

## Why this needs more than `pnpm dev`

Two things about this app make a plain local `pnpm dev` insufficient for a
Playwright-driven login:

1. **`setupAuth()` calls Replit's OIDC discovery endpoint unconditionally at
   server boot**, even though this app also supports plain email/password
   login. Outside Replit's own network that call fails, and it fails the boot
   before any route (including `/api/auth/login`) is ever registered.
   `mock-oidc.mjs` serves a minimal stub discovery document so boot succeeds;
   the real Replit-login route is never exercised by this tour, so nothing
   beyond `{ issuer }` is required.
2. **The session cookie is `secure: true` unconditionally** (`replitAuth.ts`),
   which needs a genuine HTTPS connection from the *browser's* point of view
   to be stored/sent at all. `proxy.mjs` puts one HTTPS origin (self-signed
   cert, browser launched with `ignoreHTTPSErrors: true`) in front of the
   plain-HTTP Vite dev server and the plain-HTTP api-server, so the browser
   sees one same-origin HTTPS site for both — matching how the app is
   actually served in production, just without a real domain.

## Prerequisites

- A local Postgres reachable at `DATABASE_URL` (any empty database — the
  schema is created by `drizzle-kit push`, not by hand).
- Playwright installed (`pnpm install`, already a devDependency here) with a
  Chromium binary available — set `CHROMIUM_PATH` if it isn't at the default
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- `openssl` on PATH, to generate the (throwaway, local-only) self-signed
  cert used by `mock-oidc.mjs`/`proxy.mjs`. Not committed — generate once:

  ```bash
  mkdir -p e2e/certs
  openssl req -x509 -newkey rsa:2048 -keyout e2e/certs/key.pem -out e2e/certs/cert.pem \
    -days 3 -nodes -subj "/CN=127.0.0.1" \
    -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
  ```

## Running it

From `artifacts/family-hub/e2e/`, in four terminals (or four background
processes — see the top-level session's own notes on `run_in_background` if
scripting this):

```bash
# 1. Schema (idempotent; only needed once per fresh DB)
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname \
  pnpm --filter @workspace/db run push

# 2. Mock OIDC discovery (only exists so the api-server's boot-time
#    discovery call has somewhere to succeed against)
node e2e/mock-oidc.mjs 9443

# 3. The real api-server, against the mock discovery + local DB
cd ../../api-server && pnpm run build && \
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname \
SESSION_SECRET=any-string-for-local-testing \
REPL_ID=local-test-client-id \
ISSUER_URL=https://127.0.0.1:9443 \
PORT=4000 NODE_ENV=development NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node --enable-source-maps ./dist/index.mjs

# 4. The real frontend (Vite dev server)
cd ../family-hub && PORT=5173 BASE_PATH=/ NODE_ENV=development \
  node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0 --port 5173 --strictPort

# 5. The HTTPS proxy unifying 3+4 into one origin
node e2e/proxy.mjs 8443 5173 4000

# 6. The tour itself
RUN_ID=$(date +%s) node e2e/app-tour.mjs
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` on the api-server process only matters
because its own outbound discovery fetch hits the self-signed mock-oidc
server — it does not weaken anything the app serves to real users.

Screenshots land in `e2e/screenshots/` (gitignored) with a numbered filename
per step; a plain-text inventory prints at the end of the run.

## Findings from the first full run (2026-07-29)

Two real, reproducible issues surfaced just from walking the app once, start
to finish, on a brand-new account — noted here rather than fixed, per the
instructions for that run:

- **Onboarding's "Which one is you?" step throws a "Couldn't save profile"
  error toast** when you press Continue without changing anything (no email
  typed, no photo picked — the single most common case, since email/photo
  are both explicitly optional there). Server-side: `PATCH /api/profiles/:id`
  with an empty body throws `Error: No values to set` from drizzle's
  `.set({})` call (`storage.ts`'s `updateProfile`, called from
  `routes.ts:210`). The wizard still advances past it, so it's not a hard
  blocker, but a brand-new user's very first interaction past "Welcome" is a
  red error banner for doing nothing wrong.
- **`GET /api/weather` returned 500** once onboarding finished, on an account
  with no location set. Plausibly specific to this local harness having no
  weather-provider API key configured — not confirmed as a real bug against
  a fully-configured deployment.

Also observed, not necessarily a defect: a React console warning ("Each
child in a list should have a unique key prop... Check the render method of
`FamilyHub`") on first opening the Calendar tab.
