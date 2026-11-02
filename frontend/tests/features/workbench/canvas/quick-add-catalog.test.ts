/**
 * Quick-add catalog tests (REQ-4.2.5, CANVAS-224).
 *
 * `QUICK_ADD_BUILTINS` is the fixed half of the quick-add list: every plugin,
 * every control and exactly one "New Function" creator row, built once at
 * import. `buildFunctionRows` maps a page of FunctionSummary rows into the
 * same QuickAddItem shape, version carried.
 */

import { describe, it, expect } from 'vitest'

import {
  QUICK_ADD_BUILTINS,
  buildFunctionRows,
  type QuickAddItem,
} from '@/features/workbench/lib/quick-add-catalog'
import {
  CONTROL_DEFINITIONS,
  CONTROL_CATEGORIES,
} from '@/features/workbench/lib/control-definitions'
import { PLUGIN_SUBCATEGORIES } from '@/features/workbench/common/palette/palette-types'
import { FUNCTION_COLOR_CLASS } from '@/features/workbench/lib/function-definition'
import type { FunctionSummary } from '@/features/functions/api/types'

function makeFn(overrides: Partial<FunctionSummary> = {}): FunctionSummary {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'fetch_user',
    description: 'Fetches a user',
    tags: ['api'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    latest_version: '1.2.0',
    ...overrides,
  }
}

const ALL_PLUGINS = PLUGIN_SUBCATEGORIES.flatMap((sub) =>
  sub.plugins.map((plugin) => ({ plugin, sub })),
)

describe('QUICK_ADD_BUILTINS - controls', () => {
  it('includes every control definition with its display fields', () => {
    for (const def of CONTROL_DEFINITIONS) {
      const item = QUICK_ADD_BUILTINS.find(
        (i: QuickAddItem) => i.id === def.id && i.type === 'control',
      )
      expect(item, `control ${def.id} missing from catalog`).toBeDefined()
      expect(item).toMatchObject({
        id: def.id,
        name: def.name,
        type: 'control',
        group: 'controls',
        iconName: def.iconName,
        colorClass: def.colorClass,
        categoryLabel: CONTROL_CATEGORIES.find((c) => c.id === def.category)
          ?.name,
      })
      // The row carries a display label only; grouping ids stay in the palette.
      expect(item).not.toHaveProperty('categoryId')
    }
  })
})

describe('QUICK_ADD_BUILTINS - plugins', () => {
  it('includes every plugin with its display fields', () => {
    for (const { plugin, sub } of ALL_PLUGINS) {
      const item = QUICK_ADD_BUILTINS.find(
        (i: QuickAddItem) => i.id === plugin.id && i.type === 'plugin',
      )
      expect(item, `plugin ${plugin.id} missing from catalog`).toBeDefined()
      expect(item).toMatchObject({
        id: plugin.id,
        name: plugin.name,
        type: 'plugin',
        group: 'plugins',
        iconName: plugin.iconName,
        colorClass: plugin.colorClass,
        categoryLabel: sub.name,
      })
      expect(item).not.toHaveProperty('categoryId')
    }
  })
})

describe('buildFunctionRows - functions', () => {
  it('maps each FunctionSummary to a function item carrying id and version', () => {
    const fnA = makeFn()
    const fnB = makeFn({
      id: '00000000-0000-0000-0000-000000000002',
      name: 'send_report',
      latest_version: '2.0.0',
    })
    const rows = buildFunctionRows([fnA, fnB])

    const itemA = rows.find((i) => i.functionId === fnA.id)
    expect(itemA).toMatchObject({
      name: 'fetch_user',
      type: 'function',
      group: 'functions',
      functionId: fnA.id,
      version: '1.2.0',
    })

    const itemB = rows.find((i) => i.functionId === fnB.id)
    expect(itemB).toMatchObject({
      name: 'send_report',
      type: 'function',
      group: 'functions',
      functionId: fnB.id,
      version: '2.0.0',
    })
  })

  it('leaves version undefined when the summary has no latest_version', () => {
    const fn = makeFn({ latest_version: undefined })
    const rows = buildFunctionRows([fn])
    const item = rows.find((i) => i.functionId === fn.id)
    expect(item).toBeDefined()
    expect(item?.version).toBeUndefined()
  })

  it('produces no rows for an empty page', () => {
    expect(buildFunctionRows([])).toHaveLength(0)
  })

  it('never contributes a plugin, control or creator row', () => {
    const rows = buildFunctionRows([makeFn()])
    expect(rows.every((i) => i.type === 'function')).toBe(true)
  })

  it('colors every function row with the function block color', () => {
    const rows = buildFunctionRows([
      makeFn(),
      makeFn({ id: '00000000-0000-0000-0000-000000000002', name: 'send_report' }),
    ])
    expect(FUNCTION_COLOR_CLASS).toBe('text-emerald-500')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.colorClass, row.name).toBe(FUNCTION_COLOR_CLASS)
    }
  })
})

describe('QUICK_ADD_BUILTINS - New Function creator row', () => {
  it('always contains exactly one new-function row', () => {
    const rows = QUICK_ADD_BUILTINS.filter(
      (i: QuickAddItem) => i.type === 'new-function',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'new-function',
      name: 'New Function',
      type: 'new-function',
      group: 'functions',
    })
  })

  it('colors the new-function row with the function block color', () => {
    const row = QUICK_ADD_BUILTINS.find((i: QuickAddItem) => i.type === 'new-function')
    expect(FUNCTION_COLOR_CLASS).toBe('text-emerald-500')
    expect(row?.colorClass).toBe(FUNCTION_COLOR_CLASS)
  })

  it('places the new-function row last among the built-ins', () => {
    expect(QUICK_ADD_BUILTINS[QUICK_ADD_BUILTINS.length - 1].type).toBe(
      'new-function',
    )
  })
})

describe('QUICK_ADD_BUILTINS - grouping and totals', () => {
  it('orders the built-ins plugins, then controls, then the creator row', () => {
    const groups = QUICK_ADD_BUILTINS.map((i: QuickAddItem) => i.group)
    const lastPlugin = groups.lastIndexOf('plugins')
    const firstControl = groups.indexOf('controls')
    const lastControl = groups.lastIndexOf('controls')
    const firstFunction = groups.indexOf('functions')
    expect(lastPlugin).toBeGreaterThanOrEqual(0)
    expect(lastPlugin).toBeLessThan(firstControl)
    expect(lastControl).toBeLessThan(firstFunction)
  })

  it('has one built-in per plugin and control, plus the creator row', () => {
    expect(QUICK_ADD_BUILTINS).toHaveLength(
      ALL_PLUGINS.length + CONTROL_DEFINITIONS.length + 1,
    )
  })

  it('has one function row per summary', () => {
    const fns = [
      makeFn(),
      makeFn({ id: '00000000-0000-0000-0000-000000000003', name: 'other_fn' }),
    ]
    expect(buildFunctionRows(fns)).toHaveLength(fns.length)
  })

  it('produces unique ids across built-ins and function rows', () => {
    const ids = [
      ...QUICK_ADD_BUILTINS.map((i: QuickAddItem) => i.id),
      ...buildFunctionRows([makeFn()]).map((i) => i.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('hands back the same array and rows however often it is read', () => {
    // A constant, not a builder: the popover's built-in rows never re-render
    // because their identity changed.
    const first = QUICK_ADD_BUILTINS
    expect(buildFunctionRows([makeFn()])).toHaveLength(1)
    expect(QUICK_ADD_BUILTINS).toBe(first)
    expect(QUICK_ADD_BUILTINS[0]).toBe(first[0])
  })
})
