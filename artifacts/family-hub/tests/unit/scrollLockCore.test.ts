import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollLock } from "../../src/lib/scrollLockCore.ts";

/**
 * A stand-in for the WKWebView's scroll view. It is the NATIVE side: unlike the
 * lock's bookkeeping, it survives when the JavaScript is thrown away.
 */
function fakeNativeScrollView() {
  const view = { disabled: false, calls: [] as boolean[] };
  const setDisabled = async (disabled: boolean) => {
    view.calls.push(disabled);
    view.disabled = disabled;
  };
  return { view, setDisabled };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test("opening a dialog turns scrolling off and closing it turns it back on", async () => {
  const { view, setDisabled } = fakeNativeScrollView();
  const lock = createScrollLock(setDisabled, () => true);
  const release = lock.lock();
  await flush();
  assert.equal(view.disabled, true);
  release();
  await flush();
  assert.equal(view.disabled, false);
});

test("a dialog on top of a dialog keeps scrolling off until both close", async () => {
  // Ref-counted: a confirm over a form must not re-enable scrolling underneath
  // the one still open.
  const { view, setDisabled } = fakeNativeScrollView();
  const lock = createScrollLock(setDisabled, () => true);
  const form = lock.lock();
  const confirm = lock.lock();
  confirm();
  await flush();
  assert.equal(view.disabled, true, "the form is still open");
  form();
  await flush();
  assert.equal(view.disabled, false);
});

test("a reload while a dialog is open leaves scrolling OFF unless boot resets it", async () => {
  // 2026-09-30, the exact sequence: sign-out is taken from the "Are you sure?"
  // dialog, which holds the lock, and sign-out ends in a page reload. The
  // native scroll view survives the reload; the lock's bookkeeping does not.
  const { view, setDisabled } = fakeNativeScrollView();

  const beforeReload = createScrollLock(setDisabled, () => true);
  beforeReload.lock();            // "Are you sure?" is open
  await flush();
  assert.equal(view.disabled, true);

  // window.location.reload(): brand-new JavaScript, same native scroll view.
  const afterReload = createScrollLock(setDisabled, () => true);
  await flush();
  assert.equal(view.disabled, true, "precondition: the reload alone does not restore scrolling");

  afterReload.reset();            // what main.tsx now does at boot
  await flush();
  assert.equal(view.disabled, false, "the login screen must be able to scroll");
});

test("why reset has to bypass the guard: a stale lock cannot recover by itself", async () => {
  // After a reload the bookkeeping believes scrolling is ON. Taking and
  // releasing a lock only ever calls "enable" if the bookkeeping thinks it is
  // off — so the ordinary path would never repair the native setting. This is
  // what made the stuck state permanent until a force-quit.
  const { view, setDisabled } = fakeNativeScrollView();
  view.disabled = true;           // left over from before the reload
  const afterReload = createScrollLock(setDisabled, () => true);
  afterReload.reset();
  await flush();
  assert.equal(view.disabled, false);
  assert.deepEqual(view.calls, [false], "reset must actually tell the native side");
});

test("off iOS nothing is touched at all", async () => {
  const { view, setDisabled } = fakeNativeScrollView();
  const lock = createScrollLock(setDisabled, () => false);
  lock.lock()();
  lock.reset();
  await flush();
  assert.deepEqual(view.calls, []);
});
