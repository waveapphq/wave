/**
 * V-K8S-GET-FAILURES (R1, split out): the K8s Get failure options against the
 * real kwok cluster.
 *
 * Covers option rows G-32 and G-56 to G-62 - the eight empty-shape cells, one
 * per Output Format crossed with named and listed - plus the shared rows S-20
 * (the amber row) and S-03 (the empty-session sentence).
 *
 * It is a separate file from `v-k8s-get-options.spec.ts` only because of the
 * runtime budget: one run carrying the sweep and these legs lands over the
 * 60 s a functional file is allowed. The seeding is the cheap `minimal`
 * profile - every leg here fails on purpose, so the only thing it needs from
 * the cluster is a namespace and one pod.
 *
 * G-60 carries a caveat, stated in its own title. A 401 arising from the READ
 * rather than from discovery cannot be produced on this cluster: every
 * authenticated identity passes the default system:discovery grant, so a
 * credential that 401s at all 401s on the first discovery document. The leg
 * proves the authentication-failed wording and the JSON + listed empty shape;
 * the origin is discovery, not the read.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-8
 * REQ: REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogEntries, getLogLines, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  chainEdges,
  edge,
  handleEdge,
  k8sReadNode,
  markerNode,
  stackNodes,
  tryCatchNode,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, K8S_LIMITED_TOKEN } from '../../helpers/config'
import {
  buildGetFixture,
  countVar,
  errorVar,
  failureLegs,
  GET_FAILURES_DONE_MARKER,
  legMarker,
  markerLine,
  MISSING_KIND,
  MISSING_POD,
  MISSING_POD_YAML,
  namesVar,
  okVar,
  reasonVar,
  recordedLine,
  resultVar,
  SESSION_VARIABLE,
  type GetLeg,
} from './cases-get'

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: unknown[]; rows: unknown[][] }

/** A junk bearer token: no cluster identity maps to it, so /version 401s and
 *  K8s Connect cannot build this session. The fixture hand-writes it. */
const JUNK_TOKEN = 'wave-not-a-real-token'

const EMPTY_SESSION_HEAD =
  'is set but what it points at is empty: check it names the variable a K8s Connect block assigns its '
const EMPTY_SESSION_TAIL = 'output to, and that Connect ran before this block'
const NOT_A_KUBECONFIG = 'is not a kubeconfig WAVE can read'
const S03_MARKER = '[S-03] empty session variable'
const S03_DONE_MARKER = 'k8s-get-empty-session-done'

let run: SeededRun
const legs: GetLeg[] = failureLegs()

function leg(key: string): GetLeg {
  const found = legs.find((candidate) => candidate.key === key)
  expect(found, `no leg "${key}" in the case table`).toBeTruthy()
  return found as GetLeg
}

function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

const errorOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, errorVar(leg(key))).value)
const reasonOf = (vars: SessionVariables, key: string): string =>
  String(cell(vars, reasonVar(leg(key))).value)

/** Every failure leg reports the same core: no rows, no names, success false. */
function expectRecordedCore(vars: SessionVariables, key: string): void {
  expect(cell(vars, okVar(leg(key))).value, `${key} must report success false`).toBe(false)
  expect(Number(cell(vars, countVar(leg(key))).value), `${key} count`).toBe(0)
  expect(cell(vars, namesVar(leg(key))).value, `${key} names`).toEqual([])
}

/** The empty `result` the Output Format and Search by pair declares. */
function expectEmptyShape(
  vars: SessionVariables,
  key: string,
  type: string,
  empty?: unknown,
): void {
  const found = cell(vars, resultVar(leg(key)))
  expect(found.type, `${legMarker(leg(key))} result type`).toBe(type)
  if (type === 'table') {
    const table = found.value as WaveTable
    expect(table.columns, `${key} empty table columns`).toEqual([])
    expect(table.rows, `${key} empty table rows`).toEqual([])
    return
  }
  expect(found.value, `${legMarker(leg(key))} empty result`).toEqual(empty)
}

function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

test.describe('K8s Get failure options (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('eight empty-shape cells, their exact wordings, and the amber row (G-32, G-56 to G-62, S-20)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const fixture = buildGetFixture(legs, {
      adminToken: K8S_ADMIN_TOKEN,
      limitedToken: K8S_LIMITED_TOKEN,
      junkToken: JUNK_TOKEN,
      caCert: K8S_CA_PEM,
      namespace: run.namespace,
      connects: ['admin', 'limited', 'anon'],
      handWritten: ['junk'],
      name: 'K8s Get Failure Options E2E Test',
      bookend: GET_FAILURES_DONE_MARKER,
    })
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, GET_FAILURES_DONE_MARKER, 120_000)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)
    const warnings = messagesAt(entries, 'WARN')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const authFailed = 'Kubernetes API authentication failed: Unauthorized'
    const anonDenied =
      'Kubernetes API permission denied: forbidden: User "system:anonymous"' +
      ' cannot get path "/api/v1"'
    const discoveryMiss =
      `This cluster has no resource kind '${MISSING_KIND}'` +
      ' - check the spelling, or whether the CRD is installed'
    const notFound = `K8s Pod '${MISSING_POD}' not found in namespace '${run.namespace}'`
    const notFoundYaml =
      `K8s Pod '${MISSING_POD_YAML}' not found in namespace '${run.namespace}'`
    const secretDenied =
      `Kubernetes API permission denied: secrets "${SEEDED.secret}" is forbidden:` +
      ` User "wave-limited" cannot get resource "secrets" in API group ""` +
      ` in the namespace "${run.namespace}"`
    const badSelector =
      `Kubernetes could not list Pod objects in namespace '${run.namespace}':` +
      ' field label not supported: spec.bogus'

    await test.step('every leg reported its option ids and painted amber', async () => {
      for (const candidate of legs) {
        expect(
          logs.some((text) => text.includes(markerLine(candidate))),
          `${candidate.key} (${candidate.ids.join(', ')}) never reached its marker.\n${all}`,
        ).toBeTruthy()
        await expectNodeStatus(page, `get-${candidate.key}`, 'warning')
        expectRecordedCore(vars, candidate.key)
      }
    })

    await test.step('G-56: a junk bearer token gives the authentication wording, Map + listed empty', () => {
      expect(errorOf(vars, 'g56')).toBe(authFailed)
      expect(reasonOf(vars, 'g56')).toBe('Unauthorized')
      expectEmptyShape(vars, 'g56', 'array', [])
      expect(
        logs.includes(recordedLine('Unauthorized', authFailed)),
        `the recorded WARN line is missing.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('G-57: an anonymous session gives the permission wording, Map + named empty', () => {
      expect(errorOf(vars, 'g57')).toBe(anonDenied)
      expect(reasonOf(vars, 'g57')).toBe('Forbidden')
      expectEmptyShape(vars, 'g57', 'map', {})
    })

    await test.step('G-32, G-58: a kind the cluster does not serve, Table + listed empty', () => {
      expect(errorOf(vars, 'g58')).toBe(discoveryMiss)
      expect(reasonOf(vars, 'g58')).toBe('NotFound')
      expectEmptyShape(vars, 'g58', 'table')
    })

    await test.step('G-59, S-20, ONE-WARN: the amber row writes exactly one WARN line and the run still passes', async () => {
      expect(errorOf(vars, 'g59')).toBe(notFound)
      expect(reasonOf(vars, 'g59')).toBe('NotFound')
      expectEmptyShape(vars, 'g59', 'table')

      const line = recordedLine('NotFound', notFound)
      expect(
        warnings.filter((message) => message === line).length,
        `expected exactly one WARN line for ${legMarker(leg('g59'))}.\n${all}`,
      ).toBe(1)

      const badge = page.locator(
        '[data-testid="workflow-node-get-g59"] [data-testid="node-run-state-badge"]',
      )
      await expect(badge).toHaveAttribute('data-state', 'warn')
      await expect(badge).toHaveText('WARN')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('G-60: JSON + listed empty is an empty string (origin is discovery, see the file header)', () => {
      expect(errorOf(vars, 'g60')).toBe(authFailed)
      expect(reasonOf(vars, 'g60')).toBe('Unauthorized')
      expectEmptyShape(vars, 'g60', 'string', '')
    })

    await test.step('G-61: the view-only token cannot read a Secret, JSON + named empty', () => {
      expect(errorOf(vars, 'g61')).toBe(secretDenied)
      expect(reasonOf(vars, 'g61')).toBe('Forbidden')
      expectEmptyShape(vars, 'g61', 'string', '')
    })

    await test.step('G-62, READ-WORDING: the list wording carries the cluster text and names the object once', () => {
      expect(errorOf(vars, 'g62a')).toBe(badSelector)
      expect(reasonOf(vars, 'g62a')).toBe('BadRequest')
      expectEmptyShape(vars, 'g62a', 'string', '')
      expect(errorOf(vars, 'g62a')).not.toContain('rejected the update')

      expect(errorOf(vars, 'g62b')).toBe(notFoundYaml)
      expect(reasonOf(vars, 'g62b')).toBe('NotFound')
      expectEmptyShape(vars, 'g62b', 'string', '')
    })
  })

  test('S-03, EMPTY-SESSION: a session pointing at an empty variable says so, and the run does not soften it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const nodes: WorkflowNode[] = stackNodes([
      tryCatchNode({
        id: 'tc-empty',
        description: 'Guard for the empty-session leg',
        errorBinding: 's03_err',
      }),
      k8sReadNode({
        id: 'get-empty',
        elementType: 'k8s-get',
        description: `${S03_MARKER} on K8s Get`,
        expressionFields: ['session'],
        values: {
          session: SESSION_VARIABLE.empty,
          resource_type: 'default',
          kind: 'Pod',
          search_by: 'name',
          name: SEEDED.podLabeled,
          output_format: 'map',
          // Record and continue must NOT soften a configuration refusal.
          on_error: 'record',
        },
      }),
      markerNode({ id: 'log-caught', description: 'Catch branch', text: `${S03_MARKER} caught` }),
      markerNode({
        id: 'log-err',
        description: 'Bound error',
        expression: `f'${S03_MARKER} err={s03_err}'`,
      }),
      markerNode({ id: 'log-done', description: 'Bookend', text: S03_DONE_MARKER }),
    ])
    const edges: WorkflowEdge[] = [
      ...chainEdges(['tc-empty']),
      handleEdge('tc-empty', 'try', 'get-empty'),
      handleEdge('tc-empty', 'catch', 'log-caught'),
      handleEdge('tc-empty', 'then', 'log-err'),
      edge('log-err', 'log-done'),
    ]
    const fixture = {
      name: 'K8s Get Empty Session E2E Test',
      version: '1.0.0',
      description: '',
      workflow: { nodes, edges },
      variables: {
        sess_empty: { value: '', type: 'string', scope: 'test' },
        s03_err: { value: {}, type: 'map', scope: 'test' },
      },
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const logs = await finishRun(page, status, S03_DONE_MARKER, 90_000)
    const all = logs.join('\n')

    await test.step('the Block fails with the empty-session sentence, not the not-a-kubeconfig one', async () => {
      expect(
        logs.some((text) => text.includes(`${S03_MARKER} caught`)),
        `the catch branch must have run.\n${all}`,
      ).toBeTruthy()
      const bound = logs.find((text) => text.includes(`${S03_MARKER} err=`)) ?? ''
      // The error map is logged through repr, which escapes the quotes around
      // 'session', so the sentence is matched in quote-free pieces.
      expect(bound, `the bound error is missing.\n${all}`).toContain(EMPTY_SESSION_HEAD)
      expect(bound).toContain(EMPTY_SESSION_TAIL)
      expect(bound, 'the two session sentences must stay distinguishable').not.toContain(
        NOT_A_KUBECONFIG,
      )
      const lines = await getLogLines(page)
      expect(
        lines.some((text) => text.includes('Try-path error caught')),
        `the engine must report the catch.\n${all}`,
      ).toBeTruthy()
      expect(
        await page
          .locator('[data-testid="workflow-node-get-empty"]')
          .getAttribute('data-execution-status'),
        'a configuration refusal must not paint the Block amber',
      ).not.toBe('warning')
    })
  })
})
