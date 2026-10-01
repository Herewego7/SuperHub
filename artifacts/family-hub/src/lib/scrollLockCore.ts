/**
 * The ref-counted WebView scroll lock, with the native call injected so the
 * logic can be tested without a device. webviewScrollLock.ts wires it to
 * Capacitor's Keyboard plugin; behaviour is identical to the original inline
 * version, plus `reset()`.
 *
 * Import-free on purpose, like healthReminderPlan.ts and logoutSequence.ts.
 */

export interface ScrollLock {
  /** Take a lock. Returns a release function; calling it twice is harmless. */
  lock(): () => void;
  /**
   * Force scrolling back ON and forget every lock. See webviewScrollLock.ts —
   * the native setting outlives a page reload, and the guard below cannot see
   * that, so boot must reset unconditionally.
   */
  reset(): void;
}

export function createScrollLock(
  setDisabled: (disabled: boolean) => Promise<unknown>,
  isSupported: () => boolean,
): ScrollLock {
  let depth = 0;
  // What THIS JavaScript believes the native setting is. That belief is only
  // as good as the JavaScript's memory — which a reload erases while the
  // native setting survives. Hence reset().
  let applied = false;

  function apply(disabled: boolean): void {
    if (applied === disabled) return;
    applied = disabled;
    // Fire-and-forget: a failure here must never break opening a dialog, and
    // there is nothing useful to do beyond leaving scrolling as it was.
    void setDisabled(disabled).catch(() => {
      applied = !disabled;
    });
  }

  return {
    lock() {
      if (!isSupported()) return () => {};
      depth += 1;
      apply(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        depth = Math.max(0, depth - 1);
        if (depth === 0) apply(false);
      };
    },
    reset() {
      if (!isSupported()) return;
      depth = 0;
      applied = false;
      // Bypasses apply()'s guard on purpose: the guard compares against what
      // the JavaScript believes, and after a reload it believes nothing.
      void setDisabled(false).catch(() => {});
    },
  };
}
