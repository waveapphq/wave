/** Drives pencil edits, full runs and Run Current for the Function variable specs, and reads their console lines. */

import { expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { getLogTexts } from '../../helpers/log-reader'
import {
  expandVariableManager,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueSwitch,
  variableRow,
} from '../../helpers/variable-create'
import { digIn } from '../../helpers/workbench'

const STATUS = '[data-testid="workflow-status"]'
const RUN_END_TIMEOUT_MS = 60_000
const LINES_TIMEOUT_MS = 20_000

export const canvasBlock = (page: Page, blockId: string): Locator =>
  page.locator(`[data-testid="workflow-node-${blockId}"]`)

/** The value cell of a Variable Manager row. */
export const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

/** The eye of a Variable Manager row, which switches it between the live and the definition view. */
export const rowEye = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="view-toggle-button-"]')

interface BackendSession {
  id: string
  status: string
}

/** The workbench session the backend holds for the page right now ('' when none). */
export async function backendSession(page: Page): Promise<BackendSession> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as {
    data?: { session_id?: string; status?: string } | null
  } | null
  return { id: body?.data?.session_id ?? '', status: body?.data?.status ?? '' }
}

/** Start a run and wait until that run's own session ends passed; an earlier verdict on the page never counts. */
async function endsPassed(page: Page, start: () => Promise<void>, what: string): Promise<void> {
  const earlier = (await backendSession(page)).id
  await start()
  await expect
    .poll(
      async () => {
        const now = await backendSession(page)
        return now.id === earlier ? 'not started' : now.status
      },
      { timeout: RUN_END_TIMEOUT_MS, intervals: [250, 500, 1_000], message: `${what} ends` },
    )
    .toBe('passed')
  await expect(page.locator(STATUS), `the page shows the verdict of ${what}`).toHaveAttribute(
    'data-status',
    'passed',
    { timeout: 15_000 },
  )
}

/** Run the whole Test from the action bar and wait for it to pass. */
export async function runTestToEnd(page: Page): Promise<void> {
  await endsPassed(page, () => page.locator('[data-testid="run-button"]').click(), 'the full run')
}

/** Run Current on one block from its kebab and wait for that run to pass. */
export async function runCurrentToEnd(page: Page, blockId: string): Promise<void> {
  await endsPassed(
    page,
    () => clickNodeKebabItem(page, blockId, 'Run Current'),
    `Run Current on ${blockId}`,
  )
}

/** Open a Function on the canvas and show its variables. */
export async function openFunction(page: Page, functionId: string, bodyBlockId: string): Promise<void> {
  await digIn(page, functionId)
  await expect(canvasBlock(page, bodyBlockId), 'the opened Function shows its body').toBeVisible({
    timeout: 15_000,
  })
  await expandVariableManager(page)
}

/** Change an integer variable's definition with the pencil of its Variable Manager row. */
export async function editWithPencil(page: Page, name: string, value: string): Promise<void> {
  const win = await openEditWindow(page, name)
  // The pencil opens on the definition, never the live value.
  await expect(valueSwitch(win)).toHaveText('Initial')
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
}

/** The console lines that start with `prefix`, in the order they were written. */
export async function linesStarting(page: Page, prefix: string): Promise<string[]> {
  return (await getLogTexts(page)).filter((text) => text.startsWith(prefix))
}

/** The console holds exactly these lines for `prefix`, in this order. */
export async function expectLines(
  page: Page,
  prefix: string,
  expected: readonly string[],
  criterion: string,
): Promise<void> {
  await expect
    .poll(() => linesStarting(page, prefix), { timeout: LINES_TIMEOUT_MS, message: criterion })
    .toEqual([...expected])
}
