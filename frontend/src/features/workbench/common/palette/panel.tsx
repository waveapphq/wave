/**
 * PalettePanel Component - V-CANVAS-01f/g
 *
 * Block palette panel with collapsed icon strip and expanded sections.
 * Provides drag-and-drop access to controls and plugins for workflow construction.
 *
 * REQs:
 * - REQ-3.1.1.1: Drag-and-drop interface for block arrangement
 * - REQ-4.2.1: No-code test creation for basic users
 * - REQ-4.2.3: Intuitive drag-drop interface
 *
 * Dimensions:
 * - Expanded: 260px width
 * - Collapsed: 64px width (icon strip)
 */

import { useState, useCallback } from 'react'
import type { PalettePanelProps } from './palette-types'
import { PaletteCollapsed } from './palette-collapsed'
import { PaletteExpanded } from './palette-expanded'

// ============================================================================
// Main Component
// ============================================================================

export function PalettePanel({
  defaultCollapsed = true,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  onOpenFunctionLibrary,
  disabled = false,
}: Readonly<PalettePanelProps>) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const [searchQuery, setSearchQuery] = useState('')
  const [openFlyout, setOpenFlyout] = useState<string | null>(null)

  const isCollapsed = disabled ? true : (controlledCollapsed ?? internalCollapsed)

  // Toggle collapse
  const toggleCollapsed = useCallback(
    (newValue: boolean) => {
      setInternalCollapsed(newValue)
      onCollapsedChange?.(newValue)
    },
    [onCollapsedChange]
  )

  const handleExpand = useCallback(() => {
    toggleCollapsed(false)
  }, [toggleCollapsed])

  const handleCollapse = useCallback(() => {
    toggleCollapsed(true)
  }, [toggleCollapsed])

  if (isCollapsed) {
    return (
      <PaletteCollapsed
        openFlyout={disabled ? null : openFlyout}
        onFlyoutChange={setOpenFlyout}
        onOpenFunctionLibrary={onOpenFunctionLibrary}
        onExpand={handleExpand}
        disabled={disabled}
      />
    )
  }

  return (
    <PaletteExpanded
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onOpenFunctionLibrary={onOpenFunctionLibrary}
      onCollapse={handleCollapse}
    />
  )
}
