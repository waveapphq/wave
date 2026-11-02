/**
 * V-K8S-EXEC-COMMAND: the K8s Exec Block against the real kwok cluster.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test, runs
 * only against the run's own exec-fixture pods, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SEXEC-1, K8SEXEC-9
 *
 * Four runs. The golden run pins the shape the node factories emit and proves
 * it executes; the command sweep chains the five legs that read a real
 * busybox process; the two refusals share one run because neither writes
 * anything the other needs; the hard failure gets its own run because it ends
 * the run.
 *
 * Every positive leg is read back through all four outputs the Block declares -
 * stdout, stderr, exit_code and success - not just the headline stream, and
 * every recorded leg adds error and reason. The bound variables are the
 * primary surface; the plugin's own INFO line and the canvas statuses are the
 * other two.
 *
 * Pass Criteria:
 *   KE-01  the node factories emit the checked-in golden shape
 *   KE-02  the golden workflow runs: the command's output, its empty error
 *          stream, its exit code and success all come back bound
 *   KE-03  a busybox command writes to standard output AND standard error and
 *          exits 0, and all four outputs carry it
 *   KE-04  the same command in the `app` container lands in that container's
 *          working directory and sees that container's WAVE_EXEC_TARGET
 *   KE-05  the same command in the `sidecar` container lands in a different
 *          working directory and sees a different WAVE_EXEC_TARGET, so
 *          Container is honored rather than decorative
 *   KE-06  a non-zero exit is data: exit_code carries the code, success is
 *          true, the Block passes and the run passes
 *   KE-07  a quoted argument holding a space stays ONE argument through the
 *          Block's shell-style split
 *   KE-08  a pod that does not exist under Record and continue reports success
 *          false, reason NotFound, the cluster's own sentence in error, empty
 *          streams, one WARN line, an amber Block and a run that still passes
 *   KE-09  the same missing pod under Fail the block fails the Block with the
 *          same sentence, stops the run, records nothing and paints nothing
 *          amber
 *   KE-10  a pod outside the cluster's exec fixture is refused by the cluster
 *          itself, recorded with the cluster's own reason and empty streams
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  ABSENT_POD,
  buildExecFixture,
  blockFailedLine,
  blockFailedPrefix,
  commandLegs,
  CONTAINER_APP,
  CONTAINER_SIDECAR,
  EXEC_POD,
  execRefused,
  expectEmptyStreams,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectNoAmber,
  expectNoRecordedWarning,
  expectRecordedCore,
  expectRecordedWarning,
  expectStreams,
  goldenLegs,
  GOLDEN_STDOUT,
  hardFailLegs,
  markerLine,
  NO_EXEC_POD,
  NO_EXEC_REASON,
  NONZERO_EXIT,
  NONZERO_STDERR,
  NONZERO_STDOUT,
  nodeId,
  podNotFound,
  QUOTED_STDOUT,
  ranCommandLine,
  refusedLegs,
  STREAMS_STDERR,
  STREAMS_STDOUT,
  where,
  whereAmIOutput,
  type ExecMaterial,
  type SessionVariables,
} from './cases-exec'

/** The bookend each run harvests its console against. */
const GOLDEN_MARKER = 'k8s-exec-golden-done'
const COMMAND_MARKER = 'k8s-exec-command-done'
const REFUSED_MARKER = 'k8s-exec-refused-done'
const HARDFAIL_MARKER = 'k8s-exec-hardfail-done'

let run: SeededRun

function material(
  overrides: Partial<ExecMaterial> & Pick<ExecMaterial, 'name' | 'bookend'>,
): ExecMaterial {
  return {
    adminToken: K8S_ADMIN_TOKEN,
    caCert: K8S_CA_PEM,
    namespace: run.namespace,
    ...overrides,
  }
}

/** Import the built fixture, run it, and read back everything a proof needs. */
async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  runTimeout = 180_000,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, runTimeout)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

/** Load the checked-in golden and write the run's material into it. */
function loadGolden(seeded: SeededRun): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-exec-golden.json'), 'utf-8'),
  ) as Record<string, any>
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const nodes = fixture.workflow.nodes as Array<Record<string, any>>
  const connect = nodes.find((node) => node.id === 'connect-admin')
  expect(connect, 'the golden fixture must hold connect-admin').toBeTruthy()
  connect!.data.config.values.namespace = seeded.namespace
  return fixture as Record<string, unknown>
}

test.describe('K8s Exec Block (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'exec')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('golden fixture: the generated shape matches the checked-in one, and the command runs (KE-01, KE-02)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = goldenLegs()
    const golden = loadGolden(run)

    await test.step('KE-01: the node factories emit the checked-in shape', () => {
      const built = buildExecFixture(
        legs,
        material({ name: 'K8s Exec Golden', bookend: GOLDEN_MARKER }),
      )
      expect(built).toEqual(golden)
    })

    const { logs, vars } = await runFixture(page, golden, GOLDEN_MARKER)

    await test.step('KE-02: every output the Block declares comes back bound', async () => {
      expectMarkers(logs, legs)
      expectStreams(vars, 'golden', { stdout: GOLDEN_STDOUT, stderr: '', exitCode: 0 })
      expectLine(logs, ranCommandLine(EXEC_POD, 0))
      await expectLegStatuses(page, legs)
      await expectNoAmber(page)
    })
  })

  test('one command line, read back through every output the Block declares (KE-03 to KE-07)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = commandLegs()
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Exec Command E2E Test', bookend: COMMAND_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, COMMAND_MARKER, 240_000)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      await expectNoAmber(page)
    })

    await test.step('KE-03: both streams come back, with exit 0 and success', () => {
      expectStreams(vars, 'streams', {
        stdout: STREAMS_STDOUT,
        stderr: STREAMS_STDERR,
        exitCode: 0,
      })
      expectLine(logs, ranCommandLine(EXEC_POD, 0))
    })

    await test.step('KE-04, KE-05: the same command lands in the container Container names', () => {
      expectStreams(vars, 'inapp', {
        stdout: whereAmIOutput(CONTAINER_APP),
        stderr: '',
        exitCode: 0,
      })
      expectStreams(vars, 'insidecar', {
        stdout: whereAmIOutput(CONTAINER_SIDECAR),
        stderr: '',
        exitCode: 0,
      })
      expect(
        whereAmIOutput(CONTAINER_APP),
        `the two containers must not resolve to the same place.\n${all}`,
      ).not.toBe(whereAmIOutput(CONTAINER_SIDECAR))
    })

    await test.step('KE-06: a non-zero exit is data, not a failure', async () => {
      expectStreams(vars, 'nonzero', {
        stdout: NONZERO_STDOUT,
        stderr: NONZERO_STDERR,
        exitCode: NONZERO_EXIT,
      })
      expectLine(logs, ranCommandLine(EXEC_POD, NONZERO_EXIT))
      expectNoRecordedWarning(await getLogEntries(page), 'Exec', all)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('KE-07: a quoted argument holding a space stays one argument', () => {
      expectStreams(vars, 'quoted', { stdout: QUOTED_STDOUT, stderr: '', exitCode: 0 })
    })
  })

  test('the two refusals the cluster makes, both under Record and continue (KE-08, KE-10)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = refusedLegs()
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Exec Refused E2E Test', bookend: REFUSED_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, REFUSED_MARKER)

    await test.step('every leg reported its ids and painted amber', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KE-08: a pod that is not there records NotFound and leaves the streams empty', async () => {
      const message = expectRecordedCore(vars, 'absent', 'NotFound')
      expect(message, `the cluster's own not-found sentence.\n${all}`).toBe(
        execRefused(
          where(ABSENT_POD, CONTAINER_APP, run.namespace),
          podNotFound(ABSENT_POD),
        ),
      )
      expectEmptyStreams(vars, 'absent')
      expectRecordedWarning(await getLogEntries(page), 'Exec', 'NotFound', message, all)
    })

    await test.step('KE-10: a pod the exec fixture does not cover is refused by the cluster', () => {
      // The refusal MESSAGE differs between the v4 and v5 transports, so only
      // the reason and the wrapper WAVE puts around it are asserted.
      const message = expectRecordedCore(vars, 'noexec', NO_EXEC_REASON)
      expect(
        message.startsWith(
          execRefused(where(NO_EXEC_POD, CONTAINER_APP, run.namespace), ''),
        ),
        `the refusal must name the pod and container it targeted.\n${all}`,
      ).toBeTruthy()
      expectEmptyStreams(vars, 'noexec')
    })

    await test.step('KE-08, KE-10: the run still passes', async () => {
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })

  test('the same missing pod under Fail the block stops the run (KE-09)', async ({ page }) => {
    test.setTimeout(180_000)
    const legs = hardFailLegs()
    const leg = legs[0]
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Exec Hard Fail E2E Test', bookend: HARDFAIL_MARKER }),
    )
    const message = execRefused(
      where(ABSENT_POD, CONTAINER_APP, run.namespace),
      podNotFound(ABSENT_POD),
    )

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(
      page,
      status,
      blockFailedPrefix(leg),
      120_000,
    )
    const all = logs.join('\n')

    await test.step('KE-09: the Block fails with the same sentence and the run fails', () => {
      expect(verdict, `the run must not pass.\n${all}`).toBe('failed')
      expect(
        logs.find((text) => text.startsWith(blockFailedPrefix(leg))) ?? '',
        `the Block failure must carry the cluster sentence verbatim.\n${all}`,
      ).toBe(blockFailedLine(leg, message))
    })

    await test.step('KE-09: nothing after the Block ran', () => {
      expect(
        logs.some((text) => text.includes(markerLine(leg))),
        `the leg marker must not run after the Block failed.\n${all}`,
      ).toBeFalsy()
      expect(
        logs.some((text) => text.includes(HARDFAIL_MARKER)),
        `the bookend must not run after the Block failed.\n${all}`,
      ).toBeFalsy()
    })

    await test.step('KE-09: Fail the block records nothing - no WARN line, no amber Block', async () => {
      expectNoRecordedWarning(await getLogEntries(page), 'Exec', all)
      await expectNoAmber(page)
      expect(
        await page
          .locator(`[data-testid="workflow-node-${nodeId(leg)}"]`)
          .getAttribute('data-execution-status'),
        `the failed Block must not read as a success.\n${all}`,
      ).not.toBe('success')
    })
  })
})
