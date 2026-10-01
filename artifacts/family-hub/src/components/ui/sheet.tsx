"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  // overflow-x-hidden on the sheet's own box: a caller's content div further
  // inside may set overflow-y-auto without an explicit overflow-x (which
  // then computes to "auto" per the CSS overflow spec, not "visible") — this
  // outer clip is defense in depth so an oversized child (e.g. a native
  // form control) can never make the WHOLE sheet horizontally swipeable,
  // matching the same belt-and-suspenders approach already used in
  // ui/dialog.tsx.
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out overflow-x-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

// Real device safe-area space every side needs to reserve on its own box —
// a Sheet is portalled straight to document.body, so no ancestor's padding
// applies here. Left/right sheets run the full device height (inset-y-0)
// under the notch and above the home indicator, so they need both; top
// needs only the top inset, bottom only the bottom one. Applied as an
// inline style (not a className) so a caller's own className — several
// pass `p-0` to reset the base variant's padding for their own header/
// content layout — can never silently strip it via tailwind-merge's
// shorthand-vs-longhand conflict resolution (p-0 would otherwise win over
// pt-[...]/pb-[...] utilities since it's merged in after them).
function sheetSafeAreaStyle(side: "top" | "bottom" | "left" | "right"): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (side === "top" || side === "left" || side === "right") {
    style.paddingTop = "env(safe-area-inset-top, 0px)";
  }
  if (side === "bottom" || side === "left" || side === "right") {
    style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  }
  return style;
}

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

// Swipe-to-dismiss for left/right sheets: dragging horizontally in the
// direction the sheet would exit closes it, mirroring the pointer-drag
// pattern already used in meals-view.tsx (axis-detection via
// |dx| > |dy| so it doesn't fight vertical scrolling of the sheet's own
// content). Top/bottom sheets are left alone — not used in this app, and a
// vertical drag-to-dismiss would conflict much more with scrolling content.
function useSwipeToDismiss(
  side: "top" | "bottom" | "left" | "right",
  contentEl: HTMLElement | null,
  closeButtonEl: HTMLElement | null
) {
  React.useEffect(() => {
    if (!contentEl || (side !== "left" && side !== "right")) return;
    const exitSign = side === "right" ? 1 : -1; // right sheet exits by moving further right (+x)

    // `tracking` covers the whole gesture from pointerdown to pointerup/cancel
    // so the window listeners always get torn down; `committed` is the
    // narrower "this is actually a dismiss drag, not a vertical scroll"
    // decision made once the move exceeds a small threshold.
    let tracking: null | { pointerId: number; startX: number; startY: number } = null;
    let committed = false;
    const DISMISS_PX = 90;

    const reset = () => {
      contentEl.style.transition = "";
      contentEl.style.transform = "";
      contentEl.style.opacity = "";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== tracking.pointerId) return;
      const dx = e.clientX - tracking.startX;
      const dy = e.clientY - tracking.startY;
      if (!committed) {
        if (Math.hypot(dx, dy) < 6) return;
        if (Math.abs(dx) <= Math.abs(dy) || Math.sign(dx || 1) !== exitSign) {
          // Vertical gesture, or dragging toward the opposite edge — leave
          // `tracking` set (so pointerup still cleans up listeners) but
          // never commit, so this pointer is just ignored from here on.
          return;
        }
        committed = true;
      }
      const dist = Math.max(0, dx * exitSign);
      contentEl.style.transition = "none";
      contentEl.style.transform = `translateX(${dist * exitSign}px)`;
      contentEl.style.opacity = String(Math.max(0.4, 1 - dist / (DISMISS_PX * 3)));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== tracking.pointerId) return;
      const dx = e.clientX - tracking.startX;
      const wasCommitted = committed;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      tracking = null;
      committed = false;
      if (wasCommitted && Math.abs(dx) >= DISMISS_PX) {
        closeButtonEl?.click();
        return;
      }
      reset();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      tracking = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
      committed = false;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    };

    contentEl.addEventListener("pointerdown", onPointerDown);
    return () => {
      contentEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [side, contentEl, closeButtonEl]);
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, style, ...props }, ref) => {
  const [contentEl, setContentEl] = React.useState<HTMLElement | null>(null);
  const [closeButtonEl, setCloseButtonEl] = React.useState<HTMLElement | null>(null);
  useSwipeToDismiss(side ?? "right", contentEl, closeButtonEl);

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={(node) => {
          setContentEl(node);
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        className={cn(sheetVariants({ side }), className)}
        style={{ ...sheetSafeAreaStyle(side ?? "right"), ...style }}
        {...props}
      >
        {children}
        {/* position:absolute offsets are measured from the containing
            block's padding-box edge, which does NOT shift when SheetContent
            gains its own paddingTop above — so top-4 alone would leave this
            button pinned under the notch even once the title text (in
            normal flow, and so genuinely pushed down by that padding) moves
            clear of it. Add the same top inset directly to its own offset
            on any side that reserves one. */}
        <SheetPrimitive.Close
          ref={setCloseButtonEl}
          className="absolute right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
          style={{
            top:
              side === "top" || side === "left" || side === "right" || side === undefined
                ? "calc(1rem + env(safe-area-inset-top, 0px))"
                : "1rem",
          }}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
})
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
