/**
 * V-EXEC-STOP-SETTLES: Stop settles every in-flight Block in the STORED record
 *
 * A user Stop cancels the run task, and cancellation never reaches the block
 * error handlers. Every Block the run was standing on - the section node, the
 * Block inside a Parallel lane, the loop node and the Block inside its body -
 * has to carry a terminal `stopped` state in the record that history, the
 * reopened canvas and the exported report all read back.
 *
 * The assertions deliberately avoid the LIVE canvas: the browser sweeps block
 * statuses locally, so a live-canvas check passes whatever the backend stored,
 * and a stopped lane is not canceled - it finishes its current Block and can
 * repaint it PASS a moment after the Stop, on the live canvas only.
 *
 * Pass Criteria:
 *  1. POST /tests imports the fixture with zero validation errors
 *  2. The run is stopped only once BOTH nesting sites are in flight (a lane
 *     Delay and a loop-body Delay), proved by their marker variables
 *  3. GET /executions/history/{id}: no Block reads `running`; the four
 *     in-flight Blocks read `stopped`; the three finished Blocks keep their
 *     own `passed`; the run verdict reads `stopped`
 *  4. The reopened canvas paints the same: no node carries
 *     data-execution-status="running", the in-flight nodes read `stopped`,
 *     the finished ones read `success`
 *  5. The exported HTML report carries no Running status cell; the in-flight
 *     Blocks read Stopped, the finished ones Passed, and the document header
 *     reads Stopped
 *
 * REQ: REQ-3.2.2.4 (execution control - stop)
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { getSessionVariables, importFixtureTest } from '../../helpers/fixture-import'
import fs from 'fs'
import path from 'path'

// Blocks in flight when the Stop lands: the section, its lane Delay, the loop
// inside the other lane, and the Delay inside that loop's body.
const IN_FLIGHT_BLOCKS = ['par-stop', 'delay-lane', 'for-stop', 'delay-body'] as const

// Blocks that finished before the Stop and must keep their own result.
const FINISHED_BLOCKS = ['log-opening', 'vs-lane', 'vs-body'] as const

const BLOCK_LABELS: Record<string, string> = {
  'par-stop': 'Stop Section',
  'delay-lane': 'Lane Delay',
  'for-stop': 'Stop Loop',
  'delay-body': 'Body Delay',
  'log-opening': 'Opening Log',
  'vs-lane': 'Lane Marker',
  'vs-body': 'Body Marker',
}

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-stop-settle.json'), 'utf-8')
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function startExecution(
  request: APIRequestContext,
  testId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: environmentId },
  })
  expect(
    response.ok(),
    `POST /executions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

/** Both nesting sites are in flight once each marker Block has written its
 *  value: the walk is then parked on the 30s Delay that follows it. */
async function waitUntilBothSitesInFlight(page: Page, executionId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const variables = await getSessionVariables(page, executionId)
        return [variables.lane_marker?.value, variables.body_marker?.value].join('|')
      },
      {
        timeout: 20_000,
        intervals: [100, 250, 500],
        message: 'expected the lane Delay and the loop-body Delay to both be in flight',
      },
    )
    .toBe('in-lane|in-body')
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok(), `GET /executions/${executionId} failed: ${response.status()}`).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function pollReportCompleted(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  let job: Record<string, unknown> = {}
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}/report`)
    expect(
      response.ok(),
      `GET /executions/${executionId}/report failed: ${response.status()}`,
    ).toBeTruthy()
    const body = await response.json()
    job = (body.data ?? body) as Record<string, unknown>
    if (job.status === 'completed') return job
    expect(job.status, `report job failed: ${String(job.error)}`).not.toBe('failed')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Report for ${executionId} did not complete (last status: ${String(job.status)})`)
}

/** The Status cell of the Timeline row for one Block. A Block inside a
 *  container is named by its full "Parent / Child" path, so match the last
 *  segment. */
function reportRowStatus(page: Page, blockName: string): Locator {
  return page
    .locator('table.rpt-table tbody tr')
    .filter({
      has: page.locator('td:nth-child(2)', { hasText: new RegExp(`(^|/ )${blockName}$`) }),
    })
    .locator('td:nth-child(3)')
}

function canvasNode(page: Page, nodeId: string): Locator {
  return page.locator(`[data-testid="workflow-node-${nodeId}"]`)
}

test.describe('Stop settles in-flight Blocks in the stored record', () => {
  test('a stopped run stores no running Block, reopened or exported', async ({
    page,
    request,
  }) => {
    const testId = await importFixtureTest(page, loadFixture())
    const environmentId = await getEnvironmentId(request)
    const executionId = await startExecution(request, testId, environmentId)

    await test.step('Stop lands with a lane Block and a loop-body Block in flight', async () => {
      await waitUntilBothSitesInFlight(page, executionId)

      const stopResponse = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(
        stopResponse.ok(),
        `PUT /executions/${executionId}/stop failed: ${stopResponse.status()}`,
      ).toBeTruthy()

      const terminal = await pollUntilTerminal(request, executionId)
      expect(terminal.status, 'the run verdict stays stopped').toBe('stopped')
    })

    await test.step('The stored record settles every in-flight Block', async () => {
      const response = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
      expect(
        response.ok(),
        `GET /executions/history/${executionId} failed: ${response.status()}`,
      ).toBeTruthy()
      const body = await response.json()
      const data = (body.data ?? body) as Record<string, unknown>
      const states = (data.block_states ?? {}) as Record<string, string>

      expect(
        Object.values(states),
        `no stored Block may read running: ${JSON.stringify(states)}`,
      ).not.toContain('running')
      for (const blockId of IN_FLIGHT_BLOCKS) {
        expect(states[blockId], `${blockId} was in flight at the Stop`).toBe('stopped')
      }
      for (const blockId of FINISHED_BLOCKS) {
        expect(states[blockId], `${blockId} finished before the Stop`).toBe('passed')
      }
      expect(data.status, 'the stored run verdict reads stopped').toBe('stopped')
    })

    await test.step('The run reopened from history paints the settled states', async () => {
      await page.goto(`/executions/history/${executionId}`)
      await expect(page.locator('[data-testid="workbench-page"]')).toHaveAttribute(
        'data-mode',
        'history',
        { timeout: 20_000 },
      )

      for (const blockId of IN_FLIGHT_BLOCKS) {
        await expect(canvasNode(page, blockId)).toHaveAttribute(
          'data-execution-status',
          'stopped',
          { timeout: 15_000 },
        )
      }
      for (const blockId of FINISHED_BLOCKS) {
        await expect(canvasNode(page, blockId)).toHaveAttribute('data-execution-status', 'success')
      }
      await expect(
        page.locator('[data-execution-status="running"]'),
        'no reopened Block may still read running',
      ).toHaveCount(0)
    })

    await test.step('The exported report carries the settled states', async () => {
      const postResponse = await request.post(`${BACKEND_URL}/executions/${executionId}/report`)
      expect(
        [200, 202].includes(postResponse.status()),
        `POST report expected 200/202, got ${postResponse.status()}`,
      ).toBeTruthy()
      const job = await pollReportCompleted(request, executionId)
      await page.goto(
        `${BACKEND_URL}/artifacts/content/${job.artifact_id as string}?disposition=inline`,
      )

      await expect(page.locator('.rpt-h2', { hasText: 'Timeline' })).toBeVisible({
        timeout: 15_000,
      })
      for (const blockId of IN_FLIGHT_BLOCKS) {
        await expect(reportRowStatus(page, BLOCK_LABELS[blockId])).toHaveText('Stopped')
      }
      for (const blockId of FINISHED_BLOCKS) {
        await expect(reportRowStatus(page, BLOCK_LABELS[blockId])).toHaveText('Passed')
      }
      await expect(
        page.locator('.rpt-status-running'),
        'no exported Block may still read Running',
      ).toHaveCount(0)
      await expect(page.locator('.rpt-brandright .rpt-status')).toHaveText('Stopped')
    })
  })
})
