import { describe, it, expect } from 'vitest'
import { mapToRows, rowsToMap } from '@/features/settings/components/global-variables-tab/helpers'
import type { VariableRow } from '@/lib/variable-types'
import type { SystemVariablesMap } from '@/features/settings/api/global-variables/types'

/**
 * Tests for the system variables tab helpers.
 *
 * mapToRows and rowsToMap are thin wrappers around shared recordToRows/rowsToRecord.
 * These tests verify the system-var-specific behavior: masked flag handling.
 */

describe('mapToRows', () => {
  it('returns an empty array for an empty map', () => {
    const result = mapToRows({})
    expect(result).toEqual([])
  })

  it('converts a string variable to a row', () => {
    const variables: SystemVariablesMap = {
      greeting: { type: 'string', value: 'hello', secret: false },
    }
    const rows = mapToRows(variables)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'greeting',
      type: 'string',
      secret: false,
      value: 'hello',
    })
    expect(rows[0].id).toBeTruthy()
  })

  it('converts multiple variables preserving order', () => {
    const variables: SystemVariablesMap = {
      alpha: { type: 'string', value: 'a', secret: false },
      beta: { type: 'integer', value: '2', secret: false },
    }
    const rows = mapToRows(variables)

    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('alpha')
    expect(rows[1].name).toBe('beta')
  })

  it('marks secret variables with secret: true', () => {
    const variables: SystemVariablesMap = {
      apiKey: { type: 'string', value: 'sk-123', secret: true },
    }
    const rows = mapToRows(variables)

    expect(rows[0].secret).toBe(true)
    expect(rows[0].value).toBe('sk-123')
  })

  it('keeps the masked placeholder for masked secrets (so the cell masks write-only)', () => {
    // Issue 3: clearing the value made the edit cell show "Edit…" instead of
    // the locked/masked affordance; the placeholder is kept (parity with the
    // suite / regression editors) and the save path restores the stored value.
    const variables: SystemVariablesMap = {
      password: { type: 'string', value: '********', secret: true, masked: true },
    }
    const rows = mapToRows(variables)

    expect(rows[0]).toMatchObject({
      name: 'password',
      secret: true,
      value: '********',
    })
  })

  it('preserves value for non-masked secrets', () => {
    const variables: SystemVariablesMap = {
      token: { type: 'string', value: 'abc123', secret: true },
    }
    const rows = mapToRows(variables)

    expect(rows[0].value).toBe('abc123')
  })
})

describe('rowsToMap', () => {
  it('returns an empty map for empty rows', () => {
    const result = rowsToMap([])
    expect(result).toEqual({})
  })

  it('converts rows to map', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'host', type: 'string', secret: false, value: 'localhost' },
      { id: '2', name: 'port', type: 'integer', secret: false, value: '8080' },
    ]
    const result = rowsToMap(rows)

    expect(Object.keys(result)).toHaveLength(2)
    expect(result.host).toEqual({ type: 'string', value: 'localhost', secret: false })
    expect(result.port).toEqual({ type: 'integer', value: '8080', secret: false })
  })

  it('skips rows with empty name', () => {
    const rows: VariableRow[] = [
      { id: '1', name: '', type: 'string', secret: false, value: 'skip' },
      { id: '2', name: '  ', type: 'string', secret: false, value: 'skip too' },
      { id: '3', name: 'keep', type: 'string', secret: false, value: 'yes' },
    ]
    const result = rowsToMap(rows)

    expect(Object.keys(result)).toHaveLength(1)
    expect(result.keep.value).toBe('yes')
  })

  it('preserves secret flag', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'key', type: 'string', secret: true, value: 'secret' },
    ]
    const result = rowsToMap(rows)

    expect(result.key.secret).toBe(true)
  })
})
