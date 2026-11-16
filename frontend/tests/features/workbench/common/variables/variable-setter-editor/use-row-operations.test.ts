/**
 * Tests for `useRowOperations`: name, type, secret and delete changes written to the
 * Block's shared slots in one `onSlotsChange`, the row checks reported through
 * `onValidChange`, and the name suggestions.
 *
 * `getFilteredSuggestions` exclusion rules: Function inputs are read-only
 * references and must not appear as settable-name suggestions, while
 * Function outputs and plain variables remain selectable (VARSET-3).
 *
 * REQ-3.4.1.14, REQ-3.4.3.8, REQ-3.1.3.19
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useRowOperations } from '@/features/workbench/common/variables/variable-setter-editor/use-row-operations'
import type {
  VariableRow,
  AvailableVariable,
} from '@/features/workbench/common/variables/variable-setter-editor/types'

/** The Setter's shared slots as the hook writes them. */
interface Slots {
  variables: Record<string, unknown>
  expressionFields: string[]
  templateFields: string[]
  elementTypes: Record<string, unknown>
  secretFields: string[]
  rowTypes: Record<string, string>
}

type HookOptions = Parameters<typeof useRowOperations>[2]

function setup(
  rows: VariableRow[],
  availableVariables: AvailableVariable[],
) {
  const setRows = vi.fn()
  const onSlotsChange = vi.fn<(next: Slots) => void>()
  const onValidChange = vi.fn<(valid: boolean) => void>()
  const view = renderHook(() =>
    useRowOperations(rows, setRows, {
      availableVariables,
      onSlotsChange,
      onValidChange,
    } as unknown as HookOptions),
  )
  /** What the hook last wrote. */
  const lastSlots = (): Slots => {
    const call = onSlotsChange.mock.lastCall
    if (!call) throw new Error('onSlotsChange was never called')
    return call[0]
  }
  /** The rows the hook last handed to setRows. */
  const lastRows = (): VariableRow[] => (setRows.mock.lastCall as [VariableRow[]])[0]
  return { ...view, setRows, onSlotsChange, onValidChange, lastSlots, lastRows }
}

describe('useRowOperations - getFilteredSuggestions', () => {
  it('excludes Function input variables but keeps outputs and plain vars', () => {
    const available: AvailableVariable[] = [
      { name: 'in_arg', type: 'string', source: 'Function input' },
      { name: 'out_arg', type: 'string', source: 'Function output' },
      { name: 'plain', type: 'string' },
    ]
    const rows: VariableRow[] = [
      { key: 'row-a', name: '', value: '', type: 'string', isExpression: false },
    ]

    const { result } = setup(rows, available)
    const names = result.current
      .getFilteredSuggestions('', 0)
      .map((v) => v.name)

    expect(names).not.toContain('in_arg')
    expect(names).toContain('out_arg')
    expect(names).toContain('plain')
  })
})

describe('useRowOperations - a type change on a row holding nothing', () => {
  // The new type's default (VARSET-5, VARSET-9).
  it.each([
    ['string', 'integer', ''],
    ['integer', 'string', 0],
    ['float', 'string', 0],
    ['boolean', 'string', false],
    ['array', 'string', []],
    ['map', 'string', {}],
    ['table', 'string', []],
  ] as const)('starts the row on the %s type default at once', (newType, oldType, typeDefault) => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: 'x', value: null, type: oldType, isExpression: false }],
      [],
    )

    act(() => result.current.handleTypeChange(0, newType))

    expect(lastSlots().variables).toStrictEqual({ x: typeDefault })
    expect(lastSlots().rowTypes.x).toBe(newType)
    expect(lastRows()[0].type).toBe(newType)
    expect(lastRows()[0].value).toStrictEqual(typeDefault)
  })

  it('drops the Template mark and the entry types with the old type', () => {
    const { result, lastSlots } = setup(
      [{ key: 'row-a', name: 'x', value: null, type: 'string', isExpression: false, isTemplate: true }],
      [],
    )

    act(() => result.current.handleTypeChange(0, 'integer'))

    expect(lastSlots().templateFields).toEqual([])
    expect(lastSlots().elementTypes).toEqual({})
  })

  it('clears a ticked Secret when the type becomes Boolean', () => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: 'flag', value: null, type: 'string', isExpression: false, isSecret: true }],
      [],
    )

    act(() => result.current.handleTypeChange(0, 'boolean'))

    expect(lastSlots().secretFields).toEqual([])
    expect(lastSlots().variables).toStrictEqual({ flag: false })
    expect(lastRows()[0].isSecret).toBe(false)
  })
})

// An {x} row is kept as written on another type, so no value is lost and nothing is asked (VARSET-9).
describe('useRowOperations - a type change on an {x} row', () => {
  it('retypes the row at once, keeping its expression and its {x} mark', () => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: 'next_try', value: 'attempt + 1', type: 'string', isExpression: true }],
      [],
    )

    act(() => result.current.handleTypeChange(0, 'integer'))

    expect(result.current.entryChange.typeAsk).toBeNull()
    expect(lastRows()[0]).toMatchObject({ type: 'integer', value: 'attempt + 1', isExpression: true })
    expect(lastSlots().variables).toStrictEqual({ next_try: 'attempt + 1' })
    expect(lastSlots().expressionFields).toEqual(['variables.next_try'])
    expect(lastSlots().rowTypes).toEqual({ next_try: 'integer' })
  })

  it('takes the declared type of an existing variable on a rename at once, keeping the expression', () => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: 'next_try', value: 'attempt + 1', type: 'string', isExpression: true }],
      [{ name: 'retries', type: 'integer' }],
    )

    act(() => result.current.handleNameChange(0, 'retries'))

    expect(result.current.entryChange.typeAsk).toBeNull()
    expect(lastRows()[0]).toMatchObject({ name: 'retries', type: 'integer', value: 'attempt + 1', isExpression: true })
    expect(lastSlots().variables).toStrictEqual({ retries: 'attempt + 1' })
    expect(lastSlots().expressionFields).toEqual(['variables.retries'])
    expect(lastSlots().rowTypes).toEqual({ retries: 'integer' })
  })
})

describe('useRowOperations - a name change', () => {
  it('takes the declared type of an existing variable and starts the row on its type default', () => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: '', value: null, type: 'string', isExpression: false }],
      [{ name: 'timeout', type: 'integer' }],
    )

    act(() => result.current.handleNameChange(0, 'timeout'))

    expect(lastRows()[0].type).toBe('integer')
    expect(lastRows()[0].value).toBe(0)
    expect(lastSlots().variables).toStrictEqual({ timeout: 0 })
    expect(lastSlots().elementTypes).toEqual({})
  })

  it('keeps the value and flags of a row renamed to a new target', () => {
    const { result, lastSlots } = setup(
      [{ key: 'row-a', name: 'old_name', value: 'a + 1', type: 'string', isExpression: true }],
      [],
    )

    act(() => result.current.handleNameChange(0, 'new_name'))

    expect(lastSlots().variables).toStrictEqual({ new_name: 'a + 1' })
    expect(lastSlots().expressionFields).toEqual(['variables.new_name'])
  })

  it('leaves a row out of the slots once its name is cleared', () => {
    const { result, lastSlots } = setup(
      [{ key: 'row-a', name: 'x', value: 'hello', type: 'string', isExpression: false, isSecret: true }],
      [],
    )

    act(() => result.current.handleNameChange(0, ''))

    expect(lastSlots().variables).toStrictEqual({})
    expect(lastSlots().secretFields).toEqual([])
  })
})

describe('useRowOperations - the secret mark', () => {
  it('writes the row secret mark in one slot change', () => {
    const { result, onSlotsChange, lastSlots } = setup(
      [{ key: 'row-a', name: 'token', value: 'x', type: 'string', isExpression: false }],
      [],
    )

    act(() => result.current.handleSecretToggle(0))

    expect(onSlotsChange).toHaveBeenCalledTimes(1)
    expect(lastSlots().secretFields).toEqual(['variables.token'])
    expect(lastSlots().variables).toStrictEqual({ token: 'x' })
  })

  it('removes the row secret mark when it is toggled off', () => {
    const { result, lastSlots } = setup(
      [{ key: 'row-a', name: 'token', value: 'x', type: 'string', isExpression: false, isSecret: true }],
      [],
    )

    act(() => result.current.handleSecretToggle(0))

    expect(lastSlots().secretFields).toEqual([])
  })
})

describe('useRowOperations - delete', () => {
  it("drops the deleted row's value and every flag it held", () => {
    const { result, lastSlots } = setup(
      [
        {
          key: 'row-a',
          name: 'hosts',
          value: ['web-1', 'backup_host'],
          type: 'array',
          isExpression: false,
          isSecret: true,
          entryExpressions: ['1'],
          elementTypes: ['string', 'string'],
        } as VariableRow,
        { key: 'row-b', name: 'next', value: 'a + 1', type: 'string', isExpression: true },
      ],
      [],
    )

    act(() => result.current.handleDelete(0))

    expect(lastSlots().variables).toStrictEqual({ next: 'a + 1' })
    expect(lastSlots().expressionFields).toEqual(['variables.next'])
    expect(lastSlots().secretFields).toEqual([])
    expect(lastSlots().elementTypes).toEqual({})
  })

  it('keeps one empty row on null when the last row goes', () => {
    const { result, lastSlots, lastRows } = setup(
      [{ key: 'row-a', name: 'solo', value: 'v', type: 'string', isExpression: false }],
      [],
    )

    act(() => result.current.handleDelete(0))

    expect(lastSlots().variables).toStrictEqual({})
    expect(lastRows()).toHaveLength(1)
    expect(lastRows()[0].name).toBe('')
    expect(lastRows()[0].value).toBeNull()
  })
})

describe('useRowOperations - the row checks', () => {
  it('reports a nameless row as invalid', () => {
    const { result, onValidChange } = setup([], [])

    act(() =>
      result.current.revalidate([{ key: 'row-a', name: '', value: null, type: 'string', isExpression: false }]),
    )

    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('reports a blank {x} row as invalid and a filled one as valid', () => {
    const { result, onValidChange } = setup([], [])

    act(() =>
      result.current.revalidate([{ key: 'row-a', name: 'next', value: '', type: 'string', isExpression: true }]),
    )
    expect(onValidChange).toHaveBeenLastCalledWith(false)

    act(() =>
      result.current.revalidate([{ key: 'row-a', name: 'next', value: 'a + 1', type: 'string', isExpression: true }]),
    )
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('reports a list row holding a blank {x} entry as invalid', () => {
    const { result, onValidChange } = setup([], [])

    act(() =>
      result.current.revalidate([
        {
          key: 'row-a',
          name: 'hosts',
          value: ['web-1', ''],
          type: 'array',
          isExpression: false,
          entryExpressions: ['1'],
        } as VariableRow,
      ]),
    )

    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('reports a row naming a Function input as invalid', () => {
    const { result, onValidChange } = setup([], [{ name: 'x', type: 'string', source: 'Function input' }])

    act(() =>
      result.current.revalidate([{ key: 'row-a', name: 'x', value: 'hello', type: 'string', isExpression: false }]),
    )

    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })
})

describe('useRowOperations - the delayed suggestion close after a name blur', () => {
  it('leaves no timer behind once the editor unmounts', () => {
    vi.useFakeTimers()
    try {
      const rows: VariableRow[] = [
        { key: 'row-a', name: 'x', value: '', type: 'string', isExpression: false },
      ]
      const { result, unmount } = setup(rows, [])

      act(() => result.current.handleNameBlur(0))
      expect(vi.getTimerCount()).toBe(1)
      unmount()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one pending close when the name loses focus twice', () => {
    vi.useFakeTimers()
    try {
      const rows: VariableRow[] = [
        { key: 'row-a', name: 'x', value: '', type: 'string', isExpression: false },
      ]
      const { result } = setup(rows, [])

      act(() => result.current.handleNameBlur(0))
      act(() => result.current.handleNameBlur(0))

      expect(vi.getTimerCount()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
