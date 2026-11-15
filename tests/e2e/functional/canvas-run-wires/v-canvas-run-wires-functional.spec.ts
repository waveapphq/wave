/**
 * V-CANVAS-RUN-WIRES-FUNCTIONAL: lane wires after a run
 *
 * After a run, a lane wire is highlighted only when the flow went through that
 * lane, and every other lane wire of a Block that ran is dimmed; a loop body
 * that never ran paints skipped and its wire is dimmed. The live canvas, a
 * reload and the run history agree.
 *
 *   Walk conditions  If/Else with three empty branches that all join the
 *                    Switch, a While whose conditions are false from the start
 *                    (its body Log never runs), then a Wait Until
 *   Branch targets   If/Else whose branches lead to three different Logs, a
 *                    split Assert whose empty pass and fail lanes join the
 *                    Try/Catch, and a Try/Catch whose catch never runs
 *
 * Both Tests are the stored shape a recipe compiles to.
 *
 * REQ: REQ-3.5.1.6 (If/Else), REQ-3.5.1.11 (split Assert), REQ-3.5.1.17 (While),
 * REQ-3.2.2.6 (Try/Catch), REQ-3.2.2.15 (live flow visualization, session recovery)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  clearSettledWorkbenchSession,
  expectNodeStatus,
  finishRun,
  openRunHistory,
  runTrackedTest,
  startRun,
} from '../../helpers/k8s-run'
import fs from 'fs'
import path from 'path'

const RUN_CLOSING_LINE = 'completed successfully'

type WireLook = 'taken' | 'dimmed' | 'failed' | string

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
}

/** The look of one wire by the stroke and opacity the canvas draws. */
async function wireLook(page: Page, edgeId: string): Promise<WireLook> {
  const drawn = await page
    .locator(`[data-testid="rf__edge-${edgeId}"] .react-flow__edge-path`)
    .evaluate((el) => {
      const style = getComputedStyle(el)
      return { stroke: style.stroke, opacity: style.opacity }
    })
  if (drawn.stroke === 'rgb(34, 197, 94)') return 'taken'
  if (drawn.stroke === 'rgb(239, 68, 68)') return 'failed'
  if (drawn.stroke === 'rgb(113, 113, 122)' && drawn.opacity === '0.3') return 'dimmed'
  return `${drawn.stroke} at opacity ${drawn.opacity}`
}

async function expectWires(page: Page, expected: Record<string, WireLook>): Promise<void> {
  await expect
    .poll(
      async () => {
        const seen: Record<string, WireLook> = {}
        for (const edgeId of Object.keys(expected)) seen[edgeId] = await wireLook(page, edgeId)
        return seen
      },
      { timeout: 10_000, message: 'the lane wires show the lanes the run took' },
    )
    .toEqual(expected)
}

const WALK_WIRES: Record<string, WireLook> = {
  'edge-node-1-branch_0-node-2': 'taken',
  'edge-node-1-branch_1-node-2-ingress_1': 'dimmed',
  'edge-node-1-branch_2-node-2-ingress_2': 'dimmed',
  'edge-node-4-body-node-5': 'dimmed',
  'edge-node-4-then-node-6': 'taken',
}

const BRANCH_TARGET_WIRES: Record<string, WireLook> = {
  'edge-node-1-branch_0-node-2': 'taken',
  'edge-node-1-branch_1-node-3': 'dimmed',
  'edge-node-1-branch_2-node-4': 'dimmed',
  'edge-node-5-pass-node-6': 'taken',
  'edge-node-5-fail-node-6-ingress_1': 'dimmed',
  'edge-node-6-try-node-7': 'taken',
  'edge-node-6-catch-node-8': 'dimmed',
  'edge-node-6-then-node-9': 'taken',
}

test.describe('V-CANVAS-RUN-WIRES-FUNCTIONAL: lane wires after a run', () => {
  test('branches that join one Block and a While that never runs its body', async ({ page }) => {
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-walk-conditions.json'))

    await test.step('Run in the Workbench', async () => {
      const status = await startRun(page)
      await finishRun(page, status, RUN_CLOSING_LINE)
    })

    await test.step('Only the IF wire is highlighted; the While body is skipped and dimmed', async () => {
      await expectWires(page, WALK_WIRES)
      await expectNodeStatus(page, 'node-5', 'skipped')
    })

    await test.step('A reload paints the same wires', async () => {
      await page.reload()
      await waitForCanvasLoad(page)
      await expectWires(page, WALK_WIRES)
      await expectNodeStatus(page, 'node-5', 'skipped')
    })

    await test.step('The run history paints the same wires', async () => {
      await clearSettledWorkbenchSession(page.request)
      const run = await runTrackedTest(page.request, testId)
      expect(run.verdict).toBe('passed')
      await openRunHistory(page, run.executionId)
      await expectWires(page, WALK_WIRES)
      await expectNodeStatus(page, 'node-5', 'skipped')
    })
  })

  test('branches to different Blocks, a split Assert that joins, a catch that never runs', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-branch-targets.json'))

    await test.step('Run in the Workbench', async () => {
      const status = await startRun(page)
      await finishRun(page, status, 'run-wires-done')
    })

    await test.step('Each wire shows whether the flow went through it', async () => {
      await expectWires(page, BRANCH_TARGET_WIRES)
      await expectNodeStatus(page, 'node-2', 'success')
      await expectNodeStatus(page, 'node-8', 'skipped')
    })
  })
})
