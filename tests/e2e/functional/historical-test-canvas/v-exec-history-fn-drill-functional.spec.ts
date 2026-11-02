/**
 * V-EXEC-HISTORY-FN-DRILL: a run's history canvas drilled into a Function shows that Function's scope
 * REQ: REQ-3.1.3.1 (Variable scoping with namespace-based access)
 *
 * Phase: functional-workflow. API seed (POST /tests): a Test variable `count`, a Local Function
 * `Scoped_Fn` (input `region` with a default, output `result`, local `loc_n`) whose body sets
 * `result`, then a Log of `count`; validated with zero errors. One tracked run (POST /executions)
 * finishes, then its history canvas is opened.
 *
 * Pass Criteria:
 * 1. At the history root the Variable Manager lists the Test variable `count` and none of the
 *    Function's names.
 * 2. Drilled into `Scoped_Fn`, the Variable Manager lists the Function's input `region`, output
 *    `result` and local `loc_n`, and no longer lists `count`.
 * 3. Back at the root the Test variable list returns.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, localFunctionNode, logNode, startEdge, validateTest } from '../../helpers/fn-seed'
import { openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { variableRow } from '../../helpers/variable-create'
import { digIn } from '../../helpers/workbench'

const FN_ID = 'hist-scoped-fn'
const FN_LABEL = 'Scoped_Fn'
const FUNCTION_NAMES = ['region', 'result', 'loc_n']

function setterNode(id: string, variables: Record<string, string>): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y: 160 },
    data: {
      label: 'Set result',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: Object.keys(variables),
      variableTypes: Object.fromEntries(Object.keys(variables).map((name) => [name, 'string'])),
      config: { values: { variables }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

async function expectRows(page: Page, shown: string[], hidden: string[]): Promise<void> {
  for (const name of shown) await expect(variableRow(page, name), `${name} is listed`).toHaveCount(1)
  for (const name of hidden) await expect(variableRow(page, name), `${name} is not listed`).toHaveCount(0)
}

let testId: string | undefined

test.describe('V-EXEC-HISTORY-FN-DRILL: the history Variable Manager follows the drill', () => {
  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = undefined
  })

  test("drilled into a Function the history Variable Manager lists the Function's inputs, outputs and locals", async ({
    page,
    request,
  }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    testId = await createValidTest(request, {
      name: `zz-history-fn-drill-${randomUUID().slice(0, 8)}`,
      variables: { count: { type: 'integer', value: 7 } },
      nodes: [
        localFunctionNode(FN_ID, FN_LABEL, {
          inputs: [{ name: 'region', type: 'string', required: false, default: 'eu' }],
          outputs: [{ name: 'result', type: 'string' }],
          variables: [{ name: 'loc_n', type: 'integer', value: 2 }],
          nodes: [setterNode('hist-set', { result: "region + '-done'" })],
          edges: [{ id: 'e-start-hist-set', source: 'start-node', target: 'hist-set' }],
        }),
        logNode('hist-log', 'Log count', 'count', { x: 300, y: 340 }),
      ],
      edges: [startEdge(FN_ID), { id: 'e-fn-log', source: FN_ID, target: 'hist-log' }],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)

    const run = await runTrackedTest(request, testId)
    expect(run.verdict, 'the tracked run passed').toBe('passed')
    await openRunHistory(page, run.executionId)
    await expect(page.getByTestId('variable-manager')).toBeVisible({ timeout: 15_000 })

    await test.step('the history root lists the Test variable only', async () => {
      await expectRows(page, ['count'], FUNCTION_NAMES)
    })

    await test.step("drilled into the Function: its inputs, outputs and locals, not the Test's", async () => {
      await digIn(page, FN_ID)
      await expect(page.getByTestId('canvas-breadcrumb')).toContainText(FN_LABEL)
      await expect(page.getByTestId('workflow-node-hist-set')).toBeVisible()
      await expectRows(page, FUNCTION_NAMES, ['count'])
    })

    await test.step('back at the root the Test variable list returns', async () => {
      await page.getByTestId('breadcrumb-back-arrow').click()
      await expect(page.getByTestId('canvas-breadcrumb')).not.toContainText(FN_LABEL)
      await expect(page.getByTestId('workflow-node-hist-log')).toBeVisible()
      await expectRows(page, ['count'], FUNCTION_NAMES)
    })
  })
})
