/**
 * V-PLUGIN-REMOTE-EXEC-NESTED-FUNCTIONAL: Remote Execution container inside sub-flows
 * Wireframe: N/A (no new visual surface)
 * Design Decisions: REMEX-1, REMEX-4
 * REQ: REQ-3.4.1.3
 *
 * One Test against the real `sshd` service of the E2E stack (connection-scoped, no remote writes):
 *   sh-wave-host  -> Shell Script `hostname` on WAVE binds wave_host
 *   ssh-open      -> the Execution Host session
 *   ssh-host      -> SSH Session Exec `hostname` over the session binds ssh_host
 *   try-block     -> try path: Remote Execution, body File I/O reads /etc/hostname into try_host
 *   par-block     -> lane 1: Remote Execution, body File I/O into lane_host; lane 2: a Log
 *   switch-block  -> case branch: Remote Execution, body File I/O into case_host
 *   loop-block    -> For Loop count 2: Remote Execution, body File I/O into loop_host, then a Log marker
 *   log-done      -> bookend
 *
 * Pass Criteria:
 * 1. The fixture imports and validates with zero errors in the run context
 * 2. No console entry contains "Plugin remote-execution"
 * 3. The run passes
 * 4. try_host, lane_host, case_host and loop_host (trimmed) each equal the host name SSH Session
 *    Exec read over the session, and each differs from wave_host
 * 5. The loop's INFO marker line appears exactly twice, once per iteration
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { getNodeStatuses, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, getLogEntries } from '../../helpers/log-reader'
import { deleteTest } from '../file-picker/picker'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

const MISSING_PLUGIN = 'Plugin remote-execution'
const BODY_HOST_VARIABLES = ['try_host', 'lane_host', 'case_host', 'loop_host'] as const

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-nested.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** Console copy texts once the bookend renders, or once the tail of a run that ended early stops growing. */
async function settledConsole(page: Page, verdict: string | null, bookend: string): Promise<string[]> {
  let texts: string[] = []
  let previous = -1
  await expect
    .poll(
      async () => {
        texts = await getLogCopyTexts(page)
        if (texts.some((text) => text.includes(bookend))) return true
        const settled = verdict !== 'passed' && texts.length > 0 && texts.length === previous
        previous = texts.length
        return settled
      },
      { timeout: 30_000, intervals: [1_000], message: `expected the console to render "${bookend}"` },
    )
    .toBe(true)
  return texts
}

test.describe('Remote Execution container inside sub-flows', () => {
  const createdTests: string[] = []

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) await deleteTest(request, testId)
  })

  test('containers in a try path, a lane, a case branch and a loop body run on the host', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const token = newToken()
    const bookend = `remote-exec-nested-done-${token}`
    const loopMarker = `nested-loop-${token}`

    const testId = await importValidateAndNavigate(page, withToken(loadFixture(), token), {
      injectSsh: true,
    })
    createdTests.push(testId)

    await test.step('the fixture validates with zero errors for a run', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(result.errors, `run validation errors: ${JSON.stringify(result.errors)}`).toEqual([])
    })

    const status = await startRun(page)
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 240_000 })
    const verdict = await status.getAttribute('data-status')
    const copyTexts = await settledConsole(page, verdict, bookend)
    const all = copyTexts.join('\n')
    const variables = await getSessionVariables(page, await getActiveSessionId(page))
    const hostOf = (name: string): string => {
      expect(variables[name], `session variable ${name}`).toBeDefined()
      return String(variables[name].value).trim()
    }
    if (verdict !== 'passed') {
      console.log('=== NESTED REMOTE EXEC WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('variables:', JSON.stringify(variables, null, 2))
      console.log('console:', all)
    }

    await test.step('no console entry names a missing remote-execution plugin', () => {
      const offending = copyTexts.filter((text) => text.includes(MISSING_PLUGIN))
      expect(offending, `console entries naming "${MISSING_PLUGIN}"`).toEqual([])
    })

    await test.step('the run passes', () => {
      expect(verdict, `run verdict.\n${all}`).toBe('passed')
    })

    await test.step('every container body read the host name of the execution host', () => {
      const waveHost = hostOf('wave_host')
      const sshHost = hostOf('ssh_host')
      expect(waveHost, 'the top-level Shell Script printed a hostname').not.toBe('')
      expect(sshHost, 'SSH Session Exec printed the host hostname').not.toBe('')
      expect(sshHost, 'the execution host is not the WAVE machine').not.toBe(waveHost)
      for (const name of BODY_HOST_VARIABLES) {
        const bodyHost = hostOf(name)
        expect(bodyHost, `${name} was read on the execution host`).toBe(sshHost)
        expect(bodyHost, `${name} was not read on WAVE`).not.toBe(waveHost)
      }
    })

    await test.step('the loop marker appears once per iteration', async () => {
      // Rows in the console's own order: a copy-text read is ordered within one scroll window only.
      const markers = (await getLogEntries(page))
        .filter((entry) => entry.level !== 'DEBUG' && entry.message.includes(loopMarker))
        .map((entry) => entry.message)
      expect(markers, `loop marker lines.\n${all}`).toEqual([
        `${loopMarker} iter=0`,
        `${loopMarker} iter=1`,
      ])
    })
  })
})
