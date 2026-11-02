/**
 * Shared helper components for the PalettePanel.
 *
 * Includes: IconButton, DraggableItem, CollapsibleSection, and localStorage helpers.
 */

import { useState, useCallback, type DragEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// localStorage Persistence
// ============================================================================

const STORAGE_KEY_PREFIX = 'wave-palette-section-'

export function getStoredExpanded(storageKey: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + storageKey)
    if (stored !== null) return stored === 'true'
  } catch {
    // localStorage unavailable
  }
  return defaultValue
}

export function setStoredExpanded(storageKey: string, value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + storageKey, String(value))
  } catch {
    // localStorage unavailable
  }
}

// ============================================================================
// IconButton
// ============================================================================

export interface IconButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  testId: string
  icon: React.ReactNode
  colorClass: string
  size?: 'sm' | 'lg'
  ref?: React.Ref<HTMLButtonElement>
}

export function IconButton({
  testId,
  icon,
  colorClass,
  size = 'sm',
  className,
  ...rest
}: Readonly<IconButtonProps>) {
  return (
    <button
      data-testid={testId}
      type="button"
      className={cn(
        'flex items-center justify-center rounded-md',
        'hover:bg-muted/50 transition-colors',
        size === 'lg' ? 'w-9 h-9' : 'w-8 h-8',
        colorClass,
        className
      )}
      {...rest}
    >
      {icon}
    </button>
  )
}

// ============================================================================
// DraggableItem (list-style item for expanded panel)
// ============================================================================

export interface DraggableItemProps {
  testId: string
  name: string
  itemId: string
  itemType: 'control' | 'plugin'
  icon?: React.ComponentType<{ className?: string }>
  colorClass?: string
}

export function DraggableItem({
  testId,
  name,
  itemId,
  itemType,
  icon: Icon,
  colorClass,
}: Readonly<DraggableItemProps>) {
  const handleDragStart = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/wave-block',
          JSON.stringify({ id: itemId, name, type: itemType, source: 'palette' })
        )
      }
    },
    [itemId, name, itemType]
  )

  return (
    <button
      type="button"
      data-testid={testId}
      draggable="true"
      tabIndex={-1}
      aria-label={name}
      onDragStart={handleDragStart}
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-grab',
        'hover:bg-muted/50 transition-colors',
        'text-sm text-foreground w-full text-left bg-transparent border-0'
      )}
    >
      {Icon && <Icon className={cn('h-5 w-5 shrink-0', colorClass)} />}
      <span className="truncate">{name}</span>
    </button>
  )
}

// ============================================================================
// CollapsibleSection
// ============================================================================

export interface CollapsibleSectionProps {
  testId: string
  title: string
  icon?: React.ReactNode
  iconColorClass?: string
  defaultExpanded?: boolean
  storageKey: string
  forceExpanded?: boolean
  children: React.ReactNode
  emptyState?: React.ReactNode
  isEmpty?: boolean
}

export function CollapsibleSection({
  testId,
  title,
  icon,
  iconColorClass,
  defaultExpanded = true,
  storageKey,
  forceExpanded,
  children,
  emptyState,
  isEmpty = false,
}: Readonly<CollapsibleSectionProps>) {
  const [expanded, setExpanded] = useState(() => getStoredExpanded(storageKey, defaultExpanded))

  const handleToggle = useCallback(() => {
    const newValue = !expanded
    setExpanded(newValue)
    setStoredExpanded(storageKey, newValue)
  }, [expanded, storageKey])

  // Use forceExpanded when provided (e.g., during search), otherwise use internal state
  const isExpanded = forceExpanded ?? expanded

  return (
    <div data-testid={testId} data-expanded={isExpanded} className="flex flex-col">
      <button
        type="button"
        data-testid="section-header"
        aria-expanded={isExpanded}
        onClick={handleToggle}
        className={cn(
          'flex items-center justify-between px-2 py-2',
          'text-sm font-semibold uppercase tracking-wider',
          'hover:bg-muted/30 rounded transition-colors',
          'text-foreground'
        )}
      >
        <span className="flex items-center gap-2">
          <span className={iconColorClass}>{icon}</span>
          {title}
        </span>
        {isExpanded ? <ChevronDown className="h-4 w-4 opacity-60" /> : <ChevronRight className="h-4 w-4 opacity-60" />}
      </button>
      <div
        className={cn('flex flex-col gap-0.5', !isExpanded && 'hidden')}
        style={{ visibility: isExpanded ? 'visible' : 'hidden' }}
      >
        {isEmpty ? emptyState : children}
      </div>
    </div>
  )
}
