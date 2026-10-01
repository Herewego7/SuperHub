import { Capacitor } from "@capacitor/core";
import {
  Haptics,
  ImpactStyle,
  NotificationType,
} from "@capacitor/haptics";

/**
 * Unified haptic feedback for web + native (Capacitor) builds.
 *
 * - On native iOS, uses the Taptic Engine via @capacitor/haptics.
 * - On the web, falls back to the Vibration API where the browser/device
 *   supports it (Android Chrome, etc.). iOS Safari has no vibration API, so
 *   web haptics there are simply a no-op.
 *
 * Every call is fire-and-forget and never throws — feedback is a nicety and must
 * never break the interaction that triggered it.
 */

const isNative = Capacitor.isNativePlatform();

function webVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* no-op */
  }
}

/** A light tap — for selections, toggles, small confirmations. */
export function hapticLight(): void {
  if (isNative) {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } else {
    webVibrate(10);
  }
}

/** A medium tap — for completing a chore / committing an action. */
export function hapticMedium(): void {
  if (isNative) {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  } else {
    webVibrate(20);
  }
}

/** A celebratory success buzz — for rewards earned / all-done moments. */
export function hapticSuccess(): void {
  if (isNative) {
    void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  } else {
    webVibrate([15, 40, 15]);
  }
}

/** A warning buzz — for blocked or invalid actions. */
export function hapticWarning(): void {
  if (isNative) {
    void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
  } else {
    webVibrate([30, 40, 30]);
  }
}
