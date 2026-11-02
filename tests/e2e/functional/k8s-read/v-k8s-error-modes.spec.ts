/**
 * V-K8S-ERROR-MODES (R7): what the four K8s read Blocks do when the read fails
 * or the Block is configured in a way the plugin refuses at run time.
 *
 * Five runs against the real kwok cluster (tests/e2e/services/kwok/) plus a
 * hand-written kubeconfig aimed at a closed port:
 *
 *   S-19       -> a recordable failure (404 by name) under On error = Fail the
 *                 block raises, a Try/Catch catches it, and the run carries on
 *                 down the then branch. No WARN line is written, which is what
 *                 separates it from S-20 in R1.
 *   G-39, S-07, E-30, E-31, L-14, L-18, L-26
 *              -> refusals the pre-run gate cannot make, because the gate never
 *                 calls a plugin's validate(). Each raises at run time with its
 *                 own exact sentence.
 *   S-21, G-63 -> a closed-port session with On error = Record and continue.
 *                 The run STOPS: no amber Block, no WARN line. This is the leg
 *                 that proves the recorded and the hard-fail classes differ.
 *   S-18       -> Impersonate groups filled with Impersonate user empty is
 *                 refused on all four read Blocks, with the same sentence, under
 *                 both On error settings, and before any request leaves WAVE.
 *   S-18 traps -> groups with a user, a user on its own, and groups that are only
 *                 whitespace or only commas all still run and still reach the
 *                 cluster.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-8
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  chainEdges,
  edge,
  handleEdge,
  k8sConnectNode,
  k8sReadNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type K8sReadElementType,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  finishRun,
  finishRunAnyVerdict,
  getNodeStatuses,
  startRun,
} from '../../helpers/k8s-run'
import { SEEDED, seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  K8S_IMPERSONATE_GROUP,
  K8S_IMPERSONATE_NOBODY,
  K8S_IMPERSONATE_USER,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** Every console marker this file emits starts here, so a failure is
 *  attributable to the option row that broke. */
const MARK = 'r7-'

/** The kwok apiserver as the fixtures name it, before the shard rewrite. */
const CLUSTER_URL = 'https://127.0.0.1:9460'

/** A port nothing listens on. Outside the 9449-9461 shard-rewrite window, so it
 *  stays 127.0.0.1 in container-shard mode too. */
const CLOSED_PORT_URL = 'https://127.0.0.1:1'

/** _k8s_common._GROUPS_WITHOUT_USER_MESSAGE, pinned by
 *  backend/tests/plugins/k8s/_read_fixtures.py GROUPS_WITHOUT_USER_MESSAGE. */
const GROUPS_WITHOUT_USER =
  "Parameter 'impersonate_groups' cannot be used on its own: set 'impersonate_user' " +
  'to the user to run the request as, or clear the groups'

/** connectivity/k8s/rest.py, the socket-connect arm. The tail after the colon is
 *  the operating system's own text and is never asserted. */
const NO_CONNECT = `Could not connect to the Kubernetes API at ${CLOSED_PORT_URL}`

/** verbs/_outputs._recorded_failure_line. Its absence is what proves a leg did not
 *  take the Record and continue path. */
const RECORDED_WARN = 'Read failed'

const ERROR_VAR = 'leg_err'
const SESSION_VAR = 'k8s_session'
const BROKEN_SESSION_VAR = 'broken_session'

/** A kubeconfig WAVE can parse whose server is a closed port. */
const BROKEN_SESSION = JSON.stringify({
  apiVersion: 'v1',
  kind: 'Config',
  clusters: [
    { name: 'wave', cluster: { server: CLOSED_PORT_URL, 'insecure-skip-tls-verify': true } },
  ],
  users: [{ name: 'wave', user: {} }],
  contexts: [
    { name: 'wave', context: { cluster: 'wave', user: 'wave', namespace: 'default' } },
  ],
  'current-context': 'wave',
})

type TestVariable = { value: unknown; type: string; scope: string; secret?: boolean }

function buildTest(
  name: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  variables: Record<string, TestVariable>,
): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: stackNodes(nodes), edges: [...edges] },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

const stringVar = (value: string, secret = false): TestVariable => ({
  value,
  type: 'string',
  scope: 'test',
  ...(secret ? { secret: true } : {}),
})

const mapVar = (): TestVariable => ({ value: {}, type: 'map', scope: 'test' })

const arrayVar = (): TestVariable => ({ value: [], type: 'array', scope: 'test' })

/** The Connect Block every cluster-facing run starts from. Its default namespace
 *  is the run namespace, so no read has to set one. */
function connectNode(namespace: string): WorkflowNode {
  return k8sConnectNode({
    id: 'connect-admin',
    description: 'Admin session, default namespace = the run namespace',
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: CLUSTER_URL,
      namespace,
      timeout: 30,
      token: 'k8s_admin_token',
      verify_ssl: true,
      ca_cert: 'k8s_ca',
      acquire_run_token: false,
    },
    outputBindings: { session: SESSION_VAR },
    outputSecretFields: ['session'],
  })
}

/** The per-Block value sets every leg starts from. Each is complete enough to
 *  pass the pre-run gate and to succeed, so a leg that fails proves its own
 *  option did the refusing. */
const getBase = (session: string): Record<string, unknown> => ({
  session,
  resource_type: 'default',
  kind: 'Pod',
  search_by: 'name',
  name: SEEDED.podLabeled,
  output_format: 'map',
  on_error: 'fail',
  timeout: 30,
})

const eventsBase = (session: string): Record<string, unknown> => ({
  session,
  scope_to_object: false,
  event_type: 'any',
  output_format: 'map',
  on_error: 'fail',
  timeout: 30,
})

const logsBase = (session: string): Record<string, unknown> => ({
  session,
  pod: SEEDED.podLabeled,
  container: SEEDED.containerApp,
  previous: false,
  timestamps: false,
  on_error: 'fail',
  timeout: 30,
})

const topBase = (session: string): Record<string, unknown> => ({
  session,
  scope: 'pod',
  select_by: 'all',
  include_containers: false,
  on_error: 'fail',
  timeout: 30,
})

const BASE_VALUES: Record<K8sReadElementType, (session: string) => Record<string, unknown>> = {
  'k8s-get': getBase,
  'k8s-events': eventsBase,
  'k8s-logs': logsBase,
  'k8s-top': topBase,
}

/** One row of the sweep: the option ID it proves, the Block it runs on, the
 *  values that make it refuse, and the exact sentence it must raise. */
type RefusalCase = {
  id: string
  elementType: K8sReadElementType
  values: Record<string, unknown>
  message: string
  expressionFields?: string[]
}

type Leg = { nodes: WorkflowNode[]; edges: WorkflowEdge[]; entry: string; exit: string }

/** A Try/Catch-wrapped read whose caught message is logged on the then branch.
 *  The error binding is applied AFTER the catch chain runs, so the catch branch
 *  only stamps its marker and the then branch reads the message. */
function refusalLeg(c: RefusalCase): Leg {
  const tc = `tc-${c.id}`
  const blk = `blk-${c.id}`
  const caught = `log-${c.id}-caught`
  const msg = `log-${c.id}-msg`
  return {
    nodes: [
      tryCatchNode({ id: tc, description: `${c.id} guard`, errorBinding: ERROR_VAR }),
      k8sReadNode({
        id: blk,
        elementType: c.elementType,
        description: `${c.id} ${c.elementType}`,
        expressionFields: c.expressionFields ?? ['session'],
        values: c.values,
      }),
      markerNode({
        id: caught,
        description: `${c.id} catch marker`,
        text: `${MARK}${c.id} caught`,
      }),
      markerNode({
        id: msg,
        description: `${c.id} caught message`,
        expression:
          `f"${MARK}${c.id} msg=` +
          `{${ERROR_VAR}['message'] if ${ERROR_VAR} else 'NO-ERROR-CAUGHT'}"`,
      }),
    ],
    edges: [
      handleEdge(tc, 'try', blk),
      handleEdge(tc, 'catch', caught),
      handleEdge(tc, 'then', msg),
    ],
    entry: tc,
    exit: msg,
  }
}

/** Wire head Blocks, then each leg through its then branch, then the tail. */
function sequence(
  headIds: readonly string[],
  legs: readonly Leg[],
  tailIds: readonly string[],
): WorkflowEdge[] {
  const edges: WorkflowEdge[] = []
  let prev: string | null = null
  const link = (to: string): void => {
    if (prev === null) edges.push(...chainEdges([to]))
    else edges.push(edge(prev, to))
    prev = to
  }
  for (const id of headIds) link(id)
  for (const leg of legs) {
    link(leg.entry)
    edges.push(...leg.edges)
    prev = leg.exit
  }
  for (const id of tailIds) link(id)
  return edges
}

const msgPrefix = (id: string): string => `${MARK}${id} msg=`

/** Assert one refusal leg: the catch branch ran, and the caught message is the
 *  exact sentence the plugin declares. */
function expectRefused(logs: readonly string[], id: string, message: string): void {
  const all = logs.join('\n')
  expect(
    logs.some((t) => t === `${MARK}${id} caught`),
    `${id}: the catch branch never ran, so the Block did not refuse.\n${all}`,
  ).toBeTruthy()
  const line = logs.find((t) => t.startsWith(msgPrefix(id))) ?? ''
  expect(line, `${id}: wrong refusal message.\n${all}`).toBe(`${msgPrefix(id)}${message}`)
}

/** No Block anywhere on the canvas painted amber. */
async function expectNoAmberBlock(page: Page): Promise<void> {
  const statuses = await getNodeStatuses(page)
  expect(
    statuses.filter((s) => s.status === 'warning'),
    `no Block may paint amber: ${JSON.stringify(statuses)}`,
  ).toEqual([])
}

function expectNoRecordedWarning(lines: readonly string[]): void {
  expect(
    lines.filter((l) => l.includes(RECORDED_WARN)),
    'a recorded-failure WARN line was written where none may be',
  ).toEqual([])
}

/** The golden fixture, with the checked-in TEST-ONLY kwok material and the run
 *  namespace injected (never committed inside fixture JSON). */
function loadGoldenFixture(namespace: string): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-error-modes.json'), 'utf-8'),
  ) as { variables: Record<string, TestVariable> }
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  fixture.variables.run_namespace.value = namespace
  return fixture as unknown as Record<string, unknown>
}

test.describe('K8s read error modes (real kwok cluster)', () => {
  let run!: SeededRun

  test.beforeAll(async ({ request }) => {
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run.teardown()
  })

  test('S-19: a 404 under Fail the block raises, the catch branch runs, and the run continues down then', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, loadGoldenFixture(run.namespace), {
      injectHttp: true,
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, `${MARK}golden-done`, 90_000)
    const all = logs.join('\n')

    await test.step('the Block errored with the cluster wording and the catch branch ran', () => {
      expectRefused(
        logs,
        'S-19',
        `K8s Pod 'wave-e2e-missing-pod' not found in namespace '${run.namespace}'`,
      )
    })

    await test.step('Fail the block records nothing: no WARN line, no amber Block', async () => {
      expectNoRecordedWarning(await getLogLines(page))
      await expectNoAmberBlock(page)
    })

    await test.step('the run carried on down then and reached the bookend', () => {
      expect(
        logs.indexOf(`${MARK}golden-done`),
        `the then branch must run after the catch branch.\n${all}`,
      ).toBeGreaterThan(logs.indexOf(`${MARK}S-19 caught`))
    })
  })

  test('G-39 and the six positivity refusals raise at run time from the plugin, not at the pre-run gate', async ({
    page,
  }) => {
    // The gate never calls a plugin's validate(), so every refusal here raises
    // at run time rather than before the run starts.
    const cases: RefusalCase[] = [
      {
        id: 'G-39',
        elementType: 'k8s-get',
        values: { ...getBase(SESSION_VAR), name: 'blank_name' },
        expressionFields: ['session', 'name'],
        message: 'Missing required parameter: name',
      },
      // Timeout declares a minimum, so a literal 0 or -1 is refused at save; an expression reaches the plugin.
      {
        id: 'S-07-zero',
        elementType: 'k8s-get',
        values: { ...getBase(SESSION_VAR), timeout: '0' },
        expressionFields: ['session', 'timeout'],
        message: "Parameter 'timeout' must be positive",
      },
      {
        id: 'S-07-negative',
        elementType: 'k8s-top',
        values: { ...topBase(SESSION_VAR), timeout: '-1' },
        expressionFields: ['session', 'timeout'],
        message: "Parameter 'timeout' must be positive",
      },
      {
        id: 'E-30',
        elementType: 'k8s-events',
        values: { ...eventsBase(SESSION_VAR), within_seconds: 0 },
        message: "Parameter 'within_seconds' must be positive",
      },
      {
        id: 'E-31',
        elementType: 'k8s-events',
        values: { ...eventsBase(SESSION_VAR), max_events: 0 },
        message: "Parameter 'max_events' must be positive",
      },
      {
        id: 'L-14',
        elementType: 'k8s-logs',
        values: { ...logsBase(SESSION_VAR), tail_lines: 0 },
        message: "Parameter 'tail_lines' must be positive",
      },
      {
        id: 'L-18',
        elementType: 'k8s-logs',
        values: { ...logsBase(SESSION_VAR), since_seconds: 0 },
        message: "Parameter 'since_seconds' must be positive",
      },
      {
        id: 'L-26',
        elementType: 'k8s-logs',
        values: { ...logsBase(SESSION_VAR), max_bytes: 0 },
        message: "Parameter 'max_bytes' must be positive",
      },
    ]

    const legs = cases.map(refusalLeg)
    const head = connectNode(run.namespace)
    const done = markerNode({
      id: 'log-done',
      description: 'Bookend marker',
      text: `${MARK}refusals-done`,
    })
    const fixture = buildTest(
      'K8s Read Run-Time Refusals E2E Test',
      [head, ...legs.flatMap((l) => l.nodes), done],
      sequence([head.id], legs, [done.id]),
      {
        k8s_admin_token: stringVar(K8S_ADMIN_TOKEN, true),
        k8s_ca: stringVar(K8S_CA_PEM),
        k8s_session: stringVar(''),
        blank_name: stringVar(''),
        leg_err: mapVar(),
      },
    )

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const logs = await finishRun(page, status, `${MARK}refusals-done`, 120_000)

    for (const c of cases) {
      await test.step(`${c.id} raises its own sentence`, () =>
        expectRefused(logs, c.id, c.message))
    }

    await test.step('none of them took the recorded path', async () => {
      expectNoRecordedWarning(await getLogLines(page))
      await expectNoAmberBlock(page)
    })
  })

  test('S-21 and G-63: a closed-port session under Record and continue stops the run, with no amber Block and no WARN line', async ({
    page,
  }) => {
    const blockName = 'S-21 G-63 closed-port Get'
    const before = markerNode({
      id: 'log-before',
      description: 'Reached the failing Block',
      text: `${MARK}S-21 reached`,
    })
    const getNode = k8sReadNode({
      id: 'blk-S-21',
      elementType: 'k8s-get',
      label: blockName,
      description: blockName,
      expressionFields: ['session'],
      values: { ...getBase(BROKEN_SESSION_VAR), on_error: 'record' },
    })
    const after = markerNode({
      id: 'log-after',
      description: 'Must never run',
      text: `${MARK}S-21 continued`,
    })
    const fixture = buildTest(
      'K8s Read Hard Fail Under Record E2E Test',
      [before, getNode, after],
      chainEdges([before.id, getNode.id, after.id]),
      { broken_session: stringVar(BROKEN_SESSION) },
    )

    await importValidateAndNavigate(page, fixture)

    const status = await startRun(page)
    const { verdict, logs } = await finishRunAnyVerdict(
      page,
      status,
      `Block '${blockName}' failed:`,
      90_000,
    )
    const all = logs.join('\n')

    await test.step('the run stopped at the Block instead of recording and carrying on', () => {
      expect(
        logs.some((t) => t === `${MARK}S-21 reached`),
        `the run never reached the failing Block.\n${all}`,
      ).toBeTruthy()
      expect(verdict, `the run must not pass.\n${all}`).toBe('failed')
      expect(
        logs.some((t) => t === `${MARK}S-21 continued`),
        `nothing after the Block may run.\n${all}`,
      ).toBeFalsy()
    })

    await test.step('the Block error is the transport failure, verbatim up to the OS text', () => {
      const line = logs.find((t) => t.startsWith(`Block '${blockName}' failed:`)) ?? ''
      expect(line, `the Block failure line is missing.\n${all}`).toContain(
        `Block '${blockName}' failed: ${NO_CONNECT}`,
      )
    })

    await test.step('Record and continue did NOT soften it: no WARN line, no amber Block', async () => {
      const lines = await getLogLines(page)
      expectNoRecordedWarning(lines)
      expect(
        lines.some((l) => l.startsWith('[ERROR]') && l.includes(`Block '${blockName}' failed:`)),
        `the failure must be reported at ERROR level.\n${lines.join('\n')}`,
      ).toBeTruthy()
      await expectNoAmberBlock(page)
    })

    await test.step('the Block reads FAIL, not WARN', async () => {
      const node = page.locator('[data-testid="workflow-node-blk-S-21"]')
      await expect(node).toHaveAttribute('data-execution-status', 'failed')
      await expect(node.locator('[data-testid="node-run-state-badge"]')).toHaveAttribute(
        'data-state',
        'fail',
      )
    })
  })

  test('S-18: groups without a user is refused identically on all four read Blocks, under both On error settings, before any request', async ({
    page,
  }) => {
    // The session points at a closed port. If the pairing were NOT refused the
    // request would go out and the caught message would be the transport error,
    // so the sentence below is also the proof that nothing reached the cluster.
    const blocks: readonly K8sReadElementType[] = [
      'k8s-get',
      'k8s-events',
      'k8s-logs',
      'k8s-top',
    ]
    const cases: RefusalCase[] = blocks.flatMap((elementType) =>
      (['fail', 'record'] as const).map((onError) => ({
        id: `S-18-${elementType.replace('k8s-', '')}-${onError}`,
        elementType,
        values: {
          ...BASE_VALUES[elementType](BROKEN_SESSION_VAR),
          on_error: onError,
          impersonate_groups: K8S_IMPERSONATE_GROUP,
        },
        message: GROUPS_WITHOUT_USER,
      })),
    )

    const legs = cases.map(refusalLeg)
    const done = markerNode({
      id: 'log-done',
      description: 'Bookend marker',
      text: `${MARK}s18-done`,
    })
    const fixture = buildTest(
      'K8s Read Impersonation Pairing Refusal E2E Test',
      [...legs.flatMap((l) => l.nodes), done],
      sequence([], legs, [done.id]),
      { broken_session: stringVar(BROKEN_SESSION), leg_err: mapVar() },
    )

    await importValidateAndNavigate(page, fixture)
    const status = await startRun(page)
    const logs = await finishRun(page, status, `${MARK}s18-done`, 120_000)
    const all = logs.join('\n')

    for (const c of cases) {
      await test.step(`${c.id} raises the pairing refusal`, () =>
        expectRefused(logs, c.id, c.message))
    }

    await test.step('the sentence is identical on all four Blocks and both settings', () => {
      const messages = cases.map(
        (c) => logs.find((t) => t.startsWith(msgPrefix(c.id)))?.slice(msgPrefix(c.id).length) ?? '',
      )
      expect(new Set(messages).size, `the refusal must read the same everywhere.\n${all}`).toBe(1)
      expect(messages[0]).toBe(GROUPS_WITHOUT_USER)
    })

    await test.step('no request reached the cluster', () => {
      expect(
        logs.filter((t) => t.includes(NO_CONNECT)),
        `a request went out before the refusal.\n${all}`,
      ).toEqual([])
    })

    await test.step('Record and continue did not turn a configuration refusal amber', async () => {
      expectNoRecordedWarning(await getLogLines(page))
      await expectNoAmberBlock(page)
    })
  })

  test('S-18 regression traps: groups with a user, a user on its own, and groups that resolve to nothing all still run', async ({
    page,
  }) => {
    const traps = [
      {
        id: 'S-18-trap-groups-and-user',
        binding: 'trap_groups_and_user_names',
        values: {
          impersonate_user: K8S_IMPERSONATE_NOBODY,
          impersonate_groups: K8S_IMPERSONATE_GROUP,
        },
      },
      {
        id: 'S-18-trap-user-alone',
        binding: 'trap_user_alone_names',
        values: { impersonate_user: K8S_IMPERSONATE_USER },
      },
      {
        id: 'S-18-trap-groups-blank',
        binding: 'trap_groups_blank_names',
        values: { impersonate_groups: '   ' },
      },
      {
        id: 'S-18-trap-groups-commas',
        binding: 'trap_groups_commas_names',
        values: { impersonate_groups: ' , ' },
      },
    ] as const

    const head = connectNode(run.namespace)
    const nodes: WorkflowNode[] = [head]
    const chain: string[] = [head.id]
    const variables: Record<string, TestVariable> = {
      k8s_admin_token: stringVar(K8S_ADMIN_TOKEN, true),
      k8s_ca: stringVar(K8S_CA_PEM),
      k8s_session: stringVar(''),
    }

    for (const trap of traps) {
      nodes.push(
        k8sReadNode({
          id: `blk-${trap.id}`,
          elementType: 'k8s-get',
          description: `${trap.id} k8s-get`,
          expressionFields: ['session'],
          values: { ...getBase(SESSION_VAR), ...trap.values },
          outputBindings: { names: trap.binding },
        }),
        markerNode({
          id: `log-${trap.id}`,
          description: `${trap.id} result`,
          expression: `f"${MARK}${trap.id} names={${trap.binding}}"`,
        }),
      )
      chain.push(`blk-${trap.id}`, `log-${trap.id}`)
      variables[trap.binding] = arrayVar()
    }

    const done = markerNode({
      id: 'log-done',
      description: 'Bookend marker',
      text: `${MARK}s18-traps-done`,
    })
    nodes.push(done)
    chain.push(done.id)

    const fixture = buildTest(
      'K8s Read Impersonation Regression Traps E2E Test',
      nodes,
      chainEdges(chain),
      variables,
    )

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const logs = await finishRun(page, status, `${MARK}s18-traps-done`, 120_000)
    const all = logs.join('\n')

    for (const trap of traps) {
      await test.step(`${trap.id} runs and reaches the cluster`, async () => {
        const line = logs.find((t) => t.startsWith(`${MARK}${trap.id} names=`)) ?? ''
        expect(line, `${trap.id}: the read did not return the seeded Pod.\n${all}`).toContain(
          SEEDED.podLabeled,
        )
        await expect(
          page.locator(`[data-testid="workflow-node-blk-${trap.id}"]`),
        ).toHaveAttribute('data-execution-status', 'success')
      })
    }

    await test.step('nothing was refused for the pairing', () => {
      expect(
        logs.filter((t) => t.includes(GROUPS_WITHOUT_USER)),
        `a legal impersonation pairing was refused.\n${all}`,
      ).toEqual([])
    })
  })
})
