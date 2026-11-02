/**
 * HistoricalBlockStatesContext tests
 *
 * Covers the provider + hook pair used to inject painted-replay block
 * statuses into the shared canvas components without touching the
 * singleton execution store.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  HistoricalBlockStatesProvider,
  useHistoricalBlockStatuses,
  normalizeBackendStatus,
  buildHistoricalBlockStates,
} from '@/features/workbench/common/canvas/historical-block-states-context'

function Probe() {
  const value = useHistoricalBlockStatuses()
  return <div data-testid="probe">{value ? JSON.stringify(value) : 'null'}</div>
}

describe('HistoricalBlockStatesProvider', () => {
  it('provides the block-states map to descendants', () => {
    render(
      <HistoricalBlockStatesProvider blockStates={{ 'block-1': 'success' }}>
        <Probe />
      </HistoricalBlockStatesProvider>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('{"block-1":"success"}')
  })

  it('returns null when the hook is read outside the provider', () => {
    render(<Probe />)

    expect(screen.getByTestId('probe').textContent).toBe('null')
  })
})

describe('normalizeBackendStatus', () => {
  it('maps backend "passed" to the frontend "success" enum', () => {
    expect(normalizeBackendStatus('passed')).toBe('success')
    expect(normalizeBackendStatus('PASSED')).toBe('success')
  })

  it('passes matching statuses through unchanged after lowercasing', () => {
    expect(normalizeBackendStatus('failed')).toBe('failed')
    expect(normalizeBackendStatus('stopped')).toBe('stopped')
    expect(normalizeBackendStatus('skipped')).toBe('skipped')
    expect(normalizeBackendStatus('running')).toBe('running')
    expect(normalizeBackendStatus('pending')).toBe('pending')
    expect(normalizeBackendStatus('warning')).toBe('warning')
    expect(normalizeBackendStatus('success')).toBe('success')
  })

  it('returns undefined for unrecognized or empty values', () => {
    expect(normalizeBackendStatus('bogus')).toBeUndefined()
    expect(normalizeBackendStatus('')).toBeUndefined()
    expect(normalizeBackendStatus(null)).toBeUndefined()
    expect(normalizeBackendStatus(undefined)).toBeUndefined()
  })
})

describe('buildHistoricalBlockStates', () => {
  it('normalizes status tokens and drops unrecognized entries', () => {
    const result = buildHistoricalBlockStates({
      a: 'passed',
      b: 'failed',
      c: 'bogus',
      d: 'SKIPPED',
    })

    expect(result).toEqual({
      a: 'success',
      b: 'failed',
      d: 'skipped',
    })
  })

  it('returns an empty map for an empty input', () => {
    expect(buildHistoricalBlockStates({})).toEqual({})
  })
})
