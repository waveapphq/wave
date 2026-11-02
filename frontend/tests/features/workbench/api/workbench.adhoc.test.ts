/**
 * Workbench API Client - Ad-hoc fields (REQ-3.2.1.5).
 *
 * Contract for the ``startDebugRun`` extension that threads the
 * ``start_node_id`` and ``single_node_id`` fields to the backend.
 *
 * Behavior under test:
 *
 *   - ``start_node_id`` and ``single_node_id`` keys are forwarded verbatim
 *     in the POST /workbench/run body when set.
 *   - Both keys omitted from the body when neither is set (no
 *     ``start_node_id: null`` / ``single_node_id: null`` clutter).
 *   - The two fields are mutually exclusive at the client - calling
 *     ``startDebugRun`` with both set rejects with the same anchored
 *     message the backend returns (defense in depth).
 *   - Compose with the existing debug payload (breakpoints + debug_options)
 *     and the existing optional fields (session_id, skipped_node_ids).
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

const _MUTUALLY_EXCLUSIVE_RE = /^start_node_id and single_node_id are mutually exclusive$/

describe('Workbench API - Ad-hoc fields', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // start_node_id forwarding
  // -------------------------------------------------------------------------

  describe('start_node_id', () => {
    it('forwards start_node_id in the POST body when set', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        start_node_id: 'node-mid',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({ start_node_id: 'node-mid' })
      )
    })

    it('does not include start_node_id key in body when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
      })

      const callArg = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect('start_node_id' in callArg).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // single_node_id forwarding
  // -------------------------------------------------------------------------

  describe('single_node_id', () => {
    it('forwards single_node_id in the POST body when set', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        single_node_id: 'node-target',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({ single_node_id: 'node-target' })
      )
    })

    it('does not include single_node_id key in body when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
      })

      const callArg = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect('single_node_id' in callArg).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // scoped_function_node_id forwarding (Drilled-in Debug Scope)
  // -------------------------------------------------------------------------

  describe('scoped_function_node_id', () => {
    it('forwards scoped_function_node_id in the POST body when set', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        scope_mode: 'function',
        scoped_function_node_id: 'fn-node-1',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({
          scope_mode: 'function',
          scoped_function_node_id: 'fn-node-1',
        })
      )
    })

    it('does not include scoped_function_node_id key in body when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's1',
          status: 'running',
          websocket_topic: 'workbench:s1',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
      })

      const callArg = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect('scoped_function_node_id' in callArg).toBe(false)
    })
  })

  describe('block_draft', () => {
    const RESPONSE = {
      data: { session_id: 's1', status: 'running', websocket_topic: 'workbench:s1', warnings: [] },
      meta: { requestId: 'req' },
      status: 200,
    }

    it('forwards block_draft in the POST body when set (PYRUN-21)', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(RESPONSE)

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        single_node_id: 'py-1',
        block_draft: true,
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({ single_node_id: 'py-1', block_draft: true })
      )
    })

    it('does not include block_draft key in body when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(RESPONSE)

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        single_node_id: 'py-1',
      })

      const callArg = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect('block_draft' in callArg).toBe(false)
    })
  })

  describe('function_path', () => {
    it('forwards the Function path of a Block inside an opened Function body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 's1', status: 'running', websocket_topic: 'workbench:s1', warnings: [] },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        single_node_id: 'body-log',
        function_path: ['outer-fn', 'inner-fn'],
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({ single_node_id: 'body-log', function_path: ['outer-fn', 'inner-fn'] }),
      )
    })

    it('does not include function_path in the body when omitted', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { session_id: 's1', status: 'running', websocket_topic: 'workbench:s1', warnings: [] },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-1',
        environment_id: 'env-1',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
      })

      const callArg = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
      expect('function_path' in callArg).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Mutual exclusion at the client layer
  // -------------------------------------------------------------------------

  describe('Mutual exclusion (client-side defense in depth)', () => {
    it('rejects with the anchored message when both fields are set', async () => {
      await expect(
        workbenchApi.startDebugRun({
          test_id: 'test-1',
          environment_id: 'env-1',
          breakpoints: [],
          debug_options: { pause_on_first_block: false, pause_on_errors: false },
          start_node_id: 'a',
          single_node_id: 'b',
        })
      ).rejects.toThrow(_MUTUALLY_EXCLUSIVE_RE)
    })

    it('does not call apiClient.post when both fields are set', async () => {
      await workbenchApi
        .startDebugRun({
          test_id: 'test-1',
          environment_id: 'env-1',
          breakpoints: [],
          debug_options: { pause_on_first_block: false, pause_on_errors: false },
          start_node_id: 'a',
          single_node_id: 'b',
        })
        .catch(() => undefined)

      expect(apiClient.post).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Composition with existing optional fields
  // -------------------------------------------------------------------------

  describe('Composition with existing fields', () => {
    it('forwards start_node_id alongside session_id, skipped_node_ids, breakpoints, debug_options', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's2',
          status: 'running',
          websocket_topic: 'workbench:s2',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-2',
        environment_id: 'env-2',
        session_id: 's2',
        skipped_node_ids: ['skip-1'],
        breakpoints: ['bp-1'],
        debug_options: { pause_on_first_block: true, pause_on_errors: false },
        start_node_id: 'mid',
      })

      expect(apiClient.post).toHaveBeenCalledWith('/workbench/run', {
        test_id: 'test-2',
        environment_id: 'env-2',
        session_id: 's2',
        skipped_node_ids: ['skip-1'],
        breakpoints: ['bp-1'],
        debug_options: { pause_on_first_block: true, pause_on_errors: false },
        start_node_id: 'mid',
      })
    })

    it('forwards single_node_id alongside other optional fields', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          session_id: 's3',
          status: 'running',
          websocket_topic: 'workbench:s3',
          warnings: [],
        },
        meta: { requestId: 'req' },
        status: 200,
      })

      await workbenchApi.startDebugRun({
        test_id: 'test-3',
        environment_id: 'env-3',
        session_id: 's3',
        breakpoints: [],
        debug_options: { pause_on_first_block: false, pause_on_errors: false },
        single_node_id: 'target',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/workbench/run',
        expect.objectContaining({
          test_id: 'test-3',
          environment_id: 'env-3',
          session_id: 's3',
          single_node_id: 'target',
        })
      )
    })
  })
})
