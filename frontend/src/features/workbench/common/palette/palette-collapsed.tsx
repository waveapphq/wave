/**
 * Collapsed state of the PalettePanel - the 64px icon strip with popover flyouts.
 */

import {
  Search,
  Star,
  Clock,
  GitBranch,
  Puzzle,
  Plus,
  FunctionSquare,
  PanelRightClose,
  Wrench,
} from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useCallback, type DragEvent } from 'react'
import { cn } from '@/lib/utils'
import { IconButton } from './palette-helpers'
import {
  SearchFlyout,
  RecentFlyout,
  MostUsedFlyout,
  ControlsFlyout,
  PluginsFlyout,
} from './palette-flyouts'

// ============================================================================
// PaletteCollapsed
// ============================================================================

interface PaletteCollapsedProps {
  openFlyout: string | null
  onFlyoutChange: (flyout: string | null) => void
  onOpenFunctionLibrary?: () => void
  onExpand: () => void
  /** When true, suppress all interactions (history canvas). */
  disabled?: boolean
}

const NEW_FUNCTION_DRAG_PAYLOAD = JSON.stringify({ type: 'function-new-local' })

export function PaletteCollapsed({
  openFlyout,
  onFlyoutChange,
  onOpenFunctionLibrary,
  onExpand,
  disabled = false,
}: Readonly<PaletteCollapsedProps>) {
  const handleNewFunctionDragStart = useCallback((event: DragEvent<HTMLButtonElement>) => {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/wave-block', NEW_FUNCTION_DRAG_PAYLOAD)
    }
  }, [])

  // When disabled, `pointer-events-none` on the root blocks drag, click,
  // and Popover-trigger events so flyouts can never open, palette buttons
  // never fire, and the expand button is inert. Force any stale
  // controlled `openFlyout` value closed for safety.
  const activeFlyout = disabled ? null : openFlyout
  return (
    <div
      data-testid="block-palette"
      data-state="collapsed"
      data-disabled={disabled ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      className={`flex flex-col shrink-0 bg-muted/30 border-r border-border${disabled ? ' opacity-50 pointer-events-none cursor-not-allowed' : ''}`}
      style={{ width: 64 }}
    >
      {/* Main content area */}
      <div
        data-testid="palette-icon-strip"
        className="flex flex-col items-center gap-1 py-3 flex-1"
      >
        {/* Tools icon (header) */}
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50 mb-1">
          <Wrench className="h-6 w-6 text-muted-foreground" />
        </div>

        {/* Separator after header */}
        <div className="w-10 h-px bg-border my-2" />

        {/* Search icon with popover */}
        <Popover
          open={activeFlyout === 'search'}
          onOpenChange={(open) => onFlyoutChange(open ? 'search' : null)}
        >
          <ConditionalTooltip content="Search" side="right">
              <PopoverTrigger asChild>
                <IconButton
                  testId="palette-icon-search"
                  icon={<Search className="h-5 w-5" />}
                  colorClass="text-cyan-500"
                  size="lg"
                />
              </PopoverTrigger>
          </ConditionalTooltip>
          <PopoverContent side="right" align="start" className="w-auto p-3 max-h-[70vh] overflow-hidden">
            <SearchFlyout />
          </PopoverContent>
        </Popover>

        {/* Recent icon with popover */}
        <Popover
          open={activeFlyout === 'recent'}
          onOpenChange={(open) => onFlyoutChange(open ? 'recent' : null)}
        >
          <ConditionalTooltip content="Recent" side="right">
              <PopoverTrigger asChild>
                <IconButton
                  testId="palette-icon-recent"
                  icon={<Clock className="h-5 w-5" />}
                  colorClass="text-cyan-500"
                  size="lg"
                />
              </PopoverTrigger>
          </ConditionalTooltip>
          <PopoverContent side="right" align="start" className="w-auto p-3 max-h-[70vh] overflow-hidden">
            <RecentFlyout />
          </PopoverContent>
        </Popover>

        {/* Most Used icon with popover */}
        <Popover
          open={activeFlyout === 'most-used'}
          onOpenChange={(open) => onFlyoutChange(open ? 'most-used' : null)}
        >
          <ConditionalTooltip content="Most Used" side="right">
              <PopoverTrigger asChild>
                <IconButton
                  testId="palette-icon-most-used"
                  icon={<Star className="h-5 w-5" />}
                  colorClass="text-yellow-500"
                  size="lg"
                />
              </PopoverTrigger>
          </ConditionalTooltip>
          <PopoverContent side="right" align="start" className="w-auto p-3 max-h-[70vh] overflow-hidden">
            <MostUsedFlyout />
          </PopoverContent>
        </Popover>

        {/* Separator after Most Used */}
        <div className="w-10 h-px bg-border my-2" />

        {/* Controls icon with popover on click */}
        <Popover
          open={activeFlyout === 'controls'}
          onOpenChange={(open) => onFlyoutChange(open ? 'controls' : null)}
        >
          <ConditionalTooltip content="Controls" side="right">
              <PopoverTrigger asChild>
                <IconButton
                  testId="palette-icon-controls"
                  icon={<GitBranch className="h-5 w-5" />}
                  colorClass="text-orange-500"
                  size="lg"
                />
              </PopoverTrigger>
          </ConditionalTooltip>
          <PopoverContent side="right" align="start" className="w-auto p-3 max-h-[70vh] overflow-hidden">
            <ControlsFlyout />
          </PopoverContent>
        </Popover>

        {/* Plugins icon with popover on click */}
        <Popover
          open={activeFlyout === 'plugins'}
          onOpenChange={(open) => onFlyoutChange(open ? 'plugins' : null)}
        >
          <ConditionalTooltip content="Plugins" side="right">
              <PopoverTrigger asChild>
                <IconButton
                  testId="palette-icon-plugins"
                  icon={<Puzzle className="h-5 w-5" />}
                  colorClass="text-violet-400"
                  size="lg"
                />
              </PopoverTrigger>
          </ConditionalTooltip>
          <PopoverContent side="right" align="start" className="w-auto p-3 max-h-[70vh] overflow-hidden">
            <PluginsFlyout />
          </PopoverContent>
        </Popover>

        {/* Separator after Plugins */}
        <div className="w-10 h-px bg-border my-2" />

        {/* Add icon - drag to create a new local Function. */}
        <ConditionalTooltip content="New Function" side="right">
            <div>
              <button
                data-testid="palette-icon-add"
                type="button"
                draggable="true"
                aria-label="New Function"
                onDragStart={handleNewFunctionDragStart}
                className={cn(
                  'flex items-center justify-center rounded-md',
                  'hover:bg-muted/50 transition-colors',
                  'w-9 h-9',
                  'text-cyan-500',
                  'cursor-grab active:cursor-grabbing',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
        </ConditionalTooltip>

        {/* Library icon - opens the Functions Library modal. */}
        <ConditionalTooltip content="Function Lib" side="right">
            <div>
              <IconButton
                testId="palette-icon-library"
                icon={<FunctionSquare className="h-5 w-5" />}
                colorClass="text-indigo-400"
                size="lg"
                onClick={(e) => {
                  if (disabled) return
                  e?.stopPropagation?.()
                  onOpenFunctionLibrary?.()
                }}
              />
            </div>
        </ConditionalTooltip>
      </div>

      {/* Bottom expand button */}
      <div className="flex flex-col items-center justify-center h-[49px]">
        <div className="h-px w-full bg-border shrink-0" />
        <div className="flex flex-1 items-center justify-center">
          <IconButton
            testId="palette-expand-button"
            icon={<PanelRightClose className="h-4 w-4" />}
            colorClass="text-muted-foreground hover:text-foreground"
            onClick={onExpand}
          />
        </div>
      </div>
    </div>
  )
}
