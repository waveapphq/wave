/**
 * Workflow store: validation state.
 *
 * Tests for the new fields and actions:
 * - nodeIssues: Map<string, NodeIssue[]>     (live-derived)
 * - pulseValidationNodeIds: Set<string>      (transient pulse set)
 * - setPulseValidationNodeIds(ids: string[])
 * - clearPulseValidationNodeId(id: string)
 *
 * Tests also confirm that validationErrorNodeIds and friends do not exist.
 */

import { describe, it, expect, beforeEach } from 'vitest'

describe('Workflow store - validation state', () => {
  beforeEach(() => {
    // No-op; each test imports the store fresh and resets.
  })

  describe('nodeIssues', () => {
    it('initializes as an empty Map', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.setState({ nodes: [], edges: [], variables: [] })
      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, unknown[]>
      }
      expect(state.nodeIssues).toBeInstanceOf(Map)
      expect(state.nodeIssues.size).toBe(0)
    })

    it('recomputes when nodes change', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      const setNodes = useWorkflowStore.getState().setNodes
      // Drop a node with a missing required param (http-client requires url).
      setNodes([
        {
          id: 'n1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            elementType: 'http-client',
            nodeType: 'plugin',
            version: '1.0.0',
            label: 'HTTP',
            config: { values: { method: 'GET' } },
          },
        } as Parameters<typeof setNodes>[0][number],
      ])
      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, Array<{ code: string }>>
      }
      expect(state.nodeIssues.has('n1')).toBe(true)
      const codes = (state.nodeIssues.get('n1') ?? []).map((i) => i.code)
      expect(codes).toContain('REQUIRED_PARAM_MISSING')
    })
  })

  describe('WAVE-side path schemes on a block inside a Remote Execution body', () => {
    const container = {
      id: 'rex-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'remote-execution',
        nodeType: 'control',
        version: '1.0.0',
        label: 'Remote Execution',
        config: { values: { session_id: 'ssh' } },
      },
    }

    function bodyMember(id: string, elementType: string, values: Record<string, unknown>) {
      return {
        id,
        type: 'workflowNode',
        position: { x: 0, y: 120 },
        data: { elementType, nodeType: 'plugin', version: '1.0.0', label: id, config: { values } },
      }
    }

    async function issuesInsideBody(member: ReturnType<typeof bodyMember>) {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.setState({
        nodes: [container, member] as never,
        edges: [
          { id: 'e-body', source: 'rex-1', target: member.id, sourceHandle: 'body' },
        ] as never,
        variables: [],
      })
      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, Array<{ code: string }>>
      }
      return state.nodeIssues.get(member.id) ?? []
    }

    it.each(['testdata://orders.csv', 'artifact://reports/orders.csv'])(
      'raises no issue for a File I/O read of %s',
      async (path) => {
        expect(await issuesInsideBody(bodyMember('fio-1', 'file-io', { operation: 'read', path }))).toEqual([])
      },
    )

    it('raises no issue for a K8s Copy naming a scheme on both path rows', async () => {
      const member = bodyMember('copy-1', 'k8s-copy', {
        session: 'k8s',
        direction: 'to_pod',
        pod: 'api-0',
        container: 'app',
        source_path: 'artifact://run/x.txt',
        target_path: 'testdata://payloads/p1.json',
      })

      expect(await issuesInsideBody(member)).toEqual([])
    })

    it('raises no issue for an HTTP file source or a multipart file part with a scheme', async () => {
      const base = { method: 'PUT', url: 'https://api.example.com/upload', timeout: 30 }

      expect(
        await issuesInsideBody(
          bodyMember('http-1', 'http-client', { ...base, body_mode: 'file', file_source: 'testdata://p.bin' }),
        ),
      ).toEqual([])
      expect(
        await issuesInsideBody(
          bodyMember('http-2', 'http-client', {
            ...base,
            body_mode: 'multipart',
            parts: [{ kind: 'file', name: 'up', source: 'artifact://seed.txt' }],
          }),
        ),
      ).toEqual([])
    })
  })

  describe('pulseValidationNodeIds', () => {
    it('initializes as an empty Set', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.setState({ nodes: [], edges: [], variables: [] })
      const state = useWorkflowStore.getState() as unknown as {
        pulseValidationNodeIds: Set<string>
      }
      expect(state.pulseValidationNodeIds).toBeInstanceOf(Set)
      expect(state.pulseValidationNodeIds.size).toBe(0)
    })

    it('setPulseValidationNodeIds replaces the set wholesale', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      const store = useWorkflowStore.getState() as unknown as {
        setPulseValidationNodeIds: (ids: string[]) => void
        pulseValidationNodeIds: Set<string>
      }
      store.setPulseValidationNodeIds(['a', 'b', 'c'])
      const after = useWorkflowStore.getState() as unknown as {
        pulseValidationNodeIds: Set<string>
      }
      expect(after.pulseValidationNodeIds.size).toBe(3)
      expect(after.pulseValidationNodeIds.has('a')).toBe(true)
      expect(after.pulseValidationNodeIds.has('b')).toBe(true)
      expect(after.pulseValidationNodeIds.has('c')).toBe(true)

      ;(useWorkflowStore.getState() as unknown as {
        setPulseValidationNodeIds: (ids: string[]) => void
      }).setPulseValidationNodeIds(['x'])
      const replaced = useWorkflowStore.getState() as unknown as {
        pulseValidationNodeIds: Set<string>
      }
      expect(replaced.pulseValidationNodeIds.size).toBe(1)
      expect(replaced.pulseValidationNodeIds.has('x')).toBe(true)
      expect(replaced.pulseValidationNodeIds.has('a')).toBe(false)
    })

    it('clearPulseValidationNodeId removes a single id', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      ;(useWorkflowStore.getState() as unknown as {
        setPulseValidationNodeIds: (ids: string[]) => void
      }).setPulseValidationNodeIds(['a', 'b', 'c'])
      ;(useWorkflowStore.getState() as unknown as {
        clearPulseValidationNodeId: (id: string) => void
      }).clearPulseValidationNodeId('b')
      const after = useWorkflowStore.getState() as unknown as {
        pulseValidationNodeIds: Set<string>
      }
      expect(after.pulseValidationNodeIds.has('a')).toBe(true)
      expect(after.pulseValidationNodeIds.has('b')).toBe(false)
      expect(after.pulseValidationNodeIds.has('c')).toBe(true)
    })

    it('clearPulseValidationNodeId is a no-op when the id is not present', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      ;(useWorkflowStore.getState() as unknown as {
        setPulseValidationNodeIds: (ids: string[]) => void
      }).setPulseValidationNodeIds(['a', 'b'])
      const before = useWorkflowStore.getState().pulseValidationNodeIds
      ;(useWorkflowStore.getState() as unknown as {
        clearPulseValidationNodeId: (id: string) => void
      }).clearPulseValidationNodeId('zzz')
      const after = useWorkflowStore.getState().pulseValidationNodeIds
      // Same Set reference - the action returned the existing state unchanged.
      expect(after).toBe(before)
      expect(after.has('a')).toBe(true)
      expect(after.has('b')).toBe(true)
    })
  })

  describe('legacy field removal', () => {
    it('the old validationErrorNodeIds array is gone', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      const state = useWorkflowStore.getState() as unknown as Record<string, unknown>
      expect('validationErrorNodeIds' in state).toBe(false)
    })

    it('the old setValidationErrorNodeIds action is gone', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      const state = useWorkflowStore.getState() as unknown as Record<string, unknown>
      expect('setValidationErrorNodeIds' in state).toBe(false)
    })

    it('the old clearValidationErrorNode action is gone', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      const state = useWorkflowStore.getState() as unknown as Record<string, unknown>
      expect('clearValidationErrorNode' in state).toBe(false)
    })
  })
})
