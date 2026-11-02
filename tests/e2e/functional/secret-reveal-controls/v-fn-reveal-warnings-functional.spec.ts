/**
 * V-FN-REVEAL-WARNINGS-FUNCTIONAL: every revealing Block is announced, library Function bodies included
 * Wireframe: none
 * Design Decisions: SECREV-2, SECREV-5
 * REQ: REQ-3.1.3.5, REQ-3.1.3.16
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a library Function
 * through POST /functions whose body holds a Log set to "Always reveal" on its main flow, one in
 * a Try path and one in a For loop body, then a plain Log; and a Test through POST /tests (zero
 * validation errors) with a revealing root Log followed by a Function Block running that
 * Function. Run-output reveal stays off (reset before and after).
 *
 * Pass Criteria:
 * 1. The run-start WARN names every revealing Block, the library Function's included, in order.
 * 2. Each revealing Block gets `Secret masking bypassed for this block - ...` right before it
 *    runs: at the root, in the Function body, in the Try path and in the loop body.
 * 3. The plain Log gets no such WARN.
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { ALL_MASKED, setMasking } from './masking-flags'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { logNode, openTest, publishLibraryFunction, sharedNode, startEdge } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'

const RUN_START_WARN =
  "Secret masking bypassed for 4 block(s): RootLog, FnLog, TryLog, LoopLog. Secret values appear in cleartext in this run's logs and reports."
const PRE_BLOCK_WARN =
  'Secret masking bypassed for this block - secret values appear in cleartext in its logs and reports.'

/** A Log set to "Always reveal" that prints `marker`. */
function revealingLog(id: string, label: string, marker: string, y: number): Record<string, unknown> {
  const node = logNode(id, label, `'${marker}'`, { x: 200, y }) as { data: { config: Record<string, unknown> } }
  node.data.config.secret_masking = 'reveal'
  return node as unknown as Record<string, unknown>
}

function controlNode(
  id: string,
  label: string,
  elementType: string,
  category: string,
  values: Record<string, unknown>,
  y: number,
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y },
    data: {
      label,
      elementType,
      nodeType: 'control',
      category,
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 160, height: 62 },
  }
}

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `e-${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

test.describe('V-FN-REVEAL-WARNINGS-FUNCTIONAL: reveal warnings inside a library Function', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.beforeEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
  })

  test.afterEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
  })

  // Per SECREV-5: a run-start WARN names every revealing Block and each gets a WARN right before it runs.
  test('a revealing Block in a Function body, a Try path and a loop body is announced as at the root', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const fn = await publishLibraryFunction(request, {
      name: `v-fn-reveal-warnings-${tag}`,
      workflow: {
        nodes: [
          revealingLog('fn-log', 'FnLog', 'fn-ran', 100),
          controlNode('try', 'Try', 'try-catch-finally', 'flow', { enable_catch: false, enable_finally: false }, 200),
          revealingLog('try-log', 'TryLog', 'try-ran', 300),
          controlNode('loop', 'Loop', 'for', 'loop', { mode: 'count', count: 1, start: 0, end: 0 }, 400),
          revealingLog('loop-log', 'LoopLog', 'loop-ran', 500),
          logNode('plain-log', 'PlainLog', "'plain-ran'", { x: 200, y: 600 }),
        ],
        edges: [
          startEdge('fn-log'),
          edge('fn-log', 'try'),
          edge('try', 'try-log', 'try'),
          edge('try', 'loop', 'then'),
          edge('loop', 'loop-log', 'body'),
          edge('loop', 'plain-log', 'then'),
        ],
      },
    })
    functionIds.push(fn.functionId)
    const testId = await importFixtureTest(page, {
      name: `v-fn-reveal-warnings-${tag}`,
      version: '1.0.0',
      description: 'Revealing Blocks at the root and inside a library Function',
      workflow: {
        nodes: [
          revealingLog('root-log', 'RootLog', 'root-ran', 100),
          sharedNode('fn', { functionId: fn.functionId, functionVersion: fn.version, label: fn.name, position: { x: 200, y: 260 } }),
        ],
        edges: [startEdge('root-log'), edge('root-log', 'fn')],
      },
      variables: {},
      metadata: { tags: [], suite_id: null, parent_suite: null },
    })
    testIds.push(testId)

    await openTest(page, testId)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')

    await test.step('the run-start WARN names every revealing Block, the library Function body included', () => {
      expectConsoleLine(entries, 'WARN', RUN_START_WARN)
    })

    await test.step('each revealing Block gets its WARN right before it runs; the plain Log gets none', () => {
      const markers = ['root-ran', 'fn-ran', 'try-ran', 'loop-ran', 'plain-ran']
      const sequence = entries
        .filter(
          (entry) =>
            (entry.level === 'WARN' && entry.message === PRE_BLOCK_WARN) ||
            (entry.level === 'INFO' && markers.includes(entry.message)),
        )
        .map((entry) => (entry.message === PRE_BLOCK_WARN ? 'WARN' : entry.message))
      expect(sequence, formatEntries(entries)).toEqual([
        'WARN',
        'root-ran',
        'WARN',
        'fn-ran',
        'WARN',
        'try-ran',
        'WARN',
        'loop-ran',
        'plain-ran',
      ])
    })
  })
})
