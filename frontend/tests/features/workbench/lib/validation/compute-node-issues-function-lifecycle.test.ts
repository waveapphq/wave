/**
 * computeNodeIssues: a Function Block's own fields go through the one Block check, Local and Shared alike (REQ-3.1.2.4).
 */

import { describe, it, expect } from 'vitest'

import { computeNodeIssues, type NodeIssue } from '@/features/workbench/lib/validation/compute-node-issues'

type Nodes = Parameters<typeof computeNodeIssues>[0]

interface FunctionNodeFixture {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: Record<string, unknown>
}

const REQUIRED_X = { name: 'x', type: 'string', required: true, description: '' }

function localFunctionNode(overrides: Partial<Record<string, unknown>> = {}): FunctionNodeFixture {
  return {
    id: 'fn-local',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'function',
      nodeType: 'function',
      version: '1.0.0',
      label: 'Local Fn',
      functionLifecycle: 'local',
      localDefinition: {
        inputs: [REQUIRED_X],
        outputs: [],
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, outputBindings: {} },
      ...overrides,
    },
  }
}

function sharedFunctionNode(overrides: Partial<Record<string, unknown>> = {}): FunctionNodeFixture {
  return {
    id: 'fn-shared',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'function',
      nodeType: 'function',
      version: '1.0.0',
      label: 'Shared Fn',
      functionLifecycle: 'shared',
      functionId: '00000000-0000-0000-0000-000000000001',
      functionVersion: '1.0.0',
      // The pinned version's contract, stamped on the Block.
      resolvedInputs: [REQUIRED_X],
      config: { values: {}, outputBindings: {} },
      ...overrides,
    },
  }
}

function issuesOf(node: FunctionNodeFixture): NodeIssue[] {
  return computeNodeIssues([node] as unknown as Nodes, []).get(node.id) ?? []
}

function requiredIssues(node: FunctionNodeFixture): NodeIssue[] {
  return issuesOf(node).filter(
    (issue) => issue.code === 'REQUIRED_PARAM_MISSING' || issue.code === 'REQUIRED_PARAM_EMPTY',
  )
}

const MISSING_X: NodeIssue = {
  code: 'REQUIRED_PARAM_MISSING',
  severity: 'error',
  paramName: 'x',
  message: "Required parameter 'x' is missing",
}

describe('computeNodeIssues - a Local Function Block', () => {
  it('names a Required input that holds no value on the field it belongs to', () => {
    expect(issuesOf(localFunctionNode())).toEqual([MISSING_X])
  })

  it('raises nothing when the Required input holds a value in the stored field values', () => {
    const node = localFunctionNode({ config: { values: { x: 'hello' }, outputBindings: {} } })

    expect(requiredIssues(node)).toEqual([])
  })
})

describe('computeNodeIssues - a Shared Function Block', () => {
  it('names a Required input of the pinned contract that holds no value', () => {
    expect(issuesOf(sharedFunctionNode())).toEqual([MISSING_X])
  })

  it('raises nothing when the Required input holds a value in the stored field values', () => {
    const node = sharedFunctionNode({ config: { values: { x: 'hello' }, outputBindings: {} } })

    expect(requiredIssues(node)).toEqual([])
  })

  it('raises no required issue while the pinned contract is not stamped yet', () => {
    const node = sharedFunctionNode({ resolvedInputs: undefined })

    expect(requiredIssues(node)).toEqual([])
  })
})

describe('computeNodeIssues - lifecycle independence', () => {
  it('produces identical issue codes for Local and Shared Blocks with the same empty fields', () => {
    const localCodes = issuesOf(localFunctionNode()).map((i) => i.code).sort()
    const sharedCodes = issuesOf(sharedFunctionNode()).map((i) => i.code).sort()

    expect(localCodes).toEqual(sharedCodes)
  })

  it('skips Function Blocks with an unrecognized lifecycle (defensive)', () => {
    const node = localFunctionNode({ functionLifecycle: 'unknown' })

    expect(issuesOf(node)).toEqual([])
  })

  it('checks a Shared Block that carries only its inputs (no outputs stamp)', () => {
    const node = sharedFunctionNode({ resolvedOutputs: undefined })

    expect(issuesOf(node)).toEqual([MISSING_X])
  })

  it('raises no required issue for a Shared Block that carries only its outputs', () => {
    const node = sharedFunctionNode({
      resolvedInputs: undefined,
      resolvedOutputs: [{ name: 'r', type: 'string', description: '' }],
    })

    expect(requiredIssues(node)).toEqual([])
  })
})
