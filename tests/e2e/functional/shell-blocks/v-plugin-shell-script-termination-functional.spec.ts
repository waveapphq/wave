/**
 * SH-7, SH-8, SH-9: Timeout, Stop and a normal exit each end the whole process tree
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-7, SHRUN-9, SHRUN-12, SHRUN-14, SHRUN-15
 * REQ: REQ-3.4.1.1, REQ-3.2.2.4
 *
 * Pass Criteria:
 * 1. SH-7 timeout (fixture-timeout.json): a Record and continue Shell Script with a
 *    2 second Timeout that left a background sleep reads Exit Code 137, Reason
 *    `Timeout` and Error exactly `Script timed out after 2 seconds`; its Stdout keeps
 *    `started`, printed before the kill; the console carries one WARN line exactly
 *    `Script failed (Timeout): Script timed out after 2 seconds`; the block paints
 *    the recorded amber state; the probe reads `gone`; the run passes within 60 s.
 * 2. SH-8 Stop at top level (fixture-stop.json): once the live `ready-<token>` line
 *    is on the console, an Immediate Stop brings the run to `stopped` within 10 s,
 *    the script paints `stopped` and the probe after it never ran; Run Current on the
 *    probe (a new session over the same artifacts folder) passes and reads `gone`.
 * 3. SH-8 Stop inside Parallel (fixture-stop-parallel.json): once both lanes printed
 *    their ready line, an Immediate Stop brings the run to `stopped` within 10 s and
 *    both lane scripts paint `stopped`; Run Current on the probe after the section
 *    passes and reads exactly `gone gone`.
 * 4. SH-9 leftover job (fixture-leftover.json): a script that exits 0 while its
 *    background sleep still runs passes within 20 s of its 60 s Timeout, reads Exit
 *    Code 0, and the probe reads `gone` (the leftover was killed at exit).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { clearConsoleLogs, getLogEntries, waitForLogText } from '../../helpers/log-reader'
import { selectEnvironment } from '../../helpers/workbench'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { deleteTest } from '../file-picker/picker'
import {
  newToken,
  pairTreeProbeCommand,
  stripOneNewline,
  treeProbeCommand,
  withToken,
} from './shell-helpers'
import fs from 'fs'
import path from 'path'

type Fixture = {
  workflow: { nodes: Array<{ id: string; data: { config: { values: Record<string, unknown> } } }> }
}
type SessionVariables = Record<string, { value: unknown; type: string }>

const createdTests: string[] = []

/** The fixture with its token applied and the probe command taken from the shared builder. */
function loadFixture(
  file: string,
  token: string,
  probe: { nodeId: string; command: string },
): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
  const node = raw.workflow.nodes.find((candidate) => candidate.id === probe.nodeId)
  expect(node, `${file} has no probe node ${probe.nodeId}`).toBeTruthy()
  node!.data.config.values.command = probe.command
  return withToken(raw, token) as unknown as Record<string, unknown>
}

async function importFixture(page: Page, fixture: Record<string, unknown>): Promise<void> {
  createdTests.push(await importValidateAndNavigate(page, fixture))
}

function cell(vars: SessionVariables, name: string): unknown {
  expect(vars[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return vars[name].value
}

async function stopImmediately(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  await expect(page.locator('[data-testid="stop-confirmation-dialog"]')).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'stopped',
    { timeout: 10_000 },
  )
}

/** Run Current on one Block as a second run in the same page: new session id, passed, its variables. */
async function runCurrent(page: Page, nodeId: string): Promise<SessionVariables> {
  const oldSid = await getActiveSessionId(page)
  await clearConsoleLogs(page)
  await selectEnvironment(page)
  await clickNodeKebabItem(page, nodeId, 'Run Current')
  let newSid = oldSid
  await expect
    .poll(
      async () => {
        newSid = await getActiveSessionId(page)
        return newSid
      },
      { timeout: 30_000, message: `Run Current on ${nodeId} never started a new session` },
    )
    .not.toBe(oldSid)
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'passed',
    { timeout: 30_000 },
  )
  return getSessionVariables(page, newSid)
}

test.describe('SH-7, SH-8, SH-9: Shell Script termination ends the whole tree', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('SH-7 a Timeout kills the script and its background job, keeping the output so far', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const token = newToken()
    await importFixture(
      page,
      loadFixture('fixture-timeout.json', token, {
        nodeId: 'sh-timeout-probe',
        command: treeProbeCommand(7, 'bg.pid'),
      }),
    )

    const status = await startRun(page)
    await finishRun(page, status, `SH-7-done-${token}`, 60_000)
    const vars = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('the timed-out script records Timeout with exit code 137', async () => {
      expect(cell(vars, 't_code'), 'a WAVE stop reads exit code 137').toBe(137)
      expect(cell(vars, 't_reason')).toBe('Timeout')
      expect(cell(vars, 't_err')).toBe('Script timed out after 2 seconds')
      expect(
        stripOneNewline(String(cell(vars, 't_out'))),
        'output printed before the kill is kept',
      ).toBe('started')
      await expectNodeStatus(page, 'sh-timeout', 'warning')
      const warns = (await getLogEntries(page)).filter(
        (entry) =>
          entry.level === 'WARN' &&
          entry.message === 'Script failed (Timeout): Script timed out after 2 seconds',
      )
      expect(warns, 'exactly one recorded-timeout WARN line').toHaveLength(1)
    })

    await test.step('the background job is gone', () => {
      expect(stripOneNewline(String(cell(vars, 'probe')))).toBe('gone')
    })
  })

  test('SH-8 an Immediate Stop kills the script and its background job', async ({ page }) => {
    test.setTimeout(150_000)
    const token = newToken()
    await importFixture(
      page,
      loadFixture('fixture-stop.json', token, {
        nodeId: 'sh-stop-probe',
        command: treeProbeCommand(8, 'bg.pid'),
      }),
    )

    await startRun(page)
    await waitForLogText(page, `ready-${token}`, 30_000)
    await stopImmediately(page)

    await test.step('the script paints stopped and the run never reached the probe', async () => {
      await expectNodeStatus(page, 'sh-stop', 'stopped')
      const vars = await getSessionVariables(page, await getActiveSessionId(page))
      expect(cell(vars, 'stop_probe'), 'the Stop halts the run before the probe').toBe('')
    })

    await test.step('Run Current on the probe reads gone', async () => {
      const vars = await runCurrent(page, 'sh-stop-probe')
      expect(stripOneNewline(String(cell(vars, 'stop_probe')))).toBe('gone')
    })
  })

  test('SH-8 an Immediate Stop kills both Parallel lanes and their background jobs', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const token = newToken()
    await importFixture(
      page,
      loadFixture('fixture-stop-parallel.json', token, {
        nodeId: 'sh-stop-par-probe',
        command: pairTreeProbeCommand(8, 'a.pid', 'b.pid'),
      }),
    )

    await startRun(page)
    await waitForLogText(page, `ready-a-${token}`, 30_000)
    await waitForLogText(page, `ready-b-${token}`, 30_000)
    await stopImmediately(page)

    await test.step('both lane scripts paint stopped', async () => {
      await expectNodeStatus(page, 'sh-stop-a', 'stopped')
      await expectNodeStatus(page, 'sh-stop-b', 'stopped')
      const vars = await getSessionVariables(page, await getActiveSessionId(page))
      expect(cell(vars, 'par_probe'), 'the Stop halts the run before the probe').toBe('')
    })

    await test.step('Run Current on the probe reads gone gone', async () => {
      const vars = await runCurrent(page, 'sh-stop-par-probe')
      expect(stripOneNewline(String(cell(vars, 'par_probe')))).toBe('gone gone')
    })
  })

  test('SH-9 a background job left running at a normal exit is killed with the script', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const token = newToken()
    await importFixture(
      page,
      loadFixture('fixture-leftover.json', token, {
        nodeId: 'sh-leftover-probe',
        command: treeProbeCommand(9, 'left.pid'),
      }),
    )

    // The 20 s ceiling is well under the block's 60 s Timeout, so a job holding the output open fails here.
    const status = await startRun(page)
    await finishRun(page, status, `SH-9-done-${token}`, 20_000)
    const vars = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('the script passes with exit code 0', async () => {
      expect(cell(vars, 'l_code')).toBe(0)
      await expectNodeStatus(page, 'sh-leftover', 'success')
    })

    await test.step('the leftover job is gone', () => {
      expect(stripOneNewline(String(cell(vars, 'probe')))).toBe('gone')
    })
  })
})
