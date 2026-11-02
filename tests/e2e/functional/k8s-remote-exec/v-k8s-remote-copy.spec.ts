/**
 * V-K8S-REMOTE-COPY: K8s Copy both ways inside a Remote Execution container,
 * and a WAVE-side scheme on a Copy inside a Remote body saving clean.
 *
 * One SSH session carries the whole round trip. An SSH Session Exec writes a
 * file in the sshd account's home, the container's body copies it into the
 * pod, reads it back with a `cat` and copies it out again to a second host
 * path, and two more SSH Session Execs read the returned bytes and remove the
 * files the run wrote. On the remote locus the Copy plugin's path resolution
 * never runs, so both Summary cells hold the paths the Block was given, byte
 * for byte, where the local leg can only tail-match a resolved artifact path.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-3.4.1.5
 *
 * Pass Criteria:
 *   KR-11 the four cluster Blocks run on the SSH host and the three SSH
 *         Blocks run on WAVE, each Copy's Summary carries exactly one row
 *         whose SOURCE, TARGET and SIZE are the paths and the byte count the
 *         Block was given, the pod reads back exactly the bytes the host
 *         sent, the same bytes come back off the host after the round trip,
 *         both host files are removed and every Block goes green
 *   KR-12 a Test whose Copy names `artifact://run/x.txt` inside a Remote
 *         Execution body saves and passes the run gate with no finding: the
 *         remote host, not the save, refuses the scheme when the run reaches it
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { BACKEND_URL, K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  CONTAINER_APP,
  copiedLine,
  copyRows,
  copySummary,
  EXEC_POD,
  expectLine,
  expectStreams,
  expectSuccess,
  podFile,
  PUSH_FILE,
  ranCommandLine,
} from '../k8s-exec/cases-exec'
import {
  buildCopyFixture,
  buildCopySchemeFixture,
  COPY_DONE_MARKER,
  COPY_MARKER,
  COPY_VARS,
  copyContent,
  expectLocusBadges,
  expectStatuses,
  K8S_VERSION,
  numberOf,
  sshHostFile,
  textOf,
  type SessionVariables,
} from './cases-remote'

/** The scheme leg never runs, so it only needs a namespace name to carry. */
const SCHEME_NAMESPACE = 'default'

test('KR-12: an artifact path on a Copy inside a Remote body saves and passes the run gate', async ({
  page,
}) => {
  test.setTimeout(60_000)

  const fixture = buildCopySchemeFixture({
    suffix: randomUUID().slice(0, 8),
    namespace: SCHEME_NAMESPACE,
    pod: EXEC_POD,
    container: CONTAINER_APP,
    caCert: K8S_CA_PEM,
    adminToken: K8S_ADMIN_TOKEN,
  })

  const testId = await importFixtureTest(page, fixture)
  try {
    const result = await validateTest(page.request, testId, 'run')

    expect(result.status, 'the run gate lets the saved Copy through').toBe(200)
    expect(result.errors, `no finding: ${JSON.stringify(result.errors)}`).toEqual([])
  } finally {
    await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
  }
})

test.describe('K8s Copy both ways inside a Remote Execution container', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'exec')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-11: a file goes from the SSH host into the pod and back again', async ({ page }) => {
    test.setTimeout(240_000)

    const v = COPY_VARS
    const content = copyContent(run.suffix)
    const size = Buffer.byteLength(content)
    const hostPush = sshHostFile(run.suffix, 'push.txt')
    const hostPull = sshHostFile(run.suffix, 'pull.txt')
    const podPath = podFile({ namespace: run.namespace, suffix: run.suffix }, PUSH_FILE)

    const fixture = buildCopyFixture({
      suffix: run.suffix,
      namespace: run.namespace,
      pod: EXEC_POD,
      container: CONTAINER_APP,
      podPath,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    await test.step('the four cluster Blocks carry the R badge and the SSH Blocks carry none', async () => {
      await expectLocusBadges(page, fixture)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, COPY_DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables

    await test.step('the host file was written and the cluster answered from the host', () => {
      expect(numberOf(vars, v.writeExit), `the host write.\n${all}`).toBe(0)
      expect(textOf(vars, v.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
    })

    await test.step('KR-11: the push names one file, its host source, its pod target and its size', () => {
      const table = copySummary(vars, 'push')
      expect(table.rows.length, `one file is one row.\n${all}`).toBe(1)
      const rows = copyRows(vars, 'push')
      expect(rows[0].source, 'the SOURCE cell is the host path the Block was given').toBe(
        hostPush,
      )
      expect(rows[0].target, 'the TARGET cell is the pod path the Block was given').toBe(podPath)
      expect(rows[0].size, 'the SIZE cell is the file size').toBe(size)
      expectSuccess(vars, 'push')
      expectLine(logs, copiedLine(hostPush, podPath))
    })

    await test.step('KR-11: the pod holds exactly the bytes the host sent', () => {
      expectStreams(vars, 'read', { stdout: content, stderr: '', exitCode: 0 })
      expectLine(logs, ranCommandLine(EXEC_POD, 0))
    })

    await test.step('KR-11: the pull names one file, its pod source, its host target and its size', () => {
      const table = copySummary(vars, 'pull')
      expect(table.rows.length, `one file is one row.\n${all}`).toBe(1)
      const rows = copyRows(vars, 'pull')
      expect(rows[0].source, 'the SOURCE cell is the pod path the Block was given').toBe(podPath)
      expect(rows[0].target, 'the TARGET cell is the host path the Block was given').toBe(
        hostPull,
      )
      expect(rows[0].size, 'the SIZE cell is the file size').toBe(size)
      expectSuccess(vars, 'pull')
      expectLine(logs, copiedLine(podPath, hostPull))
    })

    await test.step('KR-11: the bytes came all the way back to the SSH host', () => {
      expect(textOf(vars, v.homeStdout), `the returned file.\n${all}`).toBe(content)
      expect(numberOf(vars, v.homeExit), 'the host read').toBe(0)
    })

    await test.step('the host files are gone, the summary marker reads, and every Block is green', async () => {
      expect(numberOf(vars, v.cleanExit), `the host cleanup.\n${all}`).toBe(0)
      const marker = logs.find((text) => text.startsWith(COPY_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${COPY_MARKER} read=${content} home=${content} exit=0`,
      )
      await expectStatuses(page, fixture, {})
    })
  })
})
