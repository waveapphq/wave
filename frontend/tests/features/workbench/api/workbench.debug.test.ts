/**
 * Workbench API Client - Debug Additions - REQ-3.2.1.2, REQ-3.2.2.1, REQ-3.2.2.2, REQ-3.2.2.3
 *
 * Contract for four API client methods on ``workbenchApi``:
 *  - startDebugRun(params)
 *      POST /workbench/run with ``breakpoints`` + ``debug_options`` in body
 *  - updateWorkbenchBreakpoints(sessionId, nodeIds)
 *      PATCH /workbench/{sessionId}/breakpoints with ``{breakpoints: string[]}``
 *  - continueExecution(sessionId)
 *      POST /workbench/{sessionId}/continue (empty body)
 *  - skipBlockAtPause(sessionId)
 *      POST /workbench/{sessionId}/skip-block (empty body)
 *
 * Also asserts that ``startRun`` forwards no ``debug_mode`` or other
 * debug-only fields (they belong on ``startDebugRun``).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { apiClient } from '@/lib/api'
import { workbenchApi } from '@/features/workbench/api/workbench'

describe('Workbench API - Debug methods', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // startDebugRun
  // -------------------------------------------------------------------------

  describe('startDebugRun', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.startDebugRun).toBe('function')
    })

    it('POSTs /workbench/run with breakpoints and debug_options in the body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'running',
          websocket_topic: 'workbench:session-1',
          warnings: [],
        },
        meta: { requestId: 'req-1' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: ['node-a', 'node-b'],
        debug_options: {
          pause_on_first_block: true,
          pause_on_errors: false,
        },
      })

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/run', {
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: ['node-a', 'node-b'],
        debug_options: {
          pause_on_first_block: true,
          pause_on_errors: false,
        },
      })
    })

    it('forwards the in-memory workflow and variables (run-current) when provided', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'running',
          websocket_topic: 'workbench:session-1',
          warnings: [],
        },
        meta: { requestId: 'req-1' },
        status: 200,
      })

      const workflow = { nodes: [{ id: 'n1' }], edges: [] }
      const variables = { v: 1 }
      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: ['node-a'],
        debug_options: { pause_on_first_block: true, pause_on_errors: false },
        workflow,
        variables,
      })

      const body = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect(body.workflow).toEqual(workflow)
      expect(body.variables).toEqual(variables)
    })

    it('forwards session_id and skipped_node_ids when provided', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-2',
          status: 'running',
          websocket_topic: 'workbench:session-2',
          warnings: [],
        },
        meta: { requestId: 'req-2' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-2',
        environment_id: 'env-2',
        session_id: 'session-2',
        skipped_node_ids: ['node-z'],
        breakpoints: [],
        debug_options: {
          pause_on_first_block: false,
          pause_on_errors: false,
        },
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({
          test_id: 'test-2',
          environment_id: 'env-2',
          session_id: 'session-2',
          skipped_node_ids: ['node-z'],
          breakpoints: [],
          debug_options: {
            pause_on_first_block: false,
            pause_on_errors: false,
          },
        })
      )
    })

    it('returns the response data unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-3',
          status: 'running',
          websocket_topic: 'workbench:session-3',
          warnings: [],
        },
        meta: { requestId: 'req-3' },
        status: 200,
      })

      const result = await workbenchApi.startDebugRun({
        test_id: 'test-3',
        environment_id: 'env-3',
        breakpoints: [],
        debug_options: {
          pause_on_first_block: false,
          pause_on_errors: false,
        },
      })

      expect(result.session_id).toBe('session-3')
      expect(result.status).toBe('running')
    })

    it('propagates 404 errors from the server', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Test 'missing' not found"), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(
        workbenchApi.startDebugRun({
          test_id: 'missing',
          environment_id: 'env-1',
          breakpoints: [],
          debug_options: {
            pause_on_first_block: false,
            pause_on_errors: false,
          },
        })
      ).rejects.toThrow("Test 'missing' not found")
    })
  })

  // -------------------------------------------------------------------------
  // startRun forwards no debug-only fields
  // -------------------------------------------------------------------------

  describe('startRun (non-debug)', () => {
    it('does NOT include breakpoints in the request body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-4',
          status: 'running',
          websocket_topic: 'workbench:session-4',
          warnings: [],
        },
        meta: { requestId: 'req-4' },
        status: 200,
      })

      await workbenchApi.startRun({
        test_id: 'test-4',
        environment_id: 'env-4',
      })

      const body = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect(body).not.toHaveProperty('breakpoints')
      expect(body).not.toHaveProperty('debug_options')
      expect(body).not.toHaveProperty('debug_mode')
    })
  })

  // -------------------------------------------------------------------------
  // updateWorkbenchBreakpoints
  // -------------------------------------------------------------------------

  describe('updateWorkbenchBreakpoints', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.updateWorkbenchBreakpoints).toBe('function')
    })

    it('PATCHes /workbench/{sessionId}/breakpoints with the full node id list', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: {
          session_id: 'session-5',
          breakpoints: ['node-a', 'node-b'],
        },
        meta: { requestId: 'req-5' },
        status: 200,
      })

      await workbenchApi.updateWorkbenchBreakpoints('session-5', [
        'node-a',
        'node-b',
      ])

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/workbench/session-5/breakpoints',
        { breakpoints: ['node-a', 'node-b'] }
      )
    })

    it('sends an empty array to clear all breakpoints', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { session_id: 'session-6', breakpoints: [] },
        meta: { requestId: 'req-6' },
        status: 200,
      })

      await workbenchApi.updateWorkbenchBreakpoints('session-6', [])

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/workbench/session-6/breakpoints',
        { breakpoints: [] }
      )
    })

    it('propagates 404 when the session does not exist', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(new Error("Workbench session 'missing' not found"), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(
        workbenchApi.updateWorkbenchBreakpoints('missing', ['n1'])
      ).rejects.toThrow("Workbench session 'missing' not found")
    })

    it('propagates 409 when session is not running/paused', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        Object.assign(
          new Error("Cannot update breakpoints: session is 'idle', not running"),
          {
            type: 'conflict',
            status: 409,
          }
        )
      )

      await expect(
        workbenchApi.updateWorkbenchBreakpoints('session-idle', ['n1'])
      ).rejects.toThrow(
        "Cannot update breakpoints: session is 'idle', not running"
      )
    })
  })

  // -------------------------------------------------------------------------
  // continueExecution
  // -------------------------------------------------------------------------

  describe('continueExecution', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.continueExecution).toBe('function')
    })

    it('POSTs /workbench/{sessionId}/continue with an empty body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 'session-7', status: 'running' },
        meta: { requestId: 'req-7' },
        status: 200,
      })

      await workbenchApi.continueExecution('session-7')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-7/continue')
    })

    it('propagates 409 when session is not paused', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Cannot continue: session is 'running', not paused"), {
          type: 'conflict',
          status: 409,
        })
      )

      await expect(workbenchApi.continueExecution('session-x')).rejects.toThrow(
        "Cannot continue: session is 'running', not paused"
      )
    })
  })

  // -------------------------------------------------------------------------
  // skipBlockAtPause
  // -------------------------------------------------------------------------

  describe('skipBlockAtPause', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.skipBlockAtPause).toBe('function')
    })

    it('POSTs /workbench/{sessionId}/skip-block with an empty body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-8',
          status: 'paused',
          skipped_node_id: 'node-k',
        },
        meta: { requestId: 'req-8' },
        status: 200,
      })

      await workbenchApi.skipBlockAtPause('session-8')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-8/skip-block')
    })

    it('returns the skipped_node_id from the response', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-9',
          status: 'paused',
          skipped_node_id: 'node-7',
        },
        meta: { requestId: 'req-9' },
        status: 200,
      })

      const result = await workbenchApi.skipBlockAtPause('session-9')
      expect(result.skipped_node_id).toBe('node-7')
      expect(result.status).toBe('paused')
    })

    it('propagates 409 when session is not paused', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Cannot skip: session is 'running', not paused"), {
          type: 'conflict',
          status: 409,
        })
      )

      await expect(workbenchApi.skipBlockAtPause('session-y')).rejects.toThrow(
        "Cannot skip: session is 'running', not paused"
      )
    })

    it('propagates the anchored 409 branching-rejection message', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(
          new Error(
            "Cannot skip branching block 'if-else': step into a branch and skip a leaf instead"
          ),
          {
            type: 'conflict',
            status: 409,
          }
        )
      )

      await expect(workbenchApi.skipBlockAtPause('session-z')).rejects.toThrow(
        "Cannot skip branching block 'if-else': step into a branch and skip a leaf instead"
      )
    })
  })

  // -------------------------------------------------------------------------
  // stepOver
  // -------------------------------------------------------------------------

  describe('stepOver', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.stepOver).toBe('function')
    })

    it('POSTs /workbench/{sessionId}/step-over with an empty body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 'session-so', status: 'running' },
        meta: { requestId: 'req-so' },
        status: 200,
      })

      await workbenchApi.stepOver('session-so')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-so/step-over')
    })

    it('returns the running-state envelope from the response', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 'session-so-2', status: 'running' },
        meta: { requestId: 'req-so-2' },
        status: 200,
      })

      const result = await workbenchApi.stepOver('session-so-2')
      expect(result.session_id).toBe('session-so-2')
      expect(result.status).toBe('running')
    })

    it('propagates 404 when the session does not exist', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Workbench session 'missing' not found"), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(workbenchApi.stepOver('missing')).rejects.toThrow(
        "Workbench session 'missing' not found"
      )
    })

    it('propagates 409 when session is not paused', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(
          new Error("Cannot step-over: session is 'running', not paused"),
          {
            type: 'conflict',
            status: 409,
          }
        )
      )

      await expect(workbenchApi.stepOver('session-running')).rejects.toThrow(
        "Cannot step-over: session is 'running', not paused"
      )
    })
  })

  // -------------------------------------------------------------------------
  // stepInto
  // -------------------------------------------------------------------------

  describe('stepInto', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.stepInto).toBe('function')
    })

    it('POSTs /workbench/{sessionId}/step-into with an empty body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 'session-si', status: 'running' },
        meta: { requestId: 'req-si' },
        status: 200,
      })

      await workbenchApi.stepInto('session-si')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-si/step-into')
    })

    it('returns the running-state envelope from the response', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 'session-si-2', status: 'running' },
        meta: { requestId: 'req-si-2' },
        status: 200,
      })

      const result = await workbenchApi.stepInto('session-si-2')
      expect(result.session_id).toBe('session-si-2')
      expect(result.status).toBe('running')
    })

    it('propagates 404 when the session does not exist', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Workbench session 'missing' not found"), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(workbenchApi.stepInto('missing')).rejects.toThrow(
        "Workbench session 'missing' not found"
      )
    })

    it('propagates 409 when session is not paused', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(
          new Error("Cannot step-into: session is 'running', not paused"),
          {
            type: 'conflict',
            status: 409,
          }
        )
      )

      await expect(workbenchApi.stepInto('session-running')).rejects.toThrow(
        "Cannot step-into: session is 'running', not paused"
      )
    })
  })

  // -------------------------------------------------------------------------
  // repeatStep
  // -------------------------------------------------------------------------

  describe('repeatStep', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.repeatStep).toBe('function')
    })

    it('POSTs /workbench/{sessionId}/repeat-step with an empty body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-rs',
          status: 'paused',
          repeated_node_id: 'node-q',
        },
        meta: { requestId: 'req-rs' },
        status: 200,
      })

      await workbenchApi.repeatStep('session-rs')

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/session-rs/repeat-step')
    })

    it('returns the paused-state envelope with repeated_node_id', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 'session-rs-2',
          status: 'paused',
          repeated_node_id: 'node-7',
        },
        meta: { requestId: 'req-rs-2' },
        status: 200,
      })

      const result = await workbenchApi.repeatStep('session-rs-2')
      expect(result.session_id).toBe('session-rs-2')
      expect(result.status).toBe('paused')
      expect(result.repeated_node_id).toBe('node-7')
    })

    it('propagates 404 when the session does not exist', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Workbench session 'missing' not found"), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(workbenchApi.repeatStep('missing')).rejects.toThrow(
        "Workbench session 'missing' not found"
      )
    })

    it('propagates 404 when no currently paused block', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Cannot repeat: no currently paused block'), {
          type: 'not_found',
          status: 404,
        })
      )

      await expect(workbenchApi.repeatStep('session-nopaused')).rejects.toThrow(
        'Cannot repeat: no currently paused block'
      )
    })

    it('propagates 409 when session is not paused', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(
          new Error("Cannot repeat: session is 'running', not paused"),
          {
            type: 'conflict',
            status: 409,
          }
        )
      )

      await expect(workbenchApi.repeatStep('session-running')).rejects.toThrow(
        "Cannot repeat: session is 'running', not paused"
      )
    })
  })

  // -------------------------------------------------------------------------
  // updateDebugOptions
  // -------------------------------------------------------------------------

  describe('updateDebugOptions', () => {
    it('is exposed on the workbenchApi surface', () => {
      expect(typeof workbenchApi.updateDebugOptions).toBe('function')
    })

    it('PATCHes /workbench/{sessionId}/debug-options with the partial payload', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: {
          session_id: 'session-7',
          debug_options: { pause_on_first_block: true, pause_on_errors: false },
        },
        meta: { requestId: 'req-7' },
        status: 200,
      })

      await workbenchApi.updateDebugOptions('session-7', {
        pause_on_first_block: true,
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/workbench/session-7/debug-options',
        { pause_on_first_block: true },
      )
    })

    it('forwards both flags when both are provided', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: {
          session_id: 'session-8',
          debug_options: { pause_on_first_block: true, pause_on_errors: true },
        },
        meta: { requestId: 'req-8' },
        status: 200,
      })

      await workbenchApi.updateDebugOptions('session-8', {
        pause_on_first_block: true,
        pause_on_errors: true,
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/workbench/session-8/debug-options',
        { pause_on_first_block: true, pause_on_errors: true },
      )
    })
  })
})
