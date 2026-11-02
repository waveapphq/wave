/** Scrollable content area for the expanded PalettePanel. */

import { useMemo, useCallback } from 'react'
import { Star, Clock, GitBranch, Puzzle } from 'lucide-react'
import {
  CONTROL_DEFINITIONS,
  getControlById,
} from '@/features/workbench/lib/control-definitions'
import { filterByBlockQuery, matchesBlockQuery } from '@/features/workbench/lib/block-search'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import { ScrollArea } from '@/components/ui/scroll-area'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import {
  PLUGIN_SUBCATEGORIES,
  getPluginItemById,
} from './palette-types'
import { DraggableItem, CollapsibleSection } from './palette-helpers'
import { PluginSubcategorySection, ControlSubgroupSection } from './palette-sections'

interface PaletteExpandedContentProps {
  searchQuery: string
}

export function PaletteExpandedContent({ searchQuery }: Readonly<PaletteExpandedContentProps>) {
  // Usage store
  const { recentItems, frequentItems } = usePaletteUsageStore()

  // Search filtering via the shared substring matcher
  const filteredControls = useMemo(
    () => filterByBlockQuery(CONTROL_DEFINITIONS, searchQuery),
    [searchQuery],
  )

  const filteredPlugins = useMemo(() => {
    if (!searchQuery) return PLUGIN_SUBCATEGORIES
    return PLUGIN_SUBCATEGORIES.map((subcat) => ({
      ...subcat,
      plugins: filterByBlockQuery(subcat.plugins, searchQuery),
    })).filter(
      (subcat) => subcat.plugins.length > 0 || matchesBlockQuery(subcat.name, searchQuery),
    )
  }, [searchQuery])

  const hasResults = filteredControls.length > 0 || filteredPlugins.some((s) => s.plugins.length > 0)

  // Group controls by category for grouped display
  const controlsByGroup = useMemo(() => {
    const groups = {
      conditional: filteredControls.filter((c) => c.category === 'conditional'),
      loop: filteredControls.filter((c) => c.category === 'loop'),
      flow: filteredControls.filter((c) => c.category === 'flow'),
      timing: filteredControls.filter((c) => c.category === 'timing'),
      misc: filteredControls.filter((c) => c.category === 'misc'),
    }
    return groups
  }, [filteredControls])

  // Get item with icon/color info
  const getItemWithVisuals = useCallback((itemId: string) => {
    const control = getControlById(itemId)
    if (control) {
      return {
        id: control.id,
        name: control.name,
        icon: getIconComponent(control.iconName),
        colorClass: control.colorClass,
        type: 'control' as const
      }
    }
    const pluginInfo = getPluginItemById(itemId)
    if (pluginInfo) return {
      id: pluginInfo.plugin.id,
      name: pluginInfo.plugin.name,
      icon: getIconComponent(pluginInfo.plugin.iconName),
      colorClass: pluginInfo.category.colorClass,
      type: 'plugin' as const
    }
    return null
  }, [])

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-1.5 p-3">
        {/* No results state */}
        {searchQuery && !hasResults && (
          <div data-testid="palette-no-results" className="text-sm text-muted-foreground text-center py-4">
            No results found
          </div>
        )}

        {/* Recently Used section */}
        {!searchQuery && (
          <CollapsibleSection
            testId="palette-section-recent"
            title="Recent"
            icon={<Clock className="h-4 w-4" />}
            iconColorClass="text-cyan-500"
            defaultExpanded={true}
            storageKey="recent"
            isEmpty={recentItems.length === 0}
            emptyState={
              <div className="px-2 py-2 text-sm text-muted-foreground/70 italic pl-3">
                Drag items to track recent
              </div>
            }
          >
            <div className="flex flex-col gap-0.5 pl-3">
              {recentItems.slice(0, 6).map((itemId) => {
                const info = getItemWithVisuals(itemId)
                if (!info) return null
                return (
                  <DraggableItem
                    key={itemId}
                    testId={`palette-item-${itemId}`}
                    name={info.name}
                    itemId={itemId}
                    itemType={info.type}
                    icon={info.icon}
                    colorClass={info.colorClass}
                  />
                )
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Most Used section */}
        {!searchQuery && (
          <CollapsibleSection
            testId="palette-section-most-used"
            title="Most Used"
            icon={<Star className="h-4 w-4" />}
            iconColorClass="text-yellow-500"
            defaultExpanded={true}
            storageKey="most-used"
            isEmpty={frequentItems.length === 0}
            emptyState={
              <div className="px-2 py-2 text-sm text-muted-foreground/70 italic pl-3">
                Most used items appear here
              </div>
            }
          >
            <div className="flex flex-col gap-0.5 pl-3">
              {frequentItems.slice(0, 6).map((item) => {
                const info = getItemWithVisuals(item.id)
                if (!info) return null
                return (
                  <DraggableItem
                    key={item.id}
                    testId={`palette-item-${item.id}`}
                    name={info.name}
                    itemId={item.id}
                    itemType={info.type}
                    icon={info.icon}
                    colorClass={info.colorClass}
                  />
                )
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Separator after personalized sections */}
        {!searchQuery && (recentItems.length > 0 || frequentItems.length > 0) && (
          <div className="h-px bg-border mx-2 my-1" />
        )}

        {/* CONTROLS section */}
        {(filteredControls.length > 0 || !searchQuery) && (
          <CollapsibleSection
            testId="palette-section-controls"
            title="Controls"
            icon={<GitBranch className="h-4 w-4" />}
            iconColorClass="text-orange-500"
            defaultExpanded={true}
            storageKey="controls"
            forceExpanded={searchQuery && filteredControls.length > 0 ? true : undefined}
            isEmpty={filteredControls.length === 0}
            emptyState={
              <div className="px-2 py-2 text-sm text-muted-foreground/70 italic">
                No matching controls
              </div>
            }
          >
            {searchQuery ? (
              // When searching, show flat list
              filteredControls.map((item) => (
                <DraggableItem
                  key={item.id}
                  testId={`palette-item-${item.id}`}
                  name={item.name}
                  itemId={item.id}
                  itemType="control"
                  icon={getIconComponent(item.iconName)}
                  colorClass={item.colorClass}
                />
              ))
            ) : (
              // Normal mode: group by type with collapsible subgroups
              <>
                <ControlSubgroupSection
                  testId="palette-subgroup-conditionals"
                  name="Conditionals"
                  groupKey="conditionals"
                  items={controlsByGroup.conditional}
                />
                <ControlSubgroupSection
                  testId="palette-subgroup-loops"
                  name="Loops"
                  groupKey="loops"
                  items={controlsByGroup.loop}
                />
                <ControlSubgroupSection
                  testId="palette-subgroup-flow"
                  name="Flow"
                  groupKey="flow"
                  items={controlsByGroup.flow}
                />
                <ControlSubgroupSection
                  testId="palette-subgroup-timing"
                  name="Timing"
                  groupKey="timing"
                  items={controlsByGroup.timing}
                />
                <ControlSubgroupSection
                  testId="palette-subgroup-misc"
                  name="Misc"
                  groupKey="misc"
                  items={controlsByGroup.misc}
                />
              </>
            )}
          </CollapsibleSection>
        )}

        {/* PLUGINS section */}
        {(filteredPlugins.length > 0 || !searchQuery) && (
          <CollapsibleSection
            testId="palette-section-plugins"
            title="Plugins"
            icon={<Puzzle className="h-4 w-4" />}
            iconColorClass="text-violet-400"
            defaultExpanded={true}
            storageKey="plugins"
            forceExpanded={searchQuery && filteredPlugins.some((s) => s.plugins.length > 0) ? true : undefined}
          >
            {searchQuery ? (
              // When searching, show flat list of matching plugins
              filteredPlugins.flatMap((subcat) =>
                subcat.plugins.map((plugin) => (
                  <DraggableItem
                    key={plugin.id}
                    testId={`palette-item-${plugin.id}`}
                    name={plugin.name}
                    itemId={plugin.id}
                    itemType="plugin"
                    icon={getIconComponent(plugin.iconName)}
                    colorClass={subcat.colorClass}
                  />
                ))
              )
            ) : (
              // Normal mode: show subcategories
              PLUGIN_SUBCATEGORIES.map((subcat) => (
                <PluginSubcategorySection
                  key={subcat.id}
                  testId={`palette-subcat-${subcat.id}`}
                  name={subcat.name}
                  count={subcat.plugins.length}
                  colorClass={subcat.colorClass}
                  plugins={subcat.plugins}
                />
              ))
            )}
          </CollapsibleSection>
        )}
      </div>
    </ScrollArea>
  )
}
