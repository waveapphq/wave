/**
 * computeNodeIssues: a failing Block inside a Function flow lights every enclosing Function (REQ-3.1.2.4).
 */

import { describe, it, expect } from 'vitest'

import { computeNodeIssues } from '@/features/workbench/lib/validation/compute-node-issues'

interface AnyNode {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** A Log body node with no `message` value -> REQUIRED_PARAM_MISSING leaf. */
function failingLog(id = 'leaf-log'): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      label: id,
      config: { values: { level: 'INFO' }, outputBindings: {} },
    },
  }
}

/** A clean Log body node (message present). */
function cleanLog(id = 'leaf-log'): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      label: id,
      config: { values: { message: '"hi"', level: 'INFO' }, outputBindings: {} },
    },
  }
}

/** A Local Function instance with NO declared inputs (so it has no own binding
 *  issue) wrapping the given body nodes. */
function localFn(id: string, body: AnyNode[]): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'function',
      nodeType: 'function',
      version: '1.0.0',
      label: id,
      functionLifecycle: 'local',
      localDefinition: {
        inputs: [],
        outputs: [],
        variables: {},
        workflow: { nodes: body, edges: [] },
      },
      config: { values: {}, outputBindings: {} },
    },
  }
}

function hasAlert(result: Map<string, unknown[]>, id: string): boolean {
  const issues = result.get(id)
  return Array.isArray(issues) && issues.length > 0
}

describe('computeNodeIssues - ancestor alert propagation', () => {
  it('flags the enclosing Function when its body has a failing leaf', () => {
    const outer = localFn('outer-1', [failingLog()])
    const result = computeNodeIssues([outer], [])
    expect(hasAlert(result, 'outer-1')).toBe(true)
  })

  it('keeps the failing leaf own alert as well as the ancestor alert', () => {
    const outer = localFn('outer-1', [failingLog('leaf-log')])
    const result = computeNodeIssues([outer], [])
    expect(hasAlert(result, 'leaf-log')).toBe(true)
    expect(hasAlert(result, 'outer-1')).toBe(true)
  })

  it('propagates the alert to every ancestor across two nesting levels', () => {
    const inner = localFn('inner-1', [failingLog('leaf-log')])
    const outer = localFn('outer-1', [inner])
    const result = computeNodeIssues([outer], [])
    expect(hasAlert(result, 'outer-1')).toBe(true)
    expect(hasAlert(result, 'inner-1')).toBe(true)
    expect(hasAlert(result, 'leaf-log')).toBe(true)
  })

  it('does not flag a Function whose body is clean', () => {
    const outer = localFn('outer-1', [cleanLog()])
    const result = computeNodeIssues([outer], [])
    expect(hasAlert(result, 'outer-1')).toBe(false)
  })

  it('does not flag an outer Function when only a sibling subtree fails', () => {
    const failing = localFn('branch-bad', [failingLog('bad-leaf')])
    const clean = localFn('branch-ok', [cleanLog('ok-leaf')])
    const result = computeNodeIssues([failing, clean], [])
    expect(hasAlert(result, 'branch-bad')).toBe(true)
    expect(hasAlert(result, 'branch-ok')).toBe(false)
  })

  it('merges the ancestor alert with the Function Block own required-input issue', () => {
    const fn: AnyNode = {
      id: 'fn-both',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'function',
        nodeType: 'function',
        version: '1.0.0',
        label: 'fn-both',
        functionLifecycle: 'local',
        localDefinition: {
          inputs: [{ name: 'x', type: 'string', required: true }],
          outputs: [],
          variables: {},
          workflow: { nodes: [failingLog('bad-leaf')], edges: [] },
        },
        config: { values: {}, outputBindings: {} },
      },
    }
    const result = computeNodeIssues([fn], [])
    const issues = result.get('fn-both') ?? []
    expect(issues.some((i) => (i as { code: string }).code === 'REQUIRED_PARAM_MISSING')).toBe(true)
    expect(
      issues.some((i) => (i as { code: string }).code === 'CONTAINS_INVALID_DESCENDANT'),
    ).toBe(true)
  })
})

/** A Local Function Block declaring the given inputs, holding `values`, wrapping `body`. */
function localFnWith(
  id: string,
  inputs: Array<Record<string, unknown>>,
  values: Record<string, unknown>,
  body: AnyNode[] = [],
): AnyNode {
  const fn = localFn(id, body)
  const definition = fn.data.localDefinition as Record<string, unknown>
  fn.data.localDefinition = { ...definition, inputs }
  fn.data.config = { values, outputBindings: {} }
  return fn
}

/** A Shared Function Block pinned to `functionVersion`, its contract stamped on the Block. */
function sharedFn(id: string, data: Record<string, unknown>): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'function',
      nodeType: 'function',
      version: '1.0.0',
      label: id,
      functionLifecycle: 'shared',
      functionId: 'lib-1',
      functionVersion: '1.0.0',
      resolvedInputs: [],
      resolvedOutputs: [],
      config: { values: {}, outputBindings: {} },
      ...data,
    },
  }
}

const REQUIRED_WHO = { name: 'who', type: 'string', required: true, description: '' }

const MISSING_WHO = {
  code: 'REQUIRED_PARAM_MISSING',
  severity: 'error',
  paramName: 'who',
  message: "Required parameter 'who' is missing",
}

const DESCENDANT_ALERT = {
  code: 'CONTAINS_INVALID_DESCENDANT',
  severity: 'error',
  message: 'This Function contains a block with validation issues',
}

describe('computeNodeIssues - a Function Block nested in a Function flow has the badges it has at the root', () => {
  it('names a Required input a nested Local Function Block leaves without a value', () => {
    const nested = localFnWith('inner-fn', [REQUIRED_WHO], {})
    const result = computeNodeIssues([localFn('outer-1', [nested])], [])

    expect(result.get('inner-fn')).toEqual([MISSING_WHO])
    expect(result.get('outer-1')).toEqual([DESCENDANT_ALERT])
  })

  it('badges only the nested Block that misses the value, never a sibling that holds one or is muted', () => {
    const missing = localFnWith('inner-missing', [REQUIRED_WHO], {})
    const given = localFnWith('inner-given', [REQUIRED_WHO], { who: 'ann' })
    const muted = localFnWith('inner-muted', [REQUIRED_WHO], {})
    muted.data.disabled = true
    const result = computeNodeIssues([localFn('outer-1', [missing, given, muted])], [])

    expect(result.get('inner-missing')).toEqual([MISSING_WHO])
    expect(hasAlert(result, 'inner-given')).toBe(false)
    expect(hasAlert(result, 'inner-muted')).toBe(false)
  })

  it('checks a nested Shared Function Block against its pinned contract', () => {
    const nested = sharedFn('inner-shared', { resolvedInputs: [REQUIRED_WHO] })
    const result = computeNodeIssues([localFn('outer-1', [nested])], [])

    expect(result.get('inner-shared')).toEqual([MISSING_WHO])
    expect(result.get('outer-1')).toEqual([DESCENDANT_ALERT])
  })

  it('flags a nested Shared Function Block pinned to a version the library no longer has', () => {
    const nested = sharedFn('inner-shared', { functionVersion: '9.9.9', missingVersion: true })
    const result = computeNodeIssues([localFn('outer-1', [nested])], [])

    expect(result.get('inner-shared')).toEqual([
      {
        code: 'MISSING_FUNCTION_VERSION',
        severity: 'error',
        message: 'Pinned version 9.9.9 is no longer available in the library',
      },
    ])
    expect(result.get('outer-1')).toEqual([DESCENDANT_ALERT])
  })

  it('badges a Function Block two levels down and lights every enclosing Function', () => {
    const deepest = localFnWith('deep-fn', [REQUIRED_WHO], {})
    const middle = localFn('middle-1', [deepest])
    const result = computeNodeIssues([localFn('outer-1', [middle])], [])

    expect(result.get('deep-fn')).toEqual([MISSING_WHO])
    expect(result.get('middle-1')).toEqual([DESCENDANT_ALERT])
    expect(result.get('outer-1')).toEqual([DESCENDANT_ALERT])
  })
})
