/**
 * useEntryChange - the questions a list or map editor asks before a type change or an {x} switch drops a
 * value; a host's own empty entry counts as nothing held (FIELD-7, FIELD-13).
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntryChangeQuestions, useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'
import type { VariableType } from '@/lib/variable-types'

describe('useEntryChange - a host with its own empty entry', () => {
  const hostEmpty = () => ({ stat: 'count' })

  it('changes the type at once when the entry still holds the host empty entry', () => {
    const { result } = renderHook(() => useEntryChange(hostEmpty))
    const apply = vi.fn()
    act(() => result.current.requestType('map', 'string', { stat: 'count' }, apply))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(result.current.typeAsk).toBeNull()
  })

  it('asks before a type change drops anything else', () => {
    const { result } = renderHook(() => useEntryChange(hostEmpty))
    const apply = vi.fn()
    act(() => result.current.requestType('map', 'string', { stat: 'sum', field: 'latency_ms' }, apply))
    expect(apply).not.toHaveBeenCalled()
    expect(result.current.typeAsk).toMatchObject({ prev: 'map', next: 'string', count: 2 })
  })
})

describe('useEntryChange - a host with no empty entry of its own', () => {
  it('changes the type at once while the entry holds its type default', () => {
    const { result } = renderHook(() => useEntryChange())
    const apply = vi.fn()
    act(() => result.current.requestType('string', 'integer', '', apply))
    expect(apply).toHaveBeenCalledTimes(1)
  })
})

// A Setter row typed Table asks the shared question before a type change drops its rows (REQ-3.4.1.14, REQ-3.1.3.21).
describe('useEntryChange - a table value', () => {
  const TABLE: VariableType = 'table'
  const STRING: VariableType = 'string'
  const ROW_OBJECTS = [
    { host: 'db-1', port: 5432 },
    { host: 'db-2', port: 5433 },
  ]

  it('asks before a type change drops the rows of a table', () => {
    const { result } = renderHook(() => useEntryChange())
    const apply = vi.fn()
    act(() => result.current.requestType(TABLE, STRING, ROW_OBJECTS, apply))
    expect(apply).not.toHaveBeenCalled()
    expect(result.current.typeAsk).toMatchObject({ prev: 'table', next: 'string', count: 2 })
  })

  it('names the rows it clears in the shared question, and changes the type only on Change type', async () => {
    const user = userEvent.setup()
    const apply = vi.fn()
    render(<TableTypeChange value={ROW_OBJECTS} apply={apply} />)
    await user.click(screen.getByRole('button', { name: 'Make it text' }))

    expect(screen.getByText(/^Change variable type\?$/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Changing type to string will clear 2 existing table entries\. This cannot be undone\.$/),
    ).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('changes the type of an empty table at once', () => {
    const { result } = renderHook(() => useEntryChange())
    const apply = vi.fn()
    act(() => result.current.requestType(TABLE, STRING, [], apply))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(result.current.typeAsk).toBeNull()
  })

  it('changes the type of a table with columns and no rows at once', () => {
    const { result } = renderHook(() => useEntryChange())
    const apply = vi.fn()
    const noRows = { columns: [{ name: 'host', type: 'string' }], rows: [] }
    act(() => result.current.requestType(TABLE, STRING, noRows, apply))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(result.current.typeAsk).toBeNull()
  })
})

/** A Setter row's Type change on a table value, through the shared question. */
function TableTypeChange({ value, apply }: Readonly<{ value: unknown; apply: () => void }>) {
  const change = useEntryChange()
  const table: VariableType = 'table'
  const text: VariableType = 'string'
  return (
    <>
      <button type="button" onClick={() => change.requestType(table, text, value, apply)}>
        Make it text
      </button>
      <EntryChangeQuestions change={change} subject="variable" />
    </>
  )
}
