import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 2026-09-30: Restore Purchases failed on the device with "'StoreKitPurchase'
// plugin is not implemented on ios". Capacitor only discovers plugins that come
// from npm packages; a plugin living in the app target must be registered by
// hand in ViewController.capacitorDidLoad, or it does not exist to JavaScript.
//
// Only WebAuthPlugin ever was. AppleSignInPlugin and StoreKitPurchasePlugin
// were each added with their Swift file and their Xcode entry, and neither
// commit touched ViewController.swift — so Sign in with Apple and in-app
// purchase had never worked on a device, and nothing could notice short of
// tapping those exact buttons on a real phone. Both would have failed review.
//
// This reads the Swift source rather than running it, which is the point:
// the failure is invisible to every test that runs JavaScript.

const APP_DIR = join(process.cwd(), "ios/App/App");

function pluginClasses(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(APP_DIR).filter((f) => f.endsWith(".swift"))) {
    const src = readFileSync(join(APP_DIR, file), "utf8");
    for (const m of src.matchAll(/class\s+(\w+)\s*:\s*CAPPlugin\b[^{]*CAPBridgedPlugin/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

function registered(): string[] {
  const src = readFileSync(join(APP_DIR, "ViewController.swift"), "utf8");
  return [...src.matchAll(/registerPluginInstance\(\s*(\w+)\(\s*\)\s*\)/g)].map((m) => m[1]);
}

test("the app target has native plugins to check", () => {
  // Guard against a vacuous pass: if the folder moved or the pattern broke,
  // "every plugin is registered" would be trivially true of zero plugins.
  const found = pluginClasses();
  assert.ok(found.length >= 3, `expected at least 3 plugin classes, found ${JSON.stringify(found)}`);
});

test("every native plugin in the app target is registered with the bridge", () => {
  const reg = new Set(registered());
  const missing = pluginClasses().filter((name) => !reg.has(name));
  assert.deepEqual(
    missing,
    [],
    `not registered in ViewController.capacitorDidLoad: ${missing.join(", ")} — ` +
      `JavaScript will get "plugin is not implemented on ios" when it calls them`,
  );
});
