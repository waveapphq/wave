/**
 * Branch coverage for the Run Scope dispatch selector.
 *
 * The selector maps the canvas drill stack to a dispatch mode. The
 * ``args.drillPath ?? []`` guard has an undefined-fallback side that the
 * component-level suite never exercises (it always passes a defined array),
 * so these focused cases flip every conditional in the module.
 */

import { describe, it, expect } from 'vitest'

import {
  selectAdHocFunctionPath,
  selectRunScopeDispatch,
  type DrillEntry,
} from '@/features/workbench/common/canvas/canvas-action-bar/run-scope-dispatch'

describe('selectRunScopeDispatch - drillPath nullish fallback', () => {
  it('falls back to "test" dispatch when drillPath is undefined', () => {
    const result = selectRunScopeDispatch({ drillPath: undefined })
    expect(result.mode).toBe('test')
    expect(result.scopedFunctionNodeId).toBeUndefined()
  })

  it('returns "test" dispatch for an explicitly empty drillPath', () => {
    const result = selectRunScopeDispatch({ drillPath: [] })
    expect(result.mode).toBe('test')
    expect(result.scopedFunctionNodeId).toBeUndefined()
  })

  it('returns "function" dispatch keyed to the leaf node id', () => {
    const drillPath: DrillEntry[] = [
      { nodeId: 'outer-fn', label: 'outer' },
      { nodeId: 'leaf-fn', label: 'leaf' },
    ]
    const result = selectRunScopeDispatch({ drillPath })
    expect(result.mode).toBe('function')
    expect(result.scopedFunctionNodeId).toBe('leaf-fn')
  })
})

describe('selectRunScopeDispatch - the path to a Function at any depth', () => {
  it('names the Functions the drilled Function sits inside, outermost first', () => {
    const drillPath: DrillEntry[] = [
      { nodeId: 'outer-fn', label: 'outer' },
      { nodeId: 'middle-fn', label: 'middle' },
      { nodeId: 'leaf-fn', label: 'leaf' },
    ]
    expect(selectRunScopeDispatch({ drillPath })).toEqual({
      mode: 'function',
      scopedFunctionNodeId: 'leaf-fn',
      functionPath: ['outer-fn', 'middle-fn'],
    })
  })

  it('sends an empty path for a Function on the Test canvas', () => {
    const drillPath: DrillEntry[] = [{ nodeId: 'top-fn', label: 'top' }]
    expect(selectRunScopeDispatch({ drillPath })).toEqual({
      mode: 'function',
      scopedFunctionNodeId: 'top-fn',
      functionPath: [],
    })
  })
})

describe('selectAdHocFunctionPath - a Block inside an opened Function body', () => {
  it('names every opened Function, outermost first', () => {
    const drillPath: DrillEntry[] = [
      { nodeId: 'outer-fn', label: 'outer' },
      { nodeId: 'leaf-fn', label: 'leaf' },
    ]
    expect(selectAdHocFunctionPath(drillPath)).toEqual({ functionPath: ['outer-fn', 'leaf-fn'] })
  })

  it('adds nothing on the Test canvas', () => {
    expect(selectAdHocFunctionPath([])).toEqual({})
    expect(selectAdHocFunctionPath(undefined)).toEqual({})
  })
})
