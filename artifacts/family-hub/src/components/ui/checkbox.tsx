import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // rounded-[3px], not rounded-sm: this project redefines rounded-sm as
      // calc(var(--radius) - 4px), and --radius is 12px — so rounded-sm is
      // 8px here, which on a 16px box is a full circle. Every checkbox in
      // the app was rendering as a radio button on multi-select lists. An
      // explicit value can't drift with the theme's radius token.
      // Round completion circles in the task lists are hand-built elsewhere
      // and deliberately stay round — see PINLIST-1.
      "peer h-4 w-4 shrink-0 rounded-[3px] border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
