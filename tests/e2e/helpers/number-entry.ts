/** Number box keystrokes and pastes, refused saves and import dry runs the number rule specs share (REQ-3.1.3.14). */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { openImportDialog, type ImportFile, type ImportListRoute } from './fixture-import'

/** Empty a text box, then type `text` one key at a time, as a person does. */
export async function typeKeys(box: Locator, text: string): Promise<void> {
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.press('Delete')
  await box.pressSequentially(text)
}

/** Typing `text` into the emptied box leaves exactly `shown`: every key the rule refuses is dropped. */
export async function expectTypedAs(box: Locator, text: string, shown: string): Promise<void> {
  await typeKeys(box, text)
  await expect(box, `typing "${text}" leaves "${shown}"`).toHaveValue(shown)
}

/** Type `keys` at the end of what the box holds, without emptying it. */
export async function typeAtEnd(box: Locator, keys: string): Promise<void> {
  await box.click()
  await box.press('End')
  await box.pressSequentially(keys)
}

/** Put `text` on the clipboard and paste it over everything the box holds. */
export async function pasteOver(page: Page, box: Locator, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.press('ControlOrMeta+v')
}

/** An answer from `page.request` or one the page received. */
export interface Answer {
  ok(): boolean
  status(): number
  text(): Promise<string>
}

/** One finding a refused save names. */
export interface Finding {
  code?: string
  message: string
  path?: string
}

/** What a refused write answered: its status, its message and every finding it lists. */
export interface Refusal {
  status: number
  message: string
  findings: Finding[]
}

function findingsOf(details: unknown): Finding[] {
  if (!Array.isArray(details)) return []
  return details.flatMap((detail): Finding[] => {
    const entry = detail as { errors?: unknown; message?: unknown }
    if (Array.isArray(entry.errors)) return entry.errors as Finding[]
    return typeof entry.message === 'string' ? [entry as Finding] : []
  })
}

/** The refusal a write answered; fails when the write was taken. */
export async function refusalOf(response: Answer, what: string): Promise<Refusal> {
  const text = await response.text()
  expect(response.ok(), `${what} is refused, but it answered ${response.status()} ${text}`).toBeFalsy()
  const body = JSON.parse(text) as { error?: { message?: string; details?: unknown }; detail?: unknown }
  return {
    status: response.status(),
    message: body.error?.message ?? String(body.detail ?? ''),
    findings: findingsOf(body.error?.details),
  }
}

/** The messages of the findings with `code`, in order. */
export function messagesOf(refusal: Refusal, code: string): string[] {
  return refusal.findings.filter((finding) => finding.code === code).map((finding) => finding.message)
}

/** One item of an import dry run. */
export interface DryRunItem {
  name: string
  status: string
  fatal_errors: Array<{ code: string; message: string }>
  fixable_errors?: Array<{ code: string; message: string }>
}

/** A list page's Import dialog after Validate: the dialog on its review step and the dry run's items. */
export interface DryRun {
  dialog: Locator
  items: DryRunItem[]
}

/** Choose `file` in a list page's Import dialog and Validate it; nothing is imported. */
export async function importDryRun(
  page: Page,
  route: ImportListRoute,
  file: ImportFile,
  listKey: string,
): Promise<DryRun> {
  const dialog = await openImportDialog(page, route, file)
  return validateInDialog(page, dialog, listKey)
}

/** Click Validate in an open Import dialog and read the dry run's `listKey` items. */
export async function validateInDialog(page: Page, dialog: Locator, listKey: string): Promise<DryRun> {
  const dryRun = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/import/validate'),
  )
  await dialog.locator('[data-testid="validate-button"]').click()
  const answer = await dryRun
  expect(answer.ok(), `the dry run answered ${answer.status()}`).toBeTruthy()
  const data = (await answer.json()).data as Record<string, unknown>
  await expect(dialog.locator('[data-testid="review-step"]')).toBeVisible()
  return { dialog, items: (data[listKey] ?? []) as DryRunItem[] }
}

/** The dry run blocks the item `name` with exactly `message`, and its row in the dialog reads Blocked. */
export async function expectBlocked(dryRun: DryRun, name: string, message: string): Promise<void> {
  const item = dryRun.items.find((candidate) => candidate.name === name)
  expect(item, `the dry run lists ${name}`).toBeTruthy()
  expect(item!.status, `${name} is blocked`).toBe('fatal')
  expect(item!.fatal_errors.map((error) => error.message), `${name} names its problem`).toEqual([message])
  await expect(dryRun.dialog.locator(`[data-testid="item-result-${name}"]`)).toContainText('Blocked')
}

/** Close a config sheet without keeping its edits: Cancel, then Close on the unsaved-changes question. */
export async function discardBlockSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  const question = page.locator('[data-testid="unsaved-changes-dialog"]')
  await expect
    .poll(async () => (await question.isVisible()) || (await sheet.count()) === 0, {
      message: 'the sheet closes or asks about its unsaved changes',
    })
    .toBe(true)
  if (await question.isVisible()) await question.locator('[data-testid="unsaved-close"]').click()
  await expect(sheet).toHaveCount(0)
}

/** The raw JSON text a response carried, so a number past 2^53 is read with every digit. */
export async function rawBody(response: Answer, what: string): Promise<string> {
  const text = await response.text()
  expect(response.ok(), `${what} answered ${response.status()} ${text}`).toBeTruthy()
  return text
}
