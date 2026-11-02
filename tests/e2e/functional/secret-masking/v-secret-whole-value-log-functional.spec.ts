/**
 * V-SECRET-WHOLE-VALUE-LOG: a Log Block printing a whole secret list, map or table logs the mask
 * Wireframe: none (run log only)
 * Design Decisions: SECUI-1
 * REQ: REQ-3.1.3.5, REQ-3.1.3.23
 *
 * Phase: functional-workflow (creates its own Suite and Test, deletes both after).
 *
 * Pass Criteria:
 * 1. A Log Block printing a whole secret map of the Test logs exactly `********`.
 * 2. A Log Block printing a whole secret list of maps of the Test logs exactly `********`.
 * 3. A Log Block printing a whole secret table of the Test logs exactly `********`.
 * 4. A Log Block printing a whole secret map of the Test's Suite logs exactly `********`.
 * 5. A plain map of the same shape prints in WAVE's print form, so the mask is the secret's.
 * 6. No console line carries any text held inside the secrets, and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { logNode, openTest, validateTest } from '../../helpers/fn-seed'
import { formatEntries, type LogEntry } from '../../helpers/log-reader'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'

const MASK = '********'
const LEAVES = ['db-7c4.internal', 'ann-7c1', 'bob-7c2', 'alpha-7c3', 'suite-7c6.internal']

const PRINTS: Array<{ label: string; message: string; line: string }> = [
  { label: 'smap', message: 'conf', line: MASK },
  { label: 'slist', message: 'creds', line: MASK },
  { label: 'stable', message: 'rows', line: MASK },
  { label: 'ssuite', message: 'suite.suite_conf', line: MASK },
  { label: 'pmap', message: 'plain_conf', line: '{"host":"public-7c5.example","port":80}' },
]

const DONE = 'whole-value-done'

const uniqueSuffix = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function fixture(): Record<string, unknown> {
  const labels = [...PRINTS.map((print) => print.label), 'done']
  const nodes = [
    ...PRINTS.map((print, index) => logNode(print.label, print.label, print.message, { x: 300, y: 120 + index * 100 })),
    logNode('done', 'done', `'${DONE}'`, { x: 300, y: 120 + PRINTS.length * 100 }),
  ]
  const edges = labels.map((label, index) => ({
    id: `e-${label}`,
    source: index === 0 ? 'start-node' : labels[index - 1],
    target: label,
    type: 'default',
  }))
  return {
    name: `Secret Whole Value Log ${uniqueSuffix()}`,
    version: '1.0.0',
    description: 'Log Blocks printing whole secret lists, maps and tables of the Test and its Suite.',
    workflow: { nodes, edges },
    variables: {
      conf: { type: 'map', scope: 'test', secret: true, value: { host: 'db-7c4.internal', port: 5432 } },
      creds: {
        type: 'array',
        scope: 'test',
        secret: true,
        value: [
          { user: 'ann-7c1', pin: 1234 },
          { user: 'bob-7c2', pin: 5678 },
        ],
      },
      rows: { type: 'table', scope: 'test', secret: true, value: [{ name: 'alpha-7c3', qty: 1 }] },
      plain_conf: { type: 'map', scope: 'test', value: { host: 'public-7c5.example', port: 80 } },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** The messages one Log Block wrote, found by its console source. */
function linesOf(entries: readonly LogEntry[], label: string): string[] {
  return entries.filter((entry) => entry.source === `Log : ${label}`).map((entry) => entry.message)
}

test.describe('V-SECRET-WHOLE-VALUE-LOG', () => {
  let testId = ''
  let suiteId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
    testId = ''
    suiteId = ''
  })

  test('whole secret lists, maps and tables of the Test and its Suite log the mask', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)

    const suite = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: `Secret Whole Value Suite ${uniqueSuffix()}`,
        variables: {
          suite_conf: { type: 'map', secret: true, value: { host: 'suite-7c6.internal', port: 5432 } },
        },
      },
    })
    expect(suite.ok(), `POST /suites: ${suite.status()} ${await suite.text()}`).toBeTruthy()
    suiteId = (await suite.json()).data.id as string

    const created = await request.post(`${BACKEND_URL}/tests`, { data: fixture() })
    expect(created.ok(), `POST /tests: ${created.status()} ${await created.text()}`).toBeTruthy()
    testId = (await created.json()).data.id as string
    const added = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, { data: { test_id: testId } })
    expect(added.ok(), `add the Test to the Suite: ${added.status()}`).toBeTruthy()
    const validation = await validateTest(request, testId)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

    await openTest(page, testId)
    await selectEnvironment(page)
    const run = await runToEnd(page)
    const dump = formatEntries(run.entries)

    expect(linesOf(run.entries, 'done'), `the run reached its last Block:\n${dump}`).toEqual([DONE])
    for (const print of PRINTS) {
      expect(linesOf(run.entries, print.label), `Log ${print.label} prints ${print.message}:\n${dump}`).toEqual([
        print.line,
      ])
    }
    for (const leaf of LEAVES) {
      expect(dump, `no console line carries "${leaf}"`).not.toContain(leaf)
    }
    expect(run.verdict, `run verdict:\n${dump}`).toBe('passed')
  })
})
