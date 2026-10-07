import { createElement, lazy, useState, type ComponentPropsWithRef, type ComponentType, type ElementType, type ReactElement } from "react";

export type LazyScreen<T extends ComponentType<any>> = ((props: ComponentPropsWithRef<T>) => ReactElement) & {
  /** Loads the screen's code now, so its first open draws at once. Never rejects. */
  preload: () => Promise<void>;
};

const RELOADED_KEY = "superhub_screen_reloaded:";

/**
 * A screen whose code loads the first time it opens. A file that fails to load
 * (a deploy replaced it while the app was open) reloads the app once to fetch
 * the new files; a second failure reaches the error screen.
 */
export function lazyScreen<T extends ComponentType<any>>(name: string, load: () => Promise<T>): LazyScreen<T> {
  let loaded: T | null = null;
  let loading: Promise<T> | null = null;
  const loadCode = () =>
    (loading ??= load().then(
      (screen) => {
        loaded = screen;
        forgetReload(name);
        return screen;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    ));
  const Lazy = lazy(() =>
    loadCode().then(
      (screen) => ({ default: screen }),
      (error: unknown) => {
        if (!reloadOnce(name)) throw error;
        return new Promise<never>(() => {});
      },
    ),
  );
  function Screen(props: ComponentPropsWithRef<T>) {
    // Chosen once per mount: switching to the loaded component later would remount it.
    const [Component] = useState<ElementType>(() => loaded ?? Lazy);
    return createElement(Component, props);
  }
  Screen.preload = () => loadCode().then(() => undefined, () => undefined);
  return Screen;
}

/** Loads each screen in turn while the device is idle. Returns a cancel. */
export function preloadWhenIdle(screens: { preload: () => Promise<void> }[]): () => void {
  let cancelled = false;
  const whenIdle = (run: () => void) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 2000 });
    else window.setTimeout(run, 200);
  };
  const next = (index: number) => {
    if (cancelled || index >= screens.length) return;
    whenIdle(() => {
      if (!cancelled) void screens[index].preload().then(() => next(index + 1));
    });
  };
  next(0);
  return () => {
    cancelled = true;
  };
}

function reloadOnce(name: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY + name)) return false;
    sessionStorage.setItem(RELOADED_KEY + name, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function forgetReload(name: string) {
  try {
    sessionStorage.removeItem(RELOADED_KEY + name);
  } catch {
    // Storage unavailable: nothing was recorded either.
  }
}
