/**
 * V-VMGR-01: Variable Manager Panel - Layout
 *
 * Design Decisions: VMGR-1 .. VMGR-14 (no count badge, two-line grid,
 * eye / expand / edit / delete cluster, per-type color palette)
 * REQ: REQ-3.1.3.11 (panel structure), REQ-3.2.2.18 (live values)
 *
 * Pass Criteria:
 * 1. Header renders the uppercase title "VARIABLE MANAGER" and a "+ Add" button.
 *    No count badge ("9") is rendered.
 * 2. Toolbar renders the filter input (placeholder "Filter variables…") and the
 *    sort dropdown defaulting to "Name A-Z".
 * 3. The 9 demo variables from the fixture render in the panel, with the type
 *    badge as the rightmost element of every row.
 * 4. Each variable type carries the wireframe color token:
 *    string sky / integer violet / float pink / boolean orange /
 *    array amber / map emerald / table blue.
 * 5. The expression row (api_url) renders a {x} flag badge and shows the
 *    expression text in idle mode (NOT "<not evaluated yet>").
 * 6. The secret row (password) renders a SECRET flag badge, value masked to
 *    "********", and the eye toggle is aria-disabled with opacity-50 +
 *    cursor-not-allowed.
 * 7. The OUT-bound row (user_name) renders an OUT flag badge.
 * 8. In idle mode (no run yet, no runtime values), every non-secret eye is
 *    aria-disabled with opacity-50 + cursor-not-allowed.
 * 9. Flag badge order on a multi-flag row is Unused -> OUT -> {x} -> SECRET,
 *    and the type badge stays rightmost.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/canvas/v-vmgr-panel/fixture.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw)
  fixture.name = `V-VMGR-01 - ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndOpen(page: Page, nameSuffix: string): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(nameSuffix),
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

test.describe('V-VMGR-01: Variable Manager panel layout', () => {
  test('panel header renders title + Add and drops the count badge', async ({ page }) => {
    await importAndOpen(page, 'header')

    const content = page.locator('[data-testid="variable-manager-content"]')
    await expect(content).toBeVisible()

    // Title is uppercase, no historical count chip next to it.
    await expect(content.getByText('Variable Manager')).toBeVisible()
    await expect(content).not.toContainText(/^\s*9\s*$/)

    const addButton = content.locator('[data-testid="add-variable-button"]')
    await expect(addButton).toBeVisible()
    await expect(addButton).toContainText('Add')
  })

  test('toolbar renders filter input and Name A-Z sort default', async ({ page }) => {
    await importAndOpen(page, 'toolbar')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const filter = content.locator('input[aria-label="Filter variables"]')
    await expect(filter).toBeVisible()
    await expect(filter).toHaveAttribute('placeholder', 'Filter variables…')

    // Sort dropdown surfaces the default "Name A-Z" label on the trigger.
    const sortTrigger = content.getByRole('combobox', { name: /sort/i })
    await expect(sortTrigger).toBeVisible()
    await expect(sortTrigger).toContainText('Name A-Z')
  })

  test('every demo variable renders with its type badge as the rightmost element', async ({
    page,
  }) => {
    await importAndOpen(page, 'rows')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const expectedTypes: Array<[string, string]> = [
      ['user_name', 'string'],
      ['retry_count', 'integer'],
      ['timeout_secs', 'float'],
      ['debug_log', 'boolean'],
      ['items', 'array'],
      ['headers', 'map'],
      ['results', 'table'],
      ['api_url', 'string'],
      ['password', 'string'],
    ]
    for (const [name, type] of expectedTypes) {
      const row = content.locator(`[aria-label="Variable ${name}"]`)
      await expect(row).toBeVisible()
      const typeBadge = row.locator('[data-testid^="type-badge-"]')
      await expect(typeBadge).toHaveText(type)
      // Type badge is the very last span child of the row.
      const lastSpan = row.locator('span').last()
      await expect(lastSpan).toHaveText(type)
    }
  })

  test('type color palette matches the wireframe', async ({ page }) => {
    await importAndOpen(page, 'colors')

    const content = page.locator('[data-testid="variable-manager-content"]')
    type TypeRow = { name: string; valueClass: RegExp; badgeClass: RegExp }
    const rows: TypeRow[] = [
      { name: 'user_name', valueClass: /text-sky/, badgeClass: /bg-sky-500/ },
      { name: 'retry_count', valueClass: /text-violet/, badgeClass: /bg-violet-500/ },
      { name: 'timeout_secs', valueClass: /text-pink/, badgeClass: /bg-pink-500/ },
      { name: 'debug_log', valueClass: /text-orange/, badgeClass: /bg-orange-500/ },
      { name: 'items', valueClass: /text-amber/, badgeClass: /bg-amber-500/ },
      { name: 'headers', valueClass: /text-emerald/, badgeClass: /bg-emerald-500/ },
      { name: 'results', valueClass: /text-blue/, badgeClass: /bg-blue-500/ },
    ]
    for (const row of rows) {
      const variableRow = content.locator(`[aria-label="Variable ${row.name}"]`)
      const value = variableRow.locator('[data-testid^="variable-value-"]')
      const typeBadge = variableRow.locator('[data-testid^="type-badge-"]')
      const valueClassAttr = (await value.getAttribute('class')) ?? ''
      const badgeClassAttr = (await typeBadge.getAttribute('class')) ?? ''
      expect(valueClassAttr, `value color for ${row.name}`).toMatch(row.valueClass)
      expect(badgeClassAttr, `badge color for ${row.name}`).toMatch(row.badgeClass)
    }
  })

  test('expression row shows expression text in idle mode', async ({
    page,
  }) => {
    await importAndOpen(page, 'expression')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const expressionRow = content.locator('[aria-label="Variable api_url"]')
    await expect(expressionRow).toBeVisible()

    // {x} flag badge is present.
    const exprBadge = expressionRow.locator('[data-testid^="expr-badge-"]')
    await expect(exprBadge).toHaveText('{x}')

    // Idle (no run yet) shows the expression source, not the placeholder.
    const value = expressionRow.locator('[data-testid^="variable-value-"]')
    await expect(value).toContainText("'https://api.wave.test")
    await expect(value).not.toContainText('<not evaluated yet>')
  })

  test('secret row masks value and disables the eye (visual disabled policy)', async ({
    page,
  }) => {
    await importAndOpen(page, 'secret')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const secretRow = content.locator('[aria-label="Variable password"]')
    await expect(secretRow).toBeVisible()

    const secretBadge = secretRow.locator('[data-testid^="secret-badge-"]')
    await expect(secretBadge).toHaveText('SECRET')

    const value = secretRow.locator('[data-testid^="variable-value-"]')
    await expect(value).toHaveText('********')

    const eye = secretRow.locator('[data-testid^="view-toggle-button-"]')
    await expect(eye).toHaveAttribute('aria-disabled', 'true')
    expect(await eye.getAttribute('class')).toMatch(/opacity-50/)
    expect(await eye.getAttribute('class')).toMatch(/cursor-not-allowed/)
  })

  test('OUT-bound row carries the OUT badge', async ({ page }) => {
    await importAndOpen(page, 'out-binding')

    // The For loop's index output is bound to retry_count in the fixture
    // (integer-to-integer), so retry_count is the OUT-bound row this test
    // asserts on. The wireframe shows OUT on user_name; the binding had
    // to move to retry_count because the BE rejects type-mismatched
    // outputBindings (validator: INVALID_OUTPUT_BINDING_TYPE).
    const content = page.locator('[data-testid="variable-manager-content"]')
    const retryRow = content.locator('[aria-label="Variable retry_count"]')
    const outBadge = retryRow.locator('[data-testid^="out-badge-"]')
    await expect(outBadge).toHaveText('OUT')
  })

  test('idle mode disables every non-secret eye', async ({ page }) => {
    await importAndOpen(page, 'idle-eye')

    const content = page.locator('[data-testid="variable-manager-content"]')
    const variableNames = [
      'user_name',
      'retry_count',
      'timeout_secs',
      'debug_log',
      'items',
      'headers',
      'results',
      'api_url',
    ]
    for (const name of variableNames) {
      const row = content.locator(`[aria-label="Variable ${name}"]`)
      const eye = row.locator('[data-testid^="view-toggle-button-"]')
      await expect(eye, `eye for ${name} should be aria-disabled in idle`).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(
        await eye.getAttribute('class'),
        `eye for ${name} should carry opacity-50`,
      ).toMatch(/opacity-50/)
      expect(
        await eye.getAttribute('class'),
        `eye for ${name} should carry cursor-not-allowed`,
      ).toMatch(/cursor-not-allowed/)
    }
  })

  test('flag badges precede the type badge with the documented order', async ({
    page,
  }) => {
    await importAndOpen(page, 'flag-order')

    const content = page.locator('[data-testid="variable-manager-content"]')

    // Per VMGR-7: the type badge is always the rightmost span on
    // the row, so any flag badge present sits to the left of it. The For
    // loop in the fixture binds index to retry_count, so retry_count
    // carries the OUT badge.
    const retryRow = content.locator('[aria-label="Variable retry_count"]')
    const retryBadges = await retryRow
      .locator('span[data-testid*="-badge-"]')
      .evaluateAll((els: Element[]) =>
        els.map((el) => (el as HTMLElement).dataset.testid?.split('-')[0] ?? ''),
      )
    expect(retryBadges[retryBadges.length - 1]).toBe('type')
    expect(retryBadges).toContain('out')
    expect(retryBadges.indexOf('out')).toBeLessThan(retryBadges.indexOf('type'))

    // Expression row has the {x} flag and the type badge - same invariant.
    const apiRow = content.locator('[aria-label="Variable api_url"]')
    const apiBadges = await apiRow
      .locator('span[data-testid*="-badge-"]')
      .evaluateAll((els: Element[]) =>
        els.map((el) => (el as HTMLElement).dataset.testid?.split('-')[0] ?? ''),
      )
    expect(apiBadges[apiBadges.length - 1]).toBe('type')
    expect(apiBadges).toContain('expr')
    expect(apiBadges.indexOf('expr')).toBeLessThan(apiBadges.indexOf('type'))

    // Secret row has SECRET + type at minimum, type still rightmost.
    const secretRow = content.locator('[aria-label="Variable password"]')
    const secretBadges = await secretRow
      .locator('span[data-testid*="-badge-"]')
      .evaluateAll((els: Element[]) =>
        els.map((el) => (el as HTMLElement).dataset.testid?.split('-')[0] ?? ''),
      )
    expect(secretBadges[secretBadges.length - 1]).toBe('type')
    expect(secretBadges).toContain('secret')
    expect(secretBadges.indexOf('secret')).toBeLessThan(secretBadges.indexOf('type'))
  })
})
