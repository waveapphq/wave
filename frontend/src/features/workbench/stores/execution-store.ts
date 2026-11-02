/**
 * Execution Store - REQ-5.2.1.5 Zustand state management stores
 *
 * State management for real-time test execution tracking with WebSocket integration.
 * - Execution store tracks real-time status during test runs
 * - WebSocket message handlers dispatch updates to appropriate stores
 * - Real-time updates merge correctly with optimistically updated local state
 * - Stores maintain connection awareness and reconcile state when connectivity resumes
 * - Execution State Colors: Pending, Running, Success, Failed, Warning, Skipped, Stopped
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { generateUniqueId } from '@/lib/utils'
import { useHistoricalBlockStatuses } from '@/features/workbench/common/canvas/historical-block-states-context'

type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'warning'
  | 'skipped'
  | 'stopped'

interface BlockExecution {
  id: string
  blockId: string
  status: ExecutionStatus
  startTime?: number
  endTime?: number
  duration?: number
  error?: string
  output?: unknown
  progress?: number
  /** True when the block ran and then reported 'skipped' (an intentional skip,
   *  e.g. a function-scope Halt), as opposed to a structural skip that never ran. */
  resultSkipped?: boolean
}

interface Execution {
  id: string
  testId: string
  status: ExecutionStatus
  startTime: number
  endTime?: number
  duration?: number
  blocks: Record<string, BlockExecution>
  currentBlockId?: string
  progress: number
  error?: string
  result?: unknown
}

interface ExecutionEvent {
  type:
    | 'execution_started'
    | 'execution_updated'
    | 'block_started'
    | 'block_completed'
    | 'execution_completed'
  executionId: string
  data: Record<string, unknown>
}

interface ExecutionState {
  executions: Record<string, Execution>
  activeExecutionId: string | null
  isConnected: boolean
  lastEventTime: number | null

  // Actions
  startExecution: (testId: string) => string
  updateExecution: (executionId: string, updates: Partial<Execution>) => void
  updateBlockExecution: (
    executionId: string,
    blockId: string,
    updates: Partial<BlockExecution>
  ) => void
  completeExecution: (
    executionId: string,
    status: 'success' | 'failed' | 'stopped' | 'skipped',
    result?: unknown
  ) => void
  /** Mark every still-running block in an execution as stopped (on a user Stop,
   *  the engine is canceled so those blocks never get a terminal WS event). */
  stopRunningBlocks: (executionId: string) => void
  setActiveExecution: (executionId: string | null) => void
  setConnected: (connected: boolean) => void
  handleWebSocketEvent: (event: ExecutionEvent) => void
  getExecution: (executionId: string) => Execution | undefined
  getActiveExecution: () => Execution | undefined
  getBlockExecution: (executionId: string, blockId: string) => BlockExecution | undefined
  clearExecution: (executionId: string) => void
  clearAllExecutions: () => void

  // Derived selectors
  getRunningExecutions: () => Execution[]
  getCompletedExecutions: () => Execution[]
  getExecutionsByTestId: (testId: string) => Execution[]
  getRunningCount: () => number
  getTotalProgress: () => number
}

/**
 * Generate a unique ID for executions
 */
function generateId(): string {
  return generateUniqueId('exec')
}

/**
 * Zustand store for execution state
 */
export const useExecutionStore = create<ExecutionState>()(
  subscribeWithSelector((set, get) => ({
    executions: {},
    activeExecutionId: null,
    isConnected: false,
    lastEventTime: null,

    startExecution: (testId) => {
      const id = generateId()
      const execution: Execution = {
        id,
        testId,
        status: 'pending',
        startTime: Date.now(),
        blocks: {},
        progress: 0,
      }

      set((state) => ({
        executions: { ...state.executions, [id]: execution },
        activeExecutionId: id,
      }))

      return id
    },

    updateExecution: (executionId, updates) => {
      set((state) => {
        const execution = state.executions[executionId]
        if (!execution) return state

        return {
          executions: {
            ...state.executions,
            [executionId]: { ...execution, ...updates },
          },
        }
      })
    },

    updateBlockExecution: (executionId, blockId, updates) => {
      set((state) => {
        const execution = state.executions[executionId]
        if (!execution) return state

        const existingBlock = execution.blocks[blockId]
        const defaultBlock: BlockExecution = {
          id: `block-${blockId}-${Date.now()}`,
          blockId,
          status: 'pending',
        }
        // running -> skipped marks an intentional (result) skip; a structural
        // skip is set to 'skipped' without ever passing through 'running'.
        const becameResultSkip =
          updates.status === 'skipped' && existingBlock?.status === 'running'
        const blockExecution: BlockExecution = {
          ...defaultBlock,
          ...existingBlock,
          ...updates,
          ...(becameResultSkip ? { resultSkipped: true } : {}),
        }

        return {
          executions: {
            ...state.executions,
            [executionId]: {
              ...execution,
              blocks: {
                ...execution.blocks,
                [blockId]: blockExecution,
              },
            },
          },
        }
      })
    },

    completeExecution: (executionId, status, result) => {
      set((state) => {
        const execution = state.executions[executionId]
        if (!execution) return state

        const endTime = Date.now()
        const duration = endTime - execution.startTime

        return {
          executions: {
            ...state.executions,
            [executionId]: {
              ...execution,
              status,
              endTime,
              duration,
              progress: 100,
              result,
            },
          },
        }
      })
    },

    setActiveExecution: (executionId) => {
      set({ activeExecutionId: executionId })
    },

    setConnected: (connected) => {
      set({ isConnected: connected })
    },

    handleWebSocketEvent: (event) => {
      const { type, executionId, data } = event
      const now = Date.now()

      set((state) => {
        const newState: Partial<ExecutionState> = { lastEventTime: now }

        switch (type) {
          case 'execution_started': {
            const execution: Execution = {
              id: executionId,
              testId: data.testId as string,
              status: (data.status as ExecutionStatus) ?? 'running',
              startTime: (data.startTime as number) ?? now,
              blocks: {},
              progress: (data.progress as number) ?? 0,
            }
            newState.executions = { ...state.executions, [executionId]: execution }
            break
          }

          case 'execution_updated': {
            const execution = state.executions[executionId]
            if (execution) {
              newState.executions = {
                ...state.executions,
                [executionId]: { ...execution, ...data } as Execution,
              }
            }
            break
          }

          case 'block_started': {
            const execution = state.executions[executionId]
            if (execution) {
              const blockId = data.blockId as string
              const blockExecution: BlockExecution = {
                id: `block-${blockId}-${now}`,
                blockId,
                status: 'running',
                startTime: (data.startTime as number) ?? now,
              }
              newState.executions = {
                ...state.executions,
                [executionId]: {
                  ...execution,
                  blocks: {
                    ...execution.blocks,
                    [blockId]: blockExecution,
                  },
                },
              }
            }
            break
          }

          case 'block_completed': {
            const execution = state.executions[executionId]
            if (execution) {
              const blockId = data.blockId as string
              const existingBlock = execution.blocks[blockId]
              const blockExecution: BlockExecution = {
                ...existingBlock,
                id: existingBlock?.id ?? `block-${blockId}-${now}`,
                blockId,
                status: (data.status as ExecutionStatus) ?? 'success',
                endTime: data.endTime as number | undefined,
                output: data.output,
                error: data.error as string | undefined,
              }
              newState.executions = {
                ...state.executions,
                [executionId]: {
                  ...execution,
                  blocks: {
                    ...execution.blocks,
                    [blockId]: blockExecution,
                  },
                },
              }
            }
            break
          }

          case 'execution_completed': {
            const execution = state.executions[executionId]
            if (execution) {
              newState.executions = {
                ...state.executions,
                [executionId]: {
                  ...execution,
                  status: (data.status as ExecutionStatus) ?? 'success',
                  endTime: data.endTime as number | undefined,
                  duration:
                    (data.endTime as number | undefined) === undefined
                      ? undefined
                      : (data.endTime as number) - execution.startTime,
                  progress: 100,
                  result: data.result,
                },
              }
            }
            break
          }
        }

        return newState
      })
    },

    getExecution: (executionId) => {
      return get().executions[executionId]
    },

    getActiveExecution: () => {
      const state = get()
      return state.activeExecutionId ? state.executions[state.activeExecutionId] : undefined
    },

    getBlockExecution: (executionId, blockId) => {
      const execution = get().executions[executionId]
      return execution?.blocks[blockId]
    },

    stopRunningBlocks: (executionId) => {
      set((state) => {
        const execution = state.executions[executionId]
        if (!execution) return state
        let changed = false
        const blocks: Record<string, BlockExecution> = {}
        for (const [bid, block] of Object.entries(execution.blocks)) {
          if (block.status === 'running') {
            blocks[bid] = { ...block, status: 'stopped' }
            changed = true
          } else {
            blocks[bid] = block
          }
        }
        if (!changed) return state
        return {
          executions: { ...state.executions, [executionId]: { ...execution, blocks } },
        }
      })
    },

    clearExecution: (executionId) => {
      set((state) => {
        const { [executionId]: _removed, ...remaining } = state.executions
        return {
          executions: remaining,
          activeExecutionId:
            state.activeExecutionId === executionId ? null : state.activeExecutionId,
        }
      })
    },

    clearAllExecutions: () => {
      set({
        executions: {},
        activeExecutionId: null,
      })
    },

    // Derived selectors
    getRunningExecutions: () => {
      const state = get()
      return Object.values(state.executions).filter((e) => e.status === 'running')
    },

    getCompletedExecutions: () => {
      const state = get()
      return Object.values(state.executions).filter((e) =>
        ['success', 'failed', 'stopped', 'skipped'].includes(e.status)
      )
    },

    getExecutionsByTestId: (testId) => {
      const state = get()
      return Object.values(state.executions).filter((e) => e.testId === testId)
    },

    getRunningCount: () => {
      return get().getRunningExecutions().length
    },

    getTotalProgress: () => {
      const running = get().getRunningExecutions()
      if (running.length === 0) return 0
      const totalProgress = running.reduce((sum, e) => sum + e.progress, 0)
      return Math.round(totalProgress / running.length)
    },
  }))
)

/** Per-node selector: returns primitive string, so Zustand only re-renders when the value changes.
 *
 * Prefers a `HistoricalBlockStatesContext` value when the node is rendered
 * inside the historical canvas subtree, which lets painted-replay views
 * inject final statuses without touching (and clobbering) the live
 * singleton store.
 */
export function useBlockExecutionStatus(blockId: string): ExecutionStatus | undefined {
  const historical = useHistoricalBlockStatuses()
  const liveStatus = useExecutionStore((state) => {
    if (!state.activeExecutionId) return undefined
    return state.executions[state.activeExecutionId]?.blocks[blockId]?.status
  })
  if (historical) return historical[blockId]
  return liveStatus
}

/** True when a live block executed and then reported 'skipped' (intentional
 *  skip). Live-only: historical snapshots do not record the transition. */
export function useBlockResultSkipped(blockId: string): boolean {
  return useExecutionStore((state) => {
    if (!state.activeExecutionId) return false
    return !!state.executions[state.activeExecutionId]?.blocks[blockId]?.resultSkipped
  })
}

// Export types
export type {
  ExecutionStatus,
  BlockExecution,
  Execution,
  ExecutionEvent,
  ExecutionState,
}
