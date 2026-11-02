/**
 * V-K8S-WRITE-WAIT: a selector delete never reports a removal it did not
 * observe.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test, writes
 * only inside the run's own namespace, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-3.5.2.2, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-5, K8SWRITE-6
 *
 * Wait until gone is on by default, so the selector path is the one most runs
 * take. Its poll is a plain list read, and an identity may be allowed to
 * destroy a collection while never being allowed to look at it. This run puts
 * both halves side by side in one namespace: the same delete, the same
 * selector shape and the same wait, under one identity that can read the poll
 * and one that cannot.
 *
 * The refused half is a hard failure, so a Try/Catch holds it and the sentence
 * is read off the caught message. Both halves then read the namespace back
 * under the admin identity, which is what separates "the wait never observed
 * it" from "the delete never happened".
 *
 * Pass Criteria:
 *   KW-30  a selector delete whose wait poll is refused keeps polling until the
 *          Block Timeout runs out and then fails, naming the plural and the
 *          selector it was waiting on - and the objects it deleted really are
 *          gone, so the refusal is the poll and not the delete
 *   KW-31  the same selector delete under an identity that can read the poll
 *          finishes its wait and reports exactly what it removed
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, K8S_LIMITED_TOKEN } from '../../helpers/config'
import {
  appliedLine,
  buildWriteFixture,
  corePath,
  countOf,
  deleteQuery,
  deletedLine,
  expectCaught,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectSummary,
  namesOf,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
  type SessionVariables,
  type WriteLeg,
  type WriteMaterial,
} from './cases-write'

/** The bookend the run harvests its console against. */
const WAIT_MARKER = 'k8s-write-wait-done'

const CONFIGMAPS = 'configmaps'

/** The label both halves are selected by, with one value each. */
const LABEL = 'wave-wait'
const REFUSED_VALUE = 'refused'
const READABLE_VALUE = 'readable'
const REFUSED_SELECTOR = `${LABEL}=${REFUSED_VALUE}`
const READABLE_SELECTOR = `${LABEL}=${READABLE_VALUE}`

const REFUSED_NAME = 'wave-wait-blind-cm'
const READABLE_NAME = 'wave-wait-open-cm'

/** The cluster identity that may destroy a collection but may never read one.
 *  It has no token, so the Impersonate user row is the only way to act as it. */
const DELETER = 'wave-deleter'

/** Short on purpose: the refused poll has to run out inside one run. */
const WAIT_TIMEOUT = 5

let run: SeededRun

function material(
  overrides: Partial<WriteMaterial> & Pick<WriteMaterial, 'name' | 'bookend'>,
): WriteMaterial {
  return {
    adminToken: K8S_ADMIN_TOKEN,
    limitedToken: K8S_LIMITED_TOKEN,
    caCert: K8S_CA_PEM,
    namespace: run.namespace,
    connects: ['admin'],
    ...overrides,
  }
}

function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

/** The form has no label row, so the two targets arrive as manifests. */
const labeledConfigMap = (name: string, value: string): string =>
  [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    '  labels:',
    `    ${LABEL}: ${value}`,
    'data:',
    '  role: "target"',
    '',
  ].join('\n')

async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, 180_000)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

/** KW-30, KW-31: one selector delete each, under two identities. */
function waitLegs(): WriteLeg[] {
  return [
    {
      key: 'plantref',
      ids: ['KW-30'],
      what: 'the labeled target of the refused poll',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: labeledConfigMap(REFUSED_NAME, REFUSED_VALUE),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'plantread',
      ids: ['KW-31'],
      what: 'the labeled target of the readable poll',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: labeledConfigMap(READABLE_NAME, READABLE_VALUE),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'okdel',
      ids: ['KW-31'],
      what: 'delete by selector and wait',
      block: 'delete',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        delete_by: 'selector',
        label_selector: READABLE_SELECTOR,
        wait_until_gone: true,
        timeout: 30,
      },
    },
    {
      key: 'blinddel',
      ids: ['KW-30'],
      what: 'the same delete, but the poll is refused',
      block: 'delete',
      guarded: true,
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        delete_by: 'selector',
        label_selector: REFUSED_SELECTOR,
        impersonate_user: DELETER,
        wait_until_gone: true,
        timeout: WAIT_TIMEOUT,
      },
    },
    {
      key: 'goneref',
      ids: ['KW-30'],
      what: 'what the refused poll never saw',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'selector',
        label_selector: REFUSED_SELECTOR,
        output_format: 'map',
      },
    },
    {
      key: 'goneread',
      ids: ['KW-31'],
      what: 'what the readable poll observed',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'selector',
        label_selector: READABLE_SELECTOR,
        output_format: 'map',
      },
    },
  ]
}

test.describe('K8s Delete: the wait a selector delete owes (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('a refused wait poll fails the Block, and a readable one finishes it (KW-30, KW-31)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = waitLegs()
    const blind = legs.find((leg) => leg.key === 'blinddel') as WriteLeg
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Delete Wait E2E Test', bookend: WAIT_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, WAIT_MARKER)
    const collection = corePath(run.namespace, CONFIGMAPS)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      expectLine(logs, appliedLine(1))
    })

    await test.step('KW-31: the readable poll finishes the wait and names what it removed', () => {
      expectSummary(vars, 'okdel', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ConfigMap', '', READABLE_NAME), 'deleted']],
      })
      expect(namesOf(vars, 'okdel')).toEqual([READABLE_NAME])
      expect(countOf(vars, 'okdel')).toBe(1)
      expectLine(
        logs,
        deletedLine(
          1,
          'ConfigMap',
          `${collection}${deleteQuery({ labelSelector: READABLE_SELECTOR })}`,
        ),
      )
      expect(countOf(vars, 'goneread'), `the readable target survived.\n${all}`).toBe(0)
    })

    await test.step('KW-30: the refused poll runs out the Timeout and fails, naming what it waited on', () => {
      expectCaught(
        logs,
        blind,
        `Timed out after ${WAIT_TIMEOUT} seconds waiting for ${CONFIGMAPS} matching` +
          ` ${REFUSED_SELECTOR} to be deleted`,
      )
    })

    await test.step('KW-30: the delete really landed, so the refusal is the poll', () => {
      expect(
        countOf(vars, 'goneref'),
        `the delete never happened, so the timeout proves nothing.\n${all}`,
      ).toBe(0)
      expect(namesOf(vars, 'goneref')).toEqual([])
    })

    await test.step('KW-30: the failure is hard - no recorded WARN line and no amber Block', async () => {
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry.startsWith('Delete failed')),
        `Fail the block must not write a recorded WARN line.\n${all}`,
      ).toEqual([])
      expect(
        await page
          .locator(`[data-testid="workflow-node-${blind.block}-${blind.key}"]`)
          .getAttribute('data-execution-status'),
        `a hard failure must not paint the Block amber.\n${all}`,
      ).not.toBe('warning')
    })
  })
})
