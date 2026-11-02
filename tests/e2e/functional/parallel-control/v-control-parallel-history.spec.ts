/**
 * V-CONTROL-PARALLEL-HISTORY: abandoned lanes read stopped on a reopened run
 *
 * REQ: REQ-3.2.3.5, REQ-3.2.3.6, REQ-3.2.3.8
 *
 * The live canvas paints from the run's own block_status_changed events; the
 * historical canvas paints from the stored block_states of the finished run.
 * They are different sources, so a lane left without a terminal state can look
 * settled on one and not on the other. This spec proves the stored run.
 *
 * Pass Criteria (fixture-stopped-lanes.json, one tracked run):
 * 1. The reopened run paints each abandoned one-Block lane stopped
 * 2. The lane that finished keeps its own result and the failing lane keeps its
 *    failure; the exit lane reads skipped
 * 3. No Block anywhere on the reopened canvas reads running
 * 4. The stored run log names each stopped lane
 *
 * A tracked run (POST /executions) is required: a workbench Run has no history
 * route.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importFixtureTest } from '../../helpers/fixture-import'
import { openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

test.describe('V-CONTROL-PARALLEL-HISTORY: a finished run reopened from history', () => {
  test('Abandoned lanes read stopped and nothing is left running', async ({ page }) => {
    const testId = await importFixtureTest(page, loadFixture('fixture-stopped-lanes.json'))
    const { executionId, verdict } = await runTrackedTest(page.request, testId)
    expect(verdict, 'a failing lane must fail the tracked run').toBe('failed')

    const historyResp = await page.request.get(`${BACKEND_URL}/executions/history/${executionId}`)
    expect(
      historyResp.ok(),
      `GET /executions/history/${executionId} failed: ${historyResp.status()}`,
    ).toBeTruthy()
    const historyBody = await historyResp.json()
    const historyData = (historyBody.data ?? historyBody) as {
      block_states?: Record<string, string>
      logs?: Array<Record<string, unknown>>
    }
    const blockStates = historyData.block_states ?? {}
    const stateDump = JSON.stringify(blockStates)

    await test.step('The stored run carries a terminal state for every Block', () => {
      expect(blockStates['delay-sl-adrift'], `adrift lane. ${stateDump}`).toBe('stopped')
      expect(blockStates['delay-sl-marooned'], `marooned lane. ${stateDump}`).toBe('stopped')
      expect(blockStates['log-sl-quick'], `the lane that finished. ${stateDump}`).toBe('passed')
      expect(blockStates['log-sl-boom'], `the lane that failed. ${stateDump}`).toBe('failed')
      expect(blockStates['log-sl-then'], `the exit lane. ${stateDump}`).toBe('skipped')
      expect(
        Object.entries(blockStates).filter(([, value]) => value === 'running'),
        `No Block may be stored as running. ${stateDump}`,
      ).toHaveLength(0)
    })

    await test.step('The stored run log names each stopped lane', () => {
      const messages = (historyData.logs ?? []).map((entry) => String(entry.message ?? ''))
      const dump = messages.join('\n')
      for (const branch of ['adrift', 'marooned']) {
        expect(
          messages.some((m) => m.includes(`Branch '${branch}' stopped`)),
          `The stored run log must name the stopped lane "${branch}".\n${dump}`,
        ).toBeTruthy()
      }
    })

    await openRunHistory(page, executionId)

    await test.step('The reopened canvas paints what the stored run recorded', async () => {
      const node = (nodeId: string) => page.locator(`[data-testid="workflow-node-${nodeId}"]`)
      await expect(node('delay-sl-adrift')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node('delay-sl-marooned')).toHaveAttribute('data-execution-status', 'stopped')
      await expect(node('log-sl-quick')).toHaveAttribute('data-execution-status', 'success')
      await expect(node('log-sl-boom')).toHaveAttribute('data-execution-status', 'failed')
      await expect(node('log-sl-then')).toHaveAttribute('data-execution-status', 'skipped')
      await expect(
        page.locator('[data-testid^="workflow-node-"][data-execution-status="running"]'),
        'No Block may be painted running on a finished run',
      ).toHaveCount(0)
    })
  })
})
