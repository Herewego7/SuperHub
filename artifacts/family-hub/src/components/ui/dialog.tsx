"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { lockWebviewScroll } from "@/lib/webviewScrollLock"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Place a just-focused field inside the dialog's own scroll container.
 *
 * Two rules, in this order:
 *
 *  1. If the field already sits fully inside the container with a little
 *     room under it, do nothing at all. Most focus changes on a
 *     form the user is typing down — the ingredient list's new row, the next
 *     field after a Tab — land here, and the right amount of movement for them
 *     is none.
 *  2. Otherwise scroll so the field's BOTTOM sits REVEAL_GAP above the
 *     container's bottom edge, keeping a little context under it. A field
 *     taller than the container can afford (a Description textarea with the
 *     keyboard up) can't satisfy that, so its TOP is placed PAD_TOP below the
 *     container's top instead — you type at the top of a textarea, so that is
 *     the end that has to be visible.
 *
 * ⚠️ This sets `container.scrollTop` directly and deliberately does NOT use
 * `scrollIntoView`. scrollIntoView scrolls EVERY scrollable ancestor, the
 * document included, and on iOS that moves the page under a `position: fixed`
 * dialog — which is exactly the single-frame snap measured at the end of every
 * keyboard lurch (see lib/webviewScrollLock.ts for the frame timings).
 * Assigning scrollTop touches one element and can never move anything else.
 *
 * Previous shape, for anyone tempted to go back to it: `scrollIntoView` with
 * `block: 'nearest'` and a scroll-margin. 'nearest' does the MINIMUM scroll,
 * which parks the focused field flush against the bottom edge — reported on
 * 2026-09-11 as "it scrolls to a part of the screen where the Description
 * field can't be seen". The margin was tuned three times (88 -> 28 -> 48)
 * trying to compensate for that; the placement rule above replaces the
 * guesswork.
 */
// TWO gaps, not one, and conflating them is what drove three rounds of tuning
// a single scroll-margin (88 -> 28 -> 48) with each value breaking whichever
// complaint the previous one had fixed.
//
// REVEAL_GAP is how much context to bring along WHEN WE SCROLL: enough that the
// row after the focused field, and ideally the button under it, come into view
// too ("focus Description, see Description, see nothing under it").
//
// SATISFIED_GAP is how little room below is enough to leave the form ALONE. A
// field the user can already see does not need repositioning, and a form being
// typed downward — the ingredient list, where each Return appends a row right
// at the bottom edge — is nearly all of these. Holding this to the reveal gap
// is what shoved the list up on every keystroke.
const REVEAL_GAP_PX = 48;
const SATISFIED_GAP_PX = 8;
// Where a too-tall field's top edge is parked.
const PAD_TOP_PX = 12;
// Ignore sub-pixel and rounding-level differences; scrolling by 2px is just
// noise the user reads as instability.
const PLACEMENT_TOLERANCE_PX = 4;

function placeFocusedField(el: HTMLElement, container: HTMLElement): void {
  // Nothing to scroll: the whole form already fits.
  if (container.scrollHeight <= container.clientHeight + 1) return;

  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();

  const tooTall = eRect.height > cRect.height - PAD_TOP_PX - REVEAL_GAP_PX;

  let delta: number;
  if (tooTall) {
    // Put its top just below the container's top: you type at the top of a
    // textarea, so that is the end that has to be visible.
    delta = eRect.top - (cRect.top + PAD_TOP_PX);
  } else {
    const roomBelow = cRect.bottom - eRect.bottom;
    const above = eRect.top - cRect.top;
    // Rule 1 — already visible enough. Do nothing.
    if (above >= 0 && roomBelow >= SATISFIED_GAP_PX) return;
    // Rule 2 — reveal it, generously.
    delta = REVEAL_GAP_PX - roomBelow;
    // Never scroll so far that the field's own top leaves the container.
    if (delta > above) delta = above;
  }

  if (Math.abs(delta) < PLACEMENT_TOLERANCE_PX) return;

  const max = container.scrollHeight - container.clientHeight;
  const next = Math.max(0, Math.min(max, container.scrollTop + delta));
  if (Math.abs(next - container.scrollTop) < PLACEMENT_TOLERANCE_PX) return;
  // Instant, not smooth. While the keyboard is animating, an instant landing
  // is hidden by the keyboard's own motion; a smooth scroll is 300ms of extra
  // visible travel on top of it, which is what "it judders a bunch" describes.
  container.scrollTop = next;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Let the first focusable element take focus when the dialog opens.
     * Off by default: Radix focuses the first focusable child, and when that
     * child is a choice (an option card, a filter chip) its focus ring reads
     * as "already selected" to someone who opened the dialog by tap or mouse.
     * Dialogs whose first control is a text field people are meant to type
     * into straight away — the PIN prompts — opt back in.
     */
    autoFocusFirst?: boolean
  }
>(({ className, children, autoFocusFirst = false, onOpenAutoFocus, ...props }, ref) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // ⚠️ scrollRef above is the full-screen BACKDROP wrapper, which is
  // overflow-hidden and never scrolls. The real scroll container is
  // DialogPrimitive.Content (see its own className comment). Scrolling the
  // wrapper is a silent no-op, which is why focusing a field below the fold
  // still did nothing after the listeners were finally attached.
  const contentRef = React.useRef<HTMLElement | null>(null);
  // Tracks the CURRENT visible area (window.visualViewport), not the full
  // layout viewport. A `position: fixed` element on iOS stays pinned to the
  // layout viewport, which does NOT shrink when the keyboard opens — so a
  // short dialog that's vertically centered (m-auto) within a full-height
  // fixed wrapper stays centered in a taller-than-visible area, and its
  // bottom half (often the footer buttons) ends up hidden behind the
  // keyboard with nothing left to scroll (the dialog box itself has no
  // overflow when its content already fits). Resizing this wrapper to the
  // real visible area makes the centering re-run against the space that's
  // actually visible, so the whole dialog — footer included — stays above
  // the keyboard. A no-op whenever the keyboard is closed (visualViewport
  // already matches the full viewport then).
  //
  // `keyboardOpen` rides along because the CENTERING itself is the other half
  // of this problem. m-auto re-centers the box on every height change, and
  // with the keyboard up both inputs to that height change constantly: the
  // form grows (adding an ingredient row) and the visible area moves (iOS
  // swaps a numeric keypad for a QWERTY one, or shows/hides the suggestion
  // strip). Each time, the WHOLE dialog slides by half the delta — top edge
  // one way, bottom edge the other. That is the judder reported on the
  // ingredient list ("press Return, the whole pop-up jumps") and on Settings'
  // search box (every keystroke changes how many result rows match). It was
  // mis-diagnosed twice as a scroll problem and tuned in
  // scrollFocusedIntoView, which could never have fixed it: nothing was
  // scrolling, the box itself was moving. While the keyboard is up the box is
  // anchored to the top of the visible area instead, so growing content
  // extends downward and everything above the insertion point stays put.
  const [viewport, setViewport] = React.useState<{ height: number; keyboardOpen: boolean } | null>(null);
  // `top` is tracked SEPARATELY and only applied once it settles. Anchoring the
  // box killed the re-centring jolt but left a second, larger one, which the
  // 09-09 recordings pinned down precisely: on every focus the dialog jumps
  // down 110-170px in a single frame and then glides back over ~200ms, its
  // height unchanged the whole way — a rigid-body translation, measured frame
  // by frame at 222 -> 554 -> 222 device px. A top-anchored box's top edge IS
  // the wrapper's top edge, so what moved was this: iOS reports a large
  // transient visualViewport.offsetTop while the keyboard animates (it starts
  // panning the visual viewport to reveal the field, then abandons it because
  // the body is scroll-locked), and following that value frame by frame drags
  // the whole dialog down and back. That is the "most text fields judder a bit
  // when I first click into them" report, and the one on pressing Done.
  //
  // At rest offsetTop is always 0, so waiting for it to hold still costs
  // nothing and suppresses the entire excursion. A genuine sustained pan
  // (pinch-zoom) still gets compensated, a quarter-second later.
  const OFFSET_SETTLE_MS = 250;
  const [viewportTop, setViewportTop] = React.useState(0);
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let settle: ReturnType<typeof setTimeout>;
    const update = () => {
      setViewport({
        height: vv.height,
        // 120px of shrinkage is well past any browser chrome that comes and
        // goes on scroll, and well under the shortest iOS keyboard.
        keyboardOpen: window.innerHeight - vv.height > 120,
      });
      const next = vv.offsetTop;
      clearTimeout(settle);
      settle = setTimeout(() => setViewportTop(next), OFFSET_SETTLE_MS);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      clearTimeout(settle);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Keep the focused field sensibly placed inside the dialog's own scroller.
  //
  // ⚠️ Keyed on `mounted`, NOT []. Radix renders Content through Portal +
  // Presence, so on the first (and, with [], only) run of this effect
  // scrollRef.current is still null — the effect bailed at the guard below and
  // NO listener was ever attached. That is why two previous rounds of tuning
  // the scroll behaviour here changed nothing on a real device: the handlers
  // never ran at all. Same class as the sticky-header scroll listener in
  // settings-modal (2026-09-05).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // Events are listened for on the wrapper (they bubble up from Content),
    // but every scroll calculation must target the Content box itself.
    const scroller = () => (contentRef.current ?? container) as HTMLElement;

    // A deliberate scroll gesture always wins. visualViewport 'resize' does
    // not fire only once when the keyboard finishes animating in — it can tick
    // several times while the keyboard is up (its own settling, an orientation
    // nudge). If the user was mid-drag trying to scroll the dialog at that
    // moment, re-placing the field snapped them back to the one they were
    // scrolling away from, so touch-scrolling a dialog with the keyboard open
    // felt broken until the field was blurred.
    const isTouchingRef = { current: false };
    const handleTouchStart = () => { isTouchingRef.current = true; };
    const handleTouchEnd = () => { isTouchingRef.current = false; };

    // ONE scheduler, not two. This used to be a 320ms timer on focusin plus a
    // separate 50ms timer on visualViewport resize, so focusing a field with
    // the keyboard closed ran the placement twice — once against the full-
    // height box and again against the shrunken one — and the second run moved
    // content the user had just watched settle. Both events now feed the same
    // debounce, so the placement happens once, after the box has stopped
    // changing size.
    //
    // SETTLE_MS is measured against the iOS keyboard animation, which takes
    // roughly a quarter second; running before it finishes places the field
    // against a box that is about to shrink.
    const SETTLE_MS = 260;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isTouchingRef.current) return;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
        if (!container.contains(active)) return;
        placeFocusedField(active, scroller());
      }, SETTLE_MS);
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      schedule();
    };

    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      clearTimeout(timer);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [mounted]);

  // Stop WKWebView panning the whole document to reveal a focused field while
  // this dialog is open — the measured cause of the lurch, see the module's
  // own comment. Released when the dialog unmounts.
  React.useEffect(() => lockWebviewScroll(), []);

  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Full-screen backdrop. bg-black/80 fills any empty space that
          appears below the form when iOS scrolls content up for the keyboard,
          preventing the home screen from bleeding through the semi-transparent
          overlay. Deliberately NOT a scroll container (overflow-hidden):
          Radix's modal Dialog installs react-remove-scroll, which on iOS
          blocks touch-scrolling of anything that isn't inside
          DialogPrimitive.Content's own subtree — a scrollable wrapper OUT
          here is exactly what it exists to block, which made tall dialogs
          scroll only intermittently (or not at all) on iPhone. The scroll
          container lives on DialogPrimitive.Content itself below, inside
          the allowed subtree, so iOS touch scrolling always works.
          touch-action:pan-y still blocks horizontal drift at the gesture
          level. */}
      <div
        ref={(node) => {
          scrollRef.current = node;
          if (node) setMounted(true);
        }}
        className="fixed inset-x-0 z-50 overflow-hidden bg-black/80"
        style={{
          touchAction: "pan-y",
          top: viewportTop,
          height: viewport ? viewport.height : "100%",
        }}
      >
        {/* flex-col WITHOUT items-center/justify-center on purpose: centering
            a flex child via align-items/justify-content clips access to any
            overflow on iOS Safari. margin:auto on the child below centers it
            identically whenever it fits, and max-h caps it to the viewport
            so its own internal scroll takes over when it doesn't.
            Safe-area padding added on top of the existing p-3/p-4 buffer —
            a tall dialog that caps out at max-h-full can otherwise render
            flush against the notch/home indicator, the same underlying gap
            that let content peek out from behind Sheets (see ui/sheet.tsx). */}
        <div
          className="flex h-full flex-col p-3 sm:p-4"
          style={{
            paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <DialogPrimitive.Content
            ref={(node) => {
              contentRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) (ref as React.MutableRefObject<unknown>).current = node;
            }}
            // An explicit handler from the caller always wins; otherwise
            // suppress unless this dialog asked for autofocus.
            onOpenAutoFocus={onOpenAutoFocus ?? (autoFocusFirst ? undefined : (e) => e.preventDefault())}
            className={cn(
              // max-h-full + overflow-y-auto make the dialog box ITSELF the
              // one scroll container, inside react-remove-scroll's allowed
              // subtree (see the wrapper comment above) — callers that
              // manage their own internal scrolling (e.g. the chores modals'
              // header-pinned layout) still work: their max-h override wins
              // via tailwind-merge and their inner div scrolls while this
              // box never overflows. overflow-x-hidden so an oversized child
              // (e.g. a native form control with a fixed minimum rendered
              // width) is clipped instead of making the dialog horizontally
              // swipeable. overscroll-y-contain stops edge-of-scroll chaining.
              //
              // [&>*]:min-w-0 — this box is a GRID, and a grid item's automatic
              // minimum size is min-content, NOT zero. Any descendant with
              // white-space:nowrap (which Tailwind's `truncate` sets!) reports
              // its full untruncated string as min-content, so the grid track
              // inflates to fit it and every sibling inherits that oversized
              // containing block. The result: `truncate`/`min-w-0`/`flex-wrap`
              // already on the content can never engage (their parent is wide
              // enough), text gets HARD-CLIPPED by overflow-x-hidden with no
              // ellipsis, and a justify-between footer pushes its right-hand
              // button off-screen. Zeroing the items' min-width lets the track
              // respect the card width so the existing truncation does its job.
              // No effect on any dialog whose content already fits.
              `relative ${viewport?.keyboardOpen ? "mx-auto mb-auto" : "m-auto"} grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 rounded-lg max-h-full overflow-y-auto overflow-x-hidden overscroll-y-contain [&>*]:min-w-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`,
              className
            )}
            {...props}
          >
            {children}
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </div>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // text-left, not "text-center sm:text-left": titles that include an
      // icon become a flex row, which silently cancels the centring, so
      // alignment depended on whether a dialog's title had an icon. Every
      // dialog now aligns the same way.
      "flex flex-col space-y-1.5 text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Side-by-side at every width. This used to be flex-col-reverse below
      // sm:, so dialogs using this shared footer stacked their buttons on a
      // phone while the ones that hand-roll a `flex justify-end` row didn't
      // — the same app showing two different footer shapes.
      "flex flex-row justify-end gap-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
