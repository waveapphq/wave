/**
 * Tests for `useRowOperations` autocomplete filtering.
 *
 * Focused on `getFilteredSuggestions` exclusion rules: Function inputs are
 * read-only references and must not appear as settable-name suggestions, while
 * Function outputs and plain variables remain selectable.
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useRowOperations } from '@/features/workbench/common/variables/variable-setter-editor/use-row-operations'
import type {
  VariableRow,
  AvailableVariable,
} from '@/features/workbench/common/variables/variable-setter-editor/types'

function setup(
  rows: VariableRow[],
  availableVariables: AvailableVariable[],
) {
  const setRows = vi.fn()
  return renderHook(() =>
    useRowOperations(rows, setRows, {
      availableVariables,
      onVariablesChange: vi.fn(),
      onExpressionKeysChange: vi.fn(),
      onTemplateKeysChange: vi.fn(),
      onSecretKeysChange: vi.fn(),
      onTypesChange: vi.fn(),
      onValidChange: vi.fn(),
    }),
  )
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

describe('useRowOperations - a type switch presets the type default', () => {
  function setupTypeSwitch(row: VariableRow) {
    const setRows = vi.fn()
    const onVariablesChange = vi.fn()
    const { result } = renderHook(() =>
      useRowOperations([row], setRows, {
        availableVariables: [],
        onVariablesChange,
        onExpressionKeysChange: vi.fn(),
        onTemplateKeysChange: vi.fn(),
        onSecretKeysChange: vi.fn(),
        onTypesChange: vi.fn(),
        onValidChange: vi.fn(),
      }),
    )
    return { result, setRows, onVariablesChange }
  }

  it.each([
    ['string', 'integer', '5', ''],
    ['integer', 'string', 'abc', 0],
    ['float', 'string', 'abc', 0],
    ['boolean', 'string', 'abc', false],
    ['array', 'string', 'abc', []],
    ['map', 'string', 'abc', {}],
    ['table', 'string', 'abc', []],
  ] as const)('presets %s to its default', (newType, oldType, oldValue, typeDefault) => {
    const { result, setRows, onVariablesChange } = setupTypeSwitch({
      key: 'row-a',
      name: 'x',
      value: oldValue,
      type: oldType,
      isExpression: false,
    })

    act(() => result.current.handleTypeChange(0, newType))

    expect(onVariablesChange).toHaveBeenLastCalledWith({ x: typeDefault })
    const [updatedRows] = setRows.mock.lastCall as [VariableRow[]]
    expect(updatedRows[0].type).toBe(newType)
    expect(updatedRows[0].value).toStrictEqual(typeDefault)
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
