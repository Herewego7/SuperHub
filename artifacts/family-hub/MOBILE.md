# Family Hub — iOS (Capacitor)

The iOS app is a [Capacitor](https://capacitorjs.com/) native wrapper around the
**web app in this package**. There is a single codebase: whatever ships on the
web ships in the iOS app. Capacitor 8 uses **Swift Package Manager** (no
CocoaPods).

> The older `artifacts/family-hub-mobile` Expo/React Native app is **frozen** —
> Capacitor on the web app is the chosen mobile strategy. Do not invest in the
> Expo app unless that decision is revisited.

## One-time prerequisites (macOS only)

- macOS with **Xcode 26+** (required for App Store submissions from Apr 28 2026)
- An Apple Developer Program membership ($99/yr) for device builds & submission

Linux/CI can run everything **except** opening Xcode and building the `.ipa`.

## Project layout

```
artifacts/family-hub/
├── capacitor.config.ts     # appId (bundle ID), appName, webDir
├── ios/                     # native Xcode project (committed)
│   └── App/App/public/      # generated web build (git-ignored)
└── dist/public/             # vite build output (webDir source)
```

- **Bundle identifier:** `com.familyhub.app` (in `capacitor.config.ts` and the
  Xcode project). Change it before first submission if you use a different domain.

## Daily workflow

```bash
# from artifacts/family-hub
pnpm run build:mobile     # builds the web app with BASE_PATH=/ (required for Capacitor)
pnpm run cap:sync         # copies dist/public into ios/ and updates native plugins
pnpm run cap:open:ios     # opens the project in Xcode (macOS only)

# convenience: all three in order
pnpm run ios
```

Any time the web code changes, re-run `build:mobile` + `cap:sync` (or `pnpm run
ios`) before building in Xcode.

## Backend API URL on device

In the browser the app calls the API with same-origin relative paths. Inside the
iOS webview the origin is `capacitor://localhost`, so the backend origin must be
provided at build time:

```bash
VITE_API_BASE_URL=https://your-backend.example.com pnpm run build:mobile
```

`src/lib/apiBase.ts` prefixes API requests with this value **only** on native
builds; on the web it is a no-op. This is **required** for the native app to sign
in (see below).

## Native authentication (#5)

The web app signs in with Replit OIDC session cookies, which don't work in the
iOS webview. On native we use the backend's existing mobile-JWT flow:

1. `nativeLogin()` opens the **system browser** (`@capacitor/browser`) to
   `${VITE_API_BASE_URL}/api/login?redirect=familyhub://auth`.
2. The backend runs OIDC and redirects to `familyhub://auth?token=<JWT>`.
3. iOS routes that deep link to the app; `@capacitor/app`'s `appUrlOpen` listener
   (registered in `initNativeAuth`, called from `main.tsx`) extracts the token.
4. The JWT is stored in `@capacitor/preferences` (`src/lib/authToken.ts`) and sent
   as `Authorization: Bearer <JWT>` on every request (`queryClient.ts`,
   `use-auth.ts`). Logout clears the token.

Pieces:
- **URL scheme** `familyhub` registered in `Info.plist` (`CFBundleURLTypes`).
- **Backend** whitelists the `familyhub:` scheme in `isSafeMobileRedirect()`
  (`replitAuth.ts`) — already done.
- The mobile JWT is signed with `SESSION_SECRET` and lasts 30 days.

Web behavior is unchanged: `getToken()` returns null on web, so no bearer header
is added and cookie auth is used as before.

**Still needs a device to verify** the OAuth round-trip (browser → deep link →
token). Requires `VITE_API_BASE_URL` pointing at the real backend at build time.

## Native features (#2)

Installed plugins: `@capacitor/haptics`, `@capacitor/local-notifications`,
`@capacitor/push-notifications`.

### Haptics — done
`src/lib/haptics.ts` provides `hapticLight/Medium/Success/Warning`. Native uses the
Taptic Engine; web falls back to the Vibration API (no-op on iOS Safari). Wired
into chore completion, the all-chores-done celebration, the Home confetti, and
reward redemption. Works on web today (Android vibrate) and on device.

### Notifications — code in place, needs device + backend
`src/lib/nativeNotifications.ts` handles APNs registration and on-device local
reminders. Listeners init at boot (`main.tsx`). The Settings → Notifications
screen shows a native enable flow on device (`NativeNotificationsPanel`).

**Backend — done.** `POST /api/push/register-native` stores APNs device tokens
(`{ token, platform, profileId, label }`) in the `native_push_tokens` table, and
`sendPushToUser()` now fans out to **both** Web Push and APNs, so every existing
reminder (health, bedtime, daily brief) reaches the iOS app automatically. APNs
delivery lives in `artifacts/api-server/src/lib/apns.ts` (token-based p8 auth over
the APNs HTTP/2 API, built on Node's `http2` + `crypto` — no extra dependency).
`GET /api/push/native-tokens` and `DELETE /api/push/native-tokens/:id` manage the
registered devices. Tokens APNs reports as invalid (`Unregistered`/`BadDeviceToken`)
are pruned automatically.

**Before remote push works on device, still required:**
1. **Xcode:** enable the **Push Notifications** capability on the App target
   (adds the `aps-environment` entitlement). `UIBackgroundModes:
   remote-notification` is already set in `Info.plist`.
2. **Apple:** create an APNs **p8 auth key** in the Apple Developer portal.
3. **Backend env:** set these so `apns.ts` actually sends (until then it's a safe
   no-op and only Web Push fires):
   - `APNS_KEY_P8` — the .p8 file contents (PEM) or a path to it
   - `APNS_KEY_ID` — the 10-char Key ID
   - `APNS_TEAM_ID` — the 10-char Apple Developer Team ID
   - `APNS_BUNDLE_ID` — `com.familyhub.app`
   - `APNS_PRODUCTION` — `true` for the production gateway, else sandbox
4. **DB migration:** the new `native_push_tokens` table requires
   `pnpm --filter @workspace/db push` (drizzle-kit, needs `DATABASE_URL`).

Local notifications need no entitlement — only the runtime permission prompt
(handled by `requestLocalNotificationPermission`).

## App icon & splash (#4)

Source images live in `assets/`:
- `assets/icon-only.png` — 1024×1024, **no alpha** (App Store icon, full bleed)
- `assets/logo.png` — square logo composited (centered) onto the splash background

Regenerate the iOS asset catalog after changing either source:

```bash
node scripts/generate-ios-assets.cjs   # uses the jimp dev dependency (pure JS)
```

This writes `AppIcon-512@2x.png` (1024, no alpha) and the 2732×2732 splash images
into `ios/App/App/Assets.xcassets/`. To change the splash background or logo size,
edit `SPLASH_BG` / `LOGO_ON_SPLASH` in `scripts/generate-ios-assets.cjs`.

> Note: `@capacitor/assets` (the usual generator) needs native `sharp`, which
> can't build in this locked-down workspace — hence the small jimp script.

## iOS privacy usage strings (#6) — done

The following `NSUsageDescription` keys are set in `ios/App/App/Info.plist` so
the OS can show a human-readable reason when prompting for each permission:

| Key | Reason |
|---|---|
| `NSCameraUsageDescription` | Profile photo capture |
| `NSPhotoLibraryUsageDescription` | Choosing a profile picture from the library |
| `NSPhotoLibraryAddUsageDescription` | Saving exported content |
| `NSLocationWhenInUseUsageDescription` | Local weather on the home screen |
| `NSUserNotificationsUsageDescription` | Chore/health/announcement reminders |

Apple rejects any build that requests a permission without the matching key, even if
the plugin is installed but not yet invoked. All five keys are pre-populated so
adding camera, photo, or location plugins later won't cause a submission rejection.

### Xcode manual steps (Mac-only, one-time)

These cannot be done in code — they require Xcode's GUI:

1. **Signing & Capabilities → Team**: Open `ios/App/App.xcworkspace` in Xcode,
   select the **App** target → **Signing & Capabilities**, pick your Apple Developer
   team. Xcode will auto-manage provisioning profiles.

2. **Push Notifications capability**: In the same tab, click **+ Capability** and
   add **Push Notifications**. This writes an entitlement (`aps-environment`) that
   APNs requires; without it device tokens are never issued.

3. **Background Modes**: Verify **Remote notifications** is checked under Background
   Modes (already set in `Info.plist`; Xcode may want to manage it via the GUI too).

4. **iOS Deployment Target**: Set to **16.0** on both the App target and the App
   project (Build Settings → `IPHONEOS_DEPLOYMENT_TARGET`).

## Not done yet (future steps, tracked in /CLAUDE.md)

- Backend APNs sending + `/api/push/register-native` (see above)
- App Store Connect metadata, screenshots, privacy nutrition labels, COPPA flow
