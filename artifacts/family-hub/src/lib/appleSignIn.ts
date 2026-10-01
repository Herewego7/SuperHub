import { Capacitor, registerPlugin } from "@capacitor/core";
import { signInWithAppleIdentity } from "@/lib/emailAuth";

/**
 * "Sign in with Apple" — native iOS only, via a small custom Capacitor
 * plugin (`ios/App/App/AppleSignInPlugin.swift`) rather than
 * `@capacitor-community/apple-sign-in`.
 *
 * That community plugin's native `Package.swift` pins `capacitor-swift-pm`
 * to the `7.0.0..<8.0.0` range, which conflicts with every other plugin in
 * this app (all on 8.x) and made the whole Xcode project fail to resolve
 * ("Missing package product 'CapApp-SPM'") — see the 2026-07-08 CLAUDE.md
 * entry. As of 2026-08 that plugin still hasn't published an 8.x-compatible
 * release, so this app owns a tiny native plugin instead: no third-party
 * manifest to go stale, nothing to re-check on the next Capacitor major
 * version. The backend verification path (`POST /api/auth/apple`,
 * `appleAuth.ts`) is unrelated and untouched — it already worked before and
 * after this plugin swap either way.
 */
interface AppleSignInResult {
  identityToken: string;
  userIdentifier: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface AppleSignInPlugin {
  authorize(): Promise<AppleSignInResult>;
}

const AppleSignIn = registerPlugin<AppleSignInPlugin>("AppleSignIn");

export function isAppleSignInAvailable(): boolean {
  // Web has no "Sign in with Apple" button in this app (only email/password,
  // Sign in with Apple, and Replit OIDC internally — see CLAUDE.md's
  // Authentication section) — this is a native-only entry point.
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function nativeAppleSignIn(): Promise<void> {
  const result = await AppleSignIn.authorize();
  await signInWithAppleIdentity({
    identityToken: result.identityToken,
    firstName: result.firstName,
    lastName: result.lastName,
  });
}
