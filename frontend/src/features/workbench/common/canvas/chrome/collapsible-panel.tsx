/**
 * CollapsiblePanel Component
 *
 * Base component for collapsible side panels in the canvas area.
 * Used by VariableManager panel. Sizing is controlled by the parent
 * container (ResizablePanelGroup). This component fills its parent via h-full.
 */

import { useState, useCallback, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, PanelLeftClose, PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PanelOrientation = 'vertical' | 'horizontal'
type PanelPosition = 'left' | 'right' | 'bottom'

interface CollapsiblePanelProps {
  /** Panel identifier for testing */
  testId: string
  /** Panel title shown in collapsed state */
  title: string
  /** Icon to show in collapsed state */
  icon: ReactNode
  /** Panel orientation */
  orientation: PanelOrientation
  /** Panel position relative to content */
  position: PanelPosition
  /** Initial collapsed state */
  defaultCollapsed?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Panel content (shown when expanded) */
  children?: ReactNode
  /** Additional class names */
  className?: string
}

export function CollapsiblePanel({
  testId,
  title,
  icon,
  orientation,
  position,
  defaultCollapsed = true,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  children,
  className,
}: Readonly<CollapsiblePanelProps>) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isCollapsed = controlledCollapsed ?? internalCollapsed

  const toggleCollapsed = useCallback(() => {
    const newValue = !isCollapsed
    setInternalCollapsed(newValue)
    onCollapsedChange?.(newValue)
  }, [isCollapsed, onCollapsedChange])

  const isVertical = orientation === 'vertical'

  // Determine chevron icon based on position and state
  /* v8 ignore start - COV-BRANCH-043 */
  const getChevronIcon = () => {
    if (position === 'left') {
      return isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />
    }
    if (position === 'right') {
      return isCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
    }
    // bottom
    return isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
  }

  // Get panel toggle icon (matches palette style - PanelLeftClose/PanelRightClose)
  const getPanelToggleIcon = () => {
    if (position === 'left') {
      // Left panel: expand shows right arrow, collapse shows left arrow
      return isCollapsed
        ? <PanelRightClose className="h-4 w-4" />
        : <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
    }
    if (position === 'right') {
      // Right panel: expand shows left arrow (flipped from palette), collapse shows right arrow
      return isCollapsed
        ? <PanelLeftClose className="h-4 w-4" />
        : <PanelRightClose className="h-4 w-4 text-muted-foreground" />
    }
    // bottom - use chevrons
    return getChevronIcon()
  }
  /* v8 ignore stop */

  return (
    <div
      data-testid={testId}
      data-state={isCollapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'flex h-full border-default bg-muted/30 relative overflow-hidden',
        isVertical ? 'flex-col border-r' : 'flex-row border-t',
        position === 'right' && 'border-l-2 border-r-0',
        className
      )}
    >
      {/* Header bar for left panels and horizontal panels */}
      {(!isVertical || position === 'left') && (
        <div
          className={cn(
            'flex items-center gap-2 shrink-0',
            isVertical ? 'h-10 px-2 border-b border-default' : 'w-full h-10 px-3 border-b border-default'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            className="h-7 w-7 p-0"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {getChevronIcon()}
          </Button>

          {/* Horizontal panels: always show icon + title in header */}
          {!isVertical && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{icon}</span>
              <span className="text-sm font-medium text-muted-foreground">{title}</span>
            </div>
          )}

          {/* Left vertical panels expanded: show title in header */}
          {isVertical && !isCollapsed && (
            <span className="text-sm font-medium">{title}</span>
          )}
        </div>
      )}

      {/* Right panel expanded: header with icon box and title (matches palette style) */}
      {isVertical && position === 'right' && !isCollapsed && (
        <div className="flex items-center gap-3 px-3 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
            <span className="text-muted-foreground">{icon}</span>
          </div>
          <span className="text-base font-bold text-foreground">{title}</span>
        </div>
      )}

      {/* Left vertical panels collapsed: show icon + vertical title */}
      {isVertical && position === 'left' && isCollapsed && (
        <div className="flex flex-1 flex-col items-center pt-3 gap-2 overflow-hidden">
          <span className="text-muted-foreground">{icon}</span>
          <div className="flex flex-col items-center gap-0.5">
            {title.split('').map((char, index) => {
              const charKey = `left-${index}-${char}`
              return (
              <span
                key={charKey}
                className={cn(
                  'text-xs font-medium text-muted-foreground leading-none',
                  char === ' ' && 'h-2'
                )}
              >
                {char === ' ' ? '' : char}
              </span>
            )})}
          </div>
        </div>
      )}

      {/* Right vertical panels collapsed: icon strip style (matches palette) */}
      {isVertical && position === 'right' && isCollapsed && (
        <div className="flex flex-col items-center gap-1 py-3 flex-1">
          {/* Icon in rounded box (same as palette) */}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50 mb-1">
            <span className="text-muted-foreground [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
          </div>

          {/* Separator after icon (same as palette) */}
          <div className="w-10 h-px bg-border my-2" />

          {/* Vertical title as stacked letters */}
          <div className="flex flex-col items-center gap-0.5">
            {title.split('').map((char, index) => {
              const charKey = `right-${index}-${char}`
              return (
              <span
                key={charKey}
                className={cn(
                  'text-xs font-medium text-muted-foreground leading-none',
                  char === ' ' && 'h-2'
                )}
              >
                {char === ' ' ? '' : char}
              </span>
            )})}
          </div>
        </div>
      )}

      {/* Content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      )}

      {/* Bottom toggle button for right-side vertical panels (matches palette) */}
      {isVertical && position === 'right' && (
        <div className="flex flex-col h-[49px] mt-auto">
          <div className="h-px w-full bg-border shrink-0" />
          <div className={cn(
            'flex flex-1 items-center',
            isCollapsed ? 'flex-col justify-center' : 'justify-end px-3'
          )}>
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(
                'flex items-center justify-center rounded-md',
                'hover:bg-muted/50 transition-colors',
                'text-muted-foreground hover:text-foreground',
                isCollapsed ? 'w-8 h-8' : 'w-7 h-7'
              )}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
            >
              {getPanelToggleIcon()}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
