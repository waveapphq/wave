/**
 * Catalog flyout components for Controls and Plugins in the collapsed PalettePanel.
 */

import { CONTROL_DEFINITIONS, getControlCategoryColor } from '@/features/workbench/lib/control-definitions'
import { cn } from '@/lib/utils'
import { PLUGIN_SUBCATEGORIES } from './palette-types'
import { DraggableGridItem, DraggablePluginGridItem } from './palette-grid-items'

// ============================================================================
// ControlsFlyout
// ============================================================================

export function ControlsFlyout() {
  const conditionals = CONTROL_DEFINITIONS.filter((item) => item.category === 'conditional')
  const loops = CONTROL_DEFINITIONS.filter((item) => item.category === 'loop')
  const flow = CONTROL_DEFINITIONS.filter((item) => item.category === 'flow')
  const timing = CONTROL_DEFINITIONS.filter((item) => item.category === 'timing')
  const misc = CONTROL_DEFINITIONS.filter((item) => item.category === 'misc')

  return (
    <div data-testid="palette-flyout-controls" className="flex flex-col" style={{ width: 360 }}>
      {/* Header */}
      <div className="text-sm font-semibold uppercase tracking-wider text-foreground px-2 pb-2 border-b border-border mb-2">
        Controls
      </div>

      <div
        className="overflow-y-auto"
        style={{
          minHeight: '180px',
          maxHeight: 'calc(60vh - 80px)',
          scrollbarGutter: 'stable',
        }}
      >
        <div className="flex flex-col gap-3 px-1 pb-2">
          {/* Conditionals */}
          <div>
            <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', getControlCategoryColor('conditional'))}>
              Conditionals
            </div>
            <div className="grid grid-cols-3 gap-1">
              {conditionals.map((item) => (
                <DraggableGridItem key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="h-px bg-border mx-2" />

          {/* Loops */}
          <div>
            <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', getControlCategoryColor('loop'))}>
              Loops
            </div>
            <div className="grid grid-cols-3 gap-1">
              {loops.map((item) => (
                <DraggableGridItem key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="h-px bg-border mx-2" />

          {/* Flow Control */}
          <div>
            <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', getControlCategoryColor('flow'))}>
              Flow
            </div>
            <div className="grid grid-cols-3 gap-1">
              {flow.map((item) => (
                <DraggableGridItem key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="h-px bg-border mx-2" />

          {/* Timing */}
          <div>
            <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', getControlCategoryColor('timing'))}>
              Timing
            </div>
            <div className="grid grid-cols-3 gap-1">
              {timing.map((item) => (
                <DraggableGridItem key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="h-px bg-border mx-2" />

          {/* Misc */}
          <div>
            <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', getControlCategoryColor('misc'))}>
              Misc
            </div>
            <div className="grid grid-cols-3 gap-1">
              {misc.map((item) => (
                <DraggableGridItem key={item.id} item={item} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// PluginsFlyout
// ============================================================================

export function PluginsFlyout() {
  return (
    <div data-testid="palette-flyout-plugins" className="flex flex-col" style={{ width: 360 }}>
      {/* Header */}
      <div className="text-sm font-semibold uppercase tracking-wider text-foreground px-2 pb-2 border-b border-border mb-2">
        Plugins
      </div>

      <div
        className="overflow-y-auto"
        style={{
          minHeight: '180px',
          maxHeight: 'calc(60vh - 80px)',
          scrollbarGutter: 'stable',
        }}
      >
        <div className="flex flex-col gap-3 px-1 pb-2">
          {PLUGIN_SUBCATEGORIES.filter((subcat) => subcat.plugins.length > 0).map(
            (subcat, index) => (
              <div key={subcat.id}>
                {index > 0 && <div className="h-px bg-border mx-2 mb-3" />}
                <div>
                  <div className={cn('text-xs font-medium uppercase tracking-wider px-2 mb-2', subcat.colorClass)}>
                    {subcat.name}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {subcat.plugins.map((plugin) => (
                      <DraggablePluginGridItem
                        key={plugin.id}
                        plugin={plugin}
                        colorClass={subcat.colorClass}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
