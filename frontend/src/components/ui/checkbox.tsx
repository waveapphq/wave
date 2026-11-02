import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

/**
 * Visual-only checkbox indicator (renders as a `<div>`, not a `<button>`).
 *
 * Use this inside interactive containers that already handle click/keyboard
 * events (e.g. `DropdownItem`) to avoid nesting `<button>` elements, which
 * violates the HTML spec.
 */
function CheckboxIndicator({
  checked,
  className,
}: Readonly<{ checked: boolean | 'indeterminate'; className?: string }>) {
  const isChecked = checked === true
  const isIndeterminate = checked === 'indeterminate'
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid place-content-center h-4 w-4 shrink-0 rounded-sm border border-primary shadow",
        (isChecked || isIndeterminate) && "bg-primary text-primary-foreground",
        className
      )}
    >
      {isChecked && <Check className="h-4 w-4" />}
      {isIndeterminate && <Minus className="h-4 w-4" />}
    </div>
  )
}

export { Checkbox, CheckboxIndicator }
