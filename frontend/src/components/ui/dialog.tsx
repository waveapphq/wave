"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { SheetLayer } from "@/components/shared/sheet-layer"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideCloseButton?: boolean
  /** Prevent dialog from closing when clicking outside */
  preventCloseOnClickOutside?: boolean
  /** Prevent dialog from closing when pressing Escape */
  preventCloseOnEscape?: boolean
  /** Host floating sheets opened inside; flex-centered, as a transform would pin them to the dialog box. */
  floatingSheet?: boolean
}

// Type for Radix's pointer down outside event
type RadixPointerDownOutsideEvent = CustomEvent<{ originalEvent: PointerEvent }>

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, preventCloseOnClickOutside, preventCloseOnEscape, floatingSheet, onPointerDownOutside, onEscapeKeyDown, ...props }, ref) => {
  // Handle pointer down outside - prevent close when clicking on CodeMirror tooltips
  const handlePointerDownOutside = React.useCallback(
    (event: RadixPointerDownOutsideEvent) => {
      // Prevent close if preventCloseOnClickOutside is set
      if (preventCloseOnClickOutside) {
        event.preventDefault()
        return
      }

      // Get the original event target from Radix's custom event
      const originalEvent = event.detail?.originalEvent
      const target = originalEvent?.target as HTMLElement | null

      // Don't close if clicking on CodeMirror tooltip (autocomplete dropdown)
      if (target?.closest('.cm-tooltip')) {
        event.preventDefault()
        return
      }

      // Call the original handler if provided
      if (onPointerDownOutside) {
        onPointerDownOutside(event)
      }
    },
    [preventCloseOnClickOutside, onPointerDownOutside]
  )

  const handleEscapeKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      if (preventCloseOnEscape) {
        event.preventDefault()
      }
      onEscapeKeyDown?.(event)
    },
    [preventCloseOnEscape, onEscapeKeyDown]
  )

  const inner = (
    <>
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </>
  )

  if (floatingSheet) {
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          onPointerDownOutside={handlePointerDownOutside}
          onEscapeKeyDown={handleEscapeKeyDown}
          {...props}
        >
          {/* Sheets opened here stay inside the dialog so its focus containment covers them. */}
          <SheetLayer>
            <div
              className={cn(
                "relative grid grid-cols-1 w-full max-w-lg max-h-[85vh] gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
                className
              )}
            >
              {inner}
            </div>
          </SheetLayer>
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        aria-modal="true"
        className={cn(
          // No entrance animation (zoom-in / slide-in were causing nested
          // Radix Popover anchors - autocomplete dropdowns, version
          // selectors, etc - to measure against the modal's MID-animation
          // position and then visibly jump into place when it settled).
          // Closing keeps a brief fade-out so the modal does not disappear
          // instantly. Overlay fade is unchanged.
          "fixed left-[50%] top-[50%] z-50 grid grid-cols-1 w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:rounded-lg",
          className
        )}
        onPointerDownOutside={handlePointerDownOutside}
        onEscapeKeyDown={handleEscapeKeyDown}
        {...props}
      >
        {inner}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
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
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
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
  React.ComponentRef<typeof DialogPrimitive.Description>,
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
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
