/**
 * SH-17, SH-18: A Stop or a dropped session during a remote block ends this run's own worker
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-15
 * REQ: REQ-3.4.1.3, REQ-3.2.2.4
 *
 * Pass Criteria:
 * 1. The host probe Test (fixture-host-probe.json) reads a worker count, not its seed,
 *    before each main run.
 * 2. SH-17 (fixture-remote-stop.json): once the body's armed marker is on the console, an
 *    Immediate Stop brings the run to `stopped` within 10 s, well before the 60 s remote
 *    request could answer.
 * 3. SH-17: the in-body probe recorded at least one pid of a worker whose parent is this
 *    run's own sshd process, so a worker was there to be stopped.
 * 4. SH-17: with those pids written into the probe command through the config sheet, the
 *    probe Test reads `gone` for every one of them within 20 s of the Stop, far below the
 *    60 s the remote request would take to answer.
 * 5. SH-18 (fixture-remote-drop.json): the run ends, any verdict, inside 60 s although the
 *    worker lane holds a 60 s request; the worker lane's body raises and is caught, and the
 *    catch lands after the killer lane's Delay finished, so it is the drop that ended it.
 * 6. SH-18: the killer lane reads `dropped <pid> <ppid>` and its pid is exactly the one the
 *    in-body probe recorded, so the killer ended this run's own worker and no other.
 * 7. SH-18: that pid reads `gone` in the probe Test's second run within 20 s, far below the
 *    60 s the remote request would take to answer. No absolute host-wide
 *    count is asserted, because other suites hold workers on the same host.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getSessionVariables } from '../../helpers/fixture-import'
import { finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { clearConsoleLogs, waitForLogText } from '../../helpers/log-reader'
import { setStringParam } from '../../helpers/param-config'
import { BACKEND_URL } from '../../helpers/config'
import {
  deleteTest,
  importWithTestData,
  openConfig,
  openTestOnCanvas,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'
import fs from 'fs'
import path from 'path'

type SessionVariables = Record<string, { value: unknown; type: string }>

const PROBE_NODE = 'probe-exec'

const createdTests: string[] = []

function loadFixture(file: string, token: string, name?: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
  const fixture = withToken(raw, token)
  if (name) fixture.name = name
  return fixture
}

async function importTest(page: Page, file: string, token: string, name?: string): Promise<string> {
  const testId = await importWithTestData(page, loadFixture(file, token, name), [], {
    injectSsh: true,
  })
  createdTests.push(testId)
  return testId
}

function cell(vars: SessionVariables, name: string): unknown {
  expect(vars[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return vars[name].value
}

/** The session the workbench holds right now, or '' when there is none yet. */
async function currentSessionId(page: Page): Promise<string> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as { data?: { session_id?: string } } | null
  return body?.data?.session_id ?? ''
}

/** Start a run and wait until the workbench reports the new session it opened. */
async function startNewRun(page: Page): Promise<{ status: Locator; sid: string }> {
  const oldSid = await currentSessionId(page)
  const clear = page
    .locator('[data-testid="console-panel-header"] button[aria-label="Clear console"]')
    .first()
  if ((await clear.count()) > 0 && (await clear.isEnabled())) await clearConsoleLogs(page)
  const status = await startRun(page)
  let sid = oldSid
  await expect
    .poll(
      async () => {
        sid = await currentSessionId(page)
        return sid
      },
      { timeout: 30_000, message: 'the run never opened a new session' },
    )
    .not.toBe(oldSid)
  return { status, sid }
}

/** Run the open probe Test to a pass and return what its probe printed. */
async function runHostProbe(page: Page, token: string): Promise<string> {
  const { status, sid } = await startNewRun(page)
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
  await waitForLogText(page, `SH-17-probe-done-${token}`, 30_000)
  return stripOneNewline(String(cell(await getSessionVariables(page, sid), 'host_probe')))
}

// The sheet editor auto-closes quotes and brackets; this text types back unchanged.
function checkerCommand(pids: readonly string[]): string {
  return (
    `s=; for p in ${pids.join(' ')}; do set -- $(cat /proc/$p/stat 2>/dev/null); ` +
    'if [ -n "$3" ] && [ "$3" != Z ]; then r=alive; else r=gone; fi; ' +
    'printf %s%s "$s" $r; s=" "; done'
  )
}

/** Reopen the probe Test and save the checker for `pids` as its probe command. */
async function armChecker(page: Page, probeId: string, pids: readonly string[]): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  await openTestOnCanvas(page, probeId)
  const command = checkerCommand(pids)
  const dialog = await openConfig(page, PROBE_NODE)
  await setStringParam(dialog, page, 'command', command)
  await saveConfig(dialog)
  await saveWorkbench(page)
  const nodes = await persistedNodes(page.request, probeId)
  expect(
    nodes[PROBE_NODE].config.values.command,
    'the saved probe must carry the checker for these pids',
  ).toBe(command)
}

async function expectBaselineCount(page: Page, token: string): Promise<void> {
  await test.step('the host probe reads a worker count before the run', async () => {
    const baseline = await runHostProbe(page, token)
    expect(baseline, 'an unread probe keeps its seed').toMatch(/^\d+$/)
  })
}

async function stopImmediately(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  await expect(page.locator('[data-testid="stop-confirmation-dialog"]')).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
  await expect(
    page.locator('[data-testid="workflow-status"]'),
    'the Stop must not wait for the 60 s remote request',
  ).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 })
}

test.describe('SH-17, SH-18: a remote block ends its own worker on Stop or a dropped session', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('SH-17 a Stop during a remote block leaves this run\'s own workers gone', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const probeId = await importTest(page, 'fixture-host-probe.json', token)
    await expectBaselineCount(page, token)

    await importTest(page, 'fixture-remote-stop.json', token)
    const { sid } = await startNewRun(page)
    await waitForLogText(page, `SH-17-armed-${token}`, 30_000)
    await stopImmediately(page)

    const pids = await test.step('the in-body probe recorded this connection\'s worker pids', async () => {
      const vars = await getSessionVariables(page, sid)
      const recorded = stripOneNewline(String(cell(vars, 'probe_during')))
      expect(recorded, 'a worker must have been up on this connection').toMatch(/^\d+( \d+)*$/)
      return recorded.split(' ')
    })

    await test.step('every recorded worker is gone after the Stop', async () => {
      await armChecker(page, probeId, pids)
      // A stopped request gets a short unwind; 20 s stays far below the 60 s request answering.
      await expect(async () => {
        expect(await runHostProbe(page, token)).toBe(pids.map(() => 'gone').join(' '))
      }).toPass({ timeout: 20_000, intervals: [1_000] })
    })
  })

  test('SH-18 a dropped session ends this run\'s own worker', async ({ page }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const probeId = await importTest(page, 'fixture-host-probe.json', token, `SH-18 probe ${token}`)
    await expectBaselineCount(page, token)

    await importTest(page, 'fixture-remote-drop.json', token)
    const started = Date.now()
    const { status, sid } = await startNewRun(page)
    const { logs } = await finishRunAnyVerdict(page, status, `SH-18-done-${token}`, 60_000)

    await test.step('the run ends rather than hanging on the 60 s request', () => {
      expect(Date.now() - started, 'the run must end inside 60 s').toBeLessThan(60_000)
      const caught = logs.findIndex((line) => line.includes(`SH-18-caught-${token}`))
      expect(caught, `the drop must end the worker lane's body.\n${logs.join('\n')}`).not.toBe(-1)
      // The killer runs only after its Delay, so an earlier catch is not the drop.
      const armed = logs.findIndex((line) => line.startsWith('Wait complete'))
      expect(
        armed,
        `the killer lane's Delay must finish before the body is caught.\n${logs.join('\n')}`,
      ).not.toBe(-1)
      expect(
        caught,
        `the body was caught before the killer lane could drop the session.\n${logs.join('\n')}`,
      ).toBeGreaterThan(armed)
    })

    const recorded = await test.step('the killer ended the worker this run recorded', async () => {
      const vars = await getSessionVariables(page, sid)
      const own = stripOneNewline(String(cell(vars, 'probe_during')))
      expect(own, 'the body must record exactly one worker pid').toMatch(/^\d+$/)
      const killed = stripOneNewline(String(cell(vars, 'killed_pid')))
      const match = /^dropped (\d+) (\d+)$/.exec(killed)
      expect(match, `killed_pid reads "${killed}"`).not.toBeNull()
      expect(match?.[1], 'the killer must end this run\'s own worker').toBe(own)
      return own
    })

    await test.step('the dropped worker is gone', async () => {
      await armChecker(page, probeId, [recorded])
      // A closed session gets the same short unwind as a Stop; 20 s stays far below the 60 s request.
      await expect(async () => {
        expect(await runHostProbe(page, token)).toBe('gone')
      }).toPass({ timeout: 20_000, intervals: [1_000] })
    })
  })
})
