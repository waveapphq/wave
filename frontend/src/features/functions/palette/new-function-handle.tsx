/**
 * "New Function" affordance for the workbench palette.
 *
 * A draggable button that serves as the only entry point for creating a new
 * local Function instance on the canvas. Clicking without dragging is a
 * non-functional gesture that pops a hint tooltip directing the user to the
 * actual interaction (drag). The same component renders in two visual modes:
 *   - 'expanded' shows the icon + label inside the 260px palette sidebar.
 *   - 'collapsed' is icon-only for the 64px icon strip.
 */

import { useCallback, type DragEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const HINT_COPY = 'Drag onto the canvas to create a new Function'

const DRAG_PAYLOAD = JSON.stringify({ type: 'function-new-local' })

interface NewFunctionHandleProps {
  /** Layout variant - text+icon for the expanded sidebar, icon-only for the collapsed strip. */
  variant: 'expanded' | 'collapsed'
  /** Invoked when the user clicks the button without a preceding drag. */
  onClickWithoutDrag?: () => void
  /** Optional `data-testid` for callers that need to address the button by id. */
  testId?: string
}

function HandleSurface({
  variant,
  onClickWithoutDrag,
  testId,
  children,
}: Readonly<{
  variant: NewFunctionHandleProps['variant']
  onClickWithoutDrag?: () => void
  testId?: string
  children: ReactNode
}>): ReactNode {
  const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>) => {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/wave-block', DRAG_PAYLOAD)
    }
  }, [])

  const handleClick = useCallback(() => {
    onClickWithoutDrag?.()
  }, [onClickWithoutDrag])

  const sharedClasses = cn(
    'cursor-grab active:cursor-grabbing',
    'hover:bg-cyan-500/10 transition-colors',
    'text-cyan-600 dark:text-cyan-400',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )

  if (variant === 'expanded') {
    return (
      <button
        type="button"
        data-testid={testId}
        draggable="true"
        aria-label="New Function"
        onDragStart={handleDragStart}
        onClick={handleClick}
        className={cn(
          'h-9 px-3 inline-flex items-center gap-2.5 rounded-md text-sm',
          sharedClasses,
        )}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid={testId}
      draggable="true"
      aria-label="New Function"
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        'w-9 h-9 inline-flex items-center justify-center rounded-md',
        sharedClasses,
      )}
    >
      {children}
    </button>
  )
}

export function NewFunctionHandle({ variant, onClickWithoutDrag, testId }: Readonly<NewFunctionHandleProps>) {
  const trigger = (
    <HandleSurface variant={variant} onClickWithoutDrag={onClickWithoutDrag} testId={testId}>
      {variant === 'expanded' ? (
        <>
          <Plus className="h-5 w-5" aria-hidden="true" />
          <span>New Function</span>
        </>
      ) : (
        <Plus className="h-5 w-5" aria-hidden="true" />
      )}
    </HandleSurface>
  )

  return (
    <>
      <ConditionalTooltip content={HINT_COPY} side="right">
        {trigger}
      </ConditionalTooltip>
      {/* The same hint copy is always available to assistive tech so screen
          readers can discover the drag-only interaction without needing the
          hover-only Radix Tooltip popup. */}
      <span className="sr-only">{HINT_COPY}</span>
    </>
  )
}
