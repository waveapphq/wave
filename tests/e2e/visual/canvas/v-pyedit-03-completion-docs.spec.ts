/**
 * V-PYEDIT-03: Python script editor, completion and documentation
 * Design Decisions: PYRUN-13, PYRUN-19
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. Ctrl+Space at an identifier opens the completion list grouped into
 *    Variables and Functions, with the typed prefix underlined in each label.
 * 2. The block's Input Variables are offered by name in the Variables group,
 *    with their types.
 * 3. The documentation panel beside the highlighted "readings" entry names its
 *    origin (Input Variable), its columns and the table access forms.
 * 4. The full Python builtins catalog is offered in script mode, including the
 *    names the expression editor blocks.
 * 5. Completion after a dot adds a third group, Members, carrying the server's
 *    items with a signature and a docstring in the documentation panel.
 * 6. A failed server request degrades to the catalog silently: the list still
 *    opens and no error surfaces.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  PYTHON_SCRIPT,
  deletePythonTest,
  openPythonScriptSheet,
  seedAndOpenPythonTest,
  setPythonScript,
} from './python-seed'

/** The prefix of the approved render: line 11 reads `re`. */
const PREFIX = 're'

/** The builtins the expression engine blocks. A script is not sandboxed, so it offers them all. */
const BLOCKED_BUILTINS = [
  'tuple', 'bytes', 'pow', 'divmod', 'enumerate', 'zip', 'isinstance', 'hasattr',
  'getattr', 'callable', 'chr', 'ord', 'repr', 'ascii', 'bin', 'hex', 'oct',
  'print', 'input', 'open', 'id', 'hash', 'iter', 'next', 'vars', 'dir', 'eval', 'exec',
]

/** Facts the approved render puts in the panel beside the highlighted `readings`. */
const READINGS_DOC_FACTS = [
  'Input Variable',
  '3 columns: sensor, temp_c, taken_at',
  'Rows are dicts; iterate, index, len(); .columns and .rows',
]

interface ListedOption {
  label: string
  detail: string
  matched: string
}

const created: string[] = []

const listbox = (page: Page) =>
  page.locator('.cm-tooltip-autocomplete ul[role="listbox"]').first()
const infoPanel = (page: Page) => page.locator('.cm-completionInfo').first()
const validation = (sheet: Locator) => sheet.locator('[data-testid="value-editor-validation"]')

/** Replace the script, put the caret at its end and ask for the list. */
async function completeAtEnd(page: Page, sheet: Locator, script: string): Promise<void> {
  await leaveExpressionEditor(sheet)
  await setPythonScript(page, sheet, script)
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Control+Space')
  await expect(listbox(page)).toBeVisible()
}

/** The rendered options, keyed by the section header they sit under. */
function groupedOptions(page: Page): Promise<Record<string, ListedOption[]>> {
  return listbox(page).evaluate((ul) => {
    const groups: Record<string, { label: string; detail: string; matched: string }[]> = {}
    let section = ''
    for (const child of Array.from(ul.children)) {
      if (child.classList.contains('cm-completionSection')) {
        section = (child.textContent ?? '').trim()
        groups[section] = []
        continue
      }
      if (child.tagName !== 'LI') continue
      const matched = Array.from(child.querySelectorAll('.cm-completionMatchedText'))
        .map((span) => span.textContent ?? '')
        .join('')
      groups[section] = groups[section] ?? []
      groups[section].push({
        label: child.querySelector('.cm-completionLabel')?.textContent ?? '',
        detail: child.querySelector('.cm-completionDetail')?.textContent ?? '',
        matched,
      })
    }
    return groups
  })
}

test.describe('V-PYEDIT-03: completion and documentation in the Python script editor', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-03 list: Variables and Functions, the typed prefix underlined', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-03 list'))
    const sheet = await openPythonScriptSheet(page)

    await completeAtEnd(page, sheet, `${PYTHON_SCRIPT}\n${PREFIX}`)

    // PYRUN-19: the catalog groups the block's variables before the builtins.
    const groups = await groupedOptions(page)
    expect(Object.keys(groups), 'the list is grouped Variables then Functions').toEqual([
      'Variables',
      'Functions',
    ])

    const variables = groups.Variables
    const readings = variables.find((option) => option.label === 'readings')
    expect(readings, 'the Input Variable readings is offered by name').toBeDefined()
    expect(readings!.detail, 'readings carries its type').toBe('table')
    expect(
      variables.map((option) => option.label),
      'the second Input Variable is offered too',
    ).toContain('threshold')
    expect(groups.Functions.map((option) => option.label)).toContain('repr')

    // The typed prefix is underlined inside every label the list offers.
    for (const option of [...groups.Variables, ...groups.Functions]) {
      expect(option.matched.toLowerCase(), `${option.label} underlines the prefix`).toBe(PREFIX)
    }
    const underline = await page
      .locator('.cm-tooltip-autocomplete .cm-completionMatchedText')
      .first()
      .evaluate((span) => globalThis.getComputedStyle(span).textDecorationLine)
    expect(underline, 'the matched characters are underlined').toContain('underline')
  })

  test('V-PYEDIT-03 docs: the panel beside readings names its origin, columns and access', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-03 docs'))
    const sheet = await openPythonScriptSheet(page)

    await completeAtEnd(page, sheet, `${PYTHON_SCRIPT}\n${PREFIX}`)

    // PYRUN-19: readings is the highlighted entry, so the panel beside it is its documentation.
    const selected = listbox(page).locator('li[aria-selected]')
    await expect(selected.locator('.cm-completionLabel')).toHaveText('readings')
    await expect(infoPanel(page)).toBeVisible()
    for (const fact of READINGS_DOC_FACTS) {
      await expect(infoPanel(page), fact).toContainText(fact)
    }
  })

  test('V-PYEDIT-03 builtins: a script offers the names the expression editor blocks', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-03 builtins'))
    const sheet = await openPythonScriptSheet(page)

    await completeAtEnd(page, sheet, `${PYTHON_SCRIPT}\n`)

    const groups = await groupedOptions(page)
    const offered = new Set(groups.Functions.map((option) => option.label))
    for (const name of BLOCKED_BUILTINS) {
      expect(offered.has(name), `${name} is offered in script mode`).toBe(true)
    }
    for (const name of ['len', 'sorted', 'reversed']) {
      expect(offered.has(name), `${name} is offered too`).toBe(true)
    }
  })

  test('V-PYEDIT-03 members: a dot adds the server group with its signature and docstring', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-03 members'))
    const sheet = await openPythonScriptSheet(page)

    // Deliberate deviation (blueprint-tests section 3): the wireframe renders the
    // identifier case only, so the dot case has no wireframe of its own.
    await completeAtEnd(page, sheet, `${PYTHON_SCRIPT}\nstatistics.`)
    const groups = await groupedOptions(page)
    expect(Object.keys(groups), 'a dot adds the Members group').toContain('Members')

    await completeAtEnd(page, sheet, `${PYTHON_SCRIPT}\nstatistics.mean`)
    const selected = listbox(page).locator('li[aria-selected]')
    await expect(selected.locator('.cm-completionLabel')).toHaveText('mean')
    await expect(selected.locator('.cm-completionDetail')).toHaveText(/^mean\(/)

    const parts = infoPanel(page).locator('.cm-python-completion-info > div')
    await expect(parts, 'the panel carries the signature and the docstring').toHaveCount(2)
    await expect(parts.nth(0)).toHaveText(/^mean\(/)
    await expect(parts.nth(1)).not.toBeEmpty()
  })

  test('V-PYEDIT-03 offline: a failed server request still opens the catalog', async ({ page }) => {
    // A server error, not a dropped connection: a network failure marks the whole backend offline.
    await page.route('**/python-tools/complete', (route) => route.fulfill({ status: 500, body: 'error' }))
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-03 offline'))
    const sheet = await openPythonScriptSheet(page)

    // `readings.columns` parses and the caret sits right after the dot, so the
    // server is asked and the table methods are what the catalog can still give.
    await setPythonScript(page, sheet, 'readings.columns')
    await page.keyboard.press('ControlOrMeta+Home')
    for (let step = 0; step < 'readings.'.length; step += 1) {
      await page.keyboard.press('ArrowRight')
    }
    await page.keyboard.press('Control+Space')
    await expect(listbox(page)).toBeVisible()

    const groups = await groupedOptions(page)
    const methods = Object.keys(groups).find((name) => name.startsWith('Methods for '))
    expect(methods, 'the catalog answers on its own').toBeDefined()
    expect(groups[methods!].length).toBeGreaterThan(0)

    // Nothing about the failed call reaches the author.
    await expect(validation(sheet)).toHaveCount(0)
    await expect(sheet.locator('[role="alert"]')).toHaveCount(0)
  })
})
