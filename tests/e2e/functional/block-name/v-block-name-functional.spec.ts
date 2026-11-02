/**
 * V-BLOCK-NAME-FUNCTIONAL: WAVE names a block by its Name, never by its Description
 * Wireframe: N/A
 * Design Decisions: EXEC-26, EXEC-25
 * REQ: REQ-3.2.2.6, REQ-3.4.2.7, REQ-3.5.1.2, REQ-3.5.1.3
 *
 * Every block of these fixtures carries a Name and a Description that share no text, so a surface
 * that shows the Description where the Name belongs fails its check twice: the Name is missing and
 * the Description is there.
 *
 * Pass Criteria:
 * 1. A block named `PSQL` fails its run: the engine line reads `Block 'PSQL' failed: ...`, and no
 *    console line holds any block's Description, in its message or in its Source.
 * 2. `Executing '{Name}' ({kind}/{type})`, `Completed '{Name}'`, `Skipping '{Name}' (disabled)` and
 *    `Skipping '{Name}' (skipped)` carry the Name, and every block status event carries the Name
 *    of the block its id names.
 * 3. A block fails inside a Try / Catch: the Catch path reads `error.node` as that block's Name,
 *    and the error the control binds holds the same Name.
 * 4. A block named `Load rows` writes the variable `rows`: its binding line, the delete
 *    confirmation in the Variable Manager and the variable list of both expression editors name
 *    `Load rows`.
 * 5. The Target Loop list of a Break and of a Continue reads `{Type}: {Name}` for a loop with its
 *    own Name and for one that keeps a default name, and the option picked by Name is the loop
 *    the run leaves.
 * 6. A loop whose Name is empty reads `{Type}: No Title`.
 * 7. A block imported or saved with no Name (empty, spaces or none) gets the palette name of its
 *    type: the stored Test holds it, the canvas shows it, and each console line of the block has
 *    that name alone as its Source.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importedTestId,
  importExpectingErrors,
  importFixtureTest,
  importThroughListPage,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
} from '../../helpers/fixture-import'
import { codesOf, validateTest } from '../../helpers/fn-seed'
import { finishRun, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import {
  formatEntries,
  getLogCopyTexts,
  getLogEntries,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  cancelCreate,
  expandVariableManager,
  openCreateModal,
  setCreateKind,
  valueEditor,
  variableRow,
} from '../../helpers/variable-create'
import { clickNodeContextMenuItem } from '../../helpers/workbench'
import { openSessionEventCollector, type WsEvent } from '../../helpers/ws-events'
import {
  closeConfig,
  deleteTest,
  openConfig,
  openTestOnCanvas,
  persistedNodes,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    label?: string
    description?: string
    elementType: string
    disabled?: boolean
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

const RUN_END = 'halted with status: failed'
const PSQL_FAILED = "Block 'PSQL' failed: RuntimeError: seed rows are missing"
const CHARGE_FAILED =
  "Block 'Charge card' failed: Expression evaluation failed for '1/0': division by zero"
const DELETE_ROWS =
  'This action cannot be undone. The variable is bound as output by 1 block (Load rows) - those bindings will be cleared.'
const ROWS_SOURCE = 'table \u2190 Load rows'
const ROWS_BOUND = "'Load rows' \u2192 rows"
const PASS_LINE = 'bn-loop-pass'
const UNNAMED_END = 'bn-unnamed-done'

/** What the palette calls each block type of the unnamed fixture (EXEC-25). */
const PALETTE_NAMES: Record<string, string> = {
  for: 'For Loop',
  'csv-parser': 'CSV',
  'try-catch-finally': 'Try / Catch',
  'variable-setter': 'Var Setter',
  log: 'Log',
}

const createdTests: string[] = []

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

/** The one fixture block that carries this Name. */
function block(fixture: Fixture, name: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
  expect(found, `the fixture holds one block named "${name}"`).toHaveLength(1)
  return found[0]
}

/** The Description of the fixture block with this Name. */
function descriptionOf(fixture: Fixture, name: string): string {
  const description = block(fixture, name).data.description ?? ''
  expect(description, `"${name}" carries a Description`).not.toBe('')
  expect(description, `the Description of "${name}" does not repeat its Name`).not.toContain(name)
  return description
}

/** Every Description the fixture's blocks carry. */
function descriptionsOf(fixture: Fixture): string[] {
  return fixture.workflow.nodes
    .map((node) => node.data.description ?? '')
    .filter((description) => description !== '')
}

const canvasBlock = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="workflow-node-${id}"]`)

/** The engine wrote this line itself: level, Source SYSTEM and the exact message. */
function expectEngineLine(entries: readonly LogEntry[], level: string, message: string): void {
  expect(
    entries.some(
      (entry) => entry.level === level && entry.source === 'SYSTEM' && entry.message === message,
    ),
    `the console must carry [${level}] SYSTEM: "${message}".\n${formatEntries(entries)}`,
  ).toBe(true)
}

/** No console row shows this text, in its message, in its Source or in what it copies. */
function expectNowhereInConsole(
  entries: readonly LogEntry[],
  copyTexts: readonly string[],
  text: string,
): void {
  for (const entry of entries) {
    expect(entry.message, `a console message holds "${text}"`).not.toContain(text)
    expect(entry.source, `a console Source holds "${text}"`).not.toContain(text)
  }
  for (const copied of copyTexts) {
    expect(copied, `a copied console row holds "${text}"`).not.toContain(text)
  }
}

/** The open suggestion list of an expression editor, as label and detail pairs. */
async function suggestions(page: Page): Promise<Array<{ label: string; detail: string }>> {
  const list = page.locator('.cm-tooltip-autocomplete')
  await expect(list).toBeVisible({ timeout: 5_000 })
  return list.locator('li').evaluateAll((items) =>
    items.map((item) => ({
      label: (item.querySelector('.cm-completionLabel')?.textContent ?? '').trim(),
      detail: (item.querySelector('.cm-completionDetail')?.textContent ?? '').trim(),
    })),
  )
}

/** Type `ro` into an expression editor and assert how its list presents the variable `rows`. */
async function expectRowsSuggestion(page: Page, editor: Locator, description: string): Promise<void> {
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('ro', { delay: 40 })
  const offered = await suggestions(page)
  expect(
    offered.filter((option) => option.label === 'rows'),
    `the list names the block that writes rows: ${JSON.stringify(offered)}`,
  ).toEqual([{ label: 'rows', detail: ROWS_SOURCE }])
  await expect(page.locator('.cm-tooltip-autocomplete')).not.toContainText(description)
}

const targetLoop = (sheet: Locator): Locator => sheet.locator('#target-loop-select')

/** Open the Target Loop list of a Break or Continue sheet. */
async function openTargetLoops(page: Page, sheet: Locator): Promise<Locator> {
  await targetLoop(sheet).click()
  const list = page.locator('[role="listbox"]:not([cmdk-list])')
  await expect(list).toBeVisible()
  return list
}

/** Pick one Target Loop option by its text and wait for the list to close on it. */
async function pickTargetLoop(list: Locator, sheet: Locator, option: string): Promise<void> {
  await list.getByRole('option', { name: option, exact: true }).click()
  await expect(list).toHaveCount(0)
  await expect(targetLoop(sheet)).toHaveText(option)
}

/** The Name each block of a stored Test holds, by block id. */
async function storedNames(
  request: APIRequestContext,
  testId: string,
): Promise<Record<string, unknown>> {
  const nodes = await persistedNodes(request, testId)
  return Object.fromEntries(Object.entries(nodes).map(([id, data]) => [id, data.label]))
}

test.describe('V-BLOCK-NAME-FUNCTIONAL: a block is named by its Name (EXEC-26)', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('a run names its blocks by Name in console lines, status events and the caught error', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const fixture = loadFixture('fixture.json')
    const descriptions = descriptionsOf(fixture)
    expect(descriptions, 'every block of the run carries a Description').toHaveLength(
      fixture.workflow.nodes.length,
    )
    expect(block(fixture, 'Muted step').data.disabled, 'the fixture mutes "Muted step"').toBe(true)

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const skipped = block(fixture, 'Skipped step')
    await clickNodeContextMenuItem(page, skipped.id, /^Skip$/)
    await expect(canvasBlock(page, skipped.id)).toHaveAttribute('data-skipped', 'true')

    // The leading Delay holds the run until the collector has subscribed.
    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId)
    const { verdict } = await finishRunAnyVerdict(page, status, RUN_END, 60_000)
    const entries = await getLogEntries(page)
    const copyTexts = await getLogCopyTexts(page)
    const events = await collector.harvest()
    await collector.close()
    const variables = await getSessionVariables(page, sessionId)

    await test.step('the failed block is named PSQL and no console line holds a Description', () => {
      expect(verdict, `the last block fails the run.\n${formatEntries(entries)}`).toBe('failed')
      descriptionOf(fixture, 'PSQL')
      expectEngineLine(entries, 'ERROR', PSQL_FAILED)
      expect(copyTexts, 'every console row was read with its copied text').toHaveLength(entries.length)
      expect(
        entries.map((entry) => entry.message).filter((message) => /^Block '.*' failed: /.test(message)),
        'the engine reports two failed blocks, each by its Name',
      ).toEqual([CHARGE_FAILED, PSQL_FAILED])
      for (const description of descriptions) expectNowhereInConsole(entries, copyTexts, description)
    })

    await test.step('the Executing, Completed and Skipping lines carry the Name', () => {
      descriptionOf(fixture, 'Say hello')
      expectEngineLine(entries, 'DEBUG', "Executing 'Say hello' (plugin/log)")
      expectEngineLine(entries, 'DEBUG', "Completed 'Say hello'")
      descriptionOf(fixture, 'Muted step')
      expectEngineLine(entries, 'INFO', "Skipping 'Muted step' (disabled)")
      descriptionOf(fixture, 'Skipped step')
      expectEngineLine(entries, 'INFO', "Skipping 'Skipped step' (skipped)")
      expectEngineLine(entries, 'DEBUG', "Executing 'Guard the charge' (control/try-catch-finally)")
      expectEngineLine(entries, 'DEBUG', "Completed 'Guard the charge'")
      expectEngineLine(entries, 'DEBUG', "Executing 'PSQL' (plugin/python)")
      for (const never of ['bn-muted-never', 'bn-skipped-never']) {
        expect(
          entries.some((entry) => entry.message.includes(never)),
          `a skipped block wrote "${never}"`,
        ).toBe(false)
      }
    })

    await test.step('every block status event carries the Name of its block', () => {
      const nameById = new Map(fixture.workflow.nodes.map((node) => [node.id, node.data.label]))
      const statusEvents = events.filter((event: WsEvent) => event.type === 'block_status_changed')
      for (const event of statusEvents) {
        const told = JSON.stringify(event)
        expect(nameById.has(String(event.block_id)), `a status event names no fixture block: ${told}`).toBe(
          true,
        )
        expect(event.block_name, `the status event carries the block's Name: ${told}`).toBe(
          nameById.get(String(event.block_id)),
        )
        for (const description of descriptions) {
          expect(told, 'a status event holds a Description').not.toContain(description)
        }
      }
      const statusesOf = (name: string): unknown[] =>
        statusEvents
          .filter((event) => event.block_id === block(fixture, name).id)
          .map((event) => event.status)
      expect(statusesOf('Say hello')).toEqual(['running', 'passed'])
      expect(statusesOf('Muted step')).toEqual(['skipped'])
      expect(statusesOf('Skipped step')).toEqual(['skipped'])
      expect(statusesOf('Guard the charge')).toEqual(['running', 'passed'])
      expect(statusesOf('Charge card')).toEqual(['running', 'failed'])
      expect(statusesOf('Report the charge')).toEqual(['running', 'passed'])
      expect(statusesOf('After the charge')).toEqual(['running', 'passed'])
      expect(statusesOf('PSQL')).toEqual(['running', 'failed'])
    })

    await test.step('the Catch path reads error.node as the failed block Name', () => {
      const chargeDescription = descriptionOf(fixture, 'Charge card')
      expectEngineLine(entries, 'ERROR', CHARGE_FAILED)
      // A row's copied text keeps the whole Source; the Source column cuts it to its width.
      expect(
        consoleEntriesFromCopy(copyTexts).filter((entry) => entry.message.startsWith('bn-catch node=')),
        `the Catch path wrote what it read.\n${formatEntries(entries)}`,
      ).toEqual([
        {
          level: 'WARN',
          source: blockSource('Log', 'Report the charge'),
          message: 'bn-catch node=Charge card',
        },
      ])
      const error = sessionValue(variables, 'charge_error') as Record<string, unknown>
      expect(error.node, 'error.node is the failed block Name').toBe('Charge card')
      expect(error.node_id, 'the error names the block that failed').toBe(
        block(fixture, 'Charge card').id,
      )
      expect(JSON.stringify(error), 'the error holds the Description').not.toContain(chargeDescription)
      expect(sessionValue(variables, 'charge_caught')).toBe(true)
    })
  })

  test('the delete confirmation and the expression editors name the block that writes a variable', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const fixture = loadFixture('fixture-variable.json')
    const loader = block(fixture, 'Load rows')
    const description = descriptionOf(fixture, 'Load rows')
    expect(loader.data.config.outputBindings, 'the fixture binds the table to rows').toEqual({
      table: 'rows',
    })

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)

    await test.step('the run binds the table and the binding line names Load rows', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const status = await startRun(page)
      await finishRun(page, status, 'bn-rows-loaded', 60_000)
      const entries = await getLogEntries(page)
      const copyTexts = await getLogCopyTexts(page)
      expectEngineLine(entries, 'DEBUG', ROWS_BOUND)
      expect(copyTexts, 'every console row was read with its copied text').toHaveLength(entries.length)
      expectNowhereInConsole(entries, copyTexts, description)
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionTable(variables, 'rows').rows, 'rows holds what Load rows read').toEqual([
        [1, 'Alice'],
        [2, 'Bob'],
      ])
    })

    await test.step("the Variable Manager's expression editor lists Load rows as the source", async () => {
      await openCreateModal(page)
      await setCreateKind(page, 'Expression')
      await expectRowsSuggestion(page, valueEditor(page), description)
      await leaveExpressionEditor(valueEditor(page))
      await cancelCreate(page)
    })

    await test.step('deleting rows names Load rows in the confirmation', async () => {
      await expandVariableManager(page)
      const row = variableRow(page, 'rows')
      await expect(row).toBeVisible()
      await row.hover()
      const remove = row.getByRole('button', { name: 'Delete rows', exact: true })
      await expect(remove).toBeEnabled({ timeout: 15_000 })
      await remove.click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText('Delete "rows"?')
      await expect(dialog).toHaveAccessibleDescription(DELETE_ROWS)
      await expect(dialog).not.toContainText(description)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(row, 'Cancel keeps the variable').toBeVisible()
    })

    await test.step("a block's expression editor lists Load rows as the source", async () => {
      const sheet = await openConfig(page, block(fixture, 'Show the rows').id)
      await expectRowsSuggestion(
        page,
        sheet.locator('[data-testid="param-input-message"] .cm-content'),
        description,
      )
    })
  })

  test('the Target Loop list of a Break and a Continue names each loop by its Name', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const fixture = loadFixture('fixture-loops.json')
    const outer = block(fixture, 'Retry upload')
    const inner = block(fixture, 'For Loop_1')
    const breakBlock = block(fixture, 'Stop early')
    const continueBlock = block(fixture, 'Next attempt')
    const outerDescription = descriptionOf(fixture, 'Retry upload')
    expect('description' in inner.data, 'the default-named loop has no Description, as on a drop').toBe(
      false,
    )
    expect(breakBlock.data.config.values.target_loop, 'the fixture breaks the inner loop').toBe(inner.id)
    expect(continueBlock.data.config.values.target_loop).toBe(inner.id)
    const options = ['For Loop: Retry upload', 'For Loop: For Loop_1']

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)

    await test.step('the Continue list reads {Type}: {Name}', async () => {
      const sheet = await openConfig(page, continueBlock.id)
      await expect(targetLoop(sheet)).toHaveText('For Loop: For Loop_1')
      const list = await openTargetLoops(page, sheet)
      await expect(list.getByRole('option')).toHaveText(options)
      await expect(list).not.toContainText(outerDescription)
      await pickTargetLoop(list, sheet, 'For Loop: For Loop_1')
      await closeConfig(sheet)
    })

    await test.step('the Break list reads {Type}: {Name} and Retry upload is picked from it', async () => {
      const sheet = await openConfig(page, breakBlock.id)
      await expect(targetLoop(sheet)).toHaveText('For Loop: For Loop_1')
      const list = await openTargetLoops(page, sheet)
      await expect(list.getByRole('option')).toHaveText(options)
      await expect(list).not.toContainText(outerDescription)
      await pickTargetLoop(list, sheet, 'For Loop: Retry upload')
      await saveConfig(sheet)
      await saveWorkbench(page)
      const saved = await persistedValues(page.request, testId)
      expect(saved[breakBlock.id].target_loop, 'the option names the loop it stores').toBe(outer.id)
    })

    await test.step('the run leaves the loop named Retry upload on its first pass', async () => {
      const status = await startRun(page)
      await finishRun(page, status, 'bn-loops-done', 60_000)
      const entries = await getLogEntries(page)
      expect(
        entries.filter((entry) => entry.message === PASS_LINE),
        `breaking the inner loop gives two passes, breaking Retry upload gives one.\n${formatEntries(entries)}`,
      ).toHaveLength(1)
    })
  })

  test('a loop with an empty Name reads No Title in the Target Loop list', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = loadFixture('fixture-loops-blank.json')
    const blank = block(fixture, '')
    const breakBlock = block(fixture, 'Stop early')
    const outerDescription = descriptionOf(fixture, 'Retry upload')
    expect(blank.data.elementType).toBe('for')
    expect(breakBlock.data.config.values.target_loop, 'the fixture breaks the unnamed loop').toBe(blank.id)

    // Saving fills an empty Name in, so only a stored file can hold one.
    const imported = await importExpectingErrors(page, fixture, { context: 'load' })
    createdTests.push(imported.testId)
    expect(codesOf(imported.errors), 'the empty Name is the only thing wrong').toEqual(['MISSING_LABEL'])
    expect(imported.errors[0].node_id).toBe(blank.id)

    const sheet = await openConfig(page, breakBlock.id)
    await expect(targetLoop(sheet)).toHaveText('For Loop: No Title')
    const list = await openTargetLoops(page, sheet)
    await expect(list.getByRole('option')).toHaveText(['For Loop: Retry upload', 'For Loop: No Title'])
    await expect(list).not.toContainText(outerDescription)
  })

  test('a block that arrives with no Name gets the palette name of its type', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = loadFixture('fixture-unnamed.json')
    expect(
      fixture.workflow.nodes.map((node) => node.data.label ?? null),
      'the file names no block: an empty Name, none at all, one of spaces',
    ).toEqual(['', null, '   ', '', ''])
    const names = Object.fromEntries(
      fixture.workflow.nodes.map((node) => [node.id, PALETTE_NAMES[node.data.elementType]]),
    )
    expect(Object.values(names), 'one block of each type').toEqual(Object.values(PALETTE_NAMES))

    await ensureEnvironment(page.request)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    const file: Fixture = {
      ...fixture,
      name: `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }

    const testId = await test.step('the Tests page imports the file', async () => {
      const review = await importThroughListPage(page, '/tests', {
        name: 'unnamed-blocks.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file), 'utf-8'),
      })
      expect(review.summary).toBe('1 importable, 0 blocked')
      expect(review.items[file.name], 'the dialog says the file will be fixed').toContain('Will auto-fix')
      return importedTestId(page, file.name)
    })
    createdTests.push(testId)

    await test.step('the stored Test holds the palette name of each type', async () => {
      expect(await storedNames(page.request, testId)).toEqual(names)
      const checked = await validateTest(page.request, testId, 'run')
      expect(checked.errors, 'the imported Test has nothing left to fix').toEqual([])
      expect(checked.status).toBe(200)
    })

    await test.step('the canvas shows each block under that name', async () => {
      await openTestOnCanvas(page, testId)
      for (const [id, name] of Object.entries(names)) {
        await expect(page.getByTestId(`workflow-node-body-${id}`)).toHaveText(name)
      }
    })

    await test.step('every console line of a block has the palette name alone as its Source', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const status = await startRun(page)
      await finishRun(page, status, UNNAMED_END, 60_000)
      const entries = await getLogEntries(page)
      const copied = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(copied, 'every console row was read with its copied text').toHaveLength(entries.length)
      const blockSources = Object.values(names).map((name) => blockSource(name, name))
      expect(
        [...new Set(copied.map((entry) => entry.source))].sort(),
        `each block writes under its type name and nothing else does.\n${formatEntries(copied)}`,
      ).toEqual([...blockSources, 'SYSTEM'].sort())
      expectEngineLine(entries, 'DEBUG', "Executing 'For Loop' (control/for)")
      expectEngineLine(entries, 'DEBUG', "Completed 'For Loop'")
      expectEngineLine(entries, 'DEBUG', "Executing 'Try / Catch' (control/try-catch-finally)")
      expectEngineLine(entries, 'DEBUG', "Executing 'Log' (plugin/log)")
      expectEngineLine(entries, 'DEBUG', "'For Loop' \u2192 pass_index")
      expectEngineLine(entries, 'DEBUG', "'CSV' \u2192 rows")
    })

    await test.step('a Test saved through the API gets the same names', async () => {
      const savedId = await importFixtureTest(page, fixture, { rejectRepairs: true })
      createdTests.push(savedId)
      expect(await storedNames(page.request, savedId)).toEqual(names)
    })
  })
})
