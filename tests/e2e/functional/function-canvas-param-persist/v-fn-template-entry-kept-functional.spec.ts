/**
 * V-FN-TEMPLATE-ENTRY-KEPT-FUNCTIONAL: a Function input set as a Template and a map input with an {x} entry keep their kind
 * Wireframe: none (functional)
 * Design Decisions: CANVAS-207, CANVAS-211, FIELD-1, FIELD-6
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.3.15, REQ-3.1.3.19
 *
 * Seeds (API, POST /tests): a `zz-11541-s7-` Test with the variables `who` (string `Ann`) and `base`
 * (integer 41), a Local Function `Greet_Fn` with the optional inputs `greeting` (string) and `opts`
 * (map), whose body Log prints `greeting + '|' + str(opts['k'])`, and a marker Log after it. The
 * Function Block holds no value. The window edits, the Saves and the run are made through the UI.
 *
 * Pass Criteria:
 * 1. In the Function Block window, `greeting` is made a Template `Hello {{ who }}` through its editor's
 *    Kind, and `opts` gets the entry `k` switched to {x} holding `base + 1`; the window and the Test save.
 * 2. The stored Function Block holds `greeting` = `Hello {{ who }}` flagged in `templateFields`, `opts` =
 *    `{k: 'base + 1'}` with the entry flag `opts.k` in `expressionFields`, and no whole-field flag for either.
 * 3. After a reload the window shows `greeting` in literal mode whose editor opens on Kind Template with
 *    the same text, and the map editor shows `k` with {x} on and `base + 1`; closing changes nothing.
 * 4. The run passes and the body Log prints `Hello Ann|42`: the Function gets the filled Template and the
 *    evaluated entry.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  addMapEntryExpression,
  cleanUp,
  closeBlockWindow,
  closeValueSheet,
  configOf,
  createTest,
  fieldToggle,
  localFunctionBlock,
  logBlock,
  openFieldEditor,
  openBlockWindow,
  saveBlockWindow,
  setFieldTemplate,
  storedBlock,
  zzName,
} from '../../helpers/fn-block'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { runToEnd, saveBtn, saveTest, selectEnvironment } from '../../helpers/workbench'

const FN_ID = 'fn-greet'
const BODY_LOG = 'fn-greet-log'
const MARKER = 'zz-11541-s7-template-entry-done'
const TEMPLATE = 'Hello {{ who }}'
const ENTRY_EXPRESSION = 'base + 1'

test.describe('V-FN-TEMPLATE-ENTRY-KEPT-FUNCTIONAL: Template and {x} entries on Function inputs', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('a Template input and an {x} map entry keep their kind after reopen and the Function gets their values', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testId = await createTest(request, {
      name: zzName('template-entry'),
      variables: {
        who: { type: 'string', value: 'Ann', scope: 'test' },
        base: { type: 'integer', value: 41, scope: 'test' },
      },
      nodes: [
        localFunctionBlock(FN_ID, 'Greet_Fn', {
          inputs: [
            { name: 'greeting', type: 'string', required: false, default: null, description: '' },
            { name: 'opts', type: 'map', required: false, default: null, description: '' },
          ],
          nodes: [logBlock(BODY_LOG, 'Print Greeting', "greeting + '|' + str(opts['k'])")],
        }),
        logBlock('marker-log', 'Marker', `'${MARKER}'`, { position: { x: 300, y: 360 } }),
      ],
    })
    testIds.push(testId)
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
    await openTest(page, testId)

    await test.step('the window takes a Template and an {x} map entry, and the Test saves', async () => {
      const sheet = await openBlockWindow(page, FN_ID)
      await setFieldTemplate(page, sheet, 'greeting', TEMPLATE)
      await addMapEntryExpression(page, sheet, 'opts', 'k', ENTRY_EXPRESSION)
      await saveBlockWindow(sheet)
      await saveTest(page)
    })

    await test.step('the stored Block keeps the Template flag and the entry flag, and no whole-field flag', async () => {
      const block = await storedBlock(request, testId, FN_ID)
      expect(configOf(block).values).toEqual({ greeting: TEMPLATE, opts: { k: ENTRY_EXPRESSION } })
      expect(block.templateFields).toEqual(['greeting'])
      expect(block.expressionFields).toEqual(['opts.k'])
    })

    await test.step('after a reload the window opens both fields in the kind they were saved in', async () => {
      await openTest(page, testId)
      const sheet = await openBlockWindow(page, FN_ID)
      await expect(fieldToggle(sheet, 'greeting'), 'a Template is not an {x} field').toHaveAttribute('aria-pressed', 'false')
      const text = await openFieldEditor(page, sheet, 'greeting')
      await expect(text.getByTestId('kind-dropdown')).toHaveText('Template')
      await expect(text.locator('.cm-content').first()).toHaveText(TEMPLATE)
      await closeValueSheet(text)

      await expect(fieldToggle(sheet, 'opts'), 'an {x} entry leaves the field literal').toHaveAttribute('aria-pressed', 'false')
      const map = await openFieldEditor(page, sheet, 'opts')
      await expect(map.locator('[data-testid^="map-edit-key-"]')).toHaveCount(1)
      await expect(map.getByTestId('map-edit-key-0')).toHaveValue('k')
      await expect(map.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
      await expect(map.locator('[data-testid="map-expr-value-0"] .cm-content')).toHaveText(ENTRY_EXPRESSION)
      await closeValueSheet(map)

      await closeBlockWindow(sheet)
      await expect(saveBtn(page), 'opening and closing changed nothing').toBeDisabled()
    })

    await test.step('the run gives the Function the filled Template and the evaluated entry', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', 'Hello Ann|42')
      expectConsoleLine(entries, 'INFO', MARKER)
    })
  })
})
