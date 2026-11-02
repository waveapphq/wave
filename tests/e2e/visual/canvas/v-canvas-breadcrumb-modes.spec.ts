/**
 * V-CANVAS-BREADCRUMB-MODES: Workbench canvas breadcrumb path - all 7 modes.
 *
 * REQ: REQ-5.2.1.25 (workbench breadcrumb)
 *
 * Pass Criteria:
 *  S1 Draft mode: 1 segment "Draft Workflow" with Test icon; back arrow HIDDEN.
 *  S2 Edit Tests-origin: 1 segment with the test name; back arrow -> /tests.
 *  S3 Edit Suite-origin: [suite, test]; back arrow -> /suites/<id>.
 *  S4 Edit Regression-origin: [regression, suite, test]; back arrow ->
 *     /suites/<id>?regressionId=<id> so the suite's own back returns to the
 *     regression.
 *  S5 Standalone test execution (history-canvas mode): [Executions, test];
 *     back arrow -> /executions.
 *  S6 Suite child execution (mocked live session): [Executions, suite, test];
 *     back arrow -> /executions/<parentExecutionId>.
 *  S7 Regression child execution (mocked live session): [Executions, regression,
 *     suite, test]; back arrow -> /executions/<suite-exec-id> (one step up).
 *  S8 Loading state: when arriving at
 *     /workbench?editTest=<id>&suiteId=<id>&regressionId=<id> the parent
 *     skeleton placeholders are rendered before the resolved labels (the
 *     hook reports `pendingParents` while suite/regression fetches are in
 *     flight, and the leaf renders an `isPending` skeleton).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { mockInventedTestReads, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

// IDs match tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh
const T_SHORT = 'b1100001-0001-0001-0001-000000000001'
const S_SHORT = 'c1100001-0001-0001-0001-000000000001'
const R_SHORT = 'd1100001-0001-0001-0001-000000000001'
const EXEC_TEST_STANDALONE = 'e1100001-0001-0001-0001-000000000001'

// Mock-only IDs used by the live-execution mode tests (S6, S7).
const MOCK_TEST_ID = 'aaa00000-0000-0000-0000-000000000001'
const MOCK_SUITE_EXEC_ID = 'aaa00000-0000-0000-0000-000000000002'
const MOCK_REG_EXEC_ID = 'aaa00000-0000-0000-0000-000000000003'
const MOCK_TEST_EXEC_ID = 'aaa00000-0000-0000-0000-000000000004'
const MOCK_SUITE_EXEC_NAME = 'Nightly Suite Run #42'
const MOCK_REG_EXEC_NAME = 'Nightly Regression Run #42'
const MOCK_TEST_NAME = 'Tracked child test'

async function ensureCleanWorkbench(page: Page): Promise<void> {
  // The live-execution modes drive a Test the server never stored, so its
  // load-time validation has to be answered here or the canvas blocks.
  await mockInventedTestReads(page, [MOCK_TEST_ID])
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/tests')
  await page.evaluate(() => localStorage.clear())
}

async function gotoWorkbench(page: Page, query: string): Promise<void> {
  await page.goto(`/workbench${query}`)
  await waitForCanvasLoad(page)
  // The breadcrumb bar is always mounted by the workbench shell.
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toBeVisible()
}

async function getSegmentLabels(page: Page): Promise<string[]> {
  // Read the visible breadcrumb path text, normalizing the `/` separators
  // so we get a clean array of segment labels.
  const path = page.locator('[data-testid="breadcrumb-path"]')
  const raw = await path.evaluate((el) =>
    Array.from(el.querySelectorAll('li')).map((li) => (li.textContent || '').trim()),
  )
  // Each <li> we built contains either a labeled segment or a `/` separator
  // span; filter out the separators and any empties.
  return raw.filter((s) => s.length > 0 && s !== '/')
}

test.describe('V-CANVAS-BREADCRUMB-MODES: workbench breadcrumb modes', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test.beforeEach(async ({ page }) => {
    await ensureCleanWorkbench(page)
  })

  test('V-CANVAS-BREADCRUMB-MODES-S1: Draft mode shows single "Draft Workflow" segment with no back arrow', async ({
    page,
  }) => {
    // Mock workbench session as empty so the workbench stays in draft mode.
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null }),
        })
      } else {
        route.continue()
      }
    })

    await gotoWorkbench(page, '')

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(backArrow, 'Back arrow must be hidden in Draft mode').toHaveCount(0)

    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Draft Workflow'])

    // Test icon for the leaf, color #4ADE80.
    const testIcons = page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(74, 222, 128)"]')
    await expect(testIcons.first()).toBeVisible()
  })

  test('V-CANVAS-BREADCRUMB-MODES-S2: Edit Tests-origin shows [test name]; back -> /tests', async ({
    page,
  }) => {
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null }),
        })
      } else {
        route.continue()
      }
    })

    await gotoWorkbench(page, `?editTest=${T_SHORT}`)

    // Wait for the test name to land in the breadcrumb (replaces "Draft Workflow").
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Login Check')

    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Login Check'])

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(backArrow).toBeVisible()
    await backArrow.click()
    await expect(page).toHaveURL(/\/tests$/)
  })

  test('V-CANVAS-BREADCRUMB-MODES-S3: Edit Suite-origin shows [suite, test]; back -> /suites/<id>', async ({
    page,
  }) => {
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null }),
        })
      } else {
        route.continue()
      }
    })

    await gotoWorkbench(page, `?editTest=${T_SHORT}&suiteId=${S_SHORT}`)
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Smoke Suite')
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Login Check')

    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Smoke Suite', 'Login Check'])

    // Icons: Suite (orange #F59E0B) + Test (green #4ADE80) both present.
    const suiteIcon = page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(245, 158, 11)"]')
    const testIcon = page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(74, 222, 128)"]')
    await expect(suiteIcon.first()).toBeVisible()
    await expect(testIcon.first()).toBeVisible()

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await backArrow.click()
    await expect(page).toHaveURL(new RegExp(`/suites/${S_SHORT}$`))
  })

  test('V-CANVAS-BREADCRUMB-MODES-S4: Edit Regression-origin shows [regression, suite, test]; back -> /suites/<id>?regressionId=<id>', async ({
    page,
  }) => {
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null }),
        })
      } else {
        route.continue()
      }
    })

    await gotoWorkbench(page, `?editTest=${T_SHORT}&suiteId=${S_SHORT}&regressionId=${R_SHORT}`)
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Nightly Smoke')
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Smoke Suite')

    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Nightly Smoke', 'Smoke Suite', 'Login Check'])

    // Icons: Regression (purple #A78BFA), Suite (orange #F59E0B), Test (green #4ADE80)
    await expect(
      page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(167, 139, 250)"]').first(),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(245, 158, 11)"]').first(),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(74, 222, 128)"]').first(),
    ).toBeVisible()

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await backArrow.click()
    // Back returns to the suite WITH the regression query param so the
    // suite's own back arrow then goes to the regression.
    await expect(page).toHaveURL(new RegExp(`/suites/${S_SHORT}\\?regressionId=${R_SHORT}`))
  })

  test('V-CANVAS-BREADCRUMB-MODES-S5: Standalone test execution (history canvas) shows [Executions, Test Execution]; back -> /executions', async ({
    page,
  }) => {
    // History canvas uses HistoricalBreadcrumbProvider which produces the
    // 2-segment Executions / "Test Execution" path. The leaf label is the
    // fallback "Test Execution" because the history container passes
    // testName=null to the provider (no test-name lookup wired on the
    // history page itself - the design treats the historical canvas as a
    // direct view of the run, not a tracked tracked-execution session).
    await page.goto(`/executions/history/${EXEC_TEST_STANDALONE}`)
    await page.waitForSelector('[data-testid="workbench-page"]', { state: 'visible', timeout: 15000 })
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Executions', {
      timeout: 10000,
    })
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Test Execution', {
      timeout: 10000,
    })

    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Executions', 'Test Execution'])

    // Root icon is Play in blue #60A5FA. Leaf is Test in green #4ADE80.
    await expect(
      page.locator('[data-testid="breadcrumb-path"] span[style*="color: rgb(96, 165, 250)"]').first(),
    ).toBeVisible()

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await backArrow.click()
    await expect(page).toHaveURL(/\/executions$/)
  })

  test('V-CANVAS-BREADCRUMB-MODES-S6: Suite child execution shows [Executions, suite, test]; back -> /executions/<suite-exec-id>', async ({
    page,
  }) => {
    // Live tracked execution with a parent suite. Mock the workbench session
    // and the parent-execution fetch so the hook walks the 3-segment path.
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              session_id: 'sess-suite-child',
              test_id: MOCK_TEST_ID,
              websocket_topic: 'topic-suite-child',
              status: 'passed',
              execution_id: MOCK_TEST_EXEC_ID,
              parent_execution_id: MOCK_SUITE_EXEC_ID,
              test_name: MOCK_TEST_NAME,
              block_states: {},
            },
          }),
        })
      } else {
        route.continue()
      }
    })

    // Parent suite execution. parent_execution_id is null -> 3-segment path
    // (Executions / Suite / Test).
    await page.route(`**/executions/${MOCK_SUITE_EXEC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: MOCK_SUITE_EXEC_ID,
            name: MOCK_SUITE_EXEC_NAME,
            entity_type: 'suite',
            entity_id: S_SHORT,
            status: 'passed',
            triggered_by: 'e2e',
            started_at: '2026-05-15T12:00:00+00:00',
            completed_at: '2026-05-15T12:00:05+00:00',
            duration: 5,
            parent_execution_id: null,
          },
        }),
      }),
    )

    // Mock the test fetch since the workbench will try to load the test body.
    await page.route(`**/tests/${MOCK_TEST_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: MOCK_TEST_ID, name: MOCK_TEST_NAME, metadata: {} } }),
      }),
    )
    await page.route(`**/tests/${MOCK_TEST_ID}/workflow`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { nodes: [], edges: [] } }),
      }),
    )

    await gotoWorkbench(page, '')

    // Wait for the suite exec name to land - that confirms parent fetch resolved.
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText(MOCK_SUITE_EXEC_NAME)
    const labels = await getSegmentLabels(page)
    expect(labels).toEqual(['Executions', MOCK_SUITE_EXEC_NAME, MOCK_TEST_NAME])

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await backArrow.click()
    await expect(page).toHaveURL(new RegExp(`/executions/${MOCK_SUITE_EXEC_ID}$`))
  })

  test('V-CANVAS-BREADCRUMB-MODES-S7: Regression child execution shows [Executions, regression, suite, test]; back -> /executions/<suite-exec-id>', async ({
    page,
  }) => {
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              session_id: 'sess-reg-child',
              test_id: MOCK_TEST_ID,
              websocket_topic: 'topic-reg-child',
              status: 'passed',
              execution_id: MOCK_TEST_EXEC_ID,
              parent_execution_id: MOCK_SUITE_EXEC_ID,
              test_name: MOCK_TEST_NAME,
              block_states: {},
            },
          }),
        })
      } else {
        route.continue()
      }
    })

    // Parent suite exec; its own parent points at the regression execution.
    await page.route(`**/executions/${MOCK_SUITE_EXEC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: MOCK_SUITE_EXEC_ID,
            name: MOCK_SUITE_EXEC_NAME,
            entity_type: 'suite',
            entity_id: S_SHORT,
            status: 'passed',
            triggered_by: 'e2e',
            started_at: '2026-05-15T12:00:00+00:00',
            completed_at: '2026-05-15T12:00:05+00:00',
            duration: 5,
            parent_execution_id: MOCK_REG_EXEC_ID,
          },
        }),
      }),
    )

    // Grandparent regression execution (4-segment path).
    await page.route(`**/executions/${MOCK_REG_EXEC_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: MOCK_REG_EXEC_ID,
            name: MOCK_REG_EXEC_NAME,
            entity_type: 'regression',
            entity_id: R_SHORT,
            status: 'passed',
            triggered_by: 'e2e',
            started_at: '2026-05-15T12:00:00+00:00',
            completed_at: '2026-05-15T12:00:10+00:00',
            duration: 10,
            parent_execution_id: null,
          },
        }),
      }),
    )

    await page.route(`**/tests/${MOCK_TEST_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: MOCK_TEST_ID, name: MOCK_TEST_NAME, metadata: {} } }),
      }),
    )
    await page.route(`**/tests/${MOCK_TEST_ID}/workflow`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { nodes: [], edges: [] } }),
      }),
    )

    await gotoWorkbench(page, '')

    // The breadcrumb bar's right section carries the Artifacts chip, so
    // this 4-segment path trips the overflow cascade - the parents collapse
    // into the actionable `...` popover instead of rendering inline. Grandparent fetch resolution is proven
    // by the popover listing both parent execution names in order.
    const collapseButton = page.locator('[data-testid="breadcrumb-collapse-button"]')
    await expect(collapseButton).toBeVisible()
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText(MOCK_TEST_NAME)

    await collapseButton.click()
    const parentsList = page.locator('[data-testid="breadcrumb-parents-list"]')
    await expect(parentsList).toBeVisible()
    await expect(parentsList).toContainText('Executions')
    await expect(parentsList).toContainText(MOCK_REG_EXEC_NAME)
    await expect(parentsList).toContainText(MOCK_SUITE_EXEC_NAME)
    const parentsText = (await parentsList.textContent()) ?? ''
    expect(
      parentsText.indexOf('Executions'),
      'Executions precedes the regression exec in the parent path',
    ).toBeLessThan(parentsText.indexOf(MOCK_REG_EXEC_NAME))
    expect(
      parentsText.indexOf(MOCK_REG_EXEC_NAME),
      'regression exec precedes the suite exec in the parent path',
    ).toBeLessThan(parentsText.indexOf(MOCK_SUITE_EXEC_NAME))
    await page.keyboard.press('Escape')
    await expect(parentsList).toBeHidden()

    // Back goes ONE STEP up - to the suite exec (parent), not the regression.
    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await backArrow.click()
    await expect(page).toHaveURL(new RegExp(`/executions/${MOCK_SUITE_EXEC_ID}$`))
  })

  test('V-CANVAS-BREADCRUMB-MODES-S8: parent skeletons render while suite/regression names are in flight', async ({
    page,
  }) => {
    // Delay suite + regression fetches so the pending skeletons are visible
    // long enough to assert against. Parent skeletons render
    // BEFORE the labeled segments swap in, keeping the slot count stable
    // from the first paint.
    await page.route('**/workbench/session', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null }),
        })
      } else {
        route.continue()
      }
    })

    let suiteResolve: (() => void) | null = null
    const suiteGate = new Promise<void>((res) => {
      suiteResolve = res
    })
    let regResolve: (() => void) | null = null
    const regGate = new Promise<void>((res) => {
      regResolve = res
    })

    await page.route(`**/suites/${S_SHORT}`, async (route) => {
      await suiteGate
      await route.continue()
    })
    await page.route(`**/regressions/${R_SHORT}`, async (route) => {
      await regGate
      await route.continue()
    })

    await gotoWorkbench(page, `?editTest=${T_SHORT}&suiteId=${S_SHORT}&regressionId=${R_SHORT}`)

    // Skeletons are present BEFORE the names resolve.
    await expect(page.locator('[data-testid="breadcrumb-pending-regression"]')).toBeVisible()
    await expect(page.locator('[data-testid="breadcrumb-pending-suite"]')).toBeVisible()

    // Let the fetches complete.
    suiteResolve!()
    regResolve!()

    // After the fetches resolve, the labeled segments replace the skeletons.
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Nightly Smoke')
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Smoke Suite')
    await expect(page.locator('[data-testid="breadcrumb-pending-regression"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="breadcrumb-pending-suite"]')).toHaveCount(0)
  })
})
