# Family photos for App Store screenshots

`dad.jpg`, `mom.jpg`, `ava.jpg`, `noah.jpg` — square crops, 512x512 or larger.

Referenced by `tests/e2e/scenarios/marketingShots.tsx` as each profile's
`photoUrl`, and served by the dev server while `scripts/appstore-screenshots.mjs`
runs.

⚠️ Deliberately NOT in `public/`. Anything under `public/` is copied into
`dist/public` and ends up inside the shipped iOS binary; these images exist
only to render marketing images and must never add weight to the app.
