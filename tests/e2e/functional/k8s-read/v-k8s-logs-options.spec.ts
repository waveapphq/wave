/**
 * V-K8S-LOGS-OPTIONS: the K8s Logs option sweep against the real kwok cluster.
 *
 * Run R3. Four tests (the id families are defined in the suite README):
 *
 *   option sweep -> one chain of 26 K8s Logs legs, each followed by a Log Block
 *     stamping its option id, ending on a bookend marker. Every leg binds its
 *     `logs` output to its own variable and the whole set is read in one
 *     variables call at the end, so each option is checked against the exact
 *     text the cluster serves for it. Covers L-01, L-05 to L-09, L-11 to L-13,
 *     L-15 to L-17, L-19 to L-25, L-27, L-28, L-30, the shared S-09, and the three
 *     shape legs LOGS-SHAPE-STRING, LOGS-SHAPE-ARRAY and LOGS-SHAPE-TABLE.
 *   not a kubeconfig -> S-04. A session that is text rather than a kubeconfig
 *     stops the run with its own sentence, which differs from the empty-session
 *     sentence R1 and R2 assert.
 *   unknown setting -> L-29. An `all_namespaces` value written into the JSON is
 *     refused at save: the Logs Block has no such setting.
 *   binding gate -> LOGS-SHAPE-TABLE, negative. Nothing executes: a per-line
 *     read with Timestamps on declares a table, and binding it to an array
 *     variable is refused before the run starts.
 *
 * The three shape legs declare their bound variable with the type Output Format
 * and Timestamps produce together, so the sweep only starts because each
 * declared type matches what comes back.
 *
 * Two cluster behaviors the option rows are read against, both measured
 * live:
 *   L-07 - the apiserver does NOT list the pod's real containers when the named
 *     one is wrong. It answers `container nope is not valid for pod <pod>`.
 *   L-16 - `since_seconds` against the fixed-timestamp files returns HTTP 200
 *     with an empty body, so the Block SUCCEEDS with empty text. It is not a
 *     failure, and it is the discriminator for L-15 and L-17.
 *
 * L-32 is NOT here: kwok cannot produce the waiting-to-start wording in any pod
 * state, so the stub suite owns it. L-31 is R5's.
 *
 * L-03 and L-04 are NOT here either. Container is required on every Logs Block
 * and WAVE never chooses one (K8SREAD-20), so leaving it empty is a pre-run
 * gate refusal rather than a read, and `v-k8s-config-refused.spec.ts` owns it.
 * Every leg here names its container.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-20, K8SCON-1
 * REQ: REQ-5.1.1
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  importExpectingErrors,
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { codesOf } from '../../helpers/fn-seed'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { chainEdges, k8sReadNode, markerNode } from '../../helpers/k8s-nodes'
import {
  startRun,
  finishRun,
  finishRunAnyVerdict,
  expectNodesSuccess,
  expectNodeStatus,
} from '../../helpers/k8s-run'
import {
  BACKEND_URL,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_CA_PEM,
} from '../../helpers/config'
import {
  APP_LOG,
  APP_LOG_STAMPED,
  APP_LOG_TAIL_2,
  APP_PREVIOUS_LOG,
  BINDING_VAR,
  CONTAINER_RECENT,
  CONTAINER_UNICODE,
  LOGS_CASES,
  MARKER_PREFIX,
  POD_B,
  POD_MULTI,
  POD_RECENT,
  POD_SOLO,
  POD_UNICODE,
  POD_LOG,
  RECENT_LOG,
  RECENT_LOG_FRESH,
  SIDECAR_LOG,
  SWEEP_DONE_MARKER,
  UNICODE_CUT_32,
  UNICODE_CUT_33,
  buildLogsBindingFixture,
  buildLogsSweepFixture,
  logsVar,
  resolveNamespace,
} from './cases-logs'
import fs from 'fs'
import path from 'path'

/** The serialized shape of a bound table variable. */
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

/** The `app` log split the way a per-line read splits it: the trailing newline
 *  closes the last line, it does not open an empty one. */
const APP_LOG_LINES = APP_LOG.split('\n').slice(0, -1)
const APP_LOG_STAMPED_LINES = APP_LOG_STAMPED.split('\n').slice(0, -1)

/** The not-a-kubeconfig sentence, verbatim (`verbs/_context._SESSION_MESSAGE`). */
const NOT_A_KUBECONFIG =
  "Parameter 'session' is not a kubeconfig WAVE can read: use the 'session' output of a K8s Connect block"

/** The distinguishing half of the EMPTY-session sentence, which S-04 must not be. */
const EMPTY_SESSION_FRAGMENT = 'is set but what it points at is empty'

const K8S_API_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`

/**
 * The log-fixture pods `seedRun(request, 'logs')` does not create yet.
 * kwok keys its log files by CONTAINER NAME, so L-15, L-17 and L-25 need a pod
 * carrying a container called `recent` and one called `unicode`. The run
 * namespace delete removes them; an already-seeded pod (409) is accepted so
 * this becomes a no-op the moment the seeding helper adopts them.
 */
async function seedLogFixturePods(request: APIRequestContext, namespace: string): Promise<void> {
  const wanted: Array<[string, string[]]> = [
    [POD_RECENT, [CONTAINER_RECENT]],
    [POD_UNICODE, [CONTAINER_UNICODE]],
  ]
  for (const [pod, containers] of wanted) {
    const resp = await request.post(`${K8S_API_URL}/api/v1/namespaces/${namespace}/pods`, {
      headers: {
        Authorization: `Bearer ${K8S_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: pod,
          namespace,
          labels: { 'wave-e2e': 'read' },
        },
        spec: {
          nodeName: 'kwok-node-0',
          containers: containers.map((name) => ({ name, image: 'busybox:1.36' })),
        },
      },
    })
    const accepted = resp.ok() || resp.status() === 409
    const detail = accepted ? '' : await resp.text()
    expect(accepted, `seeding pod ${pod} failed: ${resp.status()} ${detail}`).toBeTruthy()
  }
}

/** Load the golden fixture and inject the checked-in TEST-ONLY kwok material. */
function loadGolden(): Record<string, unknown> {
  const golden = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-logs-golden.json'), 'utf-8'),
  ) as { variables: Record<string, { value: string }> }
  golden.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  golden.variables.k8s_ca.value = K8S_CA_PEM
  return golden as unknown as Record<string, unknown>
}

test.describe('K8s Logs option sweep (real kwok cluster)', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    run = await seedRun(request, 'logs')
    await seedLogFixturePods(request, run.namespace)
  })

  test.afterAll(async () => {
    await run.teardown()
  })

  test('L-01, L-05 to L-09, L-11 to L-13, L-15 to L-17, L-19 to L-25, L-27, L-28, L-30, S-09 and LOGS-SHAPE-STRING, -ARRAY, -TABLE: every Logs option changes what comes back', async ({
    page,
  }) => {
    const fixture = buildLogsSweepFixture(loadGolden(), run)
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const logs = await finishRun(page, status, SWEEP_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const variables = await getSessionVariables(page, sessionId)
    const boundLogs = (id: string): { value: unknown; type: string } => {
      const bound = variables[logsVar(id)]
      expect(bound, `leg ${id} did not bind its logs output`).toBeDefined()
      return bound
    }
    const readLogs = (id: string): string => String(boundLogs(id).value)

    await test.step('every leg stamped its own option id', () => {
      expect(
        logs.some((t) => t.includes(`${MARKER_PREFIX}L-01`)),
        `the golden leg's marker is missing.\n${all}`,
      ).toBeTruthy()
      for (const testCase of LOGS_CASES) {
        expect(
          logs.some((t) => t.includes(`${MARKER_PREFIX}${testCase.option} `)),
          `leg "${testCase.option} ${testCase.title}" did not stamp its marker.\n${all}`,
        ).toBeTruthy()
      }
    })

    await test.step('L-01: the pod and the container named on it are what is read', () => {
      expect(
        readLogs('l01'),
        'a container kwok holds no log file for must serve the fall-through log file',
      ).toBe(POD_LOG)
    })

    await test.step('each leg returns exactly the text its option selects', () => {
      for (const testCase of LOGS_CASES) {
        if (testCase.logs === undefined) continue
        expect(
          readLogs(testCase.id),
          `${testCase.option} (${testCase.title}) returned the wrong log text`,
        ).toBe(resolveNamespace(testCase.logs, run))
      }
    })

    await test.step('the recorded failures carry the cluster\'s own refusal', () => {
      for (const testCase of LOGS_CASES) {
        if (!testCase.record) continue
        expect(
          variables[`${testCase.id}_ok`]?.value,
          `${testCase.option} must record a failure, not succeed`,
        ).toBe(false)
        expect(
          String(variables[`${testCase.id}_err`]?.value ?? ''),
          `${testCase.option} carried the wrong error text`,
        ).toBe(resolveNamespace(testCase.error as string, run))
        expect(
          String(variables[`${testCase.id}_reason`]?.value ?? ''),
          `${testCase.option} carried the wrong reason`,
        ).toBe(testCase.reason)
        expect(
          logs.some((t) =>
            t.includes(
              `Read failed (${testCase.reason}): ${resolveNamespace(testCase.error as string, run)}`,
            ),
          ),
          `${testCase.option} did not write its WARN line.\n${all}`,
        ).toBeTruthy()
      }
    })

    await test.step("L-07: the wrong-container refusal is the cluster's own, and lists nothing", () => {
      expect(
        String(variables.l07_err?.value ?? ''),
        'the wrong-container 400 does not list the real containers',
      ).not.toContain('choose one of')
    })

    await test.step('L-05 and L-06: the container chooses the file', () => {
      expect(readLogs('l05')).toBe(APP_LOG)
      expect(readLogs('l06')).toBe(SIDECAR_LOG)
      expect(readLogs('l05'), 'app and sidecar must not serve the same text').not.toBe(
        readLogs('l06'),
      )
    })

    await test.step('L-08 and L-09: previous reads a different instance', () => {
      expect(readLogs('l08')).toBe(APP_LOG)
      expect(readLogs('l09')).toBe(APP_PREVIOUS_LOG)
      expect(readLogs('l09'), 'the previous instance must differ from the current one').not.toBe(
        readLogs('l08'),
      )
    })

    await test.step('L-12 and L-13: tail_lines is a cap, not a fixed size', () => {
      expect(readLogs('l12')).toBe(APP_LOG_TAIL_2)
      expect(readLogs('l12').split('\n').length - 1, 'tail_lines 2 must return 2 lines').toBe(2)
      expect(
        readLogs('l13'),
        'tail_lines above the line count must not cut anything',
      ).toBe(readLogs('l11'))
    })

    await test.step('L-15, L-16 and L-17: since_seconds filters on each line\'s own timestamp', () => {
      expect(readLogs('l15')).toBe(RECENT_LOG)
      expect(readLogs('l17')).toBe(RECENT_LOG_FRESH)
      const unfiltered = readLogs('l15').split('\n').length - 1
      const filtered = readLogs('l17').split('\n').length - 1
      expect(filtered, 'the window must drop lines').toBeLessThan(unfiltered)
      expect(filtered, 'the window must not empty the file').toBeGreaterThan(0)
      expect(
        readLogs('l16'),
        'a 60 second window over the 2026-01-01 files empties them, and still succeeds',
      ).toBe('')
    })

    await test.step('L-19 and L-20: timestamps prefixes every line', () => {
      expect(readLogs('l19')).toBe(APP_LOG)
      expect(readLogs('l20')).toBe(APP_LOG_STAMPED)
      for (const line of readLogs('l20').split('\n').filter((l) => l.length > 0)) {
        expect(line, 'every line must carry an RFC3339 prefix').toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /,
        )
      }
      expect(
        readLogs('l19').split('\n')[0],
        'with timestamps off no line may carry a stamp',
      ).not.toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    await test.step('LOGS-SHAPE-STRING: the text comes back as the container wrote it', () => {
      const asText = boundLogs('lshapestr')
      expect(asText.type).toBe('string')
      expect(asText.value).toBe(APP_LOG)
      expect(readLogs('lshapestr'), 'String is what an unset Output Format gives').toBe(
        readLogs('l05'),
      )
    })

    await test.step('LOGS-SHAPE-ARRAY: one entry per line, and the count matches', () => {
      const asArray = boundLogs('lshapearr')
      expect(asArray.type).toBe('array')
      const entries = asArray.value as unknown[]
      expect(entries).toEqual(APP_LOG_LINES)
      expect(entries.length, 'one entry per line of the log').toBe(APP_LOG_LINES.length)
      expect(
        logs.some((t) => t.includes(`${MARKER_PREFIX}LOGS-SHAPE-ARRAY entries=${entries.length}`)),
        `the Array leg did not stamp its entry count.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('LOGS-SHAPE-TABLE: Timestamps on splits every line at its first space', () => {
      const asTable = boundLogs('lshapetab')
      expect(asTable.type, 'the same Array value with Timestamps on declares a table').toBe(
        'table',
      )
      const table = asTable.value as WaveTable
      expect(table.columns.map((column) => column.name)).toEqual(['TIME', 'MESSAGE'])
      expect(table.columns.map((column) => column.type)).toEqual(['string', 'string'])
      expect(table.rows.length, 'one row per line of the log').toBe(APP_LOG_LINES.length)
      table.rows.forEach((cells, index) => {
        const time = String(cells[0])
        const message = String(cells[1])
        expect(time, 'TIME carries the stamp alone').toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
        )
        expect(message, 'MESSAGE carries the line the container wrote').toBe(APP_LOG_LINES[index])
        expect(`${time} ${message}`, 'the two columns rebuild the stamped line').toBe(
          APP_LOG_STAMPED_LINES[index],
        )
      })
      // The split is the FIRST space, so a message full of spaces stays whole.
      expect(String(table.rows[0][1]).split(' ').length).toBeGreaterThan(1)
    })

    await test.step('L-21 to L-24: max_bytes is a cap and a mid-line cut still succeeds', () => {
      expect(readLogs('l21')).toBe(APP_LOG)
      expect(readLogs('l22').length, 'max_bytes 40 must return exactly 40 characters').toBe(40)
      expect(
        readLogs('l22').endsWith('\n'),
        'L-24: the cut lands mid-line, so the text has no closing newline',
      ).toBeFalsy()
      expect(
        APP_LOG.startsWith(readLogs('l22')),
        'L-24: the cut text is a prefix of the whole body',
      ).toBeTruthy()
      expect(readLogs('l23'), 'max_bytes above the body must not cut').toBe(readLogs('l21'))
    })

    await test.step('L-25: a cut inside a multi-byte character replaces it and still succeeds', () => {
      expect(readLogs('l25c'), 'byte 32 is a clean cut').toBe(UNICODE_CUT_32)
      expect(readLogs('l25')).toBe(UNICODE_CUT_33)
      expect(
        readLogs('l25').endsWith('\uFFFD'),
        'cutting one byte into the euro sign must leave the replacement character',
      ).toBeTruthy()
      expect(readLogs('l25c')).not.toContain('\uFFFD')
    })

    await test.step('L-27, L-28 and S-09: the namespace override is what moved the read', () => {
      expect(readLogs('l28'), 'the pod in namespace B must be readable with the override').toBe(
        APP_LOG,
      )
      expect(
        String(variables.l28n_err?.value ?? ''),
        'without the override the identical read must 404 naming namespace A',
      ).toBe(`K8s Pod '${POD_B}' not found in namespace '${run.namespace}'`)
      expect(
        logs.some((t) =>
          t.includes(
            `Read ${APP_LOG.length} characters of log from pod '${POD_MULTI}' in '${run.namespace}'`,
          ),
        ),
        `the default-namespace read did not name namespace A.\n${all}`,
      ).toBeTruthy()
      expect(
        logs.some((t) =>
          t.includes(
            `Read ${APP_LOG.length} characters of log from pod '${POD_B}' in '${run.namespaceB}'`,
          ),
        ),
        `the overridden read did not name namespace B.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('L-30: a pod that does not exist', () => {
      expect(String(variables.l30_err?.value ?? '')).toBe(
        `K8s Pod 'nope' not found in namespace '${run.namespace}'`,
      )
    })

    await test.step('the successful legs are green and the recorded ones are amber', async () => {
      const green = ['connect-logs', 'l01', 'mark-l01', 'mark-done']
      for (const testCase of LOGS_CASES) {
        if (!testCase.record) green.push(testCase.id)
        green.push(`mark-${testCase.id}`)
      }
      await expectNodesSuccess(page, green)
      for (const testCase of LOGS_CASES) {
        if (!testCase.record) continue
        await expectNodeStatus(page, testCase.id, 'warning')
      }
      await expect(
        page.locator('[data-testid="workflow-node-l07"] [data-testid="node-run-state-badge"]'),
        'a recorded failure carries the WARN badge beside the amber border',
      ).toHaveText('WARN')
    })
  })

  test('S-04: a session that is not a kubeconfig stops the run with its own sentence', async ({
    page,
  }) => {
    const nodes = [
      markerNode({ id: 'mark-s04', description: 'S-04 marker', text: `${MARKER_PREFIX}S-04 start` }),
      k8sReadNode({
        id: 's04',
        elementType: 'k8s-logs',
        label: 'S-04 not a kubeconfig',
        description: 'S-04 not a kubeconfig',
        expressionFields: ['session'],
        values: { session: 'bad_session', pod: POD_SOLO, container: 'main' },
      }),
    ]
    const fixture = {
      name: 'K8s Logs Not A Kubeconfig E2E Test',
      version: '1.0.0',
      description: '',
      workflow: { nodes, edges: chainEdges(['mark-s04', 's04']) },
      variables: {
        bad_session: { value: 'not-a-kubeconfig', type: 'string', scope: 'test' },
      },
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    await importValidateAndNavigate(page, fixture)
    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(page, status, NOT_A_KUBECONFIG, 90_000)
    const all = logs.join('\n')

    expect(verdict, `the run must stop on the unreadable session.\n${all}`).toBe('failed')
    expect(
      logs.find((t) => t.startsWith("Block 'S-04 not a kubeconfig' failed:")) ?? '',
      'the Block failure must carry the not-a-kubeconfig sentence verbatim',
    ).toBe(`Block 'S-04 not a kubeconfig' failed: ${NOT_A_KUBECONFIG}`)
    expect(
      all,
      'S-04 must not render the empty-session sentence R1 and R2 assert',
    ).not.toContain(EMPTY_SESSION_FRAGMENT)
    await expectNodesSuccess(page, ['mark-s04'])
    expect(
      await page
        .locator('[data-testid="workflow-node-s04"]')
        .getAttribute('data-execution-status'),
      'the Block with the unreadable session must not succeed',
    ).not.toBe('success')
  })

  test('L-29: an all_namespaces value written into the JSON is refused at save', async ({ request }) => {
    const resp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: `zz-11541-r3-logs-l29-${Date.now()}`,
        version: '1.0.0',
        workflow: {
          nodes: [
            k8sReadNode({
              id: 'l29',
              elementType: 'k8s-logs',
              description: 'L-29 all_namespaces written into the JSON',
              expressionFields: ['session'],
              values: { session: "'kubeconfig-placeholder'", pod: POD_MULTI, container: 'app', all_namespaces: true },
            }),
          ],
          edges: chainEdges(['l29']),
        },
        variables: {},
      },
    })
    expect(resp.status(), 'a setting the Block does not declare is refused at save').toBe(422)
    const details = ((await resp.json()).error.details ?? []) as Array<Record<string, string>>
    expect(details.map((d) => [d.code, d.node_id, d.message])).toEqual([
      ['UNKNOWN_SETTING', 'l29', "Block 'k8s-logs' has no setting 'all_namespaces'"],
    ])
    expect(details[0].fix_action).toMatch(/^Valid settings: /)
    expect(details[0].fix_action).not.toContain('all_namespaces')
  })

  test('LOGS-SHAPE-TABLE: a per-line read with Timestamps on cannot bind to an array variable', async ({
    page,
  }) => {
    const fixture = buildLogsBindingFixture(loadGolden(), run, 'array')

    // The pre-run gate is where a binding type is checked; POST /tests is not.
    const result = await importExpectingErrors(page, fixture, {
      context: 'run',
      navigate: false,
      injectHttp: true,
    })
    expect(result.status, 'a mismatched logs binding must be refused').toBe(422)
    expect(codesOf(result.errors)).toContain('INVALID_OUTPUT_BINDING_TYPE')
    expect(result.errors.map((entry) => String(entry.message))).toContain(
      `Output 'logs' (type table) cannot bind to variable '${BINDING_VAR}' (type array)`,
    )
    expect(result.errors.map((entry) => String(entry.node_label))).toContain('K8s Logs')
  })
})
