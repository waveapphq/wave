/** Locus probes for Remote Execution depth cells: which machine and which worker process ran a Block. */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import { pluginNode } from '../../helpers/k8s-nodes'
import { leaf, shellScript, type NestLeaf } from '../../helpers/nesting-graph'
import type { CellRun, NestCell } from './nesting-harness'

/** The host name the shared sshd Execution Host reports. */
export const EXECUTION_HOST_NAME = 'wave-e2e-host'

/** The Test variable the WAVE-side host name lands in. */
export const WAVE_HOST_VARIABLE = 'wave_host'

const PROBE_SEED = 'seed'
// After the command name in parentheses: the state, then the parent pid.
const PROC_STAT_PARENT = /\) \S+ (\d+) /

/** A Shell Script on WAVE printing its host name into `wave_host`. */
export function waveHostProbe(id: string): NestLeaf {
  return shellScript(id, 'hostname', {
    outputBindings: { stdout: WAVE_HOST_VARIABLE },
    vars: [{ name: WAVE_HOST_VARIABLE, type: 'string', seed: '', flow: 'export' }],
  })
}

/** A remotable File I/O reading /proc/self/stat: its parent pid field names the worker that started the request process. */
export function workerPidProbe(id: string, variable: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: id,
      values: { operation: 'read', path: '/proc/self/stat' },
      outputBindings: { content: variable },
    }),
    { vars: [{ name: variable, type: 'string', seed: PROBE_SEED, flow: 'export' }] },
  )
}

/** The trimmed string a probe variable holds after the run ('' when absent). */
export function probeText(run: CellRun, variable: string): string {
  const value = run.variables[variable]?.value
  return typeof value === 'string' ? value.trim() : ''
}

/** The worker pid a worker pid probe read (its request process's parent), or null when the variable holds no /proc stat line. */
export function workerPid(run: CellRun, variable: string): number | null {
  const match = PROC_STAT_PARENT.exec(probeText(run, variable))
  return match ? Number(match[1]) : null
}

/** The host probe read the Execution Host name, which is not the WAVE host name. */
export function expectReadOnExecutionHost(cell: NestCell, run: CellRun, variable: string, criterion: string): void {
  const waveHost = probeText(run, WAVE_HOST_VARIABLE)
  const read = probeText(run, variable)
  expect.soft(waveHost, `${cell.cellId}: the WAVE host probe printed a host name`).not.toBe('')
  expect.soft(read, `${cell.cellId}: ${criterion} (${variable} reads the Execution Host name)`).toBe(EXECUTION_HOST_NAME)
  expect.soft(read, `${cell.cellId}: ${criterion} (${variable} differs from the WAVE host ${waveHost})`).not.toBe(waveHost)
}

/** Both probes ran in one worker process on the host. */
export function expectSameWorker(cell: NestCell, run: CellRun, first: string, second: string, criterion: string): void {
  const a = workerPid(run, first)
  const b = workerPid(run, second)
  expect.soft(a, `${cell.cellId}: ${criterion} (${first} read a worker pid)`).not.toBeNull()
  expect.soft({ [first]: a, [second]: b }, `${cell.cellId}: ${criterion} (same worker pid)`).toEqual({ [first]: a, [second]: a })
}

/** The two probes ran in different worker processes. */
export function expectDifferentWorkers(cell: NestCell, run: CellRun, first: string, second: string, criterion: string): void {
  const a = workerPid(run, first)
  const b = workerPid(run, second)
  expect.soft(a, `${cell.cellId}: ${criterion} (${first} read a worker pid)`).not.toBeNull()
  expect.soft(b, `${cell.cellId}: ${criterion} (${second} read a worker pid)`).not.toBeNull()
  expect.soft(b, `${cell.cellId}: ${criterion} (${second} pid differs from ${first} pid ${a})`).not.toBe(a)
}

/** The R (runs on the host) / L (runs on WAVE) locus badge a body Block carries (SSH:63). */
export async function expectLocusBadge(
  page: Page,
  cell: NestCell,
  nodeId: string,
  locus: 'R' | 'L',
  criterion: string,
): Promise<void> {
  const badge = page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-remote-locus-badge"]`)
  await expect
    .soft(badge, `${cell.cellId}: ${criterion} (${nodeId} carries the ${locus} locus badge)`)
    .toHaveAttribute('data-locus', locus, { timeout: 5_000 })
}
