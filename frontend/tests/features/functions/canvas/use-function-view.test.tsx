/**
 * useFunctionView - library-View boot hook (REQ-3.2.1.1).
 *
 * Detects `/workbench?viewFunction={id}&version={v}`, fetches that version's
 * body, sets library-View mode on the workflow store, and drills into the
 * synthetic Shared root via the existing `pushSharedDrill` machinery.
 *
 * Mirrors the `?editTest=` detection in use-test-lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

let searchParamsState: Record<string, string> = {}

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(searchParamsState), vi.fn()] as const,
  }
})

const getFunctionVersionMock = vi.fn()
vi.mock('@/features/functions/api/functions-api', () => ({
  getFunctionVersion: (functionId: string, version: string) =>
    getFunctionVersionMock(functionId, version),
  isFunctionAbsent: (error: unknown) => (error as { status?: number } | null)?.status === 404,
}))

const storeState = {
  editingTestId: null as string | null,
  functionViewMode: null as unknown,
  nodes: [] as unknown[],
  drillPath: [] as unknown[],
  isDirty: false,
  enterFunctionView: vi.fn(),
  exitFunctionView: vi.fn(),
  setFunctionViewVersion: vi.fn(),
  pushSharedDrill: vi.fn(),
  setFunctionViewBaseline: vi.fn(),
  reset: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  requestFitView: vi.fn(),
  markSaved: vi.fn(),
}

let executionActive = false
const setShowSwitchDialogMock = vi.fn()
const setPendingEditTestIdMock = vi.fn()

function renderFnView(useStrict = false) {
  return renderHook(
    () =>
      useFunctionView({
        executionActive,
        setShowSwitchDialog: setShowSwitchDialogMock,
        setPendingEditTestId: setPendingEditTestIdMock,
      }),
    { wrapper: useStrict ? strictWrapper : wrapper },
  )
}

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const useWorkflowStore = vi.fn((selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
  ) as unknown as ((selector: (s: typeof storeState) => unknown) => unknown) & {
    getState: () => typeof storeState
  }
  useWorkflowStore.getState = () => storeState
  return { useWorkflowStore }
})

import { useFunctionView } from '@/features/functions/canvas/use-function-view'
import { usePageBlockStore } from '@/stores/page-block-store'

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function strictWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <StrictMode>
      <MemoryRouter>{children}</MemoryRouter>
    </StrictMode>
  )
}

function versionDefinition() {
  return {
    definition: {
      id: 'fn-greet-id',
      name: 'Greet User',
      description: '',
      tags: [],
      inputs: [{ name: 'x', type: 'string', required: false, default: 'hi' }],
      outputs: [{ name: 'result', type: 'string' }],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
    },
    etag: 'etag-1',
  }
}

beforeEach(() => {
  searchParamsState = {}
  getFunctionVersionMock.mockReset()
  getFunctionVersionMock.mockResolvedValue(versionDefinition())
  storeState.enterFunctionView = vi.fn()
  storeState.pushSharedDrill = vi.fn()
  storeState.setFunctionViewBaseline = vi.fn()
  storeState.reset = vi.fn()
  storeState.setNodes = vi.fn()
  storeState.requestFitView = vi.fn()
  storeState.markSaved = vi.fn()
  storeState.functionViewMode = null
  storeState.nodes = []
  storeState.drillPath = []
  storeState.isDirty = false
  executionActive = false
  setShowSwitchDialogMock.mockReset()
  setPendingEditTestIdMock.mockReset()
  usePageBlockStore.setState({ block: null, retrying: false })
})

describe('useFunctionView - boot from ?viewFunction', () => {
  it('fetches the requested version body', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(getFunctionVersionMock).toHaveBeenCalledWith('fn-greet-id', '1.0.0')
    })
  })

  it('sets library-View mode for the requested function/version', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(storeState.enterFunctionView).toHaveBeenCalled()
    })
    const callArgs = JSON.stringify(storeState.enterFunctionView.mock.calls[0])
    expect(callArgs).toContain('fn-greet-id')
    expect(callArgs).toContain('1.0.0')
  })

  it('seeds the drill via pushSharedDrill once the body resolves', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(storeState.pushSharedDrill).toHaveBeenCalled()
    })
  })

  it('keeps the loaded body as the baseline the View secrets compare to', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()
    await waitFor(() => expect(storeState.setFunctionViewBaseline).toHaveBeenCalledTimes(1))
    const [[drilledId, drilledBody]] = storeState.pushSharedDrill.mock.calls
    expect(storeState.setFunctionViewBaseline).toHaveBeenCalledWith({ nodeId: drilledId, body: drilledBody })
  })

  it('seeds the synthetic root WITHOUT marking the store dirty', async () => {
    // The read-only View has no unsaved changes; a dirty store makes the
    // switch-test guard fire when the user later opens a real test.
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(storeState.setNodes).toHaveBeenCalled()
    })
    expect(storeState.setNodes).toHaveBeenCalledWith(expect.any(Array), { skipDirty: true })
  })

  it('seeds the history baseline as the loaded published body', async () => {
    // The undo floor of the library View must be the loaded body, never the
    // empty canvas reset() left behind: the boot re-baselines (markSaved)
    // AFTER the synthetic root and its resolved body are staged.
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(storeState.markSaved).toHaveBeenCalled()
    })
    const drillOrder = storeState.pushSharedDrill.mock.invocationCallOrder[0]
    const baselineOrder = storeState.markSaved.mock.invocationCallOrder[0]
    expect(baselineOrder).toBeGreaterThan(drillOrder)
  })

  it('requests a fitView so the read-only canvas becomes ready', async () => {
    // The View owns its readiness: without this the canvas overlay
    // ("Preparing workbench…") never clears, since use-test-lifecycle no
    // longer fits the view in library-View mode.
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(storeState.requestFitView).toHaveBeenCalled()
    })
  })
})

describe('useFunctionView - the body read fails', () => {
  it('blocks the canvas with the reason instead of showing an empty Function', async () => {
    // reset() + enterFunctionView have already run, so a swallowed failure
    // leaves a read-only canvas with nothing in it and no explanation.
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    getFunctionVersionMock.mockRejectedValue(
      Object.assign(new Error('Library unavailable'), { status: 500 }),
    )
    renderFnView()

    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load Function body')
    expect(block?.detail.message).toBe('Library unavailable')
    expect(storeState.pushSharedDrill).not.toHaveBeenCalled()
  })

  it('Try Again re-runs the read and clears the block once it succeeds', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    getFunctionVersionMock.mockRejectedValue(new Error('Network unreachable'))
    renderFnView()

    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })
    getFunctionVersionMock.mockResolvedValue(versionDefinition())
    await act(async () => {
      await usePageBlockStore.getState().block?.retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(storeState.pushSharedDrill).toHaveBeenCalledTimes(1)
  })

  it('keeps the block with the newest reason when the retry fails again', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    getFunctionVersionMock.mockRejectedValue(new Error('Network unreachable'))
    renderFnView()

    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })
    getFunctionVersionMock.mockRejectedValue(new Error('Still unreachable'))
    await act(async () => {
      await usePageBlockStore.getState().block?.retry().catch(() => undefined)
    })

    expect(usePageBlockStore.getState().block?.detail.message).toBe('Still unreachable')
  })
})

describe('useFunctionView - the Function is gone from the library', () => {
  it('treats the 404 as an answer and stages the missing root instead of blocking', async () => {
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    getFunctionVersionMock.mockRejectedValue(
      Object.assign(new Error('Function not found'), { status: 404 }),
    )
    renderFnView()

    await waitFor(() => {
      expect(storeState.setNodes).toHaveBeenCalled()
    })
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(storeState.pushSharedDrill).not.toHaveBeenCalled()
    expect(storeState.setNodes).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'view-shared-root',
          data: expect.objectContaining({
            label: 'Function',
            functionLifecycle: 'shared',
            functionId: 'fn-greet-id',
            functionVersion: '1.0.0',
            missingVersion: true,
          }),
        }),
      ],
      { skipDirty: true },
    )
    expect(storeState.markSaved).toHaveBeenCalled()
    expect(storeState.requestFitView).toHaveBeenCalled()
  })
})

describe('useFunctionView - no view param', () => {
  it('does nothing without a viewFunction param', () => {
    searchParamsState = {}
    renderFnView()

    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    expect(storeState.enterFunctionView).not.toHaveBeenCalled()
  })
})

describe('useFunctionView - idempotent boot', () => {
  it('boots only once under a StrictMode double-invoke (no stacked drill)', async () => {
    // pushSharedDrill appends; the boot guard must keep a StrictMode
    // setup/cleanup/setup from drilling twice (doubled breadcrumb).
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView(true)

    await waitFor(() => {
      expect(storeState.pushSharedDrill).toHaveBeenCalled()
    })
    expect(getFunctionVersionMock).toHaveBeenCalledTimes(1)
    expect(storeState.pushSharedDrill).toHaveBeenCalledTimes(1)
  })

  it('does not re-boot once booted when an unrelated dep changes', async () => {
    // After the View boots, the bootedKeyRef guard returns early on re-runs
    // for the same id/version (e.g. an execution starts) - no second boot.
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    const { rerender } = renderFnView()
    await waitFor(() => {
      expect(getFunctionVersionMock).toHaveBeenCalledTimes(1)
    })
    executionActive = true
    rerender()
    expect(getFunctionVersionMock).toHaveBeenCalledTimes(1)
    expect(setShowSwitchDialogMock).not.toHaveBeenCalled()
  })
})

describe('useFunctionView - unsaved-changes guard', () => {
  it('opens the switch dialog instead of booting when the workbench is dirty', async () => {
    storeState.isDirty = true
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(setShowSwitchDialogMock).toHaveBeenCalledWith(true)
    })
    expect(setPendingEditTestIdMock).toHaveBeenCalledWith(null)
    // No boot: the View must not discard the dirty entity.
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
    expect(storeState.reset).not.toHaveBeenCalled()
  })

  it('opens the switch dialog instead of booting when an execution is active', async () => {
    executionActive = true
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(setShowSwitchDialogMock).toHaveBeenCalledWith(true)
    })
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })

  it('still asks when the store holds another version of the same Function', async () => {
    storeState.functionViewMode = { functionId: 'fn-greet-id', version: '1.1.0', editable: false }
    storeState.isDirty = true
    searchParamsState = { viewFunction: 'fn-greet-id', version: '1.0.0' }
    renderFnView()

    await waitFor(() => {
      expect(setShowSwitchDialogMock).toHaveBeenCalledWith(true)
    })
    expect(storeState.reset).not.toHaveBeenCalled()
  })
})

describe('useFunctionView - returning to the open View', () => {
  const OPEN_VIEW = { functionId: 'fn-outer', version: '1.0.0', editable: false, name: 'Outer' }
  const OPEN_VIEW_URL = { viewFunction: 'fn-outer', version: '1.0.0' }

  beforeEach(() => {
    storeState.nodes = [{ id: 'view-shared-root', data: { label: 'Outer' } }]
  })

  function expectViewKept(): void {
    expect(setShowSwitchDialogMock).not.toHaveBeenCalled()
    expect(storeState.reset).not.toHaveBeenCalled()
    expect(storeState.enterFunctionView).not.toHaveBeenCalled()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  }

  it('takes back the open View with its draft on a fresh mount, with no dialog', () => {
    storeState.functionViewMode = OPEN_VIEW
    storeState.isDirty = true
    searchParamsState = OPEN_VIEW_URL
    renderFnView()

    expectViewKept()
  })

  it('takes back the open View while its run is still on the canvas', () => {
    storeState.functionViewMode = OPEN_VIEW
    executionActive = true
    searchParamsState = OPEN_VIEW_URL
    renderFnView()

    expectViewKept()
  })

  it('takes back a clean open View as it is, without reading it again', () => {
    storeState.functionViewMode = OPEN_VIEW
    searchParamsState = OPEN_VIEW_URL
    renderFnView()

    expectViewKept()
  })

  it('reads the View again when its first read staged nothing, so the failure shows again', async () => {
    storeState.functionViewMode = OPEN_VIEW
    storeState.nodes = []
    searchParamsState = OPEN_VIEW_URL
    renderFnView()

    await waitFor(() => {
      expect(getFunctionVersionMock).toHaveBeenCalledWith('fn-outer', '1.0.0')
    })
    expect(setShowSwitchDialogMock).not.toHaveBeenCalled()
  })

  it('asks once for another Function, and Keep Editing back to the open View does not ask again', async () => {
    storeState.functionViewMode = OPEN_VIEW
    storeState.isDirty = true
    searchParamsState = { viewFunction: 'fn-other', version: '2.0.0' }
    const { rerender } = renderFnView()
    await waitFor(() => {
      expect(setShowSwitchDialogMock).toHaveBeenCalledTimes(1)
    })

    searchParamsState = OPEN_VIEW_URL
    rerender()

    expect(setShowSwitchDialogMock).toHaveBeenCalledTimes(1)
    expect(storeState.reset).not.toHaveBeenCalled()
    expect(getFunctionVersionMock).not.toHaveBeenCalled()
  })
})
