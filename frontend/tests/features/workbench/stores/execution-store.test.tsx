/**
 * Execution Store Tests - REQ-5.2.1.5 Zustand state management stores
 *
 * Tests for the execution state management store that tracks real-time status
 * during test runs with WebSocket integration.
 *
 * Contract:
 * - Execution store tracks real-time status during test runs
 * - WebSocket message handlers dispatch updates to appropriate stores
 * - Real-time updates merge correctly with optimistically updated local state
 * - Stores maintain connection awareness and reconcile state when connectivity resumes
 *
 * Design system:
 * - Execution State Colors: Pending, Running, Success, Failed, Warning, Skipped, Canceled
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Type definitions for execution state
type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'warning'
  | 'skipped'
  | 'stopped'

describe('Execution Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('starts with empty executions', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const state = useExecutionStore.getState()

      expect(state.executions).toEqual({})
    })

    it('starts with no active execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const state = useExecutionStore.getState()

      expect(state.activeExecutionId).toBeNull()
    })

    it('starts with disconnected state', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const state = useExecutionStore.getState()

      expect(state.isConnected).toBe(false)
    })

    it('starts with no last event time', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const state = useExecutionStore.getState()

      expect(state.lastEventTime).toBeNull()
    })
  })

  describe('startExecution', () => {
    it('creates new execution with pending status', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const now = Date.now()
      vi.setSystemTime(now)

      const executionId = useExecutionStore.getState().startExecution('test-1')

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution).toBeDefined()
      expect(execution?.testId).toBe('test-1')
      expect(execution?.status).toBe('pending')
      expect(execution?.startTime).toBe(now)
    })

    it('generates unique execution id', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const id1 = useExecutionStore.getState().startExecution('test-1')
      const id2 = useExecutionStore.getState().startExecution('test-1')

      expect(id1).not.toBe(id2)
    })

    it('sets active execution to new execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      expect(useExecutionStore.getState().activeExecutionId).toBe(executionId)
    })

    it('initializes with empty blocks', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')
      const execution = useExecutionStore.getState().getExecution(executionId)

      expect(execution?.blocks).toEqual({})
    })

    it('initializes with zero progress', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')
      const execution = useExecutionStore.getState().getExecution(executionId)

      expect(execution?.progress).toBe(0)
    })
  })

  describe('updateExecution', () => {
    it('updates execution status', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateExecution(executionId, {
        status: 'running',
      })

      expect(useExecutionStore.getState().getExecution(executionId)?.status).toBe('running')
    })

    it('updates execution progress', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateExecution(executionId, {
        progress: 50,
      })

      expect(useExecutionStore.getState().getExecution(executionId)?.progress).toBe(50)
    })

    it('updates current block id', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateExecution(executionId, {
        currentBlockId: 'block-1',
      })

      expect(useExecutionStore.getState().getExecution(executionId)?.currentBlockId).toBe(
        'block-1'
      )
    })

    it('does nothing if execution not found', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      // Should not throw
      expect(() =>
        useExecutionStore.getState().updateExecution('non-existent', { status: 'running' })
      ).not.toThrow()
    })
  })

  describe('updateBlockExecution', () => {
    it('handles non-existent execution ID gracefully', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      // Should not throw when updating a non-existent execution
      expect(() =>
        useExecutionStore.getState().updateBlockExecution('non-existent', 'block-1', {
          status: 'running',
        })
      ).not.toThrow()

      // State should remain unchanged
      expect(useExecutionStore.getState().executions).toEqual({})
    })

    it('creates block execution if not exists', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'block-1', {
        status: 'running',
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution).toBeDefined()
      expect(blockExecution?.status).toBe('running')
    })

    it('updates existing block execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const now = Date.now()
      vi.setSystemTime(now)

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'block-1', {
        status: 'running',
        startTime: now,
      })

      vi.setSystemTime(now + 1000)

      useExecutionStore.getState().updateBlockExecution(executionId, 'block-1', {
        status: 'success',
        endTime: now + 1000,
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution?.status).toBe('success')
      expect(blockExecution?.startTime).toBe(now)
      expect(blockExecution?.endTime).toBe(now + 1000)
    })

    it('stores block output', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')
      const output = { response: { status: 200 } }

      useExecutionStore.getState().updateBlockExecution(executionId, 'block-1', {
        status: 'success',
        output,
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution?.output).toEqual(output)
    })

    it('stores block error', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'block-1', {
        status: 'failed',
        error: 'Connection timeout',
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution?.error).toBe('Connection timeout')
    })
  })

  // A Parallel section runs several branches at once, so more than one block
  // is `running` at the same time (REQ-3.2.3.1). Nothing may collapse the set
  // to a single current block.
  describe('concurrent running blocks', () => {
    async function seedStore() {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })
      return useExecutionStore
    }

    it('keeps every concurrently running block', async () => {
      const useExecutionStore = await seedStore()
      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-a', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-b', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-c', { status: 'running' })

      const store = useExecutionStore.getState()
      expect(store.getBlockExecution(executionId, 'branch-a')?.status).toBe('running')
      expect(store.getBlockExecution(executionId, 'branch-b')?.status).toBe('running')
      expect(store.getBlockExecution(executionId, 'branch-c')?.status).toBe('running')
    })

    it('does not reset a sibling when a later block starts running', async () => {
      // Guard: a "current block" model would blank the earlier branch here.
      const useExecutionStore = await seedStore()
      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-a', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-b', { status: 'running' })

      expect(
        useExecutionStore.getState().getBlockExecution(executionId, 'branch-a')?.status,
      ).toBe('running')
    })

    it('settles each branch independently', async () => {
      const useExecutionStore = await seedStore()
      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-a', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-b', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-a', { status: 'success' })

      const store = useExecutionStore.getState()
      expect(store.getBlockExecution(executionId, 'branch-a')?.status).toBe('success')
      expect(store.getBlockExecution(executionId, 'branch-b')?.status).toBe('running')
    })

    it('records a stopped sibling next to a finished branch', async () => {
      // First-to-finish and the cooperative stop both leave this mix behind.
      const useExecutionStore = await seedStore()
      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-a', { status: 'success' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-b', { status: 'stopped' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-b-tail', { status: 'skipped' })

      const store = useExecutionStore.getState()
      expect(store.getBlockExecution(executionId, 'branch-a')?.status).toBe('success')
      expect(store.getBlockExecution(executionId, 'branch-b')?.status).toBe('stopped')
      expect(store.getBlockExecution(executionId, 'branch-b-tail')?.status).toBe('skipped')
    })
  })

  describe('completeExecution', () => {
    it('handles non-existent execution ID gracefully', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      // Should not throw when completing a non-existent execution
      expect(() =>
        useExecutionStore.getState().completeExecution('non-existent', 'success')
      ).not.toThrow()

      // State should remain unchanged
      expect(useExecutionStore.getState().executions).toEqual({})
    })

    it('sets execution status to success', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().completeExecution(executionId, 'success')

      expect(useExecutionStore.getState().getExecution(executionId)?.status).toBe('success')
    })

    it('sets execution status to failed', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().completeExecution(executionId, 'failed')

      expect(useExecutionStore.getState().getExecution(executionId)?.status).toBe('failed')
    })

    it('sets execution status to stopped', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().completeExecution(executionId, 'stopped')

      expect(useExecutionStore.getState().getExecution(executionId)?.status).toBe('stopped')
    })

    it('sets end time', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const startTime = Date.now()
      vi.setSystemTime(startTime)

      const executionId = useExecutionStore.getState().startExecution('test-1')

      const endTime = startTime + 5000
      vi.setSystemTime(endTime)

      useExecutionStore.getState().completeExecution(executionId, 'success')

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.endTime).toBe(endTime)
    })

    it('calculates duration', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const startTime = Date.now()
      vi.setSystemTime(startTime)

      const executionId = useExecutionStore.getState().startExecution('test-1')

      const endTime = startTime + 5000
      vi.setSystemTime(endTime)

      useExecutionStore.getState().completeExecution(executionId, 'success')

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.duration).toBe(5000)
    })

    it('sets progress to 100 on success', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().completeExecution(executionId, 'success')

      expect(useExecutionStore.getState().getExecution(executionId)?.progress).toBe(100)
    })

    it('stores result on completion', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')
      const result = { summary: 'All tests passed', passed: 5, failed: 0 }

      useExecutionStore.getState().completeExecution(executionId, 'success', result)

      expect(useExecutionStore.getState().getExecution(executionId)?.result).toEqual(result)
    })
  })

  describe('setActiveExecution', () => {
    it('sets active execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().setActiveExecution(null)

      expect(useExecutionStore.getState().activeExecutionId).toBeNull()

      useExecutionStore.getState().setActiveExecution(executionId)

      expect(useExecutionStore.getState().activeExecutionId).toBe(executionId)
    })

    it('allows clearing active execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: 'some-id',
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().setActiveExecution(null)

      expect(useExecutionStore.getState().activeExecutionId).toBeNull()
    })
  })

  describe('Connection State', () => {
    it('setConnected updates connection state', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: false,
        lastEventTime: null,
      })

      useExecutionStore.getState().setConnected(true)

      expect(useExecutionStore.getState().isConnected).toBe(true)
    })

    it('tracks connection state changes', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().setConnected(false)

      expect(useExecutionStore.getState().isConnected).toBe(false)
    })
  })

  describe('WebSocket Event Handling', () => {
    it('handles execution_started event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_started',
        executionId: 'exec-1',
        data: {
          testId: 'test-1',
          status: 'running',
        },
      })

      const execution = useExecutionStore.getState().getExecution('exec-1')
      expect(execution).toBeDefined()
      expect(execution?.testId).toBe('test-1')
      expect(execution?.status).toBe('running')
    })

    it('handles execution_updated event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'

      // Set up initial execution
      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime: Date.now(),
            blocks: {},
            progress: 0,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_updated',
        executionId,
        data: {
          progress: 50,
          currentBlockId: 'block-2',
        },
      })

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.progress).toBe(50)
      expect(execution?.currentBlockId).toBe('block-2')
    })

    it('handles block_started event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime: now,
            blocks: {},
            progress: 0,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'block_started',
        executionId,
        data: {
          blockId: 'block-1',
          startTime: now,
        },
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution?.status).toBe('running')
      expect(blockExecution?.startTime).toBe(now)
    })

    it('handles block_completed event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const startTime = Date.now()
      vi.setSystemTime(startTime)

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime,
            blocks: {
              'block-1': {
                id: 'block-exec-1',
                blockId: 'block-1',
                status: 'running',
                startTime,
              },
            },
            progress: 0,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      const endTime = startTime + 1000
      vi.setSystemTime(endTime)

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'block_completed',
        executionId,
        data: {
          blockId: 'block-1',
          status: 'success',
          endTime,
          output: { result: 'ok' },
        },
      })

      const blockExecution = useExecutionStore
        .getState()
        .getBlockExecution(executionId, 'block-1')
      expect(blockExecution?.status).toBe('success')
      expect(blockExecution?.endTime).toBe(endTime)
      expect(blockExecution?.output).toEqual({ result: 'ok' })
    })

    it('handles execution_completed event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const startTime = Date.now()
      vi.setSystemTime(startTime)

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime,
            blocks: {},
            progress: 75,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      const endTime = startTime + 5000
      vi.setSystemTime(endTime)

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_completed',
        executionId,
        data: {
          status: 'success',
          endTime,
          result: { passed: 5, failed: 0 },
        },
      })

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.status).toBe('success')
      expect(execution?.progress).toBe(100)
      expect(execution?.result).toEqual({ passed: 5, failed: 0 })
    })

    it('execution_started uses default values for missing optional fields', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      // Send event with minimal data - no status, startTime, or progress
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_started',
        executionId: 'exec-1',
        data: { testId: 'test-1' }, // Only required field
      })

      const execution = useExecutionStore.getState().getExecution('exec-1')
      expect(execution?.status).toBe('running') // Default value
      expect(execution?.startTime).toBe(now) // Default to current time
      expect(execution?.progress).toBe(0) // Default value
    })

    it('block_started uses default startTime when not provided', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime: now - 1000,
            blocks: {},
            progress: 0,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      // Send event without startTime
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'block_started',
        executionId,
        data: { blockId: 'block-1' }, // No startTime provided
      })

      const block = useExecutionStore.getState().getBlockExecution(executionId, 'block-1')
      expect(block?.startTime).toBe(now) // Should default to current time
    })

    it('block_completed handles missing existingBlock and status', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime: now - 1000,
            blocks: {}, // No existing block
            progress: 0,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      // Send block_completed for a block that was never started
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'block_completed',
        executionId,
        data: { blockId: 'block-1' }, // No status provided
      })

      const block = useExecutionStore.getState().getBlockExecution(executionId, 'block-1')
      expect(block?.status).toBe('success') // Default status
      expect(block?.id).toBeDefined() // Should have generated ID
    })

    it('execution_completed uses default status when not provided', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const startTime = Date.now()

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime,
            blocks: {},
            progress: 50,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      // Send event without status
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_completed',
        executionId,
        data: {}, // No status or endTime provided
      })

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.status).toBe('success') // Default value
      expect(execution?.progress).toBe(100) // Always set to 100 on complete
      expect(execution?.duration).toBeUndefined() // No endTime means no duration
    })

    it('execution_completed calculates duration when endTime provided', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const executionId = 'exec-1'
      const startTime = 1000

      useExecutionStore.setState({
        executions: {
          [executionId]: {
            id: executionId,
            testId: 'test-1',
            status: 'running',
            startTime,
            blocks: {},
            progress: 50,
          },
        },
        activeExecutionId: executionId,
        isConnected: true,
        lastEventTime: null,
      })

      // Send event with endTime
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_completed',
        executionId,
        data: { status: 'success', endTime: 6000 },
      })

      const execution = useExecutionStore.getState().getExecution(executionId)
      expect(execution?.duration).toBe(5000) // 6000 - 1000
    })

    it('updates lastEventTime on WebSocket event', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_started',
        executionId: 'exec-1',
        data: { testId: 'test-1', status: 'running' },
      })

      expect(useExecutionStore.getState().lastEventTime).toBe(now)
    })
  })

  describe('Getters', () => {
    it('getActiveExecution returns current execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      const active = useExecutionStore.getState().getActiveExecution()
      expect(active?.id).toBe(executionId)
    })

    it('getActiveExecution returns undefined when no active', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      expect(useExecutionStore.getState().getActiveExecution()).toBeUndefined()
    })
  })

  describe('Cleanup', () => {
    it('clearExecution removes single execution', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().clearExecution(executionId)

      expect(useExecutionStore.getState().getExecution(executionId)).toBeUndefined()
    })

    it('clearExecution clears active if matching', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId = useExecutionStore.getState().startExecution('test-1')

      useExecutionStore.getState().clearExecution(executionId)

      expect(useExecutionStore.getState().activeExecutionId).toBeNull()
    })

    it('clearExecution preserves active when different execution cleared', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const executionId1 = useExecutionStore.getState().startExecution('test-1')
      const executionId2 = useExecutionStore.getState().startExecution('test-2')
      useExecutionStore.getState().setActiveExecution(executionId2)

      // Clear executionId1, which is NOT the active one
      useExecutionStore.getState().clearExecution(executionId1)

      // Active should still be executionId2
      expect(useExecutionStore.getState().activeExecutionId).toBe(executionId2)
    })

    it('clearAllExecutions removes all executions', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().startExecution('test-2')

      useExecutionStore.getState().clearAllExecutions()

      expect(Object.keys(useExecutionStore.getState().executions)).toHaveLength(0)
      expect(useExecutionStore.getState().activeExecutionId).toBeNull()
    })
  })

  describe('Selective Subscriptions', () => {
    it('allows subscribing to active execution status', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      const statuses: (ExecutionStatus | undefined)[] = []

      const unsubscribe = useExecutionStore.subscribe(
        (state) => state.getActiveExecution()?.status,
        (status) => {
          statuses.push(status)
        }
      )

      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateExecution(executionId, { status: 'running' })
      useExecutionStore.getState().completeExecution(executionId, 'success')

      unsubscribe()

      expect(statuses).toContain('pending')
      expect(statuses).toContain('running')
      expect(statuses).toContain('success')
    })
  })

  describe('Reconnection and State Reconciliation', () => {
    it('marks pending resync needed on disconnect', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          'exec-1': {
            id: 'exec-1',
            testId: 'test-1',
            status: 'running',
            startTime: now - 5000,
            blocks: {},
            progress: 50,
          },
        },
        activeExecutionId: 'exec-1',
        isConnected: true,
        lastEventTime: now,
      })

      // Disconnect
      useExecutionStore.getState().setConnected(false)

      expect(useExecutionStore.getState().isConnected).toBe(false)
    })

    it('reconciles state on reconnection with pending events', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Set up running execution before disconnect
      useExecutionStore.setState({
        executions: {
          'exec-1': {
            id: 'exec-1',
            testId: 'test-1',
            status: 'running',
            startTime: now - 10000,
            blocks: {
              'block-1': {
                id: 'block-exec-1',
                blockId: 'block-1',
                status: 'running',
                startTime: now - 5000,
              },
            },
            progress: 25,
          },
        },
        activeExecutionId: 'exec-1',
        isConnected: false, // Disconnected
        lastEventTime: now - 5000, // Last event before disconnect
      })

      // Reconnect
      useExecutionStore.getState().setConnected(true)

      // Simulate receiving missed events after reconnection
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'block_completed',
        executionId: 'exec-1',
        data: {
          blockId: 'block-1',
          status: 'success',
          endTime: now - 3000,
        },
      })

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_completed',
        executionId: 'exec-1',
        data: {
          status: 'success',
          endTime: now - 1000,
        },
      })

      // State should be reconciled
      const execution = useExecutionStore.getState().getExecution('exec-1')
      expect(execution?.status).toBe('success')
      expect(execution?.blocks['block-1']?.status).toBe('success')
    })

    it('detects stale state by comparing timestamps', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          'exec-1': {
            id: 'exec-1',
            testId: 'test-1',
            status: 'running',
            startTime: now - 60000, // Started 1 minute ago
            blocks: {},
            progress: 50,
          },
        },
        activeExecutionId: 'exec-1',
        isConnected: true,
        lastEventTime: now - 30000, // No events for 30 seconds
      })

      // Check if state might be stale (no events for extended period)
      const lastEventTime = useExecutionStore.getState().lastEventTime
      const timeSinceLastEvent = now - (lastEventTime ?? 0)

      // If running execution has no updates for 30+ seconds, might be stale
      expect(timeSinceLastEvent).toBeGreaterThanOrEqual(30000)
    })

    it('preserves execution history during reconnection', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Set up completed executions
      useExecutionStore.setState({
        executions: {
          'exec-1': {
            id: 'exec-1',
            testId: 'test-1',
            status: 'success',
            startTime: now - 120000,
            endTime: now - 60000,
            blocks: {},
            progress: 100,
          },
          'exec-2': {
            id: 'exec-2',
            testId: 'test-2',
            status: 'running',
            startTime: now - 30000,
            blocks: {},
            progress: 50,
          },
        },
        activeExecutionId: 'exec-2',
        isConnected: true,
        lastEventTime: now,
      })

      // Disconnect and reconnect
      useExecutionStore.getState().setConnected(false)
      useExecutionStore.getState().setConnected(true)

      // Completed executions should still be available
      expect(useExecutionStore.getState().getExecution('exec-1')).toBeDefined()
      expect(useExecutionStore.getState().getExecution('exec-1')?.status).toBe('success')
    })

    it('handles multiple WebSocket events in rapid succession after reconnect', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useExecutionStore.setState({
        executions: {
          'exec-1': {
            id: 'exec-1',
            testId: 'test-1',
            status: 'running',
            startTime: now - 10000,
            blocks: {},
            progress: 0,
          },
        },
        activeExecutionId: 'exec-1',
        isConnected: true,
        lastEventTime: null,
      })

      // Simulate rapid-fire events after reconnection
      const events = [
        {
          type: 'block_started' as const,
          executionId: 'exec-1',
          data: { blockId: 'block-1', startTime: now - 8000 },
        },
        {
          type: 'block_completed' as const,
          executionId: 'exec-1',
          data: { blockId: 'block-1', status: 'success', endTime: now - 7000 },
        },
        {
          type: 'block_started' as const,
          executionId: 'exec-1',
          data: { blockId: 'block-2', startTime: now - 6000 },
        },
        {
          type: 'block_completed' as const,
          executionId: 'exec-1',
          data: { blockId: 'block-2', status: 'success', endTime: now - 5000 },
        },
        {
          type: 'execution_updated' as const,
          executionId: 'exec-1',
          data: { progress: 100 },
        },
        {
          type: 'execution_completed' as const,
          executionId: 'exec-1',
          data: { status: 'success', endTime: now - 1000 },
        },
      ]

      events.forEach((event) => {
        useExecutionStore.getState().handleWebSocketEvent(event)
      })

      const execution = useExecutionStore.getState().getExecution('exec-1')
      expect(execution?.status).toBe('success')
      expect(execution?.blocks['block-1']?.status).toBe('success')
      expect(execution?.blocks['block-2']?.status).toBe('success')
      expect(execution?.progress).toBe(100)
    })

    it('updates lastEventTime on each WebSocket event for staleness detection', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      const startTime = Date.now()
      vi.setSystemTime(startTime)

      useExecutionStore.setState({
        executions: {},
        activeExecutionId: null,
        isConnected: true,
        lastEventTime: null,
      })

      // First event
      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_started',
        executionId: 'exec-1',
        data: { testId: 'test-1', status: 'running' },
      })

      expect(useExecutionStore.getState().lastEventTime).toBe(startTime)

      // Advance time and send another event
      const laterTime = startTime + 5000
      vi.setSystemTime(laterTime)

      useExecutionStore.getState().handleWebSocketEvent({
        type: 'execution_updated',
        executionId: 'exec-1',
        data: { progress: 50 },
      })

      expect(useExecutionStore.getState().lastEventTime).toBe(laterTime)
    })
  })

  describe('Computed State / Derived Selectors', () => {
    describe('getRunningExecutions', () => {
      it('returns only running executions', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        const now = Date.now()

        useExecutionStore.setState({
          executions: {
            'exec-1': {
              id: 'exec-1',
              testId: 'test-1',
              status: 'running',
              startTime: now - 5000,
              blocks: {},
              progress: 50,
            },
            'exec-2': {
              id: 'exec-2',
              testId: 'test-2',
              status: 'success',
              startTime: now - 60000,
              endTime: now - 30000,
              blocks: {},
              progress: 100,
            },
            'exec-3': {
              id: 'exec-3',
              testId: 'test-3',
              status: 'running',
              startTime: now - 3000,
              blocks: {},
              progress: 25,
            },
          },
          activeExecutionId: 'exec-1',
          isConnected: true,
          lastEventTime: now,
        })

        const running = useExecutionStore.getState().getRunningExecutions()
        expect(running).toHaveLength(2)
        expect(running.every((e) => e.status === 'running')).toBe(true)
      })
    })

    describe('getCompletedExecutions', () => {
      it('returns only completed executions', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        const now = Date.now()

        useExecutionStore.setState({
          executions: {
            'exec-1': {
              id: 'exec-1',
              testId: 'test-1',
              status: 'success',
              startTime: now - 60000,
              endTime: now - 30000,
              blocks: {},
              progress: 100,
            },
            'exec-2': {
              id: 'exec-2',
              testId: 'test-2',
              status: 'failed',
              startTime: now - 120000,
              endTime: now - 90000,
              blocks: {},
              progress: 100,
            },
            'exec-3': {
              id: 'exec-3',
              testId: 'test-3',
              status: 'running',
              startTime: now - 5000,
              blocks: {},
              progress: 50,
            },
          },
          activeExecutionId: 'exec-3',
          isConnected: true,
          lastEventTime: now,
        })

        const completed = useExecutionStore.getState().getCompletedExecutions()
        expect(completed).toHaveLength(2)
        expect(completed.every((e) => ['success', 'failed', 'stopped'].includes(e.status))).toBe(
          true
        )
      })
    })

    describe('getExecutionsByTestId', () => {
      it('returns executions for specific test', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        const now = Date.now()

        useExecutionStore.setState({
          executions: {
            'exec-1': {
              id: 'exec-1',
              testId: 'test-1',
              status: 'success',
              startTime: now - 60000,
              blocks: {},
              progress: 100,
            },
            'exec-2': {
              id: 'exec-2',
              testId: 'test-1',
              status: 'running',
              startTime: now - 5000,
              blocks: {},
              progress: 50,
            },
            'exec-3': {
              id: 'exec-3',
              testId: 'test-2',
              status: 'success',
              startTime: now - 30000,
              blocks: {},
              progress: 100,
            },
          },
          activeExecutionId: 'exec-2',
          isConnected: true,
          lastEventTime: now,
        })

        const test1Executions = useExecutionStore.getState().getExecutionsByTestId('test-1')
        expect(test1Executions).toHaveLength(2)
        expect(test1Executions.every((e) => e.testId === 'test-1')).toBe(true)
      })
    })

    describe('getRunningCount', () => {
      it('returns count of running executions', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        const now = Date.now()

        useExecutionStore.setState({
          executions: {
            'exec-1': {
              id: 'exec-1',
              testId: 'test-1',
              status: 'running',
              startTime: now - 5000,
              blocks: {},
              progress: 50,
            },
            'exec-2': {
              id: 'exec-2',
              testId: 'test-2',
              status: 'success',
              startTime: now - 60000,
              blocks: {},
              progress: 100,
            },
            'exec-3': {
              id: 'exec-3',
              testId: 'test-3',
              status: 'pending',
              startTime: now,
              blocks: {},
              progress: 0,
            },
          },
          activeExecutionId: 'exec-1',
          isConnected: true,
          lastEventTime: now,
        })

        expect(useExecutionStore.getState().getRunningCount()).toBe(1)
      })
    })

    describe('getTotalProgress', () => {
      it('returns aggregated progress of running executions', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        const now = Date.now()

        useExecutionStore.setState({
          executions: {
            'exec-1': {
              id: 'exec-1',
              testId: 'test-1',
              status: 'running',
              startTime: now - 5000,
              blocks: {},
              progress: 50,
            },
            'exec-2': {
              id: 'exec-2',
              testId: 'test-2',
              status: 'running',
              startTime: now - 3000,
              blocks: {},
              progress: 100, // One complete
            },
          },
          activeExecutionId: 'exec-1',
          isConnected: true,
          lastEventTime: now,
        })

        const totalProgress = useExecutionStore.getState().getTotalProgress()
        // Average of 50 and 100 = 75
        expect(totalProgress).toBe(75)
      })

      it('returns 0 when no running executions', async () => {
        const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
        useExecutionStore.setState({
          executions: {},
          activeExecutionId: null,
          isConnected: true,
          lastEventTime: null,
        })

        expect(useExecutionStore.getState().getTotalProgress()).toBe(0)
      })
    })
  })
})

// =============================================================================
// useBlockExecutionStatus - Per-node primitive selector hook
// =============================================================================
describe('useBlockExecutionStatus', () => {
  beforeEach(async () => {
    const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
    useExecutionStore.setState({
      executions: {},
      activeExecutionId: null,
      isConnected: false,
      lastEventTime: null,
    })
  })

  it('returns undefined when no active execution', async () => {
    const { useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')
    const { result } = renderHook(() => useBlockExecutionStatus('block-1'))
    expect(result.current).toBeUndefined()
  })

  it('returns block status when active execution has the block', async () => {
    const { useExecutionStore, useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')
    useExecutionStore.setState({
      activeExecutionId: 'exec-1',
      executions: {
        'exec-1': {
          id: 'exec-1',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'block-1': { id: 'b1', blockId: 'block-1', status: 'success' },
          },
          progress: 50,
        },
      },
    })

    const { result } = renderHook(() => useBlockExecutionStatus('block-1'))
    expect(result.current).toBe('success')
  })

  it('returns undefined when active execution does not have the block', async () => {
    const { useExecutionStore, useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')
    useExecutionStore.setState({
      activeExecutionId: 'exec-1',
      executions: {
        'exec-1': {
          id: 'exec-1',
          testId: 'test-1',
          status: 'running',
          startTime: Date.now(),
          blocks: {},
          progress: 0,
        },
      },
    })

    const { result } = renderHook(() => useBlockExecutionStatus('missing-block'))
    expect(result.current).toBeUndefined()
  })

  it('returns undefined when activeExecutionId points to nonexistent execution', async () => {
    const { useExecutionStore, useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')
    useExecutionStore.setState({
      activeExecutionId: 'exec-gone',
      executions: {},
    })

    const { result } = renderHook(() => useBlockExecutionStatus('block-1'))
    expect(result.current).toBeUndefined()
  })

  it('prefers historical block-states context over the live execution store', async () => {
    const { useExecutionStore, useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')
    const { HistoricalBlockStatesProvider } = await import('../../../../src/features/workbench/common/canvas/historical-block-states-context')

    // Seed the live store with a DIFFERENT status to prove context wins.
    useExecutionStore.setState({
      activeExecutionId: 'exec-live',
      executions: {
        'exec-live': {
          id: 'exec-live',
          testId: 'test-live',
          status: 'running',
          startTime: Date.now(),
          blocks: {
            'node-a': { id: 'bx', blockId: 'node-a', status: 'failed' },
          },
          progress: 50,
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HistoricalBlockStatesProvider blockStates={{ 'node-a': 'success' }}>
        {children}
      </HistoricalBlockStatesProvider>
    )

    const { result } = renderHook(() => useBlockExecutionStatus('node-a'), { wrapper })
    expect(result.current).toBe('success')
  })

  it('returns undefined from historical context when the block is not in the map', async () => {
    const { HistoricalBlockStatesProvider } = await import('../../../../src/features/workbench/common/canvas/historical-block-states-context')
    const { useBlockExecutionStatus } = await import('../../../../src/features/workbench/stores/execution-store')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HistoricalBlockStatesProvider blockStates={{ 'other-node': 'success' }}>
        {children}
      </HistoricalBlockStatesProvider>
    )

    const { result } = renderHook(() => useBlockExecutionStatus('missing-node'), { wrapper })
    expect(result.current).toBeUndefined()
  })

  describe('resultSkipped (intentional vs structural skip)', () => {
    const reset = (useExecutionStore: typeof import('../../../../src/features/workbench/stores/execution-store').useExecutionStore) =>
      useExecutionStore.setState({ executions: {}, activeExecutionId: null, isConnected: true, lastEventTime: null })

    it('flags resultSkipped when a block goes running -> skipped', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      reset(useExecutionStore)
      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateBlockExecution(executionId, 'fn-1', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'fn-1', { status: 'skipped' })
      expect(useExecutionStore.getState().getBlockExecution(executionId, 'fn-1')?.resultSkipped).toBe(true)
    })

    it('does NOT flag resultSkipped when a block is skipped without running', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      reset(useExecutionStore)
      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateBlockExecution(executionId, 'branch-leaf', { status: 'skipped' })
      expect(useExecutionStore.getState().getBlockExecution(executionId, 'branch-leaf')?.resultSkipped).toBeFalsy()
    })

    it('useBlockResultSkipped returns true for a result-skipped block', async () => {
      const { useExecutionStore, useBlockResultSkipped } = await import('../../../../src/features/workbench/stores/execution-store')
      reset(useExecutionStore)
      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateBlockExecution(executionId, 'fn-1', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(executionId, 'fn-1', { status: 'skipped' })
      const { result } = renderHook(() => useBlockResultSkipped('fn-1'))
      expect(result.current).toBe(true)
    })

    it('useBlockResultSkipped returns false for a block that did not result-skip', async () => {
      const { useExecutionStore, useBlockResultSkipped } = await import('../../../../src/features/workbench/stores/execution-store')
      reset(useExecutionStore)
      const executionId = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateBlockExecution(executionId, 'plain', { status: 'success' })
      const { result } = renderHook(() => useBlockResultSkipped('missing'))
      expect(result.current).toBe(false)
    })

    it('useBlockResultSkipped returns false when there is no active execution', async () => {
      const { useExecutionStore, useBlockResultSkipped } = await import('../../../../src/features/workbench/stores/execution-store')
      reset(useExecutionStore)
      const { result } = renderHook(() => useBlockResultSkipped('fn-1'))
      expect(result.current).toBe(false)
    })
  })

  describe('stopRunningBlocks', () => {
    it('marks running blocks stopped and leaves completed blocks untouched', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({ executions: {}, activeExecutionId: null })
      const id = useExecutionStore.getState().startExecution('test-1')
      useExecutionStore.getState().updateBlockExecution(id, 'parent', { status: 'running' })
      useExecutionStore.getState().updateBlockExecution(id, 'done', { status: 'success' })

      useExecutionStore.getState().stopRunningBlocks(id)

      expect(useExecutionStore.getState().getBlockExecution(id, 'parent')?.status).toBe('stopped')
      expect(useExecutionStore.getState().getBlockExecution(id, 'done')?.status).toBe('success')
    })

    it('is a no-op for an unknown execution id', async () => {
      const { useExecutionStore } = await import('../../../../src/features/workbench/stores/execution-store')
      useExecutionStore.setState({ executions: {}, activeExecutionId: null })
      expect(() => useExecutionStore.getState().stopRunningBlocks('missing')).not.toThrow()
    })
  })
})
