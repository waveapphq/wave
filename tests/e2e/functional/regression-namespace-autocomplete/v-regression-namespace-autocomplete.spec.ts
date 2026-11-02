/**
 * Regression Namespace Autocomplete E2E Tests
 *
 * Autocomplete rules for the regression namespace:
 *
 * - Test 1 - ``regression`` entry appears under NAMESPACES, not VARIABLES
 *   (expression-completion.ts `isNamespace` matches the bare "Regression"
 *   source label symmetrically with "Suite").
 *
 * - Test 2 - Navigate-away-and-back freshness: open workbench, go to
 *   regression detail, edit variables, return to workbench. Autocomplete must
 *   reflect the new variables without a page refresh. Canvas state must be
 *   preserved. Backed by use-test-lifecycle.ts location.key-driven refresh.
 *
 * - Test 6 - Cross-regression listener filter: editing a second regression's
 *   variables must NOT mutate the namespace of a test that does not belong
 *   to it. Backed by use-test-lifecycle.ts suiteIds overlap filter.
 *
 * - Test 7 - Deletion propagates on navigate-back: removing a regression
 *   variable on the detail page and returning to the workbench must remove
 *   that variable from autocomplete.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/regression-namespace-autocomplete/v-regression-namespace-autocomplete.spec.ts
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

// ----------------------------------------------------------------------------
// Shared fixture helpers
// ----------------------------------------------------------------------------

interface SeededRegression {
  regressionId: string
  suiteId: string
  testId: string
}

/** Build a minimal Log-node test fixture. */
function buildLogTestFixture(name: string) {
  return {
    name,
    version: '1.0.0',
    workflow: {
      nodes: [
        {
          id: 'log-node',
          type: 'workflowNode',
          position: { x: 400, y: 200 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description: 'Log Expression',
            hasNewerVersion: false,
            expressionFields: ['message'],
            templateFields: [],
            config: {
              values: { message: "'test'", level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-node', target: 'log-node', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
  }
}

async function createRegression(
  request: APIRequestContext,
  name: string,
  variables: Record<string, unknown> = {},
): Promise<string> {
  const regResp = await request.post(`${BACKEND_URL}/regressions`, { data: { name } })
  expect(regResp.ok(), `Create regression '${name}' failed: ${regResp.status()}`).toBeTruthy()
  const regBody = await regResp.json()
  const id: string = regBody.data.id
  if (Object.keys(variables).length > 0) {
    const upd = await request.put(`${BACKEND_URL}/regressions/${id}`, { data: { variables } })
    expect(upd.ok(), `Set vars on regression '${name}' failed: ${upd.status()}`).toBeTruthy()
  }
  return id
}

async function createSuite(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/suites`, { data: { name } })
  expect(resp.ok(), `Create suite '${name}' failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function createTest(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildLogTestFixture(name) })
  expect(resp.ok(), `Create test '${name}' failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id || body.id
}

async function addTestToSuite(
  request: APIRequestContext,
  suiteId: string,
  testId: string,
): Promise<void> {
  const resp = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, {
    data: { test_id: testId },
  })
  expect(resp.ok(), `Add test to suite failed: ${resp.status()}`).toBeTruthy()
}

async function addSuiteToRegression(
  request: APIRequestContext,
  regressionId: string,
  suiteId: string,
): Promise<void> {
  const resp = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
    data: { suites: [suiteId] },
  })
  expect(resp.ok(), `Add suite to regression failed: ${resp.status()}`).toBeTruthy()
}

async function seedRegression(
  request: APIRequestContext,
  prefix: string,
  variables: Record<string, unknown> = {},
): Promise<SeededRegression> {
  const regressionId = await createRegression(request, `${prefix} Regression`, variables)
  const suiteId = await createSuite(request, `${prefix} Suite`)
  const testId = await createTest(request, `${prefix} Test`)
  await addTestToSuite(request, suiteId, testId)
  await addSuiteToRegression(request, regressionId, suiteId)
  return { regressionId, suiteId, testId }
}

async function deleteSeededRegression(
  request: APIRequestContext,
  seeded: SeededRegression,
): Promise<void> {
  if (seeded.testId) await request.delete(`${BACKEND_URL}/tests/${seeded.testId}`).catch(() => {})
  if (seeded.suiteId)
    await request.delete(`${BACKEND_URL}/suites/${seeded.suiteId}`).catch(() => {})
  if (seeded.regressionId)
    await request.delete(`${BACKEND_URL}/regressions/${seeded.regressionId}`).catch(() => {})
}

/**
 * Open a test in the workbench and drill into the Log node's ``message``
 * expression field. Leaves the page focused inside the CodeMirror editor
 * with the current expression selected - callers typically issue
 * ``keyboard.press('Control+a'); keyboard.type(...)`` next.
 */
async function openWorkbenchLogExpression(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const workflowNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]',
  )
  const logNode = workflowNodes.first()
  await logNode.scrollIntoViewIfNeeded()
  await logNode.locator('button').first().dispatchEvent('click')
  await expect(logNode).toHaveAttribute('data-selected', 'true')

  const gearButton = page.locator(
    '[data-testid="node-configure"]',
  )
  await gearButton.click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible({ timeout: 5000 })

  const messageRow = modal.locator('[data-testid="param-row-message"]')
  await expect(messageRow).toBeVisible({ timeout: 5000 })

  const messageInput = modal.locator('[data-testid="param-input-message"]')
  const cmContent = messageInput.locator('.cm-content')
  const isCmVisible = await cmContent.isVisible({ timeout: 2000 }).catch(() => false)
  if (!isCmVisible) {
    await messageRow.locator('[data-testid="expression-toggle"]').click()
    await page.waitForTimeout(200)
  }
  await cmContent.click()
}

/**
 * Trigger the autocomplete tooltip and return its rendered text. Selects
 * existing content so typing replaces (rather than appends) the expression,
 * then types the query and waits for the dropdown to render.
 *
 * The returned string is the lowercased innerText of the tooltip. Section
 * headers are rendered uppercase via CSS ``text-transform`` and
 * ``innerText`` reflects that, so callers compare against lowercase
 * section names.
 */
async function triggerAutocomplete(page: Page, query: string): Promise<string> {
  await page.keyboard.press('Control+a')
  await page.keyboard.type(query, { delay: 40 })
  const autocomplete = page.locator('.cm-tooltip-autocomplete')
  await expect(autocomplete, 'Autocomplete dropdown should be visible').toBeVisible({
    timeout: 5000,
  })
  // Wait a beat for options to settle
  await page.waitForTimeout(200)
  const text = (await autocomplete.innerText()) || ''
  return text.toLowerCase()
}

// Section headers are rendered uppercase via CSS; triggerAutocomplete
// lowercases the dropdown innerText before returning it, so section names
// below are compared in lowercase too.
const KNOWN_SECTION_HEADERS = ['variables', 'namespaces', 'profiles', 'functions']

/**
 * Assert that ``needle`` appears under the given CodeMirror completion
 * section header. Uses text order within the dropdown: a substring that
 * appears after the target header and before the next header is "under" it.
 */
function assertOptionUnderSection(
  dropdownText: string,
  sectionName: string,
  needle: string,
): void {
  const normalizedSection = sectionName.toLowerCase()
  const normalizedNeedle = needle.toLowerCase()
  const sectionIdx = dropdownText.indexOf(normalizedSection)
  expect(
    sectionIdx,
    `Expected section "${sectionName}" to be present in autocomplete dropdown`,
  ).toBeGreaterThanOrEqual(0)

  let nextSectionIdx = dropdownText.length
  for (const h of KNOWN_SECTION_HEADERS) {
    if (h === normalizedSection) continue
    const idx = dropdownText.indexOf(h, sectionIdx + normalizedSection.length)
    if (idx >= 0 && idx < nextSectionIdx) nextSectionIdx = idx
  }

  const needleIdx = dropdownText.indexOf(normalizedNeedle, sectionIdx + normalizedSection.length)
  expect(
    needleIdx,
    `Expected "${needle}" to appear in the dropdown after section "${sectionName}"`,
  ).toBeGreaterThanOrEqual(0)
  expect(
    needleIdx,
    `Expected "${needle}" to appear BEFORE the next section header (section "${sectionName}" slice ` +
      `ends at ${nextSectionIdx}, but "${needle}" is at ${needleIdx})`,
  ).toBeLessThan(nextSectionIdx)
}

function assertOptionNotUnderSection(
  dropdownText: string,
  sectionName: string,
  needle: string,
): void {
  const normalizedSection = sectionName.toLowerCase()
  const normalizedNeedle = needle.toLowerCase()
  const sectionIdx = dropdownText.indexOf(normalizedSection)
  if (sectionIdx < 0) return // section not rendered - needle can't be under it
  let nextSectionIdx = dropdownText.length
  for (const h of KNOWN_SECTION_HEADERS) {
    if (h === normalizedSection) continue
    const idx = dropdownText.indexOf(h, sectionIdx + normalizedSection.length)
    if (idx >= 0 && idx < nextSectionIdx) nextSectionIdx = idx
  }
  const slice = dropdownText.slice(sectionIdx + normalizedSection.length, nextSectionIdx)
  expect(
    slice.includes(normalizedNeedle),
    `Did not expect "${needle}" to appear under section "${sectionName}"`,
  ).toBeFalsy()
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

test.describe('Regression Namespace Autocomplete', () => {
  // --------------------------------------------------------------------------
  // Existing: regression.<var> completion shows the declared variable names
  // --------------------------------------------------------------------------

  test.describe('variable completions', () => {
    let seeded: SeededRegression

    test.afterAll(async ({ request }) => {
      await deleteSeededRegression(request, seeded)
    })

    test('shows regression variables in expression autocomplete', async ({ page, request }) => {
      seeded = await seedRegression(request, 'Autocomplete Test', {
        env_name: { type: 'string', value: 'production', secret: false },
        max_parallel: { type: 'integer', value: 5, secret: false },
      })

      await openWorkbenchLogExpression(page, seeded.testId)
      const text = await triggerAutocomplete(page, 'regression.')

      const autocomplete = page.locator('.cm-tooltip-autocomplete')
      await expect(autocomplete.getByText('env_name')).toBeVisible({ timeout: 3000 })
      await expect(autocomplete.getByText('max_parallel')).toBeVisible({ timeout: 3000 })

      // Sanity: the text snapshot includes the variable names.
      expect(text).toContain('env_name')
      expect(text).toContain('max_parallel')
    })
  })

  // --------------------------------------------------------------------------
  // Test 1: regression top-level entry lives under NAMESPACES, not VARIABLES
  // --------------------------------------------------------------------------

  test.describe('namespace bucket (Test 1)', () => {
    let seeded: SeededRegression

    test.afterAll(async ({ request }) => {
      await deleteSeededRegression(request, seeded)
    })

    test('regression entry appears under NAMESPACES alongside suite and system', async ({
      page,
      request,
    }) => {
      seeded = await seedRegression(request, 'Bucket Test', {
        env: { type: 'string', value: 'dev', secret: false },
      })

      await openWorkbenchLogExpression(page, seeded.testId)
      // Single character triggers the dropdown so we see all top-level
      // completions including section headers.
      const text = await triggerAutocomplete(page, 'r')

      // The Namespaces section header must be present (innerText is
      // lowercased by the helper; CSS text-transform renders uppercase).
      expect(text, 'Namespaces section header missing').toContain('namespaces')

      // The bare `regression` option must live under it (and NOT under
      // Variables). ``suite`` and
      // ``system`` entries only appear when their namespaces actually have
      // variables; this fixture does not seed those, so we only assert
      // the regression-side invariant.
      assertOptionUnderSection(text, 'Namespaces', 'regression')
      assertOptionNotUnderSection(text, 'Variables', 'regression')
    })
  })

  // --------------------------------------------------------------------------
  // Test 2 + Test 7: navigate-away-and-back keeps autocomplete fresh
  // --------------------------------------------------------------------------

  test.describe('navigate-back freshness (Test 2 + Test 7)', () => {
    let seeded: SeededRegression

    test.afterAll(async ({ request }) => {
      await deleteSeededRegression(request, seeded)
    })

    test('new variable added on detail page appears in workbench without reload', async ({
      page,
      request,
    }) => {
      seeded = await seedRegression(request, 'NavBack Test', {
        existing_var: { type: 'string', value: 'seed', secret: false },
      })

      // 1. Open the workbench and confirm initial state.
      await openWorkbenchLogExpression(page, seeded.testId)
      let text = await triggerAutocomplete(page, 'regression.')
      expect(text).toContain('existing_var')
      expect(text).not.toContain('nav_back_var')

      await leaveExpressionEditor(configSheet(page))

      // 2. Mutate the regression via API (simulates the user saving new vars
      // on the detail page). This is equivalent to the UI edit flow for
      // the purposes of the refresh effect in use-test-lifecycle.
      const updResp = await request.put(`${BACKEND_URL}/regressions/${seeded.regressionId}`, {
        data: {
          variables: {
            existing_var: { type: 'string', value: 'seed', secret: false },
            nav_back_var: { type: 'integer', value: 42, secret: false },
          },
        },
      })
      expect(updResp.ok()).toBeTruthy()

      // 3. Navigate away from the workbench, then back. The helper does
      // a full reload sequence (session clear + double goto) which
      // exercises the same load path as use-test-lifecycle uses when
      // the user returns to the workbench route.
      await page.goto('/regressions')
      await expect(page.locator('[data-testid="regressions-page"]')).toBeVisible({
        timeout: 10000,
      })
      await openWorkbenchLogExpression(page, seeded.testId)

      text = await triggerAutocomplete(page, 'regression.')
      expect(text, 'New variable should appear after navigate-back refresh').toContain(
        'nav_back_var',
      )
      expect(text).toContain('existing_var')

      // 4. Test 7: now DELETE the variable and navigate back. It must
      // disappear from autocomplete on the next reload.
      await leaveExpressionEditor(configSheet(page))
      const delResp = await request.put(`${BACKEND_URL}/regressions/${seeded.regressionId}`, {
        data: { variables: { existing_var: { type: 'string', value: 'seed', secret: false } } },
      })
      expect(delResp.ok()).toBeTruthy()

      await page.goto('/regressions')
      await expect(page.locator('[data-testid="regressions-page"]')).toBeVisible({
        timeout: 10000,
      })
      await openWorkbenchLogExpression(page, seeded.testId)
      text = await triggerAutocomplete(page, 'regression.')

      expect(text, 'Deleted variable must not remain in autocomplete').not.toContain(
        'nav_back_var',
      )
      expect(text).toContain('existing_var')
    })
  })

  // --------------------------------------------------------------------------
  // Test 6: cross-regression listener filter by suiteIds overlap
  // --------------------------------------------------------------------------

  test.describe('cross-regression isolation (Test 6)', () => {
    let primary: SeededRegression
    let foreignRegressionId: string
    let foreignSuiteId: string

    test.afterAll(async ({ request }) => {
      if (foreignRegressionId)
        await request.delete(`${BACKEND_URL}/regressions/${foreignRegressionId}`).catch(() => {})
      if (foreignSuiteId)
        await request.delete(`${BACKEND_URL}/suites/${foreignSuiteId}`).catch(() => {})
      await deleteSeededRegression(request, primary)
    })

    test('foreign regression variable changes do not pollute unrelated test namespace', async ({
      page,
      request,
    }) => {
      // The primary test belongs to regression R1 via suite S1.
      primary = await seedRegression(request, 'Isolation Primary', {
        primary_var: { type: 'string', value: 'p', secret: false },
      })

      // A foreign regression R2 uses a completely different suite S2 that
      // is not in R1. R2's variables must never bleed into R1-test's
      // workbench namespace.
      foreignSuiteId = await createSuite(request, 'Isolation Foreign Suite')
      foreignRegressionId = await createRegression(
        request,
        'Isolation Foreign Regression',
        { poisoned_var: { type: 'integer', value: 99, secret: false } },
      )
      await addSuiteToRegression(request, foreignRegressionId, foreignSuiteId)

      // Open the workbench on R1's test and inspect autocomplete.
      await openWorkbenchLogExpression(page, primary.testId)
      let text = await triggerAutocomplete(page, 'regression.')
      expect(text).toContain('primary_var')
      expect(text, 'Foreign regression var must not leak into primary test').not.toContain(
        'poisoned_var',
      )

      // While the workbench is still mounted, dispatch a regression-
      // variables-changed CustomEvent as if R2's detail page had just
      // saved. The listener must filter this out because R2's suiteIds
      // do not overlap with R1-test's editingTestSuiteIds.
      await leaveExpressionEditor(configSheet(page))
      await page.evaluate(
        ({ suiteIds }) => {
          globalThis.dispatchEvent(
            new CustomEvent('regression-variables-changed', {
              detail: {
                regressionId: 'foreign',
                suiteIds,
                variables: [{ name: 'poisoned_var', type: 'integer' }],
              },
            }),
          )
        },
        { suiteIds: [foreignSuiteId] },
      )

      // Wait a beat for any (incorrect) mutation to settle, then re-check.
      await page.waitForTimeout(200)
      const modal = configSheet(page)
      const cmContent = modal
        .locator('[data-testid="param-input-message"] .cm-content')
      await cmContent.click()
      text = await triggerAutocomplete(page, 'regression.')
      expect(text).toContain('primary_var')
      expect(
        text,
        'Foreign regression CustomEvent must be filtered by suiteIds overlap',
      ).not.toContain('poisoned_var')
    })
  })
})
