/**
 * Usage-based flyout components for the collapsed PalettePanel state.
 *
 * Includes Recent and Most Used flyout panels.
 * Re-exports SearchFlyout, ControlsFlyout, and PluginsFlyout for convenience.
 */

import { type LucideIcon, Star, Clock } from 'lucide-react'
import {
  getControlById,
  type ControlDefinition,
} from '@/features/workbench/lib/control-definitions'
import {
  type PluginDefinition,
  type PluginCategory,
} from '@/features/workbench/lib/plugin-definitions'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import { getPluginItemById } from './palette-types'
import { DraggableGridItem, DraggablePluginGridItem } from './palette-grid-items'

// Re-exports so palette-collapsed.tsx can import all flyouts from one module
export { SearchFlyout } from './palette-grid-items'
export { ControlsFlyout, PluginsFlyout } from './palette-catalog-flyouts'

// ============================================================================
// Shared grid layout for usage-based flyouts
// ============================================================================

type FlyoutItem =
  | { type: 'control'; control: ControlDefinition; id: string }
  | { type: 'plugin'; plugin: PluginDefinition; category: { id: PluginCategory; name: string; colorClass: string }; id: string }

interface PaletteFlyoutGridProps {
  testId: string
  icon: LucideIcon
  iconColorClass: string
  title: string
  items: FlyoutItem[]
}

function PaletteFlyoutGrid({
  testId,
  icon: IconComponent,
  iconColorClass,
  title,
  items,
}: Readonly<PaletteFlyoutGridProps>) {
  return (
    <div data-testid={testId} className="flex flex-col" style={{ width: 360 }}>
      <div className="text-sm font-semibold uppercase tracking-wider text-foreground px-2 pb-2 border-b border-border mb-2 flex items-center gap-2">
        <IconComponent className={`h-4 w-4 ${iconColorClass}`} />
        {title}
      </div>
      <div
        className="overflow-y-auto"
        style={{ maxHeight: 'calc(60vh - 80px)', scrollbarGutter: 'stable' }}
      >
        <div className="grid grid-cols-3 gap-1 px-1 pb-2">
          {items.map((item) =>
            item.type === 'control' ? (
              <DraggableGridItem key={item.id} item={item.control} />
            ) : (
              <DraggablePluginGridItem
                key={item.id}
                plugin={item.plugin}
                colorClass={item.category.colorClass}
              />
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// RecentFlyout
// ============================================================================

export function RecentFlyout() {
  const { recentItems } = usePaletteUsageStore()

  if (recentItems.length === 0) {
    return (
      <div data-testid="palette-flyout-recent" className="flex flex-col items-center justify-center py-8 px-4 w-[280px]">
        <Clock className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <div className="text-sm font-medium text-muted-foreground mb-1">No recent items</div>
        <div className="text-xs text-muted-foreground/70 text-center">
          Drag blocks from Controls or Plugins to see them here
        </div>
      </div>
    )
  }

  // Build items with their visual info (limit to 6)
  const items = recentItems
    .slice(0, 6)
    .map((id) => {
      const control = getControlById(id)
      if (control) return { type: 'control' as const, control, id }
      const pluginInfo = getPluginItemById(id)
      if (pluginInfo) return { type: 'plugin' as const, ...pluginInfo, id }
      return null
    })
    .filter(Boolean) as FlyoutItem[]

  return (
    <PaletteFlyoutGrid
      testId="palette-flyout-recent"
      icon={Clock}
      iconColorClass="text-cyan-500"
      title="Recently Used"
      items={items}
    />
  )
}

// ============================================================================
// MostUsedFlyout
// ============================================================================

export function MostUsedFlyout() {
  const { frequentItems } = usePaletteUsageStore()

  if (frequentItems.length === 0) {
    return (
      <div data-testid="palette-flyout-most-used" className="flex flex-col items-center justify-center py-8 px-4 w-[280px]">
        <Star className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <div className="text-sm font-medium text-muted-foreground mb-1">No favorites yet</div>
        <div className="text-xs text-muted-foreground/70 text-center">
          Your most frequently used blocks will appear here
        </div>
      </div>
    )
  }

  // Build items with their visual info (limit to 6)
  const items = frequentItems
    .slice(0, 6)
    .map(({ id }) => {
      const control = getControlById(id)
      if (control) return { type: 'control' as const, control, id }
      const pluginInfo = getPluginItemById(id)
      if (pluginInfo) return { type: 'plugin' as const, ...pluginInfo, id }
      return null
    })
    .filter(Boolean) as FlyoutItem[]

  return (
    <PaletteFlyoutGrid
      testId="palette-flyout-most-used"
      icon={Star}
      iconColorClass="text-yellow-500"
      title="Most Used"
      items={items}
    />
  )
}
