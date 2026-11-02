/**
 * Numeric bounds are checked only on a row the sheet actually shows, whichever
 * reveal gate the row declares (PING-17), and named by the row's label (FIELDERR-1).
 *
 * The shipped bounded rows all gate on `showWhen`, so `showWhenAny` and
 * `showWhenAll` are driven here against a stub schema.
 *
 * REQ-3.4.2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InputParam } from '@/features/workbench/lib/node-parameters/types'

const getInputParams = vi.fn()

vi.mock('@/features/workbench/lib/node-parameters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/node-parameters')>()),
  getInputParams: (...args: unknown[]) => getInputParams(...args),
  // The stub block declares no outputs; both schemas must resolve or the node is skipped.
  getOutputParams: () => [],
  // The one lookup by Block data reads the stub schema.
  blockInputParams: (data: { elementType?: string }) => getInputParams(data.elementType),
  blockOutputParams: () => [],
}))

import { computeNodeIssues } from '@/features/workbench/lib/validation/compute-node-issues'

const MODE = {
  name: 'mode',
  label: 'Mode',
  type: 'string' as const,
  required: false,
  enumValues: ['off', 'basic', 'full'],
  defaultValue: 'off',
}

const SCOPE = {
  name: 'scope',
  label: 'Scope',
  type: 'string' as const,
  required: false,
  enumValues: ['one', 'many'],
  defaultValue: 'one',
}

/** Bounded 1..10, revealed when Mode is basic OR full. */
const ANY_GATED = {
  name: 'retries',
  label: 'Retries',
  type: 'integer' as const,
  required: false,
  minimum: 1,
  maximum: 10,
  showWhenAny: [
    { field: 'mode', values: ['basic'] },
    { field: 'mode', values: ['full'] },
  ],
}

/** Bounded 1..10, revealed only when Mode is full AND Scope is many. */
const ALL_GATED = {
  name: 'depth',
  label: 'Depth',
  type: 'integer' as const,
  required: false,
  minimum: 1,
  maximum: 10,
  showWhenAll: [
    { field: 'mode', values: ['full'] },
    { field: 'scope', values: ['many'] },
  ],
}

const SCHEMA: InputParam[] = [MODE, SCOPE, ANY_GATED, ALL_GATED]

function rangeIssues(values: Record<string, unknown>): { paramName?: string; message: string }[] {
  const node = {
    id: 'stub-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'stub-block',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Stub',
      config: { values },
    },
  }
  const issues = computeNodeIssues([node], []).get('stub-1') ?? []
  return issues
    .filter((issue) => issue.code === 'NUMBER_RANGE')
    .map(({ paramName, message }) => ({ paramName, message }))
}

beforeEach(() => {
  vi.clearAllMocks()
  getInputParams.mockReturnValue(SCHEMA)
})

describe('a bounded row revealed by any of several conditions', () => {
  it('is left alone while none of them matches', () => {
    expect(rangeIssues({ mode: 'off', retries: 99 })).toEqual([])
  })

  it('is flagged once the first condition matches', () => {
    expect(rangeIssues({ mode: 'basic', retries: 99 })).toEqual([
      { paramName: 'retries', message: 'Retries must be between 1 and 10' },
    ])
  })

  it('is flagged once a later condition matches', () => {
    expect(rangeIssues({ mode: 'full', retries: 99 })).toEqual([
      { paramName: 'retries', message: 'Retries must be between 1 and 10' },
    ])
  })

  it('stays quiet while the shown value is inside the range', () => {
    expect(rangeIssues({ mode: 'full', retries: 5 })).toEqual([])
  })
})

describe('a bounded row revealed only when every condition holds', () => {
  it('is left alone while neither condition holds', () => {
    expect(rangeIssues({ mode: 'off', scope: 'one', depth: 99 })).toEqual([])
  })

  it('is left alone while only one of them holds', () => {
    expect(rangeIssues({ mode: 'full', scope: 'one', depth: 99 })).toEqual([])
    expect(rangeIssues({ mode: 'off', scope: 'many', depth: 99 })).toEqual([])
  })

  it('is flagged once both hold', () => {
    expect(rangeIssues({ mode: 'full', scope: 'many', depth: 99 })).toEqual([
      { paramName: 'depth', message: 'Depth must be between 1 and 10' },
    ])
  })

  it('stays quiet while the shown value is inside the range', () => {
    expect(rangeIssues({ mode: 'full', scope: 'many', depth: 5 })).toEqual([])
  })
})
