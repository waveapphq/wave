/** Block width rules shared by the Block and Quick Insert (REQ-4.2.5, CANVAS-249). */

import { controlDefault } from '@/features/workbench/lib/node-parameters'
import { NODE_FUNCTION_MIN_WIDTH, NODE_MIN_WIDTH } from './types'

/** The narrowest a Note is drawn or resized. */
export const NOTE_MIN_WIDTH = 120

export interface OutputModes {
  isTryCatch: boolean
  tryCatchEnableCatch: boolean
  tryCatchEnableFinally: boolean
  isIfElseMode: boolean
  ifElseBranchCount: number
  switchBranchCount: number
  parallelBranchCount: number
  isSplitMode: boolean
  isForLoop: boolean
  isRemoteExecution: boolean
  isWaitRetry: boolean
}

export function computeOutputWidth(modes: OutputModes): number {
  if (modes.isTryCatch) {
    const handleCount = 2 + (modes.tryCatchEnableCatch ? 1 : 0) + (modes.tryCatchEnableFinally ? 1 : 0)
    return 48 * 2 + (handleCount - 1) * 64
  }
  // Remote Execution and a Retry-mode Wait Until share the For Loop's two-handle footprint.
  if (modes.isForLoop || modes.isRemoteExecution || modes.isWaitRetry) {
    return 48 * 2 + (2 - 1) * 64
  }
  if (modes.isIfElseMode) {
    return 48 * 2 + (modes.ifElseBranchCount - 1) * 64
  }
  // Branch lanes plus the trailing 'then' egress.
  if (modes.switchBranchCount > 0) {
    return 48 * 2 + modes.switchBranchCount * 64
  }
  if (modes.parallelBranchCount > 0) {
    return 48 * 2 + modes.parallelBranchCount * 64
  }
  return modes.isSplitMode ? 160 : 120
}

function configValuesOf(config?: { values?: unknown }): Record<string, unknown> | undefined {
  return config?.values as Record<string, unknown> | undefined
}

export function detectNodeModes(
  elementType: string,
  config?: { values?: unknown },
) {
  const configValues = configValuesOf(config)
  const isSplitMode = elementType === 'assert' && (configValues?.mode ?? controlDefault('assert', 'mode')) === 'split'
  const ifElseBranches = elementType === 'if-else'
    ? (configValues?.branches as Array<{id: string, type: string, label?: string}> | undefined) ?? []
    : []
  const isIfElseMode = ifElseBranches.length > 0
  const isTryCatch = elementType === 'try-catch-finally'
  const tryCatchConfig = isTryCatch ? configValues : undefined
  const tryCatchEnableCatch = isTryCatch ? (tryCatchConfig?.enable_catch ?? true) as boolean : false
  const tryCatchEnableFinally = isTryCatch ? (tryCatchConfig?.enable_finally ?? false) as boolean : false
  const isForLoop = elementType === 'for' || elementType === 'for-each' || elementType === 'while'
  const isRemoteExecution = elementType === 'remote-execution'
  const rawSwitchBranches = elementType === 'switch-case' ? configValues?.branches : undefined
  const switchBranches = (Array.isArray(rawSwitchBranches) ? rawSwitchBranches : []) as Array<{
    id: string
    type: string
    label?: string
  }>
  const rawParallelBranches = elementType === 'parallel' ? configValues?.branches : undefined
  const parallelBranches = (
    Array.isArray(rawParallelBranches) ? rawParallelBranches : []
  ) as Array<{ id: string; name?: string }>
  const isWaitRetry = elementType === 'wait-until' && (configValues?.mode ?? controlDefault('wait-until', 'mode')) === 'retry'
  return { isSplitMode, ifElseBranches, isIfElseMode, isTryCatch, tryCatchEnableCatch, tryCatchEnableFinally, isForLoop, isRemoteExecution, switchBranches, parallelBranches, isWaitRetry }
}

/** The lane counts of detected modes, as the width rules read them. */
export function toOutputModes(modes: ReturnType<typeof detectNodeModes>): OutputModes {
  return {
    isTryCatch: modes.isTryCatch,
    tryCatchEnableCatch: modes.tryCatchEnableCatch,
    tryCatchEnableFinally: modes.tryCatchEnableFinally,
    isIfElseMode: modes.isIfElseMode,
    ifElseBranchCount: modes.ifElseBranches.length,
    switchBranchCount: modes.switchBranches.length,
    parallelBranchCount: modes.parallelBranches.length,
    isSplitMode: modes.isSplitMode,
    isForLoop: modes.isForLoop,
    isRemoteExecution: modes.isRemoteExecution,
    isWaitRetry: modes.isWaitRetry,
  }
}

export function computeNodeMinWidth(topHandleCount: number, modes: OutputModes): number {
  const inputWidth = topHandleCount * 80
  const outputWidth = computeOutputWidth(modes)
  return Math.max(120, inputWidth, outputWidth)
}

/** Function nodes get a wider floor for their lifecycle badge and dig-in chevron. */
export function resolveNodeMinFloor(nodeType: string): number {
  return nodeType === 'function' ? NODE_FUNCTION_MIN_WIDTH : NODE_MIN_WIDTH
}

interface FreshNode {
  type: string
  data: { elementType: string; nodeType?: string; config?: { values?: unknown } }
}

/** The width an unsized node is drawn at: its kind's floor, or its handle-row minimum when wider. */
export function computeFreshNodeWidth(node: FreshNode): number {
  if (node.type === 'noteNode') return NOTE_MIN_WIDTH
  const modes = detectNodeModes(node.data.elementType, node.data.config)
  return Math.max(resolveNodeMinFloor(node.data.nodeType ?? 'plugin'), computeNodeMinWidth(1, toOutputModes(modes)))
}
