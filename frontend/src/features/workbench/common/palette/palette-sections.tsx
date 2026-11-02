/**
 * Collapsible subsection components for the expanded PalettePanel.
 *
 * PluginSubcategorySection and ControlSubgroupSection render nested
 * collapsible groups within the Controls and Plugins sections.
 */

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import { cn } from '@/lib/utils'
import type { ControlDefinition } from '@/features/workbench/lib/control-definitions'
import type { PluginDefinition } from '@/features/workbench/lib/plugin-definitions'
import { getStoredExpanded, setStoredExpanded, DraggableItem } from './palette-helpers'

// ============================================================================
// PluginSubcategorySection
// ============================================================================

interface PluginSubcategorySectionProps {
  testId: string
  name: string
  count: number
  colorClass: string
  plugins: readonly PluginDefinition[]
}

export function PluginSubcategorySection({
  testId,
  name,
  count,
  colorClass,
  plugins,
}: Readonly<PluginSubcategorySectionProps>) {
  const subcategoryId = name.toLowerCase()
  const storageKey = `plugin-${subcategoryId}`
  const [expanded, setExpanded] = useState(() => getStoredExpanded(storageKey, false))

  const handleToggle = useCallback(() => {
    const newValue = !expanded
    setExpanded(newValue)
    setStoredExpanded(storageKey, newValue)
  }, [expanded, storageKey])

  // An empty group advertises nothing: it is not rendered at all.
  if (plugins.length === 0) return null

  return (
    <div data-testid={testId} className="flex flex-col">
      <button
        type="button"
        data-testid="subcategory-header"
        aria-expanded={expanded}
        aria-label={name}
        onClick={handleToggle}
        className={cn(
          'flex items-center justify-between px-2 py-1.5',
          'text-xs font-medium uppercase tracking-wider',
          'hover:bg-muted/30 rounded transition-colors',
          'text-foreground/70'
        )}
      >
        <span>{name}</span>
        <span className="flex items-center gap-2">
          <span data-testid="subcategory-count" className="text-[10px] opacity-60 tabular-nums">
            {count}
          </span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 opacity-50" /> : <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
        </span>
      </button>
      <div
        className={cn('flex flex-col gap-0.5 pl-3', !expanded && 'hidden')}
        style={{ visibility: expanded ? 'visible' : 'hidden' }}
      >
        {plugins.map((plugin) => (
          <DraggableItem
            key={plugin.id}
            testId={`palette-item-${plugin.id}`}
            name={plugin.name}
            itemId={plugin.id}
            itemType="plugin"
            icon={getIconComponent(plugin.iconName)}
            colorClass={colorClass}
          />
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// ControlSubgroupSection
// ============================================================================

interface ControlSubgroupSectionProps {
  testId: string
  name: string
  groupKey: string
  items: readonly ControlDefinition[]
}

export function ControlSubgroupSection({
  testId,
  name,
  groupKey,
  items,
}: Readonly<ControlSubgroupSectionProps>) {
  const storageKey = `control-${groupKey}`
  const [expanded, setExpanded] = useState(() => getStoredExpanded(storageKey, false))

  const handleToggle = useCallback(() => {
    const newValue = !expanded
    setExpanded(newValue)
    setStoredExpanded(storageKey, newValue)
  }, [expanded, storageKey])

  return (
    <div data-testid={testId} className="flex flex-col">
      <button
        type="button"
        data-testid="subgroup-header"
        aria-expanded={expanded}
        aria-label={name}
        onClick={handleToggle}
        className={cn(
          'flex items-center justify-between px-2 py-1.5',
          'text-xs font-medium uppercase tracking-wider',
          'hover:bg-muted/30 rounded transition-colors',
          'text-foreground/70'
        )}
      >
        <span>{name}</span>
        <span className="flex items-center gap-2">
          <span data-testid="subgroup-count" className="text-[10px] opacity-60 tabular-nums">
            {items.length}
          </span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 opacity-50" /> : <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
        </span>
      </button>
      <div
        className={cn('flex flex-col gap-0.5 pl-3', !expanded && 'hidden')}
        style={{ visibility: expanded ? 'visible' : 'hidden' }}
      >
        {items.map((item) => (
          <DraggableItem
            key={item.id}
            testId={`palette-item-${item.id}`}
            name={item.name}
            itemId={item.id}
            itemType="control"
            icon={getIconComponent(item.iconName)}
            colorClass={item.colorClass}
          />
        ))}
      </div>
    </div>
  )
}
