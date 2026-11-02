/**
 * Variable Setter End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 20 nodes covering all VarSetter permutations:
 *
 * Step 1 - Basics:
 *   - 2 Variable Setter controls (literals + expressions)
 *   - 7 Log plugins (verify each variable value)
 *   - Literal assignment: string, integer, float, boolean
 *   - Expression assignment: computed values referencing earlier variables
 *   - Variable propagation: downstream blocks read values set by upstream setter
 *   - Type preservation: numeric types stay numeric, boolean stays boolean
 *   - Multiple variables per setter: all assignments in one control execute correctly
 *   - Per-variable expression resolution (variableExpressionKeys)
 *
 * Step 2 - Loop body:
 *   - For(count=5) with VarSetter(counter = counter + 1) in body
 *   - Verifies expression is re-evaluated on each iteration (counter: 1,2,3,4,5)
 *
 * Step 3 - Nested loops:
 *   - For(3) outer -> For(2) inner with VarSetter(nested_sum = nested_sum + 1)
 *   - Verifies accumulation across 3x2=6 total inner iterations
 *
 * Step 4 - Try-catch:
 *   - VarSetter in try path: try_val = counter + nested_sum
 *   - Verifies variables set in try path propagate to then path
 *
 * REQ: REQ-3.4.1.14 Variable Setter Control
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/variable-setter/v-plugin-varset-execution.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, 'fixture.json'),
    'utf-8'
  )
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Node mapping
// ---------------------------------------------------------------------------

type NodeName =
  // Step 1 - basics
  | 'VARSET_LITERALS'
  | 'LOG_STR'
  | 'LOG_INT'
  | 'LOG_FLOAT'
  | 'LOG_BOOL'
  | 'VARSET_EXPRESSIONS'
  | 'LOG_COMPUTED_STR'
  | 'LOG_COMPUTED_SUM'
  | 'LOG_MULTI_ASSIGN'
  // Step 2 - loop body
  | 'FOR_LOOP'
  | 'VS_INCR'
  | 'LOG_LOOP_BODY'
  // Step 3 - nested loops
  | 'FOR_OUTER'
  | 'FOR_INNER'
  | 'VS_NESTED'
  | 'LOG_NESTED'
  // Step 4 - try-catch
  | 'TRY_CATCH'
  | 'VS_IN_TRY'
  | 'LOG_IN_TRY'
  | 'LOG_FINAL'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Set Literal Values': 'VARSET_LITERALS',
  'Log String Var': 'LOG_STR',
  'Log Integer Var': 'LOG_INT',
  'Log Float Var': 'LOG_FLOAT',
  'Log Boolean Var': 'LOG_BOOL',
  'Set Expression Values': 'VARSET_EXPRESSIONS',
  'Log Computed String': 'LOG_COMPUTED_STR',
  'Log Computed Sum': 'LOG_COMPUTED_SUM',
  'Log Multi Assign Proof': 'LOG_MULTI_ASSIGN',
  'For 5 Loop': 'FOR_LOOP',
  'Increment Counter': 'VS_INCR',
  'Log Loop Counter': 'LOG_LOOP_BODY',
  'For Outer 3': 'FOR_OUTER',
  'For Inner 2': 'FOR_INNER',
  'Nested Increment': 'VS_NESTED',
  'Log Nested': 'LOG_NESTED',
  'Try Catch VarSetter': 'TRY_CATCH',
  'VarSet In Try': 'VS_IN_TRY',
  'Log In Try': 'LOG_IN_TRY',
  'Log Final Summary': 'LOG_FINAL',
}

const ALL_NODE_NAMES: NodeName[] = [
  'VARSET_LITERALS', 'LOG_STR', 'LOG_INT', 'LOG_FLOAT', 'LOG_BOOL',
  'VARSET_EXPRESSIONS', 'LOG_COMPUTED_STR', 'LOG_COMPUTED_SUM', 'LOG_MULTI_ASSIGN',
  'FOR_LOOP', 'VS_INCR', 'LOG_LOOP_BODY',
  'FOR_OUTER', 'FOR_INNER', 'VS_NESTED', 'LOG_NESTED',
  'TRY_CATCH', 'VS_IN_TRY', 'LOG_IN_TRY', 'LOG_FINAL',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

function buildNodeIds(
  fixture: Record<string, unknown>
): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  const workflow = fixture.workflow as { nodes: Array<Record<string, unknown>> }
  for (const node of workflow.nodes) {
    const data = node.data as Record<string, unknown> | undefined
    const displayName = data?.description as string | undefined
    const nodeName = displayName ? DESCRIPTION_TO_NODE[displayName] : undefined
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}



// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Variable Setter E2E Execution', () => {
  test('All VarSetter permutations: literals, expressions, loop body, nested loops, try-catch', async ({
    page,
  }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)

    // Verify all nodes mapped correctly
    for (const name of ALL_NODE_NAMES) {
      expect(
        nodeIds.has(name),
        `Node "${name}" not found in fixture`
      ).toBeTruthy()
    }

    // ================================================================
    // STEP 1: Import test via API
    // ================================================================
    await test.step('Import test via API', async () => {
      await page.request
        .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
        .catch(() => {})

      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests`,
        { data: fixture }
      )
      expect(
        createResponse.ok(),
        `POST /tests failed: ${createResponse.status()}`
      ).toBeTruthy()

      const created = (await createResponse.json()) as Record<string, unknown>
      const testData = created.data as Record<string, unknown> | undefined
      const testId = testData?.id || created.id

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    // ================================================================
    // STEP 2: Run workflow
    // ================================================================
    await test.step('Run workflow and wait for completion', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)

      const runButton = page.locator('[data-testid="run-button"]')
      await runButton.click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })

      const status = await statusIndicator.getAttribute('data-status')
      if (status !== 'passed') {
        const logEntries = await getLogLines(page)
        console.log('=== WORKFLOW FAILED ===')
        console.log('Error/warn logs:', JSON.stringify(
          logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]')),
          null, 2
        ))
      }
      expect(status).toBe('passed')
    })

    // ================================================================
    // STEP 3: Verify literal variables
    // ================================================================
    await test.step('Verify literal variable values in console', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(logTexts.some((t) => t === 'hello world'), `Expected "hello world"\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === '42'), `Expected "42"\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === '3.14'), `Expected "3.14"\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'True'), `Expected "True"\n${allLogText}`).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Verify expression variables
    // ================================================================
    await test.step('Verify expression variable values in console', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(logTexts.some((t) => t === '42 is the answer'), `Expected "42 is the answer"\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === '50'), `Expected "50"\n${allLogText}`).toBeTruthy()
    })

    // ================================================================
    // STEP 5: Verify multi-assign proof
    // ================================================================
    await test.step('Verify all variables accessible in downstream expression', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(
        logTexts.some((t) => t === 'hello world|42|3.14|True|42 is the answer|50'),
        `Expected multi-assign proof string\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 6: VarSetter in loop body
    // Counter accumulates 1, 2, 3, 4, 5
    // ================================================================
    await test.step('VarSetter in For loop body: counter accumulates 1..5', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(logTexts.some((t) => t === 'loop-counter=1'), `Missing 'loop-counter=1'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'loop-counter=2'), `Missing 'loop-counter=2'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'loop-counter=3'), `Missing 'loop-counter=3'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'loop-counter=4'), `Missing 'loop-counter=4'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'loop-counter=5'), `Missing 'loop-counter=5'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'loop-counter=6'), 'loop-counter=6 should NOT exist').toBeFalsy()
    })

    // ================================================================
    // STEP 7: VarSetter in nested loops
    // Outer(3) x Inner(2) = 6 total increments to nested_sum
    // Inner Log fires on first outer iteration (nested=1,2).
    // VarSetter accumulates across all 6 inner iterations - verified via final summary.
    // ================================================================
    await test.step('VarSetter in nested For loops: inner body executes and accumulates', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // First outer iteration's inner iterations log correctly
      expect(logTexts.some((t) => t === 'nested=1'), `Missing 'nested=1'\n${allLogText}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'nested=2'), `Missing 'nested=2'\n${allLogText}`).toBeTruthy()
    })

    // ================================================================
    // STEP 8: VarSetter in try-catch try path
    // try_val = counter(5) + nested_sum(6) = 11
    // ================================================================
    await test.step('VarSetter in try-catch: try_val = counter + nested_sum = 11', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(
        logTexts.some((t) => t === 'try-val=11'),
        `Expected 'try-val=11'\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 9: Final summary - all accumulated values correct
    // ================================================================
    await test.step('Final summary: counter=5, nested_sum=6, try_val=11', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      expect(
        logTexts.some((t) => t === 'final:counter=5,nested_sum=6,try_val=11'),
        `Expected final summary\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 10: All nodes show success status
    // ================================================================
    await test.step('Verify all nodes show success status', async () => {
      for (const name of ALL_NODE_NAMES) {
        const testId = nodeIds.get(name)!
        const node = page.locator(`[data-testid="${testId}"]`)
        await expect(node).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
    })
  })
})
