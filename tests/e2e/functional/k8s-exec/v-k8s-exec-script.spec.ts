/**
 * V-K8S-EXEC-SCRIPT: the K8s Script Block against the real kwok cluster.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test, runs
 * only against the run's own exec-fixture pods, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SEXEC-2, K8SEXEC-3, K8SEXEC-9
 *
 * One run. The four legs share it because none of them needs anything another
 * one wrote: three interpreters read a body and exit, and the fourth targets a
 * pod that is not there so its refusal is recorded rather than raised.
 *
 * The legs run in the SECOND exec-fixture pod, so the suite proves the
 * cluster's exec fixture grants both of the names it lists rather than only
 * the first.
 *
 * Every leg is read back through all four outputs the Block declares - stdout,
 * stderr, exit_code and success - and the recorded leg adds error and reason.
 *
 * A note on why KE-11 can pass at all: stock kwok copies standard input to the
 * command but never closes the pipe, so an interpreter reading a script body
 * waits forever. The checked-in exec-fidelity patch closes the pipe when the
 * client's stream ends, which is what lets the interpreter reach EOF and exit.
 * The same patch is what turns a non-zero exit into the canonical
 * NonZeroExitCode frame KE-13 reads its code off.
 *
 * Pass Criteria:
 *   KE-11  a multi-line /bin/sh script reaches EOF and exits: both streams,
 *          the exit code and success all come back bound
 *   KE-12  python3 as a second interpreter runs a body the shell could not,
 *          and its two streams come back separately
 *   KE-13  a script exiting non-zero is data: exit_code carries the code,
 *          success is true, the Block passes and the run passes
 *   KE-14  a Script failure under Record and continue reports success false,
 *          reason NotFound, the cluster's own sentence in error, empty
 *          streams, exactly one WARN line and an amber Block
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  ABSENT_POD,
  buildExecFixture,
  CONTAINER_APP,
  EXEC_POD_B,
  EXIT_SCRIPT_EXIT,
  EXIT_SCRIPT_STDERR,
  EXIT_SCRIPT_STDOUT,
  expectEmptyStreams,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecordedCore,
  expectRecordedWarning,
  expectStreams,
  podNotFound,
  PYTHON_SCRIPT_STDERR,
  PYTHON_SCRIPT_STDOUT,
  ranScriptLine,
  scriptLegs,
  scriptRefused,
  SHELL_SCRIPT_STDERR,
  SHELL_SCRIPT_STDOUT,
  where,
  type ExecMaterial,
  type SessionVariables,
} from './cases-exec'

/** The bookend the run harvests its console against. */
const SCRIPT_MARKER = 'k8s-exec-script-done'

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
  runTimeout = 240_000,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, runTimeout)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

test.describe('K8s Script Block (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'exec')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('two interpreters, a non-zero exit and a recorded refusal (KE-11 to KE-14)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = scriptLegs()
    const fixture = buildExecFixture(
      legs,
      material({ name: 'K8s Script E2E Test', bookend: SCRIPT_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, SCRIPT_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KE-11: the /bin/sh body reaches EOF and exits, and both streams come back', () => {
      expectStreams(vars, 'shell', {
        stdout: SHELL_SCRIPT_STDOUT,
        stderr: SHELL_SCRIPT_STDERR,
        exitCode: 0,
      })
      expectLine(logs, ranScriptLine(EXEC_POD_B, 0))
    })

    await test.step('KE-12: python3 runs a body the shell could not', () => {
      expectStreams(vars, 'python', {
        stdout: PYTHON_SCRIPT_STDOUT,
        stderr: PYTHON_SCRIPT_STDERR,
        exitCode: 0,
      })
    })

    await test.step('KE-13: a script that exits non-zero is data, and its Block passes', async () => {
      expectStreams(vars, 'scriptexit', {
        stdout: EXIT_SCRIPT_STDOUT,
        stderr: EXIT_SCRIPT_STDERR,
        exitCode: EXIT_SCRIPT_EXIT,
      })
      expectLine(logs, ranScriptLine(EXEC_POD_B, EXIT_SCRIPT_EXIT))
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('KE-14: a missing pod under Record and continue fills error and reason', async () => {
      const message = expectRecordedCore(vars, 'scriptbad', 'NotFound')
      expect(message, `the cluster's own not-found sentence.\n${all}`).toBe(
        scriptRefused(
          where(ABSENT_POD, CONTAINER_APP, run.namespace),
          podNotFound(ABSENT_POD),
        ),
      )
      expectEmptyStreams(vars, 'scriptbad')
      expectRecordedWarning(await getLogEntries(page), 'Script', 'NotFound', message, all)
    })
  })
})
