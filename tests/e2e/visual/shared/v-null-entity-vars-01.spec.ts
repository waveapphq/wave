/**
 * V-VMGR-11: null values in the suite sidebar Variables list and the System Variables table
 * Design Decisions: VMGR-93 (one null look, not dimmed; read-only tables summarize a list with
 *   the row text; null chip name `<variable name> (null)` and tooltip), VMGR-95 (a row switched
 *   to boolean stores false; an emptied integer shows `Must be an integer`)
 * REQ: REQ-3.1.3.20, REQ-3.1.3.1
 *
 * Phase: fixture (seeds its own suite and uniquely named system variables through the API and
 * deletes them after; the System Variables collection is shared, so the phase is serial).
 *
 * Pass Criteria:
 * 1. Suite sidebar Variables: ent_string (STRING) and ent_array (ARRAY) read `null` in the null
 *    look (exact text, italic, monospace, Text Muted) on the type pill's line, right of the
 *    pill; the rows are not dimmed (effective opacity 1).
 * 2. ent_integer reads `5`, ent_boolean `true`, the three-item list `[3 items]` (VMGR-93) and a
 *    string holding the text `null` reads `null` - none of them in the null look.
 * 3. No `Edit…` shows for a null complex value, in the list or in the Edit Variables dialog.
 * 4. Edit Suite Variables: each null row shows the null chip named `<name> (null)`, reading
 *    `null` in the null look, tooltip `Click to enter a value`.
 * 5. Edit Suite Variables: an emptied integer shows `Must be an integer` (its accessible
 *    description) and blocks Save with `Save is disabled: the variables have errors`.
 * 6. Edit Suite Variables: a row switched to Boolean shows `false` and the saved suite holds
 *    `false` (VMGR-95); the untouched nulls stay null and the edited integer is stored (GET
 *    /suites/{id}); the sidebar then reads `false`.
 * 7. System Variables table: the uniquely named null string and array read `null` in the null
 *    look beside the pill, the integer `5`, the boolean `true`, the two-item list `[2 items]`;
 *    Edit System Variables shows the null chips and no Edit… for the null array.
 * 8. The suite and every system variable the spec created are deleted; none of its system
 *    variables is left (GET /variables/system).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  cancelVariablesDialog,
  entityValueCell,
  entityVariableRow,
  saveVariablesDialog,
  setEntityRowType,
  variablesDialog,
} from '../../helpers/entity-variables'

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const NULL_CHIP_TOOLTIP = 'Click to enter a value'
const SAVE_BLOCKED_NOTE = 'Save is disabled: the variables have errors'

interface SeedVariable {
  type: string
  value: unknown
  secret: boolean
}

const plain = (type: string, value: unknown): SeedVariable => ({ type, value, secret: false })

const SUITE_VARIABLES: Record<string, SeedVariable> = {
  ent_string: plain('string', null),
  ent_integer: plain('integer', '5'),
  ent_boolean: plain('boolean', true),
  ent_array: plain('array', null),
  ent_list: plain('array', ['a', 'b', 'c']),
  ent_word: plain('string', 'null'),
  ent_switch: plain('string', 'switch me'),
}

const SYS_PREFIX = `nv11_${RUN}_`
const sys = (suffix: string): string => `${SYS_PREFIX}${suffix}`
const SYSTEM_VARIABLES: Record<string, SeedVariable> = {
  [sys('string')]: plain('string', null),
  [sys('integer')]: plain('integer', '5'),
  [sys('boolean')]: plain('boolean', true),
  [sys('array')]: plain('array', null),
  [sys('list')]: plain('array', ['x', 'y']),
}

// ---------------------------------------------------------------------------
// Look checks
// ---------------------------------------------------------------------------

/** VMGR-93, FIELD-5: exact text `null`, italic, the monospace stack and Text Muted, the one gray. */
async function expectNullLook(target: Locator): Promise<void> {
  await expect(target).toHaveText('null')
  const look = await target.evaluate((el) => {
    const probe = (className: string, color = '') => {
      const span = document.createElement('span')
      span.className = className
      span.style.color = color
      ;(el.parentElement ?? document.body).appendChild(span)
      const style = getComputedStyle(span)
      const result = { color: style.color, fontFamily: style.fontFamily }
      span.remove()
      return result
    }
    const style = getComputedStyle(el)
    return {
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      color: style.color,
      mono: probe('font-mono').fontFamily,
      muted: probe('', 'var(--color-text-muted)').color,
    }
  })
  expect(look.fontStyle, 'the null look is italic').toBe('italic')
  expect(look.fontFamily, 'the null look uses the monospace stack').toBe(look.mono)
  expect(look.fontFamily).toMatch(/mono/i)
  expect(look.color, 'the null look uses Text Muted').toBe(look.muted)
}

/** Not dimmed: the product of every opacity from the row up to the document is 1. */
async function expectNotDimmed(row: Locator): Promise<void> {
  const opacity = await row.evaluate((el) => {
    let total = 1
    for (let node: Element | null = el; node; node = node.parentElement) {
      total *= Number(getComputedStyle(node).opacity)
    }
    return total
  })
  expect(opacity, 'a null row is not dimmed').toBe(1)
}

async function expectTooltip(page: Page, trigger: Locator, text: string): Promise<void> {
  await trigger.hover()
  await expect(page.getByRole('tooltip')).toHaveText(text)
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// Read-only variable list (suite sidebar and System Variables)
// ---------------------------------------------------------------------------

function listRow(list: Locator, name: string): Locator {
  return list
    .locator('[data-testid="variable-row"]')
    .filter({ has: list.page().getByText(name, { exact: true }) })
}

const listValue = (row: Locator): Locator => row.locator('[data-testid="variable-value"]')
const listPill = (row: Locator): Locator =>
  listValue(row).locator('xpath=preceding-sibling::span[1]')

/** A null row: the null look on the pill's line, right of the pill, the row not dimmed. */
async function expectNullListRow(list: Locator, name: string, type: string): Promise<void> {
  const row = listRow(list, name)
  await expect(row).toHaveCount(1)
  await expect(listPill(row)).toHaveText(type)
  const nullText = listValue(row).locator('span[translate="no"]')
  await expectNullLook(nullText)
  await expect(listValue(row)).toHaveText('null')
  const pillBox = await listPill(row).boundingBox()
  const textBox = await nullText.boundingBox()
  expect(pillBox).not.toBeNull()
  expect(textBox).not.toBeNull()
  expect(textBox!.x, 'null sits right of the type pill').toBeGreaterThanOrEqual(
    pillBox!.x + pillBox!.width,
  )
  expect(
    Math.abs(textBox!.y + textBox!.height / 2 - (pillBox!.y + pillBox!.height / 2)),
    'null sits on the type pill line',
  ).toBeLessThanOrEqual(2)
  await expect(row, 'no Edit… for a null value').not.toContainText('Edit')
  await expectNotDimmed(row)
}

/** A non-null row: its exact text, never the null look. */
async function expectPlainListRow(
  list: Locator,
  name: string,
  type: string,
  text: string,
): Promise<void> {
  const row = listRow(list, name)
  await expect(row).toHaveCount(1)
  await expect(listPill(row)).toHaveText(type)
  await expect(listValue(row)).toHaveText(text)
  await expect(listValue(row).locator('span[translate="no"]')).toHaveCount(0)
  await expect(listValue(row)).toHaveCSS('font-style', 'normal')
}

// ---------------------------------------------------------------------------
// Edit Variables dialog
// ---------------------------------------------------------------------------

/** VMGR-93: a null value cell is the null chip, never an Edit… preview. */
async function expectNullChipRow(page: Page, dialog: Locator, name: string): Promise<void> {
  const row = await entityVariableRow(dialog, name)
  const chip = row.getByRole('button', { name: `${name} (null)`, exact: true })
  await expect(chip).toHaveCount(1)
  await expectNullLook(chip)
  await expectTooltip(page, chip, NULL_CHIP_TOOLTIP)
  await expect(entityValueCell(row)).toHaveCount(0)
  await expect(row).not.toContainText('Edit…')
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function readSuiteVariables(page: Page, suiteId: string): Promise<Record<string, SeedVariable>> {
  const resp = await page.request.get(`${BACKEND_URL}/suites/${suiteId}`)
  expect(resp.ok(), `GET /suites/${suiteId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.variables
}

async function readSystemVariables(page: Page): Promise<Record<string, SeedVariable>> {
  const resp = await page.request.get(`${BACKEND_URL}/variables/system`)
  expect(resp.ok(), `GET /variables/system: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.variables
}

async function waitForSettingsPageLoad(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

// ===========================================================================

test.describe('V-VMGR-11: null values in the suite and System Variables lists', () => {
  test('suite sidebar Variables and Edit Suite Variables', async ({ page }, testInfo) => {
    const create = await page.request.post(`${BACKEND_URL}/suites`, {
      data: { name: `V-VMGR-11 Suite ${RUN}`, variables: SUITE_VARIABLES },
    })
    expect(create.ok(), `POST /suites: ${create.status()} ${await create.text()}`).toBeTruthy()
    const suiteId = (await create.json()).data.id as string

    try {
      await page.goto(`/suites/${suiteId}`)
      await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 15_000 })
      const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')
      const list = sidebar.locator('[data-testid="variable-readonly-table"]')

      await test.step('sidebar: null rows take the null look beside the pill, not dimmed', async () => {
        await expectNullListRow(list, 'ent_string', 'string')
        await expectNullListRow(list, 'ent_array', 'array')
      })

      await test.step('sidebar: non-null rows keep their text, the list reads [3 items]', async () => {
        await expectPlainListRow(list, 'ent_integer', 'integer', '5')
        await expectPlainListRow(list, 'ent_boolean', 'boolean', 'true')
        await expectPlainListRow(list, 'ent_list', 'array', '[3 items]')
        await expectPlainListRow(list, 'ent_word', 'string', 'null')
        await expect(list, 'no Edit… in the read-only list').not.toContainText('Edit…')
        await list.screenshot({ path: testInfo.outputPath('suite-sidebar-variables.png') })
      })

      const dialog = variablesDialog(page)
      await test.step('Edit Suite Variables: null rows show the null chip, no Edit…', async () => {
        await sidebar.locator('[data-testid="edit-variables-btn"]').click()
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await expectNullChipRow(page, dialog, 'ent_string')
        await expectNullChipRow(page, dialog, 'ent_array')
        const listCell = entityValueCell(await entityVariableRow(dialog, 'ent_list'))
        await expect(listCell).toHaveText('3 items')
      })

      await test.step('an emptied integer shows Must be an integer and blocks Save', async () => {
        const intRow = await entityVariableRow(dialog, 'ent_integer')
        const input = intRow.locator('[data-testid="scalar-edit-input"]')
        await expect(input).toHaveValue('5')
        await input.fill('')
        await expect(intRow.getByText('Must be an integer', { exact: true })).toBeVisible()
        await expect(input).toHaveAttribute('aria-invalid', 'true')
        await expect(input).toHaveAccessibleDescription('Must be an integer')
        await expect(dialog.locator('[data-testid="edit-dialog-save"]')).toBeDisabled()
        await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveText(SAVE_BLOCKED_NOTE)
        await dialog.screenshot({ path: testInfo.outputPath('edit-suite-variables-blocked.png') })

        await input.fill('7')
        await expect(intRow.getByText('Must be an integer', { exact: true })).toHaveCount(0)
        await expect(dialog.locator('[data-testid="save-blocked-note"]')).toHaveCount(0)
      })

      await test.step('a row switched to Boolean stores false (VMGR-95)', async () => {
        const switchRow = await entityVariableRow(dialog, 'ent_switch')
        await setEntityRowType(page, switchRow, 'Boolean')
        await expect(switchRow.getByRole('button', { name: 'false', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        await expect(dialog.locator('[data-testid="edit-dialog-save"]')).toBeEnabled()
        await saveVariablesDialog(dialog)

        const stored = await readSuiteVariables(page, suiteId)
        expect(stored.ent_switch.type).toBe('boolean')
        expect(stored.ent_switch.value, 'VMGR-95: the switched row stores false').toBe(false)
        expect(stored.ent_string.value, 'an untouched null stays null').toBeNull()
        expect(stored.ent_array.value, 'an untouched null stays null').toBeNull()
        expect(stored.ent_integer.type).toBe('integer')
        expect(String(stored.ent_integer.value)).toBe('7')
        expect(stored.ent_list.value).toEqual(['a', 'b', 'c'])

        await expectPlainListRow(list, 'ent_switch', 'boolean', 'false')
        await expectNullListRow(list, 'ent_string', 'string')
        await expectNullListRow(list, 'ent_array', 'array')
      })
    } finally {
      const removed = await page.request.delete(`${BACKEND_URL}/suites/${suiteId}`)
      expect(removed.ok(), `DELETE /suites/${suiteId}: ${removed.status()}`).toBeTruthy()
    }
  })

  test('System Variables table and Edit System Variables', async ({ page }, testInfo) => {
    const current = await readSystemVariables(page)
    const seeded = await page.request.post(`${BACKEND_URL}/variables/system`, {
      data: { variables: { ...current, ...SYSTEM_VARIABLES } },
    })
    expect(seeded.ok(), `POST /variables/system: ${seeded.status()} ${await seeded.text()}`).toBeTruthy()

    try {
      await page.goto('/settings/variables')
      await waitForSettingsPageLoad(page)
      const tab = page.locator('[data-testid="system-variables-tab"]')
      const list = tab.locator('[data-testid="variable-readonly-table"]')

      await test.step('System Variables: null rows take the null look beside the pill', async () => {
        await expectNullListRow(list, sys('string'), 'string')
        await expectNullListRow(list, sys('array'), 'array')
      })

      await test.step('System Variables: non-null rows keep their text, the list reads [2 items]', async () => {
        await expectPlainListRow(list, sys('integer'), 'integer', '5')
        await expectPlainListRow(list, sys('boolean'), 'boolean', 'true')
        await expectPlainListRow(list, sys('list'), 'array', '[2 items]')
        await tab.screenshot({ path: testInfo.outputPath('system-variables.png') })
      })

      await test.step('Edit System Variables: null chips, no Edit… for the null array', async () => {
        await tab.locator('[data-testid="system-variables-edit-btn"]').click()
        const dialog = variablesDialog(page)
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await expectNullChipRow(page, dialog, sys('string'))
        await expectNullChipRow(page, dialog, sys('array'))
        await cancelVariablesDialog(dialog)
      })
    } finally {
      for (const name of Object.keys(SYSTEM_VARIABLES)) {
        const removed = await page.request.delete(`${BACKEND_URL}/variables/system/${name}`)
        expect(removed.status(), `DELETE /variables/system/${name}`).toBe(204)
      }
      const left = Object.keys(await readSystemVariables(page)).filter((name) =>
        name.startsWith(SYS_PREFIX),
      )
      expect(left, 'no system variable of this spec is left').toEqual([])
    }
  })
})
