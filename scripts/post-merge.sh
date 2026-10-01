#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Rebuild the web frontend after every pull so the served bundle always
# matches the latest source. Without this, dist/public goes stale and the app
# keeps loading old JS (this is exactly what silently broke header/UI changes
# for ~2 weeks).
#
# ⚠️ This MUST be the web build, not build:mobile. They differ in one step
# that matters here: `build` runs scripts/postbuild-web.mjs, which renames the
# app's entry to app.html and puts the marketing site at index.html. The
# mobile build deliberately skips that, because the native app loads
# index.html from capacitor://localhost and has to find the APP there.
#
# Running build:mobile here silently undid the swap on every single pull, so
# hubforfamilies.com kept serving the app's login screen after a correct
# deploy of correct code (2026-09-17).
#
# BASE_PATH and PORT are set explicitly: this hook runs outside the artifact's
# own service env, which is where they normally come from.
BASE_PATH=/ PORT=5000 pnpm --filter @workspace/family-hub run build
