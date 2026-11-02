/**
 * V-PROF-PARAM-CELL: Profile parameter value cell.
 *
 * The value cell mirrors the Variable Setter: integer / float / boolean edit
 * inline via the shared ScalarEditBody; string + array / map / table render an Edit
 * button whose preview follows the setter's shared getValuePreview (quoted string /
 * "N items" / "N pairs" / "N rows x M col"); a secret param with a value renders one
 * uniform masked affordance (pencil + lock + dots, aria-label "Edit protected value");
 * delete is the Trash2 icon.
 *
 * Phase: no-data (parallel) - self-seeds one custom profile via the API, opens the
 * edit modal, asserts the AS-BUILT rendering (setter parity), then cleans up. Runs in
 * both the dark and the light project automatically (theme-independent assertions).
 *
 * Per-type affordances, a uniform masked secret and setter-parity preview text.
 * The setter's getValuePreview supersedes the wireframe's bracket text.
 *
 * Pass Criteria:
 * 1. string value -> Edit button, quoted green preview ("db.local").
 * 2. integer / float -> inline scalar input carrying the typed value.
 * 3. boolean -> inline true/false segmented control, true active.
 * 4. array / map / table -> Edit button, muted "2 items" / "1 pairs" / "2 rows x 2 col".
 * 5. secret value (any type) -> uniform masked affordance: pencil + lock + dots, the
 *    underlying value never rendered.
 * 6. delete -> Trash2 (aria-label "Delete parameter").
 * 7. A long (60+ char) string value truncates with an ellipsis INSIDE its value cell
 *    and does NOT spill outside the modal; the Name / Type columns keep their fixed
 *    widths (table-fixed) instead of being squeezed.
 */

import { test, expect, type APIRequestContext, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const PROFILE_NAME = 'PVC-param-cell'
const LONG_STRING = 'this-is-a-very-long-connection-string-value-that-must-truncate-1234567890'

async function deleteSeed(request: APIRequestContext) {
  // Filter by name: per_page caps at 100 server-side, so a large per_page 422s and the
  // delete no-ops, leaving S1's profile to 409 S2's create.
  const list = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(PROFILE_NAME)}`)
  const lb = await list.json()
  for (const p of (Array.isArray(lb) ? lb : (lb.data ?? []))) {
    if (p.name === PROFILE_NAME) await request.delete(`${BACKEND_URL}/profiles/${p.id}`).catch(() => {})
  }
}

async function seedProfile(request: APIRequestContext): Promise<void> {
  // Resolve the shared E2E environment id.
  const envResp = await request.get(`${BACKEND_URL}/environments/`)
  const envBody = await envResp.json()
  const envs = Array.isArray(envBody) ? envBody : (envBody.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  const envId = env.id

  // Clean any prior copy, then create one custom profile with one param per type.
  await deleteSeed(request)

  const config: Record<string, { type: string; secret: boolean; value: unknown }> = {
    str: { type: 'string', secret: false, value: 'db.local' },
    num: { type: 'integer', secret: false, value: '5432' },
    pi: { type: 'float', secret: false, value: '3.14' },
    flag: { type: 'boolean', secret: false, value: true },
    arr: { type: 'array', secret: false, value: ['a', 'b'] },
    m: { type: 'map', secret: false, value: { k: 'v' } },
    tbl: { type: 'table', secret: false, value: { headers: ['c1', 'c2'], rows: [['a', 'b'], ['c', 'd']] } },
    sstr: { type: 'string', secret: true, value: 'hidden-secret' },
    longstr: { type: 'string', secret: false, value: LONG_STRING },
  }
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { name: PROFILE_NAME, type: 'custom', tags: [], environment_values: { [envId]: config } },
  })
  expect(resp.ok(), `seed profile: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

async function rightEdge(loc: Locator): Promise<number> {
  return loc.evaluate((el) => el.getBoundingClientRect().right)
}

function paramRow(dialog: Locator, index: number): Locator {
  return dialog.locator('tbody tr[data-parameter-id]').nth(index)
}

/** Open the seeded profile's edit modal and select the env that holds the values
 *  (the modal defaults selectedEnvId to environments[0], not necessarily ours). */
async function openParamModal(page: Page): Promise<Locator> {
  await page.goto(`/profiles?search=${encodeURIComponent(PROFILE_NAME)}`)
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  const row = page.locator('[data-testid="profile-row"]', { hasText: PROFILE_NAME })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.locator('[data-testid="action-edit"]').click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('tbody tr[data-parameter-id]').first()).toBeVisible()
  const selector = dialog.locator('[data-testid="env-selector"]')
  // The portaled env popover is the [role="dialog"] that carries a [role="listbox"]
  // (cmdk does not forward the CommandList id, so we cannot target it by id).
  const popover = page.locator('[role="dialog"]').filter({ has: page.locator('[role="listbox"]') })
  await expect(async () => {
    await selector.click()
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await popover.locator('[role="listbox"] button').filter({ hasText: E2E_ENV_NAME }).first().click()
  await expect(popover).not.toBeVisible()
  return dialog
}

test.describe('V-PROF-PARAM-CELL: profile value cell renders the migrated setter affordances', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.goto('/')
    await ensureEnvironment(request)
    await seedProfile(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteSeed(request)
  })

  test('S1: value affordance per type + uniform masked secret + trash delete', async ({ page }) => {
    const dialog = await openParamModal(page)

    // string (0): Edit button, quoted preview.
    await expect(paramRow(dialog, 0).locator('[data-testid^="param-edit-value-"]')).toContainText('"db.local"')
    // integer (1) + float (2): inline scalar input carrying the typed value.
    await expect(paramRow(dialog, 1).locator('[data-testid="scalar-edit-input"]')).toHaveValue('5432')
    await expect(paramRow(dialog, 2).locator('[data-testid="scalar-edit-input"]')).toHaveValue('3.14')
    // boolean (3): inline segmented control, true active.
    await expect(paramRow(dialog, 3).locator('[data-testid="scalar-edit-bool-true"]')).toHaveAttribute('aria-pressed', 'true')
    // array / map / table (4/5/6): Edit button, setter getValuePreview text.
    await expect(paramRow(dialog, 4).locator('[data-testid^="param-edit-value-"]')).toContainText('2 items')
    await expect(paramRow(dialog, 5).locator('[data-testid^="param-edit-value-"]')).toContainText('1 pairs')
    await expect(paramRow(dialog, 6).locator('[data-testid^="param-edit-value-"]')).toContainText('2 rows x 2 col')

    // secret (7): the uniform masked affordance never reveals the value.
    const masked = paramRow(dialog, 7).locator('button[aria-label="Edit protected value"]')
    await expect(masked).toBeVisible()
    await expect(masked).toContainText('•')
    await expect(masked).not.toContainText('hidden-secret')

    // delete: every row carries the Trash2 delete.
    await expect(paramRow(dialog, 0).locator('button[aria-label="Delete parameter"]')).toBeVisible()
  })

  test('S2: a long string value truncates inside the cell and never spills outside the modal', async ({ page }) => {
    const dialog = await openParamModal(page)

    const longRow = paramRow(dialog, 8)
    const editBtn = longRow.locator('[data-testid^="param-edit-value-"]')
    await expect(editBtn).toBeVisible()

    // The preview span truncates (ellipsis) rather than wrapping or stretching.
    const previewSpan = editBtn.locator('span.truncate')
    await expect(previewSpan).toHaveCount(1)

    // The Edit button (and thus the value cell) stays inside the modal: its right
    // edge does not exceed the dialog's right edge. This is the table-fixed + plain
    // truncating-button fix - a shadcn Button's preview would overflow here.
    const btnRight = await rightEdge(editBtn)
    const dialogRight = await rightEdge(dialog)
    expect(btnRight, 'long value Edit button must not spill past the modal edge').toBeLessThanOrEqual(dialogRight + 1)

    // The parameters table does not develop horizontal overflow (table-fixed contains it).
    const tableOverflow = await dialog.locator('table').first().evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(tableOverflow.scrollWidth).toBeLessThanOrEqual(tableOverflow.clientWidth + 1)

    // Name + Type columns keep their fixed widths (NOT squeezed by the long value).
    const nameCellWidth = await longRow.locator('td').first().evaluate((el) => el.getBoundingClientRect().width)
    expect(nameCellWidth, 'Name column stays readable under a long value (table-fixed)').toBeGreaterThan(120)
  })
})
