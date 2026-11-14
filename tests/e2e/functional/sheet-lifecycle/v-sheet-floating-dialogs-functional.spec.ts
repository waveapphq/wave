/**
 * V-SHEET-FLOATING-DIALOGS (functional): every floating window is a non-modal dialog named by its title
 * Design Decisions: CANVAS-227, VMGR-106, TDATA-9
 * REQ: REQ-5.2.1.32, REQ-5.2.1.33
 *
 * Setup (API): each test stores its own `zz-win-<n>` Test through `POST /tests`, checks that
 * `POST /tests/{id}/validate` finds no error, and deletes it after.
 *
 * Pass Criteria:
 * 1. Each window is found as the dialog named by its visible title, is not marked modal and is not shown as a
 *    modal dialog: Quick Insert; the variable window of a Function input and output, Add and Edit; Edit value
 *    from the value editor for a text, list, map and table value; the Block window (`<Name> - Edit Config`);
 *    Profiles; Edit value from the Parts editor and from the cipher picker; the file picker in its four modes
 *    (`Choose a file`, `Choose a file or folder`, `Choose a folder`, `Save as`); Functions Library; Test Data;
 *    Session Artifacts.
 * 2. While each window is open, the Variable Manager's Add button on the page behind is still found by its
 *    role, and a click on it still opens a `New variable` window; the window under test stays open.
 * 3. Quick Insert opens with the cursor in its search box.
 * 4. The input and output windows open with the cursor in Name; in Edit, Name holds the parameter's name.
 * 5. Edit value opens with the cursor inside its editor for every value kind: the code editor of a text, the
 *    list, map and table bodies.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { expandPalette } from '../../helpers/canvas'
import { openCipherPicker } from '../../helpers/choice-tls'
import { closeBlockSheet } from '../../helpers/entry-editors'
import {
  cleanUp,
  createTest,
  localFunctionBlock,
  logBlock,
  openBlockWindow,
  pluginBlock,
  type Rec,
} from '../../helpers/fn-block'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { openGroup } from '../../helpers/list-fields'
import {
  cancelCreate,
  cancelWindow,
  closeValueEditor,
  expandVariableManager,
  openEditWindow,
  openFunctionCreateModal,
  openValueEditor,
  variableRow,
} from '../../helpers/variable-create'
import { digIn } from '../../helpers/workbench'
import { openPicker, PICKER_TITLES, type PickerMode } from '../file-picker/picker'

const NAME_FIELD = 'create-variable-name'

type Scope = 'test' | 'function'

/** The floating window named `title`: the dialog by its visible title, never modal; `testId` pins which window it is. */
async function floatingDialog(page: Page, title: string, testId?: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await expect(dialog, `${title}: the dialog named by its title`).toBeVisible()
  if (testId) await expect(dialog, `${title}: the named dialog is the window itself`).toHaveAttribute('data-testid', testId)
  await expect(dialog, `${title}: not marked modal`).not.toHaveAttribute('aria-modal', 'true')
  expect(await dialog.evaluate((el) => el.matches(':modal')), `${title}: not shown as a modal dialog`).toBe(false)
  return dialog
}

/** The page behind stays usable: Add is found by its role and still opens a New variable window, which Escape closes. */
async function expectPageBehindWorks(page: Page, dialog: Locator, title: string, scope: Scope = 'test'): Promise<void> {
  const add = page.getByTestId('variable-manager-content').getByRole('button', { name: 'Add', exact: true })
  await expect(add, `${title}: the Add button behind is found by its role`).toBeVisible()
  const added = page.getByRole('dialog', { name: 'New variable', exact: true })
  const before = await added.count()
  // Inside a Function, Add opens its menu first; the menu that opened the window has finished closing.
  if (scope === 'function') await expect(page.getByRole('menu')).toHaveCount(0)
  await add.click()
  if (scope === 'function') await page.getByRole('menuitem', { name: 'Variable', exact: true }).click()
  await expect(added, `${title}: Add still opens a New variable window`).toHaveCount(before + 1)
  await expect(dialog, `${title}: the window stays open`).toBeVisible()
  // A menu still closing would take the Escape for itself.
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(added, `${title}: Escape closes the New variable window in front`).toHaveCount(before)
  await expect(dialog, `${title}: the window is still open`).toBeVisible()
}

async function closeFromHeader(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(dialog).toHaveCount(0)
}

test.describe('V-SHEET-FLOATING-DIALOGS: every floating window is a named non-modal dialog', () => {
  const testIds: string[] = []

  /** Store a `zz-win-<n>` Test that validates with no error, open it and expand the Variable Manager. */
  async function seedAndOpen(page: Page, n: number, nodes: Rec[], variables: Rec = {}): Promise<string> {
    const name = `zz-win-${n}-${randomUUID().slice(0, 6)}`
    const testId = await createTest(page.request, { name, nodes, variables })
    testIds.push(testId)
    const validation = await validateTest(page.request, testId)
    expect(validation.errors, `${name} validates with no error`).toEqual([])
    await openTest(page, testId)
    await expandVariableManager(page)
    return testId
  }

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('Quick Insert is a named non-modal dialog with the cursor in its search box', async ({ page }) => {
    await seedAndOpen(page, 1, [logBlock('win-log', 'Say Hello', "'hello'")])

    await page.keyboard.press('Control+Space')
    const dialog = await floatingDialog(page, 'Quick Insert', 'quick-add-popover')
    await expect(
      dialog.getByRole('combobox', { name: 'Search blocks', exact: true }),
      'the cursor is in the search box',
    ).toBeFocused()
    await expectPageBehindWorks(page, dialog, 'Quick Insert')
    await closeFromHeader(dialog)
  })

  test('the input and output windows, Add and Edit, are named by their titles with the cursor in Name', async ({
    page,
  }) => {
    const fnId = 'win-fn'
    await seedAndOpen(page, 2, [
      localFunctionBlock(fnId, 'Params_Fn', {
        nodes: [logBlock('win-fn-log', 'Print Input', "f'in={zz_in}'")],
        inputs: [{ name: 'zz_in', type: 'string', required: false, description: '' }],
        outputs: [{ name: 'zz_out', type: 'string', description: '' }],
      }),
    ])
    await digIn(page, fnId)
    await expect(variableRow(page, 'zz_in'), 'the drilled scope lists the input').toBeVisible()

    for (const [mode, title] of [
      ['input', 'New input parameter'],
      ['output', 'New output parameter'],
    ] as const) {
      await test.step(title, async () => {
        const win = await openFunctionCreateModal(page, mode)
        const dialog = await floatingDialog(page, title, 'variable-create-modal')
        await expect(dialog.getByTestId(NAME_FIELD), `${title}: the cursor is in Name`).toBeFocused()
        await expectPageBehindWorks(page, dialog, title, 'function')
        await cancelCreate(page, win)
      })
    }

    for (const [name, title] of [
      ['zz_in', 'Edit input parameter'],
      ['zz_out', 'Edit output parameter'],
    ] as const) {
      await test.step(title, async () => {
        const win = await openEditWindow(page, name)
        const dialog = await floatingDialog(page, title, 'variable-create-modal')
        await expect(dialog.getByTestId(NAME_FIELD), `${title}: the cursor is in Name`).toBeFocused()
        await expect(dialog.getByTestId(NAME_FIELD)).toHaveValue(name)
        await expectPageBehindWorks(page, dialog, title, 'function')
        await cancelWindow(page, win)
      })
    }
  })

  for (const { n, kind, variable, body } of [
    { n: 3, kind: 'text', variable: { type: 'string', value: 'hello' }, body: null },
    { n: 4, kind: 'list', variable: { type: 'array', value: ['web-1', 'web-2'] }, body: 'array-edit-body' },
    { n: 5, kind: 'map', variable: { type: 'map', value: { cpu: '2' } }, body: 'map-edit-body' },
    {
      n: 6,
      kind: 'table',
      variable: { type: 'table', value: { columns: [{ name: 'host', type: 'string' }], rows: [['db-1']] } },
      body: 'table-edit-body',
    },
  ]) {
    test(`Edit value from the value editor puts the cursor inside its editor for a ${kind}`, async ({ page }) => {
      const name = 'held'
      await seedAndOpen(page, n, [logBlock('win-log', 'Print Value', "f'{held}'")], {
        [name]: { ...variable, scope: 'test' },
      })
      const title = `Edit value (${kind})`
      const win = await openEditWindow(page, name)
      const sheet = await openValueEditor(page, win)
      const dialog = await floatingDialog(page, 'Edit value', 'value-editor-sheet')
      if (body === null) {
        await expect(dialog.locator('.cm-content').first(), `${title}: the cursor is in the code editor`).toBeFocused()
      } else {
        await expect
          .poll(() => dialog.getByTestId(body).evaluate((el) => el.contains(document.activeElement)), {
            message: `${title}: the cursor is inside the ${kind} body`,
          })
          .toBe(true)
      }
      await expectPageBehindWorks(page, dialog, title)
      await closeValueEditor(page, sheet)
      await cancelWindow(page, win)
    })
  }

  test('the Block window, Profiles, the Parts editor and the cipher picker are named non-modal dialogs', async ({
    page,
  }) => {
    const httpId = 'win-http'
    await seedAndOpen(page, 7, [
      pluginBlock(httpId, 'Fetch Status', 'http-client', 'network', {
        values: { url: 'https://127.0.0.1:9449/echo', method: 'POST', verify_ssl: false, body_mode: 'multipart' },
      }),
    ])

    await openBlockWindow(page, httpId)
    const block = await floatingDialog(page, 'Fetch Status - Edit Config', 'element-config-sheet')
    await expectPageBehindWorks(page, block, 'Block window')

    await test.step('Profiles', async () => {
      await block.getByRole('button', { name: 'Profiles', exact: true }).click()
      const profiles = await floatingDialog(page, 'Profiles', 'profile-binding-sheet')
      await expectPageBehindWorks(page, profiles, 'Profiles')
      await closeFromHeader(profiles)
    })

    await test.step('Edit value from the Parts editor', async () => {
      await openGroup(block, 'Body')
      await block.getByRole('button', { name: 'Open editor for Parts', exact: true }).click()
      const parts = await floatingDialog(page, 'Edit value', 'parts-editor-sheet')
      await expectPageBehindWorks(page, parts, 'Parts editor')
      await parts.getByTestId('parts-editor-cancel-button').click()
      await expect(parts).toHaveCount(0)
    })

    await test.step('Edit value from the cipher picker', async () => {
      await openGroup(block, 'TLS / Certificates')
      await openCipherPicker(page, block)
      const ciphers = await floatingDialog(page, 'Edit value', 'cipher-picker-sheet')
      await expectPageBehindWorks(page, ciphers, 'Cipher picker')
      await ciphers.getByTestId('cipher-picker-cancel-button').click()
      await expect(ciphers).toHaveCount(0)
    })

    await closeBlockSheet(block)
  })

  test('the file picker is a named non-modal dialog in all four modes', async ({ page }) => {
    const readId = 'win-read'
    const listId = 'win-list'
    const copyId = 'win-copy'
    await seedAndOpen(page, 8, [
      pluginBlock(readId, 'Read Input', 'file-io', 'system', { values: { operation: 'read', path: 'artifact://in.txt' } }),
      pluginBlock(listId, 'List Output', 'file-io', 'system', {
        values: { operation: 'list', path: 'artifact://out', recursive: false, size: false },
        position: { x: 200, y: 320 },
      }),
      pluginBlock(copyId, 'Copy Input', 'file-io', 'system', {
        values: { operation: 'copy', source: 'artifact://in.txt', destination: 'artifact://out/in.txt', if_exists: 'overwrite' },
        position: { x: 200, y: 440 },
      }),
    ])

    const legs: ReadonlyArray<{ block: string; param: string; mode: PickerMode }> = [
      { block: readId, param: 'path', mode: 'file' },
      { block: copyId, param: 'source', mode: 'file-or-folder' },
      { block: listId, param: 'path', mode: 'folder' },
      { block: copyId, param: 'destination', mode: 'save-as' },
    ]
    for (const { block, param, mode } of legs) {
      const title = PICKER_TITLES[mode]
      await test.step(title, async () => {
        const sheet = await openBlockWindow(page, block)
        const picker = await openPicker(page, sheet, param, mode)
        const dialog = await floatingDialog(page, title, 'file-reference-picker-sheet')
        await expectPageBehindWorks(page, dialog, title)
        await picker.cancel.click()
        await expect(dialog).toHaveCount(0)
        await closeBlockSheet(sheet)
      })
    }
  })

  test('Functions Library, Test Data and Session Artifacts are named non-modal dialogs', async ({ page }) => {
    await seedAndOpen(page, 9, [logBlock('win-log', 'Say Hello', "'hello'")])

    await test.step('Functions Library', async () => {
      await expandPalette(page)
      await page.getByTestId('palette-blocks-library-button').click()
      const library = await floatingDialog(page, 'Functions Library', 'functions-library')
      await expectPageBehindWorks(page, library, 'Functions Library')
      await closeFromHeader(library)
    })

    await test.step('Test Data', async () => {
      await page.getByTestId('breadcrumb-testdata-chip').click()
      const data = await floatingDialog(page, 'Test Data', 'testdata-sheet')
      await expectPageBehindWorks(page, data, 'Test Data')
      await closeFromHeader(data)
    })

    await test.step('Session Artifacts', async () => {
      await page.getByTestId('breadcrumb-artifacts-chip').click()
      const artifacts = await floatingDialog(page, 'Session Artifacts', 'session-artifacts-sheet')
      await expectPageBehindWorks(page, artifacts, 'Session Artifacts')
      await closeFromHeader(artifacts)
    })
  })
})
