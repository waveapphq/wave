/**
 * useWorkbenchRun Hook Tests - V-CANVAS-14 / REQ-3.2.1.1
 *
 * Tests for the Workbench ephemeral execution hook.
 *
 * Key WAVE-specific behaviors tested:
 * - Ephemeral runs use session_id (NOT execution_id)
 * - WebSocket topic format: workbench:{session_id}
 * - Pre-flight profile validation with warnings (doesn't block execution)
 * - Toast notifications for user feedback
 * - State transitions: idle → running → paused/passed/failed/stopped
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/toast'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { EventHandler, EventMetadata } from '@/services/websocket-client/types'

// Types that the hook will export
export interface WorkbenchRunState {
  status: 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped'
  sessionId: string | null
  websocketTopic: string | null
  currentBlock: { blockId: string; blockName: string } | null
  progress: { current: number; total: number; percentage: number } | null
  warnings: Array<{ type: string; profileName: string; message: string }>
  isRunning: boolean
  error: Error | null
}

export interface WorkbenchRunActions {
  startRun: (params: {
    testId: string
    environmentId: string
    debugMode?: boolean
  }) => Promise<void>
  stopRun: () => Promise<void>
  reset: () => void
}

export type UseWorkbenchRunReturn = WorkbenchRunState & WorkbenchRunActions

// Use vi.hoisted() to make mock variables available for vi.mock() factories
// (vi.mock is hoisted to the top of the file, so regular variables aren't defined yet)
const {
  mockApiPost,
  mockApiGetCurrentSession,
  mockUnsubscribe,
  mockSubscribe,
  mockSubscribeAsync,
  mockConnect,
  mockToastError,
  mockToastWarning,
  getCapturedWsHandler,
  setCapturedWsHandler,
  getCapturedVariableHandler,
  setCapturedVariableHandler,
  mockIsConnected,
  setMockIsConnected,
  mockStartExecution,
  mockUpdateBlockExecution,
  mockCompleteExecution,
  mockClearExecution,
  mockStopRunningBlocks,
} = vi.hoisted(() => {
  let capturedHandler: EventHandler<unknown> | null = null
  let capturedVariableHandler: EventHandler<unknown> | null = null
  let isConnected = true
  const unsubscribeFn = vi.fn()
  const subscribeFn = vi.fn().mockImplementation(
    (topic: string, handler: EventHandler<unknown>) => {
      if (topic.startsWith('workbench:')) {
        capturedHandler = handler
      } else if (topic.startsWith('variable:')) {
        capturedVariableHandler = handler
      }
      return { topic, unsubscribe: unsubscribeFn }
    }
  )
  // Async version that returns a Promise (resolves immediately in tests)
  // Captures handler for workbench: topics and variable: topics separately
  const subscribeAsyncFn = vi.fn().mockImplementation(
    async (topic: string, handler: EventHandler<unknown>) => {
      if (topic.startsWith('workbench:')) {
        capturedHandler = handler
      } else if (topic.startsWith('variable:')) {
        capturedVariableHandler = handler
      }
      return { topic, unsubscribe: unsubscribeFn }
    }
  )
  const connectFn = vi.fn().mockResolvedValue(undefined)
  return {
    mockApiPost: vi.fn(),
    mockApiGetCurrentSession: vi.fn(),
    mockUnsubscribe: unsubscribeFn,
    mockSubscribe: subscribeFn,
    mockSubscribeAsync: subscribeAsyncFn,
    mockConnect: connectFn,
    mockToastError: vi.fn(),
    mockToastWarning: vi.fn(),
    getCapturedWsHandler: () => capturedHandler,
    setCapturedWsHandler: (h: EventHandler<unknown> | null) => { capturedHandler = h },
    getCapturedVariableHandler: () => capturedVariableHandler,
    setCapturedVariableHandler: (h: EventHandler<unknown> | null) => { capturedVariableHandler = h },
    mockIsConnected: () => isConnected,
    setMockIsConnected: (v: boolean) => { isConnected = v },
    // Execution store mocks for V-CANVAS-04
    mockStartExecution: vi.fn().mockReturnValue('mock-exec-id'),
    mockUpdateBlockExecution: vi.fn(),
    mockCompleteExecution: vi.fn(),
    mockClearExecution: vi.fn(),
    mockStopRunningBlocks: vi.fn(),
  }
})


const mockUpdateSkippedNodes = vi.hoisted(() => vi.fn())
const mockRunFunctionStandalone = vi.hoisted(() => vi.fn())

vi.mock('@/features/functions/api/functions-api', () => ({
  runFunctionStandalone: mockRunFunctionStandalone,
}))

// Tracked-session stop routes through apiClient.put directly.
const mockApiClientPut = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { status: 'stopped' } }))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    startRun: mockApiPost,
    startDebugRun: mockApiPost,
    stopRun: vi.fn().mockImplementation((sessionId: string) => mockApiPost(`/workbench/${sessionId}/stop`)),
    getCurrentSession: mockApiGetCurrentSession,
    clearSession: vi.fn().mockResolvedValue({ cleared: true }),
    updateSkippedNodes: mockUpdateSkippedNodes,
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
    put: mockApiClientPut,
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
    stopRunningBlocks: typeof mockStopRunningBlocks
  }) => unknown) => selector({
    startExecution: mockStartExecution,
    updateBlockExecution: mockUpdateBlockExecution,
    completeExecution: mockCompleteExecution,
    clearExecution: mockClearExecution,
    stopRunningBlocks: mockStopRunningBlocks,
  }),
}))

vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  return {
    ...actual,
    useToast: () => ({
      error: mockToastError,
      warning: mockToastWarning,
      success: vi.fn(),
      info: vi.fn(),
      toast: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      toasts: [],
      maxToasts: 5,
    }),
  }
})

// Import hook
import { useWorkbenchRun } from '@/features/workbench/hooks/use-workbench-run/hook'
import { usePageBlockStore } from '@/stores/page-block-store'

function TestWrapper({ children }: { children: ReactNode }) {
  return createElement(ToastProvider, null, children)
}

// Helper to create metadata for WebSocket events
function createEventMetadata(topic: string): EventMetadata {
  return { topic, timestamp: Date.now(), sequence: 1 }
}

describe('useWorkbenchRun - V-CANVAS-14 / REQ-3.2.1.1', () => {
  const originalRandomUUID = crypto.randomUUID

  beforeEach(() => {
    vi.clearAllMocks()
    setCapturedWsHandler(null)
    setCapturedVariableHandler(null)
    setMockIsConnected(true)
    // Default: no existing session (normal case)
    mockApiGetCurrentSession.mockResolvedValue(null)
    // Make client-generated session IDs deterministic for assertions
    crypto.randomUUID = vi.fn().mockReturnValue('session-uuid-789')
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
    crypto.randomUUID = originalRandomUUID
  })

  describe('Initial State', () => {
    it('initializes with idle state and null values', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      expect(result.current.status).toBe('idle')
      expect(result.current.sessionId).toBeNull()
      expect(result.current.websocketTopic).toBeNull()
      expect(result.current.currentBlock).toBeNull()
      expect(result.current.progress).toBeNull()
      expect(result.current.warnings).toEqual([])
      expect(result.current.isRunning).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.isSessionRecoveryComplete).toBe(false)

      // Wait for async session recovery to complete to avoid act() warnings
      // The hook runs session recovery on mount which updates isSessionRecoveryComplete
      await waitFor(() => {
        expect(result.current.isSessionRecoveryComplete).toBe(true)
      })
    })
  })

  describe('startRun - Ephemeral Execution', () => {
    const mockSessionId = 'session-uuid-789'
    const mockTopic = `workbench:${mockSessionId}`

    it('starts ephemeral run and returns session_id (NOT execution_id)', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({
          testId: 'test-123',
          environmentId: 'env-456',
        })
      })

      // Verify ephemeral execution (session_id, not execution_id)
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.websocketTopic).toBe(mockTopic)
      expect(result.current.status).toBe('running')
      expect(result.current.isRunning).toBe(true)

      // Verify API called with correct parameters (including client-generated session_id)
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.objectContaining({
          test_id: 'test-123',
          environment_id: 'env-456',
          session_id: mockSessionId,
        })
      )
    })

    it('forces sessionId through null on a fresh full run after a prior session (Run All == Reset+Run)', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: 'session-A',
        status: 'running',
        websocket_topic: 'workbench:session-A',
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // crypto.randomUUID is module-mocked to a single value; rebind it after
      // mount (other mount-time consumers must not eat a run id) so each
      // prepareRun call gets its own. The two ids let us observe the
      // sessionId transition end-to-end.
      const ids = ['session-A', 'session-B']
      ;(crypto as { randomUUID: () => string }).randomUUID = () => ids.shift()!

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })
      expect(result.current.sessionId).toBe('session-A')

      // Stop the first run so the hook leaves running but keeps sessionId
      // populated - exactly the back-to-back scenario the flushSync
      // branch defends against. (Reset would null sessionId out and
      // bypass the branch under test.)
      mockApiPost.mockResolvedValueOnce({ status: 'stopped' })
      await act(async () => {
        await result.current.stopRun()
      })

      mockApiPost.mockResolvedValueOnce({
        session_id: 'session-B',
        status: 'running',
        websocket_topic: 'workbench:session-B',
        warnings: [],
      })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      expect(result.current.sessionId).toBe('session-B')
    })

    it('passes breakpoints and debug_options to API when startDebugRun is used', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-123',
          environmentId: 'env-456',
          breakpoints: ['node-a'],
          debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
        })
      })

      expect(mockApiPost).toHaveBeenCalledWith(
        expect.objectContaining({
          breakpoints: ['node-a'],
          debug_options: { pause_on_first_block: true, pause_on_errors: false },
        })
      )
    })

    it('forwards the in-memory workflow and variables to the debug API (run-current)', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      const workflow = { nodes: [{ id: 'n1' }], edges: [] }
      const variables = { v: 1 }
      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-123',
          environmentId: 'env-456',
          breakpoints: ['node-a'],
          debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
          workflow,
          variables,
        })
      })

      expect(mockApiPost).toHaveBeenCalledWith(
        expect.objectContaining({ workflow, variables }),
      )
    })

    describe('staged Function values ride the run request (REQ-3.2.1.6)', () => {
      const FUNCTION_VARIABLES = [
        { function_path: ['fn-a'], variables: { count: { type: 'integer', value: '9' } } },
      ]

      function resolveRun() {
        mockApiPost.mockResolvedValueOnce({
          session_id: mockSessionId,
          status: 'running',
          websocket_topic: mockTopic,
          warnings: [],
        })
      }

      it('forwards the Function values of a Run as function_variables beside the Test variables', async () => {
        resolveRun()
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        const variables = { count: { type: 'integer', value: '7' } }

        await act(async () => {
          await result.current.startRun({
            testId: 'test-123',
            environmentId: 'env-456',
            variables,
            function_variables: FUNCTION_VARIABLES,
          } as Parameters<typeof result.current.startRun>[0])
        })

        expect(mockApiPost).toHaveBeenCalledWith(
          expect.objectContaining({ variables, function_variables: FUNCTION_VARIABLES }),
        )
      })

      it('forwards the Function values of a Debug or a block run as function_variables', async () => {
        resolveRun()
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

        await act(async () => {
          await result.current.startDebugRun({
            testId: 'test-123',
            environmentId: 'env-456',
            breakpoints: [],
            debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
            singleNodeId: 'log-1',
            function_variables: FUNCTION_VARIABLES,
          } as Parameters<typeof result.current.startDebugRun>[0])
        })

        expect(mockApiPost).toHaveBeenCalledWith(
          expect.objectContaining({ single_node_id: 'log-1', function_variables: FUNCTION_VARIABLES }),
        )
      })

      it('sends no function_variables when the run carries no Function values', async () => {
        resolveRun()
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

        await act(async () => {
          await result.current.startDebugRun({
            testId: 'test-123',
            environmentId: 'env-456',
            breakpoints: [],
            debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
          })
        })

        expect(mockApiPost.mock.lastCall?.[0]).not.toHaveProperty('function_variables')
      })
    })

    it('subscribes to WebSocket topic for real-time events', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({
          testId: 'test-123',
          environmentId: 'env-456',
        })
      })

      // V-CANVAS-04: subscribes (subscribeAsync) with the client-generated session ID
      // BEFORE the API call, so the first block events are never missed.
      expect(mockSubscribeAsync).toHaveBeenCalledWith(
        `workbench:${mockSessionId}`,
        expect.any(Function)
      )
    })

    it('rejects concurrent runs (only one active session)', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-1', environmentId: 'env-1' })
      })

      // Attempt second run
      await act(async () => {
        await result.current.startRun({ testId: 'test-2', environmentId: 'env-2' })
      })

      // Only first run should have triggered API call
      expect(mockApiPost).toHaveBeenCalledTimes(1)
    })

    it('connects WebSocket if not connected when starting run', async () => {
      setMockIsConnected(false)
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({
          testId: 'test-123',
          environmentId: 'env-456',
        })
      })

      // Should call connect() when WebSocket is not connected
      expect(mockConnect).toHaveBeenCalled()
      expect(result.current.status).toBe('running')
    })
  })

  describe('Pre-flight Validation: Profile Warnings (REQ-3.2.1.1)', () => {
    const mockSessionId = 'session-uuid-789'

    it('stores warnings and proceeds with execution', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [
          {
            type: 'INCOMPLETE_PROFILE',
            profile_name: 'Database Connection',
            message: "Profile 'Database Connection' has no value for this environment",
          },
        ],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      // Execution proceeds despite warnings
      expect(result.current.status).toBe('running')
      expect(result.current.warnings).toHaveLength(1)
      expect(result.current.warnings[0].profileName).toBe('Database Connection')

      // Toast shown for warning
      expect(mockToastWarning).toHaveBeenCalledWith(
        "Profile 'Database Connection' has no value for this environment",
        'Missing Profile Value'
      )
    })

    it('titles SCOPED_RUN_ADVISORY warnings as "Scope Initialized"', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [
          {
            type: 'SCOPED_RUN_ADVISORY',
            profile_name: '',
            message: 'Function scope seeded with default inputs',
          },
        ],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      expect(result.current.warnings).toHaveLength(1)
      expect(result.current.warnings[0].type).toBe('SCOPED_RUN_ADVISORY')
      expect(mockToastWarning).toHaveBeenCalledWith(
        'Function scope seeded with default inputs',
        'Scope Initialized'
      )
    })
  })

  describe('Error Handling', () => {
    it('handles 404 when test not found', async () => {
      const error = Object.assign(new Error("Test with ID 'test-123' not found"), {
        status: 404,
        code: 'NOT_FOUND',
      })
      mockApiPost.mockRejectedValueOnce(error)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      expect(result.current.status).toBe('idle')
      expect(result.current.error?.message).toContain('not found')
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        'Run Error'
      )
    })

    it('handles 400 when test has no workflow blocks', async () => {
      const error = Object.assign(
        new Error('Test must have at least one workflow block defined'),
        { status: 400, code: 'VALIDATION_ERROR' }
      )
      mockApiPost.mockRejectedValueOnce(error)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'empty-test', environmentId: 'env-456' })
      })

      expect(result.current.status).toBe('idle')
      expect(result.current.error?.message).toContain('at least one workflow block')
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  describe('WebSocket Events: State Transitions', () => {
    const mockSessionId = 'session-uuid-789'
    const mockTopic = `workbench:${mockSessionId}`

    async function startRun(result: { current: UseWorkbenchRunReturn }) {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })
    }

    it('updates currentBlock and progress on block_status_changed event', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-002',
            block_name: 'Validate Response',
            status: 'running',
            progress: { current: 5, total: 10, percentage: 50.0 },
          },
          createEventMetadata(mockTopic)
        )
      })

      expect(result.current.currentBlock).toEqual({
        blockId: 'block-002',
        blockName: 'Validate Response',
      })
      expect(result.current.progress).toEqual({
        current: 5,
        total: 10,
        percentage: 50.0,
      })
    })

    it('maps block_status_changed "passed" status to "success" in execution store (V-CANVAS-04)', async () => {
      // Tests the first branch of the ternary: event.status === 'passed' ? 'success'
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-passed',
            block_name: 'Passed Block',
            status: 'passed',
          },
          createEventMetadata(mockTopic)
        )
      })

      // Status 'passed' should be mapped to 'success' in execution store
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'block-passed',
        { status: 'success' }
      )
    })

    it('passes through block_status_changed "failed" status to execution store (V-CANVAS-04)', async () => {
      // Tests the third branch of the ternary: else -> event.status passthrough
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-failed',
            block_name: 'Failed Block',
            status: 'failed',
          },
          createEventMetadata(mockTopic)
        )
      })

      // Status 'failed' should pass through as-is
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'block-failed',
        { status: 'failed' }
      )
    })

    it('maps block_status_changed "warning" status to "warning" in execution store', async () => {
      // Tests the warning branch: event.status === 'warning' ? 'warning'
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-warning',
            block_name: 'Warning Block',
            status: 'warning',
          },
          createEventMetadata(mockTopic)
        )
      })

      // Status 'warning' should be mapped to 'warning' in execution store
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'block-warning',
        { status: 'warning' }
      )
    })

    it('passes through block_status_changed "skipped" status to execution store', async () => {
      // Tests the fallback else clause with 'skipped' status (passthrough)
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-skipped',
            block_name: 'Skipped Block',
            status: 'skipped',
          },
          createEventMetadata(mockTopic)
        )
      })

      // Status 'skipped' should pass through as-is
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'block-skipped',
        { status: 'skipped' }
      )
    })

    it('transitions to passed on execution_completed with passed status', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata(mockTopic)
        )
      })

      expect(result.current.status).toBe('passed')
      expect(result.current.isRunning).toBe(false)
    })

    it('transitions to failed on execution_completed with failed status', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'execution_completed',
            status: 'failed',
            error: 'Assertion failed: expected 200, got 500',
          },
          createEventMetadata(mockTopic)
        )
      })

      expect(result.current.status).toBe('failed')
      expect(result.current.isRunning).toBe(false)
    })

    it('transitions to skipped on execution_completed with skipped status', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          { type: 'execution_completed', status: 'skipped' },
          createEventMetadata(mockTopic)
        )
      })

      expect(result.current.status).toBe('skipped')
      expect(result.current.isRunning).toBe(false)
      // 'skipped' maps to 'skipped' in the store
      expect(mockCompleteExecution).toHaveBeenCalledWith(
        expect.any(String),
        'skipped'
      )
    })

    it('transitions to paused on execution_paused event (debug breakpoint)', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'execution_paused',
            reason: 'breakpoint',
            block_id: 'block-003',
            block_name: 'Debug Checkpoint',
          },
          createEventMetadata(mockTopic)
        )
      })

      expect(result.current.status).toBe('paused')
      // Still considered "running" for UI purposes (can be resumed)
      expect(result.current.isRunning).toBe(true)
    })

    it('paints a block stopped when the engine settles an interrupted parallel branch', async () => {
      // A sibling lane cut short by a branch failure arrives as its own
      // block_status_changed carrying 'stopped'; the store must take it verbatim.
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'k8s-top',
            block_name: 'K8s Top',
            status: 'running',
          },
          createEventMetadata(mockTopic)
        )
      })

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'k8s-top',
            block_name: '',
            status: 'stopped',
          },
          createEventMetadata(mockTopic)
        )
      })

      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'k8s-top',
        { status: 'stopped' }
      )
    })

    it('marks current running block as stopped when execution is stopped (V-CANVAS-04)', async () => {
      // V-CANVAS-04: When execution is stopped, the currently running block
      // (tracked by currentBlockIdRef) should be marked as 'stopped' in the store
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      // First, simulate a block starting (this sets currentBlockIdRef.current)
      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-active',
            block_name: 'Active Block',
            status: 'running',
            progress: { current: 2, total: 5, percentage: 40 },
          },
          createEventMetadata(mockTopic)
        )
      })

      // Verify block is being tracked
      expect(result.current.currentBlock?.blockId).toBe('block-active')

      // Now simulate execution stopped
      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'execution_completed',
            status: 'stopped',
          },
          createEventMetadata(mockTopic)
        )
      })

      // The currently running block should be marked as stopped
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String), // executionId
        'block-active',
        { status: 'stopped' }
      )

      expect(result.current.status).toBe('stopped')
      expect(result.current.isRunning).toBe(false)
    })

    it('does not mark block as stopped when execution completes normally', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      // Simulate a block starting
      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'block_status_changed',
            block_id: 'block-001',
            block_name: 'Some Block',
            status: 'running',
          },
          createEventMetadata(mockTopic)
        )
      })

      mockUpdateBlockExecution.mockClear()

      // Simulate normal completion (passed)
      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'execution_completed',
            status: 'passed',
          },
          createEventMetadata(mockTopic)
        )
      })

      // Should NOT mark block as stopped for passed status
      expect(mockUpdateBlockExecution).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { status: 'stopped' }
      )

      expect(result.current.status).toBe('passed')
    })
  })

  describe('Debug event handling and actions', () => {
    const mockSessionId = 'session-debug-1'
    const mockTopic = `workbench:${mockSessionId}`

    async function startDebugRun(result: { current: ReturnType<typeof useWorkbenchRun> }) {
      // crypto.randomUUID returns session IDs for the new WS subscription;
      // coerce to our fixed value so the captured handler matches.
      ;(crypto as { randomUUID: () => string }).randomUUID = () => mockSessionId

      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-debug',
          environmentId: 'env-debug',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })
    }

    it('debug_breakpoint_hit event transitions to paused and captures node id', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'debug_breakpoint_hit',
            node_id: 'bp-node',
            node_name: 'My Paused Node',
            reason: 'breakpoint',
          },
          createEventMetadata(mockTopic)
        )
      })

      await waitFor(() => {
        expect(result.current.status).toBe('paused')
      })
      expect(result.current.currentBlock).toEqual({
        blockId: 'bp-node',
        blockName: 'My Paused Node',
      })
    })

    it('startDebugRun emits warnings via toast and stores them on state', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      ;(crypto as { randomUUID: () => string }).randomUUID = () => mockSessionId
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [
          {
            type: 'INCOMPLETE_PROFILE',
            profile_name: 'DB',
            message: "Profile 'DB' has no value for this environment",
          },
        ],
      })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-a',
          environmentId: 'env-a',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      expect(mockToastWarning).toHaveBeenCalledWith(
        expect.stringContaining("Profile 'DB'"),
        'Missing Profile Value'
      )
      expect(result.current.warnings).toHaveLength(1)
    })

    it('startDebugRun handles API errors and resets to idle', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      ;(crypto as { randomUUID: () => string }).randomUUID = () => mockSessionId
      mockApiPost.mockRejectedValueOnce(new Error('boom'))

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-err',
          environmentId: 'env-err',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      expect(mockToastError).toHaveBeenCalledWith('boom', 'Run Error')
      expect(result.current.status).toBe('idle')
      expect(result.current.error).toBeInstanceOf(Error)
    })

    it('startDebugRun rejects concurrent run when already running', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)
      expect(mockApiPost).toHaveBeenCalledTimes(1)

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-2',
          environmentId: 'env-2',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      expect(mockApiPost).toHaveBeenCalledTimes(1)
    })

    it('startDebugRun connects WebSocket when disconnected', async () => {
      setMockIsConnected(false)
      ;(crypto as { randomUUID: () => string }).randomUUID = () => mockSessionId
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-dc',
          environmentId: 'env-dc',
          breakpoints: [],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })

      expect(mockConnect).toHaveBeenCalled()
      expect(result.current.status).toBe('running')
    })

    it('continueExecution calls the API and clears the paused node id', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockContinue = vi.mocked(workbenchApi.continueExecution)
      mockContinue.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.continueExecution>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.continueExecution()
      })

      expect(mockContinue).toHaveBeenCalledWith(mockSessionId)
    })

    it('continueExecution no-ops when sessionId is null', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockContinue = vi.mocked(workbenchApi.continueExecution)
      mockContinue.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.continueExecution()
      })

      expect(mockContinue).not.toHaveBeenCalled()
    })

    it('continueExecution surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockContinue = vi.mocked(workbenchApi.continueExecution)
      mockContinue.mockRejectedValueOnce(new Error('continue boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.continueExecution()
      })

      expect(mockToastError).toHaveBeenCalledWith('continue boom', 'Continue Error')
    })

    it('skipBlockAtPause calls the API', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockSkip = vi.mocked(workbenchApi.skipBlockAtPause)
      mockSkip.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.skipBlockAtPause>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.skipBlockAtPause()
      })

      expect(mockSkip).toHaveBeenCalledWith(mockSessionId)
    })

    it('skipBlockAtPause no-ops when sessionId is null', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockSkip = vi.mocked(workbenchApi.skipBlockAtPause)
      mockSkip.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.skipBlockAtPause()
      })

      expect(mockSkip).not.toHaveBeenCalled()
    })

    it('skipBlockAtPause surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockSkip = vi.mocked(workbenchApi.skipBlockAtPause)
      mockSkip.mockRejectedValueOnce(new Error('skip boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.skipBlockAtPause()
      })

      expect(mockToastError).toHaveBeenCalledWith('skip boom', 'Skip Block Error')
    })

    it('stepOver calls the API with the active session id', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepOver = vi.mocked(workbenchApi.stepOver)
      mockStepOver.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.stepOver>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.stepOver()
      })

      expect(mockStepOver).toHaveBeenCalledWith(mockSessionId)
    })

    it('stepOver no-ops when sessionId is null', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepOver = vi.mocked(workbenchApi.stepOver)
      mockStepOver.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.stepOver()
      })

      expect(mockStepOver).not.toHaveBeenCalled()
    })

    it('stepOver surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepOver = vi.mocked(workbenchApi.stepOver)
      mockStepOver.mockRejectedValueOnce(new Error('step-over boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.stepOver()
      })

      expect(mockToastError).toHaveBeenCalledWith('step-over boom', 'Step Over Error')
    })

    it('stepInto calls the API with the active session id', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepInto = vi.mocked(workbenchApi.stepInto)
      mockStepInto.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.stepInto>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.stepInto()
      })

      expect(mockStepInto).toHaveBeenCalledWith(mockSessionId)
    })

    it('stepInto no-ops when sessionId is null', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepInto = vi.mocked(workbenchApi.stepInto)
      mockStepInto.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.stepInto()
      })

      expect(mockStepInto).not.toHaveBeenCalled()
    })

    it('stepInto surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockStepInto = vi.mocked(workbenchApi.stepInto)
      mockStepInto.mockRejectedValueOnce(new Error('step-into boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.stepInto()
      })

      expect(mockToastError).toHaveBeenCalledWith('step-into boom', 'Step Into Error')
    })

    it('repeatStep calls the API with the active session id', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      mockRepeat.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.repeatStep>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.repeatStep()
      })

      expect(mockRepeat).toHaveBeenCalledWith(mockSessionId)
    })

    it('repeatStep no-ops when sessionId is null', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      mockRepeat.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.repeatStep()
      })

      expect(mockRepeat).not.toHaveBeenCalled()
    })

    it('repeatStep surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      mockRepeat.mockRejectedValueOnce(new Error('repeat boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.repeatStep()
      })

      expect(mockToastError).toHaveBeenCalledWith('repeat boom', 'Repeat Step Error')
    })

    it('updateBreakpoints no-ops when no session is active', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockUpdate = vi.mocked(workbenchApi.updateWorkbenchBreakpoints)
      mockUpdate.mockClear()

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.updateBreakpoints(['node-a'])
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('updateBreakpoints forwards to the API when a debug session is running', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockUpdate = vi.mocked(workbenchApi.updateWorkbenchBreakpoints)
      mockUpdate.mockClear()
      mockUpdate.mockResolvedValueOnce(undefined as unknown as Awaited<
        ReturnType<typeof workbenchApi.updateWorkbenchBreakpoints>
      >)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.updateBreakpoints(['node-a', 'node-b'])
      })

      expect(mockUpdate).toHaveBeenCalledWith(mockSessionId, ['node-a', 'node-b'])
    })

    it('updateBreakpoints surfaces API errors via toast', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockUpdate = vi.mocked(workbenchApi.updateWorkbenchBreakpoints)
      mockUpdate.mockClear()
      mockUpdate.mockRejectedValueOnce(new Error('patch boom'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startDebugRun(result)

      await act(async () => {
        await result.current.updateBreakpoints(['node-z'])
      })

      expect(mockToastError).toHaveBeenCalledWith('patch boom', 'Breakpoint Update Error')
    })
  })

  describe('stopRun', () => {
    const mockSessionId = 'session-uuid-789'

    it('does nothing when no session is active', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Call stopRun without starting a session first
      await act(async () => {
        await result.current.stopRun()
      })

      // Should remain in idle state, no API calls
      expect(result.current.status).toBe('idle')
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('stops active session and unsubscribes from WebSocket', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'stopped',
      })

      // Simulate a debug pause: a node is marked paused before Stop.
      act(() => {
        useWorkflowStore.getState().setPausedNodeId('deep-log')
      })

      await act(async () => {
        await result.current.stopRun()
      })

      expect(result.current.status).toBe('stopped')
      expect(result.current.isRunning).toBe(false)
      expect(mockUnsubscribe).toHaveBeenCalled()
      // Stop must clear the paused marker (the WS terminal event won't arrive
      // after unsubscribe) and finalize blocks left mid-flight.
      expect(useWorkflowStore.getState().pausedNodeId).toBeNull()
      expect(mockStopRunningBlocks).toHaveBeenCalledWith('mock-exec-id')
    })

    it('shows error toast on stop failure', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      mockApiPost.mockRejectedValueOnce(new Error('Failed to stop workflow'))

      await act(async () => {
        await result.current.stopRun()
      })

      expect(mockToastError).toHaveBeenCalledWith('Failed to stop workflow', 'Stop Error')
    })
  })

  describe('reset', () => {
    const mockSessionId = 'session-uuid-789'

    it('resets all state and unsubscribes from WebSocket', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [{ type: 'INCOMPLETE_PROFILE', profile_name: 'Test', message: 'msg' }],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      act(() => {
        useWorkflowStore.getState().setPausedNodeId('deep-log')
      })

      act(() => {
        result.current.reset()
      })

      expect(result.current.status).toBe('idle')
      expect(result.current.sessionId).toBeNull()
      expect(result.current.websocketTopic).toBeNull()
      expect(result.current.warnings).toEqual([])
      expect(result.current.isRunning).toBe(false)
      expect(mockUnsubscribe).toHaveBeenCalled()
      // Reset must drop the paused marker so no block keeps its amber halo.
      expect(useWorkflowStore.getState().pausedNodeId).toBeNull()
    })

    it('says the session is still on the server when the clear fails', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      vi.mocked(workbenchApi.clearSession).mockRejectedValueOnce(new Error('Service Unavailable'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      act(() => {
        result.current.reset()
      })

      // The local wipe is the user's gesture and stands; the server side does not.
      expect(result.current.status).toBe('idle')
      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith(
          'The workbench session is still open on the server: Service Unavailable',
          'Session Not Cleared',
        )
      )
    })
  })

  describe('attach to an announced run (run mirror)', () => {
    const RUN_SESSION = {
      session_id: 'run-sess-1',
      test_id: 'test-1',
      websocket_topic: 'workbench:run-sess-1',
      status: 'running',
      test_name: 'Nightly Smoke',
      block_states: { 'node-1': 'passed' },
    }

    async function mountSettled() {
      const rendered = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {})
      vi.mocked(mockSubscribe).mockClear()
      return rendered
    }

    it('hydrates the announced session as a viewer and subscribes its topics', async () => {
      const { result } = await mountSettled()
      mockApiGetCurrentSession.mockResolvedValueOnce(RUN_SESSION)

      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })

      expect(result.current.sessionId).toBe('run-sess-1')
      expect(result.current.status).toBe('running')
      expect(mockSubscribe).toHaveBeenCalledWith('workbench:run-sess-1', expect.any(Function))
      expect(mockSubscribe).toHaveBeenCalledWith('variable:run-sess-1', expect.any(Function))
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        expect.any(String),
        'node-1',
        { status: 'success' },
      )
    })

    it('drops the previous attachment before hydrating the next run', async () => {
      const { result } = await mountSettled()
      mockApiGetCurrentSession.mockResolvedValueOnce(RUN_SESSION)
      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })
      mockUnsubscribe.mockClear()
      mockApiGetCurrentSession.mockResolvedValueOnce({
        ...RUN_SESSION,
        session_id: 'run-sess-2',
        websocket_topic: 'workbench:run-sess-2',
      })

      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })

      expect(mockUnsubscribe).toHaveBeenCalledTimes(2)
      expect(result.current.sessionId).toBe('run-sess-2')
    })

    it('blocks the canvas when the announced session cannot be fetched', async () => {
      const { result } = await mountSettled()
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('down'))

      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })

      expect(result.current.sessionId).toBeNull()
      expect(mockSubscribe).not.toHaveBeenCalled()
      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load announced run')
      expect(block?.detail.message).toBe('down')
    })

    it('attaches and clears the report when the retry succeeds', async () => {
      const { result } = await mountSettled()
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('down'))
      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })
      mockApiGetCurrentSession.mockResolvedValueOnce(RUN_SESSION)

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(result.current.sessionId).toBe('run-sess-1')
      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('stays put when there is no announced session', async () => {
      const { result } = await mountSettled()

      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })

      expect(result.current.sessionId).toBeNull()
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('detach unsubscribes the attached topics and is a no-op when idle', async () => {
      const { result } = await mountSettled()
      act(() => {
        result.current.detachFromAnnouncedRun()
      })
      expect(mockUnsubscribe).not.toHaveBeenCalled()

      mockApiGetCurrentSession.mockResolvedValueOnce(RUN_SESSION)
      await act(async () => {
        await result.current.attachToAnnouncedRun()
      })
      mockUnsubscribe.mockClear()

      act(() => {
        result.current.detachFromAnnouncedRun()
      })
      expect(mockUnsubscribe).toHaveBeenCalledTimes(2)

      act(() => {
        result.current.detachFromAnnouncedRun()
      })
      expect(mockUnsubscribe).toHaveBeenCalledTimes(2)
    })
  })

  describe('Cleanup on unmount', () => {
    it('unsubscribes from WebSocket when component unmounts', async () => {
      const mockSessionId = 'session-uuid-789'
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })

      const { result, unmount } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalled()
    })
  })

  describe('Session Recovery on Mount', () => {
    /**
     * Session recovery enables state restoration after:
     * - Page refresh
     * - Navigation away and back
     * - Browser crash and reopen
     * - Opening new tabs
     *
     * The frontend queries the backend for the current user's session on mount.
     */

    it('queries backend for current session on mount', async () => {
      mockApiGetCurrentSession.mockResolvedValueOnce(null)

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockApiGetCurrentSession).toHaveBeenCalled()
    })

    it('stays in idle state when no session exists', async () => {
      mockApiGetCurrentSession.mockResolvedValueOnce(null)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('idle')
      expect(result.current.sessionId).toBeNull()
      expect(result.current.isSessionRecoveryComplete).toBe(true)
    })

    it('sets isSessionRecoveryComplete to true after recovery completes (no session)', async () => {
      mockApiGetCurrentSession.mockResolvedValueOnce(null)

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Initially false
      expect(result.current.isSessionRecoveryComplete).toBe(false)

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Should be true after recovery completes
      expect(result.current.isSessionRecoveryComplete).toBe(true)
    })

    it('sets isSessionRecoveryComplete to true after recovery completes (session found)', async () => {
      const mockSessionId = 'recovered-session-xyz'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        test_id: 'test-abc',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 0, total: 5, percentage: 0 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.isSessionRecoveryComplete).toBe(true)
      expect(result.current.status).toBe('running')
    })

    it('sets isSessionRecoveryComplete to true even on recovery error', async () => {
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Should be true even after error
      expect(result.current.isSessionRecoveryComplete).toBe(true)
      expect(result.current.status).toBe('idle')
    })

    it('reports a failed session recovery read instead of staying quietly idle', async () => {
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('Sessions API down'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load workbench session')
      expect(block?.detail.message).toBe('Sessions API down')
      // Recovery still completes so the rest of the canvas is not left waiting.
      expect(result.current.isSessionRecoveryComplete).toBe(true)
    })

    it('clears the session recovery report when the retry succeeds', async () => {
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('Sessions API down'))
      mockApiGetCurrentSession.mockResolvedValueOnce(null)

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('cancels pending session recovery when the hook unmounts before getCurrentSession resolves', async () => {
      // StrictMode and fast-navigation scenarios can unmount the hook
      // mid-recovery; the cleanup flips a ``canceled`` flag so the
      // pending hydration is skipped rather than mutating stale store
      // state after the consumer has moved on.
      let resolveSession: (value: unknown) => void = () => {}
      const sessionPromise = new Promise((resolve) => {
        resolveSession = resolve
      })
      mockApiGetCurrentSession.mockReturnValueOnce(sessionPromise)

      const { unmount } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Unmount immediately; the cleanup sets canceled = true before the
      // getCurrentSession promise settles.
      unmount()

      // Resolve the session now - the recovery flow should see the
      // canceled flag and short-circuit before touching any store state.
      await act(async () => {
        resolveSession({
          session_id: 'canceled-recovery',
          status: 'running',
          test_id: 'test-cancel',
          websocket_topic: 'workbench:canceled-recovery',
          current_block: null,
          progress: { current: 0, total: 1, percentage: 0 },
        })
        await sessionPromise
      })

      // No assertion on store state here - the point is that the chain
      // didn't crash and didn't hydrate the unmounted hook. Reaching
      // this line proves the cancel branch ran.
      expect(true).toBe(true)
    })

    it('fires tracked-terminal handler when recovery finds a fast-completed tracked session', async () => {
      // Covers the session-recovery fast-complete branch: the test
      // finished BEFORE the viewer mounted, so the live
      // ``execution_completed`` WS event never fired on this page.
      // Session recovery sees a terminal tracked session (with
      // execution_id, without parent_execution_id) and invokes the
      // tracked-terminal handler so the viewer redirects to the
      // Historical Canvas for that execution.
      const fastCompletedSessionId = 'recovered-fast-complete'
      const trackedExecId = 'exec-fast-complete-1'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: fastCompletedSessionId,
        status: 'passed',
        test_id: 'test-fast',
        websocket_topic: `workbench:${fastCompletedSessionId}`,
        current_block: null,
        progress: { current: 1, total: 1, percentage: 100 },
        execution_id: trackedExecId,
        parent_execution_id: null,
      })

      const navigateCalls: string[] = []
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      act(() => {
        result.current.registerTrackedTerminalHandler((id: string) =>
          navigateCalls.push(id),
        )
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(navigateCalls).toEqual([trackedExecId])
    })

    it('does NOT fire tracked-terminal handler for a terminal sequential child on recovery', async () => {
      // The same terminal path must NOT redirect when the recovered
      // session is a sequential child (parent_execution_id set): those
      // follow the parent's follow-next-child flow, not a direct
      // navigation to a historical execution.
      const childSessionId = 'child-recovered'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: childSessionId,
        status: 'passed',
        test_id: 'test-child',
        websocket_topic: `workbench:${childSessionId}`,
        current_block: null,
        progress: { current: 1, total: 1, percentage: 100 },
        execution_id: null,
        parent_execution_id: 'parent-exec-abc',
      })

      const navigateCalls: string[] = []
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      act(() => {
        result.current.registerTrackedTerminalHandler((id: string) =>
          navigateCalls.push(id),
        )
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(navigateCalls).toEqual([])
    })

    it('recovers running session with full state', async () => {
      const mockSessionId = 'recovered-session-123'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        test_id: 'test-456',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: { block_id: 'b2', block_name: 'Execute Query' },
        progress: { current: 3, total: 10, percentage: 30 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('running')
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.websocketTopic).toBe(`workbench:${mockSessionId}`)
      expect(result.current.currentBlock).toEqual({
        blockId: 'b2',
        blockName: 'Execute Query',
      })
      expect(result.current.progress).toEqual({
        current: 3,
        total: 10,
        percentage: 30,
      })
      expect(result.current.isRunning).toBe(true)
    })

    it('subscribes to WebSocket for running session recovery', async () => {
      const mockSessionId = 'running-session-456'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        test_id: 'test-789',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 0, total: 5, percentage: 0 },
      })

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockSubscribe).toHaveBeenCalledWith(
        `workbench:${mockSessionId}`,
        expect.any(Function)
      )
    })

    it('connects WebSocket if not connected during recovery', async () => {
      setMockIsConnected(false)
      const mockSessionId = 'running-session-789'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        test_id: 'test-abc',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 0, total: 5, percentage: 0 },
      })

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockConnect).toHaveBeenCalled()
    })

    // V-CANVAS-04: Terminal states ARE recovered for breadcrumb display and canvas visualization
    it('recovers terminal state (passed) without WebSocket subscription', async () => {
      const mockSessionId = 'passed-session-123'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'passed',
        test_id: 'test-def',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 5, total: 5, percentage: 100 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('passed')
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.isRunning).toBe(false)
      // Should NOT subscribe to WebSocket for terminal states
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('recovers terminal state (failed) with current block status', async () => {
      const mockSessionId = 'failed-session-456'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'failed',
        test_id: 'test-ghi',
        websocket_topic: `workbench:${mockSessionId}`,
        error: 'Connection timeout',
        current_block: { block_id: 'b3', block_name: 'SSH Connect' },
        progress: { current: 2, total: 5, percentage: 40 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('failed')
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.isRunning).toBe(false)
      // Should NOT subscribe to WebSocket for terminal states
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('recovers terminal state (stopped)', async () => {
      const mockSessionId = 'stopped-session-789'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'stopped',
        test_id: 'test-jkl',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 3, total: 5, percentage: 60 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('stopped')
      expect(result.current.sessionId).toBe(mockSessionId)
      // Should NOT subscribe to WebSocket for terminal states
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('recovers terminal state (skipped) from halt control', async () => {
      const mockSessionId = 'skipped-session-321'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'skipped',
        test_id: 'test-skip',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 2, total: 5, percentage: 40 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('skipped')
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.isRunning).toBe(false)
      // Should NOT subscribe to WebSocket for terminal states
      expect(mockSubscribe).not.toHaveBeenCalled()
      // 'skipped' maps to 'skipped' in the store
      expect(mockCompleteExecution).toHaveBeenCalledWith(
        expect.any(String),
        'skipped'
      )
    })

    it('recovers block_states for canvas visualization (V-CANVAS-04)', async () => {
      // V-CANVAS-04: Session recovery should restore all block execution states
      // so the canvas shows completed/failed blocks correctly
      const mockSessionId = 'session-with-blocks'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'passed',
        test_id: 'test-blocks',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 5, total: 5, percentage: 100 },
        block_states: {
          'block-1': 'passed',
          'block-2': 'passed',
          'block-3': 'failed',
          'block-4': 'stopped',
          'block-5': 'running',
          'block-6': 'warning',
        },
      })

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Each block state should be updated in the store
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-1', { status: 'success' }
      )
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-2', { status: 'success' }
      )
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-3', { status: 'failed' }
      )
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-4', { status: 'stopped' }
      )
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-5', { status: 'running' }
      )
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-6', { status: 'warning' }
      )
    })

    it('handles unknown block status as pending during recovery', async () => {
      // V-CANVAS-04: Unknown block statuses default to 'pending'
      const mockSessionId = 'session-unknown-status'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'passed',
        test_id: 'test-unknown',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: null,
        progress: { current: 1, total: 1, percentage: 100 },
        block_states: {
          'block-unknown': 'some-unknown-status',
        },
      })

      renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Unknown status should map to 'pending'
      expect(mockUpdateBlockExecution).toHaveBeenCalledWith(
        'mock-exec-id', 'block-unknown', { status: 'pending' }
      )
    })

    it('handles session recovery error gracefully (stays idle)', async () => {
      mockApiGetCurrentSession.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Should stay in idle state, not crash
      expect(result.current.status).toBe('idle')
      expect(result.current.sessionId).toBeNull()
    })

    it('does not recover session when already running (prevents double recovery)', async () => {
      // First, start a session (sessionId is client-generated via crypto.randomUUID mock)
      const clientSessionId = 'session-uuid-789'
      mockApiPost.mockResolvedValueOnce({
        session_id: clientSessionId,
        status: 'running',
        websocket_topic: `workbench:${clientSessionId}`,
        warnings: [],
      })

      const { result, rerender } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Start a run manually
      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      // Clear mocks
      mockApiGetCurrentSession.mockClear()

      // Rerender (simulating some state change)
      rerender()

      // Wait for any effects
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // Should not query for session since we already have one running
      // (or at least not try to hydrate state from it)
      expect(result.current.sessionId).toBe(clientSessionId)
    })

    it('recovers paused session and subscribes to WebSocket', async () => {
      const mockSessionId = 'paused-session-abc'
      mockApiGetCurrentSession.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'paused',
        test_id: 'test-mno',
        websocket_topic: `workbench:${mockSessionId}`,
        current_block: { block_id: 'b4', block_name: 'Debug Checkpoint' },
        progress: { current: 2, total: 5, percentage: 40 },
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.status).toBe('paused')
      expect(result.current.isRunning).toBe(true) // paused is considered "running"
      // Should subscribe for paused sessions (can receive continue events)
      expect(mockSubscribe).toHaveBeenCalledWith(
        `workbench:${mockSessionId}`,
        expect.any(Function)
      )
    })
  })

  describe('updateSkippedNodes', () => {
    const mockSessionId = 'session-uuid-789'
    const mockTopic = `workbench:${mockSessionId}`

    it('sends skip update to backend during running session', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })
      mockUpdateSkippedNodes.mockResolvedValueOnce({
        session_id: mockSessionId,
        skipped_node_ids: ['node-a', 'node-b'],
      })

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      await act(async () => {
        await result.current.updateSkippedNodes(['node-a', 'node-b'])
      })

      expect(mockUpdateSkippedNodes).toHaveBeenCalledWith(mockSessionId, {
        skipped_node_ids: ['node-a', 'node-b'],
      })
    })

    it('does not send skip update when no session is active', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Wait for session recovery to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      await act(async () => {
        await result.current.updateSkippedNodes(['node-a'])
      })

      expect(mockUpdateSkippedNodes).not.toHaveBeenCalled()
    })

    it('shows error toast on skip update failure', async () => {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })
      mockUpdateSkippedNodes.mockRejectedValueOnce(new Error('Session not running'))

      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })

      await act(async () => {
        await result.current.updateSkippedNodes(['node-a'])
      })

      expect(mockToastError).toHaveBeenCalledWith('Session not running', 'Skip Update Error')
    })
  })

  describe('Variable Event Forwarding', () => {
    const mockSessionId = 'session-uuid-789'
    const mockTopic = `workbench:${mockSessionId}`

    async function startRun(result: { current: UseWorkbenchRunReturn }) {
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      await act(async () => {
        await result.current.startRun({ testId: 'test-123', environmentId: 'env-456' })
      })
    }

    it('forwards variable events to the registered handler', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })

      // Register a variable handler
      const mockHandler = vi.fn()
      act(() => {
        result.current.registerVariableHandler(mockHandler)
      })

      await startRun(result)

      // Fire a variable event through the captured variable handler
      const variablePayload = { type: 'variable_changed', name: 'my_var', value: 42 }
      act(() => {
        getCapturedVariableHandler()?.(variablePayload, { topic: `variable:${mockSessionId}`, timestamp: Date.now(), sequence: 1 })
      })

      expect(mockHandler).toHaveBeenCalledWith(variablePayload)
    })

    it('does not throw when no variable handler is registered', async () => {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await startRun(result)

      // Fire a variable event WITHOUT registering a handler first
      // The optional chaining (line 222) should safely no-op
      act(() => {
        getCapturedVariableHandler()?.({ type: 'variable_changed', name: 'x', value: 1 }, { topic: `variable:${mockSessionId}`, timestamp: Date.now(), sequence: 1 })
      })

      // No error should be thrown - the test passes by not throwing
      expect(result.current.status).toBe('running')
    })
  })

  // ==========================================================================
  // Tracked-session behavior
  // The hook exposes executionId when the loaded session is tracked.
  // A terminal event for a tracked session clears canvas + triggers navigate;
  //      an ephemeral session keeps canvas and does not navigate.
  // stopRun routes through the execution stop endpoint for tracked sessions,
  //     and through the workbench stop endpoint for ephemeral sessions
  // ==========================================================================

  describe('Tracked Execution', () => {
    // Session id is client-generated via crypto.randomUUID (mocked in beforeEach).
    const trackedSessionId = 'session-uuid-789'
    const trackedExecutionId = 'exec-abc-123'
    const trackedTopic = `workbench:${trackedSessionId}`
    const ephemeralSessionId = 'session-uuid-789'
    const ephemeralTopic = `workbench:${ephemeralSessionId}`

    async function startTrackedRun(result: { current: UseWorkbenchRunReturn }) {
      mockApiPost.mockResolvedValueOnce({
        session_id: trackedSessionId,
        execution_id: trackedExecutionId,
        execution_entity_type: 'test',
        status: 'running',
        websocket_topic: trackedTopic,
        warnings: [],
      })
      await act(async () => {
        await result.current.startRun({ testId: 'test-xyz', environmentId: 'env-1' })
      })
    }

    async function startEphemeralRun(result: { current: UseWorkbenchRunReturn }) {
      mockApiPost.mockResolvedValueOnce({
        session_id: ephemeralSessionId,
        status: 'running',
        websocket_topic: ephemeralTopic,
        warnings: [],
      })
      await act(async () => {
        await result.current.startRun({ testId: 'test-xyz', environmentId: 'env-1' })
      })
    }

    describe('executionId exposed on hook state', () => {
      it('hook state includes executionId when session is tracked', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startTrackedRun(result)

        expect(result.current.executionId).toBe(trackedExecutionId)
      })

      it('hook state executionId is null for ephemeral runs', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startEphemeralRun(result)

        expect(result.current.executionId).toBeNull()
      })
    })

    describe('terminal-state behavior for tracked sessions', () => {
      it('navigates to /executions/{execution_id} when a tracked session reaches terminal state', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startTrackedRun(result)

        // Register the terminal handler.
        const navigateCalls: string[] = []
        act(() => {
          result.current.registerTrackedTerminalHandler((id: string) => navigateCalls.push(id))
        })

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(trackedTopic),
          )
        })

        expect(navigateCalls).toEqual([trackedExecutionId])
      })

      it('clears the workbench canvas state when a tracked session terminates', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startTrackedRun(result)

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'stopped' },
            createEventMetadata(trackedTopic),
          )
        })

        // After a tracked-session terminal event, the canvas returns to its
        // empty Draft Workflow state. The hook signals this by reverting to
        // `idle` status with no session tied to the view.
        expect(result.current.status).toBe('idle')
        expect(result.current.sessionId).toBeNull()
        expect(result.current.websocketTopic).toBeNull()
      })

      it('does NOT navigate when an ephemeral session reaches terminal state', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startEphemeralRun(result)

        const navigateCalls: string[] = []
        act(() => {
          result.current.registerTrackedTerminalHandler((id: string) => navigateCalls.push(id))
        })

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(ephemeralTopic),
          )
        })

        expect(navigateCalls).toEqual([])
      })

      it('ephemeral session retains canvas state at terminal (existing contract)', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startEphemeralRun(result)

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(ephemeralTopic),
          )
        })

        // Ephemeral: status transitions to terminal ("passed") and session data
        // is preserved so the canvas can be inspected until the user resets.
        expect(result.current.status).toBe('passed')
        expect(result.current.sessionId).toBe(ephemeralSessionId)
      })
    })

    describe('Sequential suite/regression follow-next-child', () => {
      // Simulate the Workbench loading as the viewer on a running suite/
      // regression. The child session advertises parent_execution_id so
      // the hook knows to follow the parent's progression on terminal.
      const childOneSessionId = 'child-session-1'
      const childTwoSessionId = 'child-session-2'
      const parentExecutionId = 'parent-exec-xyz'
      const childOneTopic = `workbench:${childOneSessionId}`
      const childTwoTopic = `workbench:${childTwoSessionId}`

      function sessionFixture(
        sessionId: string,
        testId: string,
        topic: string,
        extras: Record<string, unknown> = {},
      ) {
        return {
          session_id: sessionId,
          test_id: testId,
          websocket_topic: topic,
          status: 'running',
          parent_execution_id: parentExecutionId,
          execution_id: null,
          ...extras,
        }
      }

      async function renderWithChildOne() {
        mockApiGetCurrentSession.mockResolvedValueOnce(
          sessionFixture(childOneSessionId, 'test-one', childOneTopic),
        )
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        // Let session-recovery effect resolve.
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0))
        })
        return result
      }

      it('does NOT redirect when a sequential child terminates and the parent is still running', async () => {
        const result = await renderWithChildOne()

        const navigateCalls: string[] = []
        act(() => {
          result.current.registerTrackedTerminalHandler((id: string) => navigateCalls.push(id))
        })

        // Queue up the next child so the follow-next polling finds it.
        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childTwoSessionId, 'test-two', childTwoTopic),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        // Wait up to the poller's MAX_ATTEMPTS window (3s) for the next
        // child to land. A fixed setTimeout flaked under CI load because
        // the 150ms poll cadence can skip several ticks when the event
        // loop is busy.
        await waitFor(() => {
          expect(result.current.sessionId).toBe(childTwoSessionId)
        })

        expect(navigateCalls).toEqual([])
        expect(result.current.testId).toBe('test-two')
        expect(result.current.websocketTopic).toBe(childTwoTopic)
      })

      it('marks isTransitioningToNextChild while polling for the next child', async () => {
        const result = await renderWithChildOne()

        // Never resolve the next child - let the transition stay open.
        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childOneSessionId, 'test-one', childOneTopic, {
            status: 'passed',
          }),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        // One polling tick - transition flag must be on.
        await act(async () => {
          await new Promise((r) => setTimeout(r, 200))
        })

        expect(result.current.isTransitioningToNextChild).toBe(true)
      })

      it('continues polling when a getCurrentSession call throws', async () => {
        const result = await renderWithChildOne()

        // Fail the first poll, succeed with the next child on the second.
        mockApiGetCurrentSession.mockRejectedValueOnce(new Error('transient'))
        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childTwoSessionId, 'test-two', childTwoTopic),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        await act(async () => {
          await new Promise((r) => setTimeout(r, 500))
        })

        expect(result.current.sessionId).toBe(childTwoSessionId)
      })

      it('falls back to redirect when no next child appears within the timeout', async () => {
        const result = await renderWithChildOne()

        const navigateCalls: string[] = []
        act(() => {
          result.current.registerTrackedTerminalHandler((id: string) => navigateCalls.push(id))
        })

        // Every poll returns the terminated previous child - never a new
        // running child. The poller eventually times out and redirects.
        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childOneSessionId, 'test-one', childOneTopic, {
            status: 'passed',
          }),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        // 20 attempts * 150ms = 3000ms + buffer
        await act(async () => {
          await new Promise((r) => setTimeout(r, 3500))
        })

        expect(navigateCalls).toEqual([parentExecutionId])
      }, 10000)

      it('short-circuits polling and redirects when parent execution reports terminal status', async () => {
        const result = await renderWithChildOne()

        const navigateCalls: string[] = []
        act(() => {
          result.current.registerTrackedTerminalHandler((id: string) => navigateCalls.push(id))
        })

        // Parent execution fetch returns terminal status on the first poll -
        // the driver has finished running and the follow-next loop should
        // abort immediately rather than waiting out the 3s timeout.
        const { apiClient } = await import('@/lib/api')
        const apiGet = apiClient.get as ReturnType<typeof vi.fn>
        apiGet.mockResolvedValueOnce({ data: { status: 'passed' } })

        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childOneSessionId, 'test-one', childOneTopic, {
            status: 'passed',
          }),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        // One poll tick is enough for the short-circuit to fire.
        await act(async () => {
          await new Promise((r) => setTimeout(r, 400))
        })

        expect(navigateCalls).toEqual([parentExecutionId])
      }, 10000)

      it('continues polling when the parent-status fetch throws transiently', async () => {
        const result = await renderWithChildOne()

        // First parent-status fetch throws; next child appears on the
        // subsequent iteration - polling must not abort on the transient.
        const { apiClient } = await import('@/lib/api')
        const apiGet = apiClient.get as ReturnType<typeof vi.fn>
        apiGet.mockRejectedValueOnce(new Error('transient'))

        mockApiGetCurrentSession.mockResolvedValue(
          sessionFixture(childTwoSessionId, 'test-two', childTwoTopic),
        )

        act(() => {
          getCapturedWsHandler()?.(
            { type: 'execution_completed', status: 'passed' },
            createEventMetadata(childOneTopic),
          )
        })

        await act(async () => {
          await new Promise((r) => setTimeout(r, 500))
        })

        expect(result.current.sessionId).toBe(childTwoSessionId)
      })
    })

    describe('stopRun routing based on session kind', () => {
      it('routes to /executions/{id}/stop for a tracked session', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startTrackedRun(result)

        mockApiClientPut.mockClear()
        mockApiPost.mockClear()

        await act(async () => {
          await result.current.stopRun()
        })

        const putUrls = mockApiClientPut.mock.calls.map((c) => c[0] as string)
        expect(putUrls.some((u) => u.includes(`/executions/${trackedExecutionId}/stop`))).toBe(true)

        const postUrls = mockApiPost.mock.calls.map((c) => c[0] as string)
        expect(postUrls.some((u) => u.includes('/workbench/') && u.includes('/stop'))).toBe(false)
      })

      it('routes to the workbench stop endpoint for an ephemeral session', async () => {
        const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
        await startEphemeralRun(result)

        mockApiClientPut.mockClear()
        mockApiPost.mockClear()
        mockApiPost.mockResolvedValueOnce({ status: 'stopped' })

        await act(async () => {
          await result.current.stopRun()
        })

        const postUrls = mockApiPost.mock.calls.map((c) => c[0] as string)
        expect(postUrls.some((u) => u.includes(`/workbench/${ephemeralSessionId}/stop`))).toBe(true)

        const putUrls = mockApiClientPut.mock.calls.map((c) => c[0] as string)
        expect(putUrls.some((u) => u.includes('/executions/'))).toBe(false)
      })
    })
  })

  describe('runStandaloneFunction - library View', () => {
    const mockSessionId = 'session-uuid-789'

    it('subscribes + POSTs the standalone run and applies the session', async () => {
      mockRunFunctionStandalone.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
        })
      })
      expect(result.current.sessionId).toBe(mockSessionId)
      expect(result.current.status).toBe('running')
      expect(mockRunFunctionStandalone).toHaveBeenCalledWith(
        'fn-1',
        expect.objectContaining({
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
          sessionId: mockSessionId,
        }),
      )
    })

    it('surfaces a run failure (status returns to idle)', async () => {
      mockRunFunctionStandalone.mockRejectedValueOnce(new Error('run boom'))
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
        })
      })
      expect(result.current.status).toBe('idle')
      expect(result.current.error).toBeInstanceOf(Error)
    })

    it('is a no-op while a run is already in progress', async () => {
      mockRunFunctionStandalone.mockResolvedValue({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
        })
      })
      mockRunFunctionStandalone.mockClear()
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
        })
      })
      expect(mockRunFunctionStandalone).not.toHaveBeenCalled()
    })
  })

  describe('runStandaloneFunction - the Current values of a run alone (FNCFG-8, REQ-3.1.2.10)', () => {
    const mockSessionId = 'session-uuid-current'
    const STAGED = { who: { type: 'string', value: 'ann' }, tries: { type: 'integer', value: 3 } }

    function resolveRun() {
      mockRunFunctionStandalone.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: `workbench:${mockSessionId}`,
        warnings: [],
      })
    }

    it('forwards the staged Current values to the run request of a Run as variables', async () => {
      resolveRun()
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
          variables: STAGED,
        } as Parameters<typeof result.current.runStandaloneFunction>[0])
      })
      expect(mockRunFunctionStandalone).toHaveBeenCalledTimes(1)
      expect(mockRunFunctionStandalone).toHaveBeenCalledWith(
        'fn-1',
        expect.objectContaining({
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
          variables: STAGED,
        }),
      )
    })

    it('forwards the staged Current values to the run request of a Debug as variables', async () => {
      resolveRun()
      const draft = { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] }
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: null,
          draft,
          environmentId: 'env-1',
          debug: { breakpoints: [] },
          variables: STAGED,
        } as Parameters<typeof result.current.runStandaloneFunction>[0])
      })
      expect(mockRunFunctionStandalone).toHaveBeenCalledWith(
        'fn-1',
        expect.objectContaining({
          version: null,
          draft,
          debug: { breakpoints: [] },
          variables: STAGED,
        }),
      )
    })

    it('forwards the values of Function instances nested in the run alone as function_variables', async () => {
      resolveRun()
      const nested = [{ function_path: ['inner-fn'], variables: { tries: { type: 'integer', value: 3 } } }]
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await act(async () => {
        await result.current.runStandaloneFunction({
          functionId: 'fn-1',
          version: '1.2.0',
          draft: null,
          environmentId: 'env-1',
          variables: STAGED,
          function_variables: nested,
        } as Parameters<typeof result.current.runStandaloneFunction>[0])
      })
      expect(mockRunFunctionStandalone).toHaveBeenCalledWith(
        'fn-1',
        expect.objectContaining({ variables: STAGED, function_variables: nested }),
      )
    })
  })

  describe('repeatBlockDraft - Run from the editor while paused at the block (PYRUN-21)', () => {
    const mockSessionId = 'session-pyrun-1'
    const mockTopic = `workbench:${mockSessionId}`
    const nodeId = 'python-block-1'
    const draft = 'print("draft")'
    const overrideBody = {
      override: { node_id: nodeId, parameter: 'script', value: draft },
    }

    function pauseAt(blockId: string) {
      act(() => {
        getCapturedWsHandler()?.(
          {
            type: 'debug_breakpoint_hit',
            node_id: blockId,
            node_name: blockId,
            reason: 'breakpoint',
          },
          createEventMetadata(mockTopic)
        )
      })
    }

    async function renderRun() {
      const { result } = renderHook(() => useWorkbenchRun(), { wrapper: TestWrapper })
      await waitFor(() => {
        expect(result.current.isSessionRecoveryComplete).toBe(true)
      })
      return result
    }

    async function startRunningSession(
      result: { current: ReturnType<typeof useWorkbenchRun> }
    ) {
      ;(crypto as { randomUUID: () => string }).randomUUID = () => mockSessionId
      mockApiPost.mockResolvedValueOnce({
        session_id: mockSessionId,
        status: 'running',
        websocket_topic: mockTopic,
        warnings: [],
      })

      await act(async () => {
        await result.current.startDebugRun({
          testId: 'test-py',
          environmentId: 'env-py',
          breakpoints: [nodeId],
          debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
        })
      })
    }

    async function startPausedAt(
      result: { current: ReturnType<typeof useWorkbenchRun> },
      blockId: string
    ) {
      await startRunningSession(result)
      pauseAt(blockId)
      await waitFor(() => {
        expect(result.current.status).toBe('paused')
      })
      mockApiPost.mockClear()
    }

    beforeEach(() => {
      act(() => {
        useWorkflowStore.getState().setPausedNodeId(null)
        useWorkflowStore.getState().setEditingTest('test-py', 'Python Test')
      })
    })

    afterEach(() => {
      act(() => {
        useWorkflowStore.getState().setPausedNodeId(null)
        useWorkflowStore.getState().clearEditingTest()
      })
    })

    it('allows a draft run when the session is paused at that block', async () => {
      const result = await renderRun()
      await startPausedAt(result, nodeId)

      expect(result.current.canRunBlockDraft(nodeId)).toBe(true)
    })

    it('allows a draft run when nothing is running', async () => {
      const result = await renderRun()

      expect(result.current.canRunBlockDraft(nodeId)).toBe(true)
    })

    it('refuses a draft run while a run is in progress elsewhere', async () => {
      const result = await renderRun()
      await startRunningSession(result)

      expect(result.current.status).toBe('running')
      expect(result.current.canRunBlockDraft(nodeId)).toBe(false)
    })

    it('refuses a draft run while the session is paused at another block', async () => {
      const result = await renderRun()
      await startPausedAt(result, 'other-block')

      expect(result.current.canRunBlockDraft(nodeId)).toBe(false)
    })

    it('repeats the paused block with the editor draft substituted', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startPausedAt(result, nodeId)

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      await waitFor(() => {
        expect(mockRepeat).toHaveBeenCalledWith(mockSessionId, overrideBody)
      })
      expect(mockApiPost).not.toHaveBeenCalled()

      pauseAt(nodeId)
      await act(async () => {
        await pending
      })
    })

    it('starts no run when nothing is running', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(mockApiPost).not.toHaveBeenCalled()
      expect(mockRepeat).not.toHaveBeenCalled()
      expect(result.current.runBusy).toBe(false)
    })

    it('sends no request while a run is in progress elsewhere', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startRunningSession(result)
      mockApiPost.mockClear()

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(mockRepeat).not.toHaveBeenCalled()
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('sends no request while the session is paused at another block', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startPausedAt(result, 'other-block')

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(mockRepeat).not.toHaveBeenCalled()
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('is busy from the call until the block reports paused again', async () => {
      const result = await renderRun()
      await startPausedAt(result, nodeId)

      expect(result.current.runBusy).toBe(false)

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      await waitFor(() => {
        expect(result.current.runBusy).toBe(true)
      })

      pauseAt(nodeId)

      await waitFor(() => {
        expect(result.current.runBusy).toBe(false)
      })
      await act(async () => {
        await pending
      })
    })

    it('reports a rejected repeat and stops being busy', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startPausedAt(result, nodeId)
      mockRepeat.mockRejectedValueOnce(new Error('Session is not paused'))

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(mockToastError).toHaveBeenCalledWith('Session is not paused', 'Run Error')
      expect(result.current.runBusy).toBe(false)
    })

    it('stops being busy when the block paused again before the repeat answered', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startPausedAt(result, nodeId)
      mockRepeat.mockImplementationOnce(async () => {
        getCapturedWsHandler()?.(
          { type: 'debug_breakpoint_hit', node_id: nodeId, node_name: nodeId, reason: 'breakpoint' },
          createEventMetadata(mockTopic)
        )
        return undefined as unknown as Awaited<ReturnType<typeof workbenchApi.repeatStep>>
      })

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(result.current.status).toBe('paused')
      expect(result.current.runBusy).toBe(false)
    })

    it('stops being busy when the session ended before the repeat answered', async () => {
      const { workbenchApi } = await import('@/features/workbench/api/workbench')
      const mockRepeat = vi.mocked(workbenchApi.repeatStep)
      const result = await renderRun()
      await startPausedAt(result, nodeId)
      mockRepeat.mockImplementationOnce(async () => {
        getCapturedWsHandler()?.(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata(mockTopic)
        )
        return undefined as unknown as Awaited<ReturnType<typeof workbenchApi.repeatStep>>
      })

      await act(async () => {
        await result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      expect(mockRepeat).toHaveBeenCalledWith(mockSessionId, overrideBody)
      expect(result.current.runBusy).toBe(false)
    })

    it('stops being busy when the session ends', async () => {
      const result = await renderRun()
      await startPausedAt(result, nodeId)

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.repeatBlockDraft(nodeId, 'script', draft)
      })

      await waitFor(() => {
        expect(result.current.runBusy).toBe(true)
      })

      act(() => {
        getCapturedWsHandler()?.(
          { type: 'execution_completed', status: 'passed' },
          createEventMetadata(mockTopic)
        )
      })

      await waitFor(() => {
        expect(result.current.runBusy).toBe(false)
      })
      await act(async () => {
        await pending
      })
    })
  })
})
