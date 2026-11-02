/**
 * Assert Control End-to-End Execution Test
 *
 * Imports a pre-built workflow fixture with 44 nodes (1 VarSetter + 20 Assert + 23 Log),
 * then runs it to exercise all assertion types, operators, grouping, precedence, and
 * branching modes.
 *
 * Workflow structure:
 *   Start -> VarSetter (sets str, int, float, bool, array, map variables)
 *     -> Assert: Single Pass (str equals AND int equals) -> Log
 *     -> Assert: Single Fail Continue (int equals 999 - FAILS, continues) -> Log
 *     -> Assert: String Operators (contains AND starts_with AND ends_with AND does_not_contain) -> Log
 *     -> Assert: Regex Match (matches_regex) -> Log
 *     -> Assert: Numeric Comparisons (greater_than AND less_than AND >= AND <= AND not_equals) -> Log
 *     -> Assert: Boolean Check (is_true) -> Log
 *     -> Assert: Array Operators (contains AND is_not_empty AND length_equals) -> Log
 *     -> Assert: Map Operators (has_key AND is_not_empty) -> Log
 *     -> Assert: Expression (Python expression) -> Log
 *     -> Assert: Group OR (group with OR inside AND outer) -> Log
 *     -> Assert: Ref Expression (reference_is_expression=true) -> Log
 *     -> Assert: Precedence AND before OR (false OR true AND true = true) -> Log
 *     -> Assert: Precedence OR before AND (true AND false OR true = true) -> Log
 *     -> Assert: All AND Fails (true AND false = false, continues) -> Log
 *     -> Assert: All OR Fails (false OR false = false, continues) -> Log
 *     -> Assert: Group Overrides Precedence ((false OR true) AND true = true) -> Log
 *     -> Assert: Mixed Multi-Segment (false AND true OR true AND true = true) -> Log
 *     -> Assert: Split with Precedence (false OR true = true, split mode)
 *         pass -> Log "split-prec-pass-branch"
 *         fail -> Log "split-prec-fail-unreachable" (should NOT execute)
 *     -> Assert: Split Pass (split mode, passes)
 *         pass -> Log "split-pass-branch"
 *         fail -> Log "split-pass-unreachable" (should NOT execute)
 *     -> Assert: Split Fail (split mode, int equals 999 - FAILS)
 *         pass -> Log "split-fail-unreachable" (should NOT execute)
 *         fail -> Log "split-fail-branch"
 *
 * Coverage:
 *   - All 6 variable types (string, integer, float, boolean, array, map)
 *   - All comparison operators per type
 *   - Literal assertions with static and expression reference values
 *   - Expression assertions (Python boolean expressions)
 *   - Group assertions with OR logic (interleaved operator format)
 *   - AND/OR precedence: AND binds tighter than OR
 *   - Group overriding precedence: parenthesized OR evaluates first
 *   - Multi-segment mixed AND/OR expressions
 *   - Single mode: pass continues, fail continues
 *   - Split mode: pass branch taken, fail branch taken
 *   - Split mode with precedence: OR expression in split mode
 *   - Branching engine: sourceHandle-aware edge routing
 *
 * Run manually with: ./scripts/e2e-targeted-local.sh functional/assert-control/v-ctrl-assert-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines, getLogEntries } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, any> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Node name mapping
// ---------------------------------------------------------------------------

type NodeName =
  | 'VARSET_INIT'
  | 'ASSERT_SINGLE_PASS' | 'LOG_SINGLE_PASS'
  | 'ASSERT_SINGLE_FAIL' | 'LOG_SINGLE_FAIL'
  | 'ASSERT_STRING_OPS' | 'LOG_STRING_OPS'
  | 'ASSERT_REGEX' | 'LOG_REGEX'
  | 'ASSERT_NUMERIC' | 'LOG_NUMERIC'
  | 'ASSERT_BOOLEAN' | 'LOG_BOOLEAN'
  | 'ASSERT_ARRAY' | 'LOG_ARRAY'
  | 'ASSERT_MAP' | 'LOG_MAP'
  | 'ASSERT_EXPRESSION' | 'LOG_EXPRESSION'
  | 'ASSERT_GROUP_OR' | 'LOG_GROUP_OR'
  | 'ASSERT_REF_EXPR' | 'LOG_REF_EXPR'
  | 'ASSERT_PRECEDENCE_AND_OR' | 'LOG_PRECEDENCE_AND_OR'
  | 'ASSERT_PRECEDENCE_OR_BEFORE_AND' | 'LOG_PRECEDENCE_OR_BEFORE_AND'
  | 'ASSERT_ALL_AND_FAIL' | 'LOG_ALL_AND_FAIL'
  | 'ASSERT_ALL_OR_FAIL' | 'LOG_ALL_OR_FAIL'
  | 'ASSERT_GROUP_OVERRIDE' | 'LOG_GROUP_OVERRIDE'
  | 'ASSERT_MULTI_SEGMENT' | 'LOG_MULTI_SEGMENT'
  | 'ASSERT_SPLIT_PRECEDENCE' | 'LOG_SPLIT_PREC_PASS' | 'LOG_SPLIT_PREC_FAIL_UNREACHABLE'
  | 'ASSERT_SPLIT_PASS' | 'LOG_SPLIT_PASS_BRANCH' | 'LOG_SPLIT_PASS_UNREACHABLE'
  | 'ASSERT_SPLIT_FAIL' | 'LOG_SPLIT_FAIL_BRANCH' | 'LOG_SPLIT_FAIL_UNREACHABLE'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Set Test Variables': 'VARSET_INIT',
  'Single All Pass': 'ASSERT_SINGLE_PASS',
  'Log Single Pass': 'LOG_SINGLE_PASS',
  'Single Fail Continue': 'ASSERT_SINGLE_FAIL',
  'Log Single Fail Continued': 'LOG_SINGLE_FAIL',
  'String Operators': 'ASSERT_STRING_OPS',
  'Log String Ops': 'LOG_STRING_OPS',
  'Regex Match': 'ASSERT_REGEX',
  'Log Regex': 'LOG_REGEX',
  'Numeric Comparisons': 'ASSERT_NUMERIC',
  'Log Numeric': 'LOG_NUMERIC',
  'Boolean Check': 'ASSERT_BOOLEAN',
  'Log Boolean': 'LOG_BOOLEAN',
  'Array Operators': 'ASSERT_ARRAY',
  'Log Array': 'LOG_ARRAY',
  'Map Operators': 'ASSERT_MAP',
  'Log Map': 'LOG_MAP',
  'Expression Assert': 'ASSERT_EXPRESSION',
  'Log Expression': 'LOG_EXPRESSION',
  'Group OR Logic': 'ASSERT_GROUP_OR',
  'Log Group OR': 'LOG_GROUP_OR',
  'Ref Expression': 'ASSERT_REF_EXPR',
  'Log Ref Expression': 'LOG_REF_EXPR',
  'Precedence AND before OR': 'ASSERT_PRECEDENCE_AND_OR',
  'Log Precedence AND OR': 'LOG_PRECEDENCE_AND_OR',
  'Precedence OR before AND': 'ASSERT_PRECEDENCE_OR_BEFORE_AND',
  'Log Precedence OR before AND': 'LOG_PRECEDENCE_OR_BEFORE_AND',
  'All AND Fails': 'ASSERT_ALL_AND_FAIL',
  'Log All AND Fail': 'LOG_ALL_AND_FAIL',
  'All OR Fails': 'ASSERT_ALL_OR_FAIL',
  'Log All OR Fail': 'LOG_ALL_OR_FAIL',
  'Group Overrides Precedence': 'ASSERT_GROUP_OVERRIDE',
  'Log Group Override': 'LOG_GROUP_OVERRIDE',
  'Mixed Multi-Segment': 'ASSERT_MULTI_SEGMENT',
  'Log Multi-Segment': 'LOG_MULTI_SEGMENT',
  'Split with Precedence': 'ASSERT_SPLIT_PRECEDENCE',
  'Log Split Prec Pass': 'LOG_SPLIT_PREC_PASS',
  'Log Split Prec Fail Unreachable': 'LOG_SPLIT_PREC_FAIL_UNREACHABLE',
  'Split Pass': 'ASSERT_SPLIT_PASS',
  'Log Split Pass Branch': 'LOG_SPLIT_PASS_BRANCH',
  'Log Split Pass Unreachable': 'LOG_SPLIT_PASS_UNREACHABLE',
  'Split Fail': 'ASSERT_SPLIT_FAIL',
  'Log Split Fail Branch': 'LOG_SPLIT_FAIL_BRANCH',
  'Log Split Fail Unreachable': 'LOG_SPLIT_FAIL_UNREACHABLE',
}

// Nodes that should execute successfully (green/success)
const EXECUTED_NAMES: NodeName[] = [
  'VARSET_INIT',
  'ASSERT_SINGLE_PASS', 'LOG_SINGLE_PASS',
  'LOG_SINGLE_FAIL',
  'ASSERT_STRING_OPS', 'LOG_STRING_OPS',
  'ASSERT_REGEX', 'LOG_REGEX',
  'ASSERT_NUMERIC', 'LOG_NUMERIC',
  'ASSERT_BOOLEAN', 'LOG_BOOLEAN',
  'ASSERT_ARRAY', 'LOG_ARRAY',
  'ASSERT_MAP', 'LOG_MAP',
  'ASSERT_EXPRESSION', 'LOG_EXPRESSION',
  'ASSERT_GROUP_OR', 'LOG_GROUP_OR',
  'ASSERT_REF_EXPR', 'LOG_REF_EXPR',
  'ASSERT_PRECEDENCE_AND_OR', 'LOG_PRECEDENCE_AND_OR',
  'ASSERT_PRECEDENCE_OR_BEFORE_AND', 'LOG_PRECEDENCE_OR_BEFORE_AND',
  'LOG_ALL_AND_FAIL',
  'LOG_ALL_OR_FAIL',
  'ASSERT_GROUP_OVERRIDE', 'LOG_GROUP_OVERRIDE',
  'ASSERT_MULTI_SEGMENT', 'LOG_MULTI_SEGMENT',
  'ASSERT_SPLIT_PRECEDENCE', 'LOG_SPLIT_PREC_PASS',
  'ASSERT_SPLIT_PASS', 'LOG_SPLIT_PASS_BRANCH',
  'LOG_SPLIT_FAIL_BRANCH',
]

// Assert nodes that fail without fail_current_scope - show amber/warning status
const WARNING_NAMES: NodeName[] = [
  'ASSERT_SINGLE_FAIL',
  'ASSERT_ALL_AND_FAIL',
  'ASSERT_ALL_OR_FAIL',
  'ASSERT_SPLIT_FAIL',
]

// Nodes that should NOT execute (wrong branch in split mode)
const UNREACHABLE_NAMES: NodeName[] = [
  'LOG_SPLIT_PREC_FAIL_UNREACHABLE',
  'LOG_SPLIT_PASS_UNREACHABLE',
  'LOG_SPLIT_FAIL_UNREACHABLE',
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

function buildNodeIds(fixture: Record<string, any>): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  for (const node of fixture.workflow.nodes) {
    const displayName = node.data?.description
    const nodeName = DESCRIPTION_TO_NODE[displayName]
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Assert Control E2E Execution', () => {
  test('Import fixture, run workflow, verify all assertion types and branching', async ({ page }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)

    // Verify all nodes mapped correctly
    const allNames = [...EXECUTED_NAMES, ...UNREACHABLE_NAMES]
    for (const name of allNames) {
      expect(nodeIds.has(name), `Node "${name}" not found in fixture`).toBeTruthy()
    }

    // ================================================================
    // STEP 1: Import test via API
    // ================================================================
    await test.step('Import test via API', async () => {
      // Clear any existing session
      await page.request
        .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
        .catch(() => {})

      // Ensure shared environment exists
      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests`,
        { data: fixture }
      )
      expect(
        createResponse.ok(),
        `POST /tests failed: ${createResponse.status()}`
      ).toBeTruthy()

      const created = await createResponse.json()
      const testId = created.data?.id || created.id

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    // ================================================================
    // STEP 2: Run workflow
    // ================================================================
    await test.step('Run workflow', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)

      const runButton = page.locator('[data-testid="run-button"]')
      await runButton.click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')

      // Wait for execution to start
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

      // Wait for execution to finish (passed or failed)
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
        timeout: 10_000,
      })

      // Diagnostic: dump state if not passed
      const status = await statusIndicator.getAttribute('data-status')
      if (status !== 'passed') {
        const nodeStatuses = await page.evaluate(() => {
          const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
          return Array.from(nodes).map((n) => ({
            testId: n.getAttribute('data-testid'),
            status: n.getAttribute('data-execution-status'),
            name: n.querySelector('[class*="description"], [class*="name"]')?.textContent
              || n.textContent?.substring(0, 80),
          }))
        })
        const failedNodes = nodeStatuses.filter((n) => n.status === 'failed')
        const logEntries: string[] = await getLogLines(page)
        const errorLogs = logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'))
        test.info().annotations.push({ type: 'workflow-status', description: String(status) })
        test.info().annotations.push({ type: 'failed-nodes', description: JSON.stringify(failedNodes) })
        test.info().annotations.push({ type: 'error-logs', description: JSON.stringify(errorLogs) })
      }

      // Workflow should pass overall (single-fail-continue is handled, not a crash)
      expect(status).toBe('passed')
    })

    // ================================================================
    // Diagnostic: Log actual assert results for debugging
    // ================================================================
    const allEntries = await getLogEntries(page)
    const assertResults: Record<string, unknown> = {}
    for (const entry of allEntries) {
      if (
        entry.message.includes('All assertions passed') ||
        entry.message.includes('Assertion failed')
      ) {
        assertResults[entry.source || 'unknown'] = entry.message.includes('All assertions passed')
      }
    }
    for (const [source, passed] of Object.entries(assertResults)) {
      test.info().annotations.push({ type: 'assert-result', description: `${source}: passed=${passed}` })
    }

    // ================================================================
    // STEP 3: Verify console output
    // ================================================================
    await test.step('Verify console log messages from Log nodes', async () => {
      const logTexts: string[] = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // --- Single mode pass ---
      expect(
        logTexts.some((t) => t.includes('single-pass-ok')),
        `Expected "single-pass-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Single mode fail continues ---
      expect(
        logTexts.some((t) => t.includes('single-fail-continued')),
        `Expected "single-fail-continued" in logs (proves single mode continues on fail). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- String operators ---
      expect(
        logTexts.some((t) => t.includes('string-ops-ok')),
        `Expected "string-ops-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Regex match ---
      expect(
        logTexts.some((t) => t.includes('regex-ok')),
        `Expected "regex-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Numeric comparisons ---
      expect(
        logTexts.some((t) => t.includes('numeric-ok')),
        `Expected "numeric-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Boolean check ---
      expect(
        logTexts.some((t) => t.includes('boolean-ok')),
        `Expected "boolean-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Array operators ---
      expect(
        logTexts.some((t) => t.includes('array-ok')),
        `Expected "array-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Map operators ---
      expect(
        logTexts.some((t) => t.includes('map-ok')),
        `Expected "map-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Expression assertion ---
      expect(
        logTexts.some((t) => t.includes('expression-ok')),
        `Expected "expression-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Group OR logic ---
      expect(
        logTexts.some((t) => t.includes('group-or-ok')),
        `Expected "group-or-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Reference expression ---
      expect(
        logTexts.some((t) => t.includes('ref-expr-ok')),
        `Expected "ref-expr-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Precedence: AND before OR (false OR (true AND true) = true) ---
      expect(
        logTexts.some((t) => t.includes('precedence-and-or-ok')),
        `Expected "precedence-and-or-ok" in logs (proves AND binds tighter than OR). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Precedence: OR before AND ((true AND false) OR true = true) ---
      expect(
        logTexts.some((t) => t.includes('precedence-or-before-and-ok')),
        `Expected "precedence-or-before-and-ok" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- All AND fails (true AND false = false, continues in single mode) ---
      expect(
        logTexts.some((t) => t.includes('all-and-fail-continued')),
        `Expected "all-and-fail-continued" in logs (proves AND fail continues in single mode). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- All OR fails (false OR false = false, continues in single mode) ---
      expect(
        logTexts.some((t) => t.includes('all-or-fail-continued')),
        `Expected "all-or-fail-continued" in logs (proves OR fail continues in single mode). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Group overrides precedence ((false OR true) AND true = true) ---
      expect(
        logTexts.some((t) => t.includes('group-override-ok')),
        `Expected "group-override-ok" in logs (proves group overrides precedence). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Mixed multi-segment ((false AND true) OR (true AND true) = true) ---
      expect(
        logTexts.some((t) => t.includes('multi-segment-ok')),
        `Expected "multi-segment-ok" in logs (proves multi-segment AND/OR). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Split with precedence (false OR true = true, pass branch taken) ---
      expect(
        logTexts.some((t) => t.includes('split-prec-pass-branch')),
        `Expected "split-prec-pass-branch" in logs (proves split + precedence). Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Split precedence fail branch should NOT appear ---
      expect(
        logTexts.some((t) => t.includes('split-prec-fail-unreachable')),
        'Split precedence fail branch should NOT have logged'
      ).toBeFalsy()

      // --- Split mode: pass branch taken ---
      expect(
        logTexts.some((t) => t.includes('split-pass-branch')),
        `Expected "split-pass-branch" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Split mode: fail branch taken ---
      expect(
        logTexts.some((t) => t.includes('split-fail-branch')),
        `Expected "split-fail-branch" in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      // --- Unreachable branches should NOT appear ---
      expect(
        logTexts.some((t) => t.includes('split-pass-unreachable')),
        'Unreachable pass branch should NOT have logged'
      ).toBeFalsy()

      expect(
        logTexts.some((t) => t.includes('split-fail-unreachable')),
        'Unreachable fail branch should NOT have logged'
      ).toBeFalsy()

      // --- Assert pass/fail INFO/WARN messages ---
      expect(
        logTexts.some((t) => t.includes('All assertions passed')),
        `Expected "All assertions passed" from passing asserts. Got:\n${allLogText}`
      ).toBeTruthy()

      expect(
        logTexts.some((t) => t.includes('Assertion failed')),
        `Expected "Assertion failed" from failing asserts. Got:\n${allLogText}`
      ).toBeTruthy()
    })

    // ================================================================
    // STEP 4: Verify node execution statuses
    // ================================================================
    await test.step('Verify node execution statuses', async () => {
      // All executed nodes should show "success" status (green)
      for (const name of EXECUTED_NAMES) {
        const testId = nodeIds.get(name)!
        const node = page.locator(`[data-testid="${testId}"]`)
        await expect(
          node,
          `Node "${name}" should have execution status "success"`
        ).toHaveAttribute('data-execution-status', 'success')
      }

      // Failing assert nodes without fail_current_scope show "warning" status (amber)
      for (const name of WARNING_NAMES) {
        const testId = nodeIds.get(name)!
        const node = page.locator(`[data-testid="${testId}"]`)
        await expect(
          node,
          `Node "${name}" should have execution status "warning" (informational assert failure)`
        ).toHaveAttribute('data-execution-status', 'warning')
        const badge = node.locator('[data-testid="node-run-state-badge"]')
        await expect(
          badge,
          `Node "${name}" should carry the WARN badge alongside the amber border`
        ).toHaveText('WARN')
      }

      // Unreachable nodes should NOT have "success" status
      // They were never executed, so they should have no execution status
      for (const name of UNREACHABLE_NAMES) {
        const testId = nodeIds.get(name)!
        const node = page.locator(`[data-testid="${testId}"]`)
        const status = await node.getAttribute('data-execution-status')
        expect(
          status,
          `Node "${name}" should NOT have been executed (got status "${status}")`
        ).not.toBe('success')
      }
    })
  })
})
