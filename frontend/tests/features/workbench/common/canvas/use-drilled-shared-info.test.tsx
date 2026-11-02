/**
 * Tests for `useDrilledSharedInfo` - resolves the deepest drilled-into Shared
 * Function instance (nodeId, editMode, sourceVersion) for the read-only chrome.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDrilledSharedInfo } from '@/features/workbench/common/canvas/use-readonly-canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type AnyNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }

function seed(nodes: AnyNode[], drillPath: { nodeId: string; label: string }[] = []) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: [] as unknown as never,
    variables: [] as unknown as never,
    drillPath,
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const shared = (id: string, data: Record<string, unknown> = {}): AnyNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label: id, nodeType: 'function', functionLifecycle: 'shared', functionId: 'lib-1', ...data },
})

beforeEach(() => {
  seed([])
})

describe('useDrilledSharedInfo', () => {
  it('returns null at the Test root (empty drillPath)', () => {
    seed([shared('s1')])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toBeNull()
  })

  it('reports editMode + sourceVersion from upstreamLink (post-loop resolution)', () => {
    seed(
      [
        shared('s1', {
          editMode: true,
          upstreamLink: { sourceVersion: '1.2.0' },
          functionVersion: '2.0.0',
          localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
        }),
      ],
      [{ nodeId: 's1', label: 's1' }],
    )
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toEqual({ nodeId: 's1', editMode: true, sourceVersion: '1.2.0' })
  })

  it('falls back to functionVersion when there is no upstreamLink (in-loop resolution)', () => {
    seed([shared('s1', { functionVersion: '3.0.0' })], [{ nodeId: 's1', label: 's1' }])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toEqual({ nodeId: 's1', editMode: false, sourceVersion: '3.0.0' })
  })

  it('returns null when a drill-path node id is missing and nothing shared seen yet', () => {
    seed([shared('s1')], [{ nodeId: 'ghost', label: 'ghost' }])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toBeNull()
  })

  it('returns null when drilled only into a Local Function (no shared on the path)', () => {
    const local: AnyNode = {
      id: 'fn-local',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Local',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
      },
    }
    seed([local], [{ nodeId: 'fn-local', label: 'Local' }])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toBeNull()
  })

  it('returns the shared info when a deeper drill-path id is missing inside its body', () => {
    seed(
      [
        shared('s-outer', {
          functionVersion: '4.0.0',
          localDefinition: { workflow: { nodes: [shared('s-buried')], edges: [] }, inputs: [], outputs: [] },
        }),
      ],
      [
        { nodeId: 's-outer', label: 's-outer' },
        { nodeId: 'ghost-inner', label: 'ghost-inner' },
      ],
    )
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toEqual({ nodeId: 's-outer', editMode: false, sourceVersion: '4.0.0' })
  })

  it('returns null when drilled into a Local Function that has no nested workflow', () => {
    const local: AnyNode = {
      id: 'fn-local',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Local',
        nodeType: 'function',
        functionLifecycle: 'local',
      },
    }
    seed([local], [{ nodeId: 'fn-local', label: 'Local' }])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current).toBeNull()
  })

  it('descends through a Local Function body to the nested Shared instance', () => {
    const local: AnyNode = {
      id: 'fn-local',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Local',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [shared('s-inner', { functionVersion: '1.0.0' })], edges: [] },
          inputs: [],
          outputs: [],
        },
      },
    }
    seed([local], [
      { nodeId: 'fn-local', label: 'Local' },
      { nodeId: 's-inner', label: 's-inner' },
    ])
    const { result } = renderHook(() => useDrilledSharedInfo())
    expect(result.current?.nodeId).toBe('s-inner')
  })
})
