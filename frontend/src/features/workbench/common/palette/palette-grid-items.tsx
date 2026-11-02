/**
 * Grid-style draggable items for flyout popovers.
 *
 * Used by SearchFlyout, RecentFlyout, MostUsedFlyout, ControlsFlyout, and PluginsFlyout.
 */

import { useState, useCallback, useMemo, type DragEvent } from 'react'
import {
  CONTROL_DEFINITIONS,
  type ControlDefinition,
} from '@/features/workbench/lib/control-definitions'
import {
  PLUGIN_DEFINITIONS,
  PLUGIN_CATEGORIES,
  type PluginDefinition,
} from '@/features/workbench/lib/plugin-definitions'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import { SearchInput } from '@/components/ui/search-input'
import { cn } from '@/lib/utils'

// ============================================================================
// DraggableGridItem (grid-style control item for flyouts)
// ============================================================================

interface DraggableGridItemProps {
  item: ControlDefinition
}

export function DraggableGridItem({ item }: Readonly<DraggableGridItemProps>) {
  const Icon = getIconComponent(item.iconName)

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/wave-block',
          JSON.stringify({ id: item.id, name: item.name, type: 'control', source: 'palette' })
        )
      }
    },
    [item.id, item.name]
  )

  return (
    <button
      type="button"
      data-testid={`flyout-item-${item.id}`}
      draggable="true"
      tabIndex={-1}
      aria-label={item.name}
      onDragStart={handleDragStart}
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-3 rounded-lg cursor-grab',
        'hover:bg-muted/50 transition-colors bg-transparent border-0'
      )}
    >
      <Icon className={cn('h-10 w-10', item.colorClass)} />
      <span className="text-xs text-muted-foreground text-center leading-tight">
        {item.name}
      </span>
    </button>
  )
}

// ============================================================================
// DraggablePluginGridItem (grid-style plugin item for flyouts)
// ============================================================================

interface DraggablePluginGridItemProps {
  plugin: PluginDefinition
  colorClass: string
}

export function DraggablePluginGridItem({ plugin, colorClass }: Readonly<DraggablePluginGridItemProps>) {
  const Icon = getIconComponent(plugin.iconName)

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/wave-block',
          JSON.stringify({ id: plugin.id, name: plugin.name, type: 'plugin', source: 'palette' })
        )
      }
    },
    [plugin.id, plugin.name]
  )

  return (
    <button
      type="button"
      data-testid={`flyout-item-${plugin.id}`}
      draggable="true"
      tabIndex={-1}
      aria-label={plugin.name}
      onDragStart={handleDragStart}
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-3 rounded-lg cursor-grab',
        'hover:bg-muted/50 transition-colors bg-transparent border-0'
      )}
    >
      <Icon className={cn('h-10 w-10', colorClass)} />
      <span className="text-xs text-muted-foreground text-center leading-tight">
        {plugin.name}
      </span>
    </button>
  )
}

// ============================================================================
// SearchFlyout
// ============================================================================

export function SearchFlyout() {
  const [query, setQuery] = useState('')

  const filteredControls = useMemo(() => {
    if (!query) return [...CONTROL_DEFINITIONS]
    const q = query.toLowerCase()
    return CONTROL_DEFINITIONS.filter((item) => item.name.toLowerCase().includes(q))
  }, [query])

  const filteredPlugins = useMemo(() => {
    if (!query) return PLUGIN_DEFINITIONS.map((p) => ({ plugin: p, category: PLUGIN_CATEGORIES.find((c) => c.id === p.category)! }))
    const q = query.toLowerCase()
    return PLUGIN_DEFINITIONS
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({ plugin: p, category: PLUGIN_CATEGORIES.find((c) => c.id === p.category)! }))
  }, [query])

  const hasResults = filteredControls.length > 0 || filteredPlugins.length > 0

  return (
    <div data-testid="palette-flyout-search" className="flex flex-col" style={{ width: 360 }}>
      {/* Search input */}
      <div className="px-1 pb-3">
        <SearchInput
          inputTestId="flyout-search-input"
          clearTestId="flyout-search-clear"
          size="xs"
          className="w-full"
          placeholder="Search controls & plugins…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* Results */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: 'calc(60vh - 80px)', scrollbarGutter: 'stable' }}
      >
        {hasResults ? (
          <div className="flex flex-col gap-3 px-1 pb-2">
            {/* Controls results */}
            {filteredControls.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 mb-2">
                  Controls ({filteredControls.length})
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {filteredControls.map((item) => (
                    <DraggableGridItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Separator */}
            {filteredControls.length > 0 && filteredPlugins.length > 0 && (
              <div className="h-px bg-border mx-2" />
            )}

            {/* Plugins results */}
            {filteredPlugins.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 mb-2">
                  Plugins ({filteredPlugins.length})
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {filteredPlugins.map(({ plugin, category }) => (
                    <DraggablePluginGridItem
                      key={plugin.id}
                      plugin={plugin}
                      colorClass={category.colorClass}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            No results for "{query}"
          </div>
        )}
      </div>
    </div>
  )
}
