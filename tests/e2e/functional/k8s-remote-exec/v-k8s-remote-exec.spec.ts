/**
 * V-K8S-REMOTE-EXEC: the K8s exec channel inside a Remote Execution container.
 *
 * One workflow opens an SSH session to the stack's sshd host and runs a Remote
 * Execution whose body holds a Connect, an Exec, two Scripts and an Exec the
 * cluster refuses. The cluster is named by its compose DNS name (`kwok`),
 * which resolves only inside the stack network, so a Connect that reads the
 * cluster version can only have run on the SSH host. Every Block is read back
 * through all four outputs it declares, and the refused one adds error and
 * reason.
 *
 * The refusal MESSAGE differs between the v4 and v5 transports and the remote
 * worker runs the same vendored client, so only the reason and the wrapper
 * WAVE puts around it are asserted.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-3.4.1.5
 *
 * Pass Criteria:
 *   KR-10  the exec channel works inside the container: an Exec binds its
 *          stdout byte for byte, a two-line /bin/sh Script keeps its two
 *          streams apart, a non-zero exit is data with success true and no
 *          WARN line, and a pod the cluster grants no exec is recorded with
 *          reason InternalError, empty streams, exactly one WARN line and an
 *          amber Block while the run still passes
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { getLogEntries } from '../../helpers/log-reader'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  buildExecFixture,
  connectedLine,
  EXEC_DONE_MARKER,
  EXEC_IDS,
  EXEC_KEYS,
  EXEC_MARKER,
  EXEC_VARS,
  execEchoStdout,
  expectLocusBadges,
  expectStatuses,
  K8S_DIRECT_URL,
  K8S_VERSION,
  RC3_EXIT,
  RC3_STDERR,
  RC3_STDOUT,
  textOf,
  TWO_LINE_STDERR,
  TWO_LINE_STDOUT,
  type SessionVariables,
} from './cases-remote'
import {
  CONTAINER_APP,
  EXEC_POD,
  EXEC_POD_B,
  execRefused,
  expectEmptyStreams,
  expectLine,
  expectNoRecordedWarning,
  expectRecordedCore,
  expectRecordedWarning,
  expectStreams,
  NO_EXEC_POD,
  NO_EXEC_REASON,
  ranCommandLine,
  ranScriptLine,
  where,
} from '../k8s-exec/cases-exec'

test.describe('The K8s exec channel inside a Remote Execution container', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'exec')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-10: the exec channel works inside the container, and a cluster refusal is recorded', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const k = EXEC_KEYS
    const locus = (pod: string): string => where(pod, CONTAINER_APP, run.namespace)

    const fixture = buildExecFixture({
      suffix: run.suffix,
      namespace: run.namespace,
      podExec: EXEC_POD,
      podExecB: EXEC_POD_B,
      podNoExec: NO_EXEC_POD,
      container: CONTAINER_APP,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    await test.step('every body Block carries the R badge and nothing else does', async () => {
      await expectLocusBadges(page, fixture)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, EXEC_DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = await getLogEntries(page)

    await test.step('the body reached the cluster by its stack name', () => {
      expect(textOf(vars, EXEC_VARS.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expectLine(logs, connectedLine(K8S_DIRECT_URL))
    })

    await test.step('KR-10: an Exec on the host binds its stdout byte for byte', () => {
      expectStreams(vars, k.mark, {
        stdout: execEchoStdout(run.suffix),
        stderr: '',
        exitCode: 0,
      })
      expectLine(logs, ranCommandLine(EXEC_POD, 0))
    })

    await test.step('KR-10: a two-line /bin/sh script keeps its two streams apart', () => {
      expectStreams(vars, k.two, {
        stdout: TWO_LINE_STDOUT(run.suffix),
        stderr: TWO_LINE_STDERR(run.suffix),
        exitCode: 0,
      })
      expectLine(logs, ranScriptLine(EXEC_POD_B, 0))
    })

    await test.step('KR-10: a non-zero exit is data on the remote locus too', () => {
      expectStreams(vars, k.rc3, {
        stdout: RC3_STDOUT(run.suffix),
        stderr: RC3_STDERR(run.suffix),
        exitCode: RC3_EXIT,
      })
      expectLine(logs, ranScriptLine(EXEC_POD_B, RC3_EXIT))
      expectNoRecordedWarning(entries, 'Script', all)
    })

    await test.step('KR-10: a pod the cluster grants no exec is recorded', () => {
      const message = expectRecordedCore(vars, k.noexec, NO_EXEC_REASON)
      expect(
        message.startsWith(execRefused(locus(NO_EXEC_POD), '')),
        `the refusal must name the pod and container it targeted.\n${all}`,
      ).toBeTruthy()
      expectEmptyStreams(vars, k.noexec)
      expectRecordedWarning(entries, 'Exec', NO_EXEC_REASON, message, all)
    })

    await test.step('the summary line, the Block statuses and the run verdict', async () => {
      const marker = logs.find((text) => text.startsWith(EXEC_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${EXEC_MARKER} mark=0 two=0 rc=${RC3_EXIT} noexec=${NO_EXEC_REASON}`,
      )
      await expectStatuses(page, fixture, { [EXEC_IDS.noexec]: 'warning' })
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })
})
