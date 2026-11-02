/**
 * useConfigModal - a Function Block's field list comes from its contract: a Shared Block's pinned
 * `resolvedInputs` / `resolvedOutputs` (or its edit-mode draft), a Local Block's `localDefinition`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

function withReactFlow({ children }: { children: ReactNode }) {
  return createElement(ReactFlowProvider, null, children)
}

interface MockNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: Record<string, unknown>
}

const mockStore = {
  nodes: [] as MockNode[],
  edges: [] as Array<Record<string, unknown>>,
  configModalNodeId: null as string | null,
  closeConfigModal: () => {},
  updateNode: () => {},
  setEdges: () => {},
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string }>,
  addVariable: () => {},
  clearPulseValidationNodeId: () => {},
  transaction: (cb: () => void) => cb(),
  drillPath: [] as Array<{ nodeId: string; label: string }>,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}))

import { useConfigModal } from '@/features/workbench/common/canvas/workflow-canvas/use-config-modal'

const INPUTS = [{ name: 'x', type: 'string', required: true }]
const OUTPUTS = [{ name: 'result', type: 'string' }]


beforeEach(() => {
  mockStore.nodes = []
  mockStore.edges = []
  mockStore.variables = []
  mockStore.drillPath = []
  mockStore.configModalNodeId = null
})


describe('useConfigModal - shared (published) Function instance', () => {
  it('populates inputs/outputs from resolvedInputs/resolvedOutputs', () => {
    mockStore.nodes = [
      {
        id: 'fn-shared',
        type: 'workflowNode',
        data: {
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '1.0.0',
          resolvedInputs: INPUTS,
          resolvedOutputs: OUTPUTS,
          // No localDefinition - this is a published instance.
        },
      },
    ]
    mockStore.configModalNodeId = 'fn-shared'

    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as {
      parameters: unknown[]
      outputs: unknown[]
    }
    expect(element.parameters).toEqual(INPUTS.map((input) => expect.objectContaining(input)))
    expect(element.outputs).toEqual(OUTPUTS.map((output) => expect.objectContaining(output)))
  })

  it('populates params for an edit-mode shared instance from its draft contract', () => {
    mockStore.nodes = [
      {
        id: 'fn-edit',
        type: 'workflowNode',
        data: {
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '1.0.0',
          editMode: true,
          resolvedInputs: INPUTS,
          resolvedOutputs: OUTPUTS,
        },
      },
    ]
    mockStore.configModalNodeId = 'fn-edit'

    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as {
      parameters: unknown[]
      outputs: unknown[]
    }
    expect(element.parameters).toEqual(INPUTS.map((input) => expect.objectContaining(input)))
    expect(element.outputs).toEqual(OUTPUTS.map((output) => expect.objectContaining(output)))
  })
})


describe('useConfigModal - local Function instance (regression guard)', () => {
  it('still reads inputs/outputs from localDefinition for a local instance', () => {
    mockStore.nodes = [
      {
        id: 'fn-local',
        type: 'workflowNode',
        data: {
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: { name: 'helper', inputs: INPUTS, outputs: OUTPUTS },
        },
      },
    ]
    mockStore.configModalNodeId = 'fn-local'

    const { result } = renderHook(() => useConfigModal(mockStore.configModalNodeId), { wrapper: withReactFlow })
    const element = result.current.configModalElement as {
      parameters: unknown[]
      outputs: unknown[]
    }
    expect(element.parameters).toEqual(INPUTS.map((input) => expect.objectContaining(input)))
    expect(element.outputs).toEqual(OUTPUTS.map((output) => expect.objectContaining(output)))
  })
})
