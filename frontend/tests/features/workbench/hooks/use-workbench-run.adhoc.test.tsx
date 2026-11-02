/**
 * useWorkbenchRun - Ad-hoc fields and completion toast (REQ-3.2.1.5).
 *
 * The hook is extended to:
 *
 *   1. Accept ``startNodeId`` and ``singleNodeId`` on
 *      ``StartDebugRunParams`` and forward them as ``start_node_id`` /
 *      ``single_node_id`` to ``workbenchApi.startDebugRun``.
 *   2. On terminal ``execution_completed`` for an ad-hoc run, emit a
 *      completion toast:
 *        - success: "Block <name> ran successfully"
 *        - failure: "Block <name> failed: <one-line error>"
 *      where ``<name>`` is the targeted node's label (the most recently
 *      targeted block via the ``block_status_changed`` event stream).
 *
 * Non-ad-hoc full runs do NOT receive the per-block completion toast
 * (the existing terminal flow handles those).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/toast'
import type { EventHandler, EventMetadata } from '@/services/websocket-client'

const {
  mockStartDebugRun,
  mockApiGetCurrentSession,
  mockSubscribe,
  mockSubscribeAsync,
  mockConnect,
  mockToastError,
  mockToastSuccess,
  mockToastInfo,
  mockToastWarning,
  getCapturedWsHandler,
  setCapturedWsHandler,
  mockIsConnected,
  setMockIsConnected,
  mockStartExecution,
  mockUpdateBlockExecution,
  mockCompleteExecution,
  mockClearExecution,
} = vi.hoisted(() => {
  let capturedHandler: EventHandler<unknown> | null = null
  let isConnected = true
  const unsubscribeFn = vi.fn()
  const subscribeFn = vi.fn().mockImplementation(
    (topic: string, handler: EventHandler<unknown>) => {
      if (topic.startsWith('workbench:')) capturedHandler = handler
      return { topic, unsubscribe: unsubscribeFn }
    }
  )
  const subscribeAsyncFn = vi.fn().mockImplementation(
    async (topic: string, handler: EventHandler<unknown>) => {
      if (topic.startsWith('workbench:')) capturedHandler = handler
      return { topic, unsubscribe: unsubscribeFn }
    }
  )
  const connectFn = vi.fn().mockResolvedValue(undefined)
  return {
    mockStartDebugRun: vi.fn(),
    mockApiGetCurrentSession: vi.fn(),
    mockSubscribe: subscribeFn,
    mockSubscribeAsync: subscribeAsyncFn,
    mockConnect: connectFn,
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastWarning: vi.fn(),
    getCapturedWsHandler: () => capturedHandler,
    setCapturedWsHandler: (h: EventHandler<unknown> | null) => { capturedHandler = h },
    mockIsConnected: () => isConnected,
    setMockIsConnected: (v: boolean) => { isConnected = v },
    mockStartExecution: vi.fn().mockReturnValue('mock-exec-id'),
    mockUpdateBlockExecution: vi.fn(),
    mockCompleteExecution: vi.fn(),
    mockClearExecution: vi.fn(),
  }
})

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    startRun: vi.fn(),
    startDebugRun: mockStartDebugRun,
    stopRun: vi.fn().mockResolvedValue({}),
    getCurrentSession: mockApiGetCurrentSession,
    clearSession: vi.fn().mockResolvedValue({ cleared: true }),
    updateSkippedNodes: vi.fn(),
    updateWorkbenchBreakpoints: vi.fn().mockResolvedValue(undefined),
    continueExecution: vi.fn().mockResolvedValue(undefined),
    skipBlockAtPause: vi.fn().mockResolvedValue(undefined),
    stepOver: vi.fn().mockResolvedValue(undefined),
    stepInto: vi.fn().mockResolvedValue(undefined),
    repeatStep: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/api', () => ({
  apiClient: {
    put: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}))

vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: () => ({
    subscribe: mockSubscribe,
    subscribeAsync: mockSubscribeAsync,
    connect: mockConnect,
    isConnected: mockIsConnected(),
  }),
}))

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useExecutionStore: (selector: (state: {
    startExecution: typeof mockStartExecution
    updateBlockExecution: typeof mockUpdateBlockExecution
    completeExecution: typeof mockCompleteExecution
    clearExecution: typeof mockClearExecution
  }) => unknown) => selector({
    startExecution: mockStartExecution,
    updateBlockExecution: mockUpdateBlockExecution,
    completeExecution: mockCompleteExecution,
    clearExecution: mockClearExecution,
  }),
}))

vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  return {
    ...actual,
    useToast: () => ({
      error: mockToastError,
      warning: mockToastWarning,
      success: mockToastSuccess,
      info: mockToastInfo,
      toast: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      toasts: [],
      maxToasts: 5,
    }),
  }
})

import { useWorkbenchRun } from '@/features/workbench/hooks/use-workbench-run'

function TestWrapper({ children }: { children: ReactNode }) {
  return createElement(ToastProvider, null, children)
}

function createEventMetadata(topic: string): EventMetadata {
  return { topic, timestamp: Date.now(), sequence: 1 }
}

describe('useWorkbenchRun - Ad-hoc fields', () => {
  const originalRandomUUID = crypto.randomUUID

  beforeEach(() => {
    vi.clearAllMocks()
    setCapturedWsHandler(null)
    setMockIsConnected(true)
    mockApiGetCurrentSession.mockResolvedValue(null)
    crypto.randomUUID = vi.fn().mockReturnValue('session-uuid-adhoc')
  })

  afterEach(() => {
    vi.clearAllMocks()
    crypto.randomUUID = originalRandomUUID
  })

  // -------------------------------------------------------------------------
  // startDebugRun: forwarding new fields
  // -------------------------------------------------------------------------

  describe('startDebugRun forwards ad-hoc fields', () => {
    it('forwards startNodeId as start_node_id in the API call', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          startNodeId: 'node-mid',
        })
      })

      expect(mockStartDebugRun).toHaveBeenCalledWith(
        expect.objectContaining({
          test_id: 'test-1',
          environment_id: 'env-1',
          start_node_id: 'node-mid',
        })
      )
    })

    it('forwards singleNodeId as single_node_id in the API call', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'node-target',
        })
      })

      expect(mockStartDebugRun).toHaveBeenCalledWith(
        expect.objectContaining({
          test_id: 'test-1',
          environment_id: 'env-1',
          single_node_id: 'node-target',
        })
      )
    })

    it('forwards blockDraft as block_draft in the API call (PYRUN-21)', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'py-1',
          blockDraft: true,
        })
      })

      expect(mockStartDebugRun).toHaveBeenCalledWith(
        expect.objectContaining({ single_node_id: 'py-1', block_draft: true })
      )
    })

    it('forwards scopedFunctionNodeId as scoped_function_node_id in the API call', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          scopeMode: 'function',
          scopedFunctionNodeId: 'func-node-7',
        })
      })

      expect(mockStartDebugRun).toHaveBeenCalledWith(
        expect.objectContaining({
          test_id: 'test-1',
          environment_id: 'env-1',
          scope_mode: 'function',
          scoped_function_node_id: 'func-node-7',
        })
      )
    })

    it('forwards functionPath as function_path in the API call', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'body-log',
          functionPath: ['outer-fn', 'inner-fn'],
        })
      })

      expect(mockStartDebugRun).toHaveBeenCalledWith(
        expect.objectContaining({ single_node_id: 'body-log', function_path: ['outer-fn', 'inner-fn'] })
      )
    })

    it('a Debug Scope keeps the canvas state of the run before it', async () => {
      mockStartDebugRun.mockResolvedValue({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      const debugOptions = { pauseOnFirstBlock: false, pauseOnErrors: false }

      await act(async () => {
        await result.current.startDebugRun({ testId: 'test-1', environmentId: 'env-1', breakpoints: [], debugOptions })
      })
      await act(async () => {
        getCapturedWsHandler()!(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })
      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions,
          scopeMode: 'function',
          scopedFunctionNodeId: 'inner-fn',
          functionPath: ['outer-fn'],
        })
      })

      expect(mockStartDebugRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ scoped_function_node_id: 'inner-fn', function_path: ['outer-fn'] })
      )
      expect(mockStartExecution).toHaveBeenCalledTimes(1)
    })

    it('a Run Scope forwards the Function path and keeps the canvas state of the run before it', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const runResponse = {
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      }
      vi.mocked(workbenchApi.startRun).mockResolvedValue(runResponse)
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-1', environmentId: 'env-1' })
      })
      await act(async () => {
        getCapturedWsHandler()!(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })
      await act(async () => {
        await result.current.startRun({
          testId: 'test-1',
          environmentId: 'env-1',
          scopeMode: 'function',
          scopedFunctionNodeId: 'inner-fn',
          functionPath: ['outer-fn'],
        })
      })

      expect(workbenchApi.startRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ scoped_function_node_id: 'inner-fn', function_path: ['outer-fn'] })
      )
      expect(mockStartExecution).toHaveBeenCalledTimes(1)
    })

    it('does not forward ad-hoc keys when neither is set', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      const callArgs = mockStartDebugRun.mock.calls[0][0] as Record<string, unknown>
      expect('start_node_id' in callArgs).toBe(false)
      expect('single_node_id' in callArgs).toBe(false)
      expect('block_draft' in callArgs).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Completion toast on ad-hoc terminal events
  // -------------------------------------------------------------------------

  describe('Completion toast on ad-hoc terminal events', () => {
    it('emits success toast "Block <name> ran successfully" when ad-hoc run passes', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'node-target',
        })
      })

      const wsHandler = getCapturedWsHandler()
      expect(wsHandler).not.toBeNull()

      await act(async () => {
        wsHandler!(
          {
            type: 'block_status_changed',
            block_id: 'node-target',
            block_name: 'My Test Block',
            status: 'passed',
            progress: { current: 1, total: 1, percentage: 100 },
          },
          createEventMetadata('workbench:session-uuid-adhoc')
        )

        wsHandler!(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          expect.stringMatching(/^Block 'My Test Block' ran successfully$/)
        )
      })
    })

    it('emits error toast "Block <name> failed: <error>" when ad-hoc run fails', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'node-target',
        })
      })

      const wsHandler = getCapturedWsHandler()
      expect(wsHandler).not.toBeNull()

      await act(async () => {
        wsHandler!(
          {
            type: 'block_status_changed',
            block_id: 'node-target',
            block_name: 'Broken Block',
            status: 'running',
            progress: { current: 1, total: 1, percentage: 100 },
          },
          createEventMetadata('workbench:session-uuid-adhoc')
        )

        wsHandler!(
          {
            type: 'execution_completed',
            status: 'failed',
            error: 'connection refused',
          },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          expect.stringMatching(/^Block 'Broken Block' failed: connection refused$/)
        )
      })
    })

    it('uses fallback "Block" name when no block_status_changed event arrived first', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'node-target',
        })
      })

      const wsHandler = getCapturedWsHandler()
      await act(async () => {
        wsHandler!(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          expect.stringMatching(/^Block 'Block' ran successfully$/)
        )
      })
    })

    it('emits failure toast without trailing detail when error is missing', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          singleNodeId: 'node-target',
        })
      })

      const wsHandler = getCapturedWsHandler()
      await act(async () => {
        wsHandler!(
          {
            type: 'block_status_changed',
            block_id: 'node-target',
            block_name: 'Silent Block',
            status: 'running',
            progress: { current: 1, total: 1, percentage: 100 },
          },
          createEventMetadata('workbench:session-uuid-adhoc')
        )

        wsHandler!(
          { type: 'execution_completed', status: 'failed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          expect.stringMatching(/^Block 'Silent Block' failed$/)
        )
      })
    })

    it('does NOT emit completion toast for non-ad-hoc full runs', async () => {
      mockStartDebugRun.mockResolvedValueOnce({
        session_id: 'session-uuid-adhoc',
        status: 'running',
        websocket_topic: 'workbench:session-uuid-adhoc',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        // No startNodeId / singleNodeId = full run, no completion toast
        await result.current.startDebugRun({
          testId: 'test-1',
          environmentId: 'env-1',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      const wsHandler = getCapturedWsHandler()
      expect(wsHandler).not.toBeNull()

      await act(async () => {
        wsHandler!(
          {
            type: 'block_status_changed',
            block_id: 'block-final',
            block_name: 'Last Block',
            status: 'passed',
            progress: { current: 5, total: 5, percentage: 100 },
          },
          createEventMetadata('workbench:session-uuid-adhoc')
        )

        wsHandler!(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata('workbench:session-uuid-adhoc')
        )
      })

      // No "Block X ran successfully" toast for a full run
      const successCalls = mockToastSuccess.mock.calls.flat()
      const adhocLikeMessages = successCalls.filter(
        (c) => typeof c === 'string' && /Block .* ran successfully/i.test(c)
      )
      expect(adhocLikeMessages).toEqual([])
    })
  })
})
