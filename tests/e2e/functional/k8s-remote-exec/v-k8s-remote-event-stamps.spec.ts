/**
 * V-K8S-REMOTE-EVENT-STAMPS: an Events read binds the same result on WAVE and
 * on the host, whatever offset form the cluster stamps its events with.
 *
 * Clusters and proxies write a UTC offset in more than one shape. WAVE reads
 * one Python and the pushed worker another, so a stamp form only one of them
 * accepts turns the same Block into a pass locally and a failure remotely.
 * One workflow reads the same events both ways over the same form, and the two
 * results have to agree; a third read repeats it on the hour-only form.
 *
 * Nothing is seeded: the fault injector serves the events, and the form rides
 * the K8s Connect api_url path prefix.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-3.3.5.4
 *
 * Pass Criteria:
 *   KR-7  the run passes; the read on WAVE and the read on the host bind the
 *         same event count and the same event names over colonless offsets,
 *         the host repeats it over hour-only offsets, and every stamp the run
 *         saw carried the form under test
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { getLogTexts } from '../../helpers/log-reader'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import { randomUUID } from 'node:crypto'
import {
  buildStampsFixture,
  cell,
  COLONLESS_OFFSET_RE,
  expectLocusBadges,
  expectStatuses,
  HOUR_OFFSET_RE,
  numberOf,
  STAMPS_DONE_MARKER,
  STAMPS_MARKER,
  STAMPS_VARS,
  STUB_EVENT_NAMES,
  type SessionVariables,
} from './cases-remote'

/** One event as the map-mode `result` carries it. */
type EventItem = {
  metadata?: { name?: string }
  lastTimestamp?: string
}

const eventsOf = (vars: SessionVariables, name: string): EventItem[] =>
  cell(vars, name).value as EventItem[]

const namesOf = (vars: SessionVariables, name: string): string[] =>
  eventsOf(vars, name)
    .map((event) => event.metadata?.name ?? '')
    .sort()

const stampsOf = (vars: SessionVariables, name: string): string[] =>
  eventsOf(vars, name).map((event) => event.lastTimestamp ?? '')

test.describe('K8s Events over offset forms, on WAVE and inside a Remote Execution container', () => {
  test('KR-7: the same events bind the same way on both sides', async ({ page }) => {
    test.setTimeout(240_000)
    const v = STAMPS_VARS

    const fixture = buildStampsFixture({
      suffix: randomUUID().slice(0, 8),
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true, injectHttp: true })
    await expectLocusBadges(page, fixture)

    const status = await startRun(page)
    // The bookend is on the then branch, so a run that fails inside the body
    // never prints it. Read the verdict first, so a failure names its reason.
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 180_000 })
    const settled = await status.getAttribute('data-status')
    if (settled !== 'passed') {
      const printed = (await getLogTexts(page)).join('\n')
      expect(settled, `the run must pass on both sides.\n${printed}`).toBe('passed')
    }
    const logs = await finishRun(page, status, STAMPS_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const expected = [...STUB_EVENT_NAMES].sort()

    await test.step('the read on WAVE binds the events', () => {
      expect(numberOf(vars, v.localCount), `the count on WAVE.\n${all}`).toBe(expected.length)
      expect(namesOf(vars, v.localResult), 'the event names on WAVE').toEqual(expected)
      for (const stamp of stampsOf(vars, v.localResult)) {
        expect(stamp, 'every stamp on WAVE carries a colonless offset').toMatch(
          COLONLESS_OFFSET_RE,
        )
      }
    })

    await test.step('the read on the host binds the same thing', () => {
      expect(numberOf(vars, v.remoteCount), `the count on the host.\n${all}`).toBe(
        numberOf(vars, v.localCount),
      )
      expect(namesOf(vars, v.remoteResult), 'the event names on the host').toEqual(
        namesOf(vars, v.localResult),
      )
      for (const stamp of stampsOf(vars, v.remoteResult)) {
        expect(stamp, 'every stamp on the host carries a colonless offset').toMatch(
          COLONLESS_OFFSET_RE,
        )
      }
    })

    await test.step('and the same again over hour-only offsets', () => {
      expect(numberOf(vars, v.hourCount), `the hour-only count.\n${all}`).toBe(
        numberOf(vars, v.localCount),
      )
      expect(namesOf(vars, v.hourResult), 'the hour-only event names').toEqual(
        namesOf(vars, v.localResult),
      )
      for (const stamp of stampsOf(vars, v.hourResult)) {
        expect(stamp, 'every hour-only stamp carries a two digit offset').toMatch(HOUR_OFFSET_RE)
      }
    })

    await test.step('the summary marker and the Block statuses', async () => {
      const marker = logs.find((text) => text.startsWith(STAMPS_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${STAMPS_MARKER} local=${numberOf(vars, v.localCount)}` +
          ` remote=${numberOf(vars, v.remoteCount)} hour=${numberOf(vars, v.hourCount)}`,
      )
      await expectStatuses(page, fixture, {})
    })
  })
})
