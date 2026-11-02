/**
 * Dashboard API Types
 *
 * Domain types for the dashboard feature.
 */

export type ActivityType = 'test' | 'suite' | 'regression' | 'execution'
export type ActivityStatus = 'passed' | 'failed' | 'running' | 'idle'

export interface Activity {
  id: string
  type: ActivityType
  name: string
  context: string
  status?: ActivityStatus
}

export type ExecutionStatus = 'running' | 'passed' | 'failed' | 'stopped' | 'paused' | 'skipped'

export interface Execution {
  id: string
  name: string
  status: ExecutionStatus
  statusInfo: string
  progress: number
  testsTotal: number
  testsDone: number
}
