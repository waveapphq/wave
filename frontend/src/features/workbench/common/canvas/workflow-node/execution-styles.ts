/**
 * Execution state styling maps for workflow nodes.
 * Design reference: V-CANVAS-04 / REQ-3.2.2.16
 */

import type { ExecutionStatus } from '@/features/workbench/stores/execution-store'

/** Border class for each execution status */
const EXECUTION_BORDER_MAP: Record<ExecutionStatus, string> = {
  pending: 'border-[#A1A1AA] dark:border-[#3F3F46]',
  running: 'border-[#3B82F6] animate-execution-pulse',
  success: 'border-[#22C55E]',
  warning: 'border-[#F59E0B]',
  failed: 'border-[#EF4444]',
  skipped: 'border-[#71717A]',
  stopped: 'border-[#F59E0B]',
}

/** Background tint for each execution status (kept empty - execution is communicated through the colored outline only) */
const EXECUTION_BG_MAP: Record<ExecutionStatus, string> = {
  pending: '',
  running: '',
  success: '',
  warning: '',
  failed: '',
  skipped: '',
  stopped: '',
}

export function getExecutionBorderClass(status: ExecutionStatus | undefined): string | undefined {
  return status ? EXECUTION_BORDER_MAP[status] : undefined
}

export function getExecutionBgClass(status: ExecutionStatus | undefined): string | undefined {
  return status ? EXECUTION_BG_MAP[status] : undefined
}
