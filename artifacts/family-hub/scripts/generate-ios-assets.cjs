/**
 * Generates the iOS app icon and splash screen from the source images in
 * `assets/` into the Capacitor iOS asset catalog.
 *
 * Source:
 *   assets/icon-only.png  — 1024x1024, no alpha (App Store icon, full bleed)
 *   assets/logo.png       — square logo composited onto the splash background
 *
 * Output (Xcode asset catalog):
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  (1024)
 *   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png  (2732)
 *
 * Run from artifacts/family-hub:  node scripts/generate-ios-assets.cjs
 * Requires the `jimp` dev dependency (pure JS — no native sharp needed).
 */
const path = require("path");
const fs = require("fs");
const Jimp = require("jimp");

const ROOT = path.resolve(__dirname, "..");
const ICON_SRC = path.join(ROOT, "assets/icon-only.png");
const LOGO_SRC = path.join(ROOT, "assets/logo.png");
const ICONSET = path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const SPLASHSET = path.join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");

// Splash: square canvas (Capacitor centers/scales it via the launch storyboard).
const SPLASH_SIZE = 2732;
const LOGO_ON_SPLASH = 1000; // logo edge length, centered
const SPLASH_BG = 0xffffffff; // white, fully opaque (RRGGBBAA)

async function main() {
  for (const p of [ICON_SRC, LOGO_SRC]) {
    if (!fs.existsSync(p)) throw new Error(`Missing source image: ${p}`);
  }

  // 1) App icon — the App Store marketing icon must be 1024x1024 with NO alpha
  // channel. The source is already a clean 1024 RGB PNG, so copy it byte-for-byte
  // (re-encoding through an image lib would add an alpha channel and fail review).
  const iconMeta = await Jimp.read(ICON_SRC);
  if (iconMeta.bitmap.width !== 1024 || iconMeta.bitmap.height !== 1024) {
    throw new Error(
      `assets/icon-only.png must be exactly 1024x1024 (got ${iconMeta.bitmap.width}x${iconMeta.bitmap.height})`,
    );
  }
  if (iconMeta.hasAlpha()) {
    throw new Error("assets/icon-only.png must not have an alpha channel (App Store requirement)");
  }
  fs.copyFileSync(ICON_SRC, path.join(ICONSET, "AppIcon-512@2x.png"));

  // 2) Splash — logo centered on a solid background.
  const logo = await Jimp.read(LOGO_SRC);
  logo.contain(LOGO_ON_SPLASH, LOGO_ON_SPLASH);
  const splash = new Jimp(SPLASH_SIZE, SPLASH_SIZE, SPLASH_BG);
  const offset = Math.round((SPLASH_SIZE - LOGO_ON_SPLASH) / 2);
  splash.composite(logo, offset, offset);

  // The Splash.imageset references three files (1x/2x/3x), all 2732x2732.
  for (const name of [
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
  ]) {
    await splash.clone().writeAsync(path.join(SPLASHSET, name));
  }

  console.log("Generated iOS icon + splash assets.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
