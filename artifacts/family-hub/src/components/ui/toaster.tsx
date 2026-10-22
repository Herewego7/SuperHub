import { useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

/** How far a press may move and still count as a tap. */
const TAP_SLOP_PX = 6

export function Toaster() {
  const { toasts, dismiss } = useToast()
  // Where the press began. The browser still sends a click at the end of a
  // drag, so without this a small nudge or a downward drag closed the toast,
  // when only a tap or a real upward swipe should (2026-10-22).
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const wasTap = (event: React.MouseEvent) => {
    const start = pressedAt.current
    pressedAt.current = null
    return !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP_PX
  }

  return (
    // swipeDirection="up": these toasts show at the top of the screen (or
    // bottom-right on larger screens), so swiping up is the dismiss gesture
    // — mirrors how a phone's own notification banners work. Only a genuine
    // upward drag counts; Radix ignores sideways/downward movement entirely
    // for this direction (verified directly in @radix-ui/react-toast's own
    // pointer-move handler), so this doesn't interfere with normal page
    // scrolling or any other gesture.
    <ToastProvider swipeDirection="up">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          // Tapping anywhere on the toast dismisses it, not just the X. With a
          // dialog open the swipe gesture is cancelled by the modal's scroll
          // lock (see ToastClose), so a generous target matters — the reported
          // experience was having to wait the toast out while it sat over the
          // Edit Event form. The action button below stops propagation so
          // "Manage in Celebrations" still does its job.
          <Toast
            key={id}
            {...props}
            onPointerDown={(event) => { pressedAt.current = { x: event.clientX, y: event.clientY } }}
            onClick={(event) => { if (wasTap(event)) dismiss(id) }}
          >
            {/* min-w-0 so the text column can actually take the room it needs:
                without it a long title/description shrinks to roughly half the
                toast beside the action and wraps to one or two words per line
                (the "Open Celebrations" toast was the reported case). */}
            <div className="grid gap-1 min-w-0 flex-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>{action}</div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
