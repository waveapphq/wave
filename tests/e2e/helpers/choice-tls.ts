/** Choice values a Block holds from creation, the Cipher Suites field and its picker, and the time picker (FIELD-8, FIELD-9, FIELD-10). */

import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { BACKEND_URL } from './config'
import { callTool } from './mcp'

export type Values = Record<string, unknown>

export type HostKeyAction = 'strict' | 'accept-new' | 'disabled'

interface CatalogParam {
  name?: string
  type?: string
  default?: unknown
  enum_values?: unknown[] | null
}

/** Each choice-list and true / false field of a Block that declares a default, as the MCP block catalog lists it. */
export function catalogChoiceDefaults(mcpPort: number, blockId: string): Values {
  const result = callTool(mcpPort, 'get_block', { block_id: blockId })
  expect(result.isError, `get_block ${blockId}: ${JSON.stringify(result.payload)}`).toBe(false)
  const params = (result.payload.parameters ?? []) as CatalogParam[]
  const values: Values = {}
  for (const param of params) {
    const choice = (Array.isArray(param.enum_values) && param.enum_values.length > 0) || param.type === 'boolean'
    if (!choice || !param.name || param.default === null || param.default === undefined) continue
    if (!Object.hasOwn(values, param.name)) values[param.name] = param.default
  }
  expect(Object.keys(values).length, `${blockId} declares choice fields with defaults`).toBeGreaterThan(0)
  return values
}

/** The stored Test's nodes, as GET /tests/{id} returns them. */
export async function storedNodes(request: APIRequestContext, testId: string): Promise<Array<Record<string, any>>> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(response.ok(), `GET /tests/${testId} answered ${response.status()}`).toBeTruthy()
  return ((await response.json()).data?.workflow?.nodes ?? []) as Array<Record<string, any>>
}

/** One stored Block's `config.values`. */
export async function storedValues(request: APIRequestContext, testId: string, nodeId: string): Promise<Values> {
  const node = (await storedNodes(request, testId)).find((entry) => entry.id === nodeId)
  expect(node, `Block ${nodeId} is in the stored Test`).toBeTruthy()
  return (node!.data?.config?.values ?? {}) as Values
}

/** The stored values hold every expected field with exactly the expected value. */
export function expectHolds(values: Values, expected: Values, what: string): void {
  const held = Object.fromEntries(Object.keys(expected).map((name) => [name, values[name]]))
  expect(held, what).toEqual(expected)
}

/** A row's choice list (a Radix select). */
export const choiceTrigger = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-row-${name}"] button[role="combobox"]`).first()

/** A row's true / false box. */
export const trueFalseBox = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-row-${name}"] button[role="checkbox"]`).first()

/** Pick `label` in a row's choice list. */
export async function pickChoice(page: Page, sheet: Locator, name: string, label: string): Promise<void> {
  const trigger = choiceTrigger(sheet, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]:not([cmdk-list])')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: label, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(label)
}

/** Set a row's true / false box to `checked`. */
export async function setTrueFalse(sheet: Locator, name: string, checked: boolean): Promise<void> {
  const box = trueFalseBox(sheet, name)
  const state = checked ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== state) await box.click()
  await expect(box).toHaveAttribute('data-state', state)
}

/** Set the default host key action of Settings > Network > SSH Hosts (REQ-4.5.14). */
export async function setHostKeyDefault(request: APIRequestContext, action: HostKeyAction): Promise<void> {
  const response = await request.patch(`${BACKEND_URL}/network/ssh-hosts`, {
    data: { policy: { default_block_action: action } },
  })
  expect(response.ok(), `PATCH /network/ssh-hosts answered ${response.status()} ${await response.text()}`).toBeTruthy()
  const view = await response.json()
  expect(view.policy?.default_block_action).toBe(action)
}

/** Ids of the Blocks on the visible canvas. */
export function canvasBlocks(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('workflow-node-', '')))
}

/** Run a canvas action that adds exactly one Block and return its id. */
export async function addsOneBlock(page: Page, action: () => Promise<void>): Promise<string> {
  const before = await canvasBlocks(page)
  await action()
  let added: string[] = []
  await expect
    .poll(async () => {
      added = (await canvasBlocks(page)).filter((id) => !before.includes(id))
      return added.length
    }, { message: 'exactly one Block was added' })
    .toBe(1)
  return added[0]
}

/** Paste the canvas clipboard from the canvas menu opened at a free spot of the canvas. */
export async function pasteOnCanvas(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.locator('.react-flow__pane').click({ button: 'right', position: at })
  const paste = page.getByRole('menuitem', { name: /^Paste/ })
  await expect(paste).toBeVisible()
  await paste.click()
}

// --- Cipher Suites ---

export interface CipherCatalog {
  ciphers: Array<{ openssl: string; iana: string; min_version: string; max_version: string }>
  /** What an unset Cipher Suites sends, by Block and TLS range `<min>-<max>` (FIELD-10). */
  defaults: Record<string, Record<string, string[]>>
}

/** The cipher catalog and each Block's unset Cipher Suites list, from GET /api/v1/system/tls-capabilities. */
export async function cipherCatalog(request: APIRequestContext): Promise<CipherCatalog> {
  const response = await request.get(`${BACKEND_URL}/api/v1/system/tls-capabilities`)
  expect(response.ok(), `GET /api/v1/system/tls-capabilities answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body) as CipherCatalog
}

/** The unset Cipher Suites list of `block` for TLS `min` to `max`. */
export function defaultCiphers(catalog: CipherCatalog, block: string, min: string, max: string): string[] {
  const list = catalog.defaults[block]?.[`${min}-${max}`]
  expect(list, `${block} has a default list for TLS ${min} to ${max}`).toBeTruthy()
  return list!
}

/** The one value field's text box of a row (FIELD-1). */
export const lineBox = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-row-${name}"] input[data-slot="input-group-control"]`).first()

/** The list a Cipher Suites line holds, read from its one-line text. */
export async function cipherLine(sheet: Locator): Promise<string[]> {
  const text = await lineBox(sheet, 'cipher_suites').inputValue()
  return JSON.parse(text) as string[]
}

/** The sRGB color a CSS color resolves to on this page. */
export function resolvedCssColor(page: Page, css: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, css)
}

/** The row holds no value of its own: its line shows `list` in the gray of a default and has no reset icon. */
export async function expectGrayList(page: Page, sheet: Locator, name: string, list: string[], what: string): Promise<void> {
  const box = lineBox(sheet, name)
  await expect.poll(async () => JSON.parse((await box.inputValue()) || 'null'), { message: `${what}: the gray list` }).toEqual(list)
  const muted = await resolvedCssColor(page, 'var(--color-text-muted)')
  expect(await box.evaluate((el) => getComputedStyle(el).color), `${what}: the line is gray`).toBe(muted)
  await expect(sheet.locator(`[data-testid="param-reset-${name}"]`), `${what}: no reset icon`).toHaveCount(0)
}

/** The row holds `list` as its own value: value color and the reset icon. */
export async function expectOwnList(page: Page, sheet: Locator, name: string, list: string[], what: string): Promise<void> {
  const box = lineBox(sheet, name)
  await expect.poll(async () => JSON.parse((await box.inputValue()) || 'null'), { message: `${what}: the list` }).toEqual(list)
  const muted = await resolvedCssColor(page, 'var(--color-text-muted)')
  expect(await box.evaluate((el) => getComputedStyle(el).color), `${what}: the line is not gray`).not.toBe(muted)
  await expect(sheet.locator(`[data-testid="param-reset-${name}"]`), `${what}: the reset icon shows`).toHaveCount(1)
}

/** Select the whole line and delete it with Backspace, then type `text` key by key. */
export async function retypeLine(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  const box = lineBox(sheet, name)
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text)
}

/** Open the cipher picker from the Cipher Suites expand. */
export async function openCipherPicker(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole('button', { name: 'Open editor for Cipher Suites', exact: true }).click()
  const picker = page.locator('[data-testid="cipher-picker-sheet"]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-testid="cipher-picker-loading"]')).toHaveCount(0)
  return picker
}

/** The OpenSSL names of the picker rows, checked or not. */
export async function pickerRows(picker: Locator): Promise<{ checked: string[]; unchecked: string[] }> {
  const boxes = picker.locator('[data-testid^="cipher-toggle-"]')
  const rows = await boxes.evaluateAll((els) =>
    els.map((el) => ({
      name: (el.getAttribute('data-testid') ?? '').replace('cipher-toggle-', ''),
      checked: el.getAttribute('data-state') === 'checked',
    })),
  )
  return {
    checked: rows.filter((row) => row.checked).map((row) => row.name),
    unchecked: rows.filter((row) => !row.checked).map((row) => row.name),
  }
}

/** Save the cipher picker and wait for it to close. */
export async function savePicker(picker: Locator): Promise<void> {
  await picker.locator('[data-testid="cipher-picker-save-button"]').click()
  await expect(picker).toHaveCount(0)
}

// --- Time picker ---

/** The time picker a From / To row opens: a dialog named after the row label. */
export const timePicker = (page: Page, label: string): Locator => page.getByRole('dialog', { name: label, exact: true })

/** Open a time row's picker from its expand. */
export async function openTimeFromExpand(page: Page, sheet: Locator, name: string, label: string): Promise<Locator> {
  await sheet.locator(`[data-testid="param-expand-${name}"]`).click()
  const picker = timePicker(page, label)
  await expect(picker).toBeVisible()
  return picker
}

/** Put the Relative tab of an open picker on `amount` units ago and return the result line it shows. */
export async function setRelativeAmount(picker: Locator, label: string, amount: number): Promise<Locator> {
  const relative = picker.getByRole('group', { name: `${label} mode`, exact: true }).getByRole('button', { name: 'Relative', exact: true })
  if ((await relative.getAttribute('aria-pressed')) !== 'true') await relative.click()
  await expect(relative).toHaveAttribute('aria-pressed', 'true')
  const box = picker.getByRole('textbox', { name: 'Amount', exact: true })
  await box.fill(String(amount))
  await expect(box).toHaveValue(String(amount))
  return picker.locator('p.font-mono')
}
