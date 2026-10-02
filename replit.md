# SuperHub

## Isolation requirements

SuperHub is an independent app. Never reuse, copy, or connect the G-Cal-3 / Family Hub database, secrets, or deployment. Do not set `VITE_API_BASE_URL` to the Family Hub server. Web API calls use this project's same-origin `/api` routes.

The initial setup must not change application source code. Keep the existing pnpm workspace and stack.

## Running on Replit

- Install dependencies: `pnpm install --frozen-lockfile`.
- Initialize the development database schema: `pnpm --filter @workspace/db run push`. The database is provisioned for this Replit project; do not substitute an external connection.
- Store a unique `SESSION_SECRET` in Replit Secrets. Never put its value in files or documentation.
- Start the managed workflows `artifacts/api-server: API Server` and `artifacts/family-hub: web` with the Run button.
- The API service listens on port 8080 and routes `/api` and `/objects`. The web service listens on port 23890 at `/`. Service configuration supplies `PORT` and `BASE_PATH`.
- Do not add duplicate manual workflows for those artifact services.

The database was empty before schema initialization. The user approved the unchanged app's startup defaults: four sample profiles and a newly generated notification keypair. No existing Family Hub data is imported.

## Dependency setup

Replit's package firewall blocked the imported versions of `tar` and `orval`. Setup updated only dependency configuration and the lockfile, not application source. Do not run API code generation just to start the app.

## Optional services

Email delivery, calendar provider integrations, native Apple services, and uploaded-file storage require separate configuration for this project. Never borrow Family Hub credentials for them.