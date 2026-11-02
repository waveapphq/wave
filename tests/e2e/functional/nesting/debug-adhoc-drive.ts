/** Drives Debug and ad-hoc (Run Current, Run from Here) runs on nesting cells, and reads the console while paused. */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { VALIDATION } from '../../helpers/fn-seed'
import { getLogRows } from '../../helpers/log-reader'
import { clickNodeContextMenuItem, selectEnvironment } from '../../helpers/workbench'
import { clickContinue, clickStepOver } from '../debug-step/helpers'
import { cellText, type NestCell } from './nesting-harness'

export type AdHocItem = 'Run Current' | 'Run from Here'

const STATUS = '[data-testid="workflow-status"]'
const PAUSED_NODE = '[data-testid^="workflow-node-"][data-paused="true"]'
const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped'])
const PAUSE_TIMEOUT_MS = 60_000
const MAX_RESUMES = 8
const LIVE_SETTLE_MS = 10_000
const LIVE_POLL_MS = 100

/** How many non-DEBUG console lines carry the marker text right now. */
export async function liveMarkerCount(page: Page, cell: NestCell, id: string): Promise<number> {
  const text = cellText(cell, id)
  const rows = await getLogRows(page)
  return rows.filter((row) => row.level !== 'DEBUG' && row.message === text).length
}

/** Soft: the marker has run exactly `count` times so far (polled, so a late console line still lands). */
export async function expectLiveMarkerCount(
  page: Page,
  cell: NestCell,
  id: string,
  count: number,
  criterion: string,
): Promise<void> {
  const deadline = Date.now() + LIVE_SETTLE_MS
  let seen = await liveMarkerCount(page, cell, id)
  while (seen !== count && Date.now() < deadline) {
    await page.waitForTimeout(LIVE_POLL_MS)
    seen = await liveMarkerCount(page, cell, id)
  }
  expect.soft(seen, `${cell.cellId}: ${criterion} (expected ${id} to have run ${count} time(s))`).toBe(count)
}

/** The node id carrying the paused border, or null. */
export async function pausedNodeId(page: Page): Promise<string | null> {
  const node = page.locator(PAUSED_NODE).first()
  if ((await node.count()) === 0) return null
  const testId = await node.getAttribute('data-testid')
  return testId ? testId.replace(/^workflow-node-/, '') : null
}

/** Hard: the run is paused and the paused border paints on `nodeId` (CANVAS-81). */
export async function expectPausedOn(page: Page, cell: NestCell, nodeId: string, criterion: string): Promise<void> {
  await expect(page.locator(STATUS), `${cell.cellId}: ${criterion} (the run is paused)`).toHaveAttribute(
    'data-status',
    'paused',
    { timeout: PAUSE_TIMEOUT_MS },
  )
  await expect(
    page.locator(`[data-testid="workflow-node-${nodeId}"]`),
    `${cell.cellId}: ${criterion} (the paused border paints on ${nodeId}; paused on ${await pausedNodeId(page)})`,
  ).toHaveAttribute('data-paused', 'true', { timeout: PAUSE_TIMEOUT_MS })
}

/** Click Step Over from `fromNode` and wait until the pause leaves it or the run ends; returns where it paused (null when terminal). */
export async function stepOverAndRecordLanding(page: Page, cell: NestCell, fromNode: string): Promise<string | null> {
  await clickStepOver(page)
  const status = page.locator(STATUS)
  await expect
    .poll(
      async () => {
        const value = await status.getAttribute('data-status')
        if (value !== null && TERMINAL.has(value)) return true
        const paused = await pausedNodeId(page)
        return value === 'paused' && paused !== null && paused !== fromNode
      },
      { timeout: PAUSE_TIMEOUT_MS, message: `${cell.cellId}: Step Over from ${fromNode} leaves ${fromNode}` },
    )
    .toBe(true)
  const landing = (await status.getAttribute('data-status')) === 'paused' ? await pausedNodeId(page) : null
  test.info().annotations.push({
    type: 'observed',
    description: `${cell.cellId}: Step Over from ${fromNode} landed on ${landing ?? 'the end of the run'}`,
  })
  return landing
}

/** Click Continue on every pause until the run reaches a terminal state. */
export async function continueToTerminal(page: Page, cell: NestCell): Promise<void> {
  const status = page.locator(STATUS)
  for (let resumes = 0; resumes < MAX_RESUMES; resumes++) {
    await expect(status, `${cell.cellId}: the run pauses or ends`).toHaveAttribute(
      'data-status',
      /^(paused|passed|failed|stopped|skipped)$/,
      { timeout: 120_000 },
    )
    if ((await status.getAttribute('data-status')) !== 'paused') return
    const from = await pausedNodeId(page)
    await clickContinue(page)
    await expect
      .poll(
        async () => {
          const value = await status.getAttribute('data-status')
          if (value !== 'paused') return true
          return (await pausedNodeId(page)) !== from
        },
        { timeout: PAUSE_TIMEOUT_MS, message: `${cell.cellId}: Continue resumes from ${from}` },
      )
      .toBe(true)
  }
  expect(await status.getAttribute('data-status'), `${cell.cellId}: the run ends within ${MAX_RESUMES} Continues`).not.toBe('paused')
}

/** Select the environment, start Run Current / Run from Here from the node's context menu, and fail if the pre-run check opens its dialog. */
export async function startCellAdHoc(page: Page, cell: NestCell, nodeId: string, item: AdHocItem): Promise<void> {
  await selectEnvironment(page)
  await clickNodeContextMenuItem(page, nodeId, item)
  const status = page.locator(STATUS)
  const dialog = page.locator(VALIDATION.dialog)
  await expect
    .poll(
      async () => {
        if (await dialog.isVisible().catch(() => false)) return 'dialog'
        return (await status.getAttribute('data-status')) === 'idle' ? '' : 'started'
      },
      { timeout: 15_000, message: `${cell.cellId}: the ${item} run leaves idle` },
    )
    .toBeTruthy()
  if (await dialog.isVisible().catch(() => false)) {
    expect(await dialog.innerText(), `${cell.cellId}: the pre-run check reports no errors`).toBe('')
  }
}

/** The workbench session the backend holds for the page right now ('' when none). */
async function backendSession(page: Page): Promise<{ id: string; status: string }> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as { data?: { session_id?: string; status?: string } } | null
  return { id: body?.data?.session_id ?? '', status: body?.data?.status ?? '' }
}

/** Start Run Current / Run from Here, wait until that run's own session ends (an earlier verdict on the page never counts), and return its verdict. */
export async function adHocRunToEnd(page: Page, cell: NestCell, nodeId: string, item: AdHocItem): Promise<string> {
  const earlier = (await backendSession(page)).id
  await selectEnvironment(page)
  await clickNodeContextMenuItem(page, nodeId, item)
  let verdict = ''
  await expect
    .poll(
      async () => {
        const now = await backendSession(page)
        verdict = now.id !== earlier && TERMINAL.has(now.status) ? now.status : ''
        return verdict
      },
      { timeout: 120_000, intervals: [250, 500, 1_000], message: `${cell.cellId}: the ${item} run on ${nodeId} ends` },
    )
    .not.toBe('')
  await expect(page.locator(STATUS), `${cell.cellId}: the page shows the ${item} verdict`).toHaveAttribute(
    'data-status',
    verdict,
    { timeout: 15_000 },
  )
  return verdict
}

/** Run Current on the Test's SSH Session Open, which leaves the Execution Host session open for the next ad-hoc run. */
export async function openExecutionHostSession(page: Page, cell: NestCell): Promise<void> {
  const openId = cell.graph.sshOpenIds[0]
  expect(openId, `${cell.cellId}: the Test opens an Execution Host session`).toBeTruthy()
  const verdict = await adHocRunToEnd(page, cell, openId, 'Run Current')
  expect(verdict, `${cell.cellId}: Run Current on ${openId} opens the Execution Host session`).toBe('passed')
}
