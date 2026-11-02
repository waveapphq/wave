/** Condition rows of the check blocks (Assert, If/Else, Switch, While, Wait Until) driven through the config sheet. */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { leaveExpressionEditor } from './code-editor'

export type ConditionBlock = 'assert' | 'if-else' | 'switch' | 'while' | 'wait-until'

/** The part of a check block's sheet that holds one condition list; If/Else and Switch keep one per branch. */
export function conditionBody(sheet: Locator, block: ConditionBlock, branch = 'branch_0'): Locator {
  if (block === 'switch') return sheet.locator(`[data-testid="case-body-${branch}"]`)
  if (block === 'if-else') return sheet.locator(`[data-testid="branch-body-${branch}"]`)
  return sheet
}

/** Add an empty literal condition row. */
export async function addLiteralRow(body: Locator): Promise<void> {
  await body.locator('[data-testid="assert-add-assertion"]').click()
  await body.locator('[data-testid="assert-add-literal"]').click()
}

/** Add an empty expression condition row. */
export async function addExpressionRow(body: Locator): Promise<void> {
  await body.locator('[data-testid="assert-add-assertion"]').click()
  await body.locator('[data-testid="assert-add-expression"]').click()
}

/** Pick a variable in a literal row's combobox (existing-only: typing filters). */
export async function pickConditionVariable(page: Page, body: Locator, path: string, name: string): Promise<void> {
  const anchor = body.locator(`[data-testid="assert-variable-${path}"]`)
  await anchor.click()
  // An option's accessible name carries its type pill too, so match the row by its exact name span.
  const option = page
    .getByRole('option')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
  await expect(option).toBeVisible({ timeout: 5_000 })
  await option.click()
  await expect(anchor).toHaveValue(name)
}

/** The operator select of a literal row. */
export function operatorTrigger(body: Locator, path: string): Locator {
  return body.locator(`[data-testid="assert-operator-${path}"]`)
}

/** Pick an operator by its label (e.g. "length equals"). */
export async function pickOperator(page: Page, body: Locator, path: string, label: string): Promise<void> {
  const trigger = operatorTrigger(body, path)
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toHaveText(label)
}

/** The operator labels a literal row offers, in order; the list is closed again before returning. */
export async function operatorOptions(page: Page, body: Locator, path: string): Promise<string[]> {
  await operatorTrigger(body, path).click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const labels = (await listbox.getByRole('option').allTextContents()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  return labels
}

/** Type a literal compare-to value into a row's value box. */
export async function setReference(body: Locator, path: string, text: string): Promise<void> {
  const box = body.locator(`[data-testid="assert-value-input-${path}"]`)
  await box.fill(text)
  await expect(box).toHaveValue(text)
}

/** The palette item each check block is dragged from (a `PaletteDragSpec` of `helpers/canvas.ts`). */
export const CHECK_BLOCK_PALETTE: Readonly<Record<ConditionBlock, string | { term: string; testId: string }>> = {
  assert: 'assert',
  'if-else': 'if',
  switch: { term: 'switch', testId: 'palette-item-switch-case' },
  while: 'while',
  'wait-until': { term: 'wait', testId: 'palette-item-wait-until' },
}

/** The path of the n-th top-level row: the AND / OR connector between two rows takes a path of its own. */
export function rowPath(index: number): string {
  return String(index * 2)
}

/** A literal row's compare-to value box; gone for an operator that takes no compare-to value. */
export function valueBox(body: Locator, path: string): Locator {
  return body.locator(`[data-testid="assert-value-input-${path}"]`)
}

/** A literal row's `{}` toggle that makes the compare-to value an expression. */
export function referenceToggle(body: Locator, path: string): Locator {
  return body.locator(`[data-testid="assert-expr-toggle-${path}"]`)
}

/** Make a row's compare-to value an expression and type it in one input. */
export async function setReferenceExpression(page: Page, body: Locator, path: string, text: string): Promise<void> {
  const toggle = referenceToggle(body, path)
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const editor = valueBox(body, path).locator('.cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await leaveExpressionEditor(editor)
  await expect(editor).toHaveText(text)
}

/** The visible condition list of a check block's sheet, its branch card opened when it is collapsed. */
export async function openConditionBody(sheet: Locator, block: ConditionBlock, branch = 'branch_0'): Promise<Locator> {
  const body = conditionBody(sheet, block, branch)
  if (block === 'if-else' || block === 'switch') {
    const prefix = block === 'if-else' ? 'branch' : 'case'
    if (!(await body.isVisible())) await sheet.locator(`[data-testid="${prefix}-toggle-${branch}"]`).click()
  }
  await expect(body).toBeVisible()
  return body
}

/** The stored rows (connectors left out) of a check block's condition list, read from its saved `config.values`. */
export function storedConditionRows(
  values: Record<string, unknown>,
  block: ConditionBlock,
  branch = 'branch_0',
): Array<Record<string, unknown>> {
  let items: unknown
  if (block === 'assert') items = values.assertions
  else if (block === 'if-else' || block === 'switch') {
    items = ((values.branches ?? []) as Array<{ id?: string; conditions?: unknown }>).find((b) => b.id === branch)?.conditions
  } else items = values.conditions
  return ((items ?? []) as Array<Record<string, unknown>>).filter((item) => item.type !== 'operator')
}

/** Flip the n-th top-level AND / OR connector (1-based) of a condition list to `value`. */
export async function setRootJoiner(body: Locator, n: number, value: 'and' | 'or'): Promise<void> {
  const toggle = body.locator(`[data-testid="assert-operator-toggle-root-${n}"]`)
  if ((await toggle.innerText()).trim().toLowerCase() !== value) await toggle.click()
  await expect(toggle).toHaveText(value.toUpperCase())
}

/** Add a case to a Switch sheet and return its condition list; `id` is the `branch_<n>` the card takes. */
export async function addSwitchCase(sheet: Locator, id: string): Promise<Locator> {
  await sheet.locator('[data-testid="add-case-button"]').click()
  await expect(sheet.locator(`[data-testid="case-badge-${id}"]`)).toHaveText('CASE')
  return openConditionBody(sheet, 'switch', id)
}

/** Add the Default card to a Switch sheet; `id` is the `branch_<n>` it takes. */
export async function addSwitchDefault(sheet: Locator, id: string): Promise<void> {
  await sheet.locator('[data-testid="add-default-button"]').click()
  await expect(sheet.locator(`[data-testid="default-badge-${id}"]`)).toHaveText('DEFAULT')
}

/** Wait Until timing in its sheet: the mode radio, then Timeout and Check Interval in milliseconds. */
export async function setWaitTiming(
  sheet: Locator,
  mode: 'retry' | 'watch',
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const radio = sheet.locator(`#wait-mode-${mode}`)
  await radio.click()
  await expect(radio).toHaveAttribute('data-state', 'checked')
  for (const [name, value] of [
    ['timeout', timeoutMs],
    ['check_interval', intervalMs],
  ] as const) {
    const box = sheet.locator(`[data-testid="param-input-${name}"]`)
    // Key by key: a box showing its gray default takes a key, never a fill (FIELD-2).
    await box.click()
    await box.press('ControlOrMeta+a')
    await box.pressSequentially(String(value))
    await expect(box).toHaveValue(String(value))
  }
}
