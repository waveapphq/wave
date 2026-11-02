/**
 * function-versions - library Function version reads, and the contract a Shared instance takes
 * from them wherever it lands after its Test has loaded (REQ-3.1.2.4). The versions API is mocked; the
 * workflow and page-block stores are real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const mockListFunctionVersions = vi.fn()
vi.mock('@/features/functions/api/functions-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/functions/api/functions-api')>()),
  listFunctionVersions: (...args: unknown[]) => mockListFunctionVersions(...args),
}))

import {
  readFunctionVersions,
  useFunctionContracts,
  versionsDetail,
} from '@/features/workbench/live/function-versions'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePageBlockStore } from '@/stores/page-block-store'

const WHO = [{ name: 'who', type: 'string', required: true }]
const V1 = { version: '1.0.0', inputs: WHO, outputs: [] }

type Node = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }

function shared(id: string, functionId = 'lib-1'): Node {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'function', functionLifecycle: 'shared', functionId, functionVersion: '1.0.0' },
  }
}

function host(nodes: Node[]): Node {
  return {
    id: 'host',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'host',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { inputs: [], outputs: [], workflow: { nodes, edges: [] } },
    },
  }
}

function seed(nodes: Node[], extra: Record<string, unknown> = {}): void {
  useWorkflowStore.setState({
    nodes,
    edges: [],
    variables: [],
    drillPath: [],
    history: [],
    historyIndex: -1,
    clipboard: null,
    isCanvasReady: true,
    ...extra,
  } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

const nodeData = (index: number): Record<string, unknown> =>
  (useWorkflowStore.getState().nodes[index] as unknown as Node).data

/** Put one more Block on the canvas. */
function add(node: Node): void {
  useWorkflowStore.setState({ nodes: [...useWorkflowStore.getState().nodes, node] as never })
}

const absent = (): Error => Object.assign(new Error("Function 'lib-gone' not found"), { status: 404 })

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
  seed([])
})

describe('versionsDetail', () => {
  it('is the one failure itself, and one block per Function for several', () => {
    expect(versionsDetail([{ functionId: 'lib-1', reason: new Error('boom') }]).message).toBe('boom')
    expect(
      versionsDetail([
        { functionId: 'lib-1', reason: new Error('boom') },
        { functionId: 'lib-2', reason: new Error('bang') },
      ]).message,
    ).toBe('lib-1\nboom\n\nlib-2\nbang')
  })
})

describe('readFunctionVersions', () => {
  it('reads each library Function once and maps its versions', async () => {
    mockListFunctionVersions.mockResolvedValue({ versions: [V1] })

    const { versions, failures } = await readFunctionVersions(['lib-1', 'lib-1'])

    expect(mockListFunctionVersions.mock.calls).toEqual([['lib-1']])
    expect(versions.get('lib-1')?.get('1.0.0')).toBe(V1)
    expect(failures).toEqual([])
  })

  it('returns a failed read as a failure and a Function the library no longer holds as neither', async () => {
    const reason = new Error('boom')
    mockListFunctionVersions.mockImplementation((functionId: string) =>
      Promise.reject(functionId === 'lib-gone' ? absent() : reason),
    )

    const { versions, failures } = await readFunctionVersions(['lib-1', 'lib-gone'])

    expect(versions.size).toBe(0)
    expect(failures).toEqual([{ functionId: 'lib-1', reason }])
  })
})

describe('useFunctionContracts', () => {
  it('reads the contract of a Block that appears with none, at any depth of the open scope', async () => {
    mockListFunctionVersions.mockResolvedValue({ versions: [V1] })
    renderHook(() => useFunctionContracts())

    act(() => seed([shared('dropped'), host([shared('inner', 'lib-2')])]))

    await waitFor(() => expect(nodeData(0).resolvedInputs).toEqual(WHO))
    const body = (nodeData(1).localDefinition as { workflow: { nodes: Node[] } }).workflow.nodes
    expect(body[0].data.resolvedInputs).toEqual(WHO)
    expect(mockListFunctionVersions.mock.calls).toEqual([['lib-1'], ['lib-2']])
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('stamps a later Block of a Function already read with no new read', async () => {
    mockListFunctionVersions.mockResolvedValue({ versions: [V1] })
    renderHook(() => useFunctionContracts())
    act(() => seed([shared('dropped')]))
    await waitFor(() => expect(nodeData(0).resolvedInputs).toEqual(WHO))

    act(() => add(shared('copy')))

    await waitFor(() => expect(nodeData(1).resolvedInputs).toEqual(WHO))
    expect(mockListFunctionVersions).toHaveBeenCalledTimes(1)
  })

  it('reads a Function with no inputs or outputs once, and a newer version again', async () => {
    mockListFunctionVersions.mockResolvedValue({ versions: [{ version: '1.0.0' }] })
    renderHook(() => useFunctionContracts())
    act(() => seed([shared('plain')]))
    await waitFor(() => expect(mockListFunctionVersions).toHaveBeenCalledTimes(1))

    act(() => add(shared('again')))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockListFunctionVersions).toHaveBeenCalledTimes(1)

    const newer = { ...shared('newer'), data: { ...shared('newer').data, functionVersion: '2.0.0' } }
    mockListFunctionVersions.mockResolvedValue({ versions: [{ version: '1.0.0' }, { version: '2.0.0', inputs: WHO }] })
    act(() => add(newer))
    await waitFor(() => expect(nodeData(2).resolvedInputs).toEqual(WHO))
    expect(mockListFunctionVersions).toHaveBeenCalledTimes(2)
  })

  it('reads nothing before the canvas is ready, and only the scope that is open', async () => {
    mockListFunctionVersions.mockResolvedValue({ versions: [V1] })
    seed([shared('top', 'lib-top'), host([shared('inner')])], {
      isCanvasReady: false,
      drillPath: [{ nodeId: 'host', label: 'host' }],
    })
    renderHook(() => useFunctionContracts())
    expect(mockListFunctionVersions).not.toHaveBeenCalled()

    act(() => useWorkflowStore.setState({ isCanvasReady: true }))

    await waitFor(() => expect(mockListFunctionVersions.mock.calls).toEqual([['lib-1']]))
  })

  it('blocks the page when the read fails, and Try Again reads it again', async () => {
    mockListFunctionVersions.mockRejectedValueOnce(new Error('versions read failed'))
    mockListFunctionVersions.mockResolvedValue({ versions: [V1] })
    renderHook(() => useFunctionContracts())

    act(() => seed([shared('dropped')]))

    await waitFor(() => expect(usePageBlockStore.getState().block?.title).toBe('Could not load Function versions'))
    expect(usePageBlockStore.getState().block?.detail.message).toBe('versions read failed')
    expect(nodeData(0).resolvedInputs).toBeUndefined()

    await act(async () => {
      await usePageBlockStore.getState().block?.retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(nodeData(0).resolvedInputs).toEqual(WHO)
  })

  it('names every Function a failed read missed', async () => {
    mockListFunctionVersions.mockRejectedValue(new Error('boom'))
    renderHook(() => useFunctionContracts())

    act(() => seed([shared('a'), shared('b', 'lib-2')]))

    await waitFor(() =>
      expect(usePageBlockStore.getState().block?.detail.message).toBe('lib-1\nboom\n\nlib-2\nboom'),
    )
  })
})
