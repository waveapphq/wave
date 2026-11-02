/**
 * Types, constants, and data helpers for the PalettePanel.
 */

import {
  PLUGIN_CATEGORIES,
  getPluginsByCategory,
  getPluginById,
  type PluginDefinition,
  type PluginCategory,
} from '@/features/workbench/lib/plugin-definitions'

// ============================================================================
// Types
// ============================================================================

export interface PalettePanelProps {
  /** Initial collapsed state (uncontrolled) */
  defaultCollapsed?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Click callback for the "Function Lib" button (opens Functions Library modal). */
  onOpenFunctionLibrary?: () => void
  /**
   * Disabled mode: the icon strip renders but all interactions are
   * suppressed (no flyouts, no clicks, no expand). Used by the
   * historical test canvas at `/executions/history/:runId`.
   */
  disabled?: boolean
}

export interface PluginWithCategory {
  plugin: PluginDefinition
  category: { id: PluginCategory; name: string; colorClass: string }
}

// ============================================================================
// Data Definitions
// ============================================================================

/**
 * Build plugin subcategories from plugin-definitions.
 * Uses PLUGIN_CATEGORIES and getPluginsByCategory to construct the subcategories structure.
 */
function buildPluginSubcategories() {
  return PLUGIN_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    colorClass: cat.colorClass,
    plugins: getPluginsByCategory(cat.id),
  }))
}

// Memoized at module level since it's static
export const PLUGIN_SUBCATEGORIES = buildPluginSubcategories()

// ============================================================================
// Helpers
// ============================================================================

export function getPluginItemById(id: string): PluginWithCategory | undefined {
  const plugin = getPluginById(id)
  if (!plugin) return undefined

  // Category is guaranteed to exist because plugin.category is typed as PluginCategory
  // and PLUGIN_CATEGORIES contains all PluginCategory values
  const category = PLUGIN_CATEGORIES.find((c) => c.id === plugin.category)!

  return { plugin, category }
}
