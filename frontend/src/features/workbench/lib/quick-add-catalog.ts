/**
 * Quick-add catalog (REQ-4.2.5, CANVAS-224): pure merge of the palette
 * sources into the grouped item rows the quick-add popover renders. The
 * built-in half (every plugin, every control, one "New Function" creator
 * row) is fixed; published Functions are mapped as they are paged in.
 */

import {
  CONTROL_CATEGORIES,
  CONTROL_DEFINITIONS,
} from '@/features/workbench/lib/control-definitions'
import { FUNCTION_COLOR_CLASS } from '@/features/workbench/lib/function-definition'
import { PLUGIN_SUBCATEGORIES } from '@/features/workbench/common/palette/palette-types'
import type { FunctionSummary } from '@/features/functions/api/types'

export type QuickAddItemType = 'plugin' | 'control' | 'function' | 'new-function'
export type QuickAddGroup = 'plugins' | 'controls' | 'functions'

export interface QuickAddItem {
  id: string
  name: string
  type: QuickAddItemType
  group: QuickAddGroup
  iconName: string
  colorClass: string
  /** Right-aligned row label (e.g. "Network", "Loops"). */
  categoryLabel?: string
  /** Library entry id (function rows). */
  functionId?: string
  /** Library entry's current version (function rows). */
  version?: string
}

const PLUGIN_ROWS: QuickAddItem[] = PLUGIN_SUBCATEGORIES.flatMap((sub) =>
  sub.plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    type: 'plugin' as const,
    group: 'plugins' as const,
    iconName: plugin.iconName,
    colorClass: plugin.colorClass,
    categoryLabel: sub.name,
  })),
)

const CONTROL_ROWS: QuickAddItem[] = CONTROL_DEFINITIONS.map((def) => ({
  id: def.id,
  name: def.name,
  type: 'control' as const,
  group: 'controls' as const,
  iconName: def.iconName,
  colorClass: def.colorClass,
  categoryLabel: CONTROL_CATEGORIES.find((c) => c.id === def.category)?.name,
}))

const NEW_FUNCTION_ROW: QuickAddItem = {
  id: 'new-function',
  name: 'New Function',
  type: 'new-function',
  group: 'functions',
  iconName: 'Plus',
  colorClass: FUNCTION_COLOR_CLASS,
}

/**
 * The rows that never come from the server, in render order. Built once at
 * import so the popover's grouping never re-runs for them.
 */
export const QUICK_ADD_BUILTINS: ReadonlyArray<QuickAddItem> = [
  ...PLUGIN_ROWS,
  ...CONTROL_ROWS,
  NEW_FUNCTION_ROW,
]

export function buildFunctionRows(
  functions: ReadonlyArray<FunctionSummary>,
): QuickAddItem[] {
  return functions.map((fn) => ({
    id: fn.id,
    name: fn.name,
    type: 'function' as const,
    group: 'functions' as const,
    iconName: 'FunctionSquare',
    colorClass: FUNCTION_COLOR_CLASS,
    functionId: fn.id,
    version: fn.latest_version,
  }))
}
