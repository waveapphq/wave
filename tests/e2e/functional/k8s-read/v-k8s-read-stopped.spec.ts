/**
 * V-K8S-READ-STOPPED: a read whose lane is cut short stays quiet.
 *
 * A Parallel lane carries a short time limit and holds a K8s Get the stub
 * answers eight seconds later. The lane expires, the read Block is painted
 * stopped and the run ends - and the read's own console line must never be
 * written, not while the run is settling and not once the cluster finally
 * answers. A line that lands after the Block was painted stopped tells the
 * user a Block that was cut short did its work.
 *
 * Nothing is seeded: the fault injector answers any namespace, and its `delay`
 * directive rides the K8s Connect api_url path prefix.
 *
 * Local id: STOPPED-READ-SILENT
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 *
 * Pass Criteria:
 *   STOPPED-READ-SILENT  the lane expires with the read in flight (the Connect
 *         reads success, the read reads stopped), the exit lane never runs and
 *         the run fails; the read Block's own line is absent when the run
 *         settles AND still absent after the stub's answer is due; the read
 *         binds nothing
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import {
  branchExpiredLine,
  BRANCH_LIMIT_MS,
  buildStoppedReadFixture,
  EXIT_MARKER,
  QUIET_MARKER,
  READ_DELAY_SECONDS,
  READ_LINE_RE,
  READER_BRANCH,
  STOPPED_IDS,
  STOPPED_VARS,
} from './cases-stopped'

/** Long enough for the stub's held answer to be due and delivered. */
const PAST_THE_DELAY_MS = (READ_DELAY_SECONDS + 4) * 1000

test.describe('A K8s read whose Parallel lane runs out of time', () => {
  test('STOPPED-READ-SILENT: the cut-short read never writes its line', async ({ page }) => {
    test.setTimeout(180_000)

    await importValidateAndNavigate(page, buildStoppedReadFixture(), { injectHttp: true })

    const expired = branchExpiredLine(READER_BRANCH, BRANCH_LIMIT_MS)
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, expired, 120_000)
    const all = logs.join('\n')

    await test.step('the lane expired with the read in flight', async () => {
      const entries = await getLogEntries(page)
      const expiries = entries.filter((entry) => entry.message === expired)
      expect(expiries.length, `expected exactly one lane-limit line.\n${all}`).toBe(1)
      expect(expiries[0].level, 'the lane limit is reported at ERROR level').toBe('ERROR')
      await expectNodeStatus(page, STOPPED_IDS.connect, 'success')
      await expectNodeStatus(page, STOPPED_IDS.read, 'stopped')
      expect(
        logs.some((text) => text.includes(QUIET_MARKER)),
        `the sibling lane must have finished.\n${all}`,
      ).toBeTruthy()
      expect(
        logs.some((text) => text.includes(EXIT_MARKER)),
        `an expired lane skips the exit lane.\n${all}`,
      ).toBeFalsy()
      expect(verdict, `the run must fail.\n${all}`).toBe('failed')
    })

    await test.step('the read writes no line while the run settles', () => {
      const late = logs.filter((text) => READ_LINE_RE.test(text))
      expect(late, `the stopped read must write no line.\n${all}`).toEqual([])
    })

    await test.step('and none once the held answer is due', async () => {
      await page.waitForTimeout(PAST_THE_DELAY_MS)
      const after = (await getLogEntries(page)).map((entry) => entry.message)
      const late = after.filter((text) => READ_LINE_RE.test(text))
      expect(
        late,
        `the stopped read must write no line after its answer arrives.\n${after.join('\n')}`,
      ).toEqual([])
    })

    await test.step('the stopped read bound nothing', async () => {
      const sessionId = await getActiveSessionId(page)
      const vars = await getSessionVariables(page, sessionId)
      expect(vars[STOPPED_VARS.count]?.value, 'the count stays at its zero value').toBe(0)
      expect(vars[STOPPED_VARS.names]?.value, 'the names stay at their zero value').toEqual([])
    })
  })
})
